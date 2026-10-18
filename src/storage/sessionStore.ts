import { getDb, nowIso } from "./db";

export interface SessionRecord {
  id: string;
  title: string;
  model: string;
  workspace: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  reasoning: string | null;
  mode: string | null;
  createdAt: string;
}

export interface ToolUsageRecord {
  id: number;
  sessionId: string;
  toolId: string;
  inputSummary: string;
  ok: boolean;
  denied: boolean;
  durationMs: number | null;
  createdAt: string;
}

export interface KnowledgeRecord {
  id: number;
  sessionId: string | null;
  scope: string;
  title: string;
  content: string;
  tags: string;
  createdAt: string;
}

export interface PlanRecord {
  sessionId: string;
  slug: string;
  title: string;
  goal: string;
  status: string;
  artifactJson: string;
  createdAt: string;
  updatedAt: string;
}

export class SessionStore {
  constructor(readonly sessionId: string) {}

  static create(workspace: string, model: string, title = ""): SessionStore {
    const id = `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const store = new SessionStore(id);
    store.ensure(workspace, model, title);
    return store;
  }

  static latestForWorkspace(workspace: string, maxAgeMs = 12 * 60 * 60 * 1000): SessionStore | undefined {
    const row = getDb()
      .prepare(
        `SELECT id, updated_at FROM sessions
         WHERE workspace = ? AND status = 'active'
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(workspace) as { id: string; updated_at: string } | undefined;
    if (!row) return undefined;
    const age = Date.now() - Date.parse(row.updated_at);
    if (!Number.isFinite(age) || age > maxAgeMs) return undefined;
    return new SessionStore(row.id);
  }

  ensure(workspace: string, model: string, title = ""): void {
    const db = getDb();
    const now = nowIso();
    db.prepare(
      `INSERT INTO sessions (id, title, model, workspace, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT(id) DO UPDATE SET model = excluded.model, updated_at = excluded.updated_at`,
    ).run(this.sessionId, title, model, workspace, now, now);
  }

  touch(): void {
    getDb()
      .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
      .run(nowIso(), this.sessionId);
  }

