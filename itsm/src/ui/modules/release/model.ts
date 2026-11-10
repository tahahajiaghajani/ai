// Pure helpers of the release screens (tested in tests/release-ui.test.ts): queues, tones, chips, the roadmap's
// timeline items and the readiness board's grouping. Light: imported by the module's index.
import type { Cond } from "@shared/model/conditions";
import { CHECK_STATUSES, GO_DECISIONS, RELEASE_STATES, RELEASE_TYPES, RISK_BANDS } from "@shared/tables/release";
import { releaseTone } from "@shared/release/logic";
import type { ChipTone } from "../../components/display";

export type Row = Record<string, any>;

export interface Queue {
  key: string;
  label: string;
  path: string;
  filter: Cond;
  sort?: string;
  empty: string;
}

const OPEN: Cond = { f: "state", op: "nin", v: ["closed", "canceled"] };

export const QUEUES: Queue[] = [
  {
    key: "mine", label: "انتشارهای من", path: "releases/mine", sort: "planned_end",
    filter: { and: [OPEN, { or: [{ f: "release_manager_id", op: "is_me" }, { f: "assigned_to", op: "is_me" }] }] },
    empty: "انتشار بازی به شما سپرده نشده است",
  },
  { key: "decision", label: "در انتظار تصمیم اجرا", path: "releases/awaiting-decision", sort: "planned_end", filter: { f: "state", op: "eq", v: "readiness" }, empty: "انتشاری منتظر تصمیم اجرا نیست" },
  { key: "deploying", label: "در حال استقرار", path: "releases/deploying", sort: "planned_end", filter: { f: "state", op: "eq", v: "deploying" }, empty: "انتشاری در حال استقرار نیست" },
  { key: "els", label: "پشتیبانی آغازین", path: "releases/early-life", sort: "els_end_at", filter: { f: "state", op: "eq", v: "els" }, empty: "انتشاری در دورهٔ پشتیبانی آغازین نیست" },
  { key: "risky", label: "انتشارهای پرریسک", path: "releases/high-risk", sort: "-risk_score", filter: { and: [OPEN, { f: "risk_band", op: "in", v: ["high", "very_high"] }] }, empty: "انتشار پرریسکی باز نیست" },
  { key: "emergency", label: "انتشارهای اضطراری", path: "releases/emergency", sort: "-opened_at", filter: { and: [OPEN, { f: "type", op: "eq", v: "emergency" }] }, empty: "انتشار اضطراری بازی نیست" },
];

export const DEPLOYMENT_QUEUES: Queue[] = [
  { key: "approval", label: "استقرارهای در انتظار تأیید", path: "deployments/awaiting-approval", sort: "planned_start", filter: { f: "state", op: "eq", v: "pending_approval" }, empty: "استقراری در انتظار تأیید نیست" },
  { key: "failed", label: "استقرارهای ناموفق", path: "deployments/failed", sort: "-actual_end", filter: { f: "state", op: "in", v: ["failed", "rolled_back"] }, empty: "استقرار ناموفقی ثبت نشده است" },
];

/** A release that needs attention on lists and the roadmap. */
export const rowTone = (r: Row): "danger" | "warning" | null => releaseTone(r);

const colorTone = (color?: string): ChipTone => (color === "red" || color === "magenta" ? "danger" : color === "gold" || color === "orange" ? "warning" : color === "green" || color === "teal" ? "in" : color === "blue" || color === "indigo" || color === "purple" ? "accent" : "neutral");
const optionOf = (list: { value: string; label: string; color?: string }[], v: unknown) => list.find((o) => o.value === String(v ?? ""));

export const typeLabel = (v: unknown) => optionOf(RELEASE_TYPES, v)?.label ?? String(v ?? "");
export const typeTone = (v: unknown): ChipTone => colorTone(optionOf(RELEASE_TYPES, v)?.color);
export const stateLabel = (v: unknown) => RELEASE_STATES.states.find((s) => s.value === v)?.label ?? String(v ?? "");
export const riskLabel = (v: unknown) => optionOf(RISK_BANDS, v)?.label ?? "—";
export const riskTone = (v: unknown): ChipTone => colorTone(optionOf(RISK_BANDS, v)?.color);
export const decisionLabel = (v: unknown) => optionOf(GO_DECISIONS, v)?.label ?? "تصمیم گرفته نشده";
export const decisionTone = (v: unknown): ChipTone => colorTone(optionOf(GO_DECISIONS, v)?.color);
export const checkLabel = (v: unknown) => optionOf(CHECK_STATUSES, v)?.label ?? String(v ?? "");
export const checkTone = (v: unknown): ChipTone => (v === "pass" ? "in" : v === "fail" ? "danger" : v === "waived" ? "warning" : "neutral");

/** The readiness bar's tone. */
export function readinessTone(pct: number, ready: boolean): ChipTone {
  if (ready) return "in";
  return pct >= 70 ? "warning" : "danger";
}

/** Roadmap bars: releases with a delivery date (a release without a start spans its last day). */
export function roadmapItems(releases: Row[]): { id: string; start: string; end: string; label: string; number: string | null; color: string; category: string; tone: "danger" | "warning" | null; title: string }[] {
  const DAY = 86_400_000;
  return releases
    .filter((r) => r.planned_end)
    .map((r) => {
      const end = Date.parse(String(r.planned_end));
      const start = r.planned_start ? Date.parse(String(r.planned_start)) : end - DAY;
      const st = RELEASE_STATES.states.find((s) => s.value === r.state);
      return {
        id: String(r.id),
        start: new Date(Math.min(start, end - 60 * 60_000)).toISOString(),
        end: new Date(end).toISOString(),
        label: `${r.version_name ? `${r.version_name} · ` : ""}${r.short_description ?? ""}`,
        number: r.number ?? null,
        color: st?.color ?? "blue",
        category: st?.category ?? "active",
        tone: releaseTone(r),
        title: [r.number, r.short_description, `${typeLabel(r.type)} — ${stateLabel(r.state)}`, r.readiness_pct !== null && r.readiness_pct !== undefined ? `آمادگی ${Number(r.readiness_pct).toLocaleString("fa-IR")}٪` : ""].filter(Boolean).join("\n"),
      };
    });
}

/** Readiness board columns: building, testing, waiting for the decision. */
export function boardColumns(releases: Row[]): { key: string; label: string; items: Row[] }[] {
  const cols = [
    { key: "build", label: "ساخت" },
    { key: "test", label: "آزمون" },
    { key: "readiness", label: "آمادگی و تصمیم" },
  ];
  return cols.map((c) => ({ ...c, items: releases.filter((r) => r.state === c.key).sort((a, b) => (Date.parse(a.planned_end ?? "") || Infinity) - (Date.parse(b.planned_end ?? "") || Infinity)) }));
}

/** A check a person may act on: verdict on a manual check, waiver of a blocking one that does not pass. */
export function checkActions(c: Row, manages: boolean): { verdict: boolean; waive: boolean } {
  const passing = ["pass", "waived", "na"].includes(String(c.status));
  return { verdict: c.rule === "manual" && c.status !== "waived", waive: manages && c.blocking !== false && !passing };
}
