import { z } from "zod";
import { generateText } from "ai";
import type { GRouterConfig } from "../../config/homeConfig";
import { createProvider } from "../../llm/gateway";
import { mapGatewayError, type GRouterError } from "../../llm/errors";
import type { PlanArtifact, PlanStep } from "./artifact";
import { slugify } from "./artifact";

const PlanSchema = z.object({
  title: z.string().describe("Short plan title, 3-8 words"),
  goal: z.string().describe("One paragraph describing the desired end state"),
  steps: z
    .array(
      z.object({
        title: z.string().describe("Short imperative step title"),
        objective: z.string().describe("What this step achieves and how"),
        files: z.array(z.string()).describe("Workspace-relative files likely touched (may be empty)"),
        verify: z
          .string()
          .optional()
          .describe("Shell command that verifies this step, if applicable"),
      }),
    )
    .min(2)
    .max(12),
});

export type PlanDraft = z.infer<typeof PlanSchema>;

export interface GeneratePlanOptions {
  config: GRouterConfig;
  goal: string;
  contextText: string;
  signal: AbortSignal;
}

export interface GeneratePlanResult {
  plan?: PlanArtifact;
  error?: GRouterError;
}

const SYSTEM_PROMPT = [
  "You are gRouter's planning engine inside VS Code.",
  "Break the goal into 2-12 ordered, independently verifiable steps.",
  "Each step must be concrete: what changes, in which files, and how to verify it.",
  "Prefer small steps; never combine refactoring with behavior changes in one step.",
  "",
  "Respond with ONLY a JSON object (no markdown fences, no commentary) matching this shape:",
  '{"title": string, "goal": string, "steps": [{"title": string, "objective": string, "files": string[], "verify"?: string}]}',
].join("\n");

export async function generatePlan(options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const provider = createProvider(options.config);
  const userPrompt = [
    `<goal>\n${options.goal}\n</goal>`,
    options.contextText ? `<workspace_context>\n${options.contextText}\n</workspace_context>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let lastError = "";
  let lastGatewayError: GRouterError | undefined;
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const prompt =
        attempt === 0
          ? userPrompt
          : `${userPrompt}\n\nYour previous response could not be parsed: ${lastError}\nRespond with ONLY the JSON object.`;

      const result = await generateText({
        model: provider.chatModel(options.config.model),
        system: SYSTEM_PROMPT,
        prompt,
        abortSignal: options.signal,
        maxOutputTokens: options.config.maxOutputTokens,
        ...(options.config.reasoning.effort.length > 0
          ? { providerOptions: { grouter: { reasoningEffort: options.config.reasoning.effort } } }
          : {}),
      });

      const parsed = extractAndValidate(result.text);
      if (parsed.ok) {
        return { plan: toArtifact(parsed.value, options.config.model) };
      }
      lastError = parsed.error;
    } catch (err) {
      // A transport failure (gateway hiccup, truncated body, timeout) must not
      // abort the attempt loop: a busy gateway can drop one request and serve
      // the next fine. Retry, and only surface the error once attempts run out.
      if (options.signal.aborted) return { error: mapGatewayError(err) };
      lastGatewayError = mapGatewayError(err);
      lastError = lastGatewayError.detail;
    }

    // Small backoff so a rate-limited gateway has room to recover.
    if (attempt < MAX_ATTEMPTS - 1 && !options.signal.aborted) {
      await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
    }
  }

  if (lastGatewayError) return { error: lastGatewayError };

  return {
    error: {
      kind: "unknown",
      title: "Plan generation failed",
      detail: `The model did not return valid plan JSON. Last issue: ${lastError}`,
      retryable: true,
    },
  };
}

export function extractAndValidate(
  text: string,
): { ok: true; value: PlanDraft } | { ok: false; error: string } {
  const jsonText = extractJson(text);
  if (!jsonText) return { ok: false, error: "no JSON object found in the response" };

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  const validated = PlanSchema.safeParse(raw);
  if (!validated.success) {
    return { ok: false, error: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, value: validated.data };
}

export function extractJson(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return candidate.slice(start, end + 1);
}

function toArtifact(draft: PlanDraft, model: string): PlanArtifact {
  const steps: PlanStep[] = draft.steps.map((s, i) => ({
    index: i + 1,
    title: s.title,
    status: "pending",
    objective: s.objective,
    files: s.files,
    verify: s.verify,
  }));

  return {
    slug: slugify(draft.title),
    title: draft.title,
    goal: draft.goal,
    status: "draft",
    created: new Date().toISOString(),
    model,
    steps,
  };
}
