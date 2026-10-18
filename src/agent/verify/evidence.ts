import { spawn } from "node:child_process";
import * as path from "node:path";
import { parseTestOutput, type TestSummary } from "../../tools/builtin/testTools";

/**
 * Evidence collection for the verify gate.
 *
 * WHY THIS EXISTS: the agent used to be able to end a turn with "done, tests
 * pass" without ever running anything. Nothing in the pipeline compared the
 * agent's claim against observed reality, so a confident lie was
 * indistinguishable from a real fix. The verify gate collects hard evidence
 * (exit codes + output) and refuses to let the turn close when the claim and the
 * evidence disagree.
 *
 * Everything here is pure/observable so it can be unit-tested without VS Code:
 * no vscode import, no global state.
 */

export type EvidenceKind = "tests" | "typecheck" | "diff";

export interface EvidenceResult {
  kind: EvidenceKind;
  /** Human label, e.g. "npm test". */
  label: string;
  /** Shell command that produced this evidence. */
  command: string;
  /** true when the command exited 0 (or the probe was not applicable). */
  ok: boolean;
  /** Not applicable: nothing to run / nothing to check. Never a failure. */
  skipped: boolean;
  /** Why it was skipped, or a one-line result summary. */
  note: string;
  exitCode: number;
  durationMs: number;
  /** Trimmed output, capped to keep prompts small. */
  output: string;
  skippedReason?: string;
}

export interface VerifyReport {
  results: EvidenceResult[];
  /** true only when every applicable evidence passed. */
  ok: boolean;
  /** Reason the gate should block a "done" claim; undefined when ok. */
  blocker?: string;
  startedAt: number;
  durationMs: number;
}

export interface CollectOptions {
  workspaceRoot: string | undefined;
  /** Test command override (default: auto-detect from the project). */
  testCommand?: string;
  /** Typecheck command override (default: auto-detect). */
  typecheckCommand?: string;
  /** Include `git diff --stat` evidence (default true). */
  includeDiff?: boolean;
  /** Per-command timeout (default 180s). */
  timeoutSeconds?: number;
  /** Max characters of output kept per command (default 4000). */
  outputChars?: number;
  /** Only run tests (skip typecheck/diff) — used by the ralph loop. */
  only?: EvidenceKind[];
}

const DEFAULT_TIMEOUT_S = 180;
const DEFAULT_OUTPUT_CHARS = 4000;

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

    const append = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      // Hard cap so a runaway process can't exhaust memory.
      if (output.length > 400_000) child.kill();
    };

    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
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

async function exists(p: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(p: string): Promise<T | undefined> {
  const fs = await import("node:fs/promises");
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as T;
  } catch {
    return undefined;
  }
}

interface PackageManifest {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

/** Same detection order as the run_tests tool so both agree on what "tests" means. */
export async function detectTestCommand(workspaceRoot: string): Promise<string | undefined> {
  const pkg = await readJson<PackageManifest>(path.join(workspaceRoot, "package.json"));
  if (pkg?.scripts?.test && !/no test specified/i.test(pkg.scripts.test)) return "npm test";
  if (await exists(path.join(workspaceRoot, "pytest.ini"))) return "pytest";
  if (await exists(path.join(workspaceRoot, "Cargo.toml"))) return "cargo test";
  if (await exists(path.join(workspaceRoot, "go.mod"))) return "go test ./...";
  return undefined;
}

/**
 * Detect a type-check command. Returns undefined when the project has no
 * checks — that is NOT a failure, we simply report nothing to typecheck.
 */
export async function detectTypecheckCommand(workspaceRoot: string): Promise<string | undefined> {
  const pkg = await readJson<PackageManifest>(path.join(workspaceRoot, "package.json"));
  const scripts = pkg?.scripts ?? {};
  for (const name of ["typecheck", "check", "tsc", "type-check"]) {
    if (scripts[name]) return `npm run ${name}`;
  }
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (deps.typescript && (await exists(path.join(workspaceRoot, "tsconfig.json")))) {
    return "npx tsc --noEmit";
  }
  if (await exists(path.join(workspaceRoot, "tsconfig.json")) && (await exists(path.join(workspaceRoot, "node_modules", "typescript")))) {
    return "npx tsc --noEmit";
  }
  if (await exists(path.join(workspaceRoot, "pyproject.toml")) && (await exists(path.join(workspaceRoot, "mypy.ini")))) {
    return "mypy .";
  }
  return undefined;
}

function isGitRepo(workspaceRoot: string): Promise<boolean> {
  return exists(path.join(workspaceRoot, ".git"));
}

function trimOutput(text: string, limit: number): string {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= limit) return clean;
  // Keep the tail: failures usually print last.
  return `…(${clean.length - limit} chars trimmed)\n${clean.slice(-limit)}`;
}

