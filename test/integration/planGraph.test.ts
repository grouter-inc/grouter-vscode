import { describe, it, expect } from "vitest";
import { buildPlanExecGraph, runPlanGraph } from "../../src/agent/plan/graph";
import type { PlanArtifact } from "../../src/agent/plan/artifact";
import { Command } from "@langchain/langgraph";

function makePlan(): PlanArtifact {
  return {
    slug: "test-plan",
    title: "Test Plan",
    goal: "Verify the graph.",
    status: "in-progress",
    created: "2026-10-15T10:00:00.000Z",
    model: "test",
    steps: [
      { index: 1, title: "Step one", status: "pending", objective: "Do one.", files: [] },
      { index: 2, title: "Step two", status: "pending", objective: "Do two.", files: [] },
      { index: 3, title: "Step three", status: "pending", objective: "Do three.", files: [] },
    ],
  };
}

function harness(failSteps: number[] = []) {
  const persisted: PlanArtifact[] = [];
  const executed: number[] = [];
  const progress: string[] = [];
  const graph = buildPlanExecGraph({
    executeStep: async (step) => {
      executed.push(step.index);
      const ok = !failSteps.includes(step.index);
      return { ok, summary: `step ${step.index} ${ok ? "ok" : "failed"}` };
    },
    persist: async (plan) => {
      persisted.push(structuredClone(plan));
    },
    onProgress: (message) => progress.push(message),
  });
  return { graph, persisted, executed, progress };
}

describe("plan exec graph (LangGraph interrupt/resume)", () => {
  it("interrupts before each step and completes after approvals", async () => {
    const { graph, executed, persisted } = harness();
    const thread = "t-approve-all";

    let outcome = await runPlanGraph(graph, thread, { plan: makePlan() });
    expect(outcome.finished).toBe(false);
    expect(outcome.pendingApproval?.stepIndex).toBe(1);
    expect(outcome.pendingApproval?.kind).toBe("step-approval");

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "approve" }));
    expect(outcome.finished).toBe(false);
    expect(outcome.pendingApproval?.stepIndex).toBe(2);

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "approve" }));
    expect(outcome.pendingApproval?.stepIndex).toBe(3);

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "approve" }));
    expect(outcome.finished).toBe(true);
    expect(outcome.plan.status).toBe("done");
    expect(executed).toEqual([1, 2, 3]);
    expect(persisted[persisted.length - 1].steps.every((s) => s.status === "done")).toBe(true);
  });

  it("approve-all skips further interrupts", async () => {
    const { graph, executed } = harness();
    const thread = "t-auto";

    let outcome = await runPlanGraph(graph, thread, { plan: makePlan() });
    expect(outcome.pendingApproval?.stepIndex).toBe(1);

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "approve-all" }));
    expect(outcome.finished).toBe(true);
    expect(outcome.plan.status).toBe("done");
    expect(executed).toEqual([1, 2, 3]);
  });

  it("skip marks the step skipped and continues", async () => {
    const { graph, executed } = harness();
    const thread = "t-skip";

    let outcome = await runPlanGraph(graph, thread, { plan: makePlan() });
    expect(outcome.pendingApproval?.stepIndex).toBe(1);

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "skip" }));
    expect(outcome.pendingApproval?.stepIndex).toBe(2);
    expect(executed).toEqual([]);

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "approve" }));
    expect(outcome.pendingApproval?.stepIndex).toBe(3);
    expect(executed).toEqual([2]);

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "approve" }));
    expect(outcome.finished).toBe(true);
    const first = outcome.plan.steps.find((s) => s.index === 1);
    expect(first?.status).toBe("skipped");
  });

  it("abort stops execution and marks the plan aborted", async () => {
    const { graph, executed } = harness();
    const thread = "t-abort";

    let outcome = await runPlanGraph(graph, thread, { plan: makePlan() });
    expect(outcome.pendingApproval?.stepIndex).toBe(1);

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "abort" }));
    expect(outcome.finished).toBe(true);
    expect(outcome.plan.status).toBe("aborted");
    expect(executed).toEqual([]);
  });

  it("failed step marks plan as in-progress (not done)", async () => {
    const { graph, executed } = harness([2]);
    const thread = "t-fail";

    let outcome = await runPlanGraph(graph, thread, { plan: makePlan() });
    outcome = await runPlanGraph(graph, thread, new Command({ resume: "approve-all" }));
    expect(outcome.finished).toBe(true);
    expect(outcome.plan.status).toBe("in-progress");
    const failed = outcome.plan.steps.find((s) => s.index === 2);
    expect(failed?.status).toBe("failed");
    expect(executed).toEqual([1, 2, 3]);
  });

  it("survives re-invocation with the same thread (checkpoint resume)", async () => {
    const { graph } = harness();
    const thread = "t-resume";

    let outcome = await runPlanGraph(graph, thread, { plan: makePlan() });
    expect(outcome.pendingApproval?.stepIndex).toBe(1);

    outcome = await runPlanGraph(graph, thread, new Command({ resume: "approve" }));
    expect(outcome.pendingApproval?.stepIndex).toBe(2);

    const state = await graph.getState({ configurable: { thread_id: thread } });
    const restored = (state.values as { plan: PlanArtifact }).plan;
    expect(restored.steps.find((s) => s.index === 1)?.status).toBe("done");
    expect(restored.steps.find((s) => s.index === 2)?.status).toBe("pending");
  });
});
