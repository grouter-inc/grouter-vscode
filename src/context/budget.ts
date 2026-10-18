export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BudgetItem {
  label: string;
  text: string;
  priority: number;
}

export interface BudgetResult {
  included: BudgetItem[];
  omitted: BudgetItem[];
  usedTokens: number;
}

export function fitToBudget(items: BudgetItem[], maxTokens: number): BudgetResult {
  const sorted = [...items].sort((a, b) => b.priority - a.priority);
  const included: BudgetItem[] = [];
  const omitted: BudgetItem[] = [];
  let used = 0;

  for (const item of sorted) {
    const cost = estimateTokens(item.text) + estimateTokens(item.label) + 8;
    if (used + cost <= maxTokens) {
      included.push(item);
      used += cost;
    } else {
      omitted.push(item);
    }
  }

  return { included, omitted, usedTokens: used };
}

export function contextBudgetFor(contextWindow: number): number {
  const cap = 60_000;
  const share = Math.floor(contextWindow * 0.4);
  return Math.max(4_000, Math.min(cap, share));
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const kept = text.slice(0, maxChars);
  const droppedLines = text.slice(maxChars).split("\n").length;
  return `${kept}\n… [truncated ${droppedLines} more lines]`;
}
