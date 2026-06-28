import { Command } from "commander";

import * as github from "../clients/github.ts";
import {
  addProject,
  buildIssueActionContext,
  listProjects,
  removeProject,
  resolveProject,
  updateProjectGitHubRepository,
} from "../projects.ts";
import { bold, dim, relativeTime, responsiveTable } from "../format.ts";
import { parseLimit, runCommand } from "./command-utils.ts";

function printProjects(): void {
  const projects = listProjects();
  if (projects.length === 0) {
    console.log("No local projects configured.");
    return;
  }

  console.log(`${bold("Local Projects")} ${dim(`(${projects.length} configured)\n`)}`);
  console.log(
    responsiveTable(
      projects.map((project) => [
        project.name,
        project.root,
        project.githubRepository ?? "(not linked)",
      ]),
      { headers: ["Name", "Root", "GitHub repo"] },
    ),
  );
}

function requireProjectGitHubRepository(projectName: string): string {
  const project = resolveProject(projectName);
  if (!project) {
    throw new Error(`Project ${projectName} is not configured.`);
  }
  if (!project.githubRepository) {
    throw new Error(`Project ${project.name} is not associated with a GitHub repository.`);
  }

  return project.githubRepository;
}

export function register(program: Command): void {
  const cmd = program
    .command("projects")
    .description("Manage local projects and project-scoped GitHub issue context");

  cmd
    .command("add")
    .description("Add or replace a named local project")
    .argument("<name>", "Project display name")
    .argument("<root>", "Local Git repository root")
    .option("--github-repo <owner/repo>", "Associated GitHub repository")
    .action((name: string, root: string, opts: { githubRepo?: string }) => {
      return runCommand("projects add", () => {
        const project = addProject({
          name,
          root,
          githubRepository: opts.githubRepo ?? null,
        });
        console.log(`✓ Project saved: ${project.name}`);
        console.log(dim(`  Root: ${project.root}`));
        console.log(dim(`  GitHub repo: ${project.githubRepository ?? "(not linked)"}`));
      });
    });

  cmd
    .command("remove")
    .description("Remove a configured local project")
    .argument("<name>", "Project display name")
    .action((name: string) => {
      return runCommand("projects remove", () => {
        const removed = removeProject(name);
        console.log(removed ? `✓ Project removed: ${name}` : `Project not configured: ${name}`);
      });
    });

  cmd
    .command("link-github")
    .description("Associate a local project with a GitHub repository")
    .argument("<name>", "Project display name")
    .argument("<owner/repo>", "GitHub repository full name")
    .action((name: string, repositoryFullName: string) => {
      return runCommand("projects link-github", () => {
        const project = updateProjectGitHubRepository(name, repositoryFullName);
        console.log(`✓ Project linked: ${project.name} -> ${project.githubRepository}`);
      });
    });

  cmd
    .command("list")
    .description("List configured local projects")
    .option("--json", "Output as JSON", false)
    .action((opts: { json: boolean }) => {
      return runCommand("projects list", () => {
        const projects = listProjects();
        if (opts.json) {
          console.log(JSON.stringify(projects, null, 2));
          return;
        }

        printProjects();
      });
    });

  cmd
    .command("issues")
    .description("List GitHub issues for a configured local project")
    .argument("<name>", "Project display name")
    .option("--limit <n>", "Maximum issues to fetch", "25")
    .option("--json", "Output as JSON", false)
    .action((name: string, opts: { limit: string; json: boolean }) => {
      return runCommand("projects issues", async () => {
        const repositoryFullName = requireProjectGitHubRepository(name);
        const issues = await github.listRepositoryIssues(repositoryFullName, {
          limit: parseLimit(opts.limit, "--limit", 25),
        });

        if (opts.json) {
          console.log(JSON.stringify(issues, null, 2));
          return;
        }

        if (issues.length === 0) {
          console.log("No open GitHub issues.");
          return;
        }

        console.log(`${bold("GitHub Issues")} ${dim(`(${issues.length} open)\n`)}`);
        console.log(
          responsiveTable(
            issues.map((issue) => [
              issue.url,
              `#${issue.number}`,
              issue.title,
              issue.labels.join(", ") || "(none)",
              relativeTime(issue.updatedAt),
            ]),
            { headers: ["Link", "Issue", "Title", "Labels", "Updated"] },
          ),
        );
      });
    });

  cmd
    .command("issue-context")
    .description("Emit project and GitHub issue context for Codex input")
    .argument("<name>", "Project display name")
    .argument("<issue-number>", "GitHub issue number")
    .option("--json", "Output as JSON", false)
    .action((name: string, issueNumberText: string, opts: { json: boolean }) => {
      return runCommand("projects issue-context", async () => {
        const repositoryFullName = requireProjectGitHubRepository(name);
        const issueNumber = parseLimit(issueNumberText, "<issue-number>", 1);
        const issue = await github.getRepositoryIssue(repositoryFullName, issueNumber);
        const context = buildIssueActionContext(name, issue);

        if (opts.json) {
          console.log(JSON.stringify(context, null, 2));
          return;
        }

        console.log(context.codexPrompt);
      });
    });
}
