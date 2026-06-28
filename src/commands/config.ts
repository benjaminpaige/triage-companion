import { Command } from "commander";

import { buildConfigurationSummary } from "../config-summary.ts";
import {
  clearSearchRoots,
  parseSearchRootsInput,
  resolveSearchRoots,
  saveSearchRoots,
  searchRootsEnvOverrideState,
} from "../config.ts";
import {
  listToolDefinitions,
  parseEnabledToolsInput,
  readEnabledTools,
  resetEnabledTools,
  saveEnabledTools,
} from "../tools.ts";
import { ENV } from "../config-model.ts";
import { runCommand } from "./command-utils.ts";

function parseSearchRootsArgument(value: string): string[] {
  if (value.trim().length === 0) {
    throw new Error("Git search roots must be a JSON array of non-empty strings.");
  }
  if (value.trim() !== value) {
    throw new Error("Git search roots must not include surrounding whitespace.");
  }

  return parseSearchRootsInput(value);
}

export function register(program: Command): void {
  const cmd = program.command("config").description("Configuration management");

  const printSearchRootsOverrideMessage = (): boolean => {
    const state = searchRootsEnvOverrideState();
    if (state === "missing") {
      return false;
    }

    if (state === "invalid") {
      console.log(
        `  ${ENV.GIT_SEARCH_ROOTS} is still set but invalid, so Git repository discovery will fail until it is fixed or unset.`,
      );
      return true;
    }

    console.log(`  ${ENV.GIT_SEARCH_ROOTS} still overrides the saved roots when set.`);
    return true;
  };

  const printSearchRootsResetOverrideMessage = (): boolean => {
    const state = searchRootsEnvOverrideState();
    if (state === "missing") {
      return false;
    }

    if (state === "invalid") {
      console.log(
        `  ${ENV.GIT_SEARCH_ROOTS} is still set but invalid, so Git repository discovery will fail until it is fixed or unset.`,
      );
      return true;
    }

    console.log(`  ${ENV.GIT_SEARCH_ROOTS} still overrides the defaults when set.`);
    return true;
  };

  cmd
    .command("show")
    .description("Show configured values without exposing secrets")
    .action(() => {
      return runCommand("config show", () => {
        process.stdout.write(buildConfigurationSummary());
      });
    });

  cmd
    .command("enabled-tools")
    .description("Save enabled tool ids for settings/sidebar filtering")
    .argument("<tools-json>", "Enabled tool ids as a JSON array")
    .action((tools: string) => {
      return runCommand("config enabled-tools", () => {
        const enabledTools = parseEnabledToolsInput(tools);
        const savedTools = saveEnabledTools(enabledTools);
        console.log(
          `✓ Enabled tools saved: ${savedTools.length > 0 ? savedTools.join(", ") : "(none)"}`,
        );
      });
    });

  cmd
    .command("reset-enabled-tools")
    .description("Reset enabled tools to all supported tools")
    .action(() => {
      return runCommand("config reset-enabled-tools", () => {
        resetEnabledTools();
        console.log("✓ Enabled tools reset to all supported tools.");
      });
    });

  cmd
    .command("tools")
    .description("List supported tools and enabled state")
    .option("--json", "Output as JSON", false)
    .action((opts: { json: boolean }) => {
      return runCommand("config tools", () => {
        const enabled = new Set(readEnabledTools());
        const tools = listToolDefinitions().map((tool) => ({
          ...tool,
          enabled: enabled.has(tool.id),
        }));

        if (opts.json) {
          console.log(JSON.stringify(tools, null, 2));
          return;
        }

        for (const tool of tools) {
          console.log(`${tool.enabled ? "✓" : "✗"} ${tool.id} - ${tool.name}`);
        }
      });
    });

  cmd
    .command("git-search-roots")
    .description("Save Git repository search roots")
    .argument(
      "<paths-json>",
      "Search roots as a JSON array of paths",
    )
    .action((paths: string) => {
      return runCommand("config git-search-roots", () => {
        const roots = parseSearchRootsArgument(paths);
        const savedRoots = saveSearchRoots(roots);
        if (roots.length === 0) {
          if (searchRootsEnvOverrideState() !== "missing") {
            console.log("✓ Stored Git search roots cleared.");
            printSearchRootsResetOverrideMessage();
            return;
          }

          console.log("✓ Git search roots reset to defaults.");
          return;
        }

        console.log(`✓ Git search roots saved: ${savedRoots.join(", ")}`);
        const effectiveRoots = resolveSearchRoots(JSON.stringify(savedRoots));
        if (effectiveRoots.length !== roots.length) {
          if (effectiveRoots.length === 0) {
            console.log("  None of the saved roots currently exist as directories, so Git repository discovery will return no repositories.");
          } else {
            console.log("  Some saved roots do not currently exist as directories and will be ignored.");
          }
        }
        printSearchRootsOverrideMessage();
      });
    });

  cmd
    .command("reset-git-search-roots")
    .description("Reset Git repository search roots to defaults")
    .action(() => {
      return runCommand("config reset-git-search-roots", () => {
        clearSearchRoots();
        if (searchRootsEnvOverrideState() !== "missing") {
          console.log("✓ Stored Git search roots cleared.");
          printSearchRootsResetOverrideMessage();
          return;
        }

        console.log("✓ Git search roots reset to defaults.");
      });
    });
}
