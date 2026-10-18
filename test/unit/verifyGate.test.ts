/**
 * Guards the verify gate.
 *
 * WHY: the agent could previously end a turn with "all tests pass" without ever
 * running a test. Nothing compared the claim against reality, so a confident lie
 * was indistinguishable from a real fix. These tests pin the three behaviours the
 * gate depends on:
 *
 *   1. claim detection   — "tests pass" is a claim, "tests still fail" is not
 *   2. gate decision     — a claim with red evidence must be blocked
 *   3. evidence collection — real commands, real exit codes, honest skips
 *
 * The collection tests run against throwaway directories with real processes, so
 * they exercise the actual spawn path rather than a mock that could drift.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  analyzeCompletionClaim,
  collectEvidence,
  detectTestCommand,
  detectTypecheckCommand,
  evaluateGate,
  renderReport,
  reportStatusIcon,
  type VerifyReport,
} from "../../src/agent/verify/evidence";

// formatTokens lives in ui/hud.ts in the source tree; the gate only re-exports
// the report helpers, so importing it from hud keeps this file honest.
import { formatTokens as formatTokensFromHud } from "../../src/ui/hud";

describe("analyzeCompletionClaim", () => {
  it("detects an explicit 'tests pass' claim", () => {
    const a = analyzeCompletionClaim("I fixed the parser. All tests now pass.");
    expect(a.claimsDone).toBe(true);
    expect(a.sentence).toContain("tests now pass");
  });

  it("detects Indonesian-style completion claims", () => {
    expect(analyzeCompletionClaim("Sudah selesai, build passes.").claimsDone).toBe(true);
  });

  it("detects a bare 'Done.' at the end of a turn", () => {
    expect(analyzeCompletionClaim("Changed the config file.\n\nDone.").claimsDone).toBe(true);
  });

  it("detects 'everything works'", () => {
    expect(analyzeCompletionClaim("Everything works now.").claimsDone).toBe(true);
  });

  it("does NOT flag an honest failure report", () => {
    const a = analyzeCompletionClaim("The tests still fail with a timeout in parser.test.ts.");
    expect(a.claimsDone).toBe(false);
  });

  it("does NOT flag 'I cannot verify this'", () => {
    const a = analyzeCompletionClaim("I could not run the tests because the toolchain is missing.");
    expect(a.claimsDone).toBe(false);
  });

  it("does NOT flag 'tests should pass' (speculation, not a claim)", () => {
    expect(analyzeCompletionClaim("The tests should pass after this change.").claimsDone).toBe(false);
  });

  it("does NOT flag a plain question", () => {
    expect(analyzeCompletionClaim("Which file should I edit first?").claimsDone).toBe(false);
  });

  it("does NOT flag a conditional", () => {
    expect(analyzeCompletionClaim("If the tests pass, we can merge.").claimsDone).toBe(false);
  });

  it("records negated sentences in `ignored`", () => {
    const a = analyzeCompletionClaim("I have not verified anything yet.");
    expect(a.claimsDone).toBe(false);
    expect(a.ignored.length).toBeGreaterThan(0);
  });
});

function report(partial: Partial<VerifyReport> & Pick<VerifyReport, "results">): VerifyReport {
  const failing = partial.results.filter((r) => !r.ok);
  return {
    ok: failing.length === 0,
    blocker: failing.length ? `${failing[0].label} failed` : undefined,
    startedAt: Date.now(),
    durationMs: 12,
    ...partial,
  };
}

const greenResult = {
  kind: "tests" as const,
  label: "Test suite",
  command: "npm test",
  ok: true,
  skipped: false,
  note: "42 passed",
  exitCode: 0,
  durationMs: 900,
  output: "42 passed",
};

const redResult = {
  kind: "tests" as const,
  label: "Test suite",
  command: "npm test",
  ok: false,
  skipped: false,
  note: "3 failed, 39 passed",
  exitCode: 1,
  durationMs: 900,
  output: "FAIL src/parser.test.ts\n  expected 1 got 2",
};

describe("evaluateGate", () => {
  it("allows a turn with no completion claim (a question is fine)", () => {
    const verdict = evaluateGate({ claimsDone: false, ignored: [] }, report({ results: [redResult] }));
    expect(verdict.allow).toBe(true);
  });

  it("allows a claim backed by green evidence", () => {
    const verdict = evaluateGate({ claimsDone: true, ignored: [] }, report({ results: [greenResult] }));
    expect(verdict.allow).toBe(true);
    expect(verdict.unverifiable).toBe(false);
  });

  it("BLOCKS a claim when tests are red", () => {
    const verdict = evaluateGate({ claimsDone: true, ignored: [] }, report({ results: [redResult] }));
    expect(verdict.allow).toBe(false);
    expect(verdict.unverifiable).toBe(false);
    expect(verdict.message).toContain("ditolak");
    expect(verdict.message).toContain("npm test");
    expect(verdict.message).toContain("exit 1");
    // The failing output must be quoted so the agent can act on it.
    expect(verdict.message).toContain("expected 1 got 2");
  });

  it("BLOCKS as unverifiable when there is nothing to run", () => {
    const skipped = {
      ...greenResult,
      skipped: true,
      note: "no test command detected",
      skippedReason: "no test command detected",
      command: "",
    };
    const verdict = evaluateGate({ claimsDone: true, ignored: [] }, report({ results: [skipped] }));
    expect(verdict.allow).toBe(false);
    expect(verdict.unverifiable).toBe(true);
    expect(verdict.message).toContain("tidak ada verifikasi");
  });

  it("blocks when ONE of several checks is red", () => {
    const typecheckRed = {
      ...redResult,
      kind: "typecheck" as const,
      label: "Type check",
      command: "npx tsc --noEmit",
      note: "TS2345",
    };
    const verdict = evaluateGate(
      { claimsDone: true, ignored: [] },
      report({ results: [greenResult, typecheckRed] }),
    );
    expect(verdict.allow).toBe(false);
    expect(verdict.message).toContain("Type check");
  });
});

describe("detectTestCommand / detectTypecheckCommand", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-detect-"));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns undefined when there is no project", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-empty-"));
    expect(await detectTestCommand(empty)).toBeUndefined();
    expect(await detectTypecheckCommand(empty)).toBeUndefined();
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it("detects npm test from a package.json script", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-npm-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", typecheck: "tsc --noEmit" } }),
    );
    expect(await detectTestCommand(dir)).toBe("npm test");
    expect(await detectTypecheckCommand(dir)).toBe("npm run typecheck");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ignores the npm placeholder test script", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-ph-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    );
    expect(await detectTestCommand(dir)).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects pytest / cargo / go", async () => {
    const py = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-py-"));
    fs.writeFileSync(path.join(py, "pytest.ini"), "[pytest]");
    expect(await detectTestCommand(py)).toBe("pytest");

    const rs = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-rs-"));
    fs.writeFileSync(path.join(rs, "Cargo.toml"), "[package]");
    expect(await detectTestCommand(rs)).toBe("cargo test");

    const go = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-go-"));
    fs.writeFileSync(path.join(go, "go.mod"), "module x");
    expect(await detectTestCommand(go)).toBe("go test ./...");

    for (const d of [py, rs, go]) fs.rmSync(d, { recursive: true, force: true });
  });
});

describe("collectEvidence (real processes)", () => {
  it("reports a passing command as green with exit 0", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-ev-"));
    // Real vitest/jest summary format, so the shared parseTestOutput path is
    // exercised rather than bypassed.
    const r = await collectEvidence({
      workspaceRoot: dir,
      testCommand: 'node -e "console.log(\'Tests  5 passed (5)\')"',
      only: ["tests"],
      timeoutSeconds: 30,
    });
    expect(r.ok).toBe(true);
    expect(r.results[0].exitCode).toBe(0);
    expect(r.results[0].note).toContain("5 passed");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not crash on output with no recognisable test summary", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-ev0-"));
    const r = await collectEvidence({
      workspaceRoot: dir,
      testCommand: 'node -e "console.log(\'nothing useful here\')"',
      only: ["tests"],
      timeoutSeconds: 30,
    });
    expect(r.ok).toBe(true); // exit 0 is what decides green
    expect(r.results[0].note).toContain("no test summary detected");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reports a failing command as red and quotes the error", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-ev2-"));
    const r = await collectEvidence({
      workspaceRoot: dir,
      testCommand: 'node -e "console.error(\'2 failed\'); process.exit(1)"',
      only: ["tests"],
      timeoutSeconds: 30,
    });
    expect(r.ok).toBe(false);
    expect(r.blocker).toContain("exited 1");
    expect(r.results[0].output).toContain("2 failed");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("marks a missing test command as skipped, and does NOT call that green", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-ev3-"));
    const r = await collectEvidence({ workspaceRoot: dir, only: ["tests", "typecheck"], timeoutSeconds: 20 });
    expect(r.results.every((x) => x.skipped)).toBe(true);
    // Nothing ran, so nothing was verified: this must not report ok. The old
    // assertion here expected ok === true, which pinned the very bug that let an
    // empty project look like a passed verification.
    expect(r.ok).toBe(false);
    expect(r.blocker).toContain("Tidak ada bukti");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not throw without a workspace", async () => {
    const r = await collectEvidence({ workspaceRoot: undefined });
    expect(r.ok).toBe(false);
    expect(r.blocker).toContain("No workspace");
  });

  it("captures the git diff of a real repo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-git-"));
    const { execSync } = await import("node:child_process");
    execSync("git init -q && git config user.email t@t.t && git config user.name t", { cwd: dir });
    fs.writeFileSync(path.join(dir, "a.txt"), "hello\n");
    execSync("git add . && git commit -qm init", { cwd: dir });
    fs.writeFileSync(path.join(dir, "a.txt"), "hello world\n");

    const r = await collectEvidence({ workspaceRoot: dir, only: ["diff"], timeoutSeconds: 30 });
    expect(r.results[0].kind).toBe("diff");
    expect(r.results[0].ok).toBe(true);
    expect(r.results[0].output).toContain("a.txt");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("report rendering", () => {
  it("renders green and red rows with icons", () => {
    const text = renderReport(report({ results: [greenResult, redResult] }));
    expect(text).toContain("✅");
    expect(text).toContain("❌");
    expect(text).toContain("npm test");
  });

  it("status icon reflects overall state", () => {
    expect(reportStatusIcon(report({ results: [greenResult] }))).toContain("pass");
    expect(reportStatusIcon(report({ results: [redResult] }))).toContain("error");
    const skipped = { ...greenResult, skipped: true, skippedReason: "n/a" };
    expect(reportStatusIcon(report({ results: [skipped] }))).toContain("circle-slash");
  });
});

describe("formatTokens (shared by HUD and reports)", () => {
  it("formats counts compactly", () => {
    expect(formatTokensFromHud(0)).toBe("0");
    expect(formatTokensFromHud(999)).toBe("999");
    expect(formatTokensFromHud(12400)).toBe("12.4k");
    expect(formatTokensFromHud(1_250_000)).toBe("1.3M");
  });
});
