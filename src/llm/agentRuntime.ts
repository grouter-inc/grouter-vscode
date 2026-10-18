import { z } from "zod";
import { tool as aiTool, stepCountIs, streamText, type ToolSet } from "ai";
import type * as vscode from "vscode";
import type { GRouterConfig } from "../config/homeConfig";
import { createProvider } from "./gateway";
import { mapGatewayError } from "./errors";
import type { ToolRegistry, ToolSpec, ToolContext, ToolResult } from "../tools/spec";
import type { AgentEvent } from "./runtime";

export interface AgentRunOptions {
  config: GRouterConfig;
  prompt: string;
  registry: ToolRegistry;
  signal: AbortSignal;
  token: vscode.CancellationToken;
  workspaceRoot: string | undefined;
  approve: ToolContext["approve"];
  onEvent: (event: AgentEvent) => void;
  log: (message: string) => void;
  maxIterations?: number;
}

export interface AgentRunResult {
  toolCalls: number;
  filesChanged: string[];
  denied: number;
  textLength: number;
}

export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const { config, registry, onEvent } = options;
  const provider = createProvider(config);
  const tools = buildAiSdkTools(registry, options);
  const filesChanged = new Set<string>();
  let toolCalls = 0;
  let denied = 0;
  let textLength = 0;

  const maxSteps = options.maxIterations ?? config.agent.maxIterations;

  const result = streamText({
    model: provider.chatModel(config.model),
    system: AGENT_SYSTEM_PROMPT,
    prompt: options.prompt,
    tools,
    stopWhen: stepCountIs(maxSteps),
    abortSignal: options.signal,
    maxOutputTokens: config.maxOutputTokens,
    ...(config.reasoning.show && config.reasoning.effort.length > 0
      ? { providerOptions: { grouter: { reasoningEffort: config.reasoning.effort } } }
      : {}),
  });

  try {
    for await (const part of result.stream) {
      switch (part.type) {
        case "text-delta":
          textLength += part.text.length;
          onEvent({ type: "text-delta", text: part.text });
          break;
        case "reasoning-delta":
          onEvent({ type: "reasoning-delta", text: part.text });
          break;
        case "reasoning-end":
          onEvent({ type: "reasoning-end" });
          break;
        case "tool-call":
          toolCalls++;
          onEvent({
            type: "tool-start",
            toolCallId: part.toolCallId,
            toolId: part.toolName,
            input: summarizeInput(part.input),
          });
          break;
        case "tool-result":
          if (isFileMutatingTool(part.toolName)) {
            const input = part.input as { path?: string };
            if (input?.path) filesChanged.add(input.path);
          }
          onEvent({
            type: "tool-end",
            toolCallId: part.toolCallId,
            toolId: part.toolName,
            ok: true,
            preview: previewOutput(part.output),
          });
          break;
        case "tool-error": {
          const text = part.error instanceof Error ? part.error.message : String(part.error);
          const wasDenied = text.includes("User denied");
          if (wasDenied) denied++;
          onEvent({
            type: "tool-end",
            toolCallId: part.toolCallId,
            toolId: part.toolName,
            ok: false,
            preview: (wasDenied ? "denied — " : "") + text.slice(0, 300),
          });
          break;
        }
        case "error":
          onEvent({ type: "error", error: mapGatewayError(part.error) });
          return { toolCalls, filesChanged: [...filesChanged], denied, textLength };
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
    onEvent({ type: "done", finishReason: await result.finishReason });
  } catch (err) {
    if (options.signal.aborted) {
      onEvent({ type: "done", finishReason: "canceled" });
      return { toolCalls, filesChanged: [...filesChanged], denied, textLength };
    }
    onEvent({ type: "error", error: mapGatewayError(err) });
  }

  return { toolCalls, filesChanged: [...filesChanged], denied, textLength };
}

const AGENT_SYSTEM_PROMPT = [
  "You are gRouter, an autonomous coding agent inside VS Code.",
  "Work step by step: inspect before editing, make minimal targeted changes, verify with commands (build/tests) when possible.",
  "Use read_file before apply_patch and copy exact text for oldText.",
  "All file paths are workspace-relative. Prefer apply_patch over write_file for existing files.",
  "When the task is complete, summarize: files changed, commands run, results, and anything left undone.",
].join("\n");

function buildAiSdkTools(registry: ToolRegistry, options: AgentRunOptions): ToolSet {
  const tools: ToolSet = {};
  for (const spec of registry.all()) {
    tools[spec.id] = toAiSdkTool(spec, options);
  }
  return tools;
}

function toAiSdkTool(spec: ToolSpec<never>, options: AgentRunOptions) {
  const jsonSchema = z.toJSONSchema(spec.schema as z.ZodType) as Record<string, unknown>;
  delete jsonSchema.$schema;

  return aiTool({
    description: spec.description,
    inputSchema: spec.schema as z.ZodType,
    execute: async (input: unknown): Promise<string> => {
      const record = (input ?? {}) as Record<string, unknown>;
      const summary = `${spec.displayName}: ${summarizeInput(input)}`;
      const command = typeof record.command === "string" ? record.command : undefined;
      const decision = await options.approve({
        toolId: spec.id,
        displayName: spec.displayName,
        summary,
        detail: undefined,
        destructive: Boolean(spec.destructive),
        command,
      });
      if (decision === "deny") {
        throw new Error(
          `User denied this action. Do not retry it; continue without it or explain what you need.`,
        );
      }

      const ctx: ToolContext = {
        workspaceRoot: options.workspaceRoot,
        token: options.token,
        approve: options.approve,
        log: options.log,
      };
      let result: ToolResult;
      try {
        result = await spec.execute(input as never, ctx);
      } catch (err) {
        throw new Error(`Tool crashed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!result.ok) {
        throw new Error(result.content);
      }
      return result.content;
    },
  });
}

function isFileMutatingTool(toolId: string): boolean {
  return toolId === "apply_patch" || toolId === "write_file";
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return String(input ?? "").slice(0, 160);
  const record = input as Record<string, unknown>;
  if (typeof record.path === "string") {
    const extra = typeof record.command === "string" ? ` — ${String(record.command).slice(0, 120)}` : "";
    return `${record.path}${extra}`;
  }
  if (typeof record.command === "string") return String(record.command).slice(0, 160);
  if (typeof record.query === "string") return `"${record.query}"`;
  return JSON.stringify(record).slice(0, 160);
}

function previewOutput(output: unknown): string {
  const text = typeof output === "string" ? output : JSON.stringify(output ?? "");
  return text.slice(0, 300);
}
