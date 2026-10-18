import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";
import { truncateText } from "../../context/budget";

export const getDiagnosticsTool: ToolSpec<{ path?: string; severity?: "error" | "warning" }> = {
  id: "get_diagnostics",
  displayName: "Get Diagnostics",
  description:
    "Get current errors and warnings from the language servers (Problems panel). Optionally filter by file path.",
  userDescription: "Read workspace diagnostics",
  readOnly: true,
  schema: z.object({
    path: z.string().optional().describe("Filter to a workspace-relative file path"),
    severity: z.enum(["error", "warning"]).optional().describe("Filter by severity"),
  }),
  async execute(input) {
    const lines: string[] = [];
    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
      if (input.path && !vscode.workspace.asRelativePath(uri).includes(input.path)) continue;
      for (const d of diags) {
        const sev =
          d.severity === vscode.DiagnosticSeverity.Error
            ? "error"
            : d.severity === vscode.DiagnosticSeverity.Warning
              ? "warning"
              : d.severity === vscode.DiagnosticSeverity.Information
                ? "info"
                : "hint";
        if (input.severity && sev !== input.severity) continue;
        if (sev === "hint") continue;
        const rel = vscode.workspace.asRelativePath(uri);
        lines.push(`${rel}:${d.range.start.line + 1}:${d.range.start.character + 1} [${sev}] ${d.message}`);
        if (lines.length >= 100) return ok(lines.join("\n") + "\n… (truncated at 100)");
      }
    }
    return ok(lines.length ? lines.join("\n") : "No diagnostics found.");
  },
};

export const getOpenEditorsTool: ToolSpec<Record<string, never>> = {
  id: "get_open_editors",
  displayName: "Get Open Editors",
  description: "List currently open editor tabs with their paths.",
  userDescription: "List open editor tabs",
  readOnly: true,
  schema: z.object({}),
  async execute() {
    const lines: string[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) {
          const active = tab.isActive ? " (active)" : "";
          lines.push(`${vscode.workspace.asRelativePath(input.uri)}${active}`);
        }
      }
    }
    return ok(lines.length ? lines.join("\n") : "No text editors are open.");
  },
};

export const getSelectionTool: ToolSpec<Record<string, never>> = {
  id: "get_selection",
  displayName: "Get Selection",
  description: "Get the text currently selected in the active editor (or the full file path if no selection).",
  userDescription: "Read the active editor selection",
  readOnly: true,
  schema: z.object({}),
  async execute() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return ok("No active editor.");
    const rel = vscode.workspace.asRelativePath(editor.document.uri);
    if (editor.selection.isEmpty) {
      return ok(`No selection. Active file: ${rel}`);
    }
    const text = editor.document.getText(editor.selection);
    const start = editor.selection.start.line + 1;
    const end = editor.selection.end.line + 1;
    return ok(`# Selection in ${rel} (lines ${start}-${end})\n${text}`);
  },
};

export { runCommandTool } from "./runCommand";