async function collectOne(params: {
  kind: EvidenceKind;
  label: string;
  command: string | undefined;
  skippedReason?: string;
  workspaceRoot: string;
  timeoutSeconds: number;
  outputChars: number;
  /** Treat exit 4/126/127 (command not found) as skipped instead of failed. */
  tolerateMissing?: boolean;
}): Promise<EvidenceResult> {
  const started = Date.now();

  if (!params.command) {
    return {
      kind: params.kind,
      label: params.label,
      command: "",
      ok: true,
      skipped: true,
      note: params.skippedReason ?? "not applicable",
      exitCode: 0,
      durationMs: 0,
      output: "",
      skippedReason: params.skippedReason ?? "not applicable",
    };
  }

  const outcome = await execCapture(
    params.command,
    params.workspaceRoot,
    params.timeoutSeconds * 1000,
  );
  const durationMs = Date.now() - started;

  if (outcome.timedOut) {
    return {
      kind: params.kind,
      label: params.label,
      command: params.command,
      ok: false,
      skipped: false,
      note: `timed out after ${params.timeoutSeconds}s`,
      exitCode: -1,
      durationMs,
      output: trimOutput(outcome.output, params.outputChars),
    };
  }

  const missing = params.tolerateMissing && [4, 126, 127].includes(outcome.code);
  if (missing) {
    return {
      kind: params.kind,
      label: params.label,
      command: params.command,
      ok: true,
      skipped: true,
      note: "command not available in this environment",
      exitCode: outcome.code,
      durationMs,
      output: trimOutput(outcome.output, params.outputChars),
      skippedReason: "command not available in this environment",
    };
  }

  const summary =
    params.kind === "tests" ? summarizeTests(outcome.output) : firstMeaningfulLine(outcome.output);

  return {
    kind: params.kind,
    label: params.label,
    command: params.command,
    ok: outcome.code === 0,
    skipped: false,
    note: summary,
    exitCode: outcome.code,
    durationMs,
    output: trimOutput(outcome.output, params.outputChars),
  };
}

function summarizeTests(output: string): string {
  const parsed: TestSummary = parseTestOutput(output);
  const parts: string[] = [];
  if (parsed.passed) parts.push(`${parsed.passed} passed`);
  if (parsed.failed) parts.push(`${parsed.failed} failed`);
  if (parsed.skipped) parts.push(`${parsed.skipped} skipped`);
  if (parts.length === 0) return "no test summary detected in output";
  return parts.join(", ");
}

function firstMeaningfulLine(output: string): string {
  const lines = output
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const error = lines.find((l) => /error|failed|✗|×/i.test(l));
  return (error ?? lines[0] ?? "").slice(0, 200) || "no output";
}

/**
 * Collect all verification evidence for the current workspace state.
 * Never throws: a broken probe becomes a skipped/failed evidence row.
 */
