#!/usr/bin/env node
/**
 * gRouter MCP server — stdio entry point for external MCP clients.
 *
 * Usage (external client config):
 *   {
 *     "mcpServers": {
 *       "grouter": { "command": "node", "args": ["<path>/dist/mcp-server.js"] }
 *     }
 *   }
 *
 * Note: this standalone mode runs tools against the workspace given by --workspace
 * (or cwd). Mutating tools auto-approve in this mode because there is no VS Code UI
 * to prompt; run it only in workspaces you trust, or use the in-editor mode
 * ("gRouter: Start MCP Server") where approvals are enforced.
 */
import { setDefaultResultOrder } from "node:dns";
setDefaultResultOrder("ipv4first");

import * as path from "node:path";
import { createHeadlessRegistry } from "./tools/headlessRegistry";
import { createMcpServer, serveStdio, MCP_SERVER_EXCLUDE } from "./tools/builtin/mcpServer";

function parseArgs(argv: string[]): { workspace: string } {
  let workspace = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--workspace" && argv[i + 1]) {
      workspace = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return { workspace };
}

async function main(): Promise<void> {
  const { workspace } = parseArgs(process.argv.slice(2));

  const registry = createHeadlessRegistry();
  const server = createMcpServer({
    registry,
    workspaceRoot: workspace,
    approve: async (request) => {
      process.stderr.write(
        `[grouter-mcp] auto-approving ${request.toolId} (${request.summary}) — standalone mode has no UI prompt\n`,
      );
      return true;
    },
    exclude: MCP_SERVER_EXCLUDE,
    onLog: (message) => process.stderr.write(`${message}\n`),
  });

  process.stderr.write(`[grouter-mcp] serving ${registry.all().length} tools, workspace=${workspace}\n`);
  await serveStdio(server);
}

main().catch((err) => {
  process.stderr.write(`[grouter-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
