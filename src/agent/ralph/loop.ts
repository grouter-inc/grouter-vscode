import { collectEvidence, type EvidenceResult, type VerifyReport } from "../verify/evidence";

/**
 * Ralph loop — persistence mode.
 *
 * WHY: today the agent gets `maxIterations` model steps inside ONE runAgent()
 * call. If it runs out, or if it decides it is finished while the build is still
 * red, the turn ends and the user is told the work is done. There is no outer
 * loop that says "not green yet, keep going".
 *
 * This module is the outer loop. It is deliberately dependency-free (no vscode,
 * no ai-sdk) so the control flow can be tested with fake executors:
 *
 *   iterate 1: agent works  → evidence red  → continue
 *   iterate 2: agent works  → evidence red  → continue
 *   ...
 *   iterate N: evidence green               → stop("verified")
 *
 * Stopping conditions:
 *   - verified  : every applicable evidence passed
 *   - max-iterations : budget exhausted, reported honestly as UNVERIFIED
 *   - canceled  : user stopped it
 *   - no-progress: the same failure signature repeated `stallLimit` times
 *   - aborted   : the agent run threw
 */

export type RalphStopReason = "verified" | "max-iterations" | "canceled" | "no-progress" | "aborted" | "error";

export interface RalphIteration {
  index: number;
  /** Summary of what the agent did this iteration. */
  summary: string;
  /** Number of model steps / tool calls consumed, for cost reporting. */
  toolCalls: number;
  filesChanged: string[];
  /** Verification state after the iteration. */
  report: VerifyReport;
  /** Stable signature of the failure set, used to detect stalls. */
  failureSignature: string;
  durationMs: number;
}

export interface RalphOutcome {
  reason: RalphStopReason;
  iterations: RalphIteration[];
  /** true ONLY when the last iteration's evidence was green. */
  verified: boolean;
  /** Honest one-liner for the user, e.g. "stopped after 3 iterations, tests still red". */
  message: string;
  finalReport?: VerifyReport;
}

export interface RalphOptions {
  /** Maximum number of outer iterations (default 5). */
  maxIterations?: number;
  /** Stop early when the same failures repeat this many times (default 2). */
  stallLimit?: number;
  /** Stop before iteration N+1 (1-based) if this returns true. */
  isCanceled?: () => boolean;
  /** Called before each iteration with the 1-based index. */
  onIterationStart?: (index: number, previousFailure?: string) => void;
  /** Called after each iteration with its result. */
  onIterationEnd?: (iteration: RalphIteration) => void;
  /** How to collect evidence; injectable for tests. */
  collectReport: (iterationIndex: number, previousFailure?: string) => Promise<VerifyReport>;
  /** One agent turn. `previousFailure` is the blocker text from the last iteration. */
  runIteration: (params: {
    index: number;
    previousFailure?: string;
  }) => Promise<{ summary: string; toolCalls: number; filesChanged: string[] }>;
}

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_STALL_LIMIT = 2;

/**
 * Build a stable signature from the failing evidence so repeated identical
 * failures can be detected. Includes the exit code and the first meaningful
 * error line, so "same test, same assertion" looks identical between runs while
 * "different test broke" does not.
 */
export function failureSignature(report: VerifyReport): string {
  const failing = report.results.filter((r) => !r.ok);
  if (failing.length === 0) return "green";
  return failing
    .map((r: EvidenceResult) => {
      const firstError =
        r.output
          .replace(/\r\n/g, "\n")
          .split("\n")
          .map((l) => l.trim())
          .find((l) => /error|failed|✗|×|FAIL/i.test(l)) ?? r.note;
      return `${r.kind}:${r.exitCode}:${firstError.slice(0, 120)}`;
    })
    .sort()
    .join("|");
}

/**
 * Run the persistence loop until the work is verified or a stop condition hits.
 * Never throws for expected failures — everything lands in RalphOutcome.
 */
