import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  addProject,
  buildIssueActionContext,
  listProjects,
  removeProject,
  resolveProject,
  updateProjectGitHubRepository,
} from "./projects.ts";
import { resetCache } from "./credential-store.ts";

let originalConfigDir: string | undefined;
let testDir = "";
let repoRoot = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-projects-"));
  repoRoot = path.join(testDir, "repo");
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
  process.env.TRIAGE_COMPANION_CONFIG_DIR = testDir;
  resetCache();
});

afterEach(() => {
  resetCache();
  if (originalConfigDir === undefined) {
    delete process.env.TRIAGE_COMPANION_CONFIG_DIR;
  } else {
    process.env.TRIAGE_COMPANION_CONFIG_DIR = originalConfigDir;
  }
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("local project settings", () => {
  test("adds named local projects with optional GitHub repository association", () => {
    const project = addProject({
      name: "Storybooks",
      root: repoRoot,
      githubRepository: "ben/storybooks",
    });

    assert.equal(project.name, "Storybooks");
    assert.equal(project.root, repoRoot);
    assert.equal(project.githubRepository, "ben/storybooks");
    assert.deepEqual(listProjects(), [project]);
  });

  test("updates and removes project GitHub repository associations", () => {
    addProject({ name: "App", root: repoRoot });

    const linked = updateProjectGitHubRepository("App", "octocat/hello-world");
    assert.equal(linked.githubRepository, "octocat/hello-world");
    assert.equal(resolveProject("app")?.githubRepository, "octocat/hello-world");

    removeProject("APP");
    assert.deepEqual(listProjects(), []);
  });

  test("rejects unsafe project names, non-repo roots, and invalid GitHub repositories", () => {
    const notARepo = path.join(testDir, "not-a-repo");
    fs.mkdirSync(notARepo);

    assert.throws(
      () => addProject({ name: " bad ", root: repoRoot }),
      /Project name must not include surrounding whitespace/,
    );
    assert.throws(
      () => addProject({ name: "App", root: notARepo }),
      /Project root must be a Git repository/,
    );
    assert.throws(
      () => addProject({ name: "App", root: repoRoot, githubRepository: "bad/repo/path" }),
      /GitHub repository must be in owner\/repo form/,
    );
  });

  test("builds issue action context for Codex input without secret values", () => {
    addProject({
      name: "App",
      root: repoRoot,
      githubRepository: "octocat/hello-world",
    });

    const context = buildIssueActionContext("App", {
      number: 42,
      title: "Fix deploy",
      body: "The AWS deploy is failing.",
      url: "https://github.com/octocat/hello-world/issues/42",
      author: "octocat",
      labels: ["bug"],
      updatedAt: new Date("2026-06-28T12:00:00Z"),
    });

    assert.equal(context.project.name, "App");
    assert.equal(context.project.root, repoRoot);
    assert.equal(context.githubRepository, "octocat/hello-world");
    assert.equal(context.issue.number, 42);
    assert.match(context.codexPrompt, /Work in local project/);
    assert.match(context.codexPrompt, /Issue #42: Fix deploy/);
    assert.doesNotMatch(JSON.stringify(context), /token|secret|password/i);
  });
});
