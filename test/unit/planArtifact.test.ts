import { describe, it, expect } from "vitest";
import {
  serializePlan,
  parsePlan,
  slugify,
  updateStepStatus,
  nextPendingStep,
  planProgress,
  type PlanArtifact,
} from "../../src/agent/plan/artifact";

const sample: PlanArtifact = {
  slug: "add-oauth-login",
  title: "Add OAuth Login",
  goal: "Users can sign in with Google.",
  status: "draft",
  created: "2026-10-15T10:00:00.000Z",
  model: "DeepSeek-V4-Flash",
  steps: [
    {
      index: 1,
      title: "Add auth routes",
      status: "pending",
      objective: "Create /auth/login and /auth/callback endpoints.",
      files: ["src/auth/routes.ts"],
      verify: "npm test -- auth",
    },
    {
      index: 2,
      title: "Wire session middleware",
      status: "pending",
      objective: "Attach session to request context.",
      files: ["src/middleware/session.ts"],
    },
  ],
};

describe("plan artifact", () => {
  it("serializes and parses back identically", () => {
    const markdown = serializePlan(sample);
    const parsed = parsePlan(sample.slug, markdown);
    expect(parsed.title).toBe(sample.title);
    expect(parsed.goal).toBe(sample.goal);
    expect(parsed.status).toBe("draft");
    expect(parsed.model).toBe(sample.model);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0].title).toBe("Add auth routes");
    expect(parsed.steps[0].files).toEqual(["src/auth/routes.ts"]);
    expect(parsed.steps[0].verify).toBe("npm test -- auth");
    expect(parsed.steps[1].verify).toBeUndefined();
  });

  it("roundtrips status changes", () => {
    const updated = updateStepStatus(sample, 1, "done");
    const reparsed = parsePlan(sample.slug, serializePlan(updated));
    expect(reparsed.steps[0].status).toBe("done");
    expect(reparsed.steps[1].status).toBe("pending");
  });

  it("slugifies titles", () => {
    expect(slugify("Add OAuth Login!")).toBe("add-oauth-login");
    expect(slugify("  Multiple   spaces  ")).toBe("multiple-spaces");
    expect(slugify("!!!")).toBe("plan");
  });

  it("finds the next pending step", () => {
    expect(nextPendingStep(sample)?.index).toBe(1);
    const done = updateStepStatus(sample, 1, "done");
    expect(nextPendingStep(done)?.index).toBe(2);
    const allDone = updateStepStatus(done, 2, "skipped");
    expect(nextPendingStep(allDone)).toBeUndefined();
  });

  it("computes progress", () => {
    expect(planProgress(sample)).toEqual({ done: 0, total: 2 });
    const partial = updateStepStatus(updateStepStatus(sample, 1, "done"), 2, "skipped");
    expect(planProgress(partial)).toEqual({ done: 2, total: 2 });
  });

  it("parses a hand-edited plan (user modified the file)", () => {
    const markdown = [
      "# Plan: Manual Plan",
      "",
      "- **Status**: approved",
      "- **Created**: 2026-10-15T00:00:00.000Z",
      "- **Model**: m",
      "",
      "## Goal",
      "",
      "Do the thing.",
      "",
      "## Steps",
      "",
      "### 1. First — [done]",
      "",
      "Already done.",
      "",
      "### 2. Second — [pending]",
      "",
      "Still to do.",
      "",
      "- **Verify**: `npm run check`",
      "",
    ].join("\n");
    const parsed = parsePlan("manual-plan", markdown);
    expect(parsed.status).toBe("approved");
    expect(parsed.steps[0].status).toBe("done");
    expect(parsed.steps[1].verify).toBe("npm run check");
  });
});
