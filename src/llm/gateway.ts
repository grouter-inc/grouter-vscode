import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { setDefaultResultOrder } from "node:dns";
import type { GRouterConfig } from "../config/homeConfig";

// IPv6-first resolution can hang on some networks (observed: prod.grouter.web.id).
setDefaultResultOrder("ipv4first");

export interface GatewayModelInfo {
  id: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: boolean;
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

/**
 * gRouter quirk: when `stream` is omitted the gateway defaults to streaming and
 * appends an SSE trailer (`data: [DONE]`, sometimes with a trailing blank line)
 * to an otherwise plain JSON body. The AI SDK's non-streaming path then fails
 * with "Invalid JSON response".
 *
 * Fix: for non-streaming POSTs to /chat/completions we force `stream: false`
 * explicitly and strip any stray SSE trailer from the returned body.
 */
const DONE_MARKER = /\s*data:\s*\[DONE\]\s*$/;

async function gatewayFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  let body = init?.body;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let patched = false;

  if (body && typeof body === "string" && url.includes("/chat/completions")) {
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      if (parsed.stream === undefined) {
        parsed.stream = false;
        body = JSON.stringify(parsed);
        patched = true;
      }
      // Only non-streaming responses need the trailer cleanup.
      if (parsed.stream === true) patched = false;
    } catch {
      // Non-JSON body: leave untouched.
    }
  }

  const res = await fetch(input, { ...init, ...(patched ? { body } : {}) });

  if (!patched) return res;

  // Read once, strip the SSE trailer, and hand back a clean JSON response.
  const text = await res.text();
  const cleaned = DONE_MARKER.test(text) ? text.replace(DONE_MARKER, "") : text;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("content-type", "application/json");
  return new Response(cleaned, { status: res.status, statusText: res.statusText, headers });
}

export function createProvider(config: GRouterConfig) {
  return createOpenAICompatible({
    name: "grouter",
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    fetch: gatewayFetch,
  });
}

async function errorFromResponse(res: Response): Promise<GatewayError> {
  let code = `http_${res.status}`;
  let message = `HTTP ${res.status} from gateway`;
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    if (body?.error?.code) code = body.error.code;
    if (body?.error?.message) message = body.error.message;
  } catch (err) {
    message = `${message} (unparseable error body: ${String(err)})`;
  }
  return new GatewayError(res.status, code, message);
}

export async function listModels(config: GRouterConfig): Promise<GatewayModelInfo[]> {
  const res = await fetch(`${config.baseUrl}/models`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
  });
  if (!res.ok) throw await errorFromResponse(res);
  const body = (await res.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      display_name?: string;
      contextWindow?: number;
      context_window?: number;
      max_output_tokens?: number;
      maxOutputTokens?: number;
      capabilities?: { reasoning?: boolean } | null;
      reasoning?: boolean;
    }>;
  };
  return (body.data ?? []).map((m) => ({
    id: m.id ?? "unknown",
    // gRouter exposes `name` as the display label; older gateways used display_name.
    displayName: m.name ?? m.display_name ?? m.id ?? "unknown",
    // gRouter uses camelCase `contextWindow`; accept snake_case too for portability.
    contextWindow: m.contextWindow ?? m.context_window ?? 0,
    maxOutputTokens: m.maxOutputTokens ?? m.max_output_tokens ?? 0,
    reasoning: Boolean(m.reasoning ?? m.capabilities?.reasoning),
  }));
}

const DEFAULT_CONTEXT_WINDOW = 200_000;
const modelCache = new Map<string, { models: GatewayModelInfo[]; fetchedAt: number }>();
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;

export async function resolveContextWindow(config: GRouterConfig): Promise<number> {
  const cacheKey = `${config.baseUrl}|${config.apiKey.slice(0, 8)}`;
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL_MS) {
    const hit = cached.models.find((m) => m.id === config.model);
    return hit?.contextWindow && hit.contextWindow > 0 ? hit.contextWindow : DEFAULT_CONTEXT_WINDOW;
  }
  try {
    const models = await listModels(config);
    modelCache.set(cacheKey, { models, fetchedAt: Date.now() });
    const hit = models.find((m) => m.id === config.model);
    return hit?.contextWindow && hit.contextWindow > 0 ? hit.contextWindow : DEFAULT_CONTEXT_WINDOW;
  } catch {
    return DEFAULT_CONTEXT_WINDOW;
  }
}
