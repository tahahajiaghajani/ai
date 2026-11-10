// What changed (catalogue AI-113, ANA-025/029; docs/spec/AI.md §16.1). Insights are computed per period — yesterday, or
// last Iranian week (Saturday to Friday) — on every table the metadata calls for, as the system, with the engine's
// aggregates (numbers come from code, never from a model):
//   · every task table: volume against the previous period with the breakdown that moved most (category, service,
//     group or channel — the first the table has), a spike against the same weekday of eight earlier weeks (seasonal
//     robust z), open work and its ageing, resolution time, reopen rate against the four periods before;
//   · tables whose records carry SLAs: compliance of the SLAs that ended, the definitions that breached most;
//   · tables with a change outcome (`close_code` with failed codes): the share of implemented changes that succeeded;
//   · requested items: fulfilment time (created → closed) and the items that took longest;
//   · tables of the event module: alert storms (the last hour against the 48 before).
// Each card keeps WHAT it was computed over — its table, the condition of its rows, the fields it grouped or measured
// by, the records its drivers name — for the visibility rule (./views.ts).
import { addDays, formatJalali, weekday } from "@shared/jalali";
import type { Cond } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { zonedMidnight } from "@shared/model/jalali-buckets";
import { FAILED_CODES, IMPLEMENTED_CODES } from "@shared/tables/change";
import type { InsightDriver, InsightPeriod, InsightSeverity } from "@shared/ai/insights";
import { TABLES } from "@shared/tables";
import { refTarget } from "@shared/model/types";
import type { Ctx } from "../../../context";
import { aggregate, orgSchema } from "../../../engine";
import { isBurst, rateShift, seasonalZ } from "../ml/core/anomaly";
import { modelField } from "../ml/specs";

export interface Period {
  kind: InsightPeriod;
  key: string;
  label: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  /** days in the period (1 or 7) */
  days: number;
}

export interface InsightDraft {
  kind: string;
  table: string;
  subject: string;
  severity: InsightSeverity;
  score: number;
  title: string;
  numbers: Record<string, number | string | null>;
  drivers: InsightDriver[];
  driver_field: string | null;
  /** what the card was computed over (the visibility rule) */
  scope: { table: string; cond: Cond };
  fields: string[];
  refs: { table: string; ids: string[] }[];
  narrative: string;
}

const iso = (ms: number) => new Date(ms).toISOString();
const pct = (x: number) => `${faDigits(Math.round(Math.abs(x) * 10) / 10)}٪`;
const n = (v: unknown) => Number(v ?? 0) || 0;

/** The period ending before `today` (the organisation's date): yesterday, or the Iranian week before this one. */
export function periodOf(kind: InsightPeriod, today: string, tz: string): Period {
  if (kind === "daily") {
    const key = addDays(today, -1);
    return {
      kind,
      key,
      label: `دیروز (${formatJalali(key)})`,
      from: iso(zonedMidnight(key, tz)),
      to: iso(zonedMidnight(today, tz)),
      prevFrom: iso(zonedMidnight(addDays(key, -1), tz)),
      prevTo: iso(zonedMidnight(key, tz)),
      days: 1,
    };
  }
  const thisWeek = addDays(today, -weekday(today));
  const key = addDays(thisWeek, -7);
  return {
    kind,
    key,
    label: `هفتهٔ ${formatJalali(key)} تا ${formatJalali(addDays(key, 6))}`,
    from: iso(zonedMidnight(key, tz)),
    to: iso(zonedMidnight(thisWeek, tz)),
    prevFrom: iso(zonedMidnight(addDays(key, -7), tz)),
    prevTo: iso(zonedMidnight(key, tz)),
    days: 7,
  };
}

const between = (field: string, from: string, to: string): Cond => ({ and: [{ f: field, op: "gte", v: from }, { f: field, op: "lt", v: to }] });

async function count(sys: Ctx, table: string, cond: Cond): Promise<number> {
  const r = await aggregate(sys, table, { filter: cond, metrics: [{ fn: "count" }] });
  return n(r.totals.count);
}

