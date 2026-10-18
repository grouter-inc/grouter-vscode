export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
export const languages = { getDiagnostics: () => [] };
export const workspace = {
  asRelativePath: (p) => String(p),
  workspaceFolders: undefined,
  isTrusted: true,
  fs: { readFile: async () => new Uint8Array() },
  getConfiguration: () => ({ get: () => undefined }),
};
export const window = {
  activeTextEditor: undefined,
  tabGroups: { all: [] },
  createStatusBarItem: () => ({}),
  showQuickPick: async () => undefined,
  showWarningMessage: () => undefined,
  showTextDocument: async () => undefined,
  openTextDocument: async () => ({}),
};
export const commands = { registerCommand: () => ({ dispose: () => undefined }) };
export const lm = { registerTool: () => ({ dispose: () => undefined }), registerMcpServerDefinitionProvider: () => ({ dispose: () => undefined }) };
export const chat = { createChatParticipant: () => ({ dispose: () => undefined }) };
export const env = { createTelemetryLogger: () => ({}) };
export const debug = {
  activeDebugSession: undefined,
  breakpoints: [],
  addBreakpoints: () => undefined,
  removeBreakpoints: () => undefined,
  startDebugging: async () => true,
};
export class Uri {
  static file(p) { return { scheme: "file", fsPath: p, path: p, toString: () => `file://${p}` }; }
  static parse(s) { return { scheme: "test", fsPath: s, path: s, toString: () => s }; }
  static joinPath(base, ...parts) { return { scheme: "file", fsPath: [base.fsPath ?? base, ...parts].join("/") }; }
}
export class TabInputText { constructor(uri) { this.uri = uri; } }
export class CancellationTokenSource { constructor() { this.token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => undefined }) }; } cancel() {} dispose() {} }
export class LanguageModelTextPart { constructor(value) { this.value = value; } }
export class LanguageModelToolResult { constructor(parts) { this.content = parts; } }
export class MarkdownString { constructor(value) { this.value = value; } }
export class Position { constructor(line, character) { this.line = line; this.character = character; } }
export class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
export class SourceBreakpoint { constructor(location, enabled, condition) { this.location = location; this.enabled = enabled; this.condition = condition; } }
export class FunctionBreakpoint { constructor(functionName, enabled, condition) { this.functionName = functionName; this.enabled = enabled; this.condition = condition; } }
export const ChatRequestTurn = class {};
export const ChatResponseTurn = class {};
export const ChatResponseMarkdownPart = class {};
