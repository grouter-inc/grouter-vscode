import { spawn } from "node:child_process";
import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";
import { truncateText } from "../../context/budget";

export const runCommandTool: ToolSpec<{ command: string; cwd?: string; timeoutSeconds?: number }> = {
  id: "run_command",
  displayName: "Run Command",
  description:
    "Run a shell command in a terminal and capture its output. Use for builds, tests, and CLI tools. Avoid long-running processes (dev servers).",
  userDescription: "Run a terminal command",
  readOnly: false,
  schema: z.object({
    command: z.string().describe("The exact shell command to run"),
    cwd: z.string().optional().describe("Working directory (default: workspace root)"),
    timeoutSeconds: z.number().int().min(5).max(300).optional().describe("Timeout (default 120)"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    const timeoutMs = (input.timeoutSeconds ?? 120) * 1000;
    const cwd = input.cwd ?? ctx.workspaceRoot;

    return new Promise((resolve) => {
      const child = spawn(input.command, {
        cwd,
        shell: true,
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        resolve(
          fail(
            `Command timed out after ${timeoutMs / 1000}s.\nPartial output:\n${truncateOutput(stdout, stderr)}`,
          ),
        );
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (stdout.length > 400_000) child.kill();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fail(`Failed to run command: ${String(err)}`));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const body = truncateOutput(stdout, stderr);
        if (code === 0) {
          resolve(ok(`Command exited 0.\n${body}`));
        } else {
          resolve(fail(`Command exited ${code}.\n${body}`));
        }
      });
    });
  },
};

function truncateOutput(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(`stdout:\n${truncateText(stdout, 60_000)}`);
  if (stderr.trim()) parts.push(`stderr:\n${truncateText(stderr, 20_000)}`);
  return parts.join("\n\n") || "(no output)";
}
