import { Command } from "commander";

import { register as registerGitHub } from "./github.ts";
import { register as registerSnyk } from "./snyk.ts";
import { register as registerJira } from "./jira.ts";
import { register as registerGit } from "./git.ts";
import { register as registerStatus } from "./status.ts";
import { register as registerConfig } from "./config.ts";
import { register as registerSnapshot } from "./snapshot.ts";
import { register as registerProjects } from "./projects.ts";
import { register as registerAWS } from "./aws.ts";

export function registerCommands(program: Command): void {
  registerGitHub(program);
  registerSnyk(program);
  registerJira(program);
  registerGit(program);
  registerProjects(program);
  registerAWS(program);
  registerStatus(program);
  registerConfig(program);
  registerSnapshot(program);
}
