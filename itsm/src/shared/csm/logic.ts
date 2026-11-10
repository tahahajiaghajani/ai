// Pure logic of customer service management, shared by the server and the screens (no I/O):
//   · entitlement resolution at intake (CSM-009): installed-base item → product → account default, valid on the day,
//     active, for the contact when it names one, on the channel; the status the case keeps when nothing covers it
//   · units: what a case consumes, the warning threshold and exhaustion
//   · relationship health (CSM-034): a composite score from satisfaction, agreement attainment, escalations,
//     complaints, the open backlog and recent activity, with its factors and a churn-risk band
//   · rule-based triage and sentiment of a customer's text (CSM-040/041 fallbacks: the AI skills use the same words)
//   · the customer-facing state words
// Imported by the UI: keep it free of server imports.
import Decimal from "decimal.js";
import { CUSTOMER_STATUS } from "../tables/csm";
import { normalizeSearch } from "../model/conditions";

export interface EntitlementLike {
  id: string;
  account_id: string;
  product_id?: string | null;
  ibi_id?: string | null;
  contact_id?: string | null;
  contract_id?: string | null;
  state: string;
  starts_on?: string | null;
  ends_on?: string | null;
  channels?: string[] | null;
  unit_type?: string | null;
  units_total?: string | number | null;
  units_used?: string | number | null;
  block_when_exhausted?: boolean | null;
  support_level?: string | null;
}

export interface IntakeFacts {
  account_id: string | null;
  product_id?: string | null;
  ibi_id?: string | null;
  contact_id?: string | null;
  channel?: string | null;
  /** YYYY-MM-DD in the organisation's zone */
  today: string;
}

export type EntitlementStatus = "covered" | "exhausted" | "expired" | "none" | "channel";

export interface Resolution {
  entitlement: EntitlementLike | null;
  status: EntitlementStatus;
  /** the entitlement blocks a new case (exhausted with «block when exhausted») */
  blocked: boolean;
  reason: string;
}

/** The case channel → the entitlement channel it uses. */
export function entitlementChannel(channel: string | null | undefined): string | null {
  switch (channel) {
    case "portal":
    case "self_service":
    case "web":
      return "portal";
    case "email":
      return "email";
    case "phone":
      return "phone";
    case "chat":
    case "virtual_agent":
      return "chat";
    case "walk_in":
    case "onsite":
      return "onsite";
    default:
      return null;
  }
}

const remaining = (e: EntitlementLike): Decimal | null => {
  if (!e.unit_type || e.unit_type === "none") return null;
  const total = new Decimal(String(e.units_total ?? 0) || 0);
  const used = new Decimal(String(e.units_used ?? 0) || 0);
  return total.minus(used);
};

/** Units left on an entitlement (null when it has no quota). */
export const unitsLeft = (e: EntitlementLike): string | null => remaining(e)?.toString() ?? null;

/**
 * The entitlement a new case gets (CSM-009). Candidates are the account's entitlements; the most specific valid one
 * wins: one for the installed-base item, then for the product, then the account's default (no product, no item).
 * Expired or not yet started ones, suspended or draft ones, and those of another contact never cover. A candidate
 * without the case's channel is kept as the reason when nothing else covers.
 */
