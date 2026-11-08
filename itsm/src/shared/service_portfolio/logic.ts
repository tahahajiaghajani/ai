// Pure logic of the service portfolio, shared by the server and the screens (tests/service_portfolio-logic.test.ts):
// the live status of a service from its signals (open incidents, failing CIs, maintenance, a manual override), the
// daily status bars and availability of the status page from the status history, the performance score of a service,
// a proposal's score and a design package's readiness.
// Imported by the UI: keep it free of server imports.
import { SERVICE_STATUSES } from "../tables/service_portfolio";

export type ServiceStatus = "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance";

/** How bad a status is (higher = worse); maintenance sits between degraded and outages on the bars. */
export const STATUS_RANK: Record<ServiceStatus, number> = { operational: 0, maintenance: 1, degraded: 2, partial_outage: 3, major_outage: 4 };

export const statusLabel = (s: string | null | undefined) => SERVICE_STATUSES.find((o) => o.value === s)?.label ?? "نامعلوم";
export const statusColor = (s: string | null | undefined) => SERVICE_STATUSES.find((o) => o.value === s)?.color ?? "gray";

export interface StatusSignals {
  /** open incidents on the service: priority and whether it is a declared major incident */
  incidents: { priority: string | null; major: boolean }[];
  /** worst severity (0–1) a failing CI reaches the service with, and whether it is planned maintenance */
  ci?: { severity: number; maintenance: boolean } | null;
  override?: string | null;
}

/** The live status: a manual override wins; then major incidents, priority 1 and 2 incidents, failing CIs, maintenance. */
export function statusFromSignals(s: StatusSignals): { status: ServiceStatus; reason: string } {
  if (s.override && s.override !== "auto" && s.override in STATUS_RANK) return { status: s.override as ServiceStatus, reason: "تعیین‌شده به دست مالک" };
  const major = s.incidents.filter((i) => i.major).length;
  if (major) return { status: "major_outage", reason: `${major} رخداد عمدهٔ باز` };
  const p1 = s.incidents.filter((i) => i.priority === "1").length;
  if (p1) return { status: "partial_outage", reason: `${p1} رخداد اولویت ۱` };
  if (s.ci && !s.ci.maintenance && s.ci.severity >= 0.99) return { status: "partial_outage", reason: "پیکربندی از کار افتاده" };
  const p2 = s.incidents.filter((i) => i.priority === "2").length;
  if (p2) return { status: "degraded", reason: `${p2} رخداد اولویت ۲` };
  if (s.ci && !s.ci.maintenance && s.ci.severity >= 0.3) return { status: "degraded", reason: "افت کیفیت پیکربندی‌های وابسته" };
  if (s.ci?.maintenance) return { status: "maintenance", reason: "نگهداری برنامه‌ریزی‌شده" };
  return { status: "operational", reason: "" };
}

export interface StatusChange {
  at: string;
  from: string | null;
  to: string;
}

/** A day of the status page: the worst status of the day (local date) and the share of it the service was available. */
export interface DayBar {
  day: string;
  status: ServiceStatus;
  /** 0–100: time not in a partial or major outage */
  availability: number;
}

const DOWN = new Set(["partial_outage", "major_outage"]);

