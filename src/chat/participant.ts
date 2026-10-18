import * as vscode from "vscode";
import { configPath } from "../config/homeConfig";
import { loadConfigWithSettings as loadConfig } from "../config/settingsOverride";
import { runAsk, type AgentEvent } from "../llm/runtime";
import { runAgent } from "../llm/agentRuntime";
import { resolveContextWindow } from "../llm/gateway";
import { assembleContext } from "../context/assembler";
import { newRenderState, renderEvent, errorAction } from "./render";
import { createDefaultRegistry } from "../tools/registry";
import { ApprovalGate, approvalRequestFor } from "../tools/approvalGate";
import { registerLmTools } from "../tools/lmTools";
import type { ToolRegistry } from "../tools/spec";
import { getLogger } from "../util/logger";
import { generatePlan } from "../agent/plan/generate";
import {
  buildPlanExecGraph,
  runPlanGraph,
  type StepApprovalRequest,
  type StepDecision,
} from "../agent/plan/graph";
import { planProgress, type PlanArtifact } from "../agent/plan/artifact";
import { SessionStore } from "../storage/sessionStore";
import { MemoryState } from "../storage/memoryState";
import { TempWorkspace } from "../storage/tempWorkspace";
import { SkillEngine, ensureSkillUsageTable } from "../skills/engine";
import { maybeLearnSkill } from "../agent/skillLearner";
import { McpClientManager } from "../tools/builtin/mcpClient";
import { Command } from "@langchain/langgraph";
import { collectEvidence, analyzeCompletionClaim, evaluateGate, renderReport } from "../agent/verify/evidence";
import { runRalphLoop, renderRalphOutcome } from "../agent/ralph/loop";
import { getHud } from "../ui/hud";

export const PARTICIPANT_ID = "grouter.chat";

let registry: ToolRegistry | undefined;
let gate: ApprovalGate | undefined;
let skillEngine: SkillEngine | undefined;
let mcpClient: McpClientManager | undefined;
const planGraphs = new Map<string, ReturnType<typeof buildPlanExecGraph>>();

interface ChatSession {
  store: SessionStore;
  memory: MemoryState;
  temp: TempWorkspace;
}

const sessions = new Map<string, ChatSession>();

function sessionFor(request: vscode.ChatRequest, model: string): ChatSession {
  const key = `${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "no-workspace"}`;
  let session = sessions.get(key);
  if (!session) {
    const resumed = SessionStore.latestForWorkspace(key);
    const store = resumed ?? SessionStore.create(key, model);
    if (resumed) store.ensure(key, model);
    session = {
      store,
      memory: new MemoryState(store.sessionId, key, model),
      temp: new TempWorkspace(store.sessionId),
    };
    sessions.set(key, session);
    getLogger().info(
      `[session] ${resumed ? "resumed" : "created"} ${store.sessionId} (home: ~/.grouter, temp: ${session.temp.root})`,
    );
  }
  return session;
}

export function getActiveSession(): ChatSession | undefined {
  return activeSession ?? [...sessions.values()][0];
}

export function getSkillEngine(): SkillEngine | undefined {
  return skillEngine;
}

export function getMcpClient(): McpClientManager | undefined {
  return mcpClient;
}

export function getRegistry(): ToolRegistry | undefined {
  return registry;
}

export function getGate(): ApprovalGate | undefined {
  return gate;
}

