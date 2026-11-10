// Pure helpers of the service level management screens: labels and tones of statuses, the queues of the space and
// small formatters. No React here (tests/slm-ui.test.ts).
import type { Cond } from "@shared/model/conditions";
import type { ChipTone } from "../../components/display";
import { AGREEMENT_IN_FORCE, AGREEMENT_KINDS, METRIC_CATEGORIES, TARGET_KINDS } from "@shared/tables/slm";
import { toFa } from "@shared/jalali";

export type Row = Record<string, any>;

export const STATUS_TONE: Record<string, ChipTone> = { met: "in", at_risk: "warning", missed: "danger", no_data: "neutral" };
export const STATUS_LABEL: Record<string, string> = { met: "برآورده", at_risk: "در خطر", missed: "برآورده نشد", no_data: "بی‌داده" };
export const URGENCY_TONE: Record<string, ChipTone> = { critical: "danger", high: "warning", medium: "accent", low: "neutral" };
export const URGENCY_LABEL: Record<string, string> = { critical: "بحرانی", high: "زیاد", medium: "متوسط", low: "کم" };

export const kindLabel = (v: unknown) => AGREEMENT_KINDS.find((o) => o.value === v)?.label ?? String(v ?? "");
export const kindShort = (v: unknown) => ({ sla: "SLA", ola: "OLA", uc: "UC", collaboration: "SIAM", flsa: "FLSA" } as Record<string, string>)[String(v)] ?? String(v ?? "");
export const targetKindLabel = (v: unknown) => TARGET_KINDS.find((o) => o.value === v)?.label ?? String(v ?? "");
export const categoryLabel = (v: unknown) => METRIC_CATEGORIES.find((o) => o.value === v)?.label ?? String(v ?? "");

/** A value of a target with its unit: percentages for timers, availability and satisfaction, a score for experience. */
export function valueText(kind: string, v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const n = Math.round(v * 10) / 10;
  return kind === "experience" ? toFa(n) : `${toFa(n)}٪`;
}

/** The remaining time of a timer in words («۲ ساعت و ۱۰ دقیقه مانده»، «۳۵ دقیقه گذشته»). */
export function remainingText(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const past = ms < 0;
  const m = Math.round(Math.abs(ms) / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const parts = d ? [`${toFa(d)} روز`, h ? `${toFa(h)} ساعت` : ""] : h ? [`${toFa(h)} ساعت`, mm ? `${toFa(mm)} دقیقه` : ""] : [`${toFa(mm)} دقیقه`];
  return `${parts.filter(Boolean).join(" و ")} ${past ? "گذشته" : "مانده"}`;
}

export interface Queue {
  key: string;
  label: string;
  path: string;
  table: string;
  filter: Cond;
  sort: string;
  empty: string;
}

export const QUEUES: Queue[] = [
  { key: "in_force", label: "توافق‌های در جریان", path: "slm/agreements", table: "service_agreement", filter: { f: "state", op: "in", v: AGREEMENT_IN_FORCE }, sort: "name", empty: "هنوز توافقی اجرا نشده است" },
  { key: "risk", label: "توافق‌های در خطر", path: "slm/agreements/at-risk", table: "service_agreement", filter: { and: [{ f: "state", op: "in", v: AGREEMENT_IN_FORCE }, { f: "compliance_status", op: "in", v: ["at_risk", "missed"] }] }, sort: "compliance_pct", empty: "توافقی در خطر نیست" },
  { key: "pipeline", label: "توافق‌های در دست تدوین", path: "slm/agreements/pipeline", table: "service_agreement", filter: { f: "state", op: "in", v: ["requirements", "viability", "draft", "negotiation", "awaiting_approval", "enablement"] }, sort: "-updated_at", empty: "توافقی در دست تدوین نیست" },
  { key: "reviews", label: "بازبینی‌های پیش رو", path: "slm/reviews/open", table: "slm_review", filter: { f: "state", op: "in", v: ["scheduled", "prepared", "held", "actions_open"] }, sort: "scheduled_at", empty: "بازبینی بازی نیست" },
];

/** Bar width (0–100) of a value against a 0–100 scale. */
export const barPct = (v: number | null | undefined) => (v === null || v === undefined ? 0 : Math.max(0, Math.min(100, v)));
