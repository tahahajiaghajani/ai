// Helpers shared by the assistant's tools: the organisation's "today", Persian formatting, record links,
// bounded lists, personal-data masking, the period input, permission checks and Persian-aware search.
// Modules register the in-app path of their record types with `registerRecordPath`, so a tool's reference
// opens the right page.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { Area, Level } from "@shared/permissions";
import type { AiRef } from "@shared/ai/types";
import { DEFAULT_TIMEZONE, MODULES, type ModuleKey } from "@shared/constants";
import { bad, forbidden } from "../../../http/errors";
import { D, isNumeric, normalizeDigits, type Num } from "@shared/money";
import { formatNumber } from "@shared/format";
import { formatJalali, todayISO } from "@shared/jalali";
import { PERIOD_PRESETS, PeriodError, resolvePeriod, type PeriodInput, type PeriodPreset, type ResolvedPeriod } from "../analytics/period";
import type { ToolRuntime } from "./registry";

// ---------------------------------------------------------------- the organisation's calendar

export function orgTimezone(ctx: Ctx): string {
  return (ctx.org.settings?.timezone as string) || DEFAULT_TIMEZONE;
}

/** Today in the organisation's time zone (ISO). */
export function orgToday(ctx: Ctx): string {
  return todayISO(orgTimezone(ctx));
}

// ---------------------------------------------------------------- formatting

export function fmtCount(v: Num): string {
  return formatNumber(v, { dp: 3 });
}

export function fmtPct(v: Num, dp = 1): string {
  return `${formatNumber(v, { dp, sign: true })}٪`;
}

/** «۱۴۰۵/۰۸/۱۱» or null. */
export function jd(iso: string | null | undefined): string | null {
  return iso ? formatJalali(String(iso).slice(0, 10)) : null;
}

/** Percent change from `prev` to `cur` (2 decimals) or null when `prev` is zero. */
export function changePct(cur: Num, prev: Num): string | null {
  const p = D(prev);
  if (p.isZero()) return null;
  return D(cur).minus(p).div(p.abs()).times(100).toDecimalPlaces(2).toString();
}

// ---------------------------------------------------------------- records

type PathOf = (id: string, extra: Record<string, string | null | undefined>) => string | undefined;

/** In-app paths (without the org prefix) of record types, by type. Modules add theirs. */
const RECORD_PATHS = new Map<string, PathOf>([
  ["member", () => "settings/users"],
  ["org", () => "settings/org"],
]);

export function registerRecordPath(type: string, path: PathOf): void {
  RECORD_PATHS.set(type, path);
}

/** In-app path (without the org prefix) of a record. */
export function pathOf(type: string, id: string, extra: Record<string, string | null | undefined> = {}): string | undefined {
  return RECORD_PATHS.get(type)?.(id, extra);
}

export function ref(type: string, id: string, label: string, extra: Record<string, string | null | undefined> = {}): AiRef {
  return { type, id, label, path: pathOf(type, id, extra) };
}

/** A report page as a reference (opens the report, not a record). */
export function reportRef(key: string, label: string, path: string): AiRef {
  return { type: "report", id: key, label, path };
}

/** Keep the first `n` rows; tell how many there were. */
export function bounded<T>(rows: T[], n: number): { rows: T[]; total_rows: number; truncated: boolean } {
  return { rows: rows.slice(0, n), total_rows: rows.length, truncated: rows.length > n };
}

// ---------------------------------------------------------------- personal data

/** Mask a personal identifier (e-mail, mobile, national id, card) unless the policy is "full". */
export function maskId(value: string | null | undefined, rt: Pick<ToolRuntime, "dataPolicy">): string | null {
  if (!value) return null;
  if (rt.dataPolicy === "full") return value;
  const s = String(value);
  if (s.length <= 4) return "••••";
  return `${"•".repeat(Math.min(8, s.length - 4))}${s.slice(-4)}`;
}

/** A person's name, or only a neutral label under the "aggregates" policy. */
export function personName(name: string | null | undefined, n: number, rt: Pick<ToolRuntime, "dataPolicy">): string {
  if (rt.dataPolicy === "aggregates") return `شخص ${formatNumber(n)}`;
  return name || "—";
}

// ---------------------------------------------------------------- inputs

export const periodInput = z
  .object({
    preset: z.enum(PERIOD_PRESETS).nullish().describe("Jalali calendar preset resolved on the server (weeks start on Saturday; quarters are Jalali seasons)."),
    from: z.string().max(24).nullish().describe("Start date, Jalali «1405/08/01» or ISO «2026-10-23». Ignored when preset is given."),
    to: z.string().max(24).nullish().describe("End date (inclusive), Jalali or ISO. Ignored when preset is given."),
  })
  .describe("Period. Give a preset OR from/to. The resolved Jalali range is echoed back; quote it in the answer.");

export type PeriodArg = z.infer<typeof periodInput>;

/** Resolve the model's period argument (Persian error on a bad date). */
export function period(input: PeriodArg | null | undefined, today: string, def: PeriodPreset): ResolvedPeriod {
  try {
    return resolvePeriod((input ?? null) as PeriodInput | null, today, { def });
  } catch (e) {
    if (e instanceof PeriodError) throw bad(e.message);
    throw e;
  }
}

/** Decimal string of a number-like input or a Persian error. */
export function dec(v: Num, label: string, opts: { positive?: boolean; min0?: boolean } = {}): string {
  if (!isNumeric(v)) throw bad(`«${label}» باید عدد باشد`);
  const d = D(v);
  if (opts.positive && d.lte(0)) throw bad(`«${label}» باید بیشتر از صفر باشد`);
  if (opts.min0 && d.lt(0)) throw bad(`«${label}» نمی‌تواند منفی باشد`);
  return d.toString();
}

// ---------------------------------------------------------------- permissions

export function needAll(ctx: Ctx, pairs: [Area, Level][]) {
  for (const [a, l] of pairs) ctx.need(a, l);
}

export function canAny(ctx: Ctx, pairs: [Area, Level][]) {
  return pairs.some(([a, l]) => ctx.can(a, l));
}

export function needAny(ctx: Ctx, pairs: [Area, Level][]) {
  if (!canAny(ctx, pairs)) throw forbidden();
}

export function needModule(ctx: Ctx, m: ModuleKey) {
  const title = MODULES.find((x) => x.key === m)?.title ?? m;
  if (!ctx.hasModule(m)) throw forbidden(`بخش «${title}» برای این سازمان فعال نیست`);
}

// ---------------------------------------------------------------- Persian-aware search

/** SQL expression of a text column normalised for Persian search (ي/ك, ZWNJ, case). */
export function faSql(col: string): string {
  // the same as faNorm: Arabic letters, Persian/Arabic digits → Latin, no ZWNJ/LRM/RLM
  return `lower(translate(coalesce(${col}, ''), 'يكۀة۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩' || chr(8204) || chr(8206) || chr(8207), 'یکهه01234567890123456789'))`;
}

/** The same normalisation in JavaScript, for the search pattern. */
export function faNorm(s: string): string {
  return normalizeDigits(s)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/[‌‏‎]/g, "")
    .trim()
    .toLowerCase();
}

export function likePattern(s: string): string {
  return `%${faNorm(s).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