export function disposeSessions(): void {
  for (const session of sessions.values()) {
    try {
      session.memory.persist();
      session.temp.cleanup();
    } catch (err) {
      getLogger().warn(`[session] cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  sessions.clear();
  activeSession = undefined;
}

export function registerParticipant(context: vscode.ExtensionContext): void {
  ensureSkillUsageTable();
  skillEngine = new SkillEngine();
  const seeded = skillEngine.seedBuiltins();
  if (seeded.length > 0) {
    getLogger().info(`[skills] seeded ${seeded.length} builtin skill(s) to ~/.grouter/skills/`);
  }

  gate = new ApprovalGate(() => ({
    autoApprove: loadConfig().agent.autoApprove,
    trusted: vscode.workspace.isTrusted,
  }));

  registry = createDefaultRegistry({
    skillEngine,
    sessionId: () => getActiveSession()?.store.sessionId ?? "unknown",
    delegation: {
      config: loadConfig,
      registry: () => registry,
      workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      token: () => activeToken ?? new vscode.CancellationTokenSource().token,
      onEvent: (event) => activeOnEvent?.(event),
      signal: () => activeSignal ?? new AbortController().signal,
      sessionId: () => activeSession?.store.sessionId ?? "unknown",
      recordDelegation: (specialist, task, ok, summary) => {
        activeSession?.store.recordDelegation(specialist, task, ok, summary);
      },
      approve: async (request) => {
        const spec = registry?.get(request.toolId);
        if (!spec || !gate) return "deny";
        return gate.request(spec, request);
      },
    },
  });

  registerLmTools(context, registry, gate);

  mcpClient = new McpClientManager(
    registry,
    () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    (message) => getLogger().info(message),
  );
  mcpClient.discoverConfigs();
  void mcpClient.connectAll().then(() => {
    const connected = mcpClient?.list().filter((s) => s.status === "connected") ?? [];
    if (connected.length > 0) {
      getLogger().info(
        `[mcp] ${connected.length} server(s) connected: ${connected.map((s) => `${s.name}(${s.toolCount})`).join(", ")}`,
      );
    }
  });

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  participant.followupProvider = {
    provideFollowups(result) {
      const mode = (result.metadata as { mode?: string } | undefined)?.mode;
      if (mode === "help") return [];
      if (mode === "plan-created") {
        return [
          { prompt: "/plan execute", label: "Execute this plan" },
          { prompt: "Revise the plan", label: "Revise plan" },
        ];
      }
      return [
        { prompt: "Explain that in more detail", label: "Explain further" },
        { prompt: "Show a code example", label: "Show code example" },
        { prompt: "What should I do next?", label: "Next steps" },
      ];
    },
  };
  context.subscriptions.push(participant);
  getLogger().info(
    `[chat] participant registered: @${PARTICIPANT_ID} (${registry.all().length} tools, ${skillEngine.list().length} skills)`,
  );
}

let activeToken: vscode.CancellationToken | undefined;
let activeOnEvent: ((event: AgentEvent) => void) | undefined;
let activeSignal: AbortSignal | undefined;
let activeSession: ChatSession | undefined;

/**
 * Exported so the screenshot harness can drive a real chat turn. VS Code's own
 * chat surface refuses to dispatch when no language model is registered in the
 * host (it renders "Language model unavailable" and never calls the
 * participant), which is a host limitation, not a gRouter one — so the harness
 * feeds the same handler a real request and a real response stream.
 */
export const handler: vscode.ChatRequestHandler = async (
  request,
  context,
  stream,
  token,
): Promise<vscode.ChatResult> => {
  const log = getLogger();
  const config = loadConfig();
  const command = request.command ?? "ask";
  log.info(`[chat] command=${command} model=${config.model}`);

  if (!config.apiKey) {
    stream.markdown(
      `**No API key configured.**\n\nBuy one from https://t.me/grouteerbot (paid via QRIS, delivered automatically), then run **gRouter: Set API Key** or add it to \`${configPath()}\`.`,
    );
    return { metadata: { mode: "help" } };
  }

  if (command === "help") {
    stream.markdown(helpMarkdown(config.model, registry?.all().length ?? 0));
    return { metadata: { mode: "help" } };
  }

  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());
  activeToken = token;
  activeSignal = controller.signal;

  const hud = getHud();
  if (config.hud.enabled) hud.begin(command, config.model);

  const session = sessionFor(request, config.model);
  activeSession = session;
  session.memory.incrementTurn();
  session.store.addMessage("user", request.prompt, command);

  const contextWindow = await resolveContextWindow(config).catch(() => 200_000);

  // Capture everything routed through stream.markdown() without violating the
  // Proxy invariant on read-only/non-configurable properties. VS Code defines
  // `markdown` on its ChatResponseStream with {writable:false, configurable:false},
  // so a Proxy `get` trap MUST return that exact function — returning a wrapper
  // throws: "get on proxy: property 'markdown' is a read-only and non-configurable
  // data property on the proxy target but the proxy did not return its actual value".
  //
  // Instead of wrapping `markdown` itself, we shadow it on the *facade* the agent
  // writes through (the `sink` below). The stream is never proxied at all.
  const capturedText: string[] = [];
  const captureMarkdown = (value: string | vscode.MarkdownString): void => {
    capturedText.push(typeof value === "string" ? value : value.value);
    stream.markdown(value);
  };
  // Everything the agent must not touch directly; read-only tools pass through.
  const captureStream = {
    markdown: captureMarkdown,
    progress: (value: string) => stream.progress(value),
    button: (cmd: { command: string; title: string }) => stream.button(cmd),
    reference: (value: vscode.Uri | vscode.Location) => stream.reference(value),
    anchor: (value: vscode.ChatResponseAnchorPart | vscode.Uri) => stream.anchor(value as vscode.Uri),
    filetree: (value: vscode.ChatResponseFileTree[]) => (stream.filetree as unknown as (v: vscode.ChatResponseFileTree[]) => void)(value),
  } as unknown as vscode.ChatResponseStream;

  const renderState = newRenderState();
  const sink = {
    markdown: (value: string) => captureStream.markdown(value),
    progress: (value: string) => captureStream.progress(value),
    button: (cmd: { command: string; title: string }) => captureStream.button(cmd),
  };

  let lastErrorAction: { command: string; title: string } | undefined;
  let responseText = "";
  const onEvent = (event: AgentEvent) => {
    if (event.type === "error") {
      lastErrorAction = errorAction(event.error);
      session.memory.incrementErrors();
    }
    if (event.type === "text-delta") responseText += event.text;
    if (event.type === "tool-start") hud.incrementTool();
    if (event.type === "usage") hud.addTokens(event.inputTokens, event.outputTokens);
    if (event.type === "error") hud.fail(event.error.detail ?? event.error.kind ?? "error");
    if (event.type === "rate-limit" && event.remaining !== undefined) {
      updateRateLimitStatus(event.remaining);
    }
    renderEvent(event, sink, renderState, config.reasoning.show);
  };
  activeOnEvent = onEvent;

  let turnMode = command;
  const finishTurn = (mode: string) => {
    turnMode = mode;
    return { metadata: { mode } };
  };

  const skillBlock = buildSkillBlock(request.prompt, command, session);

  try {
    if (command === "skills") {
      stream.markdown(renderSkills());
      return finishTurn("help");
    }

    if (command === "mcp") {
      stream.markdown(renderMcpStatus());
      return finishTurn("help");
    }

    if (command === "plan") {
      const result = await runPlanMode({
        request,
        stream: captureStream,
        token,
        onEvent,
        log: (m) => log.info(m),
        config,
        controller,
        registry,
        gate,
        session,
        skillBlock,
        contextWindow,
      });
      if (lastErrorAction) stream.button(lastErrorAction);
      turnMode = (result.metadata as { mode?: string } | undefined)?.mode ?? "plan-created";
      return result;
    }

    if (command === "debug") {
      await runDebugMode({
        request,
        stream: captureStream,
        token,
        onEvent,
        log: (message) => log.info(message),
        config,
        controller,
        registry,
        gate,
        session,
        skillBlock,
        contextWindow,
      });
      if (lastErrorAction) stream.button(lastErrorAction);
      return finishTurn("debug");
    }

    if (command === "ralph") {
      await runRalphMode({
        request,
        stream: captureStream,
        token,
        onEvent,
        log: (message) => log.info(message),
        config,
        controller,
        registry,
        gate,
        session,
        skillBlock,
        contextWindow,
        hud,
      });
      if (lastErrorAction) stream.button(lastErrorAction);
      return finishTurn("ralph");
    }

    if (command === "agent") {
      await runAgentMode({
        request,
        stream: captureStream,
        token,
        onEvent,
        log: (message) => log.info(message),
        config,
        controller,
        registry,
        gate,
        session,
        skillBlock,
        contextWindow,
      });
      if (lastErrorAction) stream.button(lastErrorAction);
      return finishTurn("agent");
    }

    const activeEditor = vscode.window.activeTextEditor;
    const assembled = await assembleContext({
      references: request.references,
      activeEditor,
      contextWindow,
      truncateKB: config.tools.truncateKB,
    });

    if (assembled.includedLabels.length > 0) {
      stream.progress(`Context: ${assembled.includedLabels.join(", ")}`);
    }

    const history = context.history
      .slice(-6)
      .map((turn) => {
        if (turn instanceof vscode.ChatRequestTurn) return `User: ${turn.prompt}`;
        if (turn instanceof vscode.ChatResponseTurn) {
          const text = turn.response
            .map((part) => (part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : ""))
            .join("");
          return `Assistant: ${text.slice(0, 500)}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");

    const prompt = buildPrompt(request.prompt, assembled.text, history, skillBlock);
    stream.progress(`Thinking with ${config.model}…`);
    await runAsk({ config, prompt, signal: controller.signal, onEvent });

    if (lastErrorAction) stream.button(lastErrorAction);
    return finishTurn("ask");
  } finally {
    const persisted = responseText || capturedText.join("");

    // ---------------------------------------------------------------
    // HUD safety: whatever happened above (exception, abort, early
    // return), the status bar must never stay stuck on "thinking".
    // If no error event was rendered, still clear the bar.
    // ---------------------------------------------------------------
    if (config.hud.enabled && hud.getState().phase === "thinking") {
      hud.finish();
    }

    // ---------------------------------------------------------------
    // Verify gate: a completion claim must be backed by evidence.
    // Only the modes that actually change code are gated; read-only
    // modes (ask/skills/mcp/help) can never be "done but unverified".
    // ---------------------------------------------------------------
    if (GATED_MODES.has(turnMode) && config.verify.enabled && !controller.signal.aborted) {
      const claim = analyzeCompletionClaim(persisted);
      if (claim.claimsDone) {
        stream.progress("Verify gate: mengumpulkan bukti…");
        hud.update({ phase: "verifying" });
        const report = await collectEvidence({
          workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
          testCommand: config.verify.testCommand || undefined,
          typecheckCommand: config.verify.typecheckCommand || undefined,
          timeoutSeconds: config.verify.timeoutSeconds,
        });
        hud.setVerify(report.results.every((r) => r.skipped) ? "skipped" : report.ok ? "green" : "red");

        const verdict = evaluateGate(claim, report);
        if (!verdict.allow) {
          rememberVerify(report, true);
          if (config.verify.blockOnUnverified) {
            // Downgrade the turn: the agent may not claim "done".
            turnMode = "unverified";
            stream.markdown(`\n\n${verdict.message ?? ""}`);
            stream.button({
              command: "grouter.verifyWork",
              title: "Jalankan verifikasi ulang",
            });
          }
        } else if (report.results.some((r) => !r.skipped)) {
          rememberVerify(report, false);
          stream.markdown(`\n\n${renderReport(report)}`);
        }
      }
    }

    if (persisted.trim()) {
      session.store.addMessage("assistant", persisted, turnMode);
    }
    session.memory.persist();
    if (config.hud.enabled) hud.finish();
    activeToken = undefined;
    activeOnEvent = undefined;
    activeSignal = undefined;
    activeSession = undefined;
  }
};

/** Modes whose output can contain a completion claim about code changes. */
const GATED_MODES = new Set(["agent", "debug", "plan-executed", "ralph"]);

/**
 * Last verification, scoped per workspace.
 *
 * WHY per workspace: this used to be a single module-level pair. A red run in
 * workspace A therefore made the "show details" command in workspace B claim
 * REJECTED, which is a false alarm about work that never ran there.
 */
interface LastVerify {
  report: Awaited<ReturnType<typeof collectEvidence>>;
  blocked: boolean;
}

const lastVerifyByWorkspace = new Map<string, LastVerify>();

function workspaceKey(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "no-workspace";
}

function rememberVerify(report: LastVerify["report"], blocked: boolean): void {
  lastVerifyByWorkspace.set(workspaceKey(), { report, blocked });
}

export function getLastVerifyReport(): Awaited<ReturnType<typeof collectEvidence>> | undefined {
  return lastVerifyByWorkspace.get(workspaceKey())?.report;
}

export function wasLastVerifyBlocked(): boolean {
  return lastVerifyByWorkspace.get(workspaceKey())?.blocked ?? false;
}

/** Test seam: forget every workspace's last verification. */
export function resetVerifyStateForTests(): void {
  lastVerifyByWorkspace.clear();
}

function buildSkillBlock(prompt: string, mode: string, session: ChatSession): string {
  if (!skillEngine) return "";
  const activeEditor = vscode.window.activeTextEditor;
  const matches = skillEngine.match({
    prompt,
    mode,
    activeFile: activeEditor ? vscode.workspace.asRelativePath(activeEditor.document.uri) : undefined,
    recentFiles: session.memory.current.lastFilesChanged,
    memoryNotes: session.memory.current.notes,
    knowledgeTitles: session.store
      .recentMessages(5)
      .map((m) => m.content.slice(0, 80)),
  });

  if (matches.length === 0) return "";

  for (const m of matches) {
    session.store.addKnowledge(
      `skill-used:${m.skill.slug}`,
      `Applied in ${mode} mode (score ${m.score}: ${m.reasons.join(", ")})`,
      [m.skill.slug, mode],
      "session",
    );
    skillEngine.recordUse(m.skill.slug, session.store.sessionId, m.score);
  }

  return matches
    .map((m) => {
      const header = [
        `<skill name="${m.skill.name}">`,
        `Objective: ${m.skill.objective}`,
        m.skill.goals.length > 0 ? `Goals:\n${m.skill.goals.map((g) => `- ${g}`).join("\n")}` : "",
        "",
      ]
        .filter(Boolean)
        .join("\n");
      return `${header}${m.skill.content}\n</skill>`;
    })
    .join("\n\n");
}

interface PlanModeArgs {
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  onEvent: (event: AgentEvent) => void;
  log: (message: string) => void;
  config: ReturnType<typeof loadConfig>;
  controller: AbortController;
  registry: ToolRegistry | undefined;
  gate: ApprovalGate | undefined;
  session: ChatSession;
  skillBlock: string;
  contextWindow: number;
}

async function runPlanMode(args: PlanModeArgs): Promise<vscode.ChatResult> {
  const { request, stream, token, onEvent, config, controller, registry, gate, log, session, skillBlock } = args;

  const prompt = request.prompt.trim();

  if (/^execute\b/i.test(prompt)) {
    const slugArg = prompt.replace(/^execute\b/i, "").trim();
    return executePlan({
      slugArg,
      stream,
      token,
      onEvent,
      config,
      controller,
      registry,
      gate,
      log,
      session,
      skillBlock,
      contextWindow: args.contextWindow,
    });
  }

  if (!prompt || /^list$/i.test(prompt)) {
    const plans = session.store.listPlans();
    if (plans.length === 0) {
      stream.markdown("No plans yet in this session. Create one with `/plan <your goal>`.");
      return { metadata: { mode: "help" } };
    }
    stream.markdown(
      [
        "**Plans in this session** _(stored in ~/.grouter/grouter.db)_:",
        "",
        ...plans.map((p) => {
          const artifact = JSON.parse(p.artifactJson) as PlanArtifact;
          const { done, total } = planProgress(artifact);
          return `- \`${p.slug}\` — ${p.title} (${p.status}, ${done}/${total} steps)`;
        }),
        "",
        "Execute one with `/plan execute <slug>`.",
      ].join("\n"),
    );
    return { metadata: { mode: "help" } };
  }

  stream.progress("Generating plan…");
  const contextInfo = await assembleContext({
    references: request.references,
    activeEditor: vscode.window.activeTextEditor,
    contextWindow: args.contextWindow,
    truncateKB: config.tools.truncateKB,
  });

  const generated = await generatePlan({
    config,
    goal: prompt,
    contextText: [skillBlock, contextInfo.text].filter(Boolean).join("\n\n"),
    signal: controller.signal,
  });

  if (generated.error || !generated.plan) {
    stream.markdown(`**Plan generation failed:** ${generated.error?.detail ?? "unknown error"}`);
    return { metadata: { mode: "help" } };
  }

  const plan = generated.plan;
  persistPlan(session, plan);
  log(`[plan] saved ${plan.slug} to session db`);

  stream.markdown(renderPlanMarkdown(plan));
  stream.markdown(`\n\n_Saved to session database (~/.grouter/grouter.db)_`);
  stream.markdown(
    "\n\nRun **`/plan execute " + plan.slug + "`** to start executing with step-by-step approval.",
  );
  return { metadata: { mode: "plan-created", slug: plan.slug } };
}

