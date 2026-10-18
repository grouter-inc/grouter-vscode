import * as vscode from "vscode";
import { registerParticipant, disposeSessions } from "./chat/participant";
import { registerCommands } from "./commands";
import { disposeLogger, getLogger } from "./util/logger";

export function activate(context: vscode.ExtensionContext): void {
  const log = getLogger();
  log.info(`[activate] gRouter activating — vscode=${vscode.version} node=${process.version}`);

  registerParticipant(context);
  registerCommands(context);

  log.info("[activate] ready");
}

export function deactivate(): void {
  disposeSessions();
  disposeLogger();
}
