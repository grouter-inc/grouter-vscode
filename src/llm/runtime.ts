import { streamText } from "ai";
import type { GRouterConfig } from "../config/homeConfig";
import { createProvider } from "./gateway";
import { mapGatewayError, type GRouterError } from "./errors";

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "reasoning-end" }
  | { type: "progress"; text: string }
  | { type: "tool-start"; toolCallId: string; toolId: string; input: string }
  | { type: "tool-end"; toolCallId: string; toolId: string; ok: boolean; preview: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; reasoningTokens: number }
  | { type: "rate-limit"; remaining?: number; resetAtMs?: number }
  | { type: "error"; error: GRouterError }
  | { type: "done"; finishReason?: string };

export interface RunAskOptions {
  config: GRouterConfig;
  prompt: string;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

export function normalizeResetToMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value < 1e12 ? value * 1000 : value;
}

export async function runAsk(options: RunAskOptions): Promise<void> {
  const { config, onEvent } = options;
  const provider = createProvider(config);

  const wantsReasoning = config.reasoning.show && config.reasoning.effort.length > 0;
  const result = streamText({
    model: provider.chatModel(config.model),
    prompt: options.prompt,
    maxOutputTokens: config.maxOutputTokens,
    abortSignal: options.signal,
    ...(wantsReasoning
      ? { providerOptions: { grouter: { reasoningEffort: config.reasoning.effort } } }
      : {}),
  });

  Promise.resolve(result.response)
    .then((resp) => {
      const remaining = resp?.headers?.["x-ratelimit-remaining"];
      const reset = resp?.headers?.["x-ratelimit-reset"];
      if (remaining !== undefined || reset !== undefined) {
        onEvent({
          type: "rate-limit",
          remaining: remaining !== undefined ? Number(remaining) : undefined,
          resetAtMs: reset !== undefined ? normalizeResetToMs(Number(reset)) : undefined,
        });
      }
    })
    .catch(() => undefined);

  try {
    for await (const part of result.stream) {
      switch (part.type) {
        case "text-delta":
          onEvent({ type: "text-delta", text: part.text });
          break;
        case "reasoning-delta":
          onEvent({ type: "reasoning-delta", text: part.text });
          break;
        case "reasoning-end":
          onEvent({ type: "reasoning-end" });
          break;
        case "error":
          onEvent({ type: "error", error: mapGatewayError(part.error) });
          return;
        default:
          break;
      }
    }

    const usage = await result.usage;
    onEvent({
      type: "usage",
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
    });
    const finishReason = await result.finishReason;
    onEvent({ type: "done", finishReason });
  } catch (err) {
    if (options.signal.aborted) {
      onEvent({ type: "done", finishReason: "canceled" });
      return;
    }
    onEvent({ type: "error", error: mapGatewayError(err) });
  }
}
