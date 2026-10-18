import { ToolRegistry } from "./spec";
import { readFileTool, listDirTool, workspaceTreeTool, searchTextTool, applyPatchTool, writeFileTool } from "./builtin/fileTools";
import { gitStatusTool, gitDiffTool } from "./builtin/gitTools";
import { getDiagnosticsTool, getOpenEditorsTool, getSelectionTool, runCommandTool } from "./builtin/vscodeTools";
import {
  getDebugStateTool,
  listBreakpointsTool,
  setBreakpointTool,
  removeBreakpointTool,
  launchDebugTool,
} from "./builtin/debugTools";
import { runTestsTool } from "./builtin/testTools";
import { verifyWorkTool } from "./builtin/verifyTools";
import { findFilesTool, fetchUrlTool } from "./builtin/searchTools";
import { createSkillTools } from "./builtin/skillTools";
import { createDelegateTool, type DelegationContext } from "./builtin/delegateTool";
import type { SkillEngine } from "../skills/engine";

export interface RegistryOptions {
  skillEngine?: SkillEngine;
  sessionId?: () => string;
  delegation?: DelegationContext;
  /** Skip tools that require the VS Code API (for the standalone MCP server). */
  headless?: boolean;
}

export function createDefaultRegistry(options: RegistryOptions = {}): ToolRegistry {
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
  registry.register(verifyWorkTool);
  registry.register(fetchUrlTool);

  if (!options.headless) {
    registry.register(getDiagnosticsTool);
    registry.register(getOpenEditorsTool);
    registry.register(getSelectionTool);
    registry.register(getDebugStateTool);
    registry.register(listBreakpointsTool);
    registry.register(setBreakpointTool);
    registry.register(removeBreakpointTool);
    registry.register(launchDebugTool);
  }

  if (options.skillEngine && options.sessionId) {
    for (const tool of createSkillTools(options.skillEngine, options.sessionId)) {
      registry.register(tool);
    }
  }

  if (options.delegation) {
    registry.register(createDelegateTool(options.delegation));
  }

  return registry;
}
