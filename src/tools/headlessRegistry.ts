import { ToolRegistry } from "./spec";
import { readFileTool, listDirTool, workspaceTreeTool, searchTextTool, applyPatchTool, writeFileTool } from "./builtin/fileTools";
import { gitStatusTool, gitDiffTool } from "./builtin/gitTools";
import { runCommandTool } from "./builtin/runCommand";
import { runTestsTool } from "./builtin/testTools";
import { findFilesTool, fetchUrlTool } from "./builtin/searchTools";

/**
 * Registry for the standalone MCP server process.
 * Must NOT import any module that depends on the `vscode` API — this code runs
 * in a plain Node process where `require("vscode")` throws.
 */
export function createHeadlessRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(workspaceTreeTool);
  registry.register(searchTextTool);
  registry.register(findFilesTool);
  registry.register(applyPatchTool);
  registry.register(writeFileTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(runCommandTool);
  registry.register(runTestsTool);
  registry.register(fetchUrlTool);
  return registry;
}
