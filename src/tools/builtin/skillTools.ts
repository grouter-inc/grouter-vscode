import { z } from "zod";
import { ok, fail, type ToolSpec } from "../spec";
import type { SkillEngine } from "../../skills/engine";
import { slugify } from "../../agent/plan/artifact";

export function createSkillTools(engine: SkillEngine, sessionId: () => string): ToolSpec<never>[] {
  const listSkills: ToolSpec<{ query?: string }> = {
    id: "list_skills",
    displayName: "List Skills",
    description:
      "List available skills (markdown playbooks) with names, descriptions and triggers. Optionally filter by a query matched against name/description/triggers.",
    userDescription: "List available skills",
    readOnly: true,
    schema: z.object({
      query: z.string().optional().describe("Filter text"),
    }),
    async execute(input: { query?: string }) {
      const query = (input.query ?? "").toLowerCase();
      const skills = engine.list().filter((s) => {
        if (!query) return true;
        return (
          s.name.toLowerCase().includes(query) ||
          s.description.toLowerCase().includes(query) ||
          s.triggers.some((t) => t.includes(query))
        );
      });
      if (skills.length === 0) return ok("No matching skills. Create one with create_skill.");
      return ok(
        skills
          .map((s) => `- **${s.slug}** — ${s.name}: ${s.description}\n  triggers: ${s.triggers.join(", ") || "(none)"}`)
          .join("\n"),
      );
    },
  };

  const readSkill: ToolSpec<{ slug: string }> = {
    id: "read_skill",
    displayName: "Read Skill",
    description: "Read the full markdown content of a skill by slug. Use before applying a skill's playbook.",
    userDescription: "Read a skill's content",
    readOnly: true,
    schema: z.object({
      slug: z.string().describe("Skill slug, e.g. 'debugging'"),
    }),
    async execute(input: { slug: string }) {
      const skill = engine.get(input.slug);
      if (!skill) {
        const available = engine.list().map((s) => s.slug).join(", ");
        return fail(`Skill "${input.slug}" not found. Available: ${available}`);
      }
      engine.recordUse(skill.slug, sessionId(), 1);
      const header = [
        `# ${skill.name}`,
        "",
        `**Objective:** ${skill.objective || "(not set)"}`,
        skill.goals.length > 0 ? `**Goals:**\n${skill.goals.map((g) => `- ${g}`).join("\n")}` : "",
        "",
        "---",
        "",
      ]
        .filter((l) => l !== undefined)
        .join("\n");
      return ok(header + skill.content);
    },
  };

  const createSkill: ToolSpec<{
    name: string;
    description: string;
    objective: string;
    goals: string;
    triggers: string;
    content: string;
    overwrite?: boolean;
  }> = {
    id: "create_skill",
    displayName: "Create Skill",
    description:
      "Create or update a skill as a markdown file in ~/.grouter/skills/. Use when you discover a reusable procedure, pattern, or user preference worth remembering. A skill needs: an objective (what it achieves), goals (checkable outcomes, pipe-separated), triggers (keywords), and a markdown playbook.",
    userDescription: "Save a reusable skill (markdown playbook)",
    readOnly: false,
    schema: z.object({
      name: z.string().describe("Human-readable skill name"),
      description: z.string().describe("One line: when to use this skill"),
      objective: z.string().describe("What this skill achieves — outcome-focused, one sentence"),
      goals: z.string().describe("3-5 checkable outcomes, pipe-separated: 'Goal one | Goal two'"),
      triggers: z.string().describe("Comma-separated trigger keywords for automatic matching"),
      content: z.string().describe("Markdown playbook: numbered steps, tool names, anti-patterns"),
      overwrite: z.boolean().optional().describe("Overwrite an existing skill with the same slug"),
    }),
    async execute(input: {
      name: string;
      description: string;
      objective: string;
      goals: string;
      triggers: string;
      content: string;
      overwrite?: boolean;
    }) {
      const slug = slugify(input.name);
      const existing = engine.get(slug);
      if (existing && !input.overwrite) {
        return fail(
          `Skill "${slug}" already exists. Pass overwrite: true to replace it, or choose a different name.`,
        );
      }
      const triggers = input.triggers
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const goals = input.goals
        .split("|")
        .map((g) => g.trim())
        .filter(Boolean);
      const file = engine.saveMarkdown({
        slug,
        name: input.name,
        description: input.description,
        objective: input.objective,
        goals,
        triggers,
        content: input.content,
      });
      return ok(
        `Skill "${slug}" saved to ${file} (objective set, ${goals.length} goals, ${triggers.length} triggers).`,
      );
    },
  };

  const deleteSkill: ToolSpec<{ slug: string }> = {
    id: "delete_skill",
    displayName: "Delete Skill",
    description: "Delete a skill markdown file by slug. Requires approval.",
    userDescription: "Delete a skill",
    readOnly: false,
    schema: z.object({
      slug: z.string().describe("Skill slug to delete"),
    }),
    async execute(input: { slug: string }) {
      const removed = engine.deleteSkill(input.slug);
      return removed ? ok(`Skill "${input.slug}" deleted.`) : fail(`Skill "${input.slug}" not found.`);
    },
  };

  return [listSkills, readSkill, createSkill, deleteSkill] as unknown as ToolSpec<never>[];
}
