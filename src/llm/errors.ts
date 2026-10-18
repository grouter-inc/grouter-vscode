export type GRouterErrorKind =
  | "auth"
  | "model-not-allowed"
  | "subscription"
  | "model-gone"
  | "payload-too-large"
  | "rate-limit"
  | "concurrency"
  | "quota"
  | "upstream"
  | "network"
  | "canceled"
  | "unknown";

export interface GRouterError {
  kind: GRouterErrorKind;
  title: string;
  detail: string;
  retryable: boolean;
  action?: { label: string; command: string };
}

interface GatewayErrorBody {
  error?: { message?: string; type?: string; code?: string; credits?: { remaining?: number; limit?: number; resetPeriod?: string } };
}

export function mapGatewayError(err: unknown): GRouterError {
  if (isAbort(err)) {
    return { kind: "canceled", title: "Canceled", detail: "Request canceled.", retryable: false };
  }

  const root = unwrapRetryError(err);
  const statusCode = pickNumber(root, "statusCode");
  const body = parseErrorBody(root);
  const code = body?.error?.code ?? pickString(root, "code") ?? "";
  const upstreamMessage = body?.error?.message ?? errorMessage(root);

  switch (code) {
    case "invalid_api_key":
      return authError(upstreamMessage);
    case "model_not_allowed":
      return {
        kind: "model-not-allowed",
        title: "Model not in your plan",
        detail: upstreamMessage || "This model is not included in your gRouter plan.",
        retryable: false,
        action: { label: "Select another model", command: "grouter.selectModel" },
      };
    case "model_not_found":
      return {
        kind: "model-gone",
        title: "Model not found",
        detail: upstreamMessage || "The configured model does not exist on the gateway.",
        retryable: false,
        action: { label: "Select another model", command: "grouter.selectModel" },
      };
    case "request_too_large":
      return {
        kind: "payload-too-large",
        title: "Request too large",
        detail: upstreamMessage || "The request exceeds the gateway size limit. Reduce context and retry.",
        retryable: false,
      };
    case "rate_limit_exceeded":
      return {
        kind: "rate-limit",
        title: "Rate limited",
        detail: upstreamMessage || "Per-minute request limit reached. Wait for the window to reset.",
        retryable: true,
      };
    case "concurrency_limit_exceeded":
      return {
        kind: "concurrency",
        title: "Too many concurrent requests",
        detail: upstreamMessage || "Your plan's concurrency limit is reached. Wait for in-flight requests to finish.",
        retryable: true,
      };
    case "insufficient_quota": {
      const credits = body?.error?.credits;
      const creditInfo = credits
        ? ` Credits: ${credits.remaining ?? "?"}/${credits.limit ?? "?"} (${credits.resetPeriod ?? "periodic"} reset).`
        : "";
      return {
        kind: "quota",
        title: "Quota or credits exhausted",
        detail: (upstreamMessage || "Your plan quota is exhausted.") + creditInfo,
        retryable: false,
      };
    }
    case "upstream_error":
      return {
        kind: "upstream",
        title: "Upstream model unavailable",
        detail: upstreamMessage || "The model provider returned an error. Try again shortly.",
        retryable: true,
      };
    case "circuit_open":
      return {
        kind: "upstream",
        title: "Model temporarily paused",
        detail: upstreamMessage || "The gateway paused this upstream after repeated failures. Try again in a few seconds.",
        retryable: true,
      };
  }

  if (statusCode === 401) return authError(upstreamMessage);
  if (statusCode === 403) {
    return {
      kind: "subscription",
      title: "Access denied",
      detail: upstreamMessage || "Your account or subscription may be inactive.",
      retryable: false,
    };
  }
  if (statusCode === 429) {
    return {
      kind: "rate-limit",
      title: "Rate limited",
      detail: upstreamMessage || "Too many requests. Try again shortly.",
      retryable: true,
    };
  }
  if (statusCode === 413) {
    return {
      kind: "payload-too-large",
      title: "Request too large",
      detail: upstreamMessage || "The request exceeds the gateway size limit.",
      retryable: false,
    };
  }
  if (statusCode === 502 || statusCode === 503) {
    return {
      kind: "upstream",
      title: "Gateway upstream error",
      detail: upstreamMessage || "The gateway could not reach the model. Try again shortly.",
      retryable: true,
    };
  }
  if (isNetworkError(root)) {
    return {
      kind: "network",
      title: "Network error",
      detail: upstreamMessage || "Could not reach the gRouter gateway. Check your connection.",
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    title: "Unexpected error",
    detail: upstreamMessage || "An unexpected error occurred.",
    retryable: false,
  };
}

function authError(detail: string): GRouterError {
  return {
    kind: "auth",
    title: "Invalid or revoked API key",
    detail: detail || "Your gRouter API key is missing or expired. Get a new one from https://t.me/grouteerbot, then run gRouter: Set API Key.",
    retryable: false,
    action: { label: "Open config file", command: "grouter.openConfig" },
  };
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name ?? "";
  return name === "AbortError" || name === "TimeoutError" || name.includes("Abort");
}

function unwrapRetryError(err: unknown): unknown {
  if (!err || typeof err !== "object") return err;
  const errors = (err as { errors?: unknown[] }).errors;
  if (Array.isArray(errors) && errors.length > 0) return errors[errors.length - 1];
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeErrors = (cause as { errors?: unknown[] }).errors;
    if (Array.isArray(causeErrors) && causeErrors.length > 0) return causeErrors[causeErrors.length - 1];
  }
  return err;
}

function parseErrorBody(err: unknown): GatewayErrorBody | undefined {
  if (!err || typeof err !== "object") return undefined;
  const raw = (err as { responseBody?: unknown }).responseBody;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as GatewayErrorBody;
  } catch {
    return undefined;
  }
}

function pickNumber(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" ? v : undefined;
}

function pickString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return String(err);
}

function isNetworkError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("connect timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("network")
  );
}
