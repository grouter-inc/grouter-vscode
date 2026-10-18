import { spawn } from "node:child_process";
import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";
import { truncateText } from "../../context/budget";

export interface TestSummary {
  framework: string;
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
  raw: string;
}

export const runTestsTool: TestSpec = {
  id: "run_tests",
  displayName: "Run Tests",
  description:
    "Run the project's test command (auto-detected from package.json or overridable) and return a parsed summary with failure details. Use to verify changes or reproduce reported failures.",
  userDescription: "Run the project test suite",
  readOnly: false,
  schema: z.object({
    command: z
      .string()
      .optional()
      .describe("Override test command (default: auto-detect npm test / pytest / cargo test)"),
    filter: z.string().optional().describe("Test name filter (passed to the runner when supported)"),
    timeoutSeconds: z.number().int().min(10).max(600).optional().describe("Timeout (default 300)"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder open.");

    const command = input.command ?? (await detectTestCommand(ctx.workspaceRoot));
    if (!command) {
      return fail("Could not detect a test command. Pass one explicitly, e.g. command: \"npm test\".");
    }

    const fullCommand = input.filter ? `${command} ${shellQuote(input.filter)}` : command;
    const timeoutMs = (input.timeoutSeconds ?? 300) * 1000;

    const started = Date.now();
    const outcome = await execCapture(fullCommand, ctx.workspaceRoot, timeoutMs);
    const durationMs = Date.now() - started;

    if (outcome.timedOut) {
      return fail(
        `Tests timed out after ${timeoutMs / 1000}s.\n\nPartial output:\n${truncateText(outcome.output, 20_000)}`,
      );
    }

    const summary = parseTestOutput(outcome.output);
    const header = [
      `# Test run: \`${fullCommand}\` (exit ${outcome.code}, ${(durationMs / 1000).toFixed(1)}s)`,
      summary.framework ? `Framework detected: ${summary.framework}` : "",
      summary.passed + summary.failed + summary.skipped > 0
        ? `Results: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const failureSection =
      summary.failures.length > 0
        ? `\n\n## Failures\n${summary.failures.map((f) => `- ${f}`).join("\n")}`
        : "";

    const body = `${header}${failureSection}\n\n## Output\n\`\`\`\n${truncateText(outcome.output, 30_000)}\n\`\`\``;

    return outcome.code === 0 ? ok(body) : fail(body);
  },
};

type TestSpec = ToolSpec<{ command?: string; filter?: string; timeoutSeconds?: number }>;

async function detectTestCommand(workspaceRoot: string): Promise<string | undefined> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  try {
    const pkgRaw = await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
    if (pkg.scripts?.test) return "npm test";
  } catch {
    // no package.json
  }
  try {
    await fs.access(path.join(workspaceRoot, "pytest.ini"));
    return "pytest";
  } catch {
    // not pytest by config
  }
  try {
    await fs.access(path.join(workspaceRoot, "Cargo.toml"));
    return "cargo test";
  } catch {
    // not cargo
  }
  try {
    await fs.access(path.join(workspaceRoot, "go.mod"));
    return "go test ./...";
  } catch {
    // not go
  }
  return undefined;
}

function shellQuote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

interface ExecOutcome {
  code: number;
  output: string;
  timedOut: boolean;
}

function execCapture(command: string, cwd: string, timeoutMs: number): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 800_000) child.kill();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}\n${String(err)}`, timedOut });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, output, timedOut });
    });
  });
}

export function parseTestOutput(output: string): TestSummary {
  const summary: TestSummary = { framework: "", passed: 0, failed: 0, skipped: 0, failures: [], raw: output };

  const vitest = output.match(/Tests\s+(\d+) failed \| (\d+) passed(?:\s*\| (\d+) skipped)?/);
  if (vitest) {
    summary.framework = "vitest/jest";
    summary.failed = Number(vitest[1]);
    summary.passed = Number(vitest[2]);
    summary.skipped = Number(vitest[3] ?? 0);
  } else {
    const vitestAll = output.match(/Tests\s+(\d+) passed(?:\s*\| (\d+) skipped)?/);
    if (vitestAll) {
      summary.framework = "vitest/jest";
      summary.passed = Number(vitestAll[1]);
      summary.skipped = Number(vitestAll[2] ?? 0);
    }
  }

  if (!summary.framework) {
    const mocha = output.match(/(\d+) passing/);
    if (mocha) {
      summary.framework = "mocha";
      summary.passed = Number(mocha[1]);
      const failing = output.match(/(\d+) failing/);
      if (failing) summary.failed = Number(failing[1]);
      const pending = output.match(/(\d+) pending/);
      if (pending) summary.skipped = Number(pending[1]);
    }
  }

  if (!summary.framework) {
    const cargo = output.match(/test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored/);
    if (cargo) {
      summary.framework = "cargo";
      summary.passed = Number(cargo[2]);
      summary.failed = Number(cargo[3]);
      summary.skipped = Number(cargo[4]);
    }
  }

  if (!summary.framework) {
    const pytest = output.match(/(\d+) passed(?:, (\d+) failed)?(?:, (\d+) skipped)?/);
    if (pytest && /test session starts|=====.*(PASSED|FAILED)/.test(output)) {
      summary.framework = "pytest";
      summary.passed = Number(pytest[1]);
      summary.failed = Number(pytest[2] ?? 0);
      summary.skipped = Number(pytest[3] ?? 0);
    }
  }

  const failLines = output.match(/^\s*(?:×|✗|FAIL|not ok|FAILED)\s+.+$/gm);
  if (failLines) {
    summary.failures = failLines.slice(0, 25).map((l) => l.trim());
  }

  return summary;
}
