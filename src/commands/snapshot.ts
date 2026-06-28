import { Command } from "commander";

import * as git from "../clients/git.ts";
import * as github from "../clients/github.ts";
import * as jira from "../clients/jira.ts";
import * as snyk from "../clients/snyk.ts";
import { read as readCredential } from "../credential-store.ts";
import {
  listServiceDefinitions,
  resolveServiceState,
  type ServiceId,
} from "../config-model.ts";
import { inlineErrorText } from "./command-utils.ts";

interface SnapshotSection<T> {
  items: T[];
  errors: string[];
}

interface SnapshotSecurityFinding {
  provider: "github" | "snyk";
  id: string;
  repositoryFullName: string | null;
  projectName: string | null;
  packageName: string | null;
  severity: string;
  title: string;
  url: string;
  manifestPath: string | null;
  vulnerableRange: string | null;
  fixedVersion: string | null;
}

interface SnapshotServiceStatus {
  id: ServiceId;
  name: string;
  configured: boolean;
  errors: string[];
}

interface CompanionSnapshot {
  schema: "triage_companion_snapshot.v1";
  generatedAt: string;
  serviceStatus: SnapshotServiceStatus[];
  securityFindings: SnapshotSection<SnapshotSecurityFinding>;
  failedWorkflows: SnapshotSection<unknown>;
  dirtyRepositories: SnapshotSection<unknown>;
  openPullRequests: SnapshotSection<unknown>;
  jiraTickets: SnapshotSection<unknown>;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return inlineErrorText(message)
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/(token=)[^\s&]+/gi, "$1[redacted]")
    .replace(/(password=)[^\s&]+/gi, "$1[redacted]");
}

async function capture<T>(load: () => Promise<T[]> | T[]): Promise<SnapshotSection<T>> {
  try {
    return {
      items: await load(),
      errors: [],
    };
  } catch (error) {
    return {
      items: [],
      errors: [sanitizeError(error)],
    };
  }
}

function serviceStatus(): SnapshotServiceStatus[] {
  return listServiceDefinitions()
    .filter((service) => service.id !== "local")
    .map((service) => {
      try {
        const state = resolveServiceState(service.id, {
          readEnv: (name) => process.env[name],
          readSecret: (serviceName, account) => readCredential(serviceName, account),
        });

        return {
          id: service.id,
          name: service.name,
          configured: state.configured,
          errors: state.errors.map(sanitizeError),
        };
      } catch (error) {
        return {
          id: service.id,
          name: service.name,
          configured: false,
          errors: [sanitizeError(error)],
        };
      }
    });
}

async function loadGitHubSecurityFindings(): Promise<SnapshotSecurityFinding[]> {
  const repos = await github.listSecurityAlertNotificationRepositories();
  if (repos.length === 0) {
    return [];
  }

  const alerts = await github.listSecurityAlerts(repos);
  return alerts.map((alert) => ({
    provider: "github",
    id: alert.ghsaID,
    repositoryFullName: alert.repositoryFullName,
    projectName: null,
    packageName: alert.packageName,
    severity: alert.severity,
    title: alert.summary,
    url: alert.url,
    manifestPath: alert.manifestPath,
    vulnerableRange: alert.vulnerableRange,
    fixedVersion: alert.patchedVersion,
  }));
}

async function loadSnykSecurityFindings(): Promise<SnapshotSecurityFinding[]> {
  const snapshot = await snyk.listOpenIssues();
  return snapshot.issues.map((issue) => ({
    provider: "snyk",
    id: issue.issueKey ?? issue.id,
    repositoryFullName: null,
    projectName: issue.projectName,
    packageName: issue.packageName,
    severity: issue.severity,
    title: issue.title,
    url: issue.url,
    manifestPath: null,
    vulnerableRange: null,
    fixedVersion: null,
  }));
}

async function securityFindings(): Promise<SnapshotSection<SnapshotSecurityFinding>> {
  const sections = await Promise.all([
    capture(loadGitHubSecurityFindings),
    capture(loadSnykSecurityFindings),
  ]);

  return {
    items: sections.flatMap((section) => section.items),
    errors: sections.flatMap((section) => section.errors),
  };
}

async function failedWorkflows(): Promise<SnapshotSection<unknown>> {
  return capture(async () => {
    const repos = await github.listSecurityAlertNotificationRepositories();
    if (repos.length === 0) {
      return [];
    }
    return github.listFailedWorkflowRuns(repos, { maxPerRepo: 3 });
  });
}

async function buildSnapshot(): Promise<CompanionSnapshot> {
  const [
    securityFindingsSection,
    failedWorkflowsSection,
    dirtyRepositoriesSection,
    openPullRequestsSection,
    jiraTicketsSection,
  ] = await Promise.all([
    securityFindings(),
    failedWorkflows(),
    capture(() => git.listDirtyRepositories({ maxResults: 100 })),
    capture(() => github.listMyOpenPullRequests({})),
    capture(() => jira.listOpenTickets()),
  ]);

  return {
    schema: "triage_companion_snapshot.v1",
    generatedAt: new Date().toISOString(),
    serviceStatus: serviceStatus(),
    securityFindings: securityFindingsSection,
    failedWorkflows: failedWorkflowsSection,
    dirtyRepositories: dirtyRepositoriesSection,
    openPullRequests: openPullRequestsSection,
    jiraTickets: jiraTicketsSection,
  };
}

export function register(program: Command): void {
  program
    .command("snapshot")
    .description("Emit a read-only JSON snapshot for the Triage macOS app")
    .option("--json", "Output as JSON", true)
    .action(async () => {
      const snapshot = await buildSnapshot();
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    });
}
