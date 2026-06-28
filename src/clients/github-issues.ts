import {
  githubPermissionText,
  resolveToken,
} from "./github-auth.ts";
import { GITHUB_API_HOST } from "./github-constants.ts";
import {
  ghFetchWithErrorContext,
  gitHubPaginationLoopKey,
  nextURL,
  recordGitHubPaginationURL,
  validateGitHubPaginationURL,
} from "./github-api.ts";
import {
  githubErrorMessage,
  hasCanonicalTextValue,
  isRecord,
  numberField,
  parseGitHubJSON,
  recordField,
  stringField,
} from "./github-response.ts";
import {
  isPositiveSafeIntegerValue,
  parseGitHubDate,
  requireGitHubIssueWebURL,
  validatePositiveIntegerOption,
  validateRepositoryFullName,
} from "./github-url.ts";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  url: string;
  author: string | null;
  labels: string[];
  updatedAt: Date;
}

export interface ListRepositoryIssuesOptions {
  limit?: number;
  state?: "open" | "closed" | "all";
}

function issueNumber(record: Record<string, unknown>, repositoryFullName: string): number {
  const value = numberField(record, "number");
  if (!isPositiveSafeIntegerValue(value)) {
    throw new Error(`GitHub issue for ${repositoryFullName} must include a positive number.`);
  }
  return value;
}

function issueLabels(record: Record<string, unknown>, repositoryFullName: string): string[] {
  const labels = record.labels;
  if (!Array.isArray(labels)) {
    throw new Error(`GitHub issue for ${repositoryFullName} must include a labels array.`);
  }

  const names: string[] = [];
  for (const label of labels) {
    if (!isRecord(label) || !hasCanonicalTextValue(label.name)) {
      throw new Error(`GitHub issue for ${repositoryFullName} must contain label objects with valid names.`);
    }
    names.push(label.name);
  }

  return names;
}

function parseIssue(record: Record<string, unknown>, repositoryFullName: string): GitHubIssue {
  const number = issueNumber(record, repositoryFullName);
  const title = stringField(record, "title");
  if (!hasCanonicalTextValue(title)) {
    throw new Error(`GitHub issue #${number} for ${repositoryFullName} must include a title.`);
  }

  const body = record.body;
  if (body !== null && body !== undefined && typeof body !== "string") {
    throw new Error(`GitHub issue #${number} for ${repositoryFullName} body must be a string or null.`);
  }

  const updatedAt = parseGitHubDate(stringField(record, "updated_at"));
  if (!updatedAt) {
    throw new Error(`GitHub issue #${number} for ${repositoryFullName} must include a valid updated_at timestamp.`);
  }

  const user = recordField(record, "user");
  const author = stringField(user, "login") ?? null;
  if (author !== null && !hasCanonicalTextValue(author)) {
    throw new Error(`GitHub issue #${number} for ${repositoryFullName} must include a valid author login.`);
  }

  return {
    number,
    title,
    body: typeof body === "string" ? body : null,
    url: requireGitHubIssueWebURL(
      stringField(record, "html_url") ?? null,
      `GitHub issue #${number} for ${repositoryFullName}`,
      repositoryFullName,
      number,
    ),
    author,
    labels: issueLabels(record, repositoryFullName),
    updatedAt,
  };
}

function isPullRequestIssue(record: Record<string, unknown>): boolean {
  return Object.hasOwn(record, "pull_request");
}

function stateQueryValue(value: "open" | "closed" | "all"): string {
  return value;
}

export async function listRepositoryIssues(
  repositoryFullName: string,
  { limit = 25, state = "open" }: ListRepositoryIssuesOptions = {},
): Promise<GitHubIssue[]> {
  const validatedRepositoryName = validateRepositoryFullName(repositoryFullName);
  const maxResults = validatePositiveIntegerOption(limit, "GitHub issue limit");
  const token = resolveToken();
  if (!token) {
    throw new Error(`GitHub token not configured. Required permissions: ${githubPermissionText}`);
  }

  const perPage = Math.min(maxResults, 100);
  let url = `https://${GITHUB_API_HOST}/repos/${validatedRepositoryName}/issues?state=${stateQueryValue(state)}&per_page=${perPage}`;
  const seen = new Set<string>([gitHubPaginationLoopKey(url)]);
  const issues: GitHubIssue[] = [];

  while (issues.length < maxResults) {
    const response = await ghFetchWithErrorContext(
      url,
      token,
      `Could not fetch GitHub issues for ${validatedRepositoryName}`,
    );
    if (!response.ok) {
      const message = await githubErrorMessage(response);
      throw new Error(`GitHub API HTTP ${response.status} for ${validatedRepositoryName}: ${message}`);
    }

    const payload = await parseGitHubJSON(
      response,
      `GitHub issues response for ${validatedRepositoryName}`,
    );
    if (!Array.isArray(payload)) {
      throw new Error(`GitHub issues response for ${validatedRepositoryName} must be an array.`);
    }

    const records = payload.filter(isRecord);
    if (records.length !== payload.length) {
      throw new Error(`GitHub issues response for ${validatedRepositoryName} must contain issue objects.`);
    }

    for (const record of records) {
      if (isPullRequestIssue(record)) {
        continue;
      }
      issues.push(parseIssue(record, validatedRepositoryName));
      if (issues.length >= maxResults) {
        break;
      }
    }

    if (issues.length >= maxResults) {
      break;
    }

    const rawNext = nextURL(response.headers.get("link"));
    const next = rawNext ? validateGitHubPaginationURL(rawNext, url) : null;
    if (!next) {
      break;
    }
    if (payload.length === 0) {
      throw new Error(`GitHub issues response for ${validatedRepositoryName} returned an empty page before pagination finished.`);
    }

    recordGitHubPaginationURL(
      seen,
      next,
      `GitHub issues pagination for ${validatedRepositoryName}`,
    );
    url = next;
  }

  return issues.slice(0, maxResults);
}

export async function getRepositoryIssue(
  repositoryFullName: string,
  issueNumberValue: number,
): Promise<GitHubIssue> {
  const validatedRepositoryName = validateRepositoryFullName(repositoryFullName);
  const number = validatePositiveIntegerOption(issueNumberValue, "GitHub issue number");
  const token = resolveToken();
  if (!token) {
    throw new Error(`GitHub token not configured. Required permissions: ${githubPermissionText}`);
  }

  const url = `https://${GITHUB_API_HOST}/repos/${validatedRepositoryName}/issues/${number}`;
  const response = await ghFetchWithErrorContext(
    url,
    token,
    `Could not fetch GitHub issue #${number} for ${validatedRepositoryName}`,
  );
  if (!response.ok) {
    const message = await githubErrorMessage(response);
    throw new Error(`GitHub API HTTP ${response.status} for ${validatedRepositoryName} issue #${number}: ${message}`);
  }

  const payload = await parseGitHubJSON(
    response,
    `GitHub issue #${number} response for ${validatedRepositoryName}`,
  );
  if (!isRecord(payload)) {
    throw new Error(`GitHub issue #${number} response for ${validatedRepositoryName} must be an object.`);
  }
  if (isPullRequestIssue(payload)) {
    throw new Error(`GitHub issue #${number} for ${validatedRepositoryName} is a pull request.`);
  }

  return parseIssue(payload, validatedRepositoryName);
}
