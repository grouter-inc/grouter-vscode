/**
 * S-3 spike — proves that the Phase 1 dependencies load and run:
 *   1. @langchain/langgraph: build + invoke a trivial StateGraph.
 *   2. ai + @ai-sdk/openai-compatible: module loads, provider constructs.
 * No network calls are made here.
 *
 * Runs in two places:
 *   - `npm run spike:host` (plain Node, fastest feedback)
 *   - extension activation (real extension host — the authoritative evidence)
 */
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const SmokeState = Annotation.Root({
  input: Annotation<string>(),
  output: Annotation<string>(),
});

export async function runSpike(): Promise<string> {
  // 1. LangGraph
  const graph = new StateGraph(SmokeState)
    .addNode("echo", (state) => ({ output: `langgraph-ok:${state.input}` }))
    .addEdge(START, "echo")
    .addEdge("echo", END)
    .compile();

  const graphResult = await graph.invoke({ input: "spike" });

  // 2. AI SDK provider construction (no call)
  const provider = createOpenAICompatible({
    name: "grouter",
    baseURL: "https://prod.grouter.web.id/v1",
    apiKey: "not-a-real-key",
  });
  const model = provider.chatModel("spike-model");

  const checks = [
    `node=${process.version}`,
    `graph=${graphResult.output}`,
    `provider=${model.modelId}`,
  ];
  return checks.join(" ");
}

// Allow `node dist/host-smoke.js` execution for quick evidence.
const isDirectRun =
  typeof require !== "undefined" && require.main === module;
if (isDirectRun) {
  runSpike()
    .then((r) => {
      console.log(`[spike] S-3 OK: ${r}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`[spike] S-3 FAILED:`, e);
      process.exit(1);
    });
}
