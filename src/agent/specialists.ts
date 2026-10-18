import type { ToolRegistry } from "../tools/spec";

export interface Specialist {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
  readOnly: boolean;
}

export const SPECIALISTS: Specialist[] = [
  {
    id: "explorer",
    name: "Codebase Explorer",
    description:
      "Maps an unfamiliar codebase or area: structure, entry points, key modules, data flow. Use BEFORE making changes when you need orientation. Read-only.",
    systemPrompt: [
      "You are a codebase explorer sub-agent. Your ONLY job is to map and report — never modify anything.",
      "Investigate with read_file, list_dir, search_text, get_workspace_tree, get_diagnostics.",
      "Return a structured report: (1) relevant files with paths, (2) how they connect, (3) entry points,",
      "(4) the 2-3 files that matter most for the caller's goal, (5) open questions.",
      "Be specific: file paths and line numbers, not generalities. Keep the report under 500 words.",
    ].join("\n"),
    tools: ["read_file", "list_dir", "search_text", "get_workspace_tree", "get_diagnostics", "get_open_editors"],
    maxIterations: 10,
    readOnly: true,
  },
  {
    id: "researcher",
    name: "Dependency Researcher",
    description:
      "Investigates how a library/dependency actually behaves by reading its installed sources and the project's usage. Read-only.",
    systemPrompt: [
      "You are a dependency researcher sub-agent. Your ONLY job is to answer a specific question about a library",
      "or API by reading evidence — never modify anything.",
      "Use search_text and read_file against node_modules/ (or equivalent vendor dirs) and the project's own usage.",
      "Return: the answer, exact evidence (file paths + the relevant code shape), and any version caveats.",
      "If the library is not installed, say so and answer from the project's usage patterns instead.",
    ].join("\n"),
    tools: ["read_file", "list_dir", "search_text", "get_workspace_tree"],
    maxIterations: 10,
    readOnly: true,
  },
  {
    id: "reviewer",
    name: "Change Reviewer",
    description:
      "Independently reviews recent changes (git diff) for correctness, edge cases, security, and consistency. Read-only, fresh eyes — no knowledge of the caller's reasoning.",
    systemPrompt: [
      "You are an independent code reviewer sub-agent. You have NOT seen the caller's reasoning — form your own view.",
      "Start with git_diff (and git_status) to see what changed. Read surrounding code as needed.",
      "Check: correctness, edge cases, security (injection/secrets), consistency with existing patterns, missing tests.",
      "Report findings as: severity (blocker/major/minor) + file:line + concrete fix suggestion.",
      "If the diff is clean, say so explicitly. Never modify anything.",
    ].join("\n"),
    tools: ["git_diff", "git_status", "read_file", "search_text", "get_diagnostics"],
    maxIterations: 8,
    readOnly: true,
  },
  {
    id: "tester",
    name: "Test Verifier",
    description:
      "Runs the test suite and reports raw results with failure analysis. Use to verify work independently.",
    systemPrompt: [
      "You are a test verifier sub-agent. Your job is to run verification and report facts — not to fix code.",
      "Run the project's tests with run_tests and report: exact command(s) run, pass/fail counts, full failure",
      "messages, and whether the build succeeds. If a failure looks pre-existing (unrelated to recent changes),",
      "say so with evidence. Never modify files.",
    ].join("\n"),
    tools: ["run_tests", "read_file", "get_diagnostics", "git_status"],
    maxIterations: 8,
    readOnly: true,
  },
];

export function specialistToolSpecs(registry: ToolRegistry, specialists: Specialist[]) {
  return specialists.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tools: s.tools.filter((t) => registry.get(t) !== undefined),
    readOnly: s.readOnly,
  }));
}

export function getSpecialist(id: string): Specialist | undefined {
  return SPECIALISTS.find((s) => s.id === id);
}

export function subsetRegistry(registry: ToolRegistry, toolIds: string[]): ToolRegistry {
  const subset = new (registry.constructor as new () => ToolRegistry)();
  for (const id of toolIds) {
    const spec = registry.get(id);
    if (spec) subset.register(spec);
  }
  return subset;
}
