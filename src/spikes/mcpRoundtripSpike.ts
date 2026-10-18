import { setDefaultResultOrder } from "node:dns";
setDefaultResultOrder("ipv4first");

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main(): Promise<void> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-mcp-spike-"));
  fs.writeFileSync(path.join(workspace, "hello.txt"), "hello from the spike workspace\n");
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "app.ts"), "export const answer = 42;\n");

  const serverPath = path.join(process.cwd(), "dist", "mcp-server.js");
  console.log(`[spike] launching: node ${serverPath} --workspace ${workspace}`);

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath, "--workspace", workspace],
    stderr: "pipe",
  });

  const client = new Client({ name: "spike-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("[spike] connected to gRouter MCP server");

  const tools = await client.listTools();
  console.log(`[spike] tools listed: ${tools.tools.length}`);
  const ids = tools.tools.map((t) => t.name);
  console.log(`[spike] tool ids: ${ids.join(", ")}`);

  const readTool = tools.tools.find((t) => t.name === "read_file");
  console.log(`[spike] read_file annotations: ${JSON.stringify(readTool?.annotations)}`);

  const listResult = await client.callTool({ name: "list_dir", arguments: {} });
  const listText = (listResult.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  console.log(`[spike] list_dir result:\n${listText}`);

  const readResult = await client.callTool({ name: "read_file", arguments: { path: "hello.txt" } });
  const readText = (readResult.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  console.log(`[spike] read_file result:\n${readText}`);

  const writeResult = await client.callTool({
    name: "write_file",
    arguments: { path: "written-by-mcp.txt", content: "written through MCP" },
  });
  const writeText = (writeResult.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
  console.log(`[spike] write_file result: ${writeText}`);
  console.log(`[spike] file exists on disk: ${fs.existsSync(path.join(workspace, "written-by-mcp.txt"))}`);

  await client.close();
  fs.rmSync(workspace, { recursive: true, force: true });
  console.log("[spike] PASS");
}

main().catch((err) => {
  console.error("[spike] FAILED:", err);
  process.exit(1);
});
