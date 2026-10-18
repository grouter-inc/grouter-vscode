import { z } from "zod";
import { generateText } from "ai";
import type { GRouterConfig } from "../config/homeConfig";
import { createProvider } from "../llm/gateway";
import type { SkillEngine } from "../skills/engine";
import { slugify } from "./plan/artifact";

const LearnedSkillSchema = z.object({
  worth_learning: z.boolean(),
  name: z.string().optional(),
  description: z.string().optional(),
  objective: z.string().optional(),
  goals: z.string().optional(),
  triggers: z.string().optional(),
  content: z.string().optional(),
  reason: z.string().optional(),
});

export interface LearnOptions {
  config: GRouterConfig;
  skillEngine: SkillEngine;
  sessionId: string;
  mode: string;
  userRequest: string;
  outcomeSummary: string;
  toolsUsed: string[];
  filesChanged: string[];
  existingSkillSlugs: string[];
  signal: AbortSignal;
}

export interface LearnResult {
  learned: boolean;
  slug?: string;
  reason?: string;
}

const LEARN_PROMPT = [
  "You extract reusable skills from completed agent sessions.",
  "A skill is worth learning ONLY if it is: (a) a repeatable procedure specific to THIS project or user preference,",
  "(b) not already covered by an existing skill, and (c) concrete enough to follow without this conversation.",
  "Do NOT learn: one-off fixes, generic programming knowledge, anything already in the existing skills list.",
  "",
  "Respond with ONLY a JSON object:",
  '{"worth_learning": boolean, "name": string, "description": string, "objective": string, "goals": "Goal one | Goal two", "triggers": "comma,separated", "content": "markdown playbook", "reason": string}',
  'When worth_learning is false, set only {"worth_learning": false, "reason": "..."}.',
].join("\n");

export async function maybeLearnSkill(options: LearnOptions): Promise<LearnResult> {
  if (options.existingSkillSlugs.length > 40) {
    return { learned: false, reason: "skill budget reached" };
  }

  const provider = createProvider(options.config);
  try {
    const result = await generateText({
      model: provider.chatModel(options.config.model),
      system: LEARN_PROMPT,
      prompt: [
        `<session mode="${options.mode}">`,
        `<user_request>${options.userRequest.slice(0, 1500)}</user_request>`,
        `<outcome>${options.outcomeSummary.slice(0, 2000)}</outcome>`,
        `<tools_used>${options.toolsUsed.join(", ")}</tools_used>`,
        `<files_changed>${options.filesChanged.join(", ")}</files_changed>`,
        `<existing_skills>${options.existingSkillSlugs.join(", ")}</existing_skills>`,
      ].join("\n"),
      abortSignal: options.signal,
      maxOutputTokens: 2048,
    });

    const parsed = extractLearned(result.text);
    if (!parsed.ok || !parsed.value.worth_learning) {
      return { learned: false, reason: parsed.ok ? parsed.value.reason : parsed.error };
    }

    const skill = parsed.value;
    if (!skill.name || !skill.description || !skill.content) {
      return { learned: false, reason: "incomplete skill payload" };
    }

    const slug = slugify(skill.name);
    if (options.existingSkillSlugs.includes(slug)) {
      return { learned: false, reason: `skill "${slug}" already exists` };
    }

    const triggers = (skill.triggers ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const goals = (skill.goals ?? "")
      .split("|")
      .map((g) => g.trim())
      .filter(Boolean);

    options.skillEngine.saveMarkdown({
      slug,
      name: skill.name,
      description: skill.description,
      objective: skill.objective ?? skill.description,
      goals,
      triggers,
      content: skill.content,
    });
    options.skillEngine.recordUse(slug, options.sessionId, 0);

    return { learned: true, slug, reason: skill.reason };
  } catch (err) {
    return { learned: false, reason: String(err) };
  }
}

export function extractLearned(
  text: string,
): { ok: true; value: z.infer<typeof LearnedSkillSchema> } | { ok: false; error: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return { ok: false, error: "no JSON found" };

  try {
    const raw = JSON.parse(candidate.slice(start, end + 1));
    const validated = LearnedSkillSchema.safeParse(raw);
    if (!validated.success) return { ok: false, error: validated.error.issues.map((i) => i.message).join("; ") };
    return { ok: true, value: validated.data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
