import * as vscode from "vscode";
import {
  DEFAULT_CONFIG,
  loadConfig,
  mergeConfig,
  type GRouterConfig,
} from "./homeConfig";

/**
 * Applies the user's VS Code settings on top of ~/.grouter/config.json.
 *
 * WHY THIS EXISTS: `contributes.configuration` advertises five grouter.* keys in
 * the Settings UI, but only `grouter.mcp.port` was ever read. The other four
 * (baseUrl, model, reasoning.show, telemetry.enabled) were inert — a user could
 * change them, see the setting persist, and get no behaviour change and no
 * warning. Rather than delete the settings (they are genuinely useful and are
 * documented in the user guide) we now apply them as an override layer, with the
 * JSON file as the base.
 *
 * Precedence, highest first:
 *   1. VS Code settings (explicit user intent in the editor UI)
 *   2. ~/.grouter/config.json
 *   3. built-in defaults
 *
 * Only keys the user has actually set are applied, so an untouched Settings UI
 * never clobbers a value the user put in the JSON file.
 */
export function loadConfigWithSettings(): GRouterConfig {
  const base = loadConfig();
  const cfg = vscode.workspace.getConfiguration("grouter");

  const patch: Partial<GRouterConfig> = {};

  const baseUrl = cfg.get<string>("baseUrl");
  if (baseUrl && baseUrl.trim()) patch.baseUrl = baseUrl.trim();

  const model = cfg.get<string>("model");
  if (model && model.trim()) patch.model = model.trim();

  const showReasoning = cfg.get<boolean>("reasoning.show");
  if (typeof showReasoning === "boolean") {
    patch.reasoning = { ...base.reasoning, show: showReasoning };
  }

  const telemetry = cfg.get<boolean>("telemetry.enabled");
  if (typeof telemetry === "boolean") {
    patch.telemetry = { ...base.telemetry, enabled: telemetry };
  }

  // --- verify gate ---
  const verifyEnabled = cfg.get<boolean>("verify.enabled");
  const verifyBlock = cfg.get<boolean>("verify.blockOnUnverified");
  const verifyTest = cfg.get<string>("verify.testCommand");
  const verifyTypecheck = cfg.get<string>("verify.typecheckCommand");
  const verifyTimeout = cfg.get<number>("verify.timeoutSeconds");
  if (
    typeof verifyEnabled === "boolean" ||
    typeof verifyBlock === "boolean" ||
    typeof verifyTest === "string" ||
    typeof verifyTypecheck === "string" ||
    typeof verifyTimeout === "number"
  ) {
    patch.verify = {
      ...base.verify,
      ...(typeof verifyEnabled === "boolean" ? { enabled: verifyEnabled } : {}),
      ...(typeof verifyBlock === "boolean" ? { blockOnUnverified: verifyBlock } : {}),
      ...(typeof verifyTest === "string" ? { testCommand: verifyTest.trim() } : {}),
      ...(typeof verifyTypecheck === "string" ? { typecheckCommand: verifyTypecheck.trim() } : {}),
      ...(typeof verifyTimeout === "number" ? { timeoutSeconds: verifyTimeout } : {}),
    };
  }

  // --- ralph loop ---
  const ralphMax = cfg.get<number>("ralph.maxIterations");
  const ralphStall = cfg.get<number>("ralph.stallLimit");
  if (typeof ralphMax === "number" || typeof ralphStall === "number") {
    patch.ralph = {
      ...base.ralph,
      ...(typeof ralphMax === "number" ? { maxIterations: ralphMax } : {}),
      ...(typeof ralphStall === "number" ? { stallLimit: ralphStall } : {}),
    };
  }

  // --- hud ---
  const hudEnabled = cfg.get<boolean>("hud.enabled");
  if (typeof hudEnabled === "boolean") {
    patch.hud = { ...base.hud, enabled: hudEnabled };
  }

  return mergeConfig(base, patch);
}

/**
 * Message shown in Settings for keys that only take effect when the JSON config
 * is absent. Kept next to the loader so the two cannot drift apart.
 */
export function describeConfigSource(): string {
  const cfg = vscode.workspace.getConfiguration("grouter");
  const overrides: string[] = [];
  for (const key of ["baseUrl", "model", "reasoning.show", "telemetry.enabled"]) {
    if (cfg.get(key) !== undefined) overrides.push(`grouter.${key}`);
  }
  return overrides.length
    ? `VS Code settings override the file config for: ${overrides.join(", ")}`
    : `Using ${DEFAULT_CONFIG.baseUrl} from the gRouter config file.`;
}
