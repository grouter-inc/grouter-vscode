import * as fs from "node:fs";
import * as path from "node:path";
import { getDb, nowIso, ensureDir, grouterHome } from "../storage/db";
import { BUILTIN_SKILLS } from "./builtin";
import { parseSkillFile, serializeSkillFile, type SkillDefinition, type SkillContext, type SkillMatch } from "./types";

export function skillsDir(): string {
  return path.join(grouterHome(), "skills");
}

/**
 * Skills are Markdown files with YAML frontmatter in ~/.grouter/skills/.
 * Builtins are seeded to disk on first run so users can read and customize them.
 */
export class SkillEngine {
  private loaded: SkillDefinition[] | undefined;

  list(): SkillDefinition[] {
    if (!this.loaded) this.loaded = this.loadAll();
    return this.loaded;
  }

  reload(): void {
    this.loaded = undefined;
  }

  seedBuiltins(): string[] {
    const dir = ensureDir(skillsDir());
    const written: string[] = [];
    const now = nowIso();
    for (const b of BUILTIN_SKILLS) {
      const target = path.join(dir, `${b.slug}.md`);
      if (fs.existsSync(target)) continue;
      fs.writeFileSync(
        target,
        serializeSkillFile(
          { name: b.name, description: b.description, objective: b.objective, goals: b.goals, triggers: b.triggers },
          b.content,
        ),
        "utf8",
      );
      written.push(target);
    }
    void now;
    this.reload();
    return written;
  }

  private loadAll(): SkillDefinition[] {
    const skills: SkillDefinition[] = [];
    const dir = skillsDir();
    if (!fs.existsSync(dir)) return skills;

    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      try {
        const full = path.join(dir, file);
        const raw = fs.readFileSync(full, "utf8");
        const parsed = parseSkillFile(raw);
        if (!parsed) continue;
        const stat = fs.statSync(full);
        skills.push({
          slug: file.replace(/\.md$/, ""),
          name: parsed.name,
          description: parsed.description,
          objective: parsed.objective,
          goals: parsed.goals,
          triggers: parsed.triggers,
          source: "user",
          createdAt: stat.birthtime.toISOString(),
          updatedAt: stat.mtime.toISOString(),
          content: parsed.content,
        });
      } catch {
        continue;
      }
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  match(context: SkillContext, limit = 2): SkillMatch[] {
    const haystack = [
      context.prompt,
      context.mode,
      context.activeFile ?? "",
      context.recentFiles.join(" "),
      context.memoryNotes.join(" "),
      context.knowledgeTitles.join(" "),
    ]
      .join(" ")
      .toLowerCase();

    const matches: SkillMatch[] = [];
    for (const skill of this.list()) {
      let score = 0;
      const reasons: string[] = [];

      for (const trigger of skill.triggers) {
        if (haystack.includes(trigger)) {
          score += trigger.includes(" ") ? 3 : 2;
          reasons.push(`trigger "${trigger}"`);
        }
      }

      if (context.activeFile && skill.triggers.some((t) => context.activeFile!.toLowerCase().includes(t))) {
        score += 1;
        reasons.push("active file");
      }

      if (context.mode === skill.slug) {
        score += 4;
        reasons.push("mode match");
      }

      if (score > 0) matches.push({ skill, score, reasons });
    }

    return matches.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  get(slug: string): SkillDefinition | undefined {
    return this.list().find((s) => s.slug === slug);
  }

  recordUse(slug: string, sessionId: string, score: number): void {
    getDb()
      .prepare(`INSERT INTO skill_usage (slug, session_id, score, created_at) VALUES (?, ?, ?, ?)`)
      .run(slug, sessionId, score, nowIso());
  }

  saveMarkdown(skill: {
    slug: string;
    name: string;
    description: string;
    objective: string;
    goals: string[];
    triggers: string[];
    content: string;
  }): string {
    const dir = ensureDir(skillsDir());
    const target = path.join(dir, `${skill.slug}.md`);
    fs.writeFileSync(
      target,
      serializeSkillFile(
        {
          name: skill.name,
          description: skill.description,
          objective: skill.objective,
          goals: skill.goals,
          triggers: skill.triggers,
        },
        skill.content,
      ),
      "utf8",
    );
    this.reload();
    return target;
  }

  deleteSkill(slug: string): boolean {
    const file = path.join(skillsDir(), `${slug}.md`);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    this.reload();
    return true;
  }

  usageStats(): Array<{ slug: string; uses: number }> {
    const rows = getDb()
      .prepare(`SELECT slug, COUNT(*) AS uses FROM skill_usage GROUP BY slug ORDER BY uses DESC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({ slug: String(r.slug), uses: Number(r.uses) }));
  }
}

export function ensureSkillUsageTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS skill_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      session_id TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_skill_usage_slug ON skill_usage(slug, id);
  `);
}
