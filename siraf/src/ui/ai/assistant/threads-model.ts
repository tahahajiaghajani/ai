// How the conversation switcher groups the list. Pure (unit-tested).
import type { AiThreadSummary } from "@shared/ai/types";

const DAY = 86_400_000;

/** Pinned first, then by day: today, yesterday, the past week, older; newest first in each group. */
export function groupThreads(list: AiThreadSummary[], now = new Date()): { label: string; items: AiThreadSummary[] }[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const groups: { label: string; items: AiThreadSummary[] }[] = [
    { label: "سنجاق‌شده", items: [] },
    { label: "امروز", items: [] },
    { label: "دیروز", items: [] },
    { label: "هفتهٔ گذشته", items: [] },
    { label: "قدیمی‌تر", items: [] },
  ];
  const sorted = [...list].sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  for (const t of sorted) {
    const at = new Date(t.updated_at).getTime();
    const g = t.pinned ? 0 : at >= start ? 1 : at >= start - DAY ? 2 : at >= start - 7 * DAY ? 3 : 4;
    groups[g].items.push(t);
  }
  return groups.filter((g) => g.items.length);
}
