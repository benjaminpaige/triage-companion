import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AWSCredentialStatus {
  configured: boolean;
  sources: string[];
  profile: string | null;
  errors: string[];
}

function trimToValue(value: string | undefined | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSafeText(value: string): boolean {
  return value.trim() === value && !/[\u0000-\u001F\u007F-\u009F]/.test(value);
}

function safeProfile(): { profile: string | null; error: string | null } {
  const raw = trimToValue(process.env.AWS_PROFILE);
  if (raw === null) {
    return { profile: "default", error: null };
  }
  if (!isSafeText(raw)) {
    return {
      profile: null,
      error: "AWS_PROFILE must not include surrounding whitespace or control characters.",
    };
  }

  return { profile: raw, error: null };
}

function credentialFilePath(): string {
  const override = trimToValue(process.env.AWS_SHARED_CREDENTIALS_FILE);
  if (override !== null) {
    return override;
  }

  return path.join(os.homedir(), ".aws", "credentials");
}

function parseIniSections(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      current = new Map<string, string>();
      sections.set(sectionMatch[1] ?? "", current);
      continue;
    }
    const equalsIndex = line.indexOf("=");
    if (equalsIndex > 0 && current) {
      const key = line.slice(0, equalsIndex).trim();
      const value = line.slice(equalsIndex + 1).trim();
      current.set(key, value);
    }
  }

  return sections;
}

function sharedCredentialsFileHasProfile(profile: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(credentialFilePath(), "utf-8");
  } catch {
    return false;
  }

  const section = parseIniSections(text).get(profile);
  return Boolean(
    section?.get("aws_access_key_id") &&
    section.get("aws_secret_access_key"),
  );
}

function sharedConfigFileHasProfile(profile: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(path.join(os.homedir(), ".aws", "config"), "utf-8");
  } catch {
    return false;
  }

  const sectionName = profile === "default" ? "default" : `profile ${profile}`;
  const section = parseIniSections(text).get(sectionName);
  return Boolean(
    section?.get("credential_process") ||
    section?.get("sso_start_url") ||
    section?.get("sso_session") ||
    section?.get("role_arn"),
  );
}

export function awsCredentialStatus(): AWSCredentialStatus {
  const errors: string[] = [];
  const sources: string[] = [];
  const accessKey = trimToValue(process.env.AWS_ACCESS_KEY_ID);
  const secretKey = trimToValue(process.env.AWS_SECRET_ACCESS_KEY);
  const { profile, error } = safeProfile();
  if (error) {
    errors.push(error);
  }

  if (accessKey !== null || secretKey !== null) {
    if (accessKey !== null && secretKey !== null) {
      sources.push("environment");
    } else {
      errors.push("AWS environment credentials require both AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.");
    }
  }

  if (profile !== null && sharedCredentialsFileHasProfile(profile)) {
    sources.push("shared-credentials-file");
  }
  if (profile !== null && sharedConfigFileHasProfile(profile)) {
    sources.push("shared-config-file");
  }

  if (sources.length === 0 && errors.length === 0) {
    errors.push("No AWS credentials found in environment variables or AWS shared credentials/config files.");
  }

  return {
    configured: sources.length > 0 && errors.length === 0,
    sources,
    profile,
    errors,
  };
}
