// Operations reports (catalogue EVT-048 ops reports, EVT-032 alert-quality review, EVT-042 on-call load), computed
// in code from the alerts, events and pages the person may read (the access rule decides; figures are never taken
// from rows the person cannot see):
//   · flow: alerts and events per day, compression (events ÷ alerts), noise reduction (1 − paged alerts ÷ events)
//   · times: MTTA (acknowledged − opened) and MTTR (cleared or closed − opened): average, median, P90
//   · distributions: severity, source, team, state, hour of day (the organisation's zone), noisiest hosts
//   · noise: labels, never acknowledged, flapping, transient — with rule suggestions for the noisiest fingerprints
//   · paging: pages, acknowledged share, median time to acknowledge, pages per person, after-hours pages
import { stats, severityRank } from "@shared/event/logic";
import { ALERT_SEVERITIES, NOISE_LABELS, SOURCE_KINDS } from "@shared/tables/event";
import { localDate } from "@shared/model/jalali-buckets";
import { formatJalali } from "@shared/jalali";
import { isWorking } from "@shared/sla/calendar";
import type { Ctx } from "../../context";
import { defFor } from "../../engine";
import { access } from "../../access/provider";
import { forbidden } from "../../http/errors";
import { officeCalendar } from "../incident/major";
import { displayOf, isUuid, liveRows, msOf, orgTz, RefSet, sysOf, type Row } from "./common";
import { onCallLoad } from "./oncall";

export interface Bucket {
  key: string;
  label: string;
  count: number;
}

const DAY = 86_400_000;
const label = (opts: { value: string; label: string }[], v: unknown) => opts.find((o) => o.value === v)?.label ?? String(v ?? "—");

function count<T>(rows: T[], key: (r: T) => string | null, lab: (k: string) => string, limit = 12): Bucket[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r) ?? "";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, n]) => ({ key: k, label: k ? lab(k) : "(خالی)", count: n }));
}

async function needAlerts(ctx: Ctx) {
  const { def } = await defFor(ctx, "alert");
  if (!access().canReadTable(ctx, def)) throw forbidden("به هشدارها دسترسی ندارید");
  return def;
}

export interface OpsReport {
  days: number;
  totals: { alerts: number; events: number; open: number; acknowledged: number; incidents: number; groups: number; paged_alerts: number; maintenance: number };
  compression: number | null;
  noise_reduction: number | null;
  mtta: ReturnType<typeof stats>;
  mttr: ReturnType<typeof stats>;
  by_severity: Bucket[];
  by_source: Bucket[];
  by_team: Bucket[];
  by_state: Bucket[];
  by_hour: Bucket[];
  noisiest: Bucket[];
  noise: Bucket[];
  trend: { day: string; label: string; created: number; cleared: number; events: number }[];
  pages: { total: number; acknowledged: number; ack_rate: number | null; ack_median: number | null; after_hours: number; by_person: Bucket[] };
  display: Record<string, string>;
}