function persistPlan(session: ChatSession, plan: PlanArtifact): void {
  session.store.savePlan(plan.slug, plan.title, plan.goal, plan.status, JSON.stringify(plan));
  session.memory.setActivePlan({
    slug: plan.slug,
    status: plan.status,
    cursor: plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length,
    total: plan.steps.length,
  });
}

interface ExecutePlanArgs {
  slugArg: string;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  onEvent: (event: AgentEvent) => void;
  config: ReturnType<typeof loadConfig>;
  controller: AbortController;
  registry: ToolRegistry | undefined;
  gate: ApprovalGate | undefined;
  log: (message: string) => void;
  session: ChatSession;
  skillBlock: string;
  contextWindow: number;
}

async function executePlan(args: ExecutePlanArgs): Promise<vscode.ChatResult> {
  const { slugArg, stream, token, onEvent, config, controller, registry, gate, log, session, skillBlock } = args;

  if (!registry || !gate) {
    stream.markdown("**Planning unavailable:** registry not initialized.");
    return { metadata: { mode: "help" } };
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown("**Plan execution needs an open workspace folder.**");
    return { metadata: { mode: "help" } };
  }

  let plan: PlanArtifact;
  if (slugArg) {
    const record = session.store.getPlan(slugArg);
    if (!record) {
      stream.markdown(`Plan \`${slugArg}\` not found in this session. Use \`/plan list\`.`);
      return { metadata: { mode: "help" } };
    }
    plan = JSON.parse(record.artifactJson) as PlanArtifact;
  } else {
    const records = session.store.listPlans();
    if (records.length === 0) {
      stream.markdown("No plans found. Create one with `/plan <goal>`.");
      return { metadata: { mode: "help" } };
    }
    const picked = await vscode.window.showQuickPick(
      records.map((p) => ({
        label: p.slug,
        description: `${p.status} · updated ${p.updatedAt.slice(0, 16)}`,
        detail: p.title,
        record: p,
      })),
      { title: "gRouter — Execute which plan?" },
    );
    if (!picked) return { metadata: { mode: "help" } };
    plan = JSON.parse(picked.record.artifactJson) as PlanArtifact;
  }

  if (plan.steps.length === 0) {
    stream.markdown(`Plan \`${plan.slug}\` has no steps.`);
    return { metadata: { mode: "help" } };
  }

  plan = { ...plan, status: "in-progress" };
  persistPlan(session, plan);

  const planComplete = plan.steps.every((s) => s.status === "done" || s.status === "skipped");
  const runStamp = planComplete ? `-${Date.now().toString(36)}` : "";
  const threadId = `plan-${session.store.sessionId}-${plan.slug}${runStamp}`;
  let graph = planGraphs.get(threadId);
  if (!graph) {
    graph = buildPlanExecGraph({
      executeStep: async (step) =>
        executeStepWithAgent({
          step,
          config,
          registry: registry!,
          gate: gate!,
          controller,
          token,
          workspaceRoot,
          onEvent,
          session,
          skillBlock,
        }),
      persist: async (updated) => {
        persistPlan(session, updated);
      },
      onProgress: (message) => {
        log(`[plan] ${message}`);
        stream.progress(message);
      },
    });
    planGraphs.set(threadId, graph);
  }

  const state = await graph.getState({ configurable: { thread_id: threadId } });
  const hasCheckpoint = Boolean((state.values as { plan?: PlanArtifact }).plan);
  const starting = hasCheckpoint ? new Command({ resume: "approve" }) : { plan };

  stream.markdown(`**Executing plan: ${plan.title}** (${plan.steps.length} steps)\n`);

  let outcome = await runPlanGraph(graph, threadId, starting as never);
  let guard = 0;

  while (!outcome.finished && outcome.pendingApproval && guard++ < 50) {
    const approval = outcome.pendingApproval;
    stream.markdown(
      [
        "",
        `### Step ${approval.stepIndex}: ${approval.stepTitle}${approval.isRetry ? " _(retry)_" : ""}`,
        "",
        approval.objective,
        approval.files.length ? `\n**Files:** ${approval.files.map((f) => `\`${f}\``).join(", ")}` : "",
        approval.verify ? `\n**Verify:** \`${approval.verify}\`` : "",
      ].join("\n"),
    );

    const decision = await askStepDecision(approval);
    if (token.isCancellationRequested) {
      stream.markdown("\n\n_(plan execution canceled)_");
      break;
    }

    outcome = await runPlanGraph(graph, threadId, new Command({ resume: decision }));
  }

  if (outcome.finished) {
    const { done, total } = planProgress(outcome.plan);
    stream.markdown(
      [
        "",
        "---",
        `**Plan finished** — status: ${outcome.plan.status} · ${done}/${total} steps done`,
        "",
        outcome.plan.steps.map((s) => `- ${statusIcon(s.status)} ${s.index}. ${s.title}`).join("\n"),
      ].join("\n"),
    );
  }

  return { metadata: { mode: "plan-executed", slug: plan.slug } };
}