async function countBy(sys: Ctx, table: string, cond: Cond, field: string): Promise<Map<string, { label: string; n: number }>> {
  const r = await aggregate(sys, table, { filter: cond, groupBy: [field], metrics: [{ fn: "count" }], limit: 200 });
  return new Map(r.rows.filter((x) => x.keys[0] !== null && x.keys[0] !== undefined && x.keys[0] !== "").map((x) => [String(x.keys[0]), { label: String(x.labels[0] ?? x.keys[0]), n: n(x.values.count) }]));
}

async function median(sys: Ctx, table: string, cond: Cond, field: string): Promise<number | null> {
  const r = await aggregate(sys, table, { filter: cond, metrics: [{ fn: "median", field }, { fn: "count" }] });
  const v = Number(r.totals[`median:${field}`]);
  return n(r.totals.count) && Number.isFinite(v) ? v : null;
}

/** The breakdown of a table's insights: the first of category, service, group, channel it has (that a model may use). */
export function driverField(def: TableDef): string | null {
  for (const name of ["category", "service_id", "assignment_group_id", "channel"]) {
    const f = def.fields.find((x) => x.name === name);
    if (modelField(def, f)) return name;
  }
  return null;
}

/** Values of the breakdown that moved most between two periods (largest absolute change first). */
function movers(cur: Map<string, { label: string; n: number }>, prev: Map<string, { label: string; n: number }>, k = 3): InsightDriver[] {
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  return [...keys]
    .map((key) => {
      const c = cur.get(key)?.n ?? 0;
      const p = prev.get(key)?.n ?? 0;
      return { key, label: cur.get(key)?.label ?? prev.get(key)?.label ?? key, current: c, previous: p, delta: c - p };
    })
    .filter((d) => d.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.current - a.current || (a.key < b.key ? -1 : 1))
    .slice(0, k);
}

/** Record ids a set of drivers names, per referenced table (choices name none). */
function driverRefs(def: TableDef, field: string | null, drivers: InsightDriver[]): { table: string; ids: string[] }[] {
  const f = field ? def.fields.find((x) => x.name === field) : null;
  if (!f || !["ref", "group", "user"].includes(f.type)) return [];
  const ids = drivers.map((d) => d.key).filter((k) => /^[0-9a-f-]{36}$/i.test(k));
  return ids.length ? [{ table: refTarget(f, def.key) ?? "", ids }].filter((r) => r.table) : [];
}

const changePct = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

