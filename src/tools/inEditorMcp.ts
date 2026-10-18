import * as http from "node:http";
import { randomUUID } from "node:crypto";
import type { ToolRegistry, ApprovalRequest, ApprovalDecision } from "./spec";
import { createMcpServer, MCP_SERVER_EXCLUDE } from "./builtin/mcpServer";

export interface InEditorMcpOptions {
  registry: ToolRegistry;
  workspaceRoot: string | undefined;
  approve: (request: ApprovalRequest) => Promise<ApprovalDecision>;
  onLog: (message: string) => void;
  port?: number;
}

export interface RunningMcpServer {
  url: string;
  port: number;
  clientCount: () => number;
  close: () => Promise<void>;
}

export async function startInEditorMcpServer(options: InEditorMcpOptions): Promise<RunningMcpServer> {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const server = createMcpServer({
    registry: options.registry,
    workspaceRoot: options.workspaceRoot,
    approve: async (request) => {
      options.onLog(`[mcp-http] approval requested: ${request.toolId} (${request.summary})`);
      const decision = await options.approve({
        toolId: request.toolId,
        displayName: request.displayName,
        summary: request.summary,
        destructive: false,
      });
      return decision === "allow" || decision === "allow-session";
    },
    exclude: MCP_SERVER_EXCLUDE,
    onLog: options.onLog,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });
  transport.onerror = (err) => {
    options.onLog(`[mcp-http] transport error: ${err instanceof Error ? err.message : String(err)}`);
  };

  await server.connect(transport);

  let clients = 0;
  const httpServer = http.createServer((req, res) => {
    const isInitialize =
      req.method === "POST" && req.url?.includes("/mcp") && !req.headers["mcp-session-id"];
    if (isInitialize) clients++;
    transport.handleRequest(req, res).catch((err) => {
      options.onLog(`[mcp-http] request error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  const requestedPort = options.port ?? 3987;
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(requestedPort, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  const url = `http://127.0.0.1:${port}/mcp`;
  options.onLog(`[mcp-http] in-editor MCP server listening at ${url}`);

  return {
    url,
    port,
    clientCount: () => clients,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await server.close().catch(() => undefined);
      options.onLog("[mcp-http] server closed");
    },
  };
}