async function askStepDecision(approval: StepApprovalRequest): Promise<StepDecision> {
  const items: Array<vscode.QuickPickItem & { decision: StepDecision }> = [
    { label: "$(check) Approve this step", decision: "approve" },
    { label: "$(check-all) Approve all remaining", decision: "approve-all" },
    { label: "$(debug-step-over) Skip this step", decision: "skip" },
    { label: "$(x) Abort plan", decision: "abort" },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: `gRouter — Step ${approval.stepIndex}: ${approval.stepTitle}`,
    placeHolder: approval.objective.slice(0, 120),
    ignoreFocusOut: true,
  });
  return picked?.decision ?? "abort";
}

interface ExecuteStepArgs {
  step: { index: number; title: string; objective: string; files: string[]; verify?: string };
  config: ReturnType<typeof loadConfig>;
  registry: ToolRegistry;
  gate: ApprovalGate;
  controller: AbortController;
  token: vscode.CancellationToken;
  workspaceRoot: string;
  onEvent: (event: AgentEvent) => void;
  session: ChatSession;
  skillBlock: string;
}

async function executeStepWithAgent(args: ExecuteStepArgs): Promise<{ ok: boolean; summary: string }> {
  const { step, config, registry, gate, controller, token, workspaceRoot, onEvent, session, skillBlock } = args;
  const prompt = [
    skillBlock,
    `You are executing step ${step.index} of a plan: "${step.title}".`,
    `Objective: ${step.objective}`,
    step.files.length ? `Expected files: ${step.files.join(", ")}` : "",
    step.verify ? `After changes, run this verification command: ${step.verify}` : "",
    "Complete only this step. Report what you changed and the verification result.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await runAgent({
    config,
    prompt,
    registry,
    signal: controller.signal,
    token,
    workspaceRoot,
    approve: async (req) => {
      const spec = registry.get(req.toolId);
      if (!spec) return "deny";
      return gate.request(spec, req);
    },
    onEvent: (event) => {
      recordToolEvent(session, event);
      onEvent(event);
    },
    log: () => undefined,
    maxIterations: config.agent.maxIterations,
  });

  session.memory.incrementToolCalls(result.toolCalls);
  session.memory.incrementDenials(result.denied);
  session.memory.recordFilesChanged(result.filesChanged);

  const ok = result.denied === 0 && (result.toolCalls > 0 || result.textLength > 0);
  return {
    ok,
    summary: `${result.toolCalls} tool calls, files: ${result.filesChanged.join(", ") || "none"}`,
  };
}

