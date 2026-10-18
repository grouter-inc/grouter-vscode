import * as vscode from "vscode";
import * as path from "node:path";
import { ensureConfigFile, configPath, saveConfig } from "../config/homeConfig";
import { loadConfigWithSettings as loadConfig } from "../config/settingsOverride";
import { listModels } from "../llm/gateway";
import { getLogger } from "../util/logger";

export function registerCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.setApiKey", async () => {
      ensureConfigFile();
      const key = await vscode.window.showInputBox({
        title: "gRouter — API Key",
        prompt: `Paste your gRouter API key (starts with grx_). Buy one from https://t.me/grouteerbot. Saved to ${configPath()}.`,
        password: true,
        ignoreFocusOut: true,
        value: "",
      });
      if (!key) return;
      saveConfig({ apiKey: key.trim() });
      getLogger().info(`[config] API key saved to ${configPath()}`);
      void vscode.window.showInformationMessage(`gRouter: API key saved to ${configPath()}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.testConnection", async () => {
      const config = loadConfig();
      if (!config.apiKey) {
        void vscode.window.showWarningMessage(
          `gRouter: no API key yet. Buy one from https://t.me/grouteerbot, then run “gRouter: Set API Key”.`,
        );
        return;
      }
      try {
        const models = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "gRouter: testing gateway…" },
          () => listModels(config),
        );
        const configured = models.some((m) => m.id === config.model);
        const detail = `${models.length} models available · configured model “${config.model}” ${configured ? "found" : "NOT FOUND"}`;
        getLogger().info(`[config] testConnection OK — ${detail}`);
        void vscode.window.showInformationMessage(`gRouter: gateway OK — ${detail}`);
      } catch (err) {
        getLogger().error(`[config] testConnection failed: ${String(err)}`);
        void vscode.window.showErrorMessage(`gRouter: gateway check failed — ${String(err)}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.verifyWork", async () => {
      // Manual trigger for the verify gate: run the real checks and report.
      const { collectEvidence, renderReport, reportStatusIcon } = await import("../agent/verify/evidence");
      const { getHud } = await import("../ui/hud");
      const config = loadConfig();
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        void vscode.window.showWarningMessage("gRouter: open a workspace folder first.");
        return;
      }
      const hud = getHud();
      const report = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "gRouter: verifying (tests + typecheck)…" },
        () =>
          collectEvidence({
            workspaceRoot,
            testCommand: config.verify.testCommand || undefined,
            typecheckCommand: config.verify.typecheckCommand || undefined,
            timeoutSeconds: config.verify.timeoutSeconds,
          }),
      );
      hud.setVerify(report.results.every((r) => r.skipped) ? "skipped" : report.ok ? "green" : "red");
      getLogger().info(`[verify] manual run ok=${report.ok} ${report.blocker ?? ""}`);

      // Immediate feedback: opening a report alone made a red run look like a
      // success, because nothing told the user the checks had failed.
      const icon = reportStatusIcon(report);
      if (report.results.every((r) => r.skipped)) {
        void vscode.window.showWarningMessage(
          "gRouter: tidak ada perintah test/typecheck yang terdeteksi — tidak ada yang diverifikasi.",
        );
      } else if (report.ok) {
        void vscode.window.showInformationMessage(`${icon} gRouter: verifikasi hijau — test & typecheck lulus.`);
      } else {
        void vscode.window.showErrorMessage(`${icon} gRouter: verifikasi merah — ${report.blocker ?? "lihat laporan"}`);
      }

      const doc = await vscode.workspace.openTextDocument({
        content:
          [
            `# gRouter — Verify report`,
            ``,
            `Status: ${icon} ${report.ok ? "**hijau** — semua bukti lulus" : "**merah** — ada bukti yang gagal"}`,
            ``,
            renderReport(report),
            report.blocker ? `
**Blocker:** ${report.blocker}` : "",
          ].join("\n"),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.showVerifyDetails", async () => {
      // Re-opens the last verification report. The gate renders it inline after a
      // turn, but the chat scrolls; this is the "show me that again" path.
      const { getLastVerifyReport, wasLastVerifyBlocked } = await import("../chat/participant");
      const { renderReport } = await import("../agent/verify/evidence");
      const report = getLastVerifyReport();
      if (!report) {
        void vscode.window.showInformationMessage(
          "gRouter: no verification has run yet in this window. Use \"gRouter: Verify Work\" to run one now.",
        );
        return;
      }
      const blocked = wasLastVerifyBlocked();
      const doc = await vscode.workspace.openTextDocument({
        content: [
          `# gRouter — Verify report`,
          ``,
          `Status: ${blocked || !report.ok ? "**REJECTED** — a completion claim was not backed by evidence" : "**accepted** — evidence is green"}`,
          ``,
          renderReport(report),
          report.blocker ? `\n**Blocker:** ${report.blocker}` : "",
        ].join("\n"),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.showDiagnostics", () => {
      const log = getLogger();
      const config = loadConfig();
      log.info(
        `[diag] extension=${context.extension.id} vscode=${vscode.version} node=${process.version} config=${configPath()} model=${config.model} key=${config.apiKey ? "present" : "missing"}`,
      );
      log.show(true);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.selectModel", async () => {
      const config = loadConfig();
      if (!config.apiKey) {
        void vscode.window.showWarningMessage(`gRouter: no API key. Buy one from https://t.me/grouteerbot, then run "gRouter: Set API Key".`);
        return;
      }
      try {
        const models = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "gRouter: fetching models…" },
          () => listModels(config),
        );
        if (models.length === 0) {
          void vscode.window.showWarningMessage("gRouter: no models available for this key.");
          return;
        }
        const picked = await vscode.window.showQuickPick(
          models.map((m) => ({
            label: m.id === config.model ? `$(check) ${m.id}` : m.id,
            description: `${Math.round(m.contextWindow / 1000)}k ctx · ${Math.round(m.maxOutputTokens / 1000)}k out${m.reasoning ? " · reasoning" : ""}`,
            detail: m.displayName,
            id: m.id,
          })),
          { title: "gRouter — Select Model", placeHolder: `Current: ${config.model}` },
        );
        if (!picked) return;
        saveConfig({ model: picked.id });
        getLogger().info(`[config] model set to ${picked.id}`);
        void vscode.window.showInformationMessage(`gRouter: model set to ${picked.id}`);
      } catch (err) {
        getLogger().error(`[config] selectModel failed: ${String(err)}`);
        void vscode.window.showErrorMessage(`gRouter: could not list models — ${String(err)}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.startMcpServer", async () => {
      const { getActiveSession, getRegistry, getGate } = await import("../chat/participant");
      const registry = getRegistry();
      const gate = getGate();
      if (!registry || !gate) {
        void vscode.window.showWarningMessage("gRouter: extension not fully initialized.");
        return;
      }

      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const mode = await vscode.window.showQuickPick(
        [
          {
            label: "$(shield) In-editor server (recommended)",
            detail: "Localhost HTTP endpoint. Mutating tools prompt you in VS Code before running.",
            value: "in-editor" as const,
          },
          {
            label: "$(warning) Standalone terminal server (auto-approves)",
            detail: "Spawns dist/mcp-server.js in a terminal. NO approval prompts — trusted workspaces only.",
            value: "terminal" as const,
          },
        ],
        { title: "gRouter — Start MCP Server", ignoreFocusOut: true },
      );
      if (!mode) return;

      if (mode.value === "terminal") {
        const session = getActiveSession();
        const terminal = vscode.window.createTerminal({
          name: "gRouter MCP Server (auto-approve)",
          cwd: workspaceRoot ?? session?.temp.root,
          hideFromUser: false,
        });
        const serverPath = path.join(context.extensionPath, "dist", "mcp-server.js");
        const args = workspaceRoot ? ` --workspace "${workspaceRoot}"` : "";
        terminal.sendText(`node "${serverPath}"${args}`, true);
        terminal.show();
        void vscode.window.showWarningMessage(
          "gRouter: standalone MCP server started — it AUTO-APPROVES all tool calls. Use only in trusted workspaces.",
        );
        getLogger().info(`[mcp] standalone server started: node ${serverPath}${args}`);
        return;
      }

      const { startInEditorMcpServer } = await import("../tools/inEditorMcp");
      const port = vscode.workspace.getConfiguration("grouter").get<number>("mcp.port") ?? 3987;
      const running = await startInEditorMcpServer({
        registry,
        workspaceRoot,
        approve: async (request) => {
          const spec = registry.get(request.toolId);
          if (!spec) return "deny";
          return gate.request(spec, request);
        },
        onLog: (message) => getLogger().info(message),
        port,
      });

      context.subscriptions.push({ dispose: () => void running.close() });
      void vscode.window.showInformationMessage(
        `gRouter: in-editor MCP server running at ${running.url} — mutations prompt in VS Code.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.reconnectMcp", async () => {
      const { getMcpClient } = await import("../chat/participant");
      const client = getMcpClient();
      if (!client) {
        void vscode.window.showWarningMessage("gRouter: MCP client not initialized.");
        return;
      }
      client.discoverConfigs();
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "gRouter: reconnecting MCP servers…" },
        () => client.connectAll(),
      );
      const states = client.list();
      void vscode.window.showInformationMessage(
        `gRouter: ${states.filter((s) => s.status === "connected").length}/${states.length} MCP server(s) connected.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.openConfig", async () => {
      ensureConfigFile();
      const doc = await vscode.workspace.openTextDocument(configPath());
      await vscode.window.showTextDocument(doc);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("grouter.openPlan", async () => {
      const { getActiveSession } = await import("../chat/participant");
      const session = getActiveSession();
      if (!session) {
        void vscode.window.showWarningMessage("gRouter: no active session — send a message first.");
        return;
      }
      const plans = session.store.listPlans();
      if (plans.length === 0) {
        void vscode.window.showWarningMessage(
          "gRouter: no plans in this session yet. Create one with `@grouter /plan <goal>`.",
        );
        return;
      }
      const picked = await vscode.window.showQuickPick(
        plans.map((p) => ({
          label: p.title || p.slug,
          description: `${p.status} · ${p.slug}`,
          detail: p.goal.slice(0, 120),
          slug: p.slug,
        })),
        { title: "gRouter — Open Plan (from session database)" },
      );
      if (!picked) return;
      const doc = await vscode.workspace.openTextDocument({
        content: picked.detail ? `# ${picked.label}\n\n${picked.detail}` : picked.label,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc);
      void vscode.commands.executeCommand("workbench.action.chat.open", {
        query: `@grouter /plan execute ${picked.slug}`,
      });
    }),
  );
}