/** The operations report over the last `days` days. */
export async function opsReport(ctx: Ctx, days: number): Promise<OpsReport> {
  await needAlerts(ctx);
  const now = Date.now();
  const since = new Date(now - days * DAY).toISOString();
  const tz = orgTz(ctx);
  const q = ctx.db;
  const alerts = await liveRows(q, ctx, "alert", { f: "created_at", op: "gte", v: since }, { order: "t.created_at", limit: 20_000 });
  const events = await liveRows(q, ctx, "event", { f: "received_at", op: "gte", v: since }, { order: "t.received_at", limit: 50_000 }).catch(() => [] as Row[]);
  const openNow = await liveRows(q, ctx, "alert", { f: "state", op: "in", v: ["open", "acknowledged", "flapping", "snoozed", "maintenance"] }, { limit: 20_000 });
  const pageDef = (await defFor(ctx, "page")).def;
  const pages = access().canReadTable(ctx, pageDef) ? await liveRows(q, ctx, "page", { f: "sent_at", op: "gte", v: since }, { limit: 20_000 }) : [];
  const groups = alerts.filter((a) => isUuid(a.group_id)).map((a) => a.group_id);
  const mtta = stats(alerts.map((a) => (msOf(a.acknowledged_at) ?? NaN) - (msOf(a.opened_at) ?? msOf(a.created_at) ?? NaN)).filter(Number.isFinite));
  const mttr = stats(alerts.map((a) => (msOf(a.resolved_at) ?? msOf(a.closed_at) ?? NaN) - (msOf(a.opened_at) ?? msOf(a.created_at) ?? NaN)).filter(Number.isFinite));
  const refs = new RefSet();
  for (const a of alerts) {
    if (isUuid(a.source_id)) refs.add("event_source", a.source_id);
    if (isUuid(a.assignment_group_id)) refs.add("group", a.assignment_group_id);
  }
  for (const p of pages) if (isUuid(p.user_id)) refs.add("user", p.user_id);
  const display = await displayOf(ctx, refs);
  const hourOf = (v: unknown) => {
    const t = msOf(v);
    if (t === null) return null;
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
    return String(h).padStart(2, "0");
  };
  // per day (Jalali labels)
  const days0: OpsReport["trend"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = localDate(now - i * DAY, tz);
    days0.push({ day: d, label: formatJalali(d), created: 0, cleared: 0, events: 0 });
  }
  const at = new Map(days0.map((d) => [d.day, d]));
  for (const a of alerts) {
    const c = msOf(a.created_at);
    if (c !== null) at.get(localDate(c, tz))!.created += at.has(localDate(c, tz)) ? 1 : 0;
    const r = msOf(a.resolved_at);
    if (r !== null && at.has(localDate(r, tz))) at.get(localDate(r, tz))!.cleared++;
  }
  for (const e of events) {
    const t = msOf(e.received_at);
    if (t !== null && at.has(localDate(t, tz))) at.get(localDate(t, tz))!.events++;
  }
  // paging
  const cal = await officeCalendar(q, sysOf(ctx)).catch(() => null);
  const acked = pages.filter((p) => p.state === "acknowledged");
  const ackTimes = acked.map((p) => (msOf(p.acknowledged_at) ?? NaN) - (msOf(p.sent_at) ?? NaN)).filter(Number.isFinite);
  const pagedAlerts = alerts.filter((a) => Number(a.pages_sent ?? 0) > 0).length;
  return {
    days,
    totals: {
      alerts: alerts.length,
      events: events.length,
      open: openNow.length,
      acknowledged: alerts.filter((a) => a.acknowledged_at).length,
      incidents: new Set(alerts.map((a) => a.incident_id).filter(isUuid)).size,
      groups: new Set(groups).size,
      paged_alerts: pagedAlerts,
      maintenance: alerts.filter((a) => a.maintenance_window_id || a.change_id).length,
    },
    compression: alerts.length ? Math.round((events.length / alerts.length) * 100) / 100 : null,
    noise_reduction: events.length ? Math.round((1 - pagedAlerts / events.length) * 10_000) / 100 : null,
    mtta,
    mttr,
    by_severity: count(alerts, (a) => String(a.severity ?? ""), (k) => label(ALERT_SEVERITIES, k), 6).sort((a, b) => severityRank(a.key) - severityRank(b.key)),
    by_source: count(alerts, (a) => (isUuid(a.source_id) ? a.source_id : null), (k) => display[k] ?? "منبع محدود"),
    by_team: count(alerts, (a) => (isUuid(a.assignment_group_id) ? a.assignment_group_id : null), (k) => display[k] ?? "گروه محدود"),
    by_state: count(alerts, (a) => String(a.state ?? ""), (k) => ({ open: "باز", acknowledged: "تأییدشده", flapping: "نوسانی", snoozed: "به تعویق", maintenance: "در نگهداری", cleared: "رفع‌شده", closed: "بسته", suppressed: "سرکوب‌شده" })[k] ?? k),
    by_hour: Array.from({ length: 24 }, (_, h) => {
      const key = String(h).padStart(2, "0");
      return { key, label: `${h.toLocaleString("fa-IR")}`, count: alerts.filter((a) => hourOf(a.created_at) === key).length };
    }),
    noisiest: count(alerts, (a) => (a.node ? String(a.node) : null), (k) => k, 10),
    noise: count(alerts.filter((a) => a.noise_label), (a) => String(a.noise_label), (k) => label(NOISE_LABELS, k), 3),
    trend: days0,
    pages: {
      total: pages.length,
      acknowledged: acked.length,
      ack_rate: pages.length ? Math.round((acked.length / pages.length) * 1000) / 10 : null,
      ack_median: stats(ackTimes).median,
      after_hours: cal ? pages.filter((p) => msOf(p.sent_at) !== null && !isWorking(cal, msOf(p.sent_at)!)).length : 0,
      by_person: count(pages, (p) => (isUuid(p.user_id) ? p.user_id : null), (k) => display[k] ?? "عضو", 10),
    },
    display,
  };
}

