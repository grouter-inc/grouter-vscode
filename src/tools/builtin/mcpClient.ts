import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { ok, fail, type ToolSpec, type ToolRegistry } from "../spec";
import { truncateText } from "../../context/budget";
import { jsonSchemaToZodObject, type JsonSchemaShape } from "../schemaBridge";
import { configDir } from "../../config/homeConfig";

export interface McpServerConfig {
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpServerState {
  name: string;
  config: McpServerConfig;
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  toolCount: number;
  lastConnectedAt?: string;
}

interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; title?: string; destructiveHint?: boolean };
}

const clientCache = new Map<string, unknown>();

export class McpClientManager {
  private readonly servers = new Map<string, McpServerState>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly workspaceRoot: () => string | undefined,
    private readonly log: (message: string) => void,
  ) {}

  discoverConfigs(): void {
    const fromFiles = readMcpJsonConfigs(this.workspaceRoot());
    for (const [name, config] of Object.entries(fromFiles)) {
      if (!this.servers.has(name)) {
        this.servers.set(name, { name, config, status: "disconnected", toolCount: 0 });
      }
    }
  }

  list(): McpServerState[] {
    return [...this.servers.values()];
  }

  async connectAll(): Promise<void> {
    for (const state of this.servers.values()) {
      if (state.status === "connected" || state.status === "connecting") continue;
      await this.connect(state.name).catch(() => undefined);
    }
  }

  async connect(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state) throw new Error(`Unknown MCP server: ${name}`);

    state.status = "connecting";
    state.error = undefined;
    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

      let transport: unknown;
      if (state.config.type === "http" || state.config.url) {
        const { StreamableHTTPClientTransport } = await import(
          "@modelcontextprotocol/sdk/client/streamableHttp.js"
        );
        transport = new StreamableHTTPClientTransport(new URL(state.config.url!), {
          requestInit: { headers: resolveEnvMap(state.config.headers) },
        } as never);
      } else {
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        const transportInstance = new StdioClientTransport({
          command: state.config.command!,
          args: (state.config.args ?? []).map(resolveEnvVars),
          env: state.config.env
            ? ({ ...process.env, ...resolveEnvMap(state.config.env) } as Record<string, string>)
            : undefined,
          cwd: state.config.cwd ?? this.workspaceRoot(),
          stderr: "pipe",
        });
        transportInstance.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8").trim();
          if (text) this.log(`[mcp:${name}] ${text.slice(0, 500)}`);
        });
        transport = transportInstance;
      }

      const client = new Client(
        { name: "grouter-code", version: "0.1.0" },
        { capabilities: {} },
      );
      await client.connect(transport as never);

      const listed = (await client.listTools()) as { tools?: McpToolDescriptor[] };
      const tools = listed.tools ?? [];

      const prefix = `${sanitizeName(name)}_`;
      this.registry.unregisterWhere((id) => id.startsWith(prefix));
      for (const tool of tools) {
        const id = `${prefix}${sanitizeName(tool.name)}`;
        this.registry.register(this.wrapTool(id, name, tool, client));
      }

      clientCache.set(name, client);
      state.status = "connected";
      state.toolCount = tools.length;
      state.lastConnectedAt = new Date().toISOString();
      this.log(`[mcp] connected "${name}" — ${tools.length} tool(s)`);
    } catch (err) {
      state.status = "error";
      state.error = err instanceof Error ? err.message : String(err);
      this.log(`[mcp] connect "${name}" failed: ${state.error}`);
      throw err;
    }
  }

  async disconnect(name: string): Promise<void> {
    const state = this.servers.get(name);
    if (!state) return;
    const client = clientCache.get(name) as { close?: () => Promise<void> } | undefined;
    try {
      await client?.close?.();
    } catch {
      // best effort
    }
    clientCache.delete(name);
    const prefix = `${sanitizeName(name)}_`;
    this.registry.unregisterWhere((id) => id.startsWith(prefix));
    state.status = "disconnected";
    state.toolCount = 0;
  }

  async reconnect(name: string): Promise<void> {
    await this.disconnect(name);
    await this.connect(name);
  }

  private wrapTool(
    id: string,
    serverName: string,
    tool: McpToolDescriptor,
    client: unknown,
  ): ToolSpec<never> {
    const inputSchema = (tool.inputSchema ?? { type: "object", properties: {} }) as JsonSchemaShape;
    const readOnly = Boolean(tool.annotations?.readOnlyHint);
    const cli = client as {
      callTool: (params: { name: string; arguments: Record<string, unknown> }) => Promise<{
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      }>;
    };

    return {
      id,
      displayName: tool.annotations?.title ?? `${serverName}: ${tool.name}`,
      description: `[MCP:${serverName}] ${tool.description ?? tool.name}`,
      userDescription: `MCP tool from ${serverName}`,
      readOnly,
      destructive: Boolean(tool.annotations?.destructiveHint),
      schema: jsonSchemaToZodObject(inputSchema) as never,
      execute: async (input: unknown) => {
        try {
          const result = await cli.callTool({
            name: tool.name,
            arguments: (input ?? {}) as Record<string, unknown>,
          });
          const text = (result.content ?? [])
            .map((part) => (part.type === "text" ? part.text ?? "" : `[${part.type}]`))
            .join("\n");
          const body = truncateText(text || "(empty result)", 60_000);
          return result.isError ? fail(body) : ok(body);
        } catch (err) {
          return fail(`MCP call failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    } as ToolSpec<never>;
  }
}

export function readMcpJsonConfigs(workspaceRoot: string | undefined): Record<string, McpServerConfig> {
  const merged: Record<string, McpServerConfig> = {};
  const candidates: string[] = [];

  if (workspaceRoot) {
    candidates.push(path.join(workspaceRoot, ".vscode", "mcp.json"));
    candidates.push(path.join(workspaceRoot, ".mcp.json"));
  }
  const homeDir = process.env.USERPROFILE ?? process.env.HOME;
  candidates.push(
    homeDir
      ? path.join(homeDir, ".grouter", "mcp.json")
      : path.join(configDir(), "mcp.json"),
  );

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
        servers?: Record<string, McpServerConfig>;
        mcpServers?: Record<string, McpServerConfig>;
      };
      const servers = parsed.servers ?? parsed.mcpServers ?? {};
      for (const [name, config] of Object.entries(servers)) {
        merged[name] = normalizeConfig(config);
      }
    } catch {
      continue;
    }
  }
  return merged;
}

function normalizeConfig(config: McpServerConfig): McpServerConfig {
  if (!config.type) {
    config.type = config.url ? "http" : "stdio";
  }
  return config;
}

function resolveEnvMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return undefined;
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    resolved[key] = resolveEnvVars(value);
  }
  return resolved;
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_m, name: string) => process.env[name] ?? "");
}

export function validateMcpConfig(config: McpServerConfig): string | undefined {
  if (config.type === "http" || config.url) {
    if (!config.url) return "http server requires a url";
    try {
      new URL(config.url);
    } catch {
      return `invalid url: ${config.url}`;
    }
    return undefined;
  }
  if (!config.command) return "stdio server requires a command";
  return undefined;
}
