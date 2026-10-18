import { describe, it, expect } from "vitest";
import { loadConfig, configPath, configDir } from "../../src/config/homeConfig";
import { listModels, createProvider } from "../../src/llm/gateway";
import { streamText } from "ai";
import { hasLiveKey } from "../live";

const config = loadConfig();

describe("home config", () => {
  it("loads a config file with baseUrl and model", () => {
    expect(configPath().endsWith("config.json")).toBe(true);
    expect(config.baseUrl).toBe("https://prod.grouter.web.id/v1");
    expect(config.model.length).toBeGreaterThan(0);
  });

  it("config dir respects GROUTER_CONFIG_DIR override", () => {
    if (process.env.GROUTER_CONFIG_DIR) {
      expect(configDir()).toBe(process.env.GROUTER_CONFIG_DIR);
    } else {
      expect(configDir()).toContain(".grouter");
    }
  });
});

describe.skipIf(!hasLiveKey())("real gateway", () => {
  it("lists models including the configured one", async () => {
    const models = await listModels(config);
    expect(models.length).toBeGreaterThan(0);
    const ids = models.map((m) => m.id);
    expect(ids).toContain(config.model);
    const target = models.find((m) => m.id === config.model)!;
    expect(target.contextWindow).toBeGreaterThan(0);
    // gRouter's /v1/models does not publish a max-output-tokens field; the model
    // id and context window are the contract we depend on.
    expect(target.id).toBe(config.model);
  });

  it("answers a non-streaming completion", async () => {
    const provider = createProvider(config);
    const result = await streamText({
      model: provider.chatModel(config.model),
      prompt: "Reply with exactly: PONG",
      maxOutputTokens: 64,
    });
    const text = await result.text;
    expect(text.length).toBeGreaterThan(0);
  });

  it("streams text deltas", async () => {
    const provider = createProvider(config);
    const result = streamText({
      model: provider.chatModel(config.model),
      prompt: "Count from 1 to 5, one number per line.",
      maxOutputTokens: 128,
    });
    const deltas: string[] = [];
    for await (const part of result.stream) {
      if (part.type === "text-delta") deltas.push(part.text);
    }
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.join("")).toMatch(/1/);
  });

  it("emits separated reasoning deltas when reasoningEffort is set (S-4)", async () => {
    // The gateway is shared and rate-limits under parallel load, so a single
    // attempt can come back truncated (empty text or empty reasoning) even
    // though the feature works. Retry the whole stream until both channels
    // produced output — the assertion is that reasoning is *separated*, not
    // that one particular attempt survived a busy gateway.
    const attemptStream = async () => {
      const provider = createProvider(config);
      const result = streamText({
        model: provider.chatModel(config.model),
        // A multi-step puzzle reliably triggers the model's thinking channel,
        // unlike a trivial one-liner where it may answer directly.
        prompt:
          "A bat and a ball cost $1.10 total. The bat costs $1.00 more than the ball. " +
          "How much does the ball cost? Reason through it carefully before answering.",
        maxOutputTokens: 4096,
        providerOptions: { grouter: { reasoningEffort: "high" } },
      });
      let reasoning = "";
      let text = "";
      for await (const part of result.stream) {
        if (part.type === "reasoning-delta") reasoning += part.text;
        if (part.type === "text-delta") text += part.text;
      }
      const usage = await result.usage;
      return { reasoning, text, usage };
    };

    let last = await attemptStream();
    for (let i = 0; i < 2 && (last.reasoning.length === 0 || last.text.length === 0); i++) {
      last = await attemptStream();
    }

    expect(last.reasoning.length).toBeGreaterThan(0);
    expect(last.text.length).toBeGreaterThan(0);
    // gRouter reports reasoning as `reasoning_content` deltas but does not
    // publish `completion_tokens_details`, so reasoningTokens stays 0/unset.
    // Assert the token accounting it does provide.
    expect(last.usage.outputTokens ?? last.usage.totalTokens ?? 0).toBeGreaterThan(0);
  });

  it("rejects a bad key with a gateway error", async () => {
    const bad = { ...config, apiKey: "gRouter-invalid-key-for-test" };
    await expect(listModels(bad)).rejects.toMatchObject({ status: 401 });
  });
});
