import { StateGraph, Annotation, START, END, MemorySaver, Command, INTERRUPT, isInterrupted, interrupt } from "@langchain/langgraph";
import type { PlanArtifact } from "./artifact";
import { nextPendingStep, updateStepStatus } from "./artifact";

export interface StepApprovalRequest {
  kind: "step-approval";
  planTitle: string;
  stepIndex: number;
  stepTitle: string;
  objective: string;
  files: string[];
  verify?: string;
  isRetry: boolean;
}

export type StepDecision = "approve" | "approve-all" | "skip" | "abort";

export interface PlanExecDeps {
  executeStep: (step: { index: number; title: string; objective: string; files: string[]; verify?: string }) => Promise<{ ok: boolean; summary: string }>;
  persist: (plan: PlanArtifact) => Promise<void>;
  onProgress: (message: string) => void;
}

const PlanState = Annotation.Root({
  plan: Annotation<PlanArtifact>({ reducer: (_a, b) => b }),
  autoApproveAll: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  aborted: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  executed: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
  lastAction: Annotation<string>({ reducer: (_a, b) => b, default: () => "none" }),
});

export function buildPlanExecGraph(deps: PlanExecDeps) {
  const graph = new StateGraph(PlanState)
    .addNode("approve", async (state) => {
      if (state.aborted) return {};
      const step = nextPendingStep(state.plan);
      if (!step) return {};

      if (state.autoApproveAll) {
        deps.onProgress(`Auto-approved step ${step.index}: ${step.title}`);
        return { lastAction: "approve" };
      }

      const request: StepApprovalRequest = {
        kind: "step-approval",
        planTitle: state.plan.title,
        stepIndex: step.index,
        stepTitle: step.title,
        objective: step.objective,
        files: step.files,
        verify: step.verify,
        isRetry: step.status === "in-progress",
      };
      const decision = interrupt<StepApprovalRequest, StepDecision>(request);

      if (decision === "abort") return { aborted: true, lastAction: "abort" };
      if (decision === "skip") {
        const updated = updateStepStatus(state.plan, step.index, "skipped");
        await deps.persist(updated);
        return { plan: updated, lastAction: "skip" };
      }
      if (decision === "approve-all") {
        return { autoApproveAll: true, lastAction: "approve" };
      }
      return { lastAction: "approve" };
    })
    .addNode("execute", async (state) => {
      if (state.aborted) return {};
      const step = nextPendingStep(state.plan);
      if (!step) return {};

      deps.onProgress(`Executing step ${step.index}: ${step.title}`);
      const inProgress = updateStepStatus(state.plan, step.index, "in-progress");
      await deps.persist(inProgress);

      let outcome: { ok: boolean; summary: string };
      try {
        outcome = await deps.executeStep({
          index: step.index,
          title: step.title,
          objective: step.objective,
          files: step.files,
          verify: step.verify,
        });
      } catch (err) {
        outcome = { ok: false, summary: err instanceof Error ? err.message : String(err) };
      }

      const finalStatus = outcome.ok ? "done" : "failed";
      const updated = updateStepStatus(inProgress, step.index, finalStatus);
      await deps.persist(updated);
      deps.onProgress(`Step ${step.index} ${outcome.ok ? "done" : "failed"}: ${outcome.summary.slice(0, 200)}`);

      return { plan: updated, executed: state.executed + 1 };
    })
    .addConditionalEdges("approve", (state) => {
      if (state.aborted) return "finish";
      if (!nextPendingStep(state.plan)) return "finish";
      if (state.lastAction === "skip") return "approve";
      return "execute";
    })
    .addConditionalEdges("execute", (state) => {
      if (state.aborted) return "finish";
      if (!nextPendingStep(state.plan)) return "finish";
      return "approve";
    })
    .addNode("finish", async (state) => {
      const hasFailures = state.plan.steps.some((s) => s.status === "failed");
      const finalStatus = state.aborted ? "aborted" : hasFailures ? "in-progress" : "done";
      const finalPlan: PlanArtifact = { ...state.plan, status: finalStatus };
      await deps.persist(finalPlan);
      return { plan: finalPlan };
    })
    .addEdge(START, "approve")
    .addEdge("finish", END)
    .compile({ checkpointer: new MemorySaver() });

  return graph;
}

export interface ResumeOutcome {
  finished: boolean;
  pendingApproval?: StepApprovalRequest;
  plan: PlanArtifact;
}

export async function runPlanGraph(
  graph: ReturnType<typeof buildPlanExecGraph>,
  threadId: string,
  input: { plan: PlanArtifact } | Command,
): Promise<ResumeOutcome> {
  const config = { configurable: { thread_id: threadId } };
  const result = await graph.invoke(input as never, config);

  if (isInterrupted(result)) {
    const value = result[INTERRUPT][0]?.value as StepApprovalRequest | undefined;
    const snapshot = await graph.getState(config);
    return {
      finished: false,
      pendingApproval: value,
      plan: (snapshot.values as { plan: PlanArtifact }).plan,
    };
  }

  const finalPlan = (result as { plan: PlanArtifact }).plan;
  return { finished: true, plan: finalPlan };
}
