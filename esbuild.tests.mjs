// Bundles the extension-host test suite (test/host/entry.ts) to
// dist/test-suite.cjs so `@vscode/test-electron` can load it inside a real
// VS Code extension host.
//
// Kept separate from esbuild.mjs on purpose: this output must never ship in the
// VSIX, so it is not part of the extension build graph.
import esbuild from "esbuild";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(root, "test", "host", "entry.ts")],
  outfile: path.join(root, "dist", "test-suite.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  // Supplied by the extension host at runtime — must stay an external require.
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
});

console.log("[esbuild] host test suite bundled -> dist/test-suite.cjs");
