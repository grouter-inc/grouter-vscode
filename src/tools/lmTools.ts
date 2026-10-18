import * as vscode from "vscode";
import type { ToolRegistry, ToolSpec } from "./spec";
import type { ApprovalGate } from "./approvalGate";
import { approvalRequestFor } from "./approvalGate";
import { getLogger } from "../util/logger";

export function registerLmTools(
  context: vscode.ExtensionContext,
  registry: ToolRegistry,
  gate: ApprovalGate,
): void {
  for (const spec of registry.all()) {
    context.subscriptions.push(vscode.lm.registerTool(`grouter_${spec.id}`, new GRouterLmTool(spec, gate)));
  }
  getLogger().info(`[lm] registered ${registry.all().length} language model tools`);
}

class GRouterLmTool<T> implements vscode.LanguageModelTool<T> {
  constructor(
    private readonly spec: ToolSpec<never>,
    private readonly gate: ApprovalGate,
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<T>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.PreparedToolInvocation> {
    const summary = summarize(options.input);
    return {
      invocationMessage: `${this.spec.displayName}: ${summary}`,
      confirmationMessages: this.spec.readOnly
        ? undefined
        : {
            title: `Run "${this.spec.displayName}"?`,
            message: new vscode.MarkdownString(`**${this.spec.displayName}**\n\n\`${summary}\``),
          },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<T>,
    token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const record = (options.input ?? {}) as Record<string, unknown>;
    const command = typeof record.command === "string" ? record.command : undefined;
    const decision = await this.gate.request(
      this.spec,
      approvalRequestFor(this.spec, summarize(options.input), undefined, command),
    );
    if (decision === "deny") {
      throw new Error("User denied this action. Do not retry; continue without it or explain what you need.");
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const result = await this.spec.execute(options.input as never, {
      workspaceRoot,
      token,
      approve: async () => "allow",
      log: (message) => getLogger().info(`[tool:${this.spec.id}] ${message}`),
    });

    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result.content)]);
  }
}

function summarize(input: unknown): string {
  if (!input || typeof input !== "object") return String(input ?? "").slice(0, 160);
  const record = input as Record<string, unknown>;
  if (typeof record.path === "string") return record.path;
  if (typeof record.command === "string") return record.command.slice(0, 160);
  if (typeof record.query === "string") return `"${record.query}"`;
  return JSON.stringify(record).slice(0, 160);
}
