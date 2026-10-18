// esbuild bundler for the gRouter VS Code extension.
//
// Production (default):  dist/extension.js, dist/mcp-server.js
// Development (--dev):   adds the spike entries under src/spikes/ for local evidence runs.
import esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");
const dev = process.argv.includes("--dev");

const productionEntries = [
  { in: "src/extension.ts", out: "extension" },
  { in: "src/mcp-server.ts", out: "mcp-server" },
];

const spikeEntries = [
  { in: "src/spikes/hostSmoke.ts", out: "host-smoke" },
  { in: "src/spikes/reasoningSpike.ts", out: "reasoning-spike" },
  { in: "src/spikes/langgraphInterruptSpike.ts", out: "langgraph-interrupt-spike" },
  { in: "src/spikes/seedSkills.ts", out: "seed-skills" },
  { in: "src/spikes/mcpRoundtripSpike.ts", out: "mcp-roundtrip-spike" },
  { in: "src/spikes/mcpHttpSpike.ts", out: "mcp-http-spike" },
];

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: dev ? [...productionEntries, ...spikeEntries] : productionEntries,
  outdir: "dist",
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["vscode"],
  sourcemap: dev,
  minify: !dev,
  logLevel: "info",
  conditions: ["node", "import"],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`[esbuild] watching${dev ? " (dev, spikes included)" : " (production)"}…`);
} else {
  await esbuild.build(options);
  console.log(`[esbuild] ${dev ? "dev" : "production"} build complete`);
}
