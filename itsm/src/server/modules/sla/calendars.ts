// Working calendars and holidays (docs/spec/services/sla.md §2): the arithmetic-ready calendars of an organisation,
// the holidays the UI shades, the checks on calendar and holiday rows, and the defaults a new organisation gets — two
// calendars («ساعات اداری» Saturday–Wednesday 08–16 and Thursday 08–12 with the Iranian official holidays,
// «شبانه‌روزی» 24 × 7) and the official holidays of the bundled years (1404–1406, holidays-ir.ts). Seeding runs as a
// job a few minutes after the organisation is created (sign-up stays fast) and on demand from «تقویم‌های کاری»; it
// is idempotent per Jalali year and never re-adds a year the organisation already has (or deliberately deleted).
import { calendarOf, DEFAULT_HOURS, FULL_HOURS, hoursProblem, type BusinessCalendar } from "@shared/sla/calendar";
import { toJalali } from "@shared/jalali";
import { DEFAULT_TIMEZONE, isTimeZone } from "@shared/constants";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { createIn, orgTz, registerHooks, systemCtx, updateIn, validationError } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { config, derived, systemFrom, type Row, type ServiceConfig } from "./common";
import { IR_HOLIDAYS, IR_HOLIDAY_YEARS } from "./holidays-ir";

/** Every active calendar of the organisation, ready for arithmetic (by id), and the default one's id. */
export function calendarsOf(cfg: ServiceConfig, fallbackTz: string): { byId: Map<string, BusinessCalendar>; defaultId: string | null } {
  return derived(cfg, `calendars:${fallbackTz}`, () => {
    const bySet = new Map<string, Row[]>();
    for (const h of cfg.rows.holiday) {
      if (h.active === false) continue;
      const set = String(h.holiday_set ?? "");
      bySet.set(set, [...(bySet.get(set) ?? []), h]);
    }
    const byId = new Map<string, BusinessCalendar>();
    let defaultId: string | null = null;
    for (const c of cfg.rows.calendar) {
      if (c.active === false) continue;
      const sets: string[] = Array.isArray(c.holiday_sets) ? c.holiday_sets : [];
      const holidays = sets.flatMap((s) => bySet.get(s) ?? []).map((h) => ({ date: String(h.date), half_day: !!h.half_day, title: h.title }));
      byId.set(c.id, calendarOf({ timezone: c.timezone, hours: c.hours }, holidays, fallbackTz));
      if (c.is_default && !defaultId) defaultId = c.id;
    }
    return { byId, defaultId };
  });
}

/** The calendar `id` of the organisation (null: none or inactive), in another zone when `tz` is given. */
export async function calendarFor(q: Queryable, ctx: Ctx, id: string | null | undefined, tz?: string | null): Promise<BusinessCalendar | null> {
  if (!id) return null;
  const cfg = await config(q, ctx);
  const cal = calendarsOf(cfg, orgTz(ctx)).byId.get(id) ?? null;
  if (!cal || !tz || tz === cal.tz || !isTimeZone(tz)) return cal;
  return { ...cal, tz };
}