export async function collectEvidence(options: CollectOptions): Promise<VerifyReport> {
  const startedAt = Date.now();
  const root = options.workspaceRoot;
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_S;
  const outputChars = options.outputChars ?? DEFAULT_OUTPUT_CHARS;
  const wanted = options.only ?? ["tests", "typecheck", "diff"];

  if (!root) {
    return {
      results: [],
      ok: false,
      blocker: "No workspace folder is open, so nothing could be verified.",
      startedAt,
      durationMs: Date.now() - startedAt,
    };
  }

  const results: EvidenceResult[] = [];

  if (wanted.includes("tests")) {
    const command = options.testCommand ?? (await detectTestCommand(root));
    results.push(
      await collectOne({
        kind: "tests",
        label: "Test suite",
        command,
        skippedReason: "no test command detected (add a `test` script or pass one explicitly)",
        workspaceRoot: root,
        timeoutSeconds,
        outputChars,
      }),
    );
  }

  if (wanted.includes("typecheck")) {
    const command = options.typecheckCommand ?? (await detectTypecheckCommand(root));
    results.push(
      await collectOne({
        kind: "typecheck",
        label: "Type check",
        command,
        skippedReason: "no typecheck command detected",
        workspaceRoot: root,
        timeoutSeconds,
        outputChars,
        tolerateMissing: true,
      }),
    );
  }

  if (wanted.includes("diff") && options.includeDiff !== false) {
    if (await isGitRepo(root)) {
      results.push(
        await collectOne({
          kind: "diff",
          label: "Working tree diff",
          command: "git diff --stat",
          workspaceRoot: root,
          timeoutSeconds: Math.min(timeoutSeconds, 30),
          outputChars: 1500,
          tolerateMissing: true,
        }),
      );
    } else {
      results.push({
        kind: "diff",
        label: "Working tree diff",
        command: "",
        ok: true,
        skipped: true,
        note: "not a git repository",
        exitCode: 0,
        durationMs: 0,
        output: "",
        skippedReason: "not a git repository",
      });
    }
  }

  const failing = results.filter((r) => !r.ok);
  const ran = results.filter((r) => !r.skipped);

  // A run where nothing actually executed is NOT a green run. Before this
  // guard, a project with no test script produced all-skipped results, the
  // filter above found no failures, and the report said ok:true — so "nothing
  // could be checked" rendered exactly like "everything passed". That is the
  // one lie the verify gate exists to prevent.
  const nothingRan = ran.length === 0;
  const ok = failing.length === 0 && !nothingRan;

  return {
    results,
    ok,
    blocker: ok
      ? undefined
      : nothingRan
        ? "Tidak ada bukti yang bisa dikumpulkan: perintah test/typecheck tidak terdeteksi. Ini BUKAN hasil hijau — tambahkan script test/typecheck atau isi grouter.verify.testCommand."
        : buildBlocker(failing),
    startedAt,
    durationMs: Date.now() - startedAt,
  };
}

function buildBlocker(failing: EvidenceResult[]): string {
  return failing
    .map((r) => {
      const head = `${r.label} (${r.command}) exited ${r.exitCode}`;
      return r.note && r.note !== head ? `${head}: ${r.note}` : head;
    })
    .join("; ");
}

// ---------------------------------------------------------------------------
// Claim analysis
// ---------------------------------------------------------------------------

/**
 * Phrases that assert the work is finished. Kept deliberately narrow: we only
 * want to catch completion claims, not every mention of the word "test".
 */
const DONE_CLAIM = [
  /\b(all|the)\s+tests?\s+(now\s+)?(pass|passes|passing|are\s+green|succeed)\b/i,
  /\btests?\s+(now\s+)?(pass|passes|passing)\b/i,
  /\b(build|typecheck|type\s?check|lint)\s+(now\s+)?(passes?|passing|is\s+clean|succeeds?)\b/i,
  /\b(everything|all)\s+(works?|passes?|is\s+green)\b/i,
  /\b(done|finished|complete|completed|fixed)\b[\s.!]*$/i,
  /\bno\s+(more\s+)?(errors?|failures?)\b/i,
  /\b(verified|confirmed)\s+(that\s+)?(it\s+)?works?\b/i,
];

