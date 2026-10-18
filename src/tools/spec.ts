import type * as vscode from "vscode";
import type { z } from "zod";

export interface ToolResult {
  ok: boolean;
  content: string;
}

export interface ToolContext {
  workspaceRoot: string | undefined;
  token: vscode.CancellationToken;
  approve: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  log: (message: string) => void;
}

export interface ApprovalRequest {
  toolId: string;
  displayName: string;
  summary: string;
  detail?: string;
  destructive: boolean;
  /** Raw command for run_command — inspected for destructive patterns before deciding. */
  command?: string;
}

export type ApprovalDecision = "allow" | "allow-session" | "deny";

export interface ToolSpec<I = unknown> {
  id: string;
  displayName: string;
  description: string;
  userDescription: string;
  schema: z.ZodType<I>;
  readOnly: boolean;
  destructive?: boolean;
  execute: (input: I, ctx: ToolContext) => Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolSpec<never>>();

  register<I>(spec: ToolSpec<I>): void {
    if (this.tools.has(spec.id)) {
      throw new Error(`Duplicate tool id: ${spec.id}`);
    }
    this.tools.set(spec.id, spec as unknown as ToolSpec<never>);
  }

  get(id: string): ToolSpec<never> | undefined {
    return this.tools.get(id);
  }

  unregister(id: string): boolean {
    return this.tools.delete(id);
  }

  unregisterWhere(predicate: (id: string) => boolean): number {
    let removed = 0;
    for (const id of [...this.tools.keys()]) {
      if (predicate(id)) {
        this.tools.delete(id);
        removed++;
      }
    }
    return removed;
  }

  all(): ToolSpec<never>[] {
    return [...this.tools.values()];
  }

  readonly(): ToolSpec<never>[] {
    return this.all().filter((t) => t.readOnly);
  }
}

export function ok(content: string): ToolResult {
  return { ok: true, content };
}

export function fail(content: string): ToolResult {
  return { ok: false, content };
}
