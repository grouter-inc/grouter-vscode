/**
 * Guards the declared-vs-registered tool contract.
 *
 * WHY: VS Code silently drops `lm.registerTool(name, …)` when `name` is not
 * listed in contributes.languageModelTools. There is no runtime error in the
 * extension — the tool just never appears for the model. In 0.3.1 the manifest
 * generator emitted 20 entries while the extension registered 25, leaving the
 * skill and sub-agent tools dead. The mocked suite could not see it because
 * nothing in it compared the two sets.
 *
 * This test runs without a VS Code host so it fails fast in CI. The end-to-end
 * confirmation lives in test/host/suite.ts.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  contributes?: { languageModelTools?: Array<{ name: string }> };
};

/** Tool ids the in-editor extension registers, read from the source of truth. */
function registeredToolIds(): string[] {
  const dir = path.join(root, "src", "tools", "builtin");
  const ids = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    for (const m of src.matchAll(/id:\s*"([a-z_][a-z0-9_]*)"/gi)) ids.add(m[1]);
  }
  return [...ids].sort();
}

describe("languageModelTools manifest", () => {
  const declared = (pkg.contributes?.languageModelTools ?? []).map((t) => t.name);
  const ids = registeredToolIds();

  it("declares at least one tool", () => {
    expect(declared.length).toBeGreaterThan(0);
  });

  it("declares every tool the extension can register", () => {
    // Every id found in src/tools/builtin must have a grouter_<id> entry.
    const missing = ids.filter((id) => !declared.includes(`grouter_${id}`));
    expect(
      missing,
      `these tools are registered at runtime but never declared, so VS Code rejects them: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("declares the skill and delegation tools (the 0.3.1 regression)", () => {
    for (const name of [
      "grouter_list_skills",
      "grouter_read_skill",
      "grouter_create_skill",
      "grouter_delete_skill",
      "grouter_delegate_to_specialist",
    ]) {
      expect(declared, `${name} missing from contributes.languageModelTools`).toContain(name);
    }
  });

  it("gives every entry the fields VS Code requires", () => {
    const problems: string[] = [];
    for (const t of (pkg.contributes?.languageModelTools ?? []) as Array<Record<string, unknown>>) {
      for (const field of ["name", "displayName", "modelDescription", "inputSchema"]) {
        if (!t[field]) problems.push(`${String(t.name)}: missing "${field}"`);
      }
      if (typeof t.name === "string" && !t.name.startsWith("grouter_")) {
        problems.push(`${String(t.name)}: must start with "grouter_"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("has no duplicate names", () => {
    const dupes = declared.filter((n, i) => declared.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });
});
