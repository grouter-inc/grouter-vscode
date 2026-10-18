import * as vscode from "vscode";

/**
 * HUD — live status line for the agent.
 *
 * WHY: the extension shipped with `contributes.views: {}` and no status bar item,
 * so a long agent run was a black box: the user could not see which mode was
 * running, how far along it was, how many tokens it had burned, or whether the
 * last verification was green. The only feedback was a transient
 * stream.progress() string that vanished.
 *
 * Design rules:
 *  - Rendering is a pure function (`formatHud`) so it can be unit-tested.
 *  - The controller never throws; a missing VS Code API just makes it a no-op.
 *  - Only one status bar item exists per extension host.
 */

export type HudPhase = "idle" | "thinking" | "tools" | "verifying" | "ralph" | "error" | "done";

export interface HudState {
  phase: HudPhase;
  /** Chat command driving the run, e.g. "agent" / "ralph". */
  mode: string;
  /** Model id, shortened for display. */
  model: string;
  /** Ralph iteration (1-based) and total, when in ralph mode. */
  iteration?: { current: number; total: number };
  /** Plan step counter, when executing a plan. */
  step?: { current: number; total: number };
  /** Total tool calls this turn. */
  toolCalls: number;
  /** Accumulated tokens (input + output) this turn. */
  tokens: number;
  /** Last verification state: undefined = not run yet. */
  verify?: "green" | "red" | "skipped";
  /** Short error text when phase === "error". */
  error?: string;
}

export const INITIAL_HUD_STATE: HudState = {
  phase: "idle",
  mode: "ask",
  model: "",
  toolCalls: 0,
  tokens: 0,
};

/** Tokens are shown as 12.4k / 1.2M to keep the status bar short. */
export function formatTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

const PHASE_ICON: Record<HudPhase, string> = {
  idle: "$(circle-outline)",
  thinking: "$(sync~spin)",
  tools: "$(tools)",
  verifying: "$(beaker)",
  ralph: "$(refresh~spin)",
  error: "$(error)",
  done: "$(pass)",
};

const VERIFY_ICON: Record<NonNullable<HudState["verify"]>, string> = {
  green: "$(pass-filled)",
  red: "$(error)",
  skipped: "$(circle-slash)",
};

/**
 * Pure renderer. Returns the status bar text and a multi-line tooltip.
 * Kept separate from the controller so tests never need a VS Code host.
 */
export function formatHud(state: HudState): { text: string; tooltip: string } {
  const parts: string[] = [`${PHASE_ICON[state.phase]} gRouter`];

  if (state.mode && state.mode !== "ask") parts.push(state.mode);

  if (state.iteration) {
    parts.push(`${state.iteration.current}/${state.iteration.total}`);
  } else if (state.step) {
    parts.push(`step ${state.step.current}/${state.step.total}`);
  }

  if (state.toolCalls > 0) parts.push(`${state.toolCalls} tools`);
  if (state.tokens > 0) parts.push(formatTokens(state.tokens));
  if (state.verify) parts.push(VERIFY_ICON[state.verify]);
  if (state.phase === "error" && state.error) {
    parts.push(state.error.slice(0, 30));
  }

  const text = parts.join(" · ");

  const tooltipLines = [
    `**gRouter** — ${state.phase}`,
    "",
    `- Mode: \`${state.mode}\``,
    state.model ? `- Model: \`${state.model}\`` : "",
    state.iteration ? `- Iterasi: ${state.iteration.current}/${state.iteration.total}` : "",
    state.step ? `- Plan step: ${state.step.current}/${state.step.total}` : "",
    `- Tool calls: ${state.toolCalls}`,
    `- Token: ${formatTokens(state.tokens)}`,
    state.verify ? `- Verifikasi terakhir: ${state.verify}` : "- Verifikasi terakhir: belum dijalankan",
    state.error ? `- Error: ${state.error}` : "",
  ].filter(Boolean);

  return { text, tooltip: tooltipLines.join("\n") };
}

export interface HudControllerOptions {
  /** Defaults to vscode.window.createStatusBarItem. Injectable for tests. */
  createItem?: () => vscode.StatusBarItem;
  /** Alignment/priority passed to createStatusBarItem. */
  alignment?: vscode.StatusBarAlignment;
  priority?: number;
}

/**
 * Owns the single status bar item and keeps it in sync with HudState.
 * Every method is safe to call before VS Code is available (no-op).
 */
export class HudController {
  private item: vscode.StatusBarItem | undefined;
  private state: HudState = { ...INITIAL_HUD_STATE };
  private visible = false;

  constructor(private readonly options: HudControllerOptions = {}) {}

  private ensureItem(): vscode.StatusBarItem | undefined {
    if (this.item) return this.item;
    try {
      const factory =
        this.options.createItem ??
        (() =>
          vscode.window.createStatusBarItem(
            this.options.alignment ?? vscode.StatusBarAlignment.Left,
            this.options.priority ?? 100,
          ));
      this.item = factory();
      this.item.command = "grouter.showDiagnostics";
      return this.item;
    } catch {
      // No VS Code host (unit tests, headless MCP server) — stay a no-op.
      return undefined;
    }
  }

  getState(): HudState {
    return { ...this.state };
  }

  /** Merge a patch into the current state and re-render. */
  update(patch: Partial<HudState>): void {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  /** Start a turn: reset counters, set phase+mode+model, show the item. */
  begin(mode: string, model: string): void {
    this.state = {
      phase: "thinking",
      mode,
      model,
      toolCalls: 0,
      tokens: 0,
      verify: undefined,
    };
    this.visible = true;
    this.render();
  }

  incrementTool(): void {
    this.update({ toolCalls: this.state.toolCalls + 1, phase: "tools" });
  }

  addTokens(input: number, output: number): void {
    this.update({ tokens: this.state.tokens + Math.max(0, input) + Math.max(0, output) });
  }

  setVerify(state: NonNullable<HudState["verify"]>): void {
    this.update({ verify: state });
  }

  setIteration(current: number, total: number): void {
    this.update({ iteration: { current, total }, phase: "ralph" });
  }

  setStep(current: number, total: number): void {
    this.update({ step: { current, total } });
  }

  fail(error: string): void {
    this.update({ phase: "error", error });
  }

  finish(): void {
    this.update({ phase: "done", iteration: undefined, step: undefined });
    // Auto-hide shortly after a successful turn so the bar stays clean.
    const item = this.item;
    if (item) {
      setTimeout(() => {
        if (this.state.phase === "done") this.hide();
      }, 8000);
    }
  }

  hide(): void {
    this.visible = false;
    try {
      this.item?.hide();
    } catch {
      // ignore
    }
  }

  dispose(): void {
    try {
      this.item?.dispose();
    } catch {
      // ignore
    }
    this.item = undefined;
  }

  /**
   * The exact string VS Code shows in the status bar. Exposed because the host
   * test must assert on what the user sees, not on internal state that could
   * diverge from the rendered text.
   */
  debugText(): string {
    return formatHud(this.state).text;
  }

  private render(): void {
    if (!this.visible) return;
    const item = this.ensureItem();
    if (!item) return;
    const { text, tooltip } = formatHud(this.state);
    item.text = text;
    item.tooltip = tooltip;
    item.show();
  }
}

let sharedHud: HudController | undefined;

/** The extension uses one HUD for the whole host. */
export function getHud(): HudController {
  if (!sharedHud) sharedHud = new HudController();
  return sharedHud;
}

export function resetHudForTests(): void {
  sharedHud?.dispose();
  sharedHud = undefined;
}
