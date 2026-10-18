/**
 * Guards the `verify_work` tool — the 26th tool, and the only one that shipped
 * with zero tests.
 *
 * WHY this file exists: the audit found that `verifyWorkTool` was registered in
 * the registry and advertised to the model, but nothing exercised `execute()`.
 * A broken tool would therefore look identical to a working one in CI: the
 * registry test only proves the id is present.
 *
 * These tests drive `execute()` directly against real throwaway projects, so a
 * green run means the tool genuinely spawns commands and reports exit codes —
 * not that a mock agreed with itself.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { verifyWorkTool } from "../../src/tools/builtin/verifyTools";
import type { ToolContext } from "../../src/tools/spec";

const roots: string[] = [];

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-verify-tool-"));
  roots.push(dir);
  for (const [name, body] of Object.entries(files)) {
    const target = path.join(dir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return dir;
}

/** Minimal ToolContext — verify_work never approves anything, so approve is a stub. */
function ctxFor(workspaceRoot: string | undefined): ToolContext {
  return {
    workspaceRoot,
    token: { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never,
    approve: async () => "allow",
    log: () => {},
  };
}

function pkg(scripts: Record<string, string>): string {
  return JSON.stringify({ name: "fixture", version: "1.0.0", scripts }, null, 2);
}

afterAll(() => {
  for (const dir of roots) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows can keep a handle briefly; the temp dir is disposable.
    }
  }
});

describe("verify_work tool", () => {
  it("is declared read-only and carries the exact id the manifest advertises", () => {
    expect(verifyWorkTool.id).toBe("verify_work");
    expect(verifyWorkTool.readOnly).toBe(true);
    // The gate must never require approval: it only reads.
    expect(verifyWorkTool.destructive).toBeFalsy();
  });

  it("rejects a green claim on a project whose tests fail", async () => {
    const dir = makeProject({
      "package.json": pkg({ test: 'node -e "process.exit(1)"' }),
    });

    const result = await verifyWorkTool.execute({ only: ["tests"] }, ctxFor(dir));

    expect(result.ok).toBe(false);
    expect(result.content).toContain("❌");
    expect(result.content.toLowerCase()).toContain("exited 1");
  }, 30_000);

  it("accepts a project whose tests pass", async () => {
    const dir = makeProject({
      "package.json": pkg({ test: 'node -e "process.exit(0)"' }),
    });

    const result = await verifyWorkTool.execute({ only: ["tests"] }, ctxFor(dir));

    expect(result.ok).toBe(true);
    expect(result.content).toContain("✅");
    expect(result.content).toContain("semua hijau");
  }, 30_000);

  it("honours an explicit testCommand override instead of the detected script", async () => {
    // The package declares a FAILING test script; the override passes, so a
    // green result proves the override won.
    const dir = makeProject({
      "package.json": pkg({ test: 'node -e "process.exit(1)"' }),
    });

    const result = await verifyWorkTool.execute(
      { only: ["tests"], testCommand: 'node -e "process.exit(0)"' },
      ctxFor(dir),
    );

    expect(result.ok).toBe(true);
  }, 30_000);

  it("honours the `only` filter so an unrelated check cannot fail the run", async () => {
    const dir = makeProject({
      "package.json": pkg({ test: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(1)"' }),
    });

    const testsOnly = await verifyWorkTool.execute({ only: ["tests"] }, ctxFor(dir));
    expect(testsOnly.ok).toBe(true);

    const both = await verifyWorkTool.execute({ only: ["tests", "typecheck"] }, ctxFor(dir));
    expect(both.ok).toBe(false);
  }, 60_000);

  it("fails honestly when no workspace folder is open", async () => {
    const result = await verifyWorkTool.execute({}, ctxFor(undefined));

    expect(result.ok).toBe(false);
    expect(result.content).toContain("No workspace folder");
  });

  it("marks a project with no detectable test command as skipped, not green", async () => {
    // No package.json at all: nothing can run. The tool must not claim success.
    const dir = makeProject({ "readme.md": "# empty\n" });

    const result = await verifyWorkTool.execute({ only: ["tests"] }, ctxFor(dir));

    // Nothing ran, so nothing is verified: ok stays false and the report says skipped.
    expect(result.ok).toBe(false);
    expect(result.content).toContain("➖");
  }, 30_000);
});
