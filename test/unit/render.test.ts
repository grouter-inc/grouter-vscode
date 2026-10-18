import { describe, it, expect } from "vitest";
import { newRenderState, renderEvent, type StreamSink } from "../../src/chat/render";
import type { AgentEvent } from "../../src/llm/runtime";

function collector() {
  const calls: Array<{ kind: string; value: string }> = [];
  const sink: StreamSink = {
    markdown: (value) => calls.push({ kind: "markdown", value }),
    progress: (value) => calls.push({ kind: "progress", value }),
    button: (c) => calls.push({ kind: "button", value: c.command }),
  };
  return { calls, sink };
}

function emit(events: AgentEvent[], showReasoning = true) {
  const { calls, sink } = collector();
  const state = newRenderState();
  for (const e of events) renderEvent(e, sink, state, showReasoning);
  return calls;
}

describe("render", () => {
  it("streams text deltas as markdown", () => {
    const calls = emit([
      { type: "text-delta", text: "Hello " },
      { type: "text-delta", text: "world" },
    ]);
    const md = calls.filter((c) => c.kind === "markdown").map((c) => c.value);
    expect(md.join("")).toContain("Hello world");
  });

  it("wraps reasoning in a blockquote and closes it before text", () => {
    const calls = emit([
      { type: "reasoning-delta", text: "hmm" },
      { type: "reasoning-delta", text: " more" },
      { type: "reasoning-end" },
      { type: "text-delta", text: "Answer" },
    ]);
    const md = calls.filter((c) => c.kind === "markdown").map((c) => c.value).join("");
    expect(md).toContain("> **Thinking…**");
    expect(md).toContain("> hmm");
    expect(md).toContain("Answer");
  });

  it("suppresses reasoning when disabled", () => {
    const calls = emit([{ type: "reasoning-delta", text: "secret" }], false);
    const md = calls.filter((c) => c.kind === "markdown").map((c) => c.value).join("");
    expect(md).not.toContain("secret");
  });

  it("renders errors with title and detail", () => {
    const calls = emit([
      {
        type: "error",
        error: { kind: "rate-limit", title: "Rate limited", detail: "Wait.", retryable: true },
      },
    ]);
    const md = calls.filter((c) => c.kind === "markdown").map((c) => c.value).join("");
    expect(md).toContain("Rate limited");
    expect(md).toContain("Wait.");
  });

  it("notes cancellation", () => {
    const calls = emit([{ type: "done", finishReason: "canceled" }]);
    const md = calls.filter((c) => c.kind === "markdown").map((c) => c.value).join("");
    expect(md).toContain("canceled");
  });

  it("forwards progress messages", () => {
    const calls = emit([{ type: "progress", text: "Loading…" }]);
    expect(calls).toContainEqual({ kind: "progress", value: "Loading…" });
  });
});
