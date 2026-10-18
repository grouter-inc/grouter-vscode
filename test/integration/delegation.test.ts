import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../../src/config/homeConfig";
import { runAgent } from "../../src/llm/agentRuntime";
import { createDefaultRegistry } from "../../src/tools/registry";
import { createDelegateTool } from "../../src/tools/builtin/delegateTool";
import { getSpecialist, subsetRegistry } from "../../src/agent/specialists";
import type { AgentEvent } from "../../src/llm/runtime";
import type { ToolRegistry } from "../../src/tools/spec";
import { hasLiveKey } from "../live";

const config = loadConfig();
let workspace: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "grouter-delegate-"));

  await fs.mkdir(path.join(workspace, "src", "auth"), { recursive: true });
  await fs.mkdir(path.join(workspace, "src", "api"), { recursive: true });

  await fs.writeFile(
    path.join(workspace, "src", "auth", "tokens.ts"),
    [
      "export interface Token { value: string; expiresAt: number; }",
      "",
      "export function issueToken(userId: string): Token {",
      "  return { value: `tok_${userId}_${Date.now()}`, expiresAt: Date.now() + 3600_000 };",
      "}",
      "",
      "export function isExpired(token: Token): boolean {",
      "  return token.expiresAt < Date.now();",
      "}",
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    path.join(workspace, "src", "api", "routes.ts"),
    [
      "import { issueToken, isExpired } from '../auth/tokens';",
      "",
      "export function loginHandler(userId: string) {",
      "  return issueToken(userId);",
      "}",
      "",
      "export function validateHandler(token: { value: string; expiresAt: number }) {",
      "  return !isExpired(token);",
      "}",
      "",
    ].join("\n"),
  );

  await fs.writeFile(path.join(workspace, "README.md"), "# Auth Service\n\nToken-based auth.\n");
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!hasLiveKey())("delegation (live gateway, explorer specialist)", () => {
  it(
    "parent agent delegates exploration and receives a file-map report",
    async () => {
      const events: AgentEvent[] = [];
      const delegations: Array<{ specialist: string; ok: boolean }> = [];

      const registry: ToolRegistry = createDefaultRegistry({
        delegation: {
          config: () => config,
          registry: () => registry,
          workspaceRoot: () => workspace,
          token: () => ({ isCancellationRequested: false }) as never,
          onEvent: (e) => events.push(e),
          signal: () => new AbortController().signal,
          sessionId: () => "ses_delegate_test",
          recordDelegation: (specialist, _task, ok) => delegations.push({ specialist, ok }),
          approve: async () => "allow",
        },
      });

      const result = await runAgent({
        config,
        prompt: [
          "I need to understand the authentication flow in this codebase before changing it.",
          "Use the delegate_to_specialist tool with the explorer specialist to map where tokens are issued",
          "and validated. Then summarize the flow in your own words with file paths.",
        ].join(" "),
        registry,
        signal: new AbortController().signal,
        token: { isCancellationRequested: false } as never,
        workspaceRoot: workspace,
        approve: async () => "allow",
        onEvent: (e) => events.push(e),
        log: () => undefined,
        maxIterations: 10,
      });

      expect(delegations.length).toBeGreaterThanOrEqual(1);
      expect(delegations[0].specialist).toBe("explorer");
      expect(delegations[0].ok).toBe(true);

      const toolStarts = events.filter((e) => e.type === "tool-start");
      expect(toolStarts.some((e) => (e as { toolId: string }).toolId === "delegate_to_specialist")).toBe(true);

      const progressLines = events.filter((e) => e.type === "progress").map((e) => (e as { text: string }).text);
      expect(progressLines.some((t) => t.includes("Codebase Explorer started"))).toBe(true);
      expect(progressLines.some((t) => t.includes("Codebase Explorer finished"))).toBe(true);

      const errors = events.filter((e) => e.type === "error");
      expect(errors).toHaveLength(0);
      expect(result.denied).toBe(0);
    },
    300_000,
  );

  it("delegate tool rejects unknown specialists", async () => {
    const registry = createDefaultRegistry();
    const tool = createDelegateTool({
      config: () => config,
      registry: () => registry,
      workspaceRoot: () => workspace,
      token: () => ({ isCancellationRequested: false }) as never,
      onEvent: () => undefined,
      signal: () => new AbortController().signal,
      sessionId: () => "ses_x",
      recordDelegation: () => undefined,
      approve: async () => "allow",
    });
    const result = await tool.execute(
      { specialist: "nonexistent", task: "do something" } as never,
      {
        workspaceRoot: workspace,
        token: { isCancellationRequested: false } as never,
        approve: async () => "allow" as const,
        log: () => undefined,
      },
    );
    expect(result.ok).toBe(false);
  });

  it("C-3 regression: tester specialist cannot run commands — its tool subset excludes run_command", () => {
    const tester = getSpecialist("tester")!;
    expect(tester.tools).not.toContain("run_command");
    expect(tester.tools).toContain("run_tests");
    const full = createDefaultRegistry();
    const sub = subsetRegistry(full, tester.tools);
    expect(sub.get("run_command")).toBeUndefined();
  });

  it("C-3 regression: delegation approve callback is the real gate, not a readOnly auto-allow", async () => {
    const prompts: string[] = [];
    const registry = createDefaultRegistry({
      delegation: {
        config: () => config,
        registry: () => registry,
        workspaceRoot: () => workspace,
        token: () => ({ isCancellationRequested: false }) as never,
        onEvent: () => undefined,
        signal: () => new AbortController().signal,
        sessionId: () => "ses_gate_test",
        recordDelegation: () => undefined,
        approve: async (request) => {
          prompts.push(request.toolId);
          return request.toolId === "run_tests" ? "deny" : "allow";
        },
      },
    });

    const delegateSpec = registry.get("delegate_to_specialist")!;
    const result = await delegateSpec.execute(
      {
        specialist: "tester",
        task: "Run the test suite in this workspace and report the raw results. The project has no package.json test script, so use run_tests with command 'node -e \"process.exit(1)\"'.",
      } as never,
      {
        workspaceRoot: workspace,
        token: { isCancellationRequested: false } as never,
        approve: async () => "allow" as const,
        log: () => undefined,
      },
    );

    expect(prompts.length).toBeGreaterThanOrEqual(1);
    expect(prompts).toContain("run_tests");
    expect(result.content.toLowerCase()).toContain("denied");
  }, 300_000);
});
