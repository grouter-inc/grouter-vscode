// Integration test runner — boots a REAL VS Code instance and runs the
// extension host tests inside it.
//
// Why this exists: the vitest suite aliases `vscode` to a hand-written stub
// (test/stubs/vscode.ts), so it only ever exercises our idea of the VS Code API.
// A real bug where `chat` was absent from the stub proved the difference
// matters: the extension crashed on every message while 141 mocked tests passed.
//
// Anything that touches a VS Code object should be tested here, against the
// real implementation, not against the stub.
//
// Usage:  node ./test/runTests.mjs
//         npm run test:host
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

async function main() {
  try {
    // The suite lives in the TypeScript, compiled on the fly by the extension
    // host loader configured below. We point at the compiled output instead so
    // the runner does not need its own bundler step.
    const extensionDevelopmentPath = projectRoot;
    const extensionTestsPath = path.resolve(projectRoot, "dist", "test-suite.cjs");

    // Deterministic on a headless machine: no window to steal focus, and no
    // GPU requirement. The suite only reads/writes workspace files.
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        path.resolve(projectRoot, "test", "fixtures", "workspace"),
        "--disable-extensions",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
      ],
      extensionTestsEnv: {
        // Surface our own logs in the test output rather than swallowing them.
        GROUTER_HOST_TEST: "1",
      },
    });
  } catch (err) {
    console.error("[runTests] failed:", err);
    process.exit(1);
  }
}

void main();
