import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const testHome = path.join(os.tmpdir(), `grouter-skills-test-${Date.now()}`);
process.env.GROUTER_CONFIG_DIR = testHome;

const { parseSkillFile, serializeSkillFile } = await import("../../src/skills/types");
const { SkillEngine, skillsDir, ensureSkillUsageTable } = await import("../../src/skills/engine");
const { BUILTIN_SKILLS } = await import("../../src/skills/builtin");
const { closeDb } = await import("../../src/storage/db");
const { createSkillTools } = await import("../../src/tools/builtin/skillTools");

afterAll(() => {
  closeDb();
  try {
    fs.rmSync(testHome, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("builtin skill catalog (25 skills)", () => {
  it("ships exactly 25 builtin skills", () => {
    expect(BUILTIN_SKILLS.length).toBe(25);
  });

  it("every builtin has name, description, objective, goals, triggers, content", () => {
    for (const b of BUILTIN_SKILLS) {
      expect(b.name.length, `${b.slug} name`).toBeGreaterThan(2);
      expect(b.description.length, `${b.slug} description`).toBeGreaterThan(20);
      expect(b.objective.length, `${b.slug} objective`).toBeGreaterThan(30);
      expect(b.goals.length, `${b.slug} goals count`).toBeGreaterThanOrEqual(3);
      for (const goal of b.goals) {
        expect(goal.length, `${b.slug} goal length`).toBeGreaterThan(5);
      }
      expect(b.triggers.length, `${b.slug} triggers`).toBeGreaterThanOrEqual(3);
      expect(b.content.length, `${b.slug} content`).toBeGreaterThan(200);
    }
  });

  it("has unique slugs and no empty triggers", () => {
    const slugs = BUILTIN_SKILLS.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const b of BUILTIN_SKILLS) {
      for (const t of b.triggers) {
        expect(t.trim().length, `${b.slug} trigger`).toBeGreaterThan(1);
      }
    }
  });

  it("covers the required domains", () => {
    const slugs = new Set(BUILTIN_SKILLS.map((b) => b.slug));
    for (const required of [
      "debugging",
      "code-review",
      "refactoring",
      "test-writing",
      "planning",
      "api-integration",
      "error-handling",
      "security-review",
      "performance",
      "typescript-strict",
      "git-workflow",
      "code-exploration",
      "dependency-management",
      "async-concurrency",
      "data-modeling",
      "cli-development",
      "frontend-ui",
      "documentation",
      "release-management",
      "incident-response",
      "log-analysis",
      "context-management",
      "tool-orchestration",
      "prompt-engineering",
      "skill-authoring",
    ]) {
      expect(slugs.has(required), `missing required skill: ${required}`).toBe(true);
    }
  });
});

describe("skill markdown format", () => {
  it("roundtrips frontmatter (with objective + goals) + content", () => {
    const raw = serializeSkillFile(
      {
        name: "My Skill",
        description: "Does things",
        objective: "Achieve the outcome",
        goals: ["Goal one", "Goal two"],
        triggers: ["alpha", "beta"],
      },
      "# Steps\n\n1. Do it.",
    );
    const parsed = parseSkillFile(raw);
    expect(parsed).toBeDefined();
    expect(parsed!.name).toBe("My Skill");
    expect(parsed!.description).toBe("Does things");
    expect(parsed!.objective).toBe("Achieve the outcome");
    expect(parsed!.goals).toEqual(["Goal one", "Goal two"]);
    expect(parsed!.triggers).toEqual(["alpha", "beta"]);
    expect(parsed!.content).toContain("# Steps");
  });

  it("rejects malformed files (no frontmatter)", () => {
    expect(parseSkillFile("just some text")).toBeUndefined();
  });

  it("rejects files missing name", () => {
    expect(parseSkillFile("---\ndescription: x\n---\ncontent")).toBeUndefined();
  });

  it("parses files without objective/goals (backward compatible)", () => {
    const raw = "---\nname: Old\ndescription: legacy\ntriggers: a\n---\ncontent";
    const parsed = parseSkillFile(raw);
    expect(parsed).toBeDefined();
    expect(parsed!.objective).toBe("");
    expect(parsed!.goals).toEqual([]);
  });
});

describe("skill engine (markdown on disk)", () => {
  let engine: InstanceType<typeof SkillEngine>;

  beforeAll(() => {
    ensureSkillUsageTable();
    engine = new SkillEngine();
  });

  it("seeds builtin skills to ~/.grouter/skills as markdown files", () => {
    const written = engine.seedBuiltins();
    expect(written.length).toBeGreaterThanOrEqual(5);
    for (const file of written) {
      expect(file.startsWith(skillsDir())).toBe(true);
      expect(file.endsWith(".md")).toBe(true);
      const raw = fs.readFileSync(file, "utf8");
      expect(raw.startsWith("---")).toBe(true);
    }
  });

  it("lists seeded skills with names and triggers", () => {
    const skills = engine.list();
    expect(skills.length).toBeGreaterThanOrEqual(5);
    const debugging = skills.find((s) => s.slug === "debugging");
    expect(debugging).toBeDefined();
    expect(debugging!.triggers).toContain("bug");
  });

  it("does not overwrite existing files on re-seed", () => {
    const target = path.join(skillsDir(), "debugging.md");
    const original = fs.readFileSync(target, "utf8");
    fs.writeFileSync(target, serializeSkillFile({ name: "Custom", description: "mine", objective: "o", goals: [], triggers: ["x"] }, "custom"), "utf8");
    engine.reload();
    const written = engine.seedBuiltins();
    expect(written.find((f) => f.endsWith("debugging.md"))).toBeUndefined();
    const raw = fs.readFileSync(target, "utf8");
    expect(raw).toContain("Custom");
    fs.writeFileSync(target, original, "utf8");
    engine.reload();
  });

  it("matches skills by trigger keywords in the prompt", () => {
    engine.reload();
    const matches = engine.match({
      prompt: "the app is crashing with a weird exception and a stack trace",
      mode: "agent",
      recentFiles: [],
      memoryNotes: [],
      knowledgeTitles: [],
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].skill.slug).toBe("debugging");
    expect(matches[0].reasons.some((r) => r.includes("trigger"))).toBe(true);
  });

  it("matches by mode name", () => {
    const matches = engine.match({
      prompt: "do the thing",
      mode: "planning",
      recentFiles: [],
      memoryNotes: [],
      knowledgeTitles: [],
    });
    expect(matches.some((m) => m.skill.slug === "planning")).toBe(true);
  });

  it("returns no matches for unrelated prompts", () => {
    const matches = engine.match({
      prompt: "hello there",
      mode: "ask",
      recentFiles: [],
      memoryNotes: [],
      knowledgeTitles: [],
    });
    expect(matches).toHaveLength(0);
  });

  it("saves user skills as markdown and loads them back", () => {
    const file = engine.saveMarkdown({ slug: "project-conventions", name: "Project Conventions", description: "House style for this repo", objective: "Match house style", goals: ["Tabs", "No semicolons"], triggers: ["convention", "style"], content: "Always use tabs. Never use semicolons." });
    expect(fs.existsSync(file)).toBe(true);
    const skill = engine.get("project-conventions");
    expect(skill?.content).toContain("Never use semicolons");
  });

  it("deletes skills from disk", () => {
    engine.saveMarkdown({ slug: "temp-skill", name: "Temp", description: "x", objective: "o", goals: [], triggers: [], content: "x" });
    expect(engine.get("temp-skill")).toBeDefined();
    expect(engine.deleteSkill("temp-skill")).toBe(true);
    expect(engine.get("temp-skill")).toBeUndefined();
  });

  it("records usage in sqlite", () => {
    engine.recordUse("debugging", "ses_test", 5);
    const stats = engine.usageStats();
    expect(stats.find((s) => s.slug === "debugging")?.uses).toBeGreaterThanOrEqual(1);
  });
});

describe("skill tools", () => {
  it("exposes list/read/create/delete tools", () => {
    const engine = new SkillEngine();
    engine.seedBuiltins();
    const tools = createSkillTools(engine, () => "ses_test");
    const ids = tools.map((t) => t.id).sort();
    expect(ids).toEqual(["create_skill", "delete_skill", "list_skills", "read_skill"]);
  });

  it("read_skill returns content; unknown slug fails", async () => {
    const engine = new SkillEngine();
    engine.seedBuiltins();
    const tools = createSkillTools(engine, () => "ses_test");
    const read = tools.find((t) => t.id === "read_skill")!;
    const ctx = {
      workspaceRoot: undefined,
      token: { isCancellationRequested: false } as never,
      approve: async () => "allow" as const,
      log: () => undefined,
    };
    const found = await read.execute({ slug: "debugging" } as never, ctx);
    expect(found.ok).toBe(true);
    expect(found.content).toContain("Debugging playbook");
    const missing = await read.execute({ slug: "nope" } as never, ctx);
    expect(missing.ok).toBe(false);
  });

  it("create_skill refuses overwrite without flag", async () => {
    const engine = new SkillEngine();
    const tools = createSkillTools(engine, () => "ses_test");
    const create = tools.find((t) => t.id === "create_skill")!;
    const ctx = {
      workspaceRoot: undefined,
      token: { isCancellationRequested: false } as never,
      approve: async () => "allow" as const,
      log: () => undefined,
    };
    const input = { name: "Dup Test", description: "d", objective: "o", goals: "g1 | g2", triggers: "t", content: "c" };
    const first = await create.execute(input as never, ctx);
    expect(first.ok).toBe(true);
    const second = await create.execute(input as never, ctx);
    expect(second.ok).toBe(false);
    expect(second.content).toContain("already exists");
    const third = await create.execute({ ...input, overwrite: true } as never, ctx);
    expect(third.ok).toBe(true);
  });
});
