import * as vscode from "vscode";

let channel: vscode.LogOutputChannel | undefined;

/** Shared output channel for gRouter (never log secrets or prompt content at default level). */
export function getLogger(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("gRouter", { log: true });
  }
  return channel;
}

export function disposeLogger(): void {
  channel?.dispose();
  channel = undefined;
}
