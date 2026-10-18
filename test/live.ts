import { loadConfig } from "../src/config/homeConfig";

/**
 * Live-gateway tests need a real gRouter API key.
 * - Local: the key comes from ~/.grouter/config.json.
 * - CI: the key comes from the GROUTER_API_KEY secret.
 * Without a real key, live tests are skipped instead of failing.
 */
export function hasLiveKey(): boolean {
  try {
    const config = loadConfig();
    return config.apiKey.startsWith("gRouter-") && !config.apiKey.includes("invalid");
  } catch {
    return false;
  }
}

export const LIVE_SKIP_REASON =
  "No live gRouter API key configured (set ~/.grouter/config.json or GROUTER_API_KEY) — live gateway tests skipped.";