export interface NoiseItem {
  fingerprint: string;
  title: string;
  node: string | null;
  source: string | null;
  alerts: number;
  never_acked: number;
  flapping: number;
  transient: number;
  incidents: number;
  suggestion: string;
}

export interface NoiseReport {
  days: number;
  alerts: number;
  noise_share: number | null;
  never_acked_share: number | null;
  items: NoiseItem[];
  sources: { key: string; label: string; alerts: number; noise: number }[];
}

/** The alert-quality review (EVT-032, rule-based): the noisiest fingerprints and what to do about them. */
export async function noiseReport(ctx: Ctx, days: number): Promise<NoiseReport> {
  await needAlerts(ctx);
  const since = new Date(Date.now() - days * DAY).toISOString();
  const alerts = await liveRows(ctx.db, ctx, "alert", { f: "created_at", op: "gte", v: since }, { limit: 20_000 });
  const refs = new RefSet();
  for (const a of alerts) if (isUuid(a.source_id)) refs.add("event_source", a.source_id);
  const display = await displayOf(ctx, refs);
  const by = new Map<string, Row[]>();
  for (const a of alerts) {
    const k = String(a.fingerprint ?? a.id);
    by.set(k, [...(by.get(k) ?? []), a]);
  }
  const noisy = (a: Row) => a.noise_label === "noise" || a.noise_label === "likely_noise";
  const items: NoiseItem[] = [...by].map(([fp, rows]) => {
    const first = rows[0];
    const neverAcked = rows.filter((r) => !r.acknowledged_at && ["cleared", "closed"].includes(String(r.state))).length;
    const flapping = rows.filter((r) => Number(r.flap_count ?? 0) > 0 || r.state === "flapping").length;
    const transient = rows.filter((r) => r.noise_reason && String(r.noise_reason).startsWith("گذرا")).length;
    const incidents = rows.filter((r) => isUuid(r.incident_id)).length;
    const total = rows.reduce((s, r) => s + Math.max(1, Number(r.reopen_count ?? 0) + 1), 0);
    let suggestion = "بدون پیشنهاد";
    if (incidents) suggestion = "نگه دارید: به رخداد انجامیده است";
    else if (flapping) suggestion = `قاعدهٔ «آستانه» (مثلاً ${Math.min(5, total + 1).toLocaleString("fa-IR")} رویداد در ۱۰ دقیقه) برای این سنجه بسازید`;
    else if (transient >= Math.max(2, rows.length / 2)) suggestion = "قاعدهٔ «آستانه» یا «نادیده گرفتن» برای این رویداد گذرا";
    else if (neverAcked === rows.length && rows.length >= 3) suggestion = "شدت را کم کنید یا با قاعدهٔ «سرکوب» فقط ثبت شود";
    return { fingerprint: fp, title: String(first.short_description ?? ""), node: first.node ?? null, source: isUuid(first.source_id) ? display[first.source_id] ?? null : null, alerts: total, never_acked: neverAcked, flapping, transient, incidents, suggestion };
  });
  items.sort((a, b) => b.alerts - a.alerts);
  const sources = new Map<string, { alerts: number; noise: number }>();
  for (const a of alerts) {
    const k = isUuid(a.source_id) ? a.source_id : "";
    const s = sources.get(k) ?? { alerts: 0, noise: 0 };
    s.alerts++;
    if (noisy(a)) s.noise++;
    sources.set(k, s);
  }
  const labelled = alerts.filter((a) => a.noise_label);
  return {
    days,
    alerts: alerts.length,
    noise_share: labelled.length ? Math.round((labelled.filter(noisy).length / labelled.length) * 1000) / 10 : null,
    never_acked_share: alerts.length ? Math.round((alerts.filter((a) => !a.acknowledged_at && ["cleared", "closed"].includes(String(a.state))).length / alerts.length) * 1000) / 10 : null,
    items: items.filter((i) => i.alerts > 1 || i.flapping || i.transient).slice(0, 25),
    sources: [...sources].map(([k, v]) => ({ key: k, label: k ? display[k] ?? "منبع محدود" : "(بی‌منبع)", ...v })).sort((a, b) => b.noise - a.noise).slice(0, 12),
  };
}

