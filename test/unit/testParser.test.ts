import { describe, it, expect } from "vitest";
import { parseTestOutput } from "../../src/tools/builtin/testTools";

describe("test output parser", () => {
  it("parses vitest output with failures", () => {
    const output = [
      " FAIL  test/unit/auth.test.ts > auth > rejects expired token",
      "AssertionError: expected 401 to be 200",
      "",
      " Test Files  1 failed | 2 passed (3)",
      "      Tests  1 failed | 12 passed | 2 skipped (15)",
    ].join("\n");
    const summary = parseTestOutput(output);
    expect(summary.framework).toBe("vitest/jest");
    expect(summary.failed).toBe(1);
    expect(summary.passed).toBe(12);
    expect(summary.skipped).toBe(2);
    expect(summary.failures.length).toBeGreaterThan(0);
  });

  it("parses all-passing vitest output", () => {
    const output = [" Test Files  3 passed (3)", "      Tests  15 passed (15)"].join("\n");
    const summary = parseTestOutput(output);
    expect(summary.framework).toBe("vitest/jest");
    expect(summary.passed).toBe(15);
    expect(summary.failed).toBe(0);
  });

  it("parses mocha output", () => {
    const output = ["  12 passing (45ms)", "  2 failing", "  1 pending"].join("\n");
    const summary = parseTestOutput(output);
    expect(summary.framework).toBe("mocha");
    expect(summary.passed).toBe(12);
    expect(summary.failed).toBe(2);
    expect(summary.skipped).toBe(1);
  });

  it("parses pytest output", () => {
    const output = [
      "===================== test session starts =====================",
      "FAILED tests/test_auth.py::test_expired - AssertionError",
      "=========== 10 passed, 2 failed, 1 skipped in 3.2s ============",
    ].join("\n");
    const summary = parseTestOutput(output);
    expect(summary.framework).toBe("pytest");
    expect(summary.passed).toBe(10);
    expect(summary.failed).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.failures.length).toBeGreaterThan(0);
  });

  it("parses cargo output", () => {
    const output = ["running 5 tests", "test result: FAILED. 4 passed; 1 failed; 0 ignored"].join("\n");
    const summary = parseTestOutput(output);
    expect(summary.framework).toBe("cargo");
    expect(summary.passed).toBe(4);
    expect(summary.failed).toBe(1);
  });

  it("returns empty summary for unrecognized output", () => {
    const summary = parseTestOutput("some random text with no test results");
    expect(summary.framework).toBe("");
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it("collects failure lines from various formats", () => {
    const output = [
      "  × should validate email",
      "  ✗ should reject empty",
      "FAIL src/foo.test.ts",
      "not ok 3 - subtraction",
    ].join("\n");
    const summary = parseTestOutput(output);
    expect(summary.failures.length).toBe(4);
  });
});
