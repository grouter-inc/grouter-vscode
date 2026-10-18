import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const testHome = path.join(os.tmpdir(), `grouter-test-home-${Date.now()}`);
process.env.GROUTER_CONFIG_DIR = testHome;

const { SessionStore } = await import("../../src/storage/sessionStore");
const { MemoryState } = await import("../../src/storage/memoryState");
const { TempWorkspace } = await import("../../src/storage/tempWorkspace");
const { closeDb, dbPath, sessionDir, tempWorkspace } = await import("../../src/storage/db");

afterAll(() => {
  closeDb();
  try {
    fs.rmSync(testHome, { recursive: true, force: true });
    fs.rmSync(path.dirname(tempWorkspace("x")), { recursive: true, force: true });
  } catch {
    // best effort
  }
});

describe("sqlite storage", () => {
  it("creates the database in the grouter home dir", () => {
    expect(dbPath()).toBe(path.join(testHome, "grouter.db"));
  });

  it("creates sessions and persists messages", () => {
    const store = SessionStore.create("/work/proj", "test-model", "Test Session");
    store.addMessage("user", "hello", "ask");
    store.addMessage("assistant", "hi there", "ask");

    const session = store.get();
    expect(session?.workspace).toBe("/work/proj");
    expect(session?.model).toBe("test-model");

    const messages = store.recentMessages(10);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("hello");
    expect(messages[1].role).toBe("assistant");
  });

  it("records tool usage and aggregates it", () => {
    const store = SessionStore.create("/work/proj", "m", "tools");
    store.addToolUsage("read_file", "src/a.ts", true, false, 12);
    store.addToolUsage("apply_patch", "src/a.ts", true, false, 30);
    store.addToolUsage("run_command", "npm test", false, true, 100);

    const summary = store.toolUsageSummary();
    expect(summary).toHaveLength(3);
    const runCmd = summary.find((s) => s.toolId === "run_command");
    expect(runCmd?.denied).toBe(1);
  });

  it("stores and retrieves memory key-values", () => {
    const store = SessionStore.create("/w", "m", "mem");
    store.setMemory("lastTopic", { topic: "auth", ts: 123 });
    store.setMemory("count", 5);

    expect(store.getMemory<{ topic: string }>("lastTopic")?.topic).toBe("auth");
    expect(store.getMemory<number>("count")).toBe(5);
    expect(store.allMemory()).toHaveProperty("lastTopic");
  });

  it("stores knowledge and searches it", () => {
    const store = SessionStore.create("/w", "m", "kb");
    store.addKnowledge("Auth flow", "The auth flow uses JWT tokens in cookies.", ["auth", "security"]);
    store.addKnowledge("Build system", "Uses esbuild for bundling.", ["build"]);

    const hits = store.searchKnowledge("JWT");
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("Auth flow");
    expect(hits[0].tags).toContain("auth");
  });

  it("stores plans in the database with upsert", () => {
    const store = SessionStore.create("/w", "m", "plans");
    const artifact = { slug: "test", title: "Test", steps: [] };
    store.savePlan("test", "Test", "goal", "draft", JSON.stringify(artifact));

    let plans = store.listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe("draft");

    store.savePlan("test", "Test", "goal", "done", JSON.stringify(artifact));
    plans = store.listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].status).toBe("done");
  });

  it("scopes data per session", () => {
    const a = SessionStore.create("/w", "m", "a");
    const b = SessionStore.create("/w", "m", "b");
    a.setMemory("k", "a-value");
    b.setMemory("k", "b-value");

    expect(a.getMemory("k")).toBe("a-value");
    expect(b.getMemory("k")).toBe("b-value");
  });
});

describe("memory state (JSON per session)", () => {
  it("persists counters and state to the session folder", () => {
    const store = SessionStore.create("/w", "m", "memstate");
    const mem = new MemoryState(store.sessionId, "/w", "m");

    mem.incrementTurn();
    mem.incrementTurn();
    mem.incrementToolCalls(3);
    mem.incrementDenials(1);
    mem.recordFilesChanged(["a.ts", "b.ts"]);
    mem.setActivePlan({ slug: "p1", status: "in-progress", cursor: 1, total: 3 });

    const file = mem.filePath();
    expect(fs.existsSync(file)).toBe(true);
    expect(file.startsWith(sessionDir(store.sessionId))).toBe(true);

    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(raw.counters.turns).toBe(2);
    expect(raw.counters.toolCalls).toBe(3);
    expect(raw.counters.denials).toBe(1);
    expect(raw.lastFilesChanged).toEqual(["a.ts", "b.ts"]);
    expect(raw.activePlan.slug).toBe("p1");

    const reloaded = new MemoryState(store.sessionId, "/w", "m");
    expect(reloaded.current.counters.turns).toBe(2);
  });
});

describe("temp workspace", () => {
  it("creates scratch dir under os temp", () => {
    const store = SessionStore.create("/w", "m", "temp");
    const temp = new TempWorkspace(store.sessionId);

    expect(temp.root.startsWith(path.join(os.tmpdir(), "grouter"))).toBe(true);
    expect(temp.root).toBe(tempWorkspace(store.sessionId));

    const p = temp.write("scratch.txt", "hello temp");
    expect(fs.readFileSync(p, "utf8")).toBe("hello temp");
    expect(temp.read("scratch.txt")).toBe("hello temp");
    expect(temp.list()).toContain("scratch.txt");

    temp.cleanup();
    expect(fs.existsSync(temp.root)).toBe(false);
  });

  it("sanitizes file names", () => {
    const temp = new TempWorkspace("sanitize-test");
    const p = temp.pathFor("../../evil name?.txt");
    expect(p.startsWith(temp.root)).toBe(true);
    expect(p).not.toContain("..");
    temp.cleanup();
  });
});
