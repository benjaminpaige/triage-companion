import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

import { register } from "./projects.ts";
import { findCommand, optionLongNames, runRegisteredCommand } from "./test-support.test.ts";
import { resetCache } from "../credential-store.ts";

let originalConfigDir: string | undefined;
let originalGitHubToken: string | undefined;
let originalFetch: typeof global.fetch;
let testDir = "";
let repoRoot = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalGitHubToken = process.env.GITHUB_TOKEN;
  originalFetch = global.fetch;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-project-command-"));
  repoRoot = path.join(testDir, "repo");
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
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

describe("projects command", () => {
  test("registers project settings and issue commands", () => {
    const program = new Command();
    register(program);

    const projects = findCommand(program, "projects");
    findCommand(projects, "add");
    findCommand(projects, "remove");
    findCommand(projects, "link-github");
    assert.deepEqual(optionLongNames(findCommand(projects, "list")), ["--json"]);
    assert.deepEqual(optionLongNames(findCommand(projects, "issues")), ["--limit", "--json"]);
    assert.deepEqual(optionLongNames(findCommand(projects, "issue-context")), ["--json"]);
  });

  test("adds and lists projects as JSON for a settings UI", async () => {
    await runRegisteredCommand(register, [
      "projects",
      "add",
      "App",
      repoRoot,
      "--github-repo",
      "octocat/hello-world",
    ]);

    const output = await runRegisteredCommand(register, ["projects", "list", "--json"]);
    const projects = JSON.parse(output) as Array<{ name: string; root: string; githubRepository: string }>;

    assert.deepEqual(projects, [
      {
        name: "App",
        root: repoRoot,
        githubRepository: "octocat/hello-world",
      },
    ]);
  });

  test("lists GitHub issues for an associated local project", async () => {
    await runRegisteredCommand(register, [
      "projects",
      "add",
      "App",
      repoRoot,
      "--github-repo",
      "octocat/hello-world",
    ]);
    global.fetch = async () => new Response(JSON.stringify([
      {
        number: 7,
        title: "Fix CI",
        body: "Actions are red.",
        html_url: "https://github.com/octocat/hello-world/issues/7",
        user: { login: "octocat" },
        labels: [{ name: "ci" }],
        updated_at: "2026-06-28T12:00:00Z",
      },
    ]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const output = await runRegisteredCommand(register, [
      "projects",
      "issues",
      "App",
      "--json",
    ]);
    const issues = JSON.parse(output) as Array<{ number: number; title: string }>;

    assert.deepEqual(issues.map((issue) => [issue.number, issue.title]), [[7, "Fix CI"]]);
  });
});
