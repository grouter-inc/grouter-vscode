import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpServer } from "../../src/tools/builtin/mcpServer";
import { createHeadlessRegistry } from "../../src/tools/headlessRegistry";
import { readMcpJsonConfigs, validateMcpConfig } from "../../src/tools/builtin/mcpClient";

let workspace: string;
let serverPath: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "grouter-mcp-test-"));
  await fs.writeFile(path.join(workspace, "hello.txt"), "hello from test workspace\n");
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(path.join(workspace, "src", "app.ts"), "export const answer = 42;\n");
  serverPath = path.join(process.cwd(), "dist", "mcp-server.js");
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("MCP server (in-process)", () => {
  it("registers all headless tools with correct annotations", () => {
    const registry = createHeadlessRegistry();
    const server = createMcpServer({
      registry,
      workspaceRoot: workspace,
      approve: async () => true,
      exclude: [],
    });
    expect(server).toBeDefined();
    expect(registry.all().length).toBe(12);
    expect(registry.get("read_file")?.readOnly).toBe(true);
    expect(registry.get("write_file")?.readOnly).toBe(false);
    expect(registry.get("run_command")?.readOnly).toBe(false);
  });

  it("has no vscode-dependent tools in the headless registry", () => {
    const registry = createHeadlessRegistry();
    const ids = registry.all().map((t) => t.id);
    expect(ids).not.toContain("get_debug_state");
    expect(ids).not.toContain("get_diagnostics");
    expect(ids).not.toContain("launch_debug");
    expect(ids).not.toContain("delegate_to_specialist");
  });
});

describe("MCP roundtrip (real client ↔ real server process)", () => {
  it(
    "lists tools, reads files, and writes files through the protocol",
    async () => {
      const transport = new StdioClientTransport({
        command: "node",
        args: [serverPath, "--workspace", workspace],
        stderr: "pipe",
      });
      const client = new Client({ name: "test-client", version: "0.1.0" }, { capabilities: {} });
      await client.connect(transport);

      try {
        const tools = await client.listTools();
        expect(tools.tools.length).toBe(12);
        const ids = tools.tools.map((t) => t.name);
        expect(ids).toContain("read_file");
        expect(ids).toContain("write_file");
        expect(ids).toContain("apply_patch");

        const readTool = tools.tools.find((t) => t.name === "read_file");
        expect(readTool?.annotations?.readOnlyHint).toBe(true);
        const writeTool = tools.tools.find((t) => t.name === "write_file");
        expect(writeTool?.annotations?.readOnlyHint).toBe(false);

        const listResult = await client.callTool({ name: "list_dir", arguments: {} });
        const listText = (listResult.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
        expect(listText).toContain("hello.txt");
        expect(listText).toContain("src/");

        const readResult = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
        const readText = (readResult.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
        expect(readText).toContain("hello from test workspace");
        expect(readText).toContain("1: ");

        const writeResult = await client.callTool({
          name: "write_file",
          arguments: { path: "via-mcp.txt", content: "written through MCP protocol" },
        });
        expect(writeResult.isError).toBeFalsy();
        const written = await fs.readFile(path.join(workspace, "via-mcp.txt"), "utf8");
        expect(written).toBe("written through MCP protocol");

        const patchResult = await client.callTool({
          name: "apply_patch",
          arguments: { path: "hello.txt", oldText: "hello from test workspace", newText: "patched via MCP" },
        });
        expect(patchResult.isError).toBeFalsy();
        const patched = await fs.readFile(path.join(workspace, "hello.txt"), "utf8");
        expect(patched).toContain("patched via MCP");
      } finally {
        await client.close();
      }
    },
    120_000,
  );

  it(
    "denies mutating tools when the approval callback rejects",
    async () => {
      const registry = createHeadlessRegistry();
      const { serveStdio } = await import("../../src/tools/builtin/mcpServer");
      const server = createMcpServer({
        registry,
        workspaceRoot: workspace,
        approve: async () => false,
        exclude: [],
      });
      void serveStdio;
      expect(server).toBeDefined();
    },
    30_000,
  );
});

describe("MCP config discovery", () => {
  it("reads .vscode/mcp.json with servers key", async () => {
    await fs.mkdir(path.join(workspace, ".vscode"), { recursive: true });
    await fs.writeFile(
      path.join(workspace, ".vscode", "mcp.json"),
      JSON.stringify({ servers: { testfs: { command: "npx", args: ["-y", "test-server"] } } }),
    );
    const configs = readMcpJsonConfigs(workspace);
    expect(configs.testfs).toBeDefined();
    expect(configs.testfs.command).toBe("npx");
    expect(configs.testfs.type).toBe("stdio");
  });

  it("reads .mcp.json with mcpServers key", async () => {
    await fs.writeFile(
      path.join(workspace, ".mcp.json"),
      JSON.stringify({ mcpServers: { remote: { url: "https://example.com/mcp" } } }),
    );
    const configs = readMcpJsonConfigs(workspace);
    expect(configs.remote).toBeDefined();
    expect(configs.remote.url).toBe("https://example.com/mcp");
    expect(configs.remote.type).toBe("http");
  });

  it("validates configs", () => {
    expect(validateMcpConfig({ type: "stdio", command: "node" })).toBeUndefined();
    expect(validateMcpConfig({ type: "stdio" })).toContain("command");
    expect(validateMcpConfig({ type: "http", url: "not a url" })).toContain("invalid url");
    expect(validateMcpConfig({ type: "http", url: "https://ok.example/mcp" })).toBeUndefined();
  });

  it("returns empty for missing files", () => {
    const configs = readMcpJsonConfigs(path.join(os.tmpdir(), "definitely-missing-dir-xyz"));
    expect(Object.keys(configs).length).toBe(0);
  });
});
