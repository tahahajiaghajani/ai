// Performance indicators (catalogue ANA-001/003/005/046): Jalali periods of a score, the status of a value against
// its target and thresholds, the change against the previous period, Persian formatting of every unit, and the
// validation of an indicator's parts and formula. Pure: the server's collector and the scorecard use the same rules.
import type { Cond, Lookup } from "../model/conditions";
import { isNever, resolvePath, validateCond } from "../model/conditions";
import type { TableDef } from "../model/types";
import { addUnits, bucketKey, bucketLabel, DATE_UNITS, localDate, unitStart, zonedMidnight, type DateUnit } from "../model/jalali-buckets";
import { formatJalali } from "../jalali";
import { faDigits, formatNumber } from "../format";
import { formulaProblem } from "./formula";
import { measureProblem, MEASURES } from "./model";
import type { Direction, IndicatorDef, IndicatorPart, KpiStatus, MeasureUnit, PeriodInfo } from "./types";

export const PERIOD_START = "$start";
export const PERIOD_END = "$end";

/** The period of `grain` containing `now` in `tz` (shift > 0 later, < 0 earlier). */
export function periodOf(grain: DateUnit, now: number, tz: string, shift = 0): PeriodInfo {
  const start = addUnits(unitStart(localDate(now, tz), grain), grain, shift);
  return { key: bucketKey(start, grain), label: bucketLabel(start, grain), start, end: addUnits(start, grain, 1) };
}

