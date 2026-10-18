import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startInEditorMcpServer, type RunningMcpServer } from "../../src/tools/inEditorMcp";
import { createHeadlessRegistry } from "../../src/tools/headlessRegistry";

let workspace: string;
let server: RunningMcpServer | undefined;

afterAll(async () => {
  await server?.close();
  if (workspace) await fs.rm(workspace, { recursive: true, force: true });
});

describe("in-editor MCP server (C-5)", () => {
  it(
    "serves tools over localhost HTTP and routes mutations through the approval callback",
    async () => {
      workspace = await fs.mkdtemp(path.join(os.tmpdir(), "grouter-in-editor-mcp-"));
      await fs.writeFile(path.join(workspace, "seed.txt"), "seed content\n");

      const approvals: string[] = [];
      const logs: string[] = [];

      server = await startInEditorMcpServer({
        registry: createHeadlessRegistry(),
        workspaceRoot: workspace,
        approve: async (request) => {
          approvals.push(request.toolId);
          return request.toolId === "write_file" ? "deny" : "allow";
        },
        onLog: (message) => logs.push(message),
        port: 0,
      });

      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: {
          headers: { accept: "application/json, text/event-stream" },
        },
      });
      const client = new Client({ name: "in-editor-test", version: "0.1.0" }, { capabilities: {} });
      await client.connect(transport);

      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);
      const ids = tools.tools.map((t) => t.name);
      expect(ids).toContain("read_file");
      expect(ids).toContain("write_file");
      expect(ids).not.toContain("delegate_to_specialist");

      const read = await client.callTool({ name: "read_file", arguments: { path: "seed.txt" } });
      const readText = (read.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      expect(readText).toContain("seed content");
      expect(approvals).not.toContain("read_file");

      const write = await client.callTool({
        name: "write_file",
        arguments: { path: "should-not-exist.txt", content: "nope" },
      });
      expect(write.isError).toBe(true);
      expect(approvals).toContain("write_file");
      const deniedText = (write.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      expect(deniedText).toContain("denied");
      await expect(fs.access(path.join(workspace, "should-not-exist.txt"))).rejects.toThrow();

      const allowed = await client.callTool({
        name: "apply_patch",
        arguments: { path: "seed.txt", oldText: "seed content", newText: "patched via in-editor" },
      });
      expect(allowed.isError).toBeFalsy();
      expect(approvals).toContain("apply_patch");
      const patched = await fs.readFile(path.join(workspace, "seed.txt"), "utf8");
      expect(patched).toContain("patched via in-editor");

      await client.close();
      expect(logs.some((l) => l.includes("listening"))).toBe(true);
    },
    120_000,
  );
});