function recordToolEvent(session: ChatSession, event: AgentEvent): void {
  if (event.type === "tool-end") {
    const denied = event.preview.startsWith("denied —");
    session.store.addToolUsage(event.toolId, event.preview.slice(0, 120), event.ok, denied);
  }
}

function scheduleSkillLearning(params: {
  config: ReturnType<typeof loadConfig>;
  session: ChatSession;
  mode: string;
  userRequest: string;
  outcomeSummary: string;
  toolsUsed: string[];
  filesChanged: string[];
  signal: AbortSignal;
}): void {
  if (!skillEngine) return;
  if (!params.config.agent.learnSkills) return;
  if (params.toolsUsed.length === 0 && params.filesChanged.length === 0) return;

  const engine = skillEngine;
  void maybeLearnSkill({
    config: params.config,
    skillEngine: engine,
    sessionId: params.session.store.sessionId,
    mode: params.mode,
    userRequest: params.userRequest,
    outcomeSummary: params.outcomeSummary,
    toolsUsed: params.toolsUsed,
    filesChanged: params.filesChanged,
    existingSkillSlugs: engine.list().map((s) => s.slug),
    signal: params.signal,
  }).then((result) => {
    if (result.learned) {
      getLogger().info(`[skills] learned new skill "${result.slug}" from ${params.mode} session`);
    }
  });
}

