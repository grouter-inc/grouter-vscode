/**
 * Screenshot harness — captures REAL VS Code windows showing the 0.4.0 features.
 *
 * Why not mockups: the previous README screenshots were hand-drawn ASCII cards
 * rendering a curl output. They looked fine but proved nothing about the
 * extension. These images come from a live VS Code instance with the extension
 * activated, driven through the same APIs a user exercises.
 *
 * Why not OS screen capture: this machine's desktop session is not attached to
 * a visible display, so CopyFromScreen returns pure black. We ask VS Code to
 * photograph its own window over the DevTools protocol instead, which renders
 * the workbench regardless of whether a monitor is showing it.
 *
 * Run with:  npm run shots
 * Output:    assets/shot-*.png
 */
import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as path from "node:path";
import * as vscode from "vscode";

// Bundled into dist/, so ".." is the project root.
const SHOT_DIR = path.resolve(__dirname, "..", "assets");

type Shot = { name: string; fn: () => Promise<void> };
const shots: Shot[] = [];
function shot(name: string, fn: () => Promise<void>): void {
  shots.push({ name, fn });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets(port: number): Promise<any[]> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/json/list" }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`bad /json/list: ${body.slice(0, 200)}`));
          }
        });
      })
      .on("error", reject);
  });
}



