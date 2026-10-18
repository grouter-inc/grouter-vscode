// Bundles the SCREENSHOT harness (test/host/shots-entry.ts) to dist/shots.cjs.
// Separate from esbuild.tests.mjs so capturing images never blocks the test
// pipeline, and the output never lands in the VSIX.
import esbuild from "esbuild";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(root, "test", "host", "shots-entry.ts")],
  outfile: path.join(root, "dist", "shots.cjs"),
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  external: ["vscode"],
  sourcemap: false,
  logLevel: "info",
});

console.log("[esbuild] screenshot harness bundled -> dist/shots.cjs");
