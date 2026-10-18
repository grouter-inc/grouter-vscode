import * as path from "node:path";
import * as fs from "node:fs/promises";

export class PathEscapeError extends Error {
  constructor(requested: string) {
    super(`Path escapes the workspace root: ${requested}`);
    this.name = "PathEscapeError";
  }
}

export function resolveInWorkspace(workspaceRoot: string, requested: string): string {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, requested);
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathEscapeError(requested);
  }
  return target;
}

export function isInWorkspace(workspaceRoot: string, requested: string): boolean {
  try {
    resolveInWorkspace(workspaceRoot, requested);
    return true;
  } catch {
    return false;
  }
}

export async function readWorkspaceFile(workspaceRoot: string, requested: string): Promise<string> {
  const target = resolveInWorkspace(workspaceRoot, requested);
  return fs.readFile(target, "utf8");
}

export async function listWorkspaceDir(
  workspaceRoot: string,
  requested: string,
  maxEntries = 200,
): Promise<string> {
  const target = resolveInWorkspace(workspaceRoot, requested);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const lines = entries
    .slice(0, maxEntries)
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  const extra = entries.length > maxEntries ? `\n… (${entries.length - maxEntries} more entries)` : "";
  return lines.join("\n") + extra;
}

export const DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+push\s+-f\b/i,
  /\bgit\s+clean\s+-[a-z]*[fd]/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\b(shutdown|reboot)\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\}/,
  /\bcurl\b[^|]*\|\s*(ba)?sh\b/i,
  /\bwget\b[^|]*\|\s*(ba)?sh\b/i,
  /\bRemove-Item\b[^\n]*-Recurse[^\n]*-Force/i,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some((re) => re.test(command));
}
