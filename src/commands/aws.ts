import { Command } from "commander";

import { awsCredentialStatus } from "../clients/aws.ts";
import { bold, dim } from "../format.ts";
import { runCommand } from "./command-utils.ts";

export function register(program: Command): void {
  const cmd = program
    .command("aws")
    .description("AWS local credential checks");

  cmd
    .command("status")
    .description("Show local AWS credential status")
    .option("--json", "Output as JSON", false)
    .action((opts: { json: boolean }) => {
      return runCommand("aws status", () => {
        const status = awsCredentialStatus();
        if (opts.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        console.log(bold("AWS Credential Status"));
        console.log(`  ${status.configured ? "✓" : "✗"} ${status.configured ? "configured" : "not configured"}`);
        console.log(`  Profile: ${status.profile ?? "(invalid)"}`);
        console.log(`  Sources: ${status.sources.length > 0 ? status.sources.join(", ") : "(none)"}`);
        if (status.errors.length > 0) {
          console.log(dim("  Configuration errors:"));
          for (const error of status.errors) {
            console.log(dim(`    ${error}`));
          }
        }
      });
    });
}
