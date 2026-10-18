/**
 * Guards the settings contract.
 *
 * WHY: contributes.configuration advertised five grouter.* keys but only
 * grouter.mcp.port was ever read by the code. The other four were inert — a user
 * could toggle them in the Settings UI and see nothing happen, with no warning.
 * Nothing in the suite compared "declared settings" against "settings the code
 * consumes", so the gap survived several releases.
 *
 * The rule enforced here: every advertised setting must be read somewhere with
 * the namespace-aware accessor, i.e. getConfiguration("grouter").get("<key>").
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");

function sourceFiles(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "spikes") continue; // scratch code, not shipped
        walk(full);
      } else if (entry.name.endsWith(".ts")) {
        out.push({
          rel: path.relative(root, full).replace(/\\/g, "/"),
          text: fs.readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(path.join(root, "src"));
  return out;
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  contributes?: { configuration?: unknown };
};

function declaredKeys(): string[] {
  const cfg = pkg.contributes?.configuration;
  const blocks = Array.isArray(cfg) ? cfg : cfg ? [cfg] : [];
  const keys: string[] = [];
  for (const block of blocks as Array<{ properties?: Record<string, unknown> }>) {
    keys.push(...Object.keys(block.properties ?? {}));
  }
  return keys.sort();
}

/** Settings read through a namespace-aware accessor, e.g. "grouter.mcp.port". */
function consumedKeys(): Set<string> {
  const files = sourceFiles();
  const found = new Set<string>();
  // getConfiguration("grouter").get<T>("mcp.port")
  for (const { text } of files) {
    for (const m of text.matchAll(
      /getConfiguration\(\s*["']([^"']+)["']\s*\)(?:\s*,\s*[^)]+)?\s*\.get(?:<[^>]*>)?\(\s*["']([^"']+)["']/g,
    )) {
      found.add(`${m[1]}.${m[2]}`);
    }
    // A helper that reads several keys off one namespace handle.
    if (/getConfiguration\(\s*["']grouter["']\s*\)/.test(text)) {
      for (const m of text.matchAll(/cfg\.get(?:<[^>]*>)?\(\s*["']([^"']+)["']/g)) {
        found.add(`grouter.${m[1]}`);
      }
    }
  }
  return found;
}

describe("contributes.configuration contract", () => {
  it("advertises at least one setting", () => {
    expect(declaredKeys().length).toBeGreaterThan(0);
  });

  it("every advertised setting is actually read by the code", () => {
    const declared = declaredKeys();
    const consumed = consumedKeys();
    const inert = declared.filter((k) => !consumed.has(k));
    expect(
      inert,
      `these settings appear in the Settings UI but nothing reads them, so changing them does nothing: ${inert.join(", ")}`,
    ).toEqual([]);
  });

  it("reads the settings through the settings-override layer", () => {
    // The override layer is what makes the editor settings meaningful; if it
    // disappears, the settings silently go inert again.
    const text = fs.readFileSync(path.join(root, "src", "config", "settingsOverride.ts"), "utf8");
    for (const key of ["baseUrl", "model", "reasoning.show", "telemetry.enabled"]) {
      expect(text, `settingsOverride does not apply grouter.${key}`).toContain(`"${key}"`);
    }
  });
});