async function volumeInsights(sys: Ctx, def: TableDef, p: Period): Promise<InsightDraft[]> {
  const cur = between("created_at", p.from, p.to);
  const prev = between("created_at", p.prevFrom, p.prevTo);
  const [c, pr] = [await count(sys, def.key, cur), await count(sys, def.key, prev)];
  if (!c && !pr) return [];
  const field = driverField(def);
  const drivers = field ? movers(await countBy(sys, def.key, cur, field), await countBy(sys, def.key, prev, field)) : [];
  const ch = changePct(c, pr);
  const out: InsightDraft[] = [];
  const severity: InsightSeverity = ch !== null && Math.abs(ch) >= 50 && c >= 20 ? "warning" : ch !== null && Math.abs(ch) >= 20 ? "notice" : "info";
  const top = drivers[0];
  out.push({
    kind: "volume",
    table: def.key,
    subject: "",
    severity,
    score: Math.min(100, Math.abs(ch ?? 0)) + (severity === "warning" ? 50 : 0),
    title: `${def.plural}: ${faDigits(c)} مورد${ch === null ? "" : ` (${ch >= 0 ? "+" : "−"}${pct(ch)})`}`,
    numbers: { current: c, previous: pr, change_pct: ch === null ? null : Math.round(ch * 10) / 10 },
    drivers,
    driver_field: field,
    scope: { table: def.key, cond: { or: [cur, prev] } },
    fields: ["created_at", ...(field ? [field] : [])],
    refs: driverRefs(def, field, drivers),
    narrative:
      `در ${p.label}، ${faDigits(c)} ${def.label} ثبت شد` +
      (ch === null ? "." : ch === 0 ? `؛ همان اندازهٔ دورهٔ پیش.` : `؛ ${pct(ch)} ${ch > 0 ? "بیشتر" : "کمتر"} از دورهٔ پیش (${faDigits(pr)}).`) +
      (top ? ` بیشترین تغییر در «${top.label}» بود (${top.delta! > 0 ? "+" : "−"}${faDigits(Math.abs(top.delta!))}).` : ""),
  });
  // a spike against the same weekday of the eight weeks before (daily periods)
  if (p.kind === "daily") {
    const days = Array.from({ length: 57 }, (_, i) => addDays(p.key, i - 56));
    const r = await aggregate(sys, def.key, { filter: between("created_at", iso(Date.parse(p.from) - 56 * 86_400_000), p.to), groupBy: [{ field: "created_at", bucket: "day" }], metrics: [{ fn: "count" }], limit: 100 });
    const by = new Map(r.rows.map((x) => [String(x.keys[0]).slice(0, 10), n(x.values.count)]));
    const series = days.map((d) => by.get(d) ?? 0);
    const z = seasonalZ(series, { period: 7, cycles: 8 })[0];
    if (z && z.z >= 3.5 && c >= 5) {
      out.push({
        kind: "volume_spike",
        table: def.key,
        subject: "",
        severity: z.z >= 6 ? "critical" : "warning",
        score: 100 + z.z * 10,
        title: `جهش ${def.plural}: ${faDigits(c)} در برابر معمول ${faDigits(Math.round(z.baseline))}`,
        numbers: { current: c, baseline: Math.round(z.baseline * 10) / 10, z: z.z },
        drivers,
        driver_field: field,
        scope: { table: def.key, cond: between("created_at", iso(Date.parse(p.from) - 56 * 86_400_000), p.to) },
        fields: ["created_at", ...(field ? [field] : [])],
        refs: driverRefs(def, field, drivers),
        narrative: `${def.plural} در ${p.label} به ${faDigits(c)} رسید، در حالی که این روز هفته معمولاً حدود ${faDigits(Math.round(z.baseline))} مورد دارد (انحراف ${faDigits(z.z)} برابر پراکندگی معمول).${top ? ` بیشترین افزایش: «${top.label}».` : ""}`,
      });
    }
  }
  return out;
}

async function backlogInsight(sys: Ctx, def: TableDef, p: Period): Promise<InsightDraft[]> {
  if (!def.fields.some((f) => f.name === "active")) return [];
  const open: Cond = { f: "active", op: "eq", v: true };
  // who may see the card is asked of the records it counted — those open now — not of the ones open when it is read:
  // created before now and still open, or closed or changed since (a superset, never a smaller set)
  const at = iso(Date.now());
  const counted: Cond = { and: [{ f: "created_at", op: "lt", v: at }, { or: [open, { f: "closed_at", op: "gt", v: at }, { f: "updated_at", op: "gt", v: at }] }] };
  const total = await count(sys, def.key, open);
  if (!total) return [];
  const agedAt = iso(Date.parse(p.to) - 7 * 86_400_000);
  const aged = await count(sys, def.key, { and: [open, { f: "created_at", op: "lt", v: agedAt }] });
  const field = def.scope.group && modelField(def, def.fields.find((f) => f.name === def.scope.group)) ? def.scope.group : null;
  const byGroup = field ? await countBy(sys, def.key, { and: [open, { f: "created_at", op: "lt", v: agedAt }] }, field) : new Map();
  const drivers = [...byGroup.entries()]
    .map(([key, x]) => ({ key, label: x.label, current: x.n, previous: null, delta: null }))
    .sort((a, b) => b.current - a.current || (a.key < b.key ? -1 : 1))
    .slice(0, 3);
  const share = (aged / total) * 100;
  const severity: InsightSeverity = share >= 50 && aged >= 10 ? "warning" : share >= 30 ? "notice" : "info";
  return [
    {
      kind: "backlog",
      table: def.key,
      subject: "",
      severity,
      score: share,
      title: `${def.plural} باز: ${faDigits(total)} (${pct(share)} کهنه‌تر از یک هفته)`,
      numbers: { open: total, aged, aged_pct: Math.round(share * 10) / 10 },
      drivers,
      driver_field: field,
      scope: { table: def.key, cond: def.fields.some((f) => f.name === "closed_at") ? counted : open },
      fields: ["active", "created_at", ...(field ? [field] : [])],
      refs: driverRefs(def, field, drivers),
      narrative: `اکنون ${faDigits(total)} ${def.label} باز است و ${faDigits(aged)} مورد (${pct(share)}) بیش از یک هفته است که باز مانده.${drivers[0] ? ` بیشترین کار کهنه نزد «${drivers[0].label}» است (${faDigits(drivers[0].current)}).` : ""}`,
    },
  ];
}

