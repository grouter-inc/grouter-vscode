/**
 * Guards the HUD (status bar) contract.
 *
 * WHY: the extension shipped with no status bar item at all, so a long agent run
 * was invisible. Now that a HUD exists, two regressions are possible and both are
 * cheap to catch here: (a) the renderer drops a counter the user needs, and
 * (b) the controller throws when VS Code is absent (unit tests, headless MCP).
 *
 * The controller is driven through an injected factory, so no VS Code host is
 * needed — but the code path under test is the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatHud,
  formatTokens,
  HudController,
  INITIAL_HUD_STATE,
  resetHudForTests,
  type HudState,
} from "../../src/ui/hud";

function fakeItem() {
  return {
    text: "",
    tooltip: "",
    command: "",
    visible: false,
    show: vi.fn(function (this: { visible: boolean }) {
      this.visible = true;
    }),
    hide: vi.fn(function (this: { visible: boolean }) {
      this.visible = false;
    }),
    dispose: vi.fn(),
  };
}

function makeController() {
  const item = fakeItem();
  const ctrl = new HudController({
    createItem: () => item as unknown as never,
  });
  return { ctrl, item };
}

describe("formatTokens", () => {
  it("formats small and large counts", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(-5)).toBe("0");
    expect(formatTokens(7)).toBe("7");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(2_000_000)).toBe("2.0M");
    expect(formatTokens(Number.NaN)).toBe("0");
  });
});

describe("formatHud", () => {
  it("renders a minimal idle state", () => {
    const { text } = formatHud(INITIAL_HUD_STATE);
    // "ask" is the default mode and is intentionally omitted from the bar.
    expect(text).toBe("$(circle-outline) gRouter");
  });

  it("shows mode, iteration, tools, tokens and verify state", () => {
    const state: HudState = {
      phase: "ralph",
      mode: "ralph",
      model: "DeepSeek-V4-Flash",
      iteration: { current: 2, total: 5 },
      toolCalls: 14,
      tokens: 12_400,
      verify: "red",
    };
    const { text, tooltip } = formatHud(state);
    expect(text).toContain("gRouter");
    expect(text).toContain("ralph");
    expect(text).toContain("2/5");
    expect(text).toContain("14 tools");
    expect(text).toContain("12.4k");
    expect(text).toContain("$(error)"); // verify red
    expect(tooltip).toContain("Mode: `ralph`");
    expect(tooltip).toContain("Iterasi: 2/5");
    expect(tooltip).toContain("Verifikasi terakhir: red");
  });

  it("shows plan step when not in ralph mode", () => {
    const { text, tooltip } = formatHud({
      ...INITIAL_HUD_STATE,
      mode: "plan",
      step: { current: 3, total: 7 },
    });
    expect(text).toContain("step 3/7");
    expect(tooltip).toContain("Plan step: 3/7");
  });

  it("prefers iteration over step when both are set", () => {
    const { text } = formatHud({
      ...INITIAL_HUD_STATE,
      mode: "ralph",
      iteration: { current: 1, total: 5 },
      step: { current: 2, total: 9 },
    });
    expect(text).toContain("1/5");
    expect(text).not.toContain("step 2/9");
  });

  it("shows the verify icon for each state", () => {
    for (const [state, icon] of [
      ["green", "$(pass-filled)"],
      ["red", "$(error)"],
      ["skipped", "$(circle-slash)"],
    ] as const) {
      expect(formatHud({ ...INITIAL_HUD_STATE, verify: state }).text).toContain(icon);
    }
  });

  it("truncates a long error so the bar stays readable", () => {
    const long = "a".repeat(120);
    const { text } = formatHud({ ...INITIAL_HUD_STATE, phase: "error", error: long });
    expect(text).toContain("$(error)");
    expect(text.length).toBeLessThan(100);
  });

  it("says verification has not run when undefined", () => {
    const { tooltip } = formatHud(INITIAL_HUD_STATE);
    expect(tooltip).toContain("belum dijalankan");
  });
});

describe("HudController", () => {
  beforeEach(() => {
    resetHudForTests();
  });

  it("does not throw without a VS Code host", () => {
    // createItem throws, simulating the unit-test environment.
    const ctrl = new HudController({
      createItem: () => {
        throw new Error("no vscode");
      },
    });
    expect(() => ctrl.begin("agent", "m")).not.toThrow();
    expect(() => ctrl.incrementTool()).not.toThrow();
    expect(() => ctrl.update({ tokens: 5 })).not.toThrow();
    expect(() => ctrl.finish()).not.toThrow();
    expect(() => ctrl.dispose()).not.toThrow();
  });

  it("shows the item and resets counters on begin()", () => {
    const { ctrl, item } = makeController();
    ctrl.update({ toolCalls: 99, tokens: 999 });
    ctrl.begin("agent", "DeepSeek-V4-Flash");

    expect(item.show).toHaveBeenCalled();
    const state = ctrl.getState();
    expect(state.toolCalls).toBe(0);
    expect(state.tokens).toBe(0);
    expect(state.phase).toBe("thinking");
    expect(state.mode).toBe("agent");
    expect(item.text).toContain("agent");
    expect(item.command).toBe("grouter.showDiagnostics");
  });

  it("counts tool calls", () => {
    const { ctrl, item } = makeController();
    ctrl.begin("agent", "m");
    ctrl.incrementTool();
    ctrl.incrementTool();
    ctrl.incrementTool();
    expect(ctrl.getState().toolCalls).toBe(3);
    expect(ctrl.getState().phase).toBe("tools");
    expect(item.text).toContain("3 tools");
  });

  it("accumulates tokens and ignores negatives", () => {
    const { ctrl, item } = makeController();
    ctrl.begin("agent", "m");
    ctrl.addTokens(1000, 200);
    ctrl.addTokens(-50, 50);
    expect(ctrl.getState().tokens).toBe(1250);
    expect(item.text).toContain("1.3k");
  });

  it("tracks ralph iterations", () => {
    const { ctrl, item } = makeController();
    ctrl.begin("ralph", "m");
    ctrl.setIteration(2, 5);
    expect(ctrl.getState().phase).toBe("ralph");
    expect(item.text).toContain("2/5");
  });

  it("tracks plan steps", () => {
    const { ctrl, item } = makeController();
    ctrl.begin("plan", "m");
    ctrl.setStep(1, 4);
    expect(item.text).toContain("step 1/4");
  });

  it("reflects verification state", () => {
    const { ctrl, item } = makeController();
    ctrl.begin("agent", "m");
    ctrl.setVerify("green");
    expect(ctrl.getState().verify).toBe("green");
    expect(item.text).toContain("$(pass-filled)");
  });

  it("shows an error phase with the message", () => {
    const { ctrl, item } = makeController();
    ctrl.begin("agent", "m");
    ctrl.fail("rate limited");
    expect(ctrl.getState().phase).toBe("error");
    expect(item.text).toContain("rate limited");
    expect(item.text).toContain("$(error)");
  });

  it("hides after finish (8s timer) and reports done immediately", () => {
    vi.useFakeTimers();
    const { ctrl, item } = makeController();
    ctrl.begin("agent", "m");
    ctrl.finish();
    expect(ctrl.getState().phase).toBe("done");
    expect(item.hide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(8000);
    expect(item.hide).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not render while hidden", () => {
    const { ctrl, item } = makeController();
    ctrl.update({ tokens: 500 }); // never begun → invisible
    expect(item.show).not.toHaveBeenCalled();
  });

  it("disposes the item", () => {
    const { ctrl, item } = makeController();
    ctrl.begin("agent", "m");
    ctrl.dispose();
    expect(item.dispose).toHaveBeenCalled();
  });

  it("never leaves the bar stuck on 'thinking' after finish()", () => {
    // Regression guard for a real bug: the chat handler's try/finally had no
    // catch, so a thrown error skipped every hud.* call and the status bar kept
    // spinning on "thinking" forever. finish() forces phase out of thinking.
    const { ctrl } = makeController();
    ctrl.begin("agent", "m");
    expect(ctrl.getState().phase).toBe("thinking");
    ctrl.finish();
    expect(ctrl.getState().phase).not.toBe("thinking");
  });

  it("survives being used with no VS Code host (headless MCP server)", () => {
    // createItem throws in a plain node process (no vscode module). The
    // controller must swallow that instead of crashing the extension host.
    const ctrl = new HudController({
      createItem: () => {
        throw new Error("vscode is not available");
      },
    });
    expect(() => ctrl.begin("agent", "m")).not.toThrow();
    expect(() => ctrl.incrementTool()).not.toThrow();
    expect(() => ctrl.finish()).not.toThrow();
  });
});
