import * as path from "node:path";
import * as fs from "node:fs/promises";
import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", ".vscode-test", "coverage", ".omo", "build", "target", ".next"]);

export const findFilesTool: ToolSpec<{ pattern: string; maxResults?: number }> = {
  id: "find_files",
  displayName: "Find Files",
  description:
    "Find files by name pattern (substring or glob-like, e.g. '*.test.ts', 'config'). Returns workspace-relative paths. Faster than search_text when you only need paths.",
  userDescription: "Find files by name",
  readOnly: true,
  schema: z.object({
    pattern: z.string().describe("Name pattern: substring or glob with * (e.g. '*.test.ts')"),
    maxResults: z.number().int().min(1).max(500).optional().describe("Max results (default 100)"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder open.");
    const max = input.maxResults ?? 100;
    const matcher = globToRegExp(input.pattern);
    const results: string[] = [];

    async function walk(dir: string): Promise<void> {
      if (results.length >= max) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= max) return;
        if (entry.name.startsWith(".") && entry.name !== input.pattern) continue;
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (matcher.test(entry.name)) {
          results.push(path.relative(ctx.workspaceRoot!, full).replaceAll("\\", "/"));
        }
      }
    }

    await walk(ctx.workspaceRoot);
    if (results.length === 0) return ok(`No files matching "${input.pattern}".`);
    const suffix = results.length >= max ? `\n… (capped at ${max})` : "";
    return ok(results.join("\n") + suffix);
  },
};

function globToRegExp(pattern: string): RegExp {
  if (pattern.includes("*")) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`, "i");
  }
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

export const fetchUrlTool: ToolSpec<{ url: string; maxChars?: number }> = {
  id: "fetch_url",
  displayName: "Fetch URL",
  description:
    "Fetch a URL (documentation, API reference, changelog) and return its text content, stripped of HTML. Use for looking up external documentation when the installed sources are not enough.",
  userDescription: "Fetch a web page (documentation lookup)",
  readOnly: true,
  schema: z.object({
    url: z.string().describe("HTTP(S) URL to fetch"),
    maxChars: z.number().int().min(1000).max(100_000).optional().describe("Max characters (default 30000)"),
  }),
  async execute(input) {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      return fail(`Invalid URL: ${input.url}`);
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return fail(`Only http(s) URLs are supported.`);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(parsed, {
        signal: controller.signal,
        headers: { "user-agent": "gRouter-VSCode/0.2 (+https://prod.grouter.web.id)" },
      });
      clearTimeout(timer);
      if (!res.ok) return fail(`HTTP ${res.status} fetching ${parsed.hostname}.`);

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("json")) {
        const text = await res.text();
        return ok(text.slice(0, input.maxChars ?? 30_000));
      }

      const html = await res.text();
      const text = stripHtml(html);
      return ok(text.slice(0, input.maxChars ?? 30_000));
    } catch (err) {
      return fail(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|pre|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}
