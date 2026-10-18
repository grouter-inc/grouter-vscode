import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  readFileTool,
  listDirTool,
  searchTextTool,
  applyPatchTool,
  writeFileTool,
} from "../../src/tools/builtin/fileTools";
import type { ToolContext } from "../../src/tools/spec";

let workspace: string;
let ctx: ToolContext;

beforeAll(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "grouter-tools-"));
  await fs.mkdir(path.join(workspace, "src"), { recursive: true });
  await fs.writeFile(
    path.join(workspace, "src", "app.ts"),
    ["export function greet(name: string) {", "  return `Hello ${name}`;", "}", ""].join("\n"),
  );
  await fs.writeFile(path.join(workspace, "README.md"), "# Test Project\n\nHello world.\n");
  ctx = {
    workspaceRoot: workspace,
    token: { isCancellationRequested: false } as never,
    approve: async () => "allow",
    log: () => undefined,
  };
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("file tools", () => {
  it("read_file returns numbered lines with a range", async () => {
    const result = await readFileTool.execute({ path: "src/app.ts", startLine: 1, endLine: 2 }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("1: export function greet");
    expect(result.content).toContain("2:   return");
  });

  it("list_dir shows directories with a slash", async () => {
    const result = await listDirTool.execute({}, ctx);
    expect(result.content).toContain("src/");
    expect(result.content).toContain("README.md");
  });

  it("search_text finds matches with file:line", async () => {
    const result = await searchTextTool.execute({ query: "Hello" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("README.md:3");
    expect(result.content).toContain("app.ts:2");
  });

  it("search_text respects the extension filter", async () => {
    const result = await searchTextTool.execute({ query: "Hello", glob: ".md" }, ctx);
    expect(result.content).toContain("README.md");
    expect(result.content).not.toContain("app.ts");
  });

  it("apply_patch replaces unique text", async () => {
    const result = await applyPatchTool.execute(
      { path: "README.md", oldText: "Hello world.", newText: "Hello gRouter." },
      ctx,
    );
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(workspace, "README.md"), "utf8");
    expect(content).toContain("Hello gRouter.");
  });

  it("apply_patch rejects non-matching oldText", async () => {
    const result = await applyPatchTool.execute(
      { path: "README.md", oldText: "does not exist anywhere", newText: "x" },
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("not found");
  });

  it("apply_patch rejects ambiguous oldText", async () => {
    await fs.writeFile(path.join(workspace, "dup.txt"), "same\nsame\n");
    const result = await applyPatchTool.execute({ path: "dup.txt", oldText: "same", newText: "x" }, ctx);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("multiple times");
  });

  it("write_file creates nested directories", async () => {
    const result = await writeFileTool.execute({ path: "deep/nested/new.txt", content: "hi" }, ctx);
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, "deep/nested/new.txt"), "utf8")).toBe("hi");
  });

  it("rejects path escape attempts", async () => {
    const result = await readFileTool.execute({ path: "../../../etc/passwd" }, ctx);
    expect(result.ok).toBe(false);
  });
});
