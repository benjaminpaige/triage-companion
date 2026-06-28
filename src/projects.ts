import fs from "node:fs";
import path from "node:path";

import * as store from "./credential-store.ts";
import { isGitRepositoryMetadataPath } from "./git/search.ts";
import { validateRepositoryFullName } from "./clients/github-url.ts";
import type { GitHubIssue } from "./clients/github-issues.ts";

const CONFIG_SERVICE = "Triage Companion-Config";
const PROJECTS_ACCOUNT = "projects";

export interface LocalProject {
  name: string;
  root: string;
  githubRepository: string | null;
}

export interface ProjectInput {
  name: string;
  root: string;
  githubRepository?: string | null;
}

export interface IssueActionContext {
  project: LocalProject;
  githubRepository: string;
  issue: GitHubIssue;
  codexPrompt: string;
}

function inlineErrorText(text: string): string {
  const normalizedLineBreaks = text.replace(/\r\n?|\n/g, ", ");
  return normalizedLineBreaks.replace(/[\u0000-\u001F\u007F-\u009F]/g, (character) => {
    switch (character) {
      case "\t":
        return "\\t";
      default:
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });
}

function validateProjectName(name: string): string {
  if (name.trim().length === 0) {
    throw new Error("Project name must not be empty.");
  }
  if (name.trim() !== name) {
    throw new Error("Project name must not include surrounding whitespace.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(name)) {
    throw new Error("Project name must not include control characters.");
  }

  return name;
}

function validateProjectRoot(root: string): string {
  if (root.trim().length === 0) {
    throw new Error("Project root must not be empty.");
  }
  if (root.trim() !== root) {
    throw new Error("Project root must not include surrounding whitespace.");
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(root)) {
    throw new Error("Project root must not include control characters.");
  }

  const normalized = path.isAbsolute(root) ? root : path.resolve(root);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalized);
  } catch {
    throw new Error("Project root must exist.");
  }

  if (!stat.isDirectory()) {
    throw new Error("Project root must be a directory.");
  }
  if (!isGitRepositoryMetadataPath(path.join(normalized, ".git"))) {
    throw new Error("Project root must be a Git repository.");
  }

  return normalized;
}

function validateOptionalGitHubRepository(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.length === 0) {
    return null;
  }

  return validateRepositoryFullName(value);
}

function projectKey(name: string): string {
  return name.toLowerCase();
}

function parseProjects(raw: string | null): LocalProject[] {
  if (raw === null) {
    return [];
  }
  if (raw.trim() !== raw) {
    throw new Error("Stored projects must not include surrounding whitespace.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = inlineErrorText(error instanceof Error ? error.message : String(error));
    throw new Error(`Stored projects are not valid JSON: ${message}`, {
      cause: error,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Stored projects must be a JSON array.");
  }

  const projects: LocalProject[] = [];
  const seen = new Set<string>();
  for (const [index, item] of parsed.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Stored project #${index + 1} must be an object.`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.root !== "string") {
      throw new Error(`Stored project #${index + 1} must include name and root strings.`);
    }
    if (record.githubRepository !== null && record.githubRepository !== undefined && typeof record.githubRepository !== "string") {
      throw new Error(`Stored project #${index + 1} GitHub repository must be a string or null.`);
    }

    const project: LocalProject = {
      name: validateProjectName(record.name),
      root: validateProjectRoot(record.root),
      githubRepository: validateOptionalGitHubRepository(record.githubRepository as string | null | undefined),
    };
    const key = projectKey(project.name);
    if (seen.has(key)) {
      throw new Error("Stored projects must not contain duplicate project names.");
    }
    seen.add(key);
    projects.push(project);
  }

  return projects;
}

function writeProjects(projects: readonly LocalProject[]): void {
  if (projects.length === 0) {
    store.remove(CONFIG_SERVICE, PROJECTS_ACCOUNT);
    return;
  }

  store.save(CONFIG_SERVICE, PROJECTS_ACCOUNT, JSON.stringify(projects));
}

export function listProjects(): LocalProject[] {
  return parseProjects(store.read(CONFIG_SERVICE, PROJECTS_ACCOUNT));
}

export function resolveProject(name: string): LocalProject | null {
  const key = projectKey(validateProjectName(name));
  return listProjects().find((project) => projectKey(project.name) === key) ?? null;
}

export function addProject(input: ProjectInput): LocalProject {
  const project: LocalProject = {
    name: validateProjectName(input.name),
    root: validateProjectRoot(input.root),
    githubRepository: validateOptionalGitHubRepository(input.githubRepository),
  };
  const projects = listProjects();
  const existingIndex = projects.findIndex((item) => projectKey(item.name) === projectKey(project.name));
  if (existingIndex === -1) {
    projects.push(project);
  } else {
    projects[existingIndex] = project;
  }
  writeProjects(projects);
  return project;
}

export function removeProject(name: string): boolean {
  const key = projectKey(validateProjectName(name));
  const projects = listProjects();
  const nextProjects = projects.filter((project) => projectKey(project.name) !== key);
  writeProjects(nextProjects);
  return nextProjects.length !== projects.length;
}

export function updateProjectGitHubRepository(name: string, githubRepository: string): LocalProject {
  const key = projectKey(validateProjectName(name));
  const projects = listProjects();
  const index = projects.findIndex((project) => projectKey(project.name) === key);
  if (index === -1) {
    throw new Error(`Project ${inlineErrorText(name)} is not configured.`);
  }

  const updated = {
    ...projects[index],
    githubRepository: validateRepositoryFullName(githubRepository),
  };
  projects[index] = updated;
  writeProjects(projects);
  return updated;
}

function issueBodyForPrompt(issue: GitHubIssue): string {
  const body = issue.body?.trim();
  return body && body.length > 0 ? body : "(no issue body)";
}

export function buildIssueActionContext(projectName: string, issue: GitHubIssue): IssueActionContext {
  const project = resolveProject(projectName);
  if (!project) {
    throw new Error(`Project ${inlineErrorText(projectName)} is not configured.`);
  }
  if (!project.githubRepository) {
    throw new Error(`Project ${inlineErrorText(project.name)} is not associated with a GitHub repository.`);
  }

  const labels = issue.labels.length > 0 ? issue.labels.join(", ") : "(none)";
  return {
    project,
    githubRepository: project.githubRepository,
    issue,
    codexPrompt: [
      `Work in local project "${project.name}" at ${project.root}.`,
      `Use GitHub repository ${project.githubRepository}.`,
      `Issue #${issue.number}: ${issue.title}`,
      `Issue URL: ${issue.url}`,
      `Author: ${issue.author ?? "(unknown)"}`,
      `Labels: ${labels}`,
      "",
      "Issue body:",
      issueBodyForPrompt(issue),
      "",
      "Inspect the local project, make the required code changes, and verify them against this issue context.",
    ].join("\n"),
  };
}
