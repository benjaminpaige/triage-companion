import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildSnapshot } from "./snapshot.ts";
import { addProject } from "../projects.ts";
import { resetCache } from "../credential-store.ts";
import { saveEnabledTools } from "../tools.ts";

let originalConfigDir: string | undefined;
let originalGitHubToken: string | undefined;
let originalFetch: typeof global.fetch;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalGitHubToken = process.env.GITHUB_TOKEN;
  originalFetch = global.fetch;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-snapshot-"));
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  process.env.GITHUB_TOKEN = "github-token";
  resetCache();
});

afterEach(() => {
  global.fetch = originalFetch;
  resetCache();
  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }
  if (originalGitHubToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalGitHubToken;
  }
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("app snapshot", () => {
  test("includes tool access, local projects, GitHub issues, and AWS credential status", async () => {
    const repoRoot = path.join(testDir, "repo");
    fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
    saveEnabledTools(["github-issues", "local-projects", "github-actions", "aws"]);
    addProject({
      name: "App",
      root: repoRoot,
      githubRepository: "octocat/hello-world",
    });

    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/issues?")) {
        return new Response(JSON.stringify([
          {
            number: 9,
            title: "Deploy fix",
            body: "AWS deploy needs attention.",
            html_url: "https://github.com/octocat/hello-world/issues/9",
            user: { login: "octocat" },
            labels: [{ name: "deploy" }],
            updated_at: "2026-06-28T12:00:00Z",
          },
        ]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ workflow_runs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const snapshot = await buildSnapshot();

    assert.equal(snapshot.schema, "triage_companion_snapshot.v1");
    assert.equal(snapshot.toolAccess.find((tool) => tool.id === "github-issues")?.enabled, true);
    assert.deepEqual(snapshot.projects.items.map((project) => project.name), ["App"]);
    assert.deepEqual(
      snapshot.projectIssues.items.map((issue) => [issue.projectName, issue.number, issue.title]),
      [["App", 9, "Deploy fix"]],
    );
    assert.equal(typeof snapshot.awsStatus.configured, "boolean");
    assert.equal(JSON.stringify(snapshot).includes("github-token"), false);
  });
});