function renderPlanMarkdown(plan: PlanArtifact): string {
  return [
    `## Plan: ${plan.title}`,
    "",
    plan.goal,
    "",
    ...plan.steps.map(
      (s) =>
        `- [ ] **${s.index}. ${s.title}**\n  ${s.objective}${s.files.length ? `\n  Files: ${s.files.map((f) => `\`${f}\``).join(", ")}` : ""}${s.verify ? `\n  Verify: \`${s.verify}\`` : ""}`,
    ),
  ].join("\n");
}

function statusIcon(status: string): string {
  switch (status) {
    case "done":
      return "✅";
    case "skipped":
      return "⏭️";
    case "failed":
      return "❌";
    case "in-progress":
      return "🔄";
    default:
      return "⬜";
  }
}

interface AgentModeArgs {
  request: vscode.ChatRequest;
  stream: vscode.ChatResponseStream;
  token: vscode.CancellationToken;
  onEvent: (event: AgentEvent) => void;
  log: (message: string) => void;
  config: ReturnType<typeof loadConfig>;
  controller: AbortController;
  registry: ToolRegistry | undefined;
  gate: ApprovalGate | undefined;
  session: ChatSession;
  skillBlock: string;
  contextWindow: number;
}

async function runDebugMode(args: AgentModeArgs): Promise<void> {
  const { request, stream, token, onEvent, log, config, controller, registry, gate, session, skillBlock } = args;
  if (!registry || !gate) {
    stream.markdown("**Debug unavailable:** tool registry not initialized.");
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown("**Debug mode needs an open workspace folder.**");
    return;
  }

  const debugState = describeDebugEnvironment();
  stream.progress(debugState.summary);

  const contextInfo = await assembleContext({
    references: request.references,
    activeEditor: vscode.window.activeTextEditor,
    contextWindow: args.contextWindow,
    truncateKB: config.tools.truncateKB,
  });

  const prompt = [
    skillBlock,
    `<debug_request>\n${request.prompt}\n</debug_request>`,
    `<debug_environment>\n${debugState.details}\n</debug_environment>`,
    contextInfo.text ? `<workspace_context>\n${contextInfo.text}\n</workspace_context>` : "",
    `Workspace root: ${workspaceRoot}`,
    "Investigate the failure using real runtime evidence:",
    "1. If tests are failing, use run_tests to reproduce and read the failure output.",
    "2. If a debug session is stopped, use get_debug_state to read the actual stack and variables — do not guess.",
    "3. If reproduction needs a breakpoint, use set_breakpoint then launch_debug (both require user approval).",
    "4. For unfamiliar areas, delegate exploration to the explorer specialist before forming hypotheses.",
    "5. State the root cause with file:line references, then propose a fix with apply_patch.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await runAgent({
    config,
    prompt,
    registry,
    signal: controller.signal,
    token,
    workspaceRoot,
    approve: async (req) => {
      const spec = registry.get(req.toolId);
      if (!spec) return "deny";
      return gate.request(spec, req);
    },
    onEvent: (event) => {
      recordToolEvent(session, event);
      onEvent(event);
    },
    log,
    maxIterations: config.agent.maxIterations,
  });

  session.memory.incrementToolCalls(result.toolCalls);
  session.memory.incrementDenials(result.denied);
  session.memory.recordFilesChanged(result.filesChanged);

  const summary: string[] = ["", "---", "**Debug run complete**"];
  summary.push(`- Tool calls: ${result.toolCalls}${result.denied > 0 ? ` (${result.denied} denied)` : ""}`);
  summary.push(
    result.filesChanged.length > 0
      ? `- Files changed: ${result.filesChanged.join(", ")}`
      : "- Files changed: none",
  );
  stream.markdown(summary.join("\n"));
}

function describeDebugEnvironment(): { summary: string; details: string } {
  const session = vscode.debug.activeDebugSession;
  const breakpoints = vscode.debug.breakpoints;
  const parts: string[] = [];

  if (session) {
    parts.push(`Active debug session: ${session.name} (type: ${session.type})`);
  } else {
    parts.push("No active debug session.");
  }
  parts.push(`${breakpoints.length} breakpoint(s) set.`);

  const folders = vscode.workspace.workspaceFolders;
  const hasLaunchJson = folders && folders.length > 0;
  parts.push(hasLaunchJson ? "Launch configs may exist in .vscode/launch.json." : "No workspace folder.");

  return {
    summary: session ? `Debug session active: ${session.name}` : "No active debug session — will reproduce via tests",
    details: parts.join("\n"),
  };
}

async function runAgentMode(args: AgentModeArgs): Promise<void> {
  const { request, stream, token, onEvent, log, config, controller, registry, gate, session, skillBlock } = args;
  if (!registry || !gate) {
    stream.markdown("**Agent unavailable:** tool registry not initialized.");
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown("**Agent mode needs an open workspace folder.**");
    return;
  }

  const contextInfo = await assembleContext({
    references: request.references,
    activeEditor: vscode.window.activeTextEditor,
    contextWindow: args.contextWindow,
    truncateKB: config.tools.truncateKB,
  });

  const prompt = [
    skillBlock,
    `<user_request>\n${request.prompt}\n</user_request>`,
    contextInfo.text ? `<workspace_context>\n${contextInfo.text}\n</workspace_context>` : "",
    `Workspace root: ${workspaceRoot}`,
    `Session scratch dir (use for temporary files): ${session.temp.root}`,
    "For unfamiliar areas, delegate to the explorer specialist first. For verification, delegate to the tester specialist.",
  ]
    .filter(Boolean)
    .join("\n\n");

  stream.progress(`Agent starting with ${registry.all().length} tools (${config.model})…`);

  const toolsUsed: string[] = [];
  let responseTextFromEvents = "";

  const result = await runAgent({
    config,
    prompt,
    registry,
    signal: controller.signal,
    token,
    workspaceRoot,
    approve: async (req) => {
      const spec = registry.get(req.toolId);
      if (!spec) return "deny";
      return gate.request(spec, req);
    },
    onEvent: (event) => {
      if (event.type === "tool-start") toolsUsed.push(event.toolId);
      if (event.type === "text-delta") responseTextFromEvents += event.text;
      recordToolEvent(session, event);
      onEvent(event);
    },
    log,
    maxIterations: config.agent.maxIterations,
  });

  session.memory.incrementToolCalls(result.toolCalls);
  session.memory.incrementDenials(result.denied);
  session.memory.recordFilesChanged(result.filesChanged);

  scheduleSkillLearning({
    config,
    session,
    mode: "agent",
    userRequest: request.prompt,
    outcomeSummary: responseTextFromEvents,
    toolsUsed: [...new Set(toolsUsed)],
    filesChanged: result.filesChanged,
    signal: controller.signal,
  });

  const summary: string[] = ["", "---", "**Agent run complete**"];
  summary.push(`- Tool calls: ${result.toolCalls}${result.denied > 0 ? ` (${result.denied} denied)` : ""}`);
  summary.push(
    result.filesChanged.length > 0
      ? `- Files changed: ${result.filesChanged.join(", ")}`
      : "- Files changed: none",
  );
  stream.markdown(summary.join("\n"));
}

interface RalphModeArgs extends AgentModeArgs {
  hud: ReturnType<typeof getHud>;
}

/**
 * `/ralph` — persistence mode.
 *
 * Runs the agent in an OUTER loop: work -> verify -> if red, feed the failure
 * back in and work again. The turn only ends as "verified" when the evidence is
 * green; otherwise it ends honestly as unverified, so the user never receives a
 * false success report.
 */
async function runRalphMode(args: RalphModeArgs): Promise<void> {
  const { request, stream, token, onEvent, log, config, controller, registry, gate, session, skillBlock, hud } =
    args;

  if (!registry || !gate) {
    stream.markdown("**Ralph unavailable:** tool registry not initialized.");
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown("**Ralph mode needs an open workspace folder.**");
    return;
  }

  const maxIterations = config.ralph.maxIterations;
  stream.markdown(
    `**Ralph mode** — target: verifikasi hijau, maksimal ${maxIterations} iterasi.\n\n> ${request.prompt.trim()}\n`,
  );

  const contextInfo = await assembleContext({
    references: request.references,
    activeEditor: vscode.window.activeTextEditor,
    contextWindow: args.contextWindow,
    truncateKB: config.tools.truncateKB,
  });

  const toolsUsed: string[] = [];
  let lastAgentText = "";

  const outcome = await runRalphLoop({
    maxIterations,
    stallLimit: config.ralph.stallLimit,
    isCanceled: () => token.isCancellationRequested || controller.signal.aborted,

    onIterationStart: (index, previousFailure) => {
      hud.setIteration(index, maxIterations);
      stream.progress(`Ralph iterasi ${index}/${maxIterations}`);
      stream.markdown(`\n### Iterasi ${index}/${maxIterations}\n`);
      if (previousFailure) {
        stream.markdown(`_Memperbaiki kegagalan sebelumnya:_ ${previousFailure}\n`);
      }
      lastAgentText = "";
    },

    onIterationEnd: (iteration) => {
      stream.markdown(
        [
          "",
          `- Tool calls: ${iteration.toolCalls}`,
          `- File berubah: ${iteration.filesChanged.length > 0 ? iteration.filesChanged.join(", ") : "tidak ada"}`,
          `- Verifikasi: ${iteration.report.ok ? "✅ hijau" : "❌ merah"}`,
        ].join("\n"),
      );
    },

    // Evidence is collected by the LOOP, not by the agent, so the agent cannot
    // skip or fake the check.
    collectReport: async () =>
      collectEvidence({
        workspaceRoot,
        testCommand: config.verify.testCommand || undefined,
        typecheckCommand: config.verify.typecheckCommand || undefined,
        timeoutSeconds: config.verify.timeoutSeconds,
      }),

    runIteration: async ({ index, previousFailure }) => {
      const prompt = [
        skillBlock,
        `<user_request>\n${request.prompt}\n</user_request>`,
        contextInfo.text ? `<workspace_context>\n${contextInfo.text}\n</workspace_context>` : "",
        `Workspace root: ${workspaceRoot}`,
        `Session scratch dir (use for temporary files): ${session.temp.root}`,
        `This is iteration ${index} of ${maxIterations} in a persistence loop.`,
        previousFailure
          ? [
              "<previous_failure>",
              "The previous iteration did NOT pass verification. This is the real failure output — fix it:",
              previousFailure,
              "</previous_failure>",
            ].join("\n")
          : "",
        "Work until the project's tests and typecheck actually pass.",
        "Run them yourself (run_tests / verify_work) instead of assuming. Do not claim success without green output.",
        "For unfamiliar areas, delegate to the explorer specialist first.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const result = await runAgent({
        config,
        prompt,
        registry,
        signal: controller.signal,
        token,
        workspaceRoot,
        approve: async (req) => {
          const spec = registry.get(req.toolId);
          if (!spec) return "deny";
          return gate.request(spec, req);
        },
        onEvent: (event) => {
          if (event.type === "tool-start") toolsUsed.push(event.toolId);
          if (event.type === "text-delta") lastAgentText += event.text;
          recordToolEvent(session, event);
          onEvent(event);
        },
        log,
        maxIterations: config.agent.maxIterations,
      });

      session.memory.incrementToolCalls(result.toolCalls);
      session.memory.incrementDenials(result.denied);
      session.memory.recordFilesChanged(result.filesChanged);

      return {
        summary: lastAgentText.slice(0, 500) || `${result.toolCalls} tool calls`,
        toolCalls: result.toolCalls,
        filesChanged: result.filesChanged,
      };
    },
  });

  stream.markdown(`\n\n---\n${renderRalphOutcome(outcome)}`);

  if (outcome.verified) {
    hud.setVerify("green");
    scheduleSkillLearning({
      config,
      session,
      mode: "ralph",
      userRequest: request.prompt,
      outcomeSummary: outcome.iterations.map((i) => i.summary).join("\n"),
      toolsUsed: [...new Set(toolsUsed)],
      filesChanged: [...new Set(outcome.iterations.flatMap((i) => i.filesChanged))],
      signal: controller.signal,
    });
  } else {
    hud.setVerify(outcome.finalReport?.results.every((r) => r.skipped) ? "skipped" : "red");
    log(`[ralph] stopped: ${outcome.reason} — ${outcome.message}`);
  }
}

