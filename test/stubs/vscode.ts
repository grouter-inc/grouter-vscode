export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export const languages = {
  getDiagnostics: () => [] as Array<[unknown, unknown[]]>,
};

export const workspace = {
  asRelativePath: (p: unknown) => String(p),
  workspaceFolders: undefined as unknown,
  isTrusted: true,
};

export const window = {
  activeTextEditor: undefined as unknown,
  tabGroups: { all: [] as unknown[] },
  createStatusBarItem: () => ({ text: "", tooltip: "", command: "", show: () => undefined, dispose: () => undefined }),
  showQuickPick: async () => undefined,
  showWarningMessage: () => undefined,
};

export class TabInputText {
  constructor(public readonly uri: unknown) {}
}

export const StatusBarAlignment = { Left: 1, Right: 2 };

export class CancellationTokenSource {
  token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) };
  cancel(): void {
    this.token.isCancellationRequested = true;
  }
  dispose(): void {
    // no-op in tests
  }
}

export class Uri {
  static file(p: string) {
    return { scheme: "file", fsPath: p, path: p, toString: () => `file://${p}` };
  }
  static parse(s: string) {
    return { scheme: "test", fsPath: s, path: s, toString: () => s };
  }
}

export const ProgressLocation = { Notification: 15, Window: 10, SourceControl: 1 };

export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
};

export const lm = {
  registerTool: () => ({ dispose: () => undefined }),
  registerMcpServerDefinitionProvider: () => ({ dispose: () => undefined }),
};

export const chat = {
  createChatParticipant: () => ({ dispose: () => undefined }),
};

export const env = {
  createTelemetryLogger: () => ({ logUsage: () => undefined, logError: () => undefined, dispose: () => undefined }),
};

export const ChatRequestTurn = class {};
export const ChatResponseTurn = class {};
export const ChatResponseMarkdownPart = class {};
export const LanguageModelTextPart = class {};
export const LanguageModelToolResult = class {};