/** Local calendar date of an instant in `tz`. */
export function localDay(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/**
 * Daily bars over the last `days` days from the status history (changes in any order; `current` is the status now).
 * Days are cut at midnight UTC offsets of `tz` approximately by sampling every 15 minutes — exact enough for bars and
 * a percentage, and independent of daylight-saving rules.
 */
export function dailyBars(current: string, changes: StatusChange[], days: number, now: number, tz: string, since?: string | null): { bars: DayBar[]; availability: number } {
  const sorted = [...changes].filter((c) => !Number.isNaN(Date.parse(c.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const start = now - days * 86_400_000;
  // the status at the window's start: the `from` of the first change after it, else the last change before it, else now
  const statusAt = (t: number): string => {
    let s: string | null = null;
    for (const c of sorted) {
      if (Date.parse(c.at) <= t) s = c.to;
      else {
        if (s === null) s = c.from ?? current;
        break;
      }
    }
    return s ?? current;
  };
  const step = 15 * 60_000;
  const byDay = new Map<string, { worst: ServiceStatus; up: number; total: number }>();
  const born = since ? Date.parse(since) : NaN;
  let up = 0;
  let total = 0;
  let idx = 0;
  let cur = statusAt(start) as ServiceStatus;
  while (idx < sorted.length && Date.parse(sorted[idx].at) <= start) idx++;
  for (let t = start; t <= now; t += step) {
    while (idx < sorted.length && Date.parse(sorted[idx].at) <= t) cur = sorted[idx++].to as ServiceStatus;
    if (!Number.isNaN(born) && t < born) continue;
    const day = localDay(t, tz);
    const d = byDay.get(day) ?? { worst: "operational" as ServiceStatus, up: 0, total: 0 };
    const s = (cur in STATUS_RANK ? cur : "operational") as ServiceStatus;
    if (STATUS_RANK[s] > STATUS_RANK[d.worst]) d.worst = s;
    d.total++;
    total++;
    if (!DOWN.has(s)) {
      d.up++;
      up++;
    }
    byDay.set(day, d);
  }
  const bars = [...byDay].map(([day, d]) => ({ day, status: d.worst, availability: d.total ? Math.round((d.up / d.total) * 10000) / 100 : 100 })).slice(-days);
  return { bars, availability: total ? Math.round((up / total) * 10000) / 100 : 100 };
}

export interface ScoreInput {
  availability: number | null;
  target: number | null;
  incidents: number;
  major: number;
  breaches: number;
  csat: number | null;
}

export interface ScoreWeights {
  availability: number;
  incidents: number;
  breaches: number;
  csat: number;
}

/** The service performance score (catalogue SPF-015): weighted availability attainment, incidents, SLA breaches, CSAT. */
export function serviceScore(i: ScoreInput, w: ScoreWeights): { score: number; components: Record<string, number> } {
  const target = i.target && i.target > 0 ? i.target : 99;
  const availability = i.availability === null ? 100 : Math.min(100, Math.round((i.availability / target) * 100));
  const incidents = Math.max(0, 100 - i.incidents * 5 - i.major * 20);
  const breaches = i.incidents ? Math.round((1 - Math.min(i.breaches, i.incidents) / i.incidents) * 100) : 100;
  const csat = i.csat === null ? 100 : Math.round(((Math.min(5, Math.max(1, i.csat)) - 1) / 4) * 100);
  const total = w.availability + w.incidents + w.breaches + w.csat || 1;
  const score = Math.round((availability * w.availability + incidents * w.incidents + breaches * w.breaches + csat * w.csat) / total);
  return { score, components: { availability, incidents, breaches, csat } };
}

/** A proposal's score (0–100) from value, strategic fit and risk (each 1–5). */
export function proposalScore(value: number | null, fit: number | null, risk: number | null): number | null {
  if (!value || !fit || !risk) return null;
  return Math.round((((value - 1) / 4) * 0.4 + ((fit - 1) / 4) * 0.4 + ((5 - risk) / 4) * 0.2) * 100);
}

/** The share of a readiness checklist that is done. */
export function readinessPct(items: unknown): number {
  const list = Array.isArray(items) ? items.filter((x) => x && typeof x === "object") : [];
  if (!list.length) return 0;
  return Math.round((list.filter((x) => (x as { done?: unknown }).done === true).length / list.length) * 100);
}

// ---------------------------------------------------------------------------------------------------------------
// Rationalization and catalogue health (SPF-020/021/039)

const STOP = new Set(["و", "به", "از", "در", "با", "برای", "خدمت", "خدمات", "سامانه", "سامانهٔ", "the", "and", "of", "for", "service", "services"]);

/** Words of a name or tag list, Persian typing differences folded (ی/ي، ک/ك، ZWNJ, digits). */
export function nameTokens(...texts: unknown[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    const parts = Array.isArray(t) ? t : [t];
    for (const p of parts) {
      const s = String(p ?? "")
        .replace(/[‌‍‎‏]/g, " ")
        .replace(/ي/g, "ی")
        .replace(/ك/g, "ک")
        .replace(/[ۀة]/g, "ه")
        .replace(/[ً-ٰٟ]/g, "")
        .toLowerCase();
      for (const w of s.split(/[^\p{L}\p{N}]+/u)) if (w.length > 1 && !STOP.has(w)) out.add(w);
    }
  }
  return out;
}

/** Jaccard similarity of two token sets (0–1). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return Math.round((common / (a.size + b.size - common)) * 100) / 100;
}

/** Pairs of services that look alike: similar names or tags, more readily inside the same portfolio node. */
export function overlapPairs(items: { id: string; name: string; tags?: unknown; node?: string | null }[], threshold = 0.5): { a: string; b: string; similarity: number }[] {
  const toks = items.map((i) => ({ ...i, t: nameTokens(i.name, i.tags) }));
  const out: { a: string; b: string; similarity: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    for (let j = i + 1; j < toks.length; j++) {
      const s = similarity(toks[i].t, toks[j].t);
      const bar = toks[i].node && toks[i].node === toks[j].node ? Math.min(threshold, 0.34) : threshold;
      if (s >= bar) out.push({ a: toks[i].id, b: toks[j].id, similarity: s });
    }
  }
  return out.sort((x, y) => y.similarity - x.similarity);
}

/** Business value (0–100) from the tier, the share of subscribers and the performance score. */
export function serviceValue(tier: string | null | undefined, subscribers: number, maxSubscribers: number, score: number | null | undefined): number {
  const t = ({ tier_1: 100, tier_2: 75, tier_3: 50, tier_4: 25 } as Record<string, number>)[String(tier)] ?? 40;
  const reach = maxSubscribers > 0 ? (Math.min(subscribers, maxSubscribers) / maxSubscribers) * 100 : 0;
  const perf = score === null || score === undefined ? 70 : score;
  return Math.round(t * 0.5 + reach * 0.3 + perf * 0.2);
}

/** Quadrant on value × cost (or support load, when cost is hidden): split at the medians. */
export function quadrantOf(value: number, cost: number, medValue: number, medCost: number): "invest" | "maintain" | "review" | "retire" {
  const high = value >= medValue;
  const costly = cost > medCost;
  if (high) return costly ? "maintain" : "invest";
  return costly ? "retire" : "review";
}

export const QUADRANTS: Record<"invest" | "maintain" | "review" | "retire", { label: string; color: "green" | "blue" | "gold" | "red" }> = {
  invest: { label: "سرمایه‌گذاری", color: "green" },
  maintain: { label: "نگهداری و بهینه‌سازی", color: "blue" },
  review: { label: "بازبینی", color: "gold" },
  retire: { label: "نامزد کنارگذاری یا ادغام", color: "red" },
};

/** The median of a list (0 when empty). */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** When a service is next due for review: its last review (else its going live, else its creation) + N months. */
export function reviewDue(last: string | null | undefined, months: number | null | undefined, fallback: string | null | undefined): string | null {
  const m = Number(months ?? 12);
  if (!m || m <= 0) return null;
  const base = String(last || fallback || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null;
  const d = new Date(`${base}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + m);
  const last2 = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last2));
  return d.toISOString().slice(0, 10);
}
