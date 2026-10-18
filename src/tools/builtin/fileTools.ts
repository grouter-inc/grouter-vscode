import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";
import { resolveInWorkspace, listWorkspaceDir } from "../fsGuard";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".vscode-test", "coverage", ".omo"]);

export const readFileTool: ToolSpec<{ path: string; startLine?: number; endLine?: number }> = {
  id: "read_file",
  displayName: "Read File",
  description:
    "Read a text file from the workspace. Returns numbered lines. Optionally restrict to a line range (1-based). Use before editing a file.",
  userDescription: "Read a workspace file",
  readOnly: true,
  schema: z.object({
    path: z.string().describe("Workspace-relative file path"),
    startLine: z.number().int().positive().optional().describe("First line (1-based)"),
    endLine: z.number().int().positive().optional().describe("Last line (1-based, inclusive)"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    try {
      const content = await fs.readFile(resolveInWorkspace(ctx.workspaceRoot, input.path), "utf8");
      const all = content.split("\n");
      const start = Math.max(1, input.startLine ?? 1);
      const end = Math.min(all.length, input.endLine ?? all.length);
      const slice = all.slice(start - 1, end);
      const numbered = slice.map((line, i) => `${start + i}: ${line}`).join("\n");
      const header = `# ${input.path} (lines ${start}-${end} of ${all.length})\n`;
      return ok(header + numbered);
    } catch (err) {
      return fail(`Could not read ${input.path}: ${String(err)}`);
    }
  },
};

export const listDirTool: ToolSpec<{ path?: string }> = {
  id: "list_dir",
  displayName: "List Directory",
  description: "List files and directories at a workspace path (defaults to the workspace root).",
  userDescription: "List a directory",
  readOnly: true,
  schema: z.object({
    path: z.string().optional().describe("Workspace-relative directory path (default: root)"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    try {
      return ok(await listWorkspaceDir(ctx.workspaceRoot, input.path ?? "."));
    } catch (err) {
      return fail(`Could not list ${input.path ?? "."}: ${String(err)}`);
    }
  },
};

export const workspaceTreeTool: ToolSpec<{ depth?: number }> = {
  id: "get_workspace_tree",
  displayName: "Workspace Tree",
  description: "Show a bounded tree of the workspace folders (useful for orientation).",
  userDescription: "Show workspace structure",
  readOnly: true,
  schema: z.object({
    depth: z.number().int().min(1).max(4).optional().describe("Max depth (default 2)"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    const maxDepth = input.depth ?? 2;
    const lines: string[] = [];
    let count = 0;
    async function walk(dir: string, depth: number, prefix: string): Promise<void> {
      if (depth > maxDepth || count > 300) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const visible = entries
        .filter((e) => !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, 40);
      for (const entry of visible) {
        if (count++ > 300) {
          lines.push(`${prefix}… (truncated)`);
          return;
        }
        if (entry.isDirectory()) {
          lines.push(`${prefix}${entry.name}/`);
          await walk(path.join(dir, entry.name), depth + 1, prefix + "  ");
        } else {
          lines.push(`${prefix}${entry.name}`);
        }
      }
    }
    await walk(ctx.workspaceRoot, 1, "");
    return ok(lines.join("\n"));
  },
};

export const searchTextTool: ToolSpec<{ query: string; maxResults?: number; glob?: string }> = {
  id: "search_text",
  displayName: "Search Text",
  description:
    "Search file contents in the workspace for a literal string or regular expression. Returns file:line matches.",
  userDescription: "Search for text in the workspace",
  readOnly: true,
  schema: z.object({
    query: z.string().describe("Literal text or JavaScript regular expression"),
    maxResults: z.number().int().min(1).max(200).optional().describe("Max matches (default 50)"),
    glob: z
      .string()
      .optional()
      .describe("Optional file extension filter, e.g. '.ts' or '.ts,.js'"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    const maxResults = input.maxResults ?? 50;
    let regex: RegExp;
    try {
      regex = new RegExp(input.query, "i");
    } catch {
      regex = new RegExp(input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
    const exts = input.glob
      ? input.glob.split(",").map((e) => e.trim().replace(/^\*?\.?/, ".").toLowerCase())
      : undefined;

    const matches: string[] = [];
    const files = await collectFiles(ctx.workspaceRoot, 500);
    for (const file of files) {
      if (exts && !exts.some((e) => file.toLowerCase().endsWith(e))) continue;
      let content: string;
      try {
        content = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push(`${path.relative(ctx.workspaceRoot, file)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (matches.length >= maxResults) {
            return ok(matches.join("\n") + `\n… (stopped at ${maxResults} matches)`);
          }
        }
      }
    }
    return ok(matches.length ? matches.join("\n") : "No matches found.");
  },
};

async function collectFiles(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(root);
  return out;
}

export const applyPatchTool: ToolSpec<{ path: string; oldText: string; newText: string }> = {
  id: "apply_patch",
  displayName: "Apply Patch",
  description:
    "Replace an exact text block in a file. oldText must match the file content exactly (including whitespace) and must be unique. Use read_file first to copy the exact text. Prefer small targeted edits over rewriting whole files.",
  userDescription: "Edit a file (exact text replacement)",
  readOnly: false,
  schema: z.object({
    path: z.string().describe("Workspace-relative file path"),
    oldText: z.string().describe("Exact existing text to replace"),
    newText: z.string().describe("Replacement text (empty string deletes the block)"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    const target = resolveInWorkspace(ctx.workspaceRoot, input.path);
    let content: string;
    try {
      content = await fs.readFile(target, "utf8");
    } catch (err) {
      return fail(`Could not read ${input.path}: ${String(err)}`);
    }
    const first = content.indexOf(input.oldText);
    if (first === -1) {
      return fail(
        `oldText not found in ${input.path}. Read the file again and copy the exact text (check whitespace/indentation).`,
      );
    }
    if (content.indexOf(input.oldText, first + 1) !== -1) {
      return fail(
        `oldText appears multiple times in ${input.path}. Include more surrounding context to make it unique.`,
      );
    }
    const updated = content.slice(0, first) + input.newText + content.slice(first + input.oldText.length);
    await fs.writeFile(target, updated, "utf8");
    const changedLines = input.newText.split("\n").length - input.oldText.split("\n").length;
    return ok(`Patched ${input.path} (${changedLines >= 0 ? "+" : ""}${changedLines} lines).`);
  },
};

export const writeFileTool: ToolSpec<{ path: string; content: string }> = {
  id: "write_file",
  displayName: "Write File",
  description:
    "Create or overwrite a file with the given content. For edits to existing files prefer apply_patch.",
  userDescription: "Write a file (create or overwrite)",
  readOnly: false,
  schema: z.object({
    path: z.string().describe("Workspace-relative file path"),
    content: z.string().describe("Full file content"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder is open.");
    try {
      const target = resolveInWorkspace(ctx.workspaceRoot, input.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const existed = await fs
        .stat(target)
        .then(() => true)
        .catch(() => false);
      await fs.writeFile(target, input.content, "utf8");
      return ok(`${existed ? "Overwrote" : "Created"} ${input.path} (${input.content.split("\n").length} lines).`);
    } catch (err) {
      return fail(`Could not write ${input.path}: ${String(err)}`);
    }
  },
};
