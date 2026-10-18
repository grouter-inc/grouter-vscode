import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const GROUTER_DIR_ENV = "GROUTER_CONFIG_DIR";

export function grouterHome(): string {
  const override = process.env[GROUTER_DIR_ENV];
  if (override && override.trim()) return override.trim();
  return path.join(os.homedir(), ".grouter");
}

export function dbPath(): string {
  return path.join(grouterHome(), "grouter.db");
}

export function sessionsDir(): string {
  return path.join(grouterHome(), "sessions");
}

export function sessionDir(sessionId: string): string {
  return path.join(sessionsDir(), sessionId);
}

export function tempRoot(): string {
  return path.join(os.tmpdir(), "grouter");
}

export function tempWorkspace(sessionId: string): string {
  return path.join(tempRoot(), sessionId);
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  ensureDir(grouterHome());
  db = new DatabaseSync(dbPath());
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      workspace TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      reasoning TEXT,
      mode TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

    CREATE TABLE IF NOT EXISTS memory (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, key)
    );

    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      scope TEXT NOT NULL DEFAULT 'session',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge(scope, session_id);

    CREATE TABLE IF NOT EXISTS tool_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_id TEXT NOT NULL,
      input_summary TEXT NOT NULL DEFAULT '',
      ok INTEGER NOT NULL DEFAULT 1,
      denied INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tool_usage_session ON tool_usage(session_id, id);

    CREATE TABLE IF NOT EXISTS plans (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      artifact_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (session_id, slug)
    );

    CREATE TABLE IF NOT EXISTS delegations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      specialist TEXT NOT NULL,
      task TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 1,
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_delegations_session ON delegations(session_id, id);
  `);
}

export function nowIso(): string {
  return new Date().toISOString();
}