function buildPrompt(userPrompt: string, contextText: string, history: string, skillBlock = ""): string {
  const parts = [
    "You are gRouter, a coding assistant inside VS Code. Answer concisely with markdown. Use code blocks with language tags.",
    "When relevant skills are provided, follow their playbooks. Use the delegate_to_specialist tool for focused sub-investigations.",
  ];
  if (skillBlock) parts.push(skillBlock);
  if (history) parts.push(`<conversation_history>\n${history}\n</conversation_history>`);
  if (contextText) parts.push(`<workspace_context>\n${contextText}\n</workspace_context>`);
  parts.push(`<user_request>\n${userPrompt}\n</user_request>`);
  return parts.join("\n\n");
}

function renderMcpStatus(): string {
  if (!mcpClient) return "MCP client not initialized.";
  const servers = mcpClient.list();
  if (servers.length === 0) {
    return [
      "**No MCP servers configured.**",
      "",
      "Add servers to one of:",
      "- `.vscode/mcp.json` (workspace, VS Code convention)",
      "- `.mcp.json` (workspace root)",
      "- `~/.grouter/mcp.json` (global)",
      "",
      "Example:",
      "```json",
      '{ "servers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] } } }',
      "```",
      "",
      "Reload the window after editing. gRouter also exposes its own tools as an MCP server:",
      "run **gRouter: Start MCP Server** or use `dist/mcp-server.js` from external clients.",
    ].join("\n");
  }
  const icon = (status: string) =>
    status === "connected" ? "🟢" : status === "error" ? "🔴" : status === "connecting" ? "🟡" : "⚪";
  return [
    `**MCP servers** (${servers.length})`,
    "",
    "| Status | Name | Tools | Transport | Error |",
    "|---|---|---|---|---|",
    ...servers.map(
      (s) =>
        `| ${icon(s.status)} ${s.status} | \`${s.name}\` | ${s.toolCount} | ${s.config.type ?? "stdio"} | ${s.error ? s.error.slice(0, 60) : "—"} |`,
    ),
    "",
    "gRouter as an MCP server: **gRouter: Start MCP Server** (external clients can drive VS Code tools through it).",
  ].join("\n");
}

