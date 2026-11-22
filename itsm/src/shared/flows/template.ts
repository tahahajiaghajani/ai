// Data pills: `{{trigger.record.priority}}`, `{{steps.<id>.output.x}}`, `{{vars.x}}`, `{{item.x}}` and the clock
// (`{{now}}`, `{{today + 3d}}`, `{{jalali.month_name}}`) inside a node's settings. A value that is exactly one pill
// keeps its type (a number stays a number, an array an array); pills inside longer text are written out as text.
// Paths are those of `pickPath` (src/shared/json-path.ts): keys, `items[0]`, `items[name=cpu]`. A pill that names
// nothing gives an empty value — rendering never throws. Pure: the executor, the scheduler and the designer use it.
// A text people read (a note, a notice, an approval's title — never a value a step stores or compares) writes each
// pill as its display text (`renderText` with `show`): the clock as a Jalali date, a record's field as the text its
// `$labels` carry (`pillText`), and what a run kind knows of its own data (a workflow's case values).
import { pickPath } from "../json-path";
import { JALALI_MONTHS, WEEKDAYS, formatJalali, formatJalaliDateTime, toJalali } from "../jalali";
import { faDigits } from "../format";
import { localDate } from "../model/jalali-buckets";
import { DEFAULT_TIMEZONE } from "../constants";

/** The data a run carries: what the pills read. */
export interface FlowData {
  trigger?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  steps?: Record<string, { output?: unknown; error?: string | null; status?: string }>;
  /** the current item of the innermost «برای هر مورد» */
  item?: unknown;
  item_index?: number;
  run?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface RenderEnv {
  /** the reference instant (default now) */
  now?: number;
  /** the organisation's time zone (dates of «امروز», Jalali parts) */
  tz?: string;
}

/** Roots a pill may start with. */
export const PILL_ROOTS = ["trigger", "vars", "steps", "item", "item_index", "run", "now", "today", "jalali"] as const;

const PILL = /\{\{\s*([^{}]+?)\s*\}\}/g;
const EXACT = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
const CLOCK = /^(now|today)(?:\s*([+-])\s*(\d{1,6})\s*(m|min|h|d|w)\s*)?$/;

const UNIT_MS: Record<string, number> = { m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 };

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The value of one pill expression (without the braces). */
export function pillValue(expr: string, data: FlowData, env: RenderEnv = {}): unknown {
  const e = expr.trim();
  const now = env.now ?? Date.now();
  const tz = env.tz || DEFAULT_TIMEZONE;
  const clock = CLOCK.exec(e);
  if (clock) {
    const sign = clock[2] === "-" ? -1 : 1;
    const n = clock[3] ? Number(clock[3]) * sign : 0;
    const unit = clock[4] ?? "d";
    if (clock[1] === "now") return new Date(now + n * UNIT_MS[unit]).toISOString();
    const today = localDate(now, tz);
    if (!n) return today;
    // a date moves by whole days; minutes and hours move the instant and take its date
    if (unit === "d" || unit === "w") return addDaysIso(today, n * (unit === "w" ? 7 : 1));
    return localDate(now + n * UNIT_MS[unit], tz);
  }
  if (e === "jalali" || e.startsWith("jalali.")) {
    const iso = localDate(now, tz);
    const j = toJalali(iso);
    const wd = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7;
    const parts: Record<string, unknown> = {
      year: j.jy,
      month: j.jm,
      day: j.jd,
      month_name: JALALI_MONTHS[j.jm - 1],
      weekday: WEEKDAYS[wd],
      date: `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`,
    };
    return e === "jalali" ? parts.date : parts[e.slice(7)];
  }
  return pickPath(data, e);
}

/** A value written into text: empty for nothing, lists joined with «، », objects as JSON. */
export function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return v.map(stringify).join("، ");
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Fill the pills of a setting. Strings that are exactly one pill keep the pill's value; other strings get the
 * pills written out; arrays and objects are filled recursively (keys stay as they are).
 */
export function renderTemplate(value: unknown, data: FlowData, env: RenderEnv = {}, depth = 0): unknown {
  if (depth > 20) return value;
  if (typeof value === "string") {
    const exact = EXACT.exec(value);
    if (exact) return pillValue(exact[1], data, env);
    if (!value.includes("{{")) return value;
    return value.replace(PILL, (_, expr: string) => stringify(pillValue(expr, data, env)));
  }
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, data, env, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderTemplate(v, data, env, depth + 1);
    return out;
  }
  return value;
}

/**
 * How a pill is written into a text people read: its display text, or null to write the stored value (`stringify`).
 * `expr` is the pill without its braces (trimmed), `value` what it names.
 */
export type PillText = (expr: string, value: unknown) => string | null | undefined;

/**
 * Fill the pills and always return text. With `show`, every pill of a string — one that is the whole string too — is
 * written as `show` gives it (null: its stored value); without it, as stored (ids, option keys, ISO dates).
 */
export function renderText(value: unknown, data: FlowData, env: RenderEnv = {}, show?: PillText): string {
  if (show && typeof value === "string") {
    if (!value.includes("{{")) return value;
    return value.replace(PILL, (_, expr: string) => {
      const v = pillValue(expr, data, env);
      return show(expr.trim(), v) ?? stringify(v);
    });
  }
  return stringify(renderTemplate(value, data, env));
}

