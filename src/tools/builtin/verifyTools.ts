import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";
import { collectEvidence, renderReport } from "../../agent/verify/evidence";

/**
 * Lets the agent *itself* ask for evidence before claiming success.
 *
 * The prompt tells the agent to call this before saying "done", but the gate in
 * the chat handler does not trust the agent to comply — it re-collects evidence
 * independently. This tool exists so a well-behaved agent produces the right
 * output on the first try instead of getting its claim rejected.
 */
export const verifyWorkTool: VerifyWorkSpec = {
  id: "verify_work",
  displayName: "Verify Work",
  description:
    "Run the project's real verification (tests, typecheck, git diff) and return exit codes plus output. " +
    "Call this BEFORE claiming a task is complete. If anything fails, fix it and call again — never claim done without green evidence.",
  userDescription: "Verify the work with tests, typecheck and diff",
  readOnly: true,
  schema: z.object({
    testCommand: z.string().optional().describe("Override the detected test command"),
    typecheckCommand: z.string().optional().describe("Override the detected typecheck command"),
    only: z
      .array(z.enum(["tests", "typecheck", "diff"]))
      .optional()
      .describe("Limit which evidence to collect (default: all)"),
    timeoutSeconds: z.number().int().min(10).max(600).optional().describe("Per-command timeout (default 180)"),
  }),
  async execute(input, ctx) {
    if (!ctx.workspaceRoot) return fail("No workspace folder open — cannot verify anything.");

    const report = await collectEvidence({
      workspaceRoot: ctx.workspaceRoot,
      testCommand: input.testCommand,
      typecheckCommand: input.typecheckCommand,
      only: input.only,
      timeoutSeconds: input.timeoutSeconds,
    });

    const body = [renderReport(report), "", report.blocker ? `**Blocker:** ${report.blocker}` : ""]
      .filter(Boolean)
      .join("\n");

    return report.ok ? ok(body) : fail(body);
  },
};

type VerifyWorkSpec = ToolSpec<{
  testCommand?: string;
  typecheckCommand?: string;
  only?: Array<"tests" | "typecheck" | "diff">;
  timeoutSeconds?: number;
}>;