function renderSkills(): string {
  if (!skillEngine) return "Skill engine not initialized.";
  const skills = skillEngine.list();
  const usage = new Map(skillEngine.usageStats().map((u) => [u.slug, u.uses]));
  if (skills.length === 0) {
    return "No skills installed. Builtin skills seed to `~/.grouter/skills/` on first run — reload the window.";
  }
  const lines: string[] = [
    `**Skills** (${skills.length}) — markdown files in \`~/.grouter/skills/\` _(home-basedir)_`,
    "",
    "| Slug | Name | Goals | Triggers | Uses |",
    "|---|---|---|---|---|",
    ...skills.map(
      (s) =>
        `| \`${s.slug}\` | ${s.name} | ${s.goals.length} | ${s.triggers.slice(0, 3).join(", ") || "—"} | ${usage.get(s.slug) ?? 0} |`,
    ),
    "",
    "**Objectives of the most-used skills:**",
    "",
    ...skills
      .slice()
      .sort((a, b) => (usage.get(b.slug) ?? 0) - (usage.get(a.slug) ?? 0))
      .slice(0, 5)
      .map((s) => `- **${s.name}** — ${s.objective || s.description}`),
    "",
    "Skills auto-match by trigger keywords and inject their objective + goals + playbook into the agent context.",
    "The agent can create new skills via the `create_skill` tool — they appear here immediately.",
  ];
  return lines.join("\n");
}

function helpMarkdown(model: string, toolCount: number): string {
  const session = getActiveSession();
  const statsLines: string[] = [];
  if (session) {
    const stats = session.store.toolUsageSummary();
    const delegations = session.store.delegationStats();
    const memory = session.memory.current;
    if (stats.length > 0) {
      statsLines.push(
        "",
        "**Session tool usage**",
        "| Tool | Calls | Denied |",
        "|---|---|---|",
        ...stats.slice(0, 8).map((s) => `| \`${s.toolId}\` | ${s.count} | ${s.denied} |`),
      );
    }
    if (delegations.length > 0) {
      statsLines.push(
        "",
        `**Delegations:** ${delegations.map((d) => `${d.specialist} ×${d.count} (${d.count - d.failed} ok)`).join(", ")}`,
      );
    }
    statsLines.push(
      "",
      `**Memory state:** ${memory.counters.turns} turns · ${memory.counters.toolCalls} tool calls · ${memory.counters.denials} denied · ${memory.counters.errors} errors · files touched: ${memory.lastFilesChanged.length}`,
    );
  }
  return [
    `**gRouter** — active model: \`${model}\` · ${toolCount} tools registered`,
    "",
    "| Command | Status |",
    "|---|---|",
    "| `/ask` | ✅ available (default) |",
    "| `/agent` | ✅ available — coding agent with tools + approvals |",
    "| `/plan <goal>` | ✅ available — generate a durable plan |",
    "| `/plan execute [slug]` | ✅ available — execute with step approvals |",
    "| `/plan list` | ✅ list saved plans |",
    "| `/ralph <task>` | ✅ persistence mode — loop sampai verifikasi hijau |",
    "| `/debug <problem>` | ✅ available — debugger & test investigation |",
    "| `/skills` | ✅ list installed skills |",
    "| `/mcp` | ✅ MCP server status |",
    "| `/help` | ✅ this message |",
    ...statsLines,
    "",
    `Config: \`${configPath()}\` · Storage: \`~/.grouter/\` (SQLite + sessions + skills)`,
  ].join("\n");
}

let rateLimitItem: vscode.StatusBarItem | undefined;

function updateRateLimitStatus(remaining: number): void {
  if (!rateLimitItem) {
    rateLimitItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    rateLimitItem.command = "grouter.showDiagnostics";
    rateLimitItem.tooltip = "gRouter remaining requests in current window";
  }
  rateLimitItem.text = `$(pulse) gRouter ${remaining}`;
  rateLimitItem.show();
}
