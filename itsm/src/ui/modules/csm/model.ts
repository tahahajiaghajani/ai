// Pure helpers of the customer service screens (tested in tests/csm-ui.test.ts): queues, health and usage tones, the
// health trend's sparkline points.
import type { Cond } from "@shared/model/conditions";
import { CUSTOMER_CASE_STATES, HEALTH_STATES } from "@shared/tables/csm";
import type { ChipTone } from "../../components/display";

export type Row = Record<string, any>;

export interface Queue {
  key: string;
  label: string;
  path: string;
  table: string;
  filter: Cond;
  sort: string;
  empty: string;
}

const ACTIVE: Cond = { f: "active", op: "eq", v: true };

export const QUEUES: Queue[] = [
  { key: "mine", table: "customer_case", label: "پرونده‌های مشتری من", path: "customers/my-cases", sort: "priority,sla_due", filter: { and: [ACTIVE, { f: "assigned_to", op: "is_me" }] }, empty: "پروندهٔ بازی به شما سپرده نشده است" },
  { key: "unassigned", table: "customer_case", label: "بی‌کارشناس در گروه‌های من", path: "customers/unassigned", sort: "priority,sla_due,opened_at", filter: { and: [ACTIVE, { f: "assignment_group_id", op: "is_my_group" }, { f: "assigned_to", op: "empty" }] }, empty: "پروندهٔ بی‌کارشناسی در گروه‌های شما نیست" },
  { key: "unhappy", table: "customer_case", label: "مشتریان ناخرسند", path: "customers/unhappy", sort: "priority,updated_at", filter: { and: [ACTIVE, { f: "sentiment", op: "eq", v: "negative" }] }, empty: "پرونده‌ای با لحن ناخرسند باز نیست" },
  { key: "escalated", table: "customer_case", label: "تشدیدشده و شکایت", path: "customers/escalated", sort: "priority,opened_at", filter: { and: [ACTIVE, { or: [{ f: "escalated", op: "eq", v: true }, { f: "complaint", op: "eq", v: true }] }] }, empty: "پروندهٔ تشدیدشده یا شکایتی باز نیست" },
  { key: "accounts", table: "customer_account", label: "حساب‌های من", path: "customers/my-accounts", sort: "health_score", filter: { or: [{ f: "relationship_manager_id", op: "is_me" }, { f: "service_delivery_manager_id", op: "is_me" }, { f: "technical_account_manager_id", op: "is_me" }] }, empty: "حسابی به شما سپرده نشده است" },
];

export const caseState = (v: unknown) => CUSTOMER_CASE_STATES.states.find((s) => s.value === v);
export const healthOption = (v: unknown) => HEALTH_STATES.find((s) => s.value === v) ?? HEALTH_STATES[HEALTH_STATES.length - 1];
export const healthTone = (v: unknown): ChipTone => (v === "green" ? "in" : v === "amber" ? "warning" : v === "red" ? "danger" : "neutral");

/** Used share of an entitlement's units (0–100), null when it has no quota. */
export function usage(e: Row): number | null {
  if (!e.unit_type || e.unit_type === "none") return null;
  const total = Number(e.units_total);
  if (!Number.isFinite(total) || total <= 0) return null;
  const used = Number(e.units_used ?? 0);
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

export const usageTone = (pct: number | null, warn = 80): ChipTone => (pct === null ? "neutral" : pct >= 100 ? "danger" : pct >= warn ? "warning" : "in");

/** Points of a small trend line (SVG viewBox 0 0 width height) from daily scores 0–100; gaps are skipped. */
export function sparkline(scores: readonly (number | null)[], width = 160, height = 36): string {
  const pts = scores.map((s, i) => ({ s, i })).filter((p): p is { s: number; i: number } => typeof p.s === "number" && Number.isFinite(p.s));
  if (!pts.length) return "";
  const step = scores.length > 1 ? width / (scores.length - 1) : 0;
  return pts.map((p) => `${Math.round(p.i * step * 10) / 10},${Math.round((height - (Math.max(0, Math.min(100, p.s)) / 100) * height) * 10) / 10}`).join(" ");
}
