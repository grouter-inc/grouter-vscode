import { describe, it, expect } from "vitest";
import { mapGatewayError } from "../../src/llm/errors";

function apiError(code: string, status: number, message = "boom") {
  return {
    name: "AI_APICallError",
    statusCode: status,
    responseBody: JSON.stringify({ error: { message, type: "t", code } }),
    message,
  };
}

describe("mapGatewayError", () => {
  it("maps invalid_api_key to auth with openConfig action", () => {
    const e = mapGatewayError(apiError("invalid_api_key", 401));
    expect(e.kind).toBe("auth");
    expect(e.retryable).toBe(false);
    expect(e.action?.command).toBe("grouter.openConfig");
  });

  it("maps model_not_allowed with selectModel action", () => {
    const e = mapGatewayError(apiError("model_not_allowed", 403));
    expect(e.kind).toBe("model-not-allowed");
    expect(e.action?.command).toBe("grouter.selectModel");
  });

  it("maps model_not_found to model-gone", () => {
    const e = mapGatewayError(apiError("model_not_found", 404));
    expect(e.kind).toBe("model-gone");
  });

  it("maps rate_limit_exceeded as retryable", () => {
    const e = mapGatewayError(apiError("rate_limit_exceeded", 429));
    expect(e.kind).toBe("rate-limit");
    expect(e.retryable).toBe(true);
  });

  it("maps concurrency_limit_exceeded", () => {
    const e = mapGatewayError(apiError("concurrency_limit_exceeded", 429));
    expect(e.kind).toBe("concurrency");
    expect(e.retryable).toBe(true);
  });

  it("maps insufficient_quota and includes credit info", () => {
    const err = {
      statusCode: 429,
      responseBody: JSON.stringify({
        error: {
          message: "Credit exhausted.",
          code: "insufficient_quota",
          credits: { remaining: 0, limit: 100000, resetPeriod: "MONTHLY" },
        },
      }),
    };
    const e = mapGatewayError(err);
    expect(e.kind).toBe("quota");
    expect(e.detail).toContain("0/100000");
    expect(e.detail).toContain("MONTHLY");
  });

  it("maps circuit_open to upstream retryable", () => {
    const e = mapGatewayError(apiError("circuit_open", 503));
    expect(e.kind).toBe("upstream");
    expect(e.retryable).toBe(true);
  });

  it("maps 502 without code to upstream", () => {
    const e = mapGatewayError({ statusCode: 502, message: "bad gateway" });
    expect(e.kind).toBe("upstream");
  });

  it("unwraps AI_RetryError to the last underlying error", () => {
    const retryErr = {
      name: "AI_RetryError",
      message: "Failed after 3 attempts.",
      errors: [{ statusCode: 401, responseBody: JSON.stringify({ error: { code: "invalid_api_key" } }) }],
    };
    const e = mapGatewayError(retryErr);
    expect(e.kind).toBe("auth");
  });

  it("maps network failures", () => {
    const e = mapGatewayError(new Error("fetch failed"));
    expect(e.kind).toBe("network");
    expect(e.retryable).toBe(true);
  });

  it("maps aborts to canceled", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const e = mapGatewayError(abort);
    expect(e.kind).toBe("canceled");
  });

  it("falls back to unknown for unrecognized errors", () => {
    const e = mapGatewayError(new Error("weird"));
    expect(e.kind).toBe("unknown");
  });
});
