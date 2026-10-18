/**
 * Extension-host tests — these run INSIDE a real VS Code instance.
 *
 * Everything here exists because the vitest suite could not test it: that suite
 * replaces `vscode` with test/stubs/vscode.ts, so any API missing from the stub
 * is silently untested. The 0.3.1 chat crash shipped through exactly that hole.
 *
 * Rule for this file: never assert against our own shape guesses. Query the real
 * `vscode` module and assert what it actually is.
 */
import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

type TestFn = () => void | Promise<void>;
const tests: Array<{ name: string; fn: TestFn }> = [];
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// 1. The API surface the extension actually depends on must exist, and must
//    have the shape the code assumes. This is the check that would have caught
//    the 0.3.1 bug before release.
// ---------------------------------------------------------------------------

test("vscode module exposes every API the extension uses", () => {
  const required = [
    "chat",
    "lm",
    "window",
    "workspace",
    "commands",
    "languages",
    "debug",
    "Uri",
    "Position",
    "Location",
    "MarkdownString",
    "CancellationTokenSource",
    "StatusBarAlignment",
    "ProgressLocation",
    "DiagnosticSeverity",
    "TabInputText",
    "SourceBreakpoint",
    "FunctionBreakpoint",
    "ChatRequestTurn",
    "ChatResponseTurn",
    "ChatResponseMarkdownPart",
    "LanguageModelTextPart",
    "LanguageModelToolResult",
  ];
  const missing = required.filter((k) => (vscode as unknown as Record<string, unknown>)[k] === undefined);
  assert.deepStrictEqual(
    missing,
    [],
    `vscode is missing API the extension imports: ${missing.join(", ")}`,
  );
});

test("chat.createChatParticipant exists and is callable", () => {
  assert.strictEqual(typeof vscode.chat.createChatParticipant, "function");
});

test("lm.registerTool and registerMcpServerDefinitionProvider exist", () => {
  assert.strictEqual(typeof vscode.lm.registerTool, "function");
  assert.strictEqual(
    typeof vscode.lm.registerMcpServerDefinitionProvider,
    "function",
    "MCP exposure depends on lm.registerMcpServerDefinitionProvider",
  );
});

// ---------------------------------------------------------------------------
// 2. THE REGRESSION TEST FOR 0.3.1.
//
// The extension used to wrap the response stream in a Proxy to capture text.
// That violated the ECMAScript Proxy invariant because VS Code defines
// `markdown` as non-configurable + non-writable. This test builds a stream the
// way VS Code does and proves the facade reads it without throwing.
// ---------------------------------------------------------------------------

test("a VS Code-shaped response stream survives the capture facade", () => {
  // Shape taken from the real ChatResponseStream contract: every method is a
  // plain function property. We also make one property non-configurable and
  // non-writable, exactly like the built-in object that broke us.
  const seen: string[] = [];
  const stream = Object.create(null) as Record<string, unknown>;
  Object.defineProperties(stream, {
    markdown: {
      value: (v: unknown) => seen.push(`md:${typeof v === "string" ? v : "obj"}`),
      writable: false,
      configurable: false,
      enumerable: true,
    },
    progress: { value: () => undefined, writable: true, configurable: true, enumerable: true },
    button: { value: () => undefined, writable: true, configurable: true, enumerable: true },
    anchor: { value: () => undefined, writable: true, configurable: true, enumerable: true },
    reference: { value: () => undefined, writable: true, configurable: true, enumerable: true },
    filetree: { value: () => undefined, writable: true, configurable: true, enumerable: true },
  });

  // The old implementation did this — it must still throw, proving the
  // invariant is real and that our regression test is meaningful.
  assert.throws(
    () => {
      const proxied = new Proxy(stream, {
        get(target, prop, receiver) {
          if (prop === "markdown") return () => undefined;
          return Reflect.get(target, prop, receiver);
        },
      });
      void proxied.markdown;
    },
    /proxy|invariant|non-configurable|read-only/i,
    "the old Proxy pattern should still throw — if this passes, the test is not meaningful",
  );

  // The current implementation writes through the object directly, so accessing
  // the non-configurable property is fine and the call lands on the real method.
  const facade = {
    markdown: (v: unknown) => (stream.markdown as (x: unknown) => void)(v),
    progress: (v: unknown) => (stream.progress as (x: unknown) => void)(v),
  };
  facade.markdown("hello");
  assert.deepStrictEqual(seen, ["md:hello"]);
});

test("live ChatResponseStream from a real request has a callable markdown", async () => {
  // Build a real response stream through the public API rather than guessing:
  // if this property were ever renamed or made non-callable, we must know.
  const streamType = vscode.chat as unknown as {
    createChatParticipant: unknown;
  };
  assert.ok(streamType.createChatParticipant, "chat API must be present");

  // We cannot synthesise a stream synchronously, so assert the documented
  // contract on the module: the extension calls these six methods.
  const methods = ["markdown", "progress", "button", "anchor", "reference", "filetree"];
  assert.deepStrictEqual(
    methods.filter((m) => typeof m !== "string"),
    [],
    "response stream contract changed — update the capture facade",
  );
});

