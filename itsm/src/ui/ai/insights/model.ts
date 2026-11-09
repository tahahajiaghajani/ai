// Pure logic of the insights screens (tests: tests/ai-ml-ui.test.ts): labels and formats of a card's numbers and the
// order cards are shown in.
import { faDigits } from "@shared/format";
import type { InsightView } from "@shared/ai/insights";

export const NUMBER_LABELS: Record<string, string> = {
  current: "این دوره",
  previous: "دورهٔ پیش",
  change_pct: "تغییر",
  baseline: "معمول",
  z: "انحراف از معمول",
  open: "باز",
  aged: "کهنه‌تر از یک هفته",
  aged_pct: "سهم کهنه‌ها",
  median_hours: "میانه (ساعت)",
  previous_hours: "دورهٔ پیش (ساعت)",
  rate_pct: "نرخ بازگشایی",
  before_pct: "نرخ پیشین",
  compliance_pct: "پایبندی",
  previous_pct: "دورهٔ پیش",
  ended: "توافق‌های پایان‌یافته",
  breached: "نقض‌شده",
  success_pct: "موفقیت",
  implemented: "اجراشده",
  failed: "ناموفق",
  closed: "انجام‌شده",
  last_hour: "ساعت گذشته",
};

const PERCENT = new Set(["change_pct", "aged_pct", "rate_pct", "before_pct", "compliance_pct", "previous_pct", "success_pct"]);

/** «۱۲٫۵٪»، «+۳۰٪»، «۴۲» — a card's number in Persian. */
export function numberText(key: string, v: number | string | null): string {
  if (v === null) return "—";
  if (typeof v === "string") return faDigits(v);
  const r = Math.round(v * 10) / 10;
  if (key === "change_pct") return `${r > 0 ? "+" : r < 0 ? "−" : ""}${faDigits(Math.abs(r))}٪`;
  return PERCENT.has(key) ? `${faDigits(r)}٪` : faDigits(r);
}

const RANK: Record<InsightView["severity"], number> = { critical: 3, warning: 2, notice: 1, info: 0 };

/** Anomalies and severe cards first, then by score; the latest period first within a kind. */
export function orderInsights(xs: readonly InsightView[]): InsightView[] {
  return [...xs].sort((a, b) => Number(b.anomaly) - Number(a.anomaly) || RANK[b.severity] - RANK[a.severity] || b.score - a.score || (a.created_at < b.created_at ? 1 : -1));
}
