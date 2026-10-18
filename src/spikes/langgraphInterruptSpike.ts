import { setDefaultResultOrder } from "node:dns";
setDefaultResultOrder("ipv4first");

import { StateGraph, Annotation, START, END, MemorySaver, Command, INTERRUPT, isInterrupted, interrupt } from "@langchain/langgraph";

const PlanState = Annotation.Root({
  goal: Annotation<string>(),
  steps: Annotation<string[]>({ reducer: (a, b) => (b ? b : a), default: () => [] }),
  decisions: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  cursor: Annotation<number>({ reducer: (_a, b) => b, default: () => 0 }),
});

async function main() {
  const graph = new StateGraph(PlanState)
    .addNode("plan", async (state) => {
      return { steps: [`step A for ${state.goal}`, "step B", "step C"] };
    })
    .addNode("review", async (state) => {
      const decision = interrupt<{ kind: string; step: string }, string>({
        kind: "step-approval",
        step: state.steps[state.cursor],
      });
      return { decisions: [`${state.cursor}:${decision}`], cursor: state.cursor + 1 };
    })
    .addNode("execute", async (state) => {
      return { decisions: [`executed:${state.steps[state.cursor - 1]}`] };
    })
    .addEdge(START, "plan")
    .addEdge("plan", "review")
    .addConditionalEdges("review", (state) => (state.cursor < state.steps.length ? "review" : "execute"))
    .addEdge("execute", END)
    .compile({ checkpointer: new MemorySaver() });

  const config = { configurable: { thread_id: "spike-thread-1" } };

  console.log("[P3-spike] invoke #1 (expect interrupt)");
  const r1 = await graph.invoke({ goal: "ship feature" }, config);
  console.log("[P3-spike] interrupted:", isInterrupted(r1));
  if (isInterrupted(r1)) {
    console.log("[P3-spike] interrupt value:", JSON.stringify(r1[INTERRUPT][0]?.value));
  }

  console.log("[P3-spike] resume #1 (approve step A)");
  const r2 = await graph.invoke(new Command({ resume: "approved" }), config);
  console.log("[P3-spike] interrupted again:", isInterrupted(r2));
  if (isInterrupted(r2)) {
    console.log("[P3-spike] interrupt value:", JSON.stringify(r2[INTERRUPT][0]?.value));
  }

  console.log("[P3-spike] resume #2 (approve step B)");
  const r3 = await graph.invoke(new Command({ resume: "approved" }), config);
  console.log("[P3-spike] interrupted again:", isInterrupted(r3));

  console.log("[P3-spike] resume #3 (approve step C)");
  const r4 = await graph.invoke(new Command({ resume: "approved" }), config);
  console.log("[P3-spike] final interrupted:", isInterrupted(r4));
  console.log("[P3-spike] final decisions:", JSON.stringify((r4 as { decisions?: string[] }).decisions));

  const snapshot = await graph.getState(config);
  console.log("[P3-spike] final cursor:", (snapshot.values as { cursor?: number }).cursor);
  console.log("[P3-spike] PASS");
}

main().catch((e) => {
  console.error("[P3-spike] FAILED:", e);
  process.exit(1);
});
