import { describe, it, expect } from "vitest";
import { estimateTokens, fitToBudget, truncateText, contextBudgetFor } from "../../src/context/budget";

describe("budget", () => {
  it("estimates tokens at ~4 chars per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("includes high-priority items first and reports omissions", () => {
    const big = "x".repeat(4000);
    const result = fitToBudget(
      [
        { label: "low", text: big, priority: 10 },
        { label: "high", text: big, priority: 100 },
      ],
      1200,
    );
    expect(result.included.map((i) => i.label)).toEqual(["high"]);
    expect(result.omitted.map((i) => i.label)).toEqual(["low"]);
    expect(result.usedTokens).toBeLessThanOrEqual(1200);
  });

  it("keeps everything when under budget", () => {
    const result = fitToBudget(
      [
        { label: "a", text: "small", priority: 1 },
        { label: "b", text: "small", priority: 2 },
      ],
      1000,
    );
    expect(result.omitted).toHaveLength(0);
  });

  it("caps context budget within bounds", () => {
    expect(contextBudgetFor(1_000_000)).toBe(60_000);
    expect(contextBudgetFor(8_000)).toBe(4_000);
  });

  it("truncates with an explicit marker", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const out = truncateText(text, 50);
    expect(out).toContain("[truncated");
    expect(out.length).toBeLessThan(text.length + 40);
  });
});
