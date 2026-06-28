import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_ENABLED_TOOLS,
  listToolDefinitions,
  readEnabledTools,
  saveEnabledTools,
  toolAccessSnapshot,
} from "./tools.ts";
import { resetCache } from "./credential-store.ts";

let originalConfigDir: string | undefined;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-tools-"));
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

describe("tool access settings", () => {
  test("defaults to all supported tools for backwards-compatible snapshots", () => {
    assert.deepEqual(readEnabledTools(), DEFAULT_ENABLED_TOOLS);
    assert.deepEqual(
      toolAccessSnapshot().filter((tool) => tool.enabled).map((tool) => tool.id),
      DEFAULT_ENABLED_TOOLS,
    );
  });

  test("persists a narrowed tool set for settings UI toggles", () => {
    const saved = saveEnabledTools([
      "github-issues",
      "local-projects",
      "github-actions",
      "aws",
    ]);

    assert.deepEqual(saved, [
      "github-issues",
      "local-projects",
      "github-actions",
      "aws",
    ]);
    assert.deepEqual(readEnabledTools(), saved);

    const snapshot = toolAccessSnapshot();
    assert.equal(snapshot.find((tool) => tool.id === "github-issues")?.enabled, true);
    assert.equal(snapshot.find((tool) => tool.id === "jira")?.enabled, false);
    assert.equal(snapshot.find((tool) => tool.id === "snyk")?.enabled, false);
  });

  test("rejects duplicate and unknown tool ids", () => {
    assert.throws(
      () => saveEnabledTools(["github-issues", "github-issues"]),
      /Enabled tools must not contain duplicate ids/,
    );
    assert.throws(
      () => saveEnabledTools(["github-issues", "unknown-tool"]),
      /Unknown tool id unknown-tool/,
    );
  });

  test("documents user-facing setup requirements for GitHub and AWS tools", () => {
    const definitions = listToolDefinitions();
    const githubIssues = definitions.find((tool) => tool.id === "github-issues");
    const githubActions = definitions.find((tool) => tool.id === "github-actions");
    const aws = definitions.find((tool) => tool.id === "aws");

    assert.ok(githubIssues?.requirements.some((item) => /Issues: read/.test(item)));
    assert.ok(githubActions?.requirements.some((item) => /Actions: read/.test(item)));
    assert.ok(aws?.requirements.some((item) => /aws sts get-caller-identity/.test(item)));
  });
});
