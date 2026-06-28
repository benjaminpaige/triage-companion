import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listRepositoryIssues } from "./github-issues.ts";
import { resetCache } from "../credential-store.ts";

let originalConfigDir: string | undefined;
let originalGitHubToken: string | undefined;
let originalFetch: typeof global.fetch;
let testDir = "";

beforeEach(() => {
  originalConfigDir = process.env.TRIAGE_COMPANION_CONFIG_DIR;
  originalGitHubToken = process.env.GITHUB_TOKEN;
  originalFetch = global.fetch;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-github-issues-"));
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

describe("GitHub repository issues client", () => {
  test("lists open repository issues and filters pull requests", async () => {
    const seenURLs: string[] = [];
    global.fetch = async (input: URL | Request | string) => {
      const url = typeof input === "string" ? input : input.toString();
      seenURLs.push(url);
      assert.match(url, /^https:\/\/api\.github\.com\/repos\/octocat\/hello-world\/issues\?/);
      assert.match(url, /state=open/);
      assert.match(url, /per_page=25/);
      return new Response(JSON.stringify([
        {
          number: 1,
          title: "Real issue",
          body: "Needs work",
          html_url: "https://github.com/octocat/hello-world/issues/1",
          user: { login: "octocat" },
          labels: [{ name: "bug" }],
          updated_at: "2026-06-28T12:00:00Z",
        },
        {
          number: 2,
          title: "Pull request",
          html_url: "https://github.com/octocat/hello-world/pull/2",
          pull_request: {},
          user: { login: "octocat" },
          labels: [],
          updated_at: "2026-06-28T13:00:00Z",
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const issues = await listRepositoryIssues("octocat/hello-world", { limit: 25 });

    assert.equal(seenURLs.length, 1);
    assert.deepEqual(issues, [
      {
        number: 1,
        title: "Real issue",
        body: "Needs work",
        url: "https://github.com/octocat/hello-world/issues/1",
        author: "octocat",
        labels: ["bug"],
        updatedAt: new Date("2026-06-28T12:00:00Z"),
      },
    ]);
  });

  test("rejects malformed issue payloads instead of returning partial context", async () => {
    global.fetch = async () => new Response(JSON.stringify([
      {
        number: 1,
        title: "Bad issue",
        html_url: "https://github.com/octocat/hello-world/issues/1",
        labels: [{ name: "ok" }, { bad: true }],
        updated_at: "2026-06-28T12:00:00Z",
      },
    ]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await assert.rejects(
      () => listRepositoryIssues("octocat/hello-world"),
      /must contain label objects with valid names/,
    );
  });
});
