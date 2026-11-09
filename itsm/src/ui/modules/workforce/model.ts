// Pure helpers of the workforce screens: presence labels and tones, utilisation tones, shift times, metric rows of the
// scorecards. No React here (tests/workforce-ui.test.ts).
import { PRESENCE_STATES } from "@shared/tables/workforce";
import { UTIL_BANDS, type AgentMetrics, type UtilBand } from "@shared/workforce/logic";
import { toFa } from "@shared/jalali";
import type { ChipTone } from "../../components/display";

export const presenceLabel = (v: unknown) => PRESENCE_STATES.find((o) => o.value === v)?.label ?? "خارج از سامانه";
export const PRESENCE_TONE: Record<string, ChipTone> = { available: "in", busy: "warning", meeting: "accent", break: "neutral", away: "neutral", offline: "neutral" };
export const UTIL_TONE: Record<UtilBand, ChipTone> = { idle: "neutral", optimal: "in", high: "warning", overloaded: "danger" };
export const utilLabel = (b: UtilBand) => UTIL_BANDS[b].label;

/** «۰۸:۰۰ تا ۱۶:۰۰» in the organisation's time zone. */
export function shiftText(start: string, end: string, tz: string): string {
  const f = new Intl.DateTimeFormat("fa-IR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${f.format(new Date(start))} تا ${f.format(new Date(end))}`;
}

export const minutesText = (m: number | null | undefined) => {
  if (m === null || m === undefined) return "—";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${toFa(h)} ساعت${mm ? ` و ${toFa(mm)} دقیقه` : ""}` : `${toFa(mm)} دقیقه`;
};

export interface MetricRow {
  key: keyof AgentMetrics;
  label: string;
  unit: "count" | "pct" | "hours";
  /** higher is better (for the tone of a value against the team) */
  better: "up" | "down";
}

export const METRIC_ROWS: MetricRow[] = [
  { key: "resolved", label: "کارهای حل‌شده", unit: "count", better: "up" },
  { key: "open", label: "کارهای باز", unit: "count", better: "down" },
  { key: "median_resolve_hours", label: "میانهٔ زمان حل", unit: "hours", better: "down" },
  { key: "within_sla_pct", label: "حل در موعد توافق", unit: "pct", better: "up" },
  { key: "first_contact_pct", label: "حل بی‌ارجاع", unit: "pct", better: "up" },
  { key: "reassigned_pct", label: "ارجاع دوباره", unit: "pct", better: "down" },
  { key: "reopened_pct", label: "بازگشایی", unit: "pct", better: "down" },
  { key: "csat_pct", label: "رضایت درخواست‌کنندگان", unit: "pct", better: "up" },
  { key: "knowledge", label: "مقالهٔ دانش", unit: "count", better: "up" },
  { key: "points", label: "امتیاز این ماه", unit: "count", better: "up" },
];

export function metricText(m: AgentMetrics | null | undefined, row: MetricRow): string {
  const v = m ? (m[row.key] as number | null) : null;
  if (v === null || v === undefined) return "—";
  if (row.unit === "pct") return `${toFa(v)}٪`;
  if (row.unit === "hours") return `${toFa(v)} ساعت`;
  return toFa(v);
}

/** The colour of a heatmap cell (utilisation band; holidays and empty days are quiet). */
export function heatTone(c: { band: UtilBand; holiday: boolean; staff: number; forecast: number }): string {
  if (c.holiday) return "holiday";
  if (!c.staff && c.forecast <= 0.5) return "none";
  return c.band;
}
