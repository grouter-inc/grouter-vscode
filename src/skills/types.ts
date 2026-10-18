export interface SkillMeta {
  slug: string;
  name: string;
  description: string;
  objective: string;
  goals: string[];
  triggers: string[];
  source: "builtin" | "user" | "learned";
  createdAt: string;
  updatedAt: string;
}

export interface SkillDefinition extends SkillMeta {
  content: string;
}

export interface SkillMatch {
  skill: SkillDefinition;
  score: number;
  reasons: string[];
}

export interface SkillContext {
  prompt: string;
  mode: string;
  activeFile?: string;
  recentFiles: string[];
  memoryNotes: string[];
  knowledgeTitles: string[];
}

export interface ParsedSkillFile {
  name: string;
  description: string;
  objective: string;
  goals: string[];
  triggers: string[];
  content: string;
}

export function parseSkillFile(raw: string): ParsedSkillFile | undefined {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return undefined;

  const frontmatter = match[1];
  const content = match[2].trim();

  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const objective = frontmatter.match(/^objective:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const goalsRaw = frontmatter.match(/^goals:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const triggersRaw = frontmatter.match(/^triggers:\s*(.+)$/m)?.[1]?.trim() ?? "";

  const goals = goalsRaw
    .split("|")
    .map((g) => g.trim())
    .filter(Boolean);
  const triggers = triggersRaw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (!name || !description) return undefined;
  return { name, description, objective, goals, triggers, content };
}

export function serializeSkillFile(
  meta: { name: string; description: string; objective: string; goals: string[]; triggers: string[] },
  content: string,
): string {
  return [
    "---",
    `name: ${meta.name}`,
    `description: ${meta.description}`,
    `objective: ${meta.objective}`,
    `goals: ${meta.goals.join(" | ")}`,
    `triggers: ${meta.triggers.join(", ")}`,
    "---",
    "",
    content.trim(),
    "",
  ].join("\n");
}

export function renderSkillMarkdown(skill: SkillDefinition): string {
  return [
    `# ${skill.name}`,
    "",
    `**Description:** ${skill.description}`,
    "",
    `**Objective:** ${skill.objective || "(not set)"}`,
    "",
    "**Goals:**",
    ...(skill.goals.length > 0 ? skill.goals.map((g) => `- ${g}`) : ["- (not set)"]),
    "",
    "---",
    "",
    skill.content,
  ].join("\n");
}
