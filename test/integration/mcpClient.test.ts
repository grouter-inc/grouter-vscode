import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";

const testHome = path.join(os.tmpdir(), `grouter-mcpclient-test-${Date.now()}`);
process.env.GROUTER_CONFIG_DIR = testHome;

const { McpClientManager } = await import("../../src/tools/builtin/mcpClient");
const { ToolRegistry } = await import("../../src/tools/spec");
const { closeDb } = await import("../../src/storage/db");

let workspace: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "grouter-mcpclient-ws-"));
  await fs.writeFile(path.join(workspace, "data.txt"), "client test data\n");
});

afterAll(async () => {
  closeDb();
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.rm(testHome, { recursive: true, force: true });
});

describe("MCP client manager (connects to the gRouter server as external server)", () => {
  it(
    "discovers config, connects via stdio, ingests tools into the registry, and calls one",
    async () => {
      const serverPath = path.join(process.cwd(), "dist", "mcp-server.js");
      await fs.mkdir(path.join(workspace, ".vscode"), { recursive: true });
      await fs.writeFile(
        path.join(workspace, ".vscode", "mcp.json"),
        JSON.stringify({
          servers: {
            grouterTest: {
              type: "stdio",
              command: "node",
              args: [serverPath, "--workspace", workspace],
            },
          },
        }),
      );

      const registry = new ToolRegistry();
      const logs: string[] = [];
      const manager = new McpClientManager(registry, () => workspace, (m) => logs.push(m));

      manager.discoverConfigs();
      expect(manager.list().length).toBe(1);
      expect(manager.list()[0].name).toBe("grouterTest");

      await manager.connect("grouterTest");
      const state = manager.list()[0];
      expect(state.status).toBe("connected");
      expect(state.toolCount).toBe(12);

      const ingested = registry.all().map((t) => t.id);
      expect(ingested).toContain("groutertest_read_file");
      expect(ingested).toContain("groutertest_write_file");

      const readSpec = registry.get("groutertest_read_file");
      expect(readSpec?.readOnly).toBe(true);
      expect(readSpec?.description).toContain("[MCP:grouterTest]");

      // H-4 regression: the MCP client tool must expose the server's real input schema.
      const schema = z.toJSONSchema(readSpec!.schema as z.ZodType) as {
        properties?: Record<string, { type?: string }>;
        required?: string[];
      };
      expect(schema.properties?.path).toBeDefined();
      expect(schema.properties?.path?.type).toBe("string");
      expect(schema.required).toContain("path");
      expect(schema.properties?.startLine).toBeDefined();
      expect(schema.required ?? []).not.toContain("startLine");

      const result = await readSpec!.execute({ path: "data.txt" } as never, {
        workspaceRoot: workspace,
        token: { isCancellationRequested: false } as never,
        approve: async () => "allow" as const,
        log: () => undefined,
      });
      expect(result.ok).toBe(true);
      expect(result.content).toContain("client test data");

      const writeSpec = registry.get("groutertest_write_file");
      expect(writeSpec?.readOnly).toBe(false);

      await manager.disconnect("grouterTest");
      expect(manager.list()[0].status).toBe("disconnected");

      expect(logs.some((l) => l.includes("connected"))).toBe(true);
    },
    120_000,
  );

  it("reports error state for a broken server command", async () => {
    const registry = new ToolRegistry();
    const manager = new McpClientManager(registry, () => workspace, () => undefined);
    manager.discoverConfigs();
    const before = manager.list().length;
    void before;

    const { McpClientManager: Mgr } = await import("../../src/tools/builtin/mcpClient");
    const broken = new Mgr(registry, () => workspace, () => undefined);
    broken.discoverConfigs();
    await fs.writeFile(
      path.join(workspace, ".vscode", "mcp.json"),
      JSON.stringify({ servers: { broken: { command: "definitely-not-a-real-command-xyz" } } }),
    );
    const fresh = new Mgr(registry, () => workspace, () => undefined);
    fresh.discoverConfigs();
    await expect(fresh.connect("broken")).rejects.toThrow();
    expect(fresh.list()[0].status).toBe("error");
    expect(fresh.list()[0].error).toBeTruthy();
    void manager;
  }, 60_000);
});
