import { Command } from "commander";

import * as git from "../clients/git.ts";
import * as github from "../clients/github.ts";
import * as jira from "../clients/jira.ts";
import * as snyk from "../clients/snyk.ts";
import { awsCredentialStatus, type AWSCredentialStatus } from "../clients/aws.ts";
import { read as readCredential } from "../credential-store.ts";
import {
  listServiceDefinitions,
  resolveServiceState,
  type ServiceId,
} from "../config-model.ts";
import {
  listProjects,
  type LocalProject,
} from "../projects.ts";
import {
  isToolEnabled,
  toolAccessSnapshot,
  type ToolAccessItem,
} from "../tools.ts";
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

interface SnapshotProjectIssue {
  projectName: string;
  projectRoot: string;
  githubRepository: string;
  number: number;
  title: string;
  body: string | null;
  url: string;
  author: string | null;
  labels: string[];
  updatedAt: Date;
}

export interface CompanionSnapshot {
  schema: "triage_companion_snapshot.v1";
  generatedAt: string;
  toolAccess: ToolAccessItem[];
  serviceStatus: SnapshotServiceStatus[];
  projects: SnapshotSection<LocalProject>;
  projectIssues: SnapshotSection<SnapshotProjectIssue>;
  awsStatus: AWSCredentialStatus;
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
    isToolEnabled("github-security") ? capture(loadGitHubSecurityFindings) : { items: [], errors: [] },
    isToolEnabled("snyk") ? capture(loadSnykSecurityFindings) : { items: [], errors: [] },
  ]);

  return {
    items: sections.flatMap((section) => section.items),
    errors: sections.flatMap((section) => section.errors),
  };
}

function projectRepositoryFullNames(): string[] {
  const repositories: string[] = [];
  const seen = new Set<string>();
  for (const project of listProjects()) {
    if (!project.githubRepository) {
      continue;
    }
    const key = project.githubRepository.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    repositories.push(project.githubRepository);
  }

  return repositories;
}

async function failedWorkflows(): Promise<SnapshotSection<unknown>> {
  if (!isToolEnabled("github-actions")) {
    return { items: [], errors: [] };
  }

  return capture(async () => {
    let repos = projectRepositoryFullNames();
    if (repos.length === 0) {
      repos = await github.listSecurityAlertNotificationRepositories();
    }
    if (repos.length === 0) {
      return [];
    }
    return github.listFailedWorkflowRuns(repos, { maxPerRepo: 3 });
  });
}

async function projects(): Promise<SnapshotSection<LocalProject>> {
  if (!isToolEnabled("local-projects")) {
    return { items: [], errors: [] };
  }

  return capture(() => listProjects());
}

async function projectIssues(): Promise<SnapshotSection<SnapshotProjectIssue>> {
  if (!isToolEnabled("github-issues") || !isToolEnabled("local-projects")) {
    return { items: [], errors: [] };
  }

  return capture(async () => {
    const items: SnapshotProjectIssue[] = [];
    for (const project of listProjects()) {
      if (!project.githubRepository) {
        continue;
      }

      const issues = await github.listRepositoryIssues(project.githubRepository, { limit: 25 });
      items.push(
        ...issues.map((issue) => ({
          projectName: project.name,
          projectRoot: project.root,
          githubRepository: project.githubRepository as string,
          ...issue,
        })),
      );
    }

    return items;
  });
}

export async function buildSnapshot(): Promise<CompanionSnapshot> {
  const [
    projectsSection,
    projectIssuesSection,
    securityFindingsSection,
    failedWorkflowsSection,
    dirtyRepositoriesSection,
    openPullRequestsSection,
    jiraTicketsSection,
  ] = await Promise.all([
    projects(),
    projectIssues(),
    securityFindings(),
    failedWorkflows(),
    isToolEnabled("local-projects")
      ? capture(() => git.listDirtyRepositories({ maxResults: 100 }))
      : { items: [], errors: [] },
    isToolEnabled("github-pull-requests")
      ? capture(() => github.listMyOpenPullRequests({}))
      : { items: [], errors: [] },
    isToolEnabled("jira")
      ? capture(() => jira.listOpenTickets())
      : { items: [], errors: [] },
  ]);

  return {
    schema: "triage_companion_snapshot.v1",
    generatedAt: new Date().toISOString(),
    toolAccess: toolAccessSnapshot(),
    serviceStatus: serviceStatus(),
    projects: projectsSection,
    projectIssues: projectIssuesSection,
    awsStatus: isToolEnabled("aws")
      ? awsCredentialStatus()
      : { configured: false, sources: [], profile: null, errors: [] },
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
