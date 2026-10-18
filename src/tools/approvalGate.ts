import * as vscode from "vscode";
import { decidePolicy, SessionApprovals, isDestructiveRequest, formatApprovalDetail, type ApprovalPolicy } from "./approvalPolicy";
import type { ApprovalDecision, ApprovalRequest, ToolSpec } from "./spec";

export class ApprovalGate {
  private readonly session = new SessionApprovals();

  constructor(private readonly getPolicy: () => ApprovalPolicy) {}

  async request(spec: ToolSpec<never>, request: ApprovalRequest): Promise<ApprovalDecision> {
    const destructive = isDestructiveRequest(request);
    const outcome = decidePolicy(
      { toolId: spec.id, readOnly: spec.readOnly, destructive },
      this.getPolicy(),
      this.session.snapshot(),
    );

    if (outcome.kind === "auto-allow") return "allow";
    if (outcome.kind === "deny-untrusted") {
      void vscode.window.showWarningMessage(
        `gRouter: "${spec.displayName}" is blocked in untrusted workspaces. Trust the workspace to enable edits.`,
      );
      return "deny";
    }

    const items: Array<vscode.QuickPickItem & { decision: ApprovalDecision }> = [
      { label: "$(check) Allow once", decision: "allow" },
    ];
    if (!outcome.forced) {
      items.push({ label: "$(check-all) Always allow (this session)", decision: "allow-session" });
    }
    items.push({ label: "$(x) Deny", decision: "deny" });

    const title = destructive
      ? `gRouter — ⚠ Destructive command requires approval`
      : `gRouter — Approve "${spec.displayName}"?`;

    const picked = await vscode.window.showQuickPick(items, {
      title,
      placeHolder: formatApprovalDetail(request).slice(0, 200),
      ignoreFocusOut: true,
    });

    const decision = picked?.decision ?? "deny";
    if (decision === "allow-session") this.session.allow(spec.id);
    return decision;
  }

  clearSession(): void {
    this.session.clear();
  }
}

export function approvalRequestFor(
  spec: ToolSpec<never>,
  summary: string,
  detail?: string,
  command?: string,
): ApprovalRequest {
  return {
    toolId: spec.id,
    displayName: spec.displayName,
    summary,
    detail,
    destructive: Boolean(spec.destructive),
    command,
  };
}
