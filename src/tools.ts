import * as store from "./credential-store.ts";

const CONFIG_SERVICE = "Triage Companion-Config";
const ENABLED_TOOLS_ACCOUNT = "enabled-tools";

export type ToolId =
  | "github-notifications"
  | "github-issues"
  | "github-actions"
  | "github-security"
  | "github-pull-requests"
  | "local-projects"
  | "aws"
  | "snyk"
  | "jira";

export interface ToolDefinition {
  id: ToolId;
  name: string;
  description: string;
  requirements: readonly string[];
}

export interface ToolAccessItem extends ToolDefinition {
  enabled: boolean;
}

const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    id: "github-notifications",
    name: "GitHub notifications",
    description: "Read and mark GitHub notification threads.",
    requirements: [
      "Classic GitHub personal access token with notifications scope",
    ],
  },
  {
    id: "github-issues",
    name: "GitHub issues",
    description: "Read repository issues associated with local projects.",
    requirements: [
      "GitHub token with Issues: read for fine-grained tokens, or repo for private repositories with classic tokens",
    ],
  },
  {
    id: "github-actions",
    name: "GitHub Actions",
    description: "Read recent failed workflow runs for associated repositories.",
    requirements: [
      "GitHub token with Actions: read for fine-grained tokens, or repo for private repositories with classic tokens",
    ],
  },
  {
    id: "github-security",
    name: "GitHub security alerts",
    description: "Read Dependabot security alerts.",
    requirements: [
      "Fine-grained token with Dependabot alerts: read; classic token with security_events for public repos or repo for private repos",
    ],
  },
  {
    id: "github-pull-requests",
    name: "GitHub pull requests",
    description: "Match local branches with your open pull requests.",
    requirements: [
      "No token required for local git discovery; token helps infer GitHub login and read PR metadata",
    ],
  },
  {
    id: "local-projects",
    name: "Local projects",
    description: "Load named local repository roots and expose them to the UI.",
    requirements: [
      "A local Git repository root selected by the user",
    ],
  },
  {
    id: "aws",
    name: "AWS",
    description: "Detect local AWS credentials for deployed project context.",
    requirements: [
      "AWS CLI-compatible credentials that can run aws sts get-caller-identity for verification",
    ],
  },
  {
    id: "snyk",
    name: "Snyk",
    description: "Read Snyk open issues.",
    requirements: [
      "Snyk token with read access to organizations and projects",
    ],
  },
  {
    id: "jira",
    name: "Jira",
    description: "Read Jira tickets.",
    requirements: [
      "Jira base URL, account email, and API token with Browse Projects and View Issues",
    ],
  },
] as const;

export const DEFAULT_ENABLED_TOOLS = TOOL_DEFINITIONS.map((tool) => tool.id);

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

function validateToolIds(toolIds: readonly string[]): ToolId[] {
  const validIds = new Set<string>(TOOL_DEFINITIONS.map((tool) => tool.id));
  const seen = new Set<string>();
  const normalized: ToolId[] = [];

  for (const toolId of toolIds) {
    if (toolId.trim().length === 0) {
      throw new Error("Enabled tools must be a JSON array of non-empty strings.");
    }
    if (toolId.trim() !== toolId) {
      throw new Error("Enabled tools must contain ids without surrounding whitespace.");
    }
    if (/[\u0000-\u001F\u007F-\u009F]/.test(toolId)) {
      throw new Error("Enabled tools must contain ids without control characters.");
    }
    if (!validIds.has(toolId)) {
      throw new Error(`Unknown tool id ${inlineErrorText(toolId)}.`);
    }
    if (seen.has(toolId)) {
      throw new Error("Enabled tools must not contain duplicate ids.");
    }

    seen.add(toolId);
    normalized.push(toolId as ToolId);
  }

  return normalized;
}

function parseStoredEnabledTools(raw: string | null): ToolId[] {
  if (raw === null) {
    return [...DEFAULT_ENABLED_TOOLS];
  }
  if (raw.trim() !== raw) {
    throw new Error("Stored enabled tools must not include surrounding whitespace.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = inlineErrorText(error instanceof Error ? error.message : String(error));
    throw new Error(`Stored enabled tools are not valid JSON: ${message}`, {
      cause: error,
    });
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("Stored enabled tools must be a JSON array of strings.");
  }

  return validateToolIds(parsed);
}

export function parseEnabledToolsInput(raw: string): ToolId[] {
  if (raw.trim().length === 0) {
    throw new Error("Enabled tools must be a JSON array of tool ids.");
  }
  if (raw.trim() !== raw) {
    throw new Error("Enabled tools must not include surrounding whitespace.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Enabled tools must be a JSON array of tool ids.");
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("Enabled tools must be a JSON array of tool ids.");
  }

  return validateToolIds(parsed);
}

export function listToolDefinitions(): readonly ToolDefinition[] {
  return TOOL_DEFINITIONS;
}

export function readEnabledTools(): ToolId[] {
  return parseStoredEnabledTools(store.read(CONFIG_SERVICE, ENABLED_TOOLS_ACCOUNT));
}

export function saveEnabledTools(toolIds: readonly string[]): ToolId[] {
  const normalized = validateToolIds(toolIds);
  store.save(CONFIG_SERVICE, ENABLED_TOOLS_ACCOUNT, JSON.stringify(normalized));
  return normalized;
}

export function resetEnabledTools(): void {
  store.remove(CONFIG_SERVICE, ENABLED_TOOLS_ACCOUNT);
}

export function isToolEnabled(toolId: ToolId): boolean {
  return readEnabledTools().includes(toolId);
}

export function toolAccessSnapshot(): ToolAccessItem[] {
  const enabled = new Set(readEnabledTools());
  return TOOL_DEFINITIONS.map((tool) => ({
    ...tool,
    requirements: [...tool.requirements],
    enabled: enabled.has(tool.id),
  }));
}
