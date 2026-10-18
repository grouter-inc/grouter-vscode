/**
 * Guards the ralph persistence loop.
 *
 * WHY: the whole point of /ralph is that it must NOT report success when the
 * build is still red. That is a control-flow property, so it is tested with fake
 * executors: no real processes, no model calls — just the loop's decisions.
 *
 * The critical assertion is `verified === false` for every non-green exit path.
 * A regression here would resurrect exactly the bug the feature exists to fix:
 * an agent claiming "done" on a broken tree.
 */
import { describe, expect, it, vi } from "vitest";
import {
  failureSignature,
  renderRalphOutcome,
  runRalphLoop,
  type RalphIteration,
} from "../../src/agent/ralph/loop";
import type { EvidenceResult, VerifyReport } from "../../src/agent/verify/evidence";

function ev(ok: boolean, note = ok ? "all passed" : "1 failed", output = ""): EvidenceResult {
  return {
    kind: "tests",
    label: "Test suite",
    command: "npm test",
    ok,
    skipped: false,
    note,
    exitCode: ok ? 0 : 1,
    durationMs: 100,
    output: output || note,
  };
}

function rep(...results: EvidenceResult[]): VerifyReport {
  const failing = results.filter((r) => !r.ok);
  return {
    results,
    ok: failing.length === 0,
    blocker: failing.length ? `${failing[0].label} exited ${failing[0].exitCode}` : undefined,
    startedAt: Date.now(),
    durationMs: 50,
  };
}

/** A sequence of reports handed out one per iteration. */
function sequence(...reports: VerifyReport[]) {
  let i = 0;
  return async (): Promise<VerifyReport> => reports[Math.min(i++, reports.length - 1)];
}

