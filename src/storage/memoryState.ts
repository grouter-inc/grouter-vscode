import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir, sessionDir, nowIso } from "./db";

export interface SessionMemoryState {
  version: 1;
  sessionId: string;
  workspace: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  counters: {
    turns: number;
    toolCalls: number;
    denials: number;
    errors: number;
  };
  activePlan?: {
    slug: string;
    status: string;
    cursor: number;
    total: number;
  };
  lastFilesChanged: string[];
  notes: string[];
}

export class MemoryState {
  private state: SessionMemoryState;
  private readonly file: string;

  constructor(sessionId: string, workspace: string, model: string) {
    const dir = ensureDir(sessionDir(sessionId));
    this.file = path.join(dir, "state.json");
    this.state = this.load(sessionId, workspace, model);
  }

  private load(sessionId: string, workspace: string, model: string): SessionMemoryState {
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as SessionMemoryState;
        if (parsed.version === 1) {
          parsed.model = model;
          parsed.workspace = workspace;
          return parsed;
        }
      } catch {
        // corrupted state file → start fresh
      }
    }
    const now = nowIso();
    return {
      version: 1,
      sessionId,
      workspace,
      model,
      createdAt: now,
      updatedAt: now,
      counters: { turns: 0, toolCalls: 0, denials: 0, errors: 0 },
      lastFilesChanged: [],
      notes: [],
    };
  }

  get current(): SessionMemoryState {
    return this.state;
  }

  incrementTurn(): void {
    this.state.counters.turns++;
    this.persist();
  }

  incrementToolCalls(count: number): void {
    this.state.counters.toolCalls += count;
    this.persist();
  }

  incrementDenials(count: number): void {
    this.state.counters.denials += count;
    this.persist();
  }

  incrementErrors(count = 1): void {
    this.state.counters.errors += count;
    this.persist();
  }

  recordFilesChanged(files: string[]): void {
    const merged = new Set([...this.state.lastFilesChanged, ...files]);
    this.state.lastFilesChanged = [...merged].slice(-50);
    this.persist();
  }

  setActivePlan(plan: { slug: string; status: string; cursor: number; total: number } | undefined): void {
    this.state.activePlan = plan;
    this.persist();
  }

  addNote(note: string): void {
    this.state.notes.push(note);
    this.state.notes = this.state.notes.slice(-100);
    this.persist();
  }

  persist(): void {
    this.state.updatedAt = nowIso();
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2) + "\n", "utf8");
  }

  filePath(): string {
    return this.file;
  }
}
