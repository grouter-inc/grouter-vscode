import * as vscode from "vscode";
import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";
import { truncateText } from "../../context/budget";

interface DapThread {
  id: number;
  name: string;
}
interface DapStackFrame {
  id: number;
  name: string;
  source?: { path?: string; name?: string };
  line: number;
  column: number;
}
interface DapScope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}
interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export const getDebugStateTool: ToolSpec<{ threadId?: number; frameIndex?: number; maxVariables?: number }> = {
  id: "get_debug_state",
  displayName: "Get Debug State",
  description:
    "Read the current debugger state: active session, paused threads, stack frames, scopes, and variables. Use when the debugger is stopped at a breakpoint to understand why. Returns empty-state message when no session is active or running.",
  userDescription: "Read the debugger state (stack, variables)",
  readOnly: true,
  schema: z.object({
    threadId: z.number().int().optional().describe("DAP thread id (default: first thread)"),
    frameIndex: z.number().int().min(0).optional().describe("Stack frame index (default: 0 = innermost)"),
    maxVariables: z.number().int().min(1).max(100).optional().describe("Max variables per scope (default 30)"),
  }),
  async execute(input) {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      return ok("No active debug session. Start one with the launch_debug tool or F5.");
    }

    const lines: string[] = [`# Debug session: ${session.name} (type: ${session.type})`];
    const maxVars = input.maxVariables ?? 30;

    let threads: DapThread[];
    try {
      const response = (await session.customRequest("threads")) as { threads?: DapThread[] };
      threads = response?.threads ?? [];
    } catch (err) {
      return fail(`Could not read threads (session may be running, not stopped): ${String(err)}`);
    }
    if (threads.length === 0) {
      return ok(`${lines[0]}\n\nNo threads reported. The session may still be starting or already finished.`);
    }

    const thread = input.threadId !== undefined ? threads.find((t) => t.id === input.threadId) : threads[0];
    if (!thread) {
      return fail(`Thread ${input.threadId} not found. Available: ${threads.map((t) => `${t.id} (${t.name})`).join(", ")}`);
    }
    lines.push(`Thread: ${thread.id} (${thread.name})`);

    let frames: DapStackFrame[];
    try {
      const response = (await session.customRequest("stackTrace", { threadId: thread.id })) as {
        stackFrames?: DapStackFrame[];
      };
      frames = response?.stackFrames ?? [];
    } catch (err) {
      return fail(`Could not read stack trace: ${String(err)}`);
    }
    if (frames.length === 0) {
      return ok(`${lines.join("\n")}\n\nNo stack frames — the thread is likely running (not paused).`);
    }

    lines.push("", "## Stack frames");
    for (const [i, frame] of frames.slice(0, 20).entries()) {
      const file = frame.source?.path ?? frame.source?.name ?? "<unknown>";
      const rel = file.startsWith("<") ? file : vscode.workspace.asRelativePath(vscode.Uri.file(file));
      lines.push(`${i === input.frameIndex ? "→" : " "} [${i}] ${frame.name} — ${rel}:${frame.line}:${frame.column}`);
    }

    const frame = frames[input.frameIndex ?? 0];
    if (!frame) return ok(lines.join("\n"));

    let scopes: DapScope[];
    try {
      const response = (await session.customRequest("scopes", { frameId: frame.id })) as { scopes?: DapScope[] };
      scopes = response?.scopes ?? [];
    } catch (err) {
      return ok(`${lines.join("\n")}\n\n_Could not read scopes: ${String(err)}_`);
    }

    lines.push("", `## Variables at frame [${input.frameIndex ?? 0}] ${frame.name}`);
    for (const scope of scopes) {
      if (scope.variablesReference === 0) continue;
      lines.push("", `### ${scope.name}${scope.expensive ? " (expensive)" : ""}`);
      try {
        const response = (await session.customRequest("variables", {
          variablesReference: scope.variablesReference,
        })) as { variables?: DapVariable[] };
        const vars = response?.variables ?? [];
        for (const v of vars.slice(0, maxVars)) {
          const type = v.type ? `: ${v.type}` : "";
          const expandable = v.variablesReference > 0 ? " ▸" : "";
          lines.push(`  ${v.name}${type} = ${truncateText(v.value, 300)}${expandable}`);
        }
        if (vars.length > maxVars) lines.push(`  … (${vars.length - maxVars} more)`);
      } catch (err) {
        lines.push(`  (error reading: ${String(err)})`);
      }
    }

    return ok(lines.join("\n"));
  },
};

