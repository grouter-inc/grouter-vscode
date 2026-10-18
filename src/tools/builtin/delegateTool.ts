import { z } from "zod";
import { ok, fail, type ToolSpec, type ToolRegistry, type ApprovalRequest, type ApprovalDecision } from "../spec";
import { SPECIALISTS, getSpecialist, subsetRegistry } from "../../agent/specialists";
import { runAgent } from "../../llm/agentRuntime";
import type { GRouterConfig } from "../../config/homeConfig";
import type { AgentEvent } from "../../llm/runtime";
import type * as vscode from "vscode";

export interface DelegationContext {
  config: () => GRouterConfig;
  registry: () => ToolRegistry | undefined;
  workspaceRoot: () => string | undefined;
  token: () => vscode.CancellationToken;
  onEvent: (event: AgentEvent) => void;
  signal: () => AbortSignal;
  sessionId: () => string;
  recordDelegation: (specialist: string, task: string, ok: boolean, summary: string) => void;
  /** Real approval gate — mutating tools inside a delegation must prompt the user. */
  approve: (request: ApprovalRequest) => Promise<ApprovalDecision>;
}

export function createDelegateTool(ctx: DelegationContext): ToolSpec<{ specialist: string; task: string }> {
  const spec: ToolSpec<{ specialist: string; task: string }> = {
    id: "delegate_to_specialist",
    displayName: "Delegate to Specialist",
    description: [
      "Delegate a focused investigation or verification task to an isolated specialist sub-agent.",
      `Available specialists: ${SPECIALISTS.map((s) => `${s.id} (${s.description.split(".")[0]})`).join("; ")}.`,
      "Use this to: explore unfamiliar code before editing, research a dependency's behavior, get an independent",
      "review of your changes, or verify work with tests. The specialist runs in its own context and returns a report.",
      "Choose the specialist matching the task; write a precise, self-contained task description.",
    ].join(" "),
    userDescription: "Run a specialist sub-agent",
    readOnly: true,
    schema: z.object({
      specialist: z
        .enum(SPECIALISTS.map((s) => s.id) as [string, ...string[]])
        .describe("Which specialist to run"),
      task: z.string().describe("Precise, self-contained task description for the specialist"),
    }),
    async execute(input: { specialist: string; task: string }) {
      const specialist = getSpecialist(input.specialist);
      if (!specialist) return fail(`Unknown specialist "${input.specialist}".`);

      const parentRegistry = ctx.registry();
      const workspaceRoot = ctx.workspaceRoot();
      if (!parentRegistry || !workspaceRoot) return fail("Delegation unavailable: no registry or workspace.");

      const subRegistry = subsetRegistry(parentRegistry, specialist.tools);
      const started = Date.now();
      const collected: string[] = [];

      ctx.onEvent({
        type: "progress",
        text: `↳ ${specialist.name} started: ${input.task.slice(0, 120)}`,
      });

      try {
        const result = await runAgent({
          config: ctx.config(),
          prompt: [
            `Task from the primary agent:`,
            input.task,
            "",
            `Workspace root: ${workspaceRoot}`,
            `You are the "${specialist.name}" specialist. Follow your role strictly.`,
          ].join("\n"),
          registry: subRegistry,
          signal: ctx.signal(),
          token: ctx.token(),
          workspaceRoot,
          approve: (request) => ctx.approve(request),
          onEvent: (event) => {
            if (event.type === "text-delta") collected.push(event.text);
          },
          log: () => undefined,
          maxIterations: specialist.maxIterations,
        });

        const report = collected.join("").trim() || "(specialist produced no text report)";
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        const okResult = result.denied === 0;

        ctx.recordDelegation(specialist.id, input.task.slice(0, 200), okResult, report.slice(0, 500));
        ctx.onEvent({
          type: "progress",
          text: `↳ ${specialist.name} finished in ${elapsed}s (${result.toolCalls} tool calls)`,
        });

        return okResult
          ? ok(`## ${specialist.name} report\n\n${report}`)
          : fail(`Specialist was blocked (${result.denied} denied actions). Partial report:\n\n${report}`);
      } catch (err) {
        ctx.recordDelegation(specialist.id, input.task.slice(0, 200), false, String(err));
        return fail(`Specialist run failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
  return spec;
}
