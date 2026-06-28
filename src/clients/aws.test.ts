import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { awsCredentialStatus } from "./aws.ts";

let originalHome: string | undefined;
let originalAWSAccessKeyID: string | undefined;
let originalAWSSecretAccessKey: string | undefined;
let originalAWSProfile: string | undefined;
let originalAWSSharedCredentialsFile: string | undefined;
let testDir = "";

beforeEach(() => {
  originalHome = process.env.HOME;
  originalAWSAccessKeyID = process.env.AWS_ACCESS_KEY_ID;
  originalAWSSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  originalAWSProfile = process.env.AWS_PROFILE;
  originalAWSSharedCredentialsFile = process.env.AWS_SHARED_CREDENTIALS_FILE;
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), "triage-aws-"));
  process.env.HOME = testDir;
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  delete process.env.AWS_PROFILE;
  delete process.env.AWS_SHARED_CREDENTIALS_FILE;
});

afterEach(() => {
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
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe("AWS credential status", () => {
  test("detects environment credential variables without returning secret values", () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLE";
    process.env.AWS_SECRET_ACCESS_KEY = "super-secret";

    const status = awsCredentialStatus();

    assert.equal(status.configured, true);
    assert.deepEqual(status.sources, ["environment"]);
    assert.equal(JSON.stringify(status).includes("super-secret"), false);
  });

  test("detects shared credentials files and selected profiles", () => {
    const awsDir = path.join(testDir, ".aws");
    fs.mkdirSync(awsDir);
    fs.writeFileSync(
      path.join(awsDir, "credentials"),
      "[default]\naws_access_key_id=AKIADEFAULT\naws_secret_access_key=secret\n[deploy]\naws_access_key_id=AKIADEPLOY\naws_secret_access_key=secret\n",
    );
    process.env.AWS_PROFILE = "deploy";

    const status = awsCredentialStatus();

    assert.equal(status.configured, true);
    assert.deepEqual(status.sources, ["shared-credentials-file"]);
    assert.equal(status.profile, "deploy");
  });

  test("reports missing credentials without throwing", () => {
    const status = awsCredentialStatus();

    assert.equal(status.configured, false);
    assert.deepEqual(status.sources, []);
    assert.match(status.errors.join("\n"), /No AWS credentials found/);
  });
});