/** Negated/meta mentions we must NOT flag, e.g. "tests still fail", "I can't verify". */
const NOT_A_CLAIM = [
  /\b(not|cannot|can'?t|couldn'?t|unable\s+to|didn'?t|did\s+not|haven'?t|have\s+not|won'?t|will\s+not)\b[^.]{0,40}\b(pass|verified|verify|confirm|confirmed|run|test)\w*/i,
  /\b(still|remain|remaining)\s+(fail|failing|broken|red)\b/i,
  /\b(tests?|build)\s+(still\s+)?(fail|fails|failing|broken|are\s+red)\b/i,
  /\b(should|might|may|probably)\s+(pass|work)\b/i,
  /\bif\s+(the\s+)?tests?\s+pass/i,
];

export interface ClaimAnalysis {
  /** true when the text contains at least one completion claim. */
  claimsDone: boolean;
  /** The sentence that triggered the match, for display. */
  sentence?: string;
  /** Sentences that looked like claims but were negated/meta. */
  ignored: string[];
}

export function analyzeCompletionClaim(text: string): ClaimAnalysis {
  const sentences = text
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const ignored: string[] = [];
  for (const sentence of sentences) {
    const negated = NOT_A_CLAIM.some((re) => re.test(sentence));
    const matched = DONE_CLAIM.some((re) => re.test(sentence));
    if (matched && !negated) {
      return { claimsDone: true, sentence: sentence.slice(0, 300), ignored };
    }
    if (negated) ignored.push(sentence.slice(0, 200));
  }
  return { claimsDone: false, ignored };
}

export interface GateVerdict {
  /** false → the agent must not be allowed to close the turn as "done". */
  allow: boolean;
  /** Markdown to append when the gate blocks, explaining exactly what failed. */
  message?: string;
  /** true when the gate could not verify anything (no tests, no workspace). */
  unverifiable: boolean;
}

/**
 * Decide whether a completion claim is backed by evidence.
 *
 * Rules:
 *  - No completion claim → allow (a question or a partial report is fine).
 *  - Claim + all applicable evidence green → allow.
 *  - Claim + any red evidence → block, with the failing command and its output.
 *  - Claim + nothing applicable to run → block as *unverifiable*, because
 *    "tests pass" with no test suite is still an unsupported claim.
 */
export function evaluateGate(claim: ClaimAnalysis, report: VerifyReport): GateVerdict {
  const applicable = report.results.filter((r) => !r.skipped);

  if (!claim.claimsDone) {
    return { allow: true, unverifiable: applicable.length === 0 };
  }

  if (applicable.length === 0) {
    return {
      allow: false,
      unverifiable: true,
      message: [
        "## ⚠️ Verify gate: claim tidak bisa dibuktikan",
        "",
        `Kamu menyatakan pekerjaan selesai: _“${claim.sentence ?? "(no sentence)"}”_`,
        "",
        "Tapi **tidak ada verifikasi yang bisa dijalankan** di workspace ini:",
        ...report.results.map((r) => `- ${r.label}: ${r.skippedReason ?? r.note}`),
        "",
        "Jangan klaim selesai. Tulis apa yang **belum** diverifikasi, atau tambahkan test/typecheck dulu.",
      ].join("\n"),
    };
  }

  const failing = report.results.filter((r) => !r.ok);
  if (failing.length === 0) return { allow: true, unverifiable: false };

  const lines: string[] = [
    "## ⚠️ Verify gate: klaim selesai ditolak",
    "",
    `Kamu menyatakan selesai, tapi bukti yang dikumpulkan masih **merah**:`,
    "",
  ];
  for (const r of failing) {
    lines.push(`### ❌ ${r.label} — \`${r.command}\` (exit ${r.exitCode})`);
    if (r.note) lines.push(`_${r.note}_`);
    const tail = r.output.split("\n").slice(-25).join("\n");
    if (tail.trim()) {
      lines.push("", "```", tail, "```");
    }
    lines.push("");
  }
  lines.push(
    "**Turn ini tidak boleh ditutup sebagai selesai.**",
    "",
    "Perbaiki penyebabnya, jalankan ulang verifikasi, lalu baru klaim selesai. " +
      "Kalau memang tidak bisa diperbaiki, katakan terus terang apa yang masih gagal.",
  );

  return { allow: false, unverifiable: false, message: lines.join("\n") };
}

/** One-line status for the HUD. */
export function reportStatusIcon(report: VerifyReport): string {
  if (report.results.every((r) => r.skipped)) return "$(circle-slash)";
  return report.ok ? "$(pass)" : "$(error)";
}

/** Compact markdown table used in the chat summary and diagnostics. */
export function renderReport(report: VerifyReport): string {
  const rows = report.results.map((r) => {
    const icon = r.skipped ? "➖" : r.ok ? "✅" : "❌";
    const status = r.skipped ? `skipped — ${r.skippedReason ?? r.note}` : `exit ${r.exitCode} — ${r.note}`;
    return `| ${icon} | ${r.label} | \`${r.command || "—"}\` | ${status} |`;
  });
  const nothingRan = report.results.every((r) => r.skipped);
  const headline = report.ok
    ? "semua hijau ✅"
    : nothingRan
      ? "tidak ada yang diverifikasi ➖"
      : "ada yang merah ❌";
  return [
    `**Verify gate** — ${headline} (${(report.durationMs / 1000).toFixed(1)}s)`,
    "",
    "| | Check | Command | Result |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}
