import { execFile } from "node:child_process";
import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";
import { truncateText } from "../../context/budget";

function run(args: string[], cwd: string, timeoutMs = 15000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error && "code" in error ? Number((error as { code?: number }).code ?? 1) : 0;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      },
    );
  });
}

export const gitStatusTool: ToolSpec<Record<string, never>> = {
  id: "git_status",
  displayName: "Git Status",
  description: "Show the working tree status (branch and changed files) as porcelain output.",
  userDescription: "Show git status",
  readOnly: true,
  schema: z.object({}),
  async execute(_input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    const result = await run(["status", "--porcelain=v1", "--branch"], ctx.workspaceRoot);
    if (result.code !== 0 && !result.stdout) {
      return fail(`git status failed: ${result.stderr || "not a git repository"}`);
    }
    return ok(truncateText(result.stdout || "(clean)", 20_000));
  },
};

export const gitDiffTool: ToolSpec<{ staged?: boolean; path?: string }> = {
  id: "git_diff",
  displayName: "Git Diff",
  description: "Show unstaged (or staged) changes as a unified diff.",
  userDescription: "Show git diff",
  readOnly: true,
  schema: z.object({
    staged: z.boolean().optional().describe("Show staged changes (default false)"),
    path: z.string().optional().describe("Limit diff to this path"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    const args = ["diff", "--no-color"];
    if (input.staged) args.push("--staged");
    if (input.path) args.push("--", input.path);
    const result = await run(args, ctx.workspaceRoot);
    if (result.code !== 0) return fail(`git diff failed: ${result.stderr || "unknown error"}`);
    return ok(truncateText(result.stdout || "(no changes)", 40_000));
  },
};