export async function runRalphLoop(options: RalphOptions): Promise<RalphOutcome> {
  const maxIterations = Math.max(1, options.maxIterations ?? DEFAULT_MAX_ITERATIONS);
  const stallLimit = Math.max(2, options.stallLimit ?? DEFAULT_STALL_LIMIT);
  const iterations: RalphIteration[] = [];

  let previousFailure: string | undefined;
  let lastSignature = "";
  let repeatCount = 0;

  for (let index = 1; index <= maxIterations; index++) {
    if (options.isCanceled?.()) {
      return finish("canceled", iterations, "Dihentikan oleh user sebelum verifikasi hijau.");
    }

    options.onIterationStart?.(index, previousFailure);
    const startedAt = Date.now();

    let agentResult: { summary: string; toolCalls: number; filesChanged: string[] };
    try {
      agentResult = await options.runIteration({ index, previousFailure });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      iterations.push({
        index,
        summary: `agent run failed: ${message}`,
        toolCalls: 0,
        filesChanged: [],
        report: {
          results: [],
          ok: false,
          blocker: message,
          startedAt,
          durationMs: Date.now() - startedAt,
        },
        failureSignature: "agent-error",
        durationMs: Date.now() - startedAt,
      });
      return finish("aborted", iterations, `Agent berhenti dengan error: ${message}`);
    }

    const report = await options.collectReport(index, previousFailure);
    const signature = failureSignature(report);

    const iteration: RalphIteration = {
      index,
      summary: agentResult.summary,
      toolCalls: agentResult.toolCalls,
      filesChanged: agentResult.filesChanged,
      report,
      failureSignature: signature,
      durationMs: Date.now() - startedAt,
    };
    iterations.push(iteration);
    options.onIterationEnd?.(iteration);

    if (report.ok) {
      return finish("verified", iterations, "Verifikasi hijau — pekerjaan selesai dengan bukti.", report);
    }

    // Stall detection: identical failures repeated too many times means the
    // agent is going in circles and burning tokens.
    if (signature === lastSignature && signature !== "green") {
      repeatCount++;
      if (repeatCount + 1 >= stallLimit) {
        return finish(
          "no-progress",
          iterations,
          `Berhenti: kegagalan yang sama berulang ${repeatCount + 1}× tanpa progres.`,
          report,
        );
      }
    } else {
      repeatCount = 0;
    }
    lastSignature = signature;
    previousFailure = report.blocker ?? "verifikasi masih merah";
  }

  return finish(
    "max-iterations",
    iterations,
    `Batas ${maxIterations} iterasi tercapai — pekerjaan BELUM terverifikasi.`,
    iterations.at(-1)?.report,
  );
}

function finish(
  reason: RalphStopReason,
  iterations: RalphIteration[],
  message: string,
  finalReport?: VerifyReport,
): RalphOutcome {
  const verified = reason === "verified";
  return {
    reason,
    iterations,
    verified,
    message,
    finalReport: finalReport ?? iterations.at(-1)?.report,
  };
}

/** Compact markdown report of the whole loop, for the chat stream. */
export function renderRalphOutcome(outcome: RalphOutcome): string {
  const icon =
    outcome.reason === "verified"
      ? "✅"
      : outcome.reason === "canceled"
        ? "⏹️"
        : outcome.reason === "no-progress"
          ? "🛑"
          : "⚠️";

  const rows = outcome.iterations.map((it) => {
    const failed = it.report.results.filter((r) => !r.ok).length;
    const skipped = it.report.results.filter((r) => r.skipped).length;
    const status = it.report.ok
      ? "✅ hijau"
      : failed > 0
        ? `❌ ${failed} gagal`
        : skipped === it.report.results.length
          ? "➖ tidak ada verifikasi"
          : "⚠️";
    return `| ${it.index} | ${it.toolCalls} | ${it.filesChanged.length} | ${status} | ${(it.durationMs / 1000).toFixed(1)}s |`;
  });

  const totalTools = outcome.iterations.reduce((sum, it) => sum + it.toolCalls, 0);
  const totalFiles = new Set(outcome.iterations.flatMap((it) => it.filesChanged)).size;

  const lines = [
    `${icon} **Ralph loop** — ${outcome.message}`,
    "",
    "| Iterasi | Tool calls | File berubah | Verifikasi | Durasi |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    `**Total:** ${outcome.iterations.length} iterasi · ${totalTools} tool calls · ${totalFiles} file`,
  ];

  if (!outcome.verified) {
    lines.push(
      "",
      "> ⚠️ **Pekerjaan ini belum terverifikasi.** Jangan anggap selesai — masih ada verifikasi yang merah.",
    );
    if (outcome.finalReport?.blocker) {
      lines.push("", `**Yang masih gagal:** ${outcome.finalReport.blocker}`);
    }
  }

  return lines.join("\n");
}