export const listBreakpointsTool: ToolSpec<Record<string, never>> = {
  id: "list_breakpoints",
  displayName: "List Breakpoints",
  description: "List all currently set breakpoints with file and line.",
  userDescription: "List breakpoints",
  readOnly: true,
  schema: z.object({}),
  async execute() {
    const bps = vscode.debug.breakpoints;
    if (bps.length === 0) return ok("No breakpoints set.");
    const lines = bps.map((bp) => {
      if (bp instanceof vscode.SourceBreakpoint) {
        const rel = vscode.workspace.asRelativePath(bp.location.uri);
        const cond = bp.condition ? ` if ${bp.condition}` : "";
        return `${rel}:${bp.location.range.start.line + 1}${cond}${bp.enabled ? "" : " (disabled)"}`;
      }
      if (bp instanceof vscode.FunctionBreakpoint) {
        return `function: ${bp.functionName}${bp.enabled ? "" : " (disabled)"}`;
      }
      return "(unknown breakpoint)";
    });
    return ok(lines.join("\n"));
  },
};

export const setBreakpointTool: ToolSpec<{ path: string; line: number; condition?: string }> = {
  id: "set_breakpoint",
  displayName: "Set Breakpoint",
  description: "Set a breakpoint at a file and line (1-based). Optionally with a condition expression.",
  userDescription: "Set a breakpoint",
  readOnly: false,
  schema: z.object({
    path: z.string().describe("Workspace-relative file path"),
    line: z.number().int().positive().describe("Line number (1-based)"),
    condition: z.string().optional().describe("Conditional expression, e.g. 'userId === null'"),
  }),
  async execute(input) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return fail("No workspace folder open.");
    const uri = vscode.Uri.joinPath(folders[0].uri, input.path);
    const position = new vscode.Position(input.line - 1, 0);
    const location = new vscode.Location(uri, position);
    const bp = new vscode.SourceBreakpoint(location, true, input.condition);
    vscode.debug.addBreakpoints([bp]);
    return ok(`Breakpoint set at ${input.path}:${input.line}${input.condition ? ` if ${input.condition}` : ""}.`);
  },
};

export const removeBreakpointTool: ToolSpec<{ path: string; line: number }> = {
  id: "remove_breakpoint",
  displayName: "Remove Breakpoint",
  description: "Remove the breakpoint at a file and line (1-based).",
  userDescription: "Remove a breakpoint",
  readOnly: false,
  schema: z.object({
    path: z.string().describe("Workspace-relative file path"),
    line: z.number().int().positive().describe("Line number (1-based)"),
  }),
  async execute(input) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return fail("No workspace folder open.");
    const target = vscode.Uri.joinPath(folders[0].uri, input.path);
    const matching = vscode.debug.breakpoints.filter(
      (bp) =>
        bp instanceof vscode.SourceBreakpoint &&
        bp.location.uri.toString() === target.toString() &&
        bp.location.range.start.line === input.line - 1,
    );
    if (matching.length === 0) return fail(`No breakpoint found at ${input.path}:${input.line}.`);
    vscode.debug.removeBreakpoints(matching);
    return ok(`Removed ${matching.length} breakpoint(s) at ${input.path}:${input.line}.`);
  },
};

export const launchDebugTool: ToolSpec<{ configuration?: string }> = {
  id: "launch_debug",
  displayName: "Launch Debug Session",
  description:
    "Start a debug session from a launch configuration. Use with no argument to list available configurations first.",
  userDescription: "Start a debug session",
  readOnly: false,
  schema: z.object({
    configuration: z.string().optional().describe("Launch configuration name from launch.json"),
  }),
  async execute(input) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return fail("No workspace folder open.");
    const configs = vscode.workspace.getConfiguration("launch", folder.uri).get<Array<{ name?: string }>>("configurations") ?? [];
    const names = configs.map((c) => c.name).filter((n): n is string => Boolean(n));

    if (!input.configuration) {
      if (names.length === 0) {
        return fail("No launch configurations found in launch.json. Create one first.");
      }
      return ok(`Available launch configurations:\n${names.map((n) => `- ${n}`).join("\n")}\n\nCall again with configuration: "<name>".`);
    }

    if (names.length > 0 && !names.includes(input.configuration)) {
      return fail(`Configuration "${input.configuration}" not found. Available: ${names.join(", ")}`);
    }

    const started = await vscode.debug.startDebugging(folder, input.configuration);
    if (!started) return fail(`Failed to start debug session "${input.configuration}".`);
    return ok(
      `Debug session "${input.configuration}" started. Wait a moment, then use get_debug_state to inspect stopped state.`,
    );
  },
};
