// Boots a REAL VS Code instance and runs the screenshot harness inside it.
// Mirrors test/runTests.mjs, but points at dist/shots.cjs and enables the
// DevTools port so the harness can photograph the workbench via CDP (this
// machine has no attached display, so OS-level capture returns black).
//
// Usage:  node ./test/runScreenshots.mjs   (npm run shots)
import * as net from "node:net";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function main() {
  const port = await freePort();
  console.log(`[runScreenshots] CDP port ${port}`);
  try {
    await runTests({
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath: path.resolve(projectRoot, "dist", "shots.cjs"),
      launchArgs: [
        path.resolve(projectRoot, "test", "fixtures", "workspace"),
        "--no-sandbox",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-git",
        "--disable-telemetry",
        "--disable-updates",
        `--remote-debugging-port=${port}`,
        "--new-window",
      ],
      extensionTestsEnv: {
        GROUTER_SHOTS: "1",
        GROUTER_CDP_PORT: String(port),
      },
    });
    console.log("[runScreenshots] done");
  } catch (err) {
    console.error("[runScreenshots] failed:", err);
    process.exit(1);
  }
}

void main();
