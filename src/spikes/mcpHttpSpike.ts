import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { startInEditorMcpServer } from "../tools/inEditorMcp";
import { createHeadlessRegistry } from "../tools/headlessRegistry";

async function main(): Promise<void> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "grouter-mcp-fetch-spike-"));
  fs.writeFileSync(path.join(workspace, "a.txt"), "hello\n");

  const server = await startInEditorMcpServer({
    registry: createHeadlessRegistry(),
    workspaceRoot: workspace,
    approve: async () => "allow",
    onLog: (m) => console.log("[server]", m),
    port: 0,
  });
  console.log("[spike] server at", server.url);

  let sessionId: string | undefined;
  const post = async (label: string, payload: unknown): Promise<Response> => {
    console.log(`[spike] POST ${label}…`);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;
    const res = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const got = res.headers.get("mcp-session-id");
    if (got) sessionId = got;
    console.log(`[spike] ${label} status: ${res.status} session: ${sessionId ?? "-"}`);
    return res;
  };

  const init = await post("initialize", {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "probe", version: "1.0" },
    },
  });
  console.log("[spike] init body:", (await init.text()).slice(0, 200));

  const note = await post("initialized", { jsonrpc: "2.0", method: "notifications/initialized" });
  await note.text().catch(() => "");
  console.log("[spike] initialized headers:", JSON.stringify(Object.fromEntries(note.headers)));

  const list = await post("tools/list", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  console.log("[spike] tools body:", (await list.text()).slice(0, 300));

  await server.close();
  fs.rmSync(workspace, { recursive: true, force: true });
  console.log("[spike] done");
}

main().catch((e) => {
  console.error("[spike] fatal:", e);
  process.exit(1);
});