async function resolutionInsight(sys: Ctx, def: TableDef, p: Period): Promise<InsightDraft[]> {
  const f = def.fields.find((x) => x.name === "time_to_resolve");
  if (!modelField(def, f) || !def.fields.some((x) => x.name === "resolved_at")) return [];
  const cur = between("resolved_at", p.from, p.to);
  const prev = between("resolved_at", p.prevFrom, p.prevTo);
  const [mc, mp] = [await median(sys, def.key, cur, "time_to_resolve"), await median(sys, def.key, prev, "time_to_resolve")];
  if (mc === null) return [];
  const hours = (s: number) => Math.round((s / 3600) * 10) / 10;
  const ch = mp ? ((mc - mp) / mp) * 100 : null;
  const severity: InsightSeverity = ch !== null && ch >= 50 ? "warning" : ch !== null && Math.abs(ch) >= 20 ? "notice" : "info";
  return [
    {
      kind: "resolution",
      table: def.key,
      subject: "",
      severity,
      score: Math.min(100, Math.abs(ch ?? 0)),
      title: `میانهٔ زمان حل ${def.plural}: ${faDigits(hours(mc))} ساعت`,
      numbers: { median_hours: hours(mc), previous_hours: mp === null ? null : hours(mp), change_pct: ch === null ? null : Math.round(ch * 10) / 10 },
      drivers: [],
      driver_field: null,
      scope: { table: def.key, cond: { or: [cur, prev] } },
      fields: ["resolved_at", "time_to_resolve"],
      refs: [],
      narrative: `میانهٔ زمان حل ${def.plural} در ${p.label} ${faDigits(hours(mc))} ساعت بود${mp === null ? "." : `؛ دورهٔ پیش ${faDigits(hours(mp))} ساعت.`}`,
    },
  ];
}

async function reopenInsight(sys: Ctx, def: TableDef, p: Period): Promise<InsightDraft[]> {
  if (!modelField(def, def.fields.find((x) => x.name === "reopen_count")) || !def.fields.some((x) => x.name === "resolved_at")) return [];
  const cur = between("resolved_at", p.from, p.to);
  const base = between("resolved_at", iso(Date.parse(p.from) - 4 * p.days * 86_400_000), p.from);
  const [n1, k1, n0, k0] = [
    await count(sys, def.key, cur),
    await count(sys, def.key, { and: [cur, { f: "reopen_count", op: "gt", v: 0 }] }),
    await count(sys, def.key, base),
    await count(sys, def.key, { and: [base, { f: "reopen_count", op: "gt", v: 0 }] }),
  ];
  if (!n1) return [];
  const r = rateShift(k1, n1, k0, n0);
  if (!r.flagged && k1 === 0) return [];
  return [
    {
      kind: "reopen",
      table: def.key,
      subject: "",
      severity: r.flagged ? "warning" : "info",
      score: r.flagged ? 80 + r.z : r.rate * 100,
      title: `بازگشایی ${def.plural}: ${pct(r.rate * 100)}`,
      numbers: { rate_pct: Math.round(r.rate * 1000) / 10, before_pct: Math.round(r.before * 1000) / 10, reopened: k1, resolved: n1, z: r.z },
      drivers: [],
      driver_field: null,
      scope: { table: def.key, cond: between("resolved_at", iso(Date.parse(p.from) - 4 * p.days * 86_400_000), p.to) },
      fields: ["resolved_at", "reopen_count"],
      refs: [],
      narrative: `${faDigits(k1)} از ${faDigits(n1)} ${def.label} حل‌شده در ${p.label} دوباره باز شده بود (${pct(r.rate * 100)})؛ در چهار دورهٔ پیش ${pct(r.before * 100)}.${r.flagged ? " این افزایش از تغییرهای معمول بیشتر است." : ""}`,
    },
  ];
}