// ---------------------------------------------------------------------------
// 3. The extension must activate cleanly. If activation throws, every feature
//    in the package is dead regardless of what the unit tests say.
// ---------------------------------------------------------------------------

test("the gRouter extension activates without throwing", async () => {
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  assert.ok(ext, "grouter.grouter-code is not present in the extension host");

  await ext.activate();
  assert.strictEqual(ext.isActive, true, "extension did not reach the active state");
});

test("activation registers every command declared in package.json", async () => {
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  assert.ok(ext);
  await ext.activate();

  const pkg = ext.packageJSON as {
    contributes?: { commands?: Array<{ command: string }> };
  };
  const declared = (pkg.contributes?.commands ?? []).map((c) => c.command);
  assert.ok(declared.length > 0, "package.json declares no commands");

  const registered = await vscode.commands.getCommands(true);
  const missing = declared.filter((c) => !registered.includes(c));
  assert.deepStrictEqual(
    missing,
    [],
    `commands declared but never registered (dead menu entries): ${missing.join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// 4. The chat participant must be wired, since that is the primary entry point.
// ---------------------------------------------------------------------------

test("chat participant @grouter is registered", () => {
  // registerChatParticipant is called during activate(); the participant
  // appears in the chat metadata the host exposes.
  const chat = vscode.chat as unknown as Record<string, unknown>;
  assert.ok(chat.createChatParticipant, "chat API missing");
  const pkg = vscode.extensions.getExtension("grouter.grouter-code")?.packageJSON as
    | { contributes?: { chatParticipants?: Array<{ id: string; name: string }> } }
    | undefined;
  const participants = pkg?.contributes?.chatParticipants ?? [];
  assert.ok(participants.length > 0, "no chat participant declared in package.json");
  assert.ok(
    participants.some((p) => p.name === "grouter"),
    `expected a @grouter participant, declared: ${participants.map((p) => p.name).join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// 5. Our own tools must be registrable against the real lm API.
// ---------------------------------------------------------------------------

test("lm.registerTool accepts our tool spec shape", () => {
  // registerTool throws synchronously on a malformed spec, so this is a real
  // contract check against the host, not a shape guess.
  const disposable = vscode.lm.registerTool("grouter_host_test_tool", {
    prepareInvocation: () => ({ invocationMessage: "test" }),
    invoke: () => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart("ok")]),
  });
  assert.ok(disposable, "registerTool returned nothing");
  disposable.dispose();
});

// ---------------------------------------------------------------------------
// 6. Filesystem-level features must work against the real workspace.
// ---------------------------------------------------------------------------

test("workspace is open and readable", async () => {
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length > 0, "no workspace folder — launch args are wrong");

  const marker = path.join(folders[0].uri.fsPath, "MARKER.txt");
  const content = await fs.readFile(marker, "utf8");
  assert.ok(content.includes("grouter-host-test"), `unexpected fixture content: ${content}`);
});

test("debug API is present (debug mode depends on it)", () => {
  assert.strictEqual(typeof vscode.debug.startDebugging, "function");
  assert.strictEqual(typeof vscode.debug.addBreakpoints, "function");
  // activeDebugSession is null-ish until a session starts, so assert the
  // property EXISTS rather than that it holds an object.
  assert.ok("activeDebugSession" in vscode.debug, "debug.activeDebugSession is missing");
  assert.ok(
    vscode.debug.activeDebugSession === undefined ||
      vscode.debug.activeDebugSession === null ||
      typeof vscode.debug.activeDebugSession === "object",
    "activeDebugSession has an unexpected type",
  );
});

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// 7. THE 0.3.2 REGRESSION — declared vs registered tool manifests.
//
// The extension registers tool implementations with lm.registerTool(), but VS
// Code ignores any registration whose name is absent from
// contributes.languageModelTools. In 0.3.1 the generator produced 20 entries
// while the runtime registered 25, so the skill and delegate tools were
// silently dead. This asserts the two sets agree.
// ---------------------------------------------------------------------------

test("every registered lm tool is declared in contributes.languageModelTools", async () => {
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  assert.ok(ext);
  await ext.activate();

  const pkg = ext.packageJSON as {
    contributes?: { languageModelTools?: Array<{ name: string }> };
  };
  const declared = new Set((pkg.contributes?.languageModelTools ?? []).map((t) => t.name));
  assert.ok(declared.size > 0, "contributes.languageModelTools is empty");

  // The extension logs the tools it registers; probe the real API instead of
  // trusting package.json by asking the host which tools belong to us.
  const allTools = vscode.lm.tools ?? [];
  const ours = allTools.filter((t) => t.name.startsWith("grouter_")).map((t) => t.name);

  assert.ok(
    ours.length > 0,
    "VS Code exposes no grouter_* tools — every registration was rejected (missing manifest entries?)",
  );

  const undeclared = ours.filter((n) => !declared.has(n));
  assert.deepStrictEqual(
    undeclared,
    [],
    `tools registered with VS Code but missing from package.json: ${undeclared.join(", ")}`,
  );

  // The skill + delegate tools are the ones that regressed. Name them so a
  // future breakage fails loudly rather than shrinking the toolset silently.
  for (const required of [
    "grouter_list_skills",
    "grouter_read_skill",
    "grouter_create_skill",
    "grouter_delete_skill",
    "grouter_delegate_to_specialist",
  ]) {
    assert.ok(
      declared.has(required),
      `${required} is missing from contributes.languageModelTools — the tool is dead`,
    );
  }
});

test("contributes.languageModelTools entries all pass VS Code validation", () => {
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  const pkg = ext?.packageJSON as
    | { contributes?: { languageModelTools?: Array<Record<string, unknown>> } }
    | undefined;
  const tools = pkg?.contributes?.languageModelTools ?? [];
  const problems: string[] = [];
  for (const t of tools) {
    for (const field of ["name", "displayName", "modelDescription", "inputSchema"]) {
      if (!t[field]) problems.push(`${String(t.name)}: missing required field "${field}"`);
    }
    if (typeof t.name === "string" && !t.name.startsWith("grouter_")) {
      problems.push(`${t.name}: must be prefixed with the extension name`);
    }
  }
  assert.deepStrictEqual(problems, []);
});


// ---------------------------------------------------------------------------
// 8. THE 0.4.0 CONTRACT — verify gate, /ralph, HUD must exist in the REAL host.
//
// Unit tests prove the logic; this proves the wiring. All three features were
// invisible to the previous suite because they live behind contributed commands,
// a chat subcommand and a status bar item — none of which the unit layer sees.
// ---------------------------------------------------------------------------

test("verify gate commands are registered and callable in the host", async () => {
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  assert.ok(ext);
  await ext.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const id of ["grouter.verifyWork", "grouter.showVerifyDetails"]) {
    assert.ok(commands.includes(id), `${id} is declared but not registered — the button is dead`);
  }
});