  setTitle(title: string): void {
    getDb()
      .prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`)
      .run(title, nowIso(), this.sessionId);
  }

  get(): SessionRecord | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(this.sessionId) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : undefined;
  }

  addMessage(role: string, content: string, mode?: string, reasoning?: string): void {
    getDb()
      .prepare(
        `INSERT INTO messages (session_id, role, content, reasoning, mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(this.sessionId, role, content, reasoning ?? null, mode ?? null, nowIso());
    this.touch();
  }

  recentMessages(limit = 20): MessageRecord[] {
    const rows = getDb()
      .prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?`)
      .all(this.sessionId, limit) as Array<Record<string, unknown>>;
    return rows.reverse().map(rowToMessage);
  }

  addToolUsage(toolId: string, inputSummary: string, ok: boolean, denied: boolean, durationMs?: number): void {
    getDb()
      .prepare(
        `INSERT INTO tool_usage (session_id, tool_id, input_summary, ok, denied, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.sessionId, toolId, inputSummary, ok ? 1 : 0, denied ? 1 : 0, durationMs ?? null, nowIso());
    this.touch();
  }

  toolUsageSummary(): Array<{ toolId: string; count: number; denied: number }> {
    const rows = getDb()
      .prepare(
        `SELECT tool_id, COUNT(*) AS count, SUM(denied) AS denied
         FROM tool_usage WHERE session_id = ? GROUP BY tool_id ORDER BY count DESC`,
      )
      .all(this.sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      toolId: String(r.tool_id),
      count: Number(r.count),
      denied: Number(r.denied ?? 0),
    }));
  }

  setMemory(key: string, value: unknown): void {
    getDb()
      .prepare(
        `INSERT INTO memory (session_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(this.sessionId, key, JSON.stringify(value), nowIso());
  }

  getMemory<T = unknown>(key: string): T | undefined {
    const row = getDb()
      .prepare(`SELECT value FROM memory WHERE session_id = ? AND key = ?`)
      .get(this.sessionId, key) as { value?: string } | undefined;
    if (!row?.value) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  allMemory(): Record<string, unknown> {
    const rows = getDb()
      .prepare(`SELECT key, value FROM memory WHERE session_id = ?`)
      .all(this.sessionId) as Array<{ key: string; value: string }>;
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        out[row.key] = row.value;
      }
    }
    return out;
  }

  addKnowledge(title: string, content: string, tags: string[] = [], scope = "session"): void {
    getDb()
      .prepare(
        `INSERT INTO knowledge (session_id, scope, title, content, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(this.sessionId, scope, title, content, tags.join(","), nowIso());
  }

  searchKnowledge(query: string, limit = 10): KnowledgeRecord[] {
    const like = `%${query}%`;
    const rows = getDb()
      .prepare(
        `SELECT * FROM knowledge
         WHERE (session_id = ? OR scope = 'global') AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
         ORDER BY id DESC LIMIT ?`,
      )
      .all(this.sessionId, like, like, like, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToKnowledge);
  }

  recordDelegation(specialist: string, task: string, ok: boolean, summary: string): void {
    getDb()
      .prepare(
        `INSERT INTO delegations (session_id, specialist, task, ok, summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(this.sessionId, specialist, task, ok ? 1 : 0, summary, nowIso());
    this.touch();
  }

  delegationStats(): Array<{ specialist: string; count: number; failed: number }> {
    const rows = getDb()
      .prepare(
        `SELECT specialist, COUNT(*) AS count, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed
         FROM delegations WHERE session_id = ? GROUP BY specialist ORDER BY count DESC`,
      )
      .all(this.sessionId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      specialist: String(r.specialist),
      count: Number(r.count),
      failed: Number(r.failed ?? 0),
    }));
  }

  savePlan(slug: string, title: string, goal: string, status: string, artifactJson: string): void {
    const now = nowIso();
    getDb()
      .prepare(
        `INSERT INTO plans (session_id, slug, title, goal, status, artifact_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, slug) DO UPDATE SET
           title = excluded.title, goal = excluded.goal, status = excluded.status,
           artifact_json = excluded.artifact_json, updated_at = excluded.updated_at`,
      )
      .run(this.sessionId, slug, title, goal, status, artifactJson, now, now);
    this.touch();
  }

  getPlan(slug: string): PlanRecord | undefined {
    const row = getDb()
      .prepare(`SELECT * FROM plans WHERE session_id = ? AND slug = ?`)
      .get(this.sessionId, slug) as Record<string, unknown> | undefined;
    return row ? rowToPlan(row) : undefined;
  }

  listPlans(): PlanRecord[] {
    const rows = getDb()
      .prepare(`SELECT * FROM plans WHERE session_id = ? ORDER BY updated_at DESC`)
      .all(this.sessionId) as Array<Record<string, unknown>>;
    return rows.map(rowToPlan);
  }
}

function rowToSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    model: String(row.model ?? ""),
    workspace: String(row.workspace ?? ""),
    status: String(row.status ?? "active"),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function rowToMessage(row: Record<string, unknown>): MessageRecord {
  return {
    id: Number(row.id),
    sessionId: String(row.session_id),
    role: String(row.role),
    content: String(row.content),
    reasoning: row.reasoning === null || row.reasoning === undefined ? null : String(row.reasoning),
    mode: row.mode === null || row.mode === undefined ? null : String(row.mode),
    createdAt: String(row.created_at),
  };
}

function rowToKnowledge(row: Record<string, unknown>): KnowledgeRecord {
  return {
    id: Number(row.id),
    sessionId: row.session_id === null || row.session_id === undefined ? null : String(row.session_id),
    scope: String(row.scope ?? "session"),
    title: String(row.title),
    content: String(row.content),
    tags: String(row.tags ?? ""),
    createdAt: String(row.created_at),
  };
}

function rowToPlan(row: Record<string, unknown>): PlanRecord {
  return {
    sessionId: String(row.session_id),
    slug: String(row.slug),
    title: String(row.title),
    goal: String(row.goal),
    status: String(row.status),
    artifactJson: String(row.artifact_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