const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The display text of a pill whose meaning the pill itself carries (null: none — its stored value is what people
 * read): the clock as a Jalali date (`{{today}}`) or date and time in the organisation's time zone (`{{now + 2h}}`),
 * the Jalali parts with Persian digits, and a record's field as the text the record's `$labels` give it
 * (`{{trigger.record.priority}}` → «۱ — بحرانی», read as the run's identity when the record was read).
 */
export function pillText(expr: string, value: unknown, data: FlowData, env: RenderEnv = {}): string | null {
  const e = expr.trim();
  const clock = CLOCK.exec(e);
  if (clock) {
    if (typeof value !== "string" || !value) return null;
    return clock[1] === "now" ? formatJalaliDateTime(value, env.tz || DEFAULT_TIMEZONE) || null : formatJalali(value) || null;
  }
  if (e === "jalali" || e.startsWith("jalali.")) return value === null || value === undefined || typeof value === "object" ? null : faDigits(String(value));
  const dot = e.lastIndexOf(".");
  const key = dot > 0 ? e.slice(dot + 1) : "";
  if (!FIELD_KEY.test(key)) return null;
  const record = pickPath(data, e.slice(0, dot));
  const labels = record && typeof record === "object" && !Array.isArray(record) ? (record as { $labels?: unknown }).$labels : null;
  const text = labels && typeof labels === "object" && !Array.isArray(labels) ? (labels as Record<string, unknown>)[key] : undefined;
  return typeof text === "string" ? text : null;
}

/** The pill expressions used anywhere in a setting (for validation and the designer). */
export function pillsOf(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 20) return out;
  if (typeof value === "string") {
    for (const m of value.matchAll(PILL)) out.push(m[1].trim());
  } else if (Array.isArray(value)) {
    for (const v of value) pillsOf(v, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) pillsOf(v, out, depth + 1);
  }
  return out;
}

/** The root of a pill expression ("steps", "trigger"…) and, for steps, the node id it reads. */
export function pillRoot(expr: string): { root: string; step?: string } {
  const e = expr.trim();
  const clock = CLOCK.exec(e);
  if (clock) return { root: clock[1] };
  const m = /^([a-z_]+)(?:\.([A-Za-z0-9_-]+))?/.exec(e);
  if (!m) return { root: "" };
  return m[1] === "steps" ? { root: "steps", step: m[2] } : { root: m[1] };
}

/**
 * A JSON body with pills: `{"priority": {{trigger.record.priority}}, "title": "{{trigger.record.short_description}}"}`.
 * Bare pills (outside strings) become exact pills so they keep their type, the result is parsed and filled, and
 * written back as JSON. Text that is not JSON is filled as text (`json: false`).
 */
export function renderBody(text: string, data: FlowData, env: RenderEnv = {}): { json: boolean; text: string } {
  const src = String(text ?? "").trim();
  if (!src) return { json: false, text: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(quoteBarePills(src));
  } catch {
    return { json: false, text: renderText(src, data, env) };
  }
  return { json: true, text: JSON.stringify(renderTemplate(parsed, data, env)) };
}

/** `{{x}}` outside JSON strings → `"{{x}}"` (so the text parses and the pill keeps its type when filled). */
export function quoteBarePills(src: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i++;
      } else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === "{" && src[i + 1] === "{") {
      const end = src.indexOf("}}", i + 2);
      if (end > 0) {
        out += JSON.stringify(src.slice(i, end + 2));
        i = end + 1;
        continue;
      }
    }
    out += c;
  }
  return out;
}

const DIGITS: Record<string, string> = { "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9", "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d]).replace(/[٬,]/g, "").replace("٫", ".").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const isEmptyData = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length);

const norm = (v: unknown) => stringify(v).toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌‏‎]/g, "").trim();

/** One comparison of the data mode of «شرط»: numbers compare as numbers, everything else as text. */
export function compareData(left: unknown, op: string, right: unknown): boolean {
  switch (op) {
    case "empty":
      return isEmptyData(left);
    case "nempty":
      return !isEmptyData(left);
    case "contains":
    case "ncontains": {
      const has = Array.isArray(left) ? left.some((x) => norm(x) === norm(right)) : norm(left).includes(norm(right));
      return op === "contains" ? has : !has;
    }
  }
  const a = asNumber(left);
  const b = asNumber(right);
  const numeric = a !== null && b !== null;
  const cmp = numeric ? a - b : norm(left) < norm(right) ? -1 : norm(left) > norm(right) ? 1 : 0;
  switch (op) {
    case "eq":
      return numeric ? cmp === 0 : stringify(left) === stringify(right);
    case "ne":
      return numeric ? cmp !== 0 : stringify(left) !== stringify(right);
    case "gt":
      return !isEmptyData(left) && cmp > 0;
    case "gte":
      return !isEmptyData(left) && cmp >= 0;
    case "lt":
      return !isEmptyData(left) && cmp < 0;
    case "lte":
      return !isEmptyData(left) && cmp <= 0;
    default:
      return false;
  }
}
