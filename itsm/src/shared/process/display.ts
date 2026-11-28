// How a workflow shows a stored value to a person (release 1.1.5): one rule for every text a person reads — the case
// title, «تعیین مقدار» into a text field, the subject and body of «اعلان», the printable view — and the one the record
// screens use: people, units, groups, organisational roles and locations by name, a record by its number, options by
// label, dates in Jalali (a date and time in the organisation's time zone) with Persian digits, numbers grouped with
// Persian digits, amounts in the field's or the organisation's unit, «بله»/«خیر», durations in words, files by name.
// What a step stores into a value that is not text keeps the stored value (a unit field from `{{case.u_branch}}` takes
// the unit's id), and every comparison («شرط»، «انتخاب») compares stored values: neither goes through here.
// Names come from the caller (`DisplayEnv.names`, ids in lower case); a value it cannot name shows nothing rather than
// its id. Imported by the UI: keep it free of server imports.
import type { FieldDef } from "../model/types";
import { FIELD_TYPES } from "../model/types";
import { formatJalali, formatJalaliDateTime } from "../jalali";
import { faDigits, formatNumber } from "../format";
import { formatFieldMoney } from "../forms/fieldtypes";
import { attachmentIds } from "../forms/validators";
import type { MoneyUnit } from "../financial/logic";
import { CASE_ROOT } from "./graph";

export interface DisplayEnv {
  /** names by id (lower case): people, groups, units, roles, locations, files; a record by its number */
  names: ReadonlyMap<string, string>;
  /** the organisation's time zone (date-times) */
  tz: string;
  /** the organisation's money unit (a field's own unit wins; default Rials) */
  money?: MoneyUnit;
}

/** The case keys beside its values that hold people and the unit (CASE_META_KEYS). */
const META_PEOPLE = new Set(["requested_by", "requested_for", "unit_id"]);

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const nameOf = (env: DisplayEnv, id: unknown): string | null => (typeof id === "string" ? env.names.get(id.toLowerCase()) ?? null : null);

/** Names of `ids` joined with «، », leaving out what cannot be named (null: none could). */
function namesText(env: DisplayEnv, ids: unknown): string | null {
  const named = list(ids).map((x) => nameOf(env, x)).filter((x): x is string => !!x);
  return named.length ? named.join("، ") : null;
}

/** Seconds as people read them: «۲ ساعت و ۳۰ دقیقه» (the record screens' rule). */
export function durationText(seconds: unknown): string {
  const n = Number(seconds);
  if (seconds === null || seconds === undefined || seconds === "" || !Number.isFinite(n)) return "";
  const s = Math.round(Math.abs(n));
  if (s === 0) return "۰";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${faDigits(d)} روز`);
  if (h) parts.push(`${faDigits(h)} ساعت`);
  if (m) parts.push(`${faDigits(m)} دقیقه`);
  if (!parts.length) parts.push(`${faDigits(s)} ثانیه`);
  return `${n < 0 ? "−" : ""}${parts.slice(0, 2).join(" و ")}`;
}

/** A number as people read it: Persian digits, grouped; a percent with «٪» (the record screens' rule). */
function numberText(f: Pick<FieldDef, "type">, v: unknown): string {
  if (f.type === "duration") return durationText(v);
  try {
    if (f.type === "percent") return `${formatNumber(String(v), { dp: 3 })}٪`;
    if (f.type === "int" || f.type === "rating") return formatNumber(String(v), { dp: 0 });
    return formatNumber(String(v), { dp: 8 });
  } catch {
    return faDigits(String(v));
  }
}

/** The label of option `v` of a choice field (the value itself when the field no longer offers it). */
function optionText(f: FieldDef, v: unknown): string {
  const options = Array.isArray(f.choices) ? f.choices : [];
  return options.find((o) => o.value === v)?.label ?? String(v);
}

/**
 * A stored value as one line of text for a person (null: nothing to show). `f` is the value's field — in a case, the
 * version's snapshot of it; without one (a field the version no longer has) a scalar shows as stored.
 */
export function valueText(f: FieldDef | undefined, v: unknown, env: DisplayEnv): string | null {
  if (isEmpty(v)) return null;
  if (!f) return typeof v === "object" ? null : String(v);
  if (f.check === "attachments") {
    const ids = attachmentIds(f, v).ids ?? [];
    return ids.length ? ids.map((id) => nameOf(env, id) ?? "پیوست").join("، ") : null;
  }
  const t = f.type;
  if (t === "money") return formatFieldMoney(f, v, env.money ?? "rial");
  if (t === "bool") return v === true || v === "true" ? "بله" : "خیر";
  if (t === "date") return formatJalali(String(v)) || String(v);
  if (t === "datetime") return formatJalaliDateTime(String(v), env.tz) || String(v);
  if (FIELD_TYPES[t]?.numeric) return numberText(f, v);
  if (t === "choice") return optionText(f, v);
  if (t === "multichoice") return list(v).map((x) => optionText(f, x)).join("، ");
  if (t === "tags") return list(v).map(String).join("، ");
  if (FIELD_TYPES[t]?.family === "ref") return namesText(env, v);
  if (t === "secret" || t === "json" || t === "conditions" || typeof v === "object") return null;
  return String(v);
}

/**
 * The display text of the case key a pill names (`{{case.u_branch}}` → «u_branch»): a value by its field in the
 * version (`fields`), or a key beside the values — the requester and «برای چه کسی» by name, the requester's unit by
 * name, the number and the title as they are. Empty when there is nothing to show.
 */
export function caseValueText(key: string, values: Readonly<Record<string, unknown>>, fields: ReadonlyMap<string, FieldDef>, env: DisplayEnv): string {
  const v = values[key];
  if (META_PEOPLE.has(key)) return (isEmpty(v) ? null : namesText(env, v)) ?? "";
  return valueText(fields.get(key), v, env) ?? "";
}

const CASE_PILL = new RegExp(`^${CASE_ROOT}\\.([A-Za-z_][A-Za-z0-9_]*)$`);

/** The case key of a pill that names one (`case.u_amount` → «u_amount»; a deeper path or another root: null). */
export function casePillKey(expr: string): string | null {
  return CASE_PILL.exec(expr.trim())?.[1] ?? null;
}

/**
 * Does a value stored into `f` take the display text of its template's pills? Only text people read: a short or long
 * text or a formatted text that is no identifier (no named check, not left-to-right). Any other field takes stored
 * values — a template that is exactly one pill keeps the pill's value and type.
 */
export function takesDisplayText(f: Pick<FieldDef, "type" | "check" | "ltr">): boolean {
  return (f.type === "string" || f.type === "text" || f.type === "markdown") && !f.check && !f.ltr;
}