export function resolveEntitlement(cands: readonly EntitlementLike[], f: IntakeFacts): Resolution {
  if (!f.account_id) return { entitlement: null, status: "none", blocked: false, reason: "پرونده حساب مشتری ندارد" };
  const mine = cands.filter((e) => e.account_id === f.account_id && (!e.contact_id || !f.contact_id || e.contact_id === f.contact_id));
  const specificity = (e: EntitlementLike): number => {
    if (e.ibi_id) return f.ibi_id && e.ibi_id === f.ibi_id ? 3 : -1;
    if (e.product_id) return f.product_id && e.product_id === f.product_id ? 2 : -1;
    return 1;
  };
  const scoped = mine.map((e) => ({ e, s: specificity(e) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scoped.length) return { entitlement: null, status: "none", blocked: false, reason: "برای این حساب و محصول استحقاقی ثبت نشده است" };
  const inDate = (e: EntitlementLike) => (!e.starts_on || e.starts_on <= f.today) && (!e.ends_on || e.ends_on >= f.today);
  const live = scoped.filter((x) => x.e.state === "active" && inDate(x.e));
  if (!live.length) return { entitlement: scoped[0].e, status: "expired", blocked: false, reason: "استحقاق این مشتری فعال یا معتبر نیست" };
  const channel = entitlementChannel(f.channel);
  const onChannel = live.filter((x) => !channel || !x.e.channels?.length || x.e.channels.includes(channel));
  if (!onChannel.length) return { entitlement: live[0].e, status: "channel", blocked: false, reason: "این مجرا در استحقاق مشتری نیست" };
  // among the most specific level, one with units left beats an exhausted one
  const best = onChannel.filter((x) => x.s === onChannel[0].s);
  const withUnits = best.find((x) => {
    const r = remaining(x.e);
    return r === null || r.gt(0);
  });
  if (withUnits) return { entitlement: withUnits.e, status: "covered", blocked: false, reason: "دارای استحقاق" };
  const e = best[0].e;
  return { entitlement: e, status: "exhausted", blocked: !!e.block_when_exhausted, reason: "سهمیهٔ استحقاق تمام شده است" };
}

/** Units one case consumes: one case, or the hours worked (time_worked in seconds, at least a quarter hour). */
export function unitsFor(unitType: string | null | undefined, timeWorkedSeconds: number | null | undefined): string {
  if (unitType === "cases") return "1";
  if (unitType === "hours") {
    const h = new Decimal(Math.max(0, Number(timeWorkedSeconds ?? 0))).div(3600);
    return Decimal.max(h, new Decimal(0.25)).toDecimalPlaces(2, Decimal.ROUND_UP).toString();
  }
  return "0";
}

/** Has consumption crossed the warning threshold (`percent` of the quota)? */
export function crossedWarning(total: string | number | null | undefined, usedBefore: string | number, usedAfter: string | number, percent: number): boolean {
  const t = new Decimal(String(total ?? 0) || 0);
  if (t.lte(0)) return false;
  const at = t.mul(Math.min(100, Math.max(1, percent))).div(100);
  return new Decimal(String(usedBefore)).lt(at) && new Decimal(String(usedAfter)).gte(at);
}

// ----- relationship health (CSM-034) ---------------------------------------------------------------------------------

export interface HealthFacts {
  /** average satisfaction 1–5 of the period's rated cases (null: none rated) */
  csat: number | null;
  /** share of SLA timers met in the period, 0–100 (null: none) */
  sla_attainment: number | null;
  escalations: number;
  complaints: number;
  open_cases: number;
  /** open cases older than 14 days */
  aged_cases: number;
  /** days since the last case, comment or review (null: never) */
  days_since_contact: number | null;
}

export interface HealthFactor {
  key: string;
  label: string;
  points: number;
}

export interface HealthResult {
  score: number;
  status: "green" | "amber" | "red" | "unknown";
  churn: "low" | "medium" | "high";
  factors: HealthFactor[];
}

/**
 * The relationship's health, 0–100: starts at 100 and loses points for low satisfaction, missed agreements,
 * escalations, complaints, an aging backlog and silence; the factors explain every point lost. Green from `green`,
 * amber from `amber`, red below; churn risk follows the score and the strongest negative signals.
 */
export function healthOf(f: HealthFacts, bands: { green: number; amber: number } = { green: 75, amber: 50 }): HealthResult {
  const factors: HealthFactor[] = [];
  const lose = (key: string, label: string, points: number) => {
    if (points > 0) factors.push({ key, label, points: -Math.round(points) });
  };
  if (f.csat !== null) lose("csat", `رضایت ${f.csat.toFixed(1)} از ۵`, Math.max(0, (4.5 - f.csat) * 12));
  if (f.sla_attainment !== null) lose("sla", `تحقق توافق ${Math.round(f.sla_attainment)}٪`, Math.max(0, (95 - f.sla_attainment) * 0.8));
  lose("escalations", `${f.escalations} تشدید`, Math.min(30, f.escalations * 10));
  lose("complaints", `${f.complaints} شکایت`, Math.min(30, f.complaints * 8));
  lose("aged", `${f.aged_cases} پروندهٔ باز قدیمی`, Math.min(20, f.aged_cases * 4));
  if (f.days_since_contact !== null && f.days_since_contact > 60) lose("silence", `${f.days_since_contact} روز بی‌ارتباط`, Math.min(15, (f.days_since_contact - 60) / 6));
  const known = f.csat !== null || f.sla_attainment !== null || f.open_cases > 0 || f.escalations > 0 || f.complaints > 0;
  const score = Math.max(0, Math.min(100, Math.round(100 + factors.reduce((s, x) => s + x.points, 0))));
  const status = !known ? "unknown" : score >= bands.green ? "green" : score >= bands.amber ? "amber" : "red";
  const heavy = f.escalations >= 2 || f.complaints >= 3 || (f.csat !== null && f.csat < 3);
  const churn = status === "red" || (heavy && score < bands.green) ? "high" : status === "amber" || heavy ? "medium" : "low";
  return { score, status, churn, factors };
}

// ----- triage and sentiment (rule-based fallbacks of CSM-040/041) ----------------------------------------------------

const norm = (s: string) => normalizeSearch(s).toLowerCase();
const has = (text: string, list: readonly string[]) => list.filter((w) => text.includes(norm(w)));

const COMPLAINT = ["شکایت", "اعتراض", "ناراضی", "نارضایتی", "بی‌احترامی", "پیگیری قانونی", "سازمان حمایت"];
const PROBLEM = ["خطا", "کار نمی‌کند", "کار نمیکند", "قطع", "خراب", "مشکل", "از کار افتاد", "باز نمی‌شود", "error", "down", "crash"];
const REQUEST = ["درخواست", "لطفا", "لطفاً", "نیاز داریم", "می‌خواهیم", "فعال کنید", "اضافه کنید", "تمدید"];
const SUGGESTION = ["پیشنهاد", "بهتر است", "ای کاش", "ایده"];
const QUESTION = ["چطور", "چگونه", "آیا", "سؤال", "سوال", "راهنمایی", "؟", "?"];
const URGENT = ["فوری", "اضطراری", "بحرانی", "همهٔ کاربران", "همه کاربران", "کل سامانه", "قطع کامل", "urgent", "critical"];
const NEGATIVE = ["ناراضی", "بد", "افتضاح", "بی‌کیفیت", "عصبانی", "دیر", "هنوز", "چندمین بار", "دوباره", "بی‌پاسخ", "شکایت", "ضرر", "خسارت", "ناامید"];
const POSITIVE = ["ممنون", "متشکر", "سپاس", "عالی", "خوب", "راضی", "سریع", "عالیه", "تشکر"];

export interface Triage {
  case_type: "question" | "problem" | "request" | "suggestion" | "complaint";
  priority: "2" | "3" | "4";
  complaint: boolean;
  reasons: string[];
}

/** The case type and priority words suggest (the fallback of the triage skill). */
export function triageText(text: string): Triage {
  const t = norm(text);
  const complaint = has(t, COMPLAINT);
  const problem = has(t, PROBLEM);
  const request = has(t, REQUEST);
  const suggestion = has(t, SUGGESTION);
  const question = has(t, QUESTION);
  const urgent = has(t, URGENT);
  const reasons: string[] = [];
  let case_type: Triage["case_type"] = "question";
  if (complaint.length) {
    case_type = "complaint";
    reasons.push(`واژه‌های شکایت: ${complaint.join("، ")}`);
  } else if (problem.length) {
    case_type = "problem";
    reasons.push(`نشانهٔ اشکال: ${problem.join("، ")}`);
  } else if (suggestion.length) {
    case_type = "suggestion";
    reasons.push(`پیشنهاد: ${suggestion.join("، ")}`);
  } else if (request.length && !question.length) {
    case_type = "request";
    reasons.push(`درخواست: ${request.join("، ")}`);
  } else if (question.length) reasons.push("پرسش");
  const priority: Triage["priority"] = urgent.length ? "2" : case_type === "problem" || case_type === "complaint" ? "3" : "4";
  if (urgent.length) reasons.push(`فوریت: ${urgent.join("، ")}`);
  return { case_type, priority, complaint: case_type === "complaint", reasons };
}

/** Text-based sentiment of a customer's words (never workplace emotion recognition): −100 … 100. */
export function sentimentOf(text: string): { sentiment: "positive" | "neutral" | "negative"; score: number; words: string[] } {
  const t = norm(text);
  const neg = has(t, NEGATIVE);
  const pos = has(t, POSITIVE);
  const exclaim = (text.match(/!|！/g) ?? []).length;
  const raw = pos.length * 25 - neg.length * 25 - Math.min(3, exclaim) * 5;
  const score = Math.max(-100, Math.min(100, raw));
  return { sentiment: score <= -20 ? "negative" : score >= 20 ? "positive" : "neutral", score, words: [...neg, ...pos] };
}

/** What the customer sees as the state of their case. */
export const customerStatusOf = (state: unknown): string => CUSTOMER_STATUS[String(state ?? "")] ?? "در حال بررسی";
