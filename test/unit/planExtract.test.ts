import { describe, it, expect } from "vitest";
import { extractAndValidate, extractJson } from "../../src/agent/plan/generate";

describe("extractJson", () => {
  it("pulls a bare JSON object out of plain text", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("unwraps a fenced code block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("ignores prose around the object", () => {
    expect(extractJson('Sure! Here it is:\n{"a":1}\nHope that helps.')).toBe('{"a":1}');
  });

  it("returns undefined when there is no object", () => {
    expect(extractJson("no json here")).toBeUndefined();
  });

  it("survives a truncated response (no closing brace)", () => {
    expect(extractJson('{"a":1')).toBeUndefined();
  });
});

describe("extractAndValidate", () => {
  const valid = JSON.stringify({
    title: "Add health check",
    goal: "Expose version and uptime.",
    steps: [
      { title: "Add route", objective: "Create GET /health", files: ["src/app.ts"] },
      { title: "Test it", objective: "Hit the endpoint", files: [], verify: "npm test" },
    ],
  });

  it("accepts a well-formed plan", () => {
    const r = extractAndValidate(valid);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.steps).toHaveLength(2);
  });

  it("rejects a plan with fewer than two steps", () => {
    const r = extractAndValidate(
      JSON.stringify({ title: "t", goal: "g", steps: [{ title: "a", objective: "b", files: [] }] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/steps/);
  });

  it("rejects a truncated body instead of throwing", () => {
    const r = extractAndValidate(valid.slice(0, valid.length - 40));
    expect(r.ok).toBe(false);
  });
});