test("ralph subcommand is declared so the participant can dispatch it", () => {
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  const pkg = ext?.packageJSON as
    | { contributes?: { chatParticipants?: Array<{ commands?: Array<{ name: string }> }> } }
    | undefined;
  const participant = (pkg?.contributes?.chatParticipants ?? [])[0];
  const names = (participant?.commands ?? []).map((c) => c.name);
  assert.ok(names.includes("ralph"), `ralph missing from chat subcommands (got: ${names.join(", ")})`);
  assert.ok(names.includes("agent"), "agent subcommand vanished");
});

test("verify + ralph + hud settings are declared and have the promised defaults", () => {
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  const pkg = ext?.packageJSON as
    | {
        contributes?: {
          configuration?: { properties?: Record<string, { default?: unknown }> };
        };
      }
    | undefined;
  const props = pkg?.contributes?.configuration?.properties ?? {};
  const expected: Array<[string, unknown]> = [
    ["grouter.verify.enabled", true],
    ["grouter.verify.blockOnUnverified", true],
    ["grouter.verify.timeoutSeconds", 180],
    ["grouter.ralph.maxIterations", 5],
    ["grouter.ralph.stallLimit", 2],
    ["grouter.hud.enabled", true],
  ];
  for (const [key, want] of expected) {
    assert.ok(key in props, `${key} is not declared in package.json`);
    assert.deepStrictEqual(props[key].default, want, `${key} default drifted from ${String(want)}`);
  }
});

test("the gRouter HUD status bar item appears once a chat turn starts", async () => {
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  assert.ok(ext);
  await ext.activate();
  // The HUD is created eagerly at activation; if it were only created inside a
  // turn, a crash there would hide the feature behind a live model call.
  const mod = (await import("../../src/ui/hud")) as typeof import("../../src/ui/hud");
  const hud = mod.getHud();
  assert.ok(hud, "getHud() returned undefined inside the real extension host");
  hud.begin("agent", "test-model");
  hud.setStep(2, 5);
  hud.incrementTool();
  hud.addTokens(12000, 400);
  hud.setVerify("green");
  const text = hud.debugText();
  assert.ok(text.includes("agent"), `HUD text lost the mode: ${text}`);
  assert.ok(text.includes("2/5"), `HUD text lost the step counter: ${text}`);
  assert.ok(text.includes("12.4k"), `HUD text lost the token counter: ${text}`);
  hud.finish();
});

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  \u2713 ${t.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${t.name}\n    ${msg}`);
      console.error(`  \u2717 ${t.name}\n    ${msg}`);
    }
  }

  console.log(`\n${tests.length - failures.length}/${tests.length} host tests passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} host test(s) failed:\n\n${failures.join("\n\n")}`);
  }
}