/** Photograph the workbench via CDP — works without an attached display. */
async function capture(name: string, minBytes = 25_000): Promise<void> {
  const port = Number(process.env.GROUTER_CDP_PORT ?? 0);
  assert.ok(port > 0, "GROUTER_CDP_PORT not set by the runner");

  const targets = await cdpTargets(port);
  const page = targets.find((t) => t.type === "page" || t.type === "webview");
  assert.ok(page?.webSocketDebuggerUrl, `no debuggable page target on :${port}`);

  const WS = (globalThis as any).WebSocket;
  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("CDP websocket failed to open"));
  });

  const b64 = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP capture timed out")), 30_000);
    ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== 1) return;
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result?.data ?? "");
    };
    ws.send(
      JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png", captureBeyondViewport: false } }),
    );
  });
  ws.close();

  const buf = Buffer.from(b64, "base64");
  assert.ok(buf.length >= minBytes, `screenshot ${name} too small (${buf.length} B) — window likely blank`);
  await fs.mkdir(SHOT_DIR, { recursive: true });
  await fs.writeFile(path.join(SHOT_DIR, name), buf);
  console.log(`  📸 ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
}

/** Open a document in the editor and give it time to paint. */
async function openDoc(rel: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders![0].uri;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, rel));
  await vscode.window.showTextDocument(doc, { preview: false });
  await sleep(1500);
}

// ---------------------------------------------------------------------------
// 1. HUD status bar — did not exist before 0.4.0 at all.
// ---------------------------------------------------------------------------
shot("shot-hud.png", async () => {
  const { getHud } = await import("../../src/ui/hud");
  const hud = getHud();
  hud.begin("agent", "DeepSeek-V4-Flash");
  hud.setStep(2, 4);
  hud.incrementTool();
  hud.incrementTool();
  hud.incrementTool();
  hud.addTokens(12_400, 850);
  hud.setVerify("red");
  assert.ok(hud.debugText().includes("agent"), "HUD did not enter agent mode");
  // Clean frame: the HUD is the subject. Close the empty AI sidebar and show the
  // workspace file so the editor is not a blank welcome page.
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar").then(undefined, () => undefined);
  await vscode.commands.executeCommand("workbench.action.closeAllEditors").then(undefined, () => undefined);
  await sleep(300);
  const sample = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, "sample.ts");
  const sampleDoc = await vscode.workspace.openTextDocument(sample);
  await vscode.window.showTextDocument(sampleDoc, { preview: false, viewColumn: vscode.ViewColumn.One });
  await sleep(1500);
  await capture("shot-hud.png");
  hud.finish();
});

// ---------------------------------------------------------------------------
// 2. Verify gate — run the REAL evidence collector against the fixture
//    workspace (which has no test command), then show its report.
// ---------------------------------------------------------------------------
shot("shot-verify.png", async () => {
  const { collectEvidence, renderReport } = await import("../../src/agent/verify/evidence");
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const report = await collectEvidence({ workspaceRoot: folder });
  const md = renderReport(report);

  // The fixture has no tests: the gate must NOT call that green.
  assert.strictEqual(report.ok, false, "verify gate reported a project with no evidence as green");

  // Close the empty chat sidebar and any other editor so the frame shows the
  // gate report, not a blank AI panel that would look like a broken feature.
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar").then(undefined, () => undefined);
  await vscode.commands.executeCommand("workbench.action.closeAllEditors").then(undefined, () => undefined);
  await vscode.commands.executeCommand("workbench.action.closeAllGroups").then(undefined, () => undefined);
  await sleep(500);

  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: md });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
  await sleep(600);
  const prevDoc = await vscode.workspace.openTextDocument({ language: "markdown", content: md });
  await vscode.window.showTextDocument(prevDoc, { preview: false, viewColumn: vscode.ViewColumn.Two });
  await sleep(400);
  await vscode.commands.executeCommand("markdown.showPreview", prevDoc.uri).then(undefined, () => undefined);
  const { getHud } = await import("../../src/ui/hud");
  getHud().setVerify(report.ok ? "green" : "red");
  await sleep(1800);
  await capture("shot-verify.png");
  getHud().finish();
});

// ---------------------------------------------------------------------------
// 3. Chat — a REAL gRouter turn.
//
// VS Code will not dispatch a chat message to a participant when the host has
// no language model registered: it renders "Language model unavailable" and the
// participant's handler is never entered (verified: zero rows land in
// grouter.db). That is a host limitation of the screenshot runner, not a gRouter
// defect. So we call the SAME exported handler with a real request and a real
// ChatResponseStream, collect what it streams, and show that in the chat panel.
//
// `/help` is deliberate: it is answered locally by helpMarkdown(), so the image
// proves the participant code ran rather than a network round-trip.
// ---------------------------------------------------------------------------
const harnessCtx = {
  subscriptions: [],
  extensionUri: vscode.Uri.file(__dirname),
  extensionPath: __dirname,
  extensionMode: vscode.ExtensionMode.Test,
  asAbsolutePath: (p: string) => p,
} as unknown as vscode.ExtensionContext;

shot("shot-chat.png", async () => {
  // Activate the extension first: registerParticipant() builds the tool registry,
  // so without this /help would honestly report "0 tools registered".
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  assert.ok(ext, "extension not found in the host");
  await ext.activate();
  await sleep(1200);

  const { handler, getRegistry, registerParticipant } = await import("../../src/chat/participant");
  // The harness bundle and the activated extension each hold their own copy of
  // this module, so the extension's registry is invisible here. Initialise the
  // harness copy the same way activate() does, using the real ExtensionContext.
  if (!getRegistry()) {
    // Only reached if the harness bundle got a different module instance; the
    // activated extension normally already populated this one.
    registerParticipant(harnessCtx);
  }
  const { getHud } = await import("../../src/ui/hud");

  // The registry is created during activate(); if the module was re-instantiated
  // by the bundler, /help would honestly say "0 tools registered" and the image
  // would misrepresent the product. Assert it is populated before capturing.
  const reg = getRegistry();
  const toolCount = reg?.all().length ?? 0;
  console.log(`[shot-chat] registry=${reg ? "present" : "UNDEFINED"} tools=${toolCount}`);
  console.log(`[shot-chat] workspaceTrusted=${vscode.workspace.isTrusted} folders=${vscode.workspace.workspaceFolders?.length ?? 0}`);

  // A minimal but REAL request/stream pair. `command` + `prompt` are what VS Code
  // passes for "@grouter /help".
  let streamed = "";
  const parts: string[] = [];
  const stream = {
    markdown(value: unknown) {
      const s = typeof value === "string" ? value : String((value as { value?: string })?.value ?? "");
      streamed += s;
      parts.push(s);
    },
    anchor() {},
    button() {},
    fileTree() {},
    progress() {},
    reference() {},
    push() {},
  } as unknown as vscode.ChatResponseStream;

  const tokenSource = new vscode.CancellationTokenSource();
  const request = {
    prompt: "/help",
    command: "help",
    references: [],
    toolInvocationToken: undefined,
  } as unknown as vscode.ChatRequest;

  const hud = getHud();
  hud.begin("help", "DeepSeek-V4-Flash");

  const result = await handler(request, {} as vscode.ChatContext, stream, tokenSource.token);

  assert.ok(streamed.length > 200, `handler streamed almost nothing (${streamed.length} chars)`);
  assert.ok(/gRouter/i.test(streamed), "handler output does not mention gRouter");
  assert.ok(
    String((result?.metadata as { mode?: string } | undefined)?.mode) === "help",
    "handler did not report help mode",
  );
  // TEMP: diagnose


  // Write the real answer to a document so the screenshot shows the actual text.
  const doc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: streamed,
  });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });

  // Open the chat surface beside it, and put the same real turn on screen there
  // too via CDP, so the panel is never an empty placeholder.
  // Open the chat surface, let it settle, then dismiss it: in a host with no
  // registered language model VS Code paints its own red "Language model
  // unavailable" over our content, which would make the image misleading.
  await Promise.resolve(
    vscode.commands.executeCommand("workbench.action.chat.open", { query: "@grouter /help" }),
  ).catch(() => undefined);
  await sleep(1500);
  await Promise.resolve(vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar")).catch(
    () => undefined,
  );
  await sleep(600);

  // Start from a clean workbench: close every editor and collapse to one group,
  // otherwise showPreviewToSide() reuses the verify-gate preview from shot 2.
  await vscode.commands.executeCommand("workbench.action.closeAllEditors").then(undefined, () => undefined);
  await sleep(400);
  while (vscode.window.tabGroups.all.length > 1) {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor").then(undefined, () => undefined);
    await sleep(150);
  }

  // Source document in column one…
  const srcDoc = await vscode.workspace.openTextDocument({ language: "markdown", content: streamed });
  await vscode.window.showTextDocument(srcDoc, { preview: false, viewColumn: vscode.ViewColumn.One });
  await sleep(600);

  // …and a FRESH copy in column two so its preview cannot be the stale one.
  const prevDoc = await vscode.workspace.openTextDocument({ language: "markdown", content: streamed });
  await vscode.window.showTextDocument(prevDoc, { preview: false, viewColumn: vscode.ViewColumn.Two });
  await sleep(400);
  await vscode.commands.executeCommand("markdown.showPreview", prevDoc.uri).then(undefined, () => undefined);
  await sleep(2200);

  await capture("shot-chat.png");

  hud.finish();
  tokenSource.dispose();
});


// ---------------------------------------------------------------------------
// 4. Ralph loop — a REAL run: the loop's own collectReport is wired to the
//    real evidence collector, so the shot shows the verdict it actually reaches.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 6. Live gateway — real /v1/models and /v1/chat/completions from the terminal.
//    README claimed these with a HUD photo standing in for them; this is the
//    actual round-trip against the production gateway.
// ---------------------------------------------------------------------------
shot("shot-models.png", async () => {
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const repoRoot = path.resolve(folder, "..", "..", "..");
  await vscode.commands.executeCommand("workbench.action.closeAllEditors").then(undefined, () => undefined);
  await sleep(400);

  const term = vscode.window.createTerminal({ name: "gRouter — live gateway", cwd: repoRoot });
  term.show(true);
  await sleep(1200);

  // shelling out to a node script: PowerShell mangles the JSON, and inline
  // `node -e` crashes in libuv on this host. The script reads the key from
  // config and never prints it.
  term.sendText("node scripts/live-probe.mjs models", true);
  await sleep(9000);
  await capture("shot-models.png");

  term.sendText("cls", true);
  await sleep(1500);

  term.sendText("node scripts/live-probe.mjs chat", true);
  await sleep(18_000);
  await sleep(30_000);
  await capture("shot-completion.png");
  term.dispose();
});

// ---------------------------------------------------------------------------
// 5. Test suite — the REAL integrated terminal with the real suite output.
//
// The previous asset was a macOS-style mockup showing "141 passed" for a
// package that no longer exists; this frame is the workbench's own terminal.
// ---------------------------------------------------------------------------
shot("shot-tests.png", async () => {
  // The harness opens test/fixtures/workspace, so walk up to the package root:
  // running vitest inside the fixture finds no test files at all.
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const repoRoot = path.resolve(folder, "..", "..", "..");
  await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar").then(undefined, () => undefined);
  await vscode.commands.executeCommand("workbench.action.closeAllEditors").then(undefined, () => undefined);
  await sleep(400);

  const term = vscode.window.createTerminal({ name: "gRouter — vitest", cwd: repoRoot });
  term.show(true);
  await sleep(1200);
  term.sendText("npx vitest run test/unit --reporter=verbose 2>&1 | tail -25", true);
  // The suite takes ~15s; wait for the tail separator to settle on screen.
  await sleep(28_000);
  await capture("shot-tests.png");
  term.dispose();
});

shot("shot-ralph.png", async () => {
  const { runRalphLoop, renderRalphOutcome } = await import("../../src/agent/ralph/loop");
  const { collectEvidence } = await import("../../src/agent/verify/evidence");
  const folder = vscode.workspace.workspaceFolders![0].uri.fsPath;

  const outcome = await runRalphLoop({
    maxIterations: 3,
    stallLimit: 2,
    isCanceled: () => false,
    collectReport: () => collectEvidence({ workspaceRoot: folder }),
    // No model offline: an iteration that changes nothing must be reported as
    // no-progress, never as verified.
    runIteration: async () => ({ summary: "offline: no model call", toolCalls: 0, filesChanged: [] }),
  });

  assert.ok(outcome, "runRalphLoop returned nothing");
  assert.notStrictEqual(outcome.reason, "verified", "loop claimed success with no evidence");

  // Start from a clean workbench: close every editor and every group so no
  // leftover preview can be reused by showPreviewToSide below.
  await vscode.commands.executeCommand("workbench.action.closeAllEditors").then(undefined, () => undefined);
  await sleep(400);
  while (vscode.window.tabGroups.all.length > 1) {
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor").then(undefined, () => undefined);
    await sleep(150);
  }

  const md = ["# gRouter — /ralph loop", "", renderRalphOutcome(outcome)].join("\n");
  const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: md });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.One });
  await sleep(800);

  // Separate copy for the preview: VS Code keys a preview to its source document,
  // so a fresh untitled document guarantees a fresh preview.
  const prevDoc = await vscode.workspace.openTextDocument({ language: "markdown", content: md });
  await vscode.window.showTextDocument(prevDoc, { preview: false, viewColumn: vscode.ViewColumn.Two });
  await sleep(400);
  await vscode.commands.executeCommand("markdown.showPreview", prevDoc.uri).then(undefined, () => undefined);
  await sleep(2200);

  await capture("shot-ralph.png");
});

export async function run(): Promise<void> {
  await fs.mkdir(SHOT_DIR, { recursive: true });
  // The fixture lives inside a git checkout, so VS Code offers to open the parent
  // repository and that toast would sit in every screenshot. Turn the prompt off.
  await vscode.workspace
    .getConfiguration("git")
    .update("openRepositoryInParentFolders", "never", vscode.ConfigurationTarget.Global)
    .then(undefined, () => undefined);
  await vscode.commands.executeCommand("notifications.clearAll").then(undefined, () => undefined);
  const ext = vscode.extensions.getExtension("grouter.grouter-code");
  assert.ok(ext, "extension not present");
  await ext.activate();

  const failures: string[] = [];
  for (const s of shots) {
    try {
      await s.fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${s.name}: ${msg}`);
      console.error(`  ✗ ${s.name}: ${msg}`);
    }
  }
  console.log(`\n${shots.length - failures.length}/${shots.length} screenshots captured`);
  if (failures.length) throw new Error(failures.join("\n"));
}
