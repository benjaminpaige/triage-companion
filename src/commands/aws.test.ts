import assert from "node:assert/strict";
import { describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";

import { register } from "./aws.ts";
import { findCommand, optionLongNames, runRegisteredCommand } from "./test-support.test.ts";

describe("aws command", () => {
  test("registers AWS status command for settings checks", () => {
    const program = new Command();
    register(program);

    const aws = findCommand(program, "aws");
    const status = findCommand(aws, "status");
    assert.deepEqual(optionLongNames(status), ["--json"]);
  });

  test("prints JSON credential status without secrets", async () => {
    const originalHome = process.env.HOME;
    const originalAWSAccessKeyID = process.env.AWS_ACCESS_KEY_ID;
    const originalAWSSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const originalAWSProfile = process.env.AWS_PROFILE;
    const originalAWSSharedCredentialsFile = process.env.AWS_SHARED_CREDENTIALS_FILE;
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-aws-command-"));
    process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "super-secret";
    process.env.HOME = testDir;
    delete process.env.AWS_PROFILE;
    delete process.env.AWS_SHARED_CREDENTIALS_FILE;

    try {
      const output = await runRegisteredCommand(register, ["aws", "status", "--json"]);
      const status = JSON.parse(output) as { configured: boolean; sources: string[] };

      assert.equal(status.configured, true);
      assert.deepEqual(status.sources, ["environment"]);
      assert.equal(output.includes("super-secret"), false);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalAWSAccessKeyID === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = originalAWSAccessKeyID;
      }
      if (originalAWSSecretAccessKey === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = originalAWSSecretAccessKey;
      }
      if (originalAWSProfile === undefined) {
        delete process.env.AWS_PROFILE;
      } else {
        process.env.AWS_PROFILE = originalAWSProfile;
      }
      if (originalAWSSharedCredentialsFile === undefined) {
        delete process.env.AWS_SHARED_CREDENTIALS_FILE;
      } else {
        process.env.AWS_SHARED_CREDENTIALS_FILE = originalAWSSharedCredentialsFile;
      }
    }
  });
});