/** Markdown of the noise report (the rule-based answer of the AI skill «گزارش نویز»). */
export function noiseText(r: NoiseReport): string {
  const lines = [
    `**بازبینی کیفیت هشدار — ${r.days.toLocaleString("fa-IR")} روز گذشته**`,
    `${r.alerts.toLocaleString("fa-IR")} هشدار؛ سهم نویز ${r.noise_share === null ? "—" : `${r.noise_share.toLocaleString("fa-IR")}٪`}؛ بی‌تأیید رفع‌شده ${r.never_acked_share === null ? "—" : `${r.never_acked_share.toLocaleString("fa-IR")}٪`}.`,
  ];
  if (r.items.length) {
    lines.push("", "پرتکرارترین‌ها:");
    for (const i of r.items.slice(0, 8)) lines.push(`- «${i.title}»${i.node ? ` روی ${i.node}` : ""}: ${i.alerts.toLocaleString("fa-IR")} بار — ${i.suggestion}`);
  } else lines.push("", "هشدار پرتکراری در این دوره نبود.");
  return lines.join("\n");
}

export interface LoadRow {
  user_id: string;
  oncall_hours: number;
  pages: number;
  after_hours_pages: number;
  acknowledged: number;
}

/** On-call load and fairness (EVT-042): on-call hours per person over the period, pages, after-hours pages. */
export async function oncallLoadReport(ctx: Ctx, days: number): Promise<{ days: number; rows: LoadRow[]; display: Record<string, string> }> {
  const { def } = await defFor(ctx, "oncall_schedule");
  if (!access().canReadTable(ctx, def)) throw forbidden("به برنامه‌های کشیک دسترسی ندارید");
  const now = Date.now();
  const from = now - days * DAY;
  const schedules = await liveRows(ctx.db, ctx, "oncall_schedule", { f: "active", op: "eq", v: true }, { limit: 100 });
  const hours = new Map<string, number>();
  for (const s of schedules) for (const [u, ms] of await onCallLoad(ctx.db, ctx, s, from, now)) hours.set(u, (hours.get(u) ?? 0) + ms);
  const pageDef = (await defFor(ctx, "page")).def;
  const pages = access().canReadTable(ctx, pageDef) ? await liveRows(ctx.db, ctx, "page", { f: "sent_at", op: "gte", v: new Date(from).toISOString() }, { limit: 20_000 }) : [];
  const cal = await officeCalendar(ctx.db, sysOf(ctx)).catch(() => null);
  const people = new Set([...hours.keys(), ...pages.map((p) => String(p.user_id))].filter(isUuid));
  const rows: LoadRow[] = [...people].map((u) => {
    const mine = pages.filter((p) => p.user_id === u);
    return {
      user_id: u,
      oncall_hours: Math.round(((hours.get(u) ?? 0) / 3600_000) * 10) / 10,
      pages: mine.length,
      after_hours_pages: cal ? mine.filter((p) => msOf(p.sent_at) !== null && !isWorking(cal, msOf(p.sent_at)!)).length : 0,
      acknowledged: mine.filter((p) => p.state === "acknowledged").length,
    };
  }).sort((a, b) => b.oncall_hours - a.oncall_hours || b.pages - a.pages);
  const refs = new RefSet();
  for (const r of rows) refs.add("user", r.user_id);
  return { days, rows, display: await displayOf(ctx, refs) };
}

export const sourceKindLabel = (k: unknown) => label(SOURCE_KINDS, k);