describe("runRalphLoop", () => {
  it("stops as verified on the first green iteration", async () => {
    const runIteration = vi.fn(async () => ({ summary: "changed parser", toolCalls: 3, filesChanged: ["a.ts"] }));
    const outcome = await runRalphLoop({
      maxIterations: 5,
      runIteration,
      collectReport: async () => rep(ev(true)),
    });

    expect(outcome.reason).toBe("verified");
    expect(outcome.verified).toBe(true);
    expect(outcome.iterations).toHaveLength(1);
    expect(runIteration).toHaveBeenCalledTimes(1);
  });

  it("keeps looping while red, then stops verified once green", async () => {
    const runIteration = vi.fn(async ({ index }: { index: number }) => ({
      summary: `attempt ${index}`,
      toolCalls: 2,
      filesChanged: [`f${index}.ts`],
    }));

    const outcome = await runRalphLoop({
      maxIterations: 5,
      runIteration,
      collectReport: sequence(rep(ev(false, "1 failed")), rep(ev(false, "2 failed")), rep(ev(true))),
    });

    expect(outcome.reason).toBe("verified");
    expect(outcome.verified).toBe(true);
    expect(outcome.iterations).toHaveLength(3);
    expect(runIteration).toHaveBeenCalledTimes(3);
    // filesChanged must be accumulated across iterations
    expect(outcome.iterations.map((i) => i.filesChanged).flat()).toEqual(["f1.ts", "f2.ts", "f3.ts"]);
  });

  it("passes the previous failure back into the next iteration", async () => {
    const seen: Array<string | undefined> = [];
    await runRalphLoop({
      maxIterations: 3,
      stallLimit: 10, // disable stall detection so we reach max iterations
      runIteration: async ({ previousFailure }) => {
        seen.push(previousFailure);
        return { summary: "work", toolCalls: 1, filesChanged: [] };
      },
      collectReport: sequence(rep(ev(false, "boom A")), rep(ev(false, "boom B")), rep(ev(false, "boom C"))),
    });

    expect(seen[0]).toBeUndefined(); // first iteration has no prior failure
    expect(seen[1]).toContain("exited 1"); // blocker from iteration 1
    expect(seen[2]).toContain("exited 1");
  });

  it("NEVER reports verified when it runs out of iterations", async () => {
    const outcome = await runRalphLoop({
      maxIterations: 3,
      stallLimit: 10,
      runIteration: async ({ index }) => ({ summary: `try ${index}`, toolCalls: 1, filesChanged: [] }),
      collectReport: sequence(rep(ev(false, "still broken 1")), rep(ev(false, "still broken 2")), rep(ev(false, "still broken 3"))),
    });

    expect(outcome.reason).toBe("max-iterations");
    expect(outcome.verified).toBe(false);
    expect(outcome.iterations).toHaveLength(3);
    expect(outcome.message).toContain("BELUM terverifikasi");
  });

  it("stops early when the same failure repeats (no-progress)", async () => {
    const runIteration = vi.fn(async () => ({ summary: "same fix", toolCalls: 1, filesChanged: [] }));
    const same = rep(ev(false, "TypeError: x is undefined", "TypeError: x is undefined"));
    const outcome = await runRalphLoop({
      maxIterations: 10,
      stallLimit: 2,
      runIteration,
      collectReport: async () => same,
    });

    expect(outcome.reason).toBe("no-progress");
    expect(outcome.verified).toBe(false);
    // 2 identical signatures is enough to stop, not 10 iterations
    expect(outcome.iterations.length).toBeLessThanOrEqual(2);
    expect(runIteration.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("does NOT stop early when failures differ", async () => {
    const outcome = await runRalphLoop({
      maxIterations: 3,
      stallLimit: 2,
      runIteration: async ({ index }) => ({ summary: `try ${index}`, toolCalls: 1, filesChanged: [] }),
      collectReport: sequence(
        rep(ev(false, "error A", "Error: A")),
        rep(ev(false, "error B", "Error: B")),
        rep(ev(false, "error C", "Error: C")),
      ),
    });
    expect(outcome.reason).toBe("max-iterations");
    expect(outcome.iterations).toHaveLength(3);
  });

  it("honours cancellation before the first iteration", async () => {
    const runIteration = vi.fn(async () => ({ summary: "x", toolCalls: 0, filesChanged: [] }));
    const outcome = await runRalphLoop({
      maxIterations: 5,
      isCanceled: () => true,
      runIteration,
      collectReport: async () => rep(ev(true)),
    });

    expect(outcome.reason).toBe("canceled");
    expect(outcome.verified).toBe(false);
    expect(runIteration).not.toHaveBeenCalled();
  });

  it("stops when cancelled mid-loop", async () => {
    let calls = 0;
    const outcome = await runRalphLoop({
      maxIterations: 10,
      stallLimit: 10,
      isCanceled: () => calls >= 2,
      runIteration: async () => {
        calls++;
        return { summary: "work", toolCalls: 1, filesChanged: [] };
      },
      collectReport: async () => rep(ev(false, "nope")),
    });
    expect(outcome.reason).toBe("canceled");
    expect(outcome.verified).toBe(false);
    expect(calls).toBe(2);
  });

  it("does not throw when the agent run fails, and reports honestly", async () => {
    const outcome = await runRalphLoop({
      maxIterations: 3,
      runIteration: async () => {
        throw new Error("gateway 500");
      },
      collectReport: async () => rep(ev(true)),
    });

    expect(outcome.reason).toBe("aborted");
    expect(outcome.verified).toBe(false);
    expect(outcome.message).toContain("gateway 500");
  });

  it("tracks tool calls across iterations", async () => {
    const outcome = await runRalphLoop({
      maxIterations: 3,
      stallLimit: 10,
      runIteration: async ({ index }) => ({ summary: `t${index}`, toolCalls: index, filesChanged: [] }),
      collectReport: sequence(rep(ev(false, "a")), rep(ev(false, "b")), rep(ev(true))),
    });
    const total = outcome.iterations.reduce((s, i) => s + i.toolCalls, 0);
    expect(total).toBe(1 + 2 + 3);
  });

  it("calls the iteration hooks in order", async () => {
    const starts: number[] = [];
    const ends: number[] = [];
    await runRalphLoop({
      maxIterations: 4,
      stallLimit: 10,
      onIterationStart: (i) => starts.push(i),
      onIterationEnd: (it: RalphIteration) => ends.push(it.index),
      runIteration: async ({ index }) => ({ summary: `s${index}`, toolCalls: 1, filesChanged: [] }),
      collectReport: sequence(rep(ev(false, "a")), rep(ev(true))),
    });
    expect(starts).toEqual([1, 2]);
    expect(ends).toEqual([1, 2]);
  });
});

describe("failureSignature", () => {
  it("is stable for identical failures", () => {
    expect(failureSignature(rep(ev(false, "boom", "Error: boom")))).toBe(
      failureSignature(rep(ev(false, "boom", "Error: boom"))),
    );
  });

  it("differs when the error changes", () => {
    const a = failureSignature(rep(ev(false, "boom", "Error: boom")));
    const b = failureSignature(rep(ev(false, "bang", "Error: bang")));
    expect(a).not.toBe(b);
  });

  it("is 'green' when everything passes", () => {
    expect(failureSignature(rep(ev(true)))).toBe("green");
  });
});

describe("renderRalphOutcome", () => {
  it("renders a verified table", async () => {
    const outcome = await runRalphLoop({
      maxIterations: 3,
      runIteration: async () => ({ summary: "fixed it", toolCalls: 4, filesChanged: ["a.ts", "b.ts"] }),
      collectReport: sequence(rep(ev(false, "1 failed")), rep(ev(true))),
    });
    const md = renderRalphOutcome(outcome);
    expect(md).toContain("✅");
    expect(md).toContain("| Iterasi |");
    expect(md).toContain("2 iterasi");
    expect(md).not.toContain("belum terverifikasi");
  });

  it("warns loudly when unverified", async () => {
    const outcome = await runRalphLoop({
      maxIterations: 2,
      stallLimit: 10,
      runIteration: async ({ index }) => ({ summary: `t${index}`, toolCalls: 1, filesChanged: [] }),
      collectReport: sequence(rep(ev(false, "e1")), rep(ev(false, "e2"))),
    });
    const md = renderRalphOutcome(outcome);
    expect(md).toContain("belum terverifikasi");
    expect(md).toContain("Yang masih gagal");
  });
});
