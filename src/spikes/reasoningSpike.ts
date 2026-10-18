import { setDefaultResultOrder } from "node:dns";
setDefaultResultOrder("ipv4first");

import { loadConfig } from "../config/homeConfig";
import { createProvider } from "../llm/gateway";
import { streamText } from "ai";

async function main() {
  const config = loadConfig();
  const provider = createProvider(config);
  const model = provider.chatModel(config.model);

  console.log(`[S-4] model=${config.model}`);

  const result = streamText({
    model,
    prompt: "Think step by step: what is 17 * 23? Show your reasoning, then answer.",
    maxOutputTokens: 4096,
    providerOptions: {
      grouter: { reasoningEffort: "high" },
    },
  });

  const seen = new Map<string, number>();
  const samples = new Map<string, string[]>();
  let reasoningText = "";
  let textOut = "";

  for await (const part of result.stream) {
    seen.set(part.type, (seen.get(part.type) ?? 0) + 1);
    const arr = samples.get(part.type) ?? [];
    if (arr.length < 3) {
      arr.push(JSON.stringify(part).slice(0, 300));
      samples.set(part.type, arr);
    }
    if (part.type === "reasoning-delta") reasoningText += part.text;
    if (part.type === "text-delta") textOut += part.text;
  }

  console.log("[S-4] part types observed:");
  for (const [type, count] of seen) console.log(`  ${type}: ${count}`);
  console.log("[S-4] reasoning length:", reasoningText.length);
  console.log("[S-4] text length:", textOut.length);
  console.log("[S-4] reasoning sample:", reasoningText.slice(0, 400));
  console.log("[S-4] text sample:", textOut.slice(0, 300));

  const usage = await result.usage;
  console.log("[S-4] usage:", JSON.stringify(usage));
}

main().catch((e) => {
  console.error("[S-4] FAILED:", e);
  process.exit(1);
});