/** Holidays of the calendar `calendarId` (default: the organisation's default calendar) between two ISO dates. */
export async function holidaysBetween(q: Queryable, ctx: Ctx, from: string, to: string, calendarId?: string | null): Promise<{ date: string; title: string; half?: boolean; predicted?: boolean }[]> {
  const cfg = await config(q, ctx);
  const cals = calendarsOf(cfg, orgTz(ctx));
  const id = calendarId || cals.defaultId;
  const cal = cfg.rows.calendar.find((c) => c.id === id && c.active !== false);
  const sets = new Set<string>(cal ? (Array.isArray(cal.holiday_sets) ? cal.holiday_sets : []) : ["ir"]);
  const out: { date: string; title: string; half?: boolean; predicted?: boolean }[] = [];
  for (const h of cfg.rows.holiday) {
    const d = String(h.date);
    if (h.active === false || !sets.has(String(h.holiday_set)) || d < from || d > to) continue;
    out.push({ date: d, title: String(h.title ?? ""), ...(h.half_day ? { half: true } : {}), ...(h.predicted ? { predicted: true } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Checks on calendar and holiday rows

/** The checks on calendar and holiday rows (installed once by `installSlaService`). */
export function installCalendarHooks(): (() => void)[] {
  return [
    registerHooks("calendar", {
  beforeWrite(w) {
    if (w.op === "delete") return;
    const fields: Record<string, string> = {};
    if (w.changed.has("hours") || w.op === "create") {
      const p = hoursProblem(w.next.hours);
      if (p) fields.hours = p;
    }
    if ((w.changed.has("timezone") || w.op === "create") && !isTimeZone(String(w.next.timezone ?? ""))) fields.timezone = `منطقهٔ زمانی «${String(w.next.timezone ?? "")}» شناخته نیست (مانند Asia/Tehran)`;
    if (Object.keys(fields).length) throw validationError(fields);
  },
  async afterWrite(w) {
    // one default calendar per organisation
    if (w.op === "delete" || !w.row.is_default || !w.changed.has("is_default")) return;
    const sys = systemFrom(w.ctx);
    const others = await w.tx.query<{ id: string }>(`select id from sm_calendars where org_id = $1 and is_default and id <> $2 and deleted_at is null`, [w.ctx.org.id, w.row.id]);
    for (const o of others) await updateIn(w.tx, sys, "calendar", o.id, { is_default: false }, { trusted: true });
  },
    }),
    registerHooks("holiday", {
      beforeWrite(w) {
        if (w.op === "delete") return;
        const date = String(w.next.date ?? "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) w.next.year = toJalali(date).jy;
        if (w.next.alternative_date && w.next.alternative_date === date) w.next.alternative_date = null;
      },
    }),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// Defaults of a new organisation

export interface SeedResult {
  calendars: number;
  holidays: number;
  years: number[];
}

/**
 * Create the default calendars (when the organisation has never had one) and the bundled official holidays of every
 * Jalali year the set «ir» has no rows for (live or deleted). Runs inside `tx` as the system.
 */
export async function seedCalendarsIn(tx: Tx, ctx: Ctx, opts: { years?: number[] } = {}): Promise<SeedResult> {
  const sys = systemFrom(ctx);
  const out: SeedResult = { calendars: 0, holidays: 0, years: [] };
  const anyCalendar = await tx.one(`select 1 from sm_calendars where org_id = $1 limit 1`, [ctx.org.id]);
  if (!anyCalendar) {
    const tz = orgTz(ctx) || DEFAULT_TIMEZONE;
    await createIn(tx, sys, "calendar", { name: "ساعات اداری", timezone: tz, hours: DEFAULT_HOURS, holiday_sets: ["ir"], is_default: true, description: "شنبه تا چهارشنبه ۸ تا ۱۶، پنجشنبه ۸ تا ۱۲؛ جمعه و تعطیلات رسمی ایران تعطیل" }, { trusted: true });
    await createIn(tx, sys, "calendar", { name: "شبانه‌روزی", timezone: tz, hours: FULL_HOURS, holiday_sets: [], description: "همهٔ ساعت‌های همهٔ روزها، بدون تعطیلی" }, { trusted: true });
    out.calendars = 2;
  }
  // a year once seeded is never seeded again (its rows may have been edited or deleted on purpose); a date the set
  // already has (added by hand) is left alone
  const bundled = await tx.query<{ year: number }>(`select distinct year from sm_holidays where org_id = $1 and holiday_set = 'ir' and source = 'bundled' and year is not null`, [ctx.org.id]);
  const seen = new Set(bundled.map((r) => Number(r.year)));
  const taken = new Set((await tx.query<{ date: string }>(`select date::text as date from sm_holidays where org_id = $1 and holiday_set = 'ir' and deleted_at is null`, [ctx.org.id])).map((r) => r.date));
  for (const year of opts.years ?? IR_HOLIDAY_YEARS) {
    if (seen.has(year) || !IR_HOLIDAYS[year]) continue;
    for (const h of IR_HOLIDAYS[year]) {
      if (taken.has(h.gregorian)) continue;
      await createIn(tx, sys, "holiday", {
        date: h.gregorian,
        title: h.title,
        holiday_set: "ir",
        kind: h.kind,
        predicted: !!h.predicted,
        alternative_date: h.alternative?.gregorian ?? null,
        hijri: h.hijri ?? null,
        note: h.note ?? null,
        source: "bundled",
        half_day: false,
      }, { trusted: true });
      out.holidays++;
    }
    out.years.push(year);
  }
  return out;
}

/** The seed of one organisation as the system (job, or «افزودن تعطیلات رسمی» on a request). */
export async function seedCalendars(cfg: JobConfig, orgId: string, opts: { years?: number[] } = {}): Promise<SeedResult> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedCalendarsIn(tx, sys, opts));
}

/** Delay of the automatic seed after an organisation is created. */
export const SEED_DELAY_MS = 10 * 60_000;

/** Queue the seed of a new organisation (called from `seedOrg`, inside the creating transaction). */
export async function queueSeed(q: Queryable, orgId: string): Promise<void> {
  await enqueue(q, { kind: "sla.seed", orgId, delayMs: SEED_DELAY_MS, dedupeKey: "sla.seed", maxAttempts: 5 });
}

/** The seed job's handler (installed once by `installSlaService`). */
export function installCalendarJobs(): () => void {
  return registerJobHandler("sla.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedCalendars(jctx.cfg, job.org_id);
  });
}
