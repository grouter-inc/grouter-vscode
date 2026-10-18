import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../../src/config/homeConfig";
import { runAgent } from "../../src/llm/agentRuntime";
import { createDefaultRegistry } from "../../src/tools/registry";
import type { AgentEvent } from "../../src/llm/runtime";
import type { ToolContext } from "../../src/tools/spec";
import { hasLiveKey } from "../live";

const config = loadConfig();
let workspace: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "grouter-agent-"));
  await fs.writeFile(
    path.join(workspace, "calc.ts"),
    ["export function add(a: number, b: number) {", "  return a - b;", "}", ""].join("\n"),
  );
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!hasLiveKey())("agent loop (live gateway)", () => {
  it(
    "reads a file, fixes the bug with apply_patch, and reports",
    async () => {
      const events: AgentEvent[] = [];
      const approvals: string[] = [];

      const result = await runAgent({
        config,
        prompt: [
          "In calc.ts the add function has a bug: it subtracts instead of adding.",
          "Read the file, fix it with apply_patch so it returns a + b, then confirm the final content.",
        ].join(" "),
        registry: createDefaultRegistry(),
        signal: new AbortController().signal,
        token: { isCancellationRequested: false } as never,
        workspaceRoot: workspace,
        approve: async (req) => {
          approvals.push(req.toolId);
          return "allow";
        },
        onEvent: (e) => events.push(e),
        log: () => undefined,
        maxIterations: 12,
      });

      const toolStarts = events.filter((e) => e.type === "tool-start");
      expect(toolStarts.length).toBeGreaterThanOrEqual(2);
      expect(approvals).toContain("read_file");
      expect(approvals).toContain("apply_patch");

      const content = await fs.readFile(path.join(workspace, "calc.ts"), "utf8");
      expect(content).toContain("a + b");
      expect(content).not.toContain("a - b");

      expect(result.filesChanged).toContain("calc.ts");
      expect(result.denied).toBe(0);

      const errors = events.filter((e) => e.type === "error");
      expect(errors).toHaveLength(0);

      const done = events.find((e) => e.type === "done");
      expect(done).toBeDefined();
    },
    180_000,
  );

  it(
    "respects a denied approval and does not modify the file",
    async () => {
      const target = path.join(workspace, "calc.ts");
      const before = await fs.readFile(target, "utf8");
      const events: AgentEvent[] = [];

      const result = await runAgent({
        config,
        prompt: "Rewrite calc.ts completely using write_file to add a multiply function.",
        registry: createDefaultRegistry(),
        signal: new AbortController().signal,
        token: { isCancellationRequested: false } as never,
        workspaceRoot: workspace,
        approve: async () => "deny",
        onEvent: (e) => events.push(e),
        log: () => undefined,
        maxIterations: 6,
      });

      const after = await fs.readFile(target, "utf8");
      expect(after).toBe(before);

      // C-2 regression: denied calls are counted, never reported as file changes.
      expect(result.denied).toBeGreaterThanOrEqual(1);
      expect(result.filesChanged).not.toContain("calc.ts");
      const toolEnds = events.filter((e) => e.type === "tool-end");
      expect(toolEnds.length).toBeGreaterThanOrEqual(1);
      for (const end of toolEnds) {
        expect((end as { ok: boolean }).ok).toBe(false);
      }
    },
    180_000,
  );
});

export type { ToolContext };
