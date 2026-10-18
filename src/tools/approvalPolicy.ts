import type { ApprovalDecision, ApprovalRequest } from "./spec";
import { isDestructiveCommand } from "./fsGuard";

export interface ApprovalPolicy {
  autoApprove: string[];
  trusted: boolean;
}

export interface ApprovalSubject {
  toolId: string;
  readOnly: boolean;
  destructive: boolean;
}

export type PolicyOutcome =
  | { kind: "auto-allow" }
  | { kind: "must-ask"; forced: boolean }
  | { kind: "deny-untrusted" };

export function isDestructiveRequest(request: Pick<ApprovalRequest, "destructive" | "command">): boolean {
  if (request.destructive) return true;
  if (request.command && isDestructiveCommand(request.command)) return true;
  return false;
}

export function decidePolicy(
  subject: ApprovalSubject,
  policy: ApprovalPolicy,
  sessionAllowed: ReadonlySet<string>,
): PolicyOutcome {
  if (!policy.trusted && !subject.readOnly) {
    return { kind: "deny-untrusted" };
  }
  if (subject.readOnly) {
    return { kind: "auto-allow" };
  }
  if (subject.destructive) {
    return { kind: "must-ask", forced: true };
  }
  if (sessionAllowed.has(subject.toolId) || policy.autoApprove.includes(subject.toolId)) {
    return { kind: "auto-allow" };
  }
  return { kind: "must-ask", forced: false };
}

export class SessionApprovals {
  private readonly allowed = new Set<string>();

  allow(toolId: string): void {
    this.allowed.add(toolId);
  }

  has(toolId: string): boolean {
    return this.allowed.has(toolId);
  }

  clear(): void {
    this.allowed.clear();
  }

  snapshot(): ReadonlySet<string> {
    return this.allowed;
  }
}

export function normalizeDecision(decision: ApprovalDecision): "allow" | "deny" {
  return decision === "deny" ? "deny" : "allow";
}

export function formatApprovalDetail(request: ApprovalRequest): string {
  return request.detail ? `${request.summary}\n\n${request.detail}` : request.summary;
}