async function slaInsight(sys: Ctx, def: TableDef, p: Period): Promise<InsightDraft[]> {
  const schema = await orgSchema(sys);
  if (!def.features?.sla || !schema.def("task_sla")) return [];
  const ended = (from: string, to: string): Cond => ({ and: [{ f: "table_key", op: "eq", v: def.key }, { f: "stage", op: "in", v: ["achieved", "breached"] }, ...(between("stop_at", from, to) as { and: Cond[] }).and] });
  const rate = async (from: string, to: string) => {
    const all = await count(sys, "task_sla", ended(from, to));
    const bad = await count(sys, "task_sla", { and: [ended(from, to), { f: "stage", op: "eq", v: "breached" }] });
    return { all, bad, ok: all ? ((all - bad) / all) * 100 : null };
  };
  const [c, pr] = [await rate(p.from, p.to), await rate(p.prevFrom, p.prevTo)];
  if (!c.all || c.ok === null) return [];
  const breaches = await countBy(sys, "task_sla", { and: [ended(p.from, p.to), { f: "stage", op: "eq", v: "breached" }] }, "definition_id");
  const drivers = [...breaches.entries()].map(([key, x]) => ({ key, label: x.label, current: x.n, previous: null, delta: null })).sort((a, b) => b.current - a.current).slice(0, 3);
  const drop = pr.ok !== null ? c.ok - pr.ok : null;
  const severity: InsightSeverity = c.ok < 80 || (drop !== null && drop <= -10) ? "warning" : drop !== null && drop <= -5 ? "notice" : "info";
  return [
    {
      kind: "sla",
      table: def.key,
      subject: "",
      severity,
      score: 100 - c.ok + Math.max(0, -(drop ?? 0)),
      title: `پایبندی به توافق در ${def.plural}: ${pct(c.ok)}`,
      numbers: { compliance_pct: Math.round(c.ok * 10) / 10, previous_pct: pr.ok === null ? null : Math.round(pr.ok * 10) / 10, ended: c.all, breached: c.bad },
      drivers,
      driver_field: "definition_id",
      scope: { table: "task_sla", cond: { or: [ended(p.from, p.to), ended(p.prevFrom, p.prevTo)] } },
      fields: ["table_key", "stage", "stop_at", "definition_id"],
      refs: drivers.length ? [{ table: "sla_definition", ids: drivers.map((d) => d.key) }] : [],
      narrative: `از ${faDigits(c.all)} توافق ${def.plural} که در ${p.label} پایان یافت، ${faDigits(c.bad)} مورد نقض شد و پایبندی ${pct(c.ok)} بود${pr.ok === null ? "." : ` (دورهٔ پیش ${pct(pr.ok)}).`}${drivers[0] ? ` بیشترین نقض: «${drivers[0].label}» (${faDigits(drivers[0].current)}).` : ""}`,
    },
  ];
}