/** The last `n` periods ending with the current one (oldest first). */
export function periodsBack(grain: DateUnit, now: number, tz: string, n: number): PeriodInfo[] {
  const out: PeriodInfo[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(periodOf(grain, now, tz, -i));
  return out;
}

/** The period instants (ISO) of a period's dates in `tz`. */
export function periodInstants(p: Pick<PeriodInfo, "start" | "end">, tz: string): { start: string; end: string } {
  return { start: new Date(zonedMidnight(p.start, tz)).toISOString(), end: new Date(zonedMidnight(p.end, tz)).toISOString() };
}

/** Replace the placeholders "$start"/"$end" of a condition with instants. */
export function bindPeriod(cond: Cond | null | undefined, bounds: { start: string; end: string }): Cond | null {
  if (!cond) return null;
  const sub = (v: unknown): unknown => (v === PERIOD_START ? bounds.start : v === PERIOD_END ? bounds.end : Array.isArray(v) ? v.map(sub) : v);
  const walk = (c: Cond): Cond => {
    if ("and" in c) return { and: c.and.map(walk) };
    if ("or" in c) return { or: c.or.map(walk) };
    if ("not" in c) return { not: walk(c.not) };
    return "v" in c ? { ...c, v: sub(c.v) } : { ...c };
  };
  return walk(cond);
}

/** Does a condition name the period placeholders? */
export function hasPeriod(cond: Cond | null | undefined): boolean {
  if (!cond) return false;
  return JSON.stringify(cond).includes(`"${PERIOD_START}"`) || JSON.stringify(cond).includes(`"${PERIOD_END}"`);
}

/** The filter of a part for one period: its own (placeholders bound) and, with a date field, the period itself. */
export function partFilter(part: IndicatorPart, bounds: { start: string; end: string }): Cond | null {
  const own = bindPeriod(part.filter ?? null, bounds);
  if (hasPeriod(part.filter) || !part.date_field) return own;
  const period: Cond = { and: [{ f: part.date_field, op: "gte", v: bounds.start }, { f: part.date_field, op: "lt", v: bounds.end }] };
  return own ? { and: [own, period] } : period;
}

/** A part whose value moves with time (a date field, no placeholders) can be computed for many periods in one query. */
export const bucketable = (part: IndicatorPart) => !!part.date_field && !hasPeriod(part.filter);

// ----- status --------------------------------------------------------------------------------------------------------

/**
 * Green, amber or red: with direction «up» (higher is better) a value under `crit` is red, under `warn` amber;
 * with «down» a value over `crit` is red, over `warn` amber. With only a target, missing it is amber.
 */
export function kpiStatus(value: number | null | undefined, ind: Pick<IndicatorDef, "direction" | "target" | "warn" | "crit">): KpiStatus {
  if (value === null || value === undefined || !Number.isFinite(value) || ind.direction === "none") return "none";
  const worse = (a: number, b: number) => (ind.direction === "up" ? a < b : a > b);
  const crit = num(ind.crit);
  const warn = num(ind.warn);
  const target = num(ind.target);
  if (crit !== null && worse(value, crit)) return "bad";
  if (warn !== null && worse(value, warn)) return "warn";
  if (crit === null && warn === null && target !== null) return worse(value, target) ? "warn" : "good";
  if (crit === null && warn === null) return "none";
  return "good";
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Change against the previous value, percent (null when either is missing or the previous is zero). */
export function deltaPct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Is a change good news? (null when neutral) */
export function improved(delta: number | null, direction: Direction): boolean | null {
  if (delta === null || delta === 0 || direction === "none") return null;
  return direction === "up" ? delta > 0 : delta < 0;
}

export const STATUS_LABELS: Record<KpiStatus, string> = { good: "در هدف", warn: "نزدیک آستانه", bad: "خارج از آستانه", none: "بی‌هدف" };

// ----- formatting ----------------------------------------------------------------------------------------------------

export const UNITS: Record<MeasureUnit, string> = { count: "تعداد", number: "عدد", duration: "مدت", percent: "درصد", money: "مبلغ", date: "تاریخ" };

/** «۲ ساعت و ۳۰ دقیقه»، «۳ روز و ۴ ساعت»، «۴۵ ثانیه» — a duration in seconds for people. */
export function durationText(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  if (s < 60) return `${faDigits(s)} ثانیه`;
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${faDigits(d)} روز`);
  if (h) parts.push(`${faDigits(h)} ساعت`);
  if (m && !d) parts.push(`${faDigits(m)} دقیقه`);
  return `${seconds < 0 ? "−" : ""}${parts.join(" و ") || "۰ دقیقه"}`;
}

/** A value in its unit, in Persian: «۱٬۲۵۰»، «۸۷٫۵٪»، «۲ ساعت و ۳۰ دقیقه»، «۱۴۰۵/۰۸/۱۷». */
export function formatValue(v: number | string | null | undefined, unit: MeasureUnit, decimals?: number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  if (unit === "date") return formatJalali(String(v).slice(0, 10));
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const dp = decimals ?? (unit === "count" ? 0 : unit === "percent" ? 1 : 2);
  switch (unit) {
    case "duration":
      return durationText(n);
    case "percent":
      return `${formatNumber(n, { dp })}٪`;
    case "money":
      return formatNumber(n, { dp: decimals ?? 0 });
    default:
      return formatNumber(n, { dp });
  }
}

/** A compact value for axes and tiles (durations in hours or days). */
export function formatCompactValue(v: number | null | undefined, unit: MeasureUnit): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (unit === "duration") {
    const a = Math.abs(v);
    if (a < 3600) return `${formatNumber(v / 60, { dp: 0 })} دقیقه`;
    if (a < 86_400 * 2) return `${formatNumber(v / 3600, { dp: 1 })} ساعت`;
    return `${formatNumber(v / 86_400, { dp: 1 })} روز`;
  }
  if (unit === "percent") return `${formatNumber(v, { dp: 1 })}٪`;
  const a = Math.abs(v);
  if (a >= 1e6) return `${formatNumber(v / 1e6, { dp: 1 })} میلیون`;
  if (a >= 1e4) return `${formatNumber(v / 1e3, { dp: 1 })} هزار`;
  return formatNumber(v, { dp: unit === "count" ? 0 : 1 });
}

export const grainLabel = (g: DateUnit) => DATE_UNITS[g];

export const periodRangeLabel = (p: Pick<PeriodInfo, "start" | "end">) => `${formatJalali(p.start)} تا ${formatJalali(addUnits(p.end, "day", -1))}`;

// ----- validation ----------------------------------------------------------------------------------------------------

const NAME = /^[a-z][a-z0-9_]{0,30}$/;
const UNSAFE_PATH = /[^a-z0-9_.]/;

/** Why an indicator definition is not valid (Persian), or null. `lookup` resolves the parts' tables. */
export function indicatorProblem(ind: Pick<IndicatorDef, "formula" | "parts" | "breakdowns">, lookup: Lookup): string | null {
  const parts = Array.isArray(ind.parts) ? ind.parts : [];
  if (!parts.length) return "شاخص دست‌کم یک سنجه می‌خواهد";
  if (parts.length > 6) return "حداکثر شش سنجه";
  const names = new Set<string>();
  const tables = new Map<string, TableDef>();
  for (const p of parts) {
    if (!p || typeof p !== "object") return "سنجهٔ شاخص معتبر نیست";
    if (!NAME.test(String(p.name ?? ""))) return `نام سنجهٔ «${String(p.name ?? "")}» باید با حرف لاتین کوچک شروع شود (a-z، رقم، _)`;
    if (names.has(p.name)) return `نام «${p.name}» تکراری است`;
    names.add(p.name);
    const def = lookup(String(p.table ?? ""));
    if (!def || def.virtual) return `جدول «${String(p.table ?? "")}» در این سازمان نیست`;
    if (isNever(def.rowAccess?.read)) return `از «${def.plural}» شاخص ساخته نمی‌شود`;
    tables.set(def.key, def);
    if (!MEASURES[p.fn]) return `سنجهٔ «${String(p.fn)}» شناخته نیست`;
    const resolve = (path: unknown) => (typeof path === "string" && path && !UNSAFE_PATH.test(path) ? resolvePath(def, path, lookup) : null);
    const f = p.field ? resolve(p.field) : null;
    if (p.field && !f) return `فیلد «${p.field}» در «${def.label}» نیست`;
    const from = p.from ? resolve(p.from) : null;
    if (p.from && !from) return `فیلد «${p.from}» در «${def.label}» نیست`;
    const mp = measureProblem({ fn: p.fn, field: p.field, from: p.from, filter: p.filter }, f?.field ?? null, from?.field ?? null);
    if (mp) return `${p.name}: ${mp}`;
    if (p.date_field) {
      const d = resolve(p.date_field);
      if (!d || (d.field.type !== "date" && d.field.type !== "datetime")) return `${p.name}: فیلد دوره باید تاریخ باشد`;
    }
    if (p.filter) {
      // the placeholders stand for instants: check the condition with a sample period
      const c = validateCond(bindPeriod(p.filter, { start: "2026-03-21T00:00:00.000Z", end: "2026-04-21T00:00:00.000Z" }), def, { lookup });
      if (c) return `${p.name}: ${c}`;
    }
  }
  const fp = formulaProblem(ind.formula, [...names]);
  if (fp) return fp;
  for (const b of ind.breakdowns ?? []) {
    if (typeof b !== "string" || UNSAFE_PATH.test(b)) return "بُعد تفکیک معتبر نیست";
    for (const def of tables.values()) if (!resolvePath(def, b, lookup)) return `بُعد «${b}» در «${def.label}» نیست؛ تفکیک فقط با فیلدی ممکن است که همهٔ سنجه‌ها دارند`;
  }
  if ((ind.breakdowns ?? []).length > 3) return "حداکثر سه بُعد تفکیک";
  return null;
}
