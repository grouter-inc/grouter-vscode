import * as fs from "node:fs";
import * as path from "node:path";
import { ensureDir, tempWorkspace } from "./db";

export class TempWorkspace {
  readonly root: string;

  constructor(sessionId: string) {
    this.root = ensureDir(tempWorkspace(sessionId));
  }

  pathFor(name: string): string {
    const safe = name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/\.{2,}/g, "_")
      .replace(/^\.+/, "_");
    return path.join(this.root, safe || "unnamed");
  }

  write(name: string, content: string): string {
    const target = this.pathFor(name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return target;
  }

  read(name: string): string | undefined {
    const target = this.pathFor(name);
    try {
      return fs.readFileSync(target, "utf8");
    } catch {
      return undefined;
    }
  }

  list(): string[] {
    try {
      return fs.readdirSync(this.root);
    } catch {
      return [];
    }
  }

  cleanup(): void {
    try {
      fs.rmSync(this.root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
