import * as vscode from "vscode";
import { contextBudgetFor, fitToBudget, truncateText, type BudgetItem } from "./budget";

export interface AssembledContext {
  text: string;
  includedLabels: string[];
  omittedLabels: string[];
  usedTokens: number;
}

export interface AssembleOptions {
  references: readonly vscode.ChatPromptReference[];
  activeEditor: vscode.TextEditor | undefined;
  contextWindow: number;
  truncateKB: number;
}

export async function assembleContext(options: AssembleOptions): Promise<AssembledContext> {
  const items: BudgetItem[] = [];
  const maxChars = options.truncateKB * 1024;

  for (const ref of options.references) {
    const text = await referenceToText(ref, maxChars);
    if (!text) continue;
    items.push({ label: String(ref.id), text, priority: 100 });
  }

  const editor = options.activeEditor;
  if (editor && editor.document.uri.scheme === "file") {
    const selection = editor.selection;
    const selectedText = selection.isEmpty ? "" : editor.document.getText(selection);
    const relPath = vscode.workspace.asRelativePath(editor.document.uri);
    if (selectedText) {
      items.push({
        label: `selection ${relPath}:${selection.start.line + 1}-${selection.end.line + 1}`,
        text: truncateText(selectedText, maxChars),
        priority: 80,
      });
    } else {
      items.push({
        label: `active file ${relPath}`,
        text: truncateText(editor.document.getText(), maxChars),
        priority: 40,
      });
    }
  }

  const diagnostics = collectDiagnosticsSummary();
  if (diagnostics) {
    items.push({ label: "workspace diagnostics", text: diagnostics, priority: 60 });
  }

  const budget = fitToBudget(items, contextBudgetFor(options.contextWindow));
  const sections = budget.included.map((item) => `### ${item.label}\n\`\`\`\n${item.text}\n\`\`\``);
  const omittedNote = budget.omitted.length
    ? `\n_(${budget.omitted.length} context item(s) omitted to fit the model budget: ${budget.omitted
        .map((i) => i.label)
        .join(", ")})_`
    : "";

  return {
    text: sections.join("\n\n") + omittedNote,
    includedLabels: budget.included.map((i) => i.label),
    omittedLabels: budget.omitted.map((i) => i.label),
    usedTokens: budget.usedTokens,
  };
}

async function referenceToText(ref: vscode.ChatPromptReference, maxChars: number): Promise<string> {
  const value = ref.value;
  if (value instanceof vscode.Uri && value.scheme === "file") {
    try {
      const bytes = await vscode.workspace.fs.readFile(value);
      return truncateText(Buffer.from(bytes).toString("utf8"), maxChars);
    } catch {
      return "";
    }
  }
  if (value instanceof vscode.Location) {
    try {
      const doc = await vscode.workspace.openTextDocument(value.uri);
      return truncateText(doc.getText(value.range), maxChars);
    } catch {
      return "";
    }
  }
  if (typeof value === "string") return truncateText(value, maxChars);
  if (value && typeof value === "object" && "value" in value) {
    return truncateText(String((value as { value: unknown }).value), maxChars);
  }
  return "";
}

function collectDiagnosticsSummary(): string {
  const entries: string[] = [];
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    const errors = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;
    const warnings = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning).length;
    if (errors === 0 && warnings === 0) continue;
    entries.push(`${vscode.workspace.asRelativePath(uri)}: ${errors} error(s), ${warnings} warning(s)`);
    if (entries.length >= 20) break;
  }
  return entries.join("\n");
}
