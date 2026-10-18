import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";

export const CONFIG_DIR_ENV = "GROUTER_CONFIG_DIR";
export const API_KEY_ENV = "GROUTER_API_KEY";

export const DEFAULT_CONFIG = {
  apiKey: "",
  baseUrl: "https://prod.grouter.web.id/v1",
  model: "DeepSeek-V4-Flash",
  maxOutputTokens: 8192,
  reasoning: { show: true, effort: "high" as string },
  agent: { maxIterations: 25, autoApprove: [] as string[], learnSkills: true },
  verify: {
    enabled: true,
    blockOnUnverified: true,
    testCommand: "" as string,
    typecheckCommand: "" as string,
    timeoutSeconds: 180,
  },
  ralph: { maxIterations: 5, stallLimit: 2 },
  hud: { enabled: true },
  tools: { truncateKB: 64 },
  telemetry: { enabled: false },
};

export const ConfigSchema = z.object({
  apiKey: z.string(),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  maxOutputTokens: z.number().int().positive(),
  reasoning: z.object({
    show: z.boolean(),
    effort: z.string(),
  }),
  agent: z.object({
    maxIterations: z.number().int().positive(),
    autoApprove: z.array(z.string()),
    learnSkills: z.boolean().default(true),
  }),
  verify: z
    .object({
      enabled: z.boolean().default(true),
      blockOnUnverified: z.boolean().default(true),
      testCommand: z.string().default(""),
      typecheckCommand: z.string().default(""),
      timeoutSeconds: z.number().int().min(10).max(600).default(180),
    })
    .default({ enabled: true, blockOnUnverified: true, testCommand: "", typecheckCommand: "", timeoutSeconds: 180 }),
  ralph: z
    .object({
      maxIterations: z.number().int().min(1).max(20).default(5),
      stallLimit: z.number().int().min(2).max(10).default(2),
    })
    .default({ maxIterations: 5, stallLimit: 2 }),
  hud: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  tools: z.object({ truncateKB: z.number().int().positive() }),
  telemetry: z.object({ enabled: z.boolean() }),
});

export type GRouterConfig = z.infer<typeof ConfigSchema>;

export function configDir(): string {
  const override = process.env[CONFIG_DIR_ENV];
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".grouter");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

export function mergeConfig(base: GRouterConfig, patch: Partial<GRouterConfig>): GRouterConfig {
  return {
    ...base,
    ...patch,
    reasoning: { ...base.reasoning, ...(patch.reasoning ?? {}) },
    agent: { ...base.agent, ...(patch.agent ?? {}) },
    verify: { ...base.verify, ...(patch.verify ?? {}) },
    ralph: { ...base.ralph, ...(patch.ralph ?? {}) },
    hud: { ...base.hud, ...(patch.hud ?? {}) },
    tools: { ...base.tools, ...(patch.tools ?? {}) },
    telemetry: { ...base.telemetry, ...(patch.telemetry ?? {}) },
  };
}

export function loadConfig(): GRouterConfig {
  const p = configPath();
  let raw: Partial<GRouterConfig> = {};
  if (fs.existsSync(p)) {
    const text = fs.readFileSync(p, "utf8");
    try {
      raw = JSON.parse(text) as Partial<GRouterConfig>;
    } catch (err) {
      throw new Error(`Invalid JSON in ${p}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const merged = mergeConfig(DEFAULT_CONFIG as GRouterConfig, raw);
  const parsed = ConfigSchema.parse(merged);
  if (!parsed.apiKey && process.env[API_KEY_ENV]) {
    parsed.apiKey = process.env[API_KEY_ENV]!.trim();
  }
  return parsed;
}

export function saveConfig(patch: Partial<GRouterConfig>): GRouterConfig {
  const current = loadConfig();
  const merged = mergeConfig(current, patch);
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2) + "\n", "utf8");
  return merged;
}

export function ensureConfigFile(): string {
  const p = configPath();
  if (!fs.existsSync(p)) {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8");
  }
  return p;
}
