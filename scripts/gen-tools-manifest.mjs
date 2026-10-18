// Generates contributes.languageModelTools in package.json from the real tool
// registry, so the declared manifest can never drift from what the extension
// actually registers at runtime.
//
// WHY THIS EXISTS (read before changing):
// VS Code refuses `lm.registerTool("grouter_x", ...)` unless "grouter_x" is
// declared in contributes.languageModelTools. A mismatch is not a warning — the
// tool is silently absent from the model's toolset, and the host logs
// `Tool "grouter_x" was not contributed.`
//
// The registry builds skill tools and the delegate tool only when their runtime
// dependencies are supplied (skillEngine, sessionId, delegation). Calling
// createDefaultRegistry() bare therefore yields 20 tools while the running
// extension registers 25 — that exact gap shipped in 0.3.1 and made the skill
// and sub-agent features dead on arrival. We now pass inert stand-ins so the
// manifest always describes the full set.
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stubPath = path.join(root, "scripts", "vscode-stub.mjs");
const outfile = path.join(root, "scripts", ".tools-manifest.cjs");

await esbuild.build({
  stdin: {
    contents: `
      import { createDefaultRegistry } from ${JSON.stringify(path.join(root, "src", "tools", "registry.ts"))};
      import { z } from "zod";

      // Inert stand-ins. The registry only checks that these are present; it
      // never calls them while we enumerate specs, so a shape-only object is
      // enough and keeps this script free of a VS Code runtime.
      const noop = () => undefined;
      const skillEngineStub = {
        list: () => [],
        reload: async () => undefined,
        seedBuiltins: async () => undefined,
        match: () => [],
        get: () => undefined,
        recordUse: async () => undefined,
        saveMarkdown: async () => undefined,
        deleteSkill: async () => undefined,
        usageStats: () => [],
        getDb: () => undefined,
      };
      const delegationStub = {
        config: () => ({}),
        registry: () => undefined,
        workspaceRoot: () => undefined,
        token: () => ({ isCancellationRequested: false, onCancellationRequested: () => ({ dispose: noop }) }),
        onEvent: noop,
        signal: () => new AbortController().signal,
        sessionId: () => "manifest",
        recordDelegation: noop,
        approve: async () => "allow",
      };

      // headless:false => the editor-only tools are included too, because this
      // manifest describes the in-editor extension.
      const registry = createDefaultRegistry({
        skillEngine: skillEngineStub,
        sessionId: () => "manifest",
        delegation: delegationStub,
        headless: false,
      });

      const tools = registry.all().map((t) => {
        const schema = z.toJSONSchema(t.schema);
        delete schema.$schema;
        return {
          name: "grouter_" + t.id,
          tags: ["grouter"],
          toolReferenceName: t.id,
          displayName: t.displayName,
          modelDescription: t.description,
          userDescription: t.userDescription,
          canBeReferencedInPrompt: true,
          icon: "$(sparkle)",
          inputSchema: schema,
        };
      });
      process.stdout.write(JSON.stringify(tools, null, 2));
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: outfile.replace(/\.mjs$/, ".cjs"),
  alias: { vscode: stubPath },
  logLevel: "warning",
});

const { execSync } = await import("node:child_process");
const json = execSync(`node ${JSON.stringify(outfile)}`, { encoding: "utf8" });
const tools = JSON.parse(json);
fs.rmSync(outfile, { force: true });

const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

// What the code registers at runtime — the manifest must be a superset.
const runtimeIds = new Set(tools.map((t) => t.name));
const declaredIds = new Set((pkg.contributes.languageModelTools ?? []).map((t) => t.name));

pkg.contributes.languageModelTools = tools;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

const added = tools.filter((t) => !declaredIds.has(t.name)).map((t) => t.name);
const removed = [...declaredIds].filter((n) => !runtimeIds.has(n));

console.log(`[gen-tools] wrote ${tools.length} languageModelTools entries to package.json`);
if (added.length) console.log(`[gen-tools] added (were missing -> tools would be dead): ${added.join(", ")}`);
if (removed.length) console.log(`[gen-tools] removed (no longer registered): ${removed.join(", ")}`);