async function changeInsight(sys: Ctx, def: TableDef, p: Period): Promise<InsightDraft[]> {
  if (!modelField(def, def.fields.find((x) => x.name === "close_code")) || !def.fields.some((x) => x.name === "closed_at")) return [];
  const impl = (from: string, to: string): Cond => ({ and: [{ f: "close_code", op: "in", v: IMPLEMENTED_CODES }, ...(between("closed_at", from, to) as { and: Cond[] }).and] });
  const rate = async (from: string, to: string) => {
    const all = await count(sys, def.key, impl(from, to));
    const failed = await count(sys, def.key, { and: [impl(from, to), { f: "close_code", op: "in", v: FAILED_CODES }] });
    return { all, failed, ok: all ? ((all - failed) / all) * 100 : null };
  };
  const [c, pr] = [await rate(p.from, p.to), await rate(p.prevFrom, p.prevTo)];
  if (!c.all || c.ok === null) return [];
  const field = modelField(def, def.fields.find((x) => x.name === "type")) ? "type" : driverField(def);
  const fails = field ? await countBy(sys, def.key, { and: [impl(p.from, p.to), { f: "close_code", op: "in", v: FAILED_CODES }] }, field) : new Map();
  const drivers = [...fails.entries()].map(([key, x]) => ({ key, label: x.label, current: x.n, previous: null, delta: null })).sort((a, b) => b.current - a.current).slice(0, 3);
  return [
    {
      kind: "change_success",
      table: def.key,
      subject: "",
      severity: c.ok < 85 ? "warning" : c.ok < 95 ? "notice" : "info",
      score: 100 - c.ok,
      title: `موفقیت ${def.plural}: ${pct(c.ok)}`,
      numbers: { success_pct: Math.round(c.ok * 10) / 10, previous_pct: pr.ok === null ? null : Math.round(pr.ok * 10) / 10, implemented: c.all, failed: c.failed },
      drivers,
      driver_field: field,
      scope: { table: def.key, cond: { or: [impl(p.from, p.to), impl(p.prevFrom, p.prevTo)] } },
      fields: ["close_code", "closed_at", ...(field ? [field] : [])],
      refs: driverRefs(def, field, drivers),
      narrative: `از ${faDigits(c.all)} ${def.label} اجراشده در ${p.label}، ${faDigits(c.failed)} مورد ناموفق یا برگشتی بود (موفقیت ${pct(c.ok)}${pr.ok === null ? "" : `؛ دورهٔ پیش ${pct(pr.ok)}`}).`,
    },
  ];
}

async function fulfilmentInsight(sys: Ctx, def: TableDef, p: Period): Promise<InsightDraft[]> {
  if (def.key !== "request_item" || !def.fields.some((x) => x.name === "closed_at")) return [];
  // fulfilment time in hours, from rows (bounded): created → closed
  const rows = await aggregate(sys, def.key, { filter: between("closed_at", p.from, p.to), metrics: [{ fn: "count" }] });
  const done = n(rows.totals.count);
  if (!done) return [];
  const dur = await sys.db.query<{ h: number }>(
    `select percentile_cont(0.5) within group (order by extract(epoch from (t.closed_at - t.created_at)) / 3600)::float8 as h from ${def.table} t
     where t.org_id = $1 and t.deleted_at is null and t.closed_at >= $2 and t.closed_at < $3`,
    [sys.org.id, p.from, p.to],
  );
  const prev = await sys.db.query<{ h: number }>(
    `select percentile_cont(0.5) within group (order by extract(epoch from (t.closed_at - t.created_at)) / 3600)::float8 as h from ${def.table} t
     where t.org_id = $1 and t.deleted_at is null and t.closed_at >= $2 and t.closed_at < $3`,
    [sys.org.id, p.prevFrom, p.prevTo],
  );
  const h = dur[0]?.h ?? null;
  if (h === null) return [];
  const ph = prev[0]?.h ?? null;
  const ch = ph ? ((h - ph) / ph) * 100 : null;
  return [
    {
      kind: "fulfilment",
      table: def.key,
      subject: "",
      severity: ch !== null && ch >= 50 ? "warning" : ch !== null && Math.abs(ch) >= 20 ? "notice" : "info",
      score: Math.min(100, Math.abs(ch ?? 0)),
      title: `میانهٔ زمان انجام ${def.plural}: ${faDigits(Math.round(h * 10) / 10)} ساعت`,
      numbers: { median_hours: Math.round(h * 10) / 10, previous_hours: ph === null ? null : Math.round(ph * 10) / 10, closed: done, change_pct: ch === null ? null : Math.round(ch * 10) / 10 },
      drivers: [],
      driver_field: null,
      scope: { table: def.key, cond: { or: [between("closed_at", p.from, p.to), between("closed_at", p.prevFrom, p.prevTo)] } },
      fields: ["closed_at", "created_at"],
      refs: [],
      narrative: `${faDigits(done)} ${def.label} در ${p.label} انجام شد با میانهٔ ${faDigits(Math.round(h * 10) / 10)} ساعت از ثبت تا بستن${ph === null ? "." : `؛ دورهٔ پیش ${faDigits(Math.round(ph * 10) / 10)} ساعت.`}`,
    },
  ];
}

