import * as fs from "node:fs/promises";
import * as path from "node:path";

export type StepStatus = "pending" | "in-progress" | "done" | "skipped" | "failed";
export type PlanStatus = "draft" | "approved" | "in-progress" | "done" | "aborted";

export interface PlanStep {
  index: number;
  title: string;
  status: StepStatus;
  objective: string;
  files: string[];
  verify?: string;
}

export interface PlanArtifact {
  slug: string;
  title: string;
  goal: string;
  status: PlanStatus;
  created: string;
  model: string;
  steps: PlanStep[];
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || "plan";
}

export function serializePlan(plan: PlanArtifact): string {
  const lines: string[] = [];
  lines.push(`# Plan: ${plan.title}`);
  lines.push("");
  lines.push(`- **Status**: ${plan.status}`);
  lines.push(`- **Created**: ${plan.created}`);
  lines.push(`- **Model**: ${plan.model}`);
  lines.push("");
  lines.push("## Goal");
  lines.push("");
  lines.push(plan.goal);
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  for (const step of plan.steps) {
    lines.push(`### ${step.index}. ${step.title} — [${step.status}]`);
    lines.push("");
    lines.push(step.objective);
    lines.push("");
    if (step.files.length > 0) {
      lines.push(`- **Files**: ${step.files.map((f) => `\`${f}\``).join(", ")}`);
    }
    if (step.verify) {
      lines.push(`- **Verify**: \`${step.verify}\``);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function parsePlan(slug: string, markdown: string): PlanArtifact {
  const lines = markdown.split("\n");

  const titleLine = lines.find((l) => l.startsWith("# Plan: "));
  const title = titleLine ? titleLine.slice("# Plan: ".length).trim() : slug;

  const statusMatch = markdown.match(/- \*\*Status\*\*:\s*(\w[\w-]*)/);
  const createdMatch = markdown.match(/- \*\*Created\*\*:\s*(\S+)/);
  const modelMatch = markdown.match(/- \*\*Model\*\*:\s*(\S+)/);

  const goalMatch = markdown.match(/## Goal\n+([\s\S]*?)\n+## Steps/);
  const goal = goalMatch ? goalMatch[1].trim() : "";

  const steps: PlanStep[] = [];
  const stepRe = /^### (\d+)\.\s+(.+?)\s+—\s+\[(\w[\w-]*)\]\s*$/gm;
  const matches = [...markdown.matchAll(stepRe)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const index = Number(m[1]);
    const stepTitle = m[2].trim();
    const status = normalizeStepStatus(m[3]);
    const blockStart = (m.index ?? 0) + m[0].length;
    const blockEnd = i + 1 < matches.length ? (matches[i + 1].index ?? markdown.length) : markdown.length;
    const block = markdown.slice(blockStart, blockEnd);

    const filesMatch = block.match(/- \*\*Files\*\*:\s*(.+)/);
    const files = filesMatch
      ? [...filesMatch[1].matchAll(/`([^`]+)`/g)].map((f) => f[1])
      : [];
    const verifyMatch = block.match(/- \*\*Verify\*\*:\s*`([^`]+)`/);
    const objective = block
      .split("\n")
      .filter((l) => !l.startsWith("- **") && l.trim() !== "")
      .join("\n")
      .trim();

    steps.push({
      index,
      title: stepTitle,
      status,
      objective,
      files,
      verify: verifyMatch ? verifyMatch[1] : undefined,
    });
  }

  return {
    slug,
    title,
    goal,
    status: normalizePlanStatus(statusMatch?.[1]),
    created: createdMatch?.[1] ?? new Date().toISOString(),
    model: modelMatch?.[1] ?? "",
    steps,
  };
}

function normalizeStepStatus(value: string | undefined): StepStatus {
  switch (value) {
    case "in-progress":
    case "done":
    case "skipped":
    case "failed":
      return value;
    default:
      return "pending";
  }
}

function normalizePlanStatus(value: string | undefined): PlanStatus {
  switch (value) {
    case "approved":
    case "in-progress":
    case "done":
    case "aborted":
      return value;
    default:
      return "draft";
  }
}

export function plansDir(workspaceRoot: string, configured: string): string {
  return path.resolve(workspaceRoot, configured);
}

export async function savePlan(workspaceRoot: string, dir: string, plan: PlanArtifact): Promise<string> {
  const target = path.join(plansDir(workspaceRoot, dir), `${plan.slug}.md`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, serializePlan(plan), "utf8");
  return target;
}

export async function loadPlan(workspaceRoot: string, dir: string, slug: string): Promise<PlanArtifact> {
  const target = path.join(plansDir(workspaceRoot, dir), `${slug}.md`);
  const content = await fs.readFile(target, "utf8");
  return parsePlan(slug, content);
}

export async function listPlans(workspaceRoot: string, dir: string): Promise<PlanArtifact[]> {
  const base = plansDir(workspaceRoot, dir);
  let entries: string[];
  try {
    entries = await fs.readdir(base);
  } catch {
    return [];
  }
  const plans: PlanArtifact[] = [];
  for (const entry of entries.filter((e) => e.endsWith(".md"))) {
    try {
      const content = await fs.readFile(path.join(base, entry), "utf8");
      plans.push(parsePlan(entry.replace(/\.md$/, ""), content));
    } catch {
      continue;
    }
  }
  return plans.sort((a, b) => b.created.localeCompare(a.created));
}

export function updateStepStatus(plan: PlanArtifact, stepIndex: number, status: StepStatus): PlanArtifact {
  return {
    ...plan,
    steps: plan.steps.map((s) => (s.index === stepIndex ? { ...s, status } : s)),
  };
}

export function nextPendingStep(plan: PlanArtifact): PlanStep | undefined {
  return plan.steps.find((s) => s.status === "pending" || s.status === "in-progress");
}

export function planProgress(plan: PlanArtifact): { done: number; total: number } {
  const done = plan.steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  return { done, total: plan.steps.length };
}
