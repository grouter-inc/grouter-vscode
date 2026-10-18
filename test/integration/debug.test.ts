import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../../src/config/homeConfig";
import { runAgent } from "../../src/llm/agentRuntime";
import { createDefaultRegistry } from "../../src/tools/registry";
import type { AgentEvent } from "../../src/llm/runtime";
import { hasLiveKey } from "../live";

const config = loadConfig();
let workspace: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "grouter-debug-"));

  await fs.writeFile(
    path.join(workspace, "package.json"),
    JSON.stringify(
      {
        name: "debug-fixture",
        version: "1.0.0",
        scripts: { test: "node run-tests.js" },
      },
      null,
      2,
    ),
  );

  await fs.writeFile(
    path.join(workspace, "calc.js"),
    ["function divide(a, b) {", "  return a * b;", "}", "module.exports = { divide };", ""].join("\n"),
  );

  await fs.writeFile(
    path.join(workspace, "run-tests.js"),
    [
      "const { divide } = require('./calc.js');",
      "let failed = 0;",
      "function assertEqual(actual, expected, name) {",
      "  if (actual === expected) { console.log('PASS ' + name); }",
      "  else { console.log('FAIL ' + name + ': expected ' + expected + ' got ' + actual); failed++; }",
      "}",
      "assertEqual(divide(10, 2), 5, 'divide 10/2');",
      "assertEqual(divide(9, 3), 3, 'divide 9/3');",
      "console.log('Tests ' + (failed > 0 ? failed + ' failed | ' : '') + (2 - failed) + ' passed');",
      "process.exit(failed > 0 ? 1 : 0);",
      "",
    ].join("\n"),
  );
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe.skipIf(!hasLiveKey())("debug mode (live gateway, real test failure)", () => {
  it(
    "reproduces the failing test with run_tests, finds the bug, and fixes it",
    async () => {
      const events: AgentEvent[] = [];
      const approvals: string[] = [];

      const result = await runAgent({
        config,
        prompt: [
          "The test suite in this workspace is failing.",
          "Use run_tests to reproduce the failure and read the output.",
          "Then find the root cause in the source code and fix it with apply_patch.",
          "Finally, run the tests again to confirm they pass.",
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
        maxIterations: 15,
      });

      expect(approvals).toContain("run_tests");
      expect(approvals).toContain("apply_patch");

      const content = await fs.readFile(path.join(workspace, "calc.js"), "utf8");
      expect(content).toContain("a / b");
      expect(content).not.toContain("a * b");

      expect(result.filesChanged).toContain("calc.js");

      const errors = events.filter((e) => e.type === "error");
      expect(errors).toHaveLength(0);
    },
    240_000,
  );

  it("run_tests parses the fixture output correctly", async () => {
    await fs.writeFile(
      path.join(workspace, "calc.js"),
      ["function divide(a, b) {", "  return a * b;", "}", "module.exports = { divide };", ""].join("\n"),
    );
    const { runTestsTool } = await import("../../src/tools/builtin/testTools");
    const result = await runTestsTool.execute({ command: "node run-tests.js" }, {
      workspaceRoot: workspace,
      token: { isCancellationRequested: false } as never,
      approve: async () => "allow",
      log: () => undefined,
    });
    expect(result.content).toContain("Tests");
    expect(result.content).toContain("FAIL");
    expect(result.ok).toBe(false);
  }, 60_000);
});