/** The tables whose hourly volume can storm: monitoring events, alerts and pages (never configuration rows). */
export const STORM_TABLES = ["event", "alert", "page"] as const;

/** A storm in the hour that ends at `end` (an hour boundary) of one table, against the 48 hours before it. */
async function alertStorm(sys: Ctx, def: TableDef, end: number): Promise<InsightDraft[]> {
  const hourStart = end - (end % 3_600_000);
  const from = iso(hourStart - 48 * 3_600_000);
  const rows = await sys.db.query<{ h: string; n: number }>(
    `select date_trunc('hour', t.created_at) as h, count(*)::int as n from ${def.table} t where t.org_id = $1 and t.deleted_at is null and t.created_at >= $2 and t.created_at < $3 group by 1`,
    [sys.org.id, from, iso(hourStart)],
  );
  const by = new Map(rows.map((x) => [Date.parse(x.h), Number(x.n)]));
  const hours = Array.from({ length: 48 }, (_, i) => by.get(hourStart - (48 - i) * 3_600_000) ?? 0);
  const current = hours[hours.length - 1];
  const b = isBurst(current, hours.slice(0, -1));
  if (!b.burst) return [];
  const cond = between("created_at", iso(hourStart - 3_600_000), iso(hourStart));
  return [
    {
      kind: "alert_storm",
      table: def.key,
      subject: iso(hourStart - 3_600_000).slice(0, 13),
      severity: b.z >= 10 ? "critical" : "warning",
      score: 150 + b.z,
      title: `طوفان ${def.plural}: ${faDigits(current)} در یک ساعت`,
      numbers: { last_hour: current, baseline: b.baseline, z: b.z },
      drivers: [],
      driver_field: null,
      scope: { table: def.key, cond },
      fields: ["created_at"],
      refs: [],
      narrative: `در ساعت گذشته ${faDigits(current)} ${def.label} ثبت شد؛ میانهٔ ۴۸ ساعت پیش ${faDigits(b.baseline)} در ساعت بود.`,
    },
  ];
}

/** Every insight of a period, as the system (numbers by the engine's aggregates). */
export async function computeInsights(sys: Ctx, p: Period): Promise<InsightDraft[]> {
  const schema = await orgSchema(sys);
  const out: InsightDraft[] = [];
  for (const t of TABLES.values()) {
    const def = schema.def(t.key);
    if (!def || def.virtual || def.module === "ai" || def.module === "analytics") continue;
    if (def.extends === "task") {
      out.push(...(await volumeInsights(sys, def, p)), ...(await backlogInsight(sys, def, p)), ...(await resolutionInsight(sys, def, p)), ...(await reopenInsight(sys, def, p)), ...(await slaInsight(sys, def, p)));
      if (def.key === "change_request") out.push(...(await changeInsight(sys, def, p)));
      out.push(...(await fulfilmentInsight(sys, def, p)));
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Alert storms of the completed hours ending at `ends` (hour boundaries), for the event tables — the hourly check of
 * the insights' tick (every hour is examined once; a card is keyed by its table and hour).
 */
export async function stormInsights(sys: Ctx, ends: readonly number[]): Promise<InsightDraft[]> {
  const schema = await orgSchema(sys);
  const out: InsightDraft[] = [];
  for (const key of STORM_TABLES) {
    const def = schema.def(key);
    if (!def || def.virtual) continue;
    for (const end of ends) out.push(...(await alertStorm(sys, def, end)));
  }
  return out;
}
