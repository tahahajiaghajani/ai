// «استودیو» (catalogue ADM-001/005/007/009, PLT custom tables): pure parts shared by the studio's screens and the
// server.
//
// A custom table is one of the registry's slots (`custom_01` … `custom_10`, src/shared/tables/admin.ts): the slot is
// a real engine table (its DDL comes from the additive schema reconciliation like every TableDef, it syncs to the
// Windows app, the AI layer generates its tools, the access model reads its scope columns) and an organisation gives
// it a meaning — a name, a code, an icon and its own `u_*` fields, which are ordinary `custom_field` rows. Other
// organisations never see that meaning: it is data of the organisation, never a definition in the registry.
//
// A studio package is the JSON an organisation exports and another imports: custom tables by their code (never their
// slot, which differs between organisations), custom fields added to built-in tables, the choice lists they use and the
// forms' arrangements. A reference to another custom table is written `custom:<code>` and resolved on import.
// Imported by the UI: keep it free of server imports.
import type { FieldType, FormArrangement, Option } from "../model/types";
import { COLOR_KEYS, FIELD_TYPES } from "../model/types";
import { normalizeSearch } from "../model/conditions";

/** The registry's slots for custom tables, in order. */
export const CUSTOM_SLOTS = Array.from({ length: 10 }, (_, i) => `custom_${String(i + 1).padStart(2, "0")}`);
export const isCustomSlot = (key: string) => CUSTOM_SLOTS.includes(key);
/** A slot's number prefix (fixed: the engine numbers records per table with its own prefix). */
export const slotPrefix = (slot: string) => `CT${slot.slice(-2)}`;

/** Field types a studio field may have (the engine's custom field types). */
export const STUDIO_TYPES: FieldType[] = (Object.keys(FIELD_TYPES) as FieldType[]).filter((t) => t !== "secret" && t !== "conditions" && t !== "json");

/** Icons offered for a custom table (lucide names). */
export const STUDIO_ICONS = ["table", "clipboard-list", "calendar-days", "key-round", "package", "users", "building-2", "file-text", "wrench", "truck", "badge-check", "book-open"];

/** A table code: Latin lower case, digits and _, 2–30 characters (stable between organisations). */
export const TABLE_CODE = /^[a-z][a-z0-9_]{1,29}$/;
export const FIELD_NAME = /^u_[a-z0-9_]{1,40}$/;

const LATIN: Record<string, string> = {
  ا: "a", آ: "a", أ: "a", إ: "e", ب: "b", پ: "p", ت: "t", ث: "s", ج: "j", چ: "ch", ح: "h", خ: "kh", د: "d", ذ: "z", ر: "r", ز: "z",
  ژ: "zh", س: "s", ش: "sh", ص: "s", ض: "z", ط: "t", ظ: "z", ع: "a", غ: "gh", ف: "f", ق: "gh", ک: "k", ك: "k", گ: "g", ل: "l", م: "m",
  ن: "n", و: "v", ه: "h", ة: "h", ی: "y", ي: "y", ئ: "y", ؤ: "v", ء: "",
};

/** A Latin slug of Persian or English text: «تاریخ ملاقات» → "tarykh_mlaghat" (letters only, digits kept). */
export function slugOf(text: string, max = 30): string {
  const t = normalizeSearch(text).toLowerCase();
  let out = "";
  for (const ch of t) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (LATIN[ch] !== undefined) out += LATIN[ch];
    else if (/[۰-۹]/.test(ch)) out += String("۰۱۲۳۴۵۶۷۸۹".indexOf(ch));
    else out += "_";
  }
  out = out.replace(/_+/g, "_").replace(/^_|_$/g, "");
  return out.slice(0, max).replace(/_$/, "");
}

/** A new custom field name for `label`, not in `taken` (u_<slug>, then u_<slug>_2 …). */
export function fieldNameFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = slugOf(label, 34);
  if (!base || !/^[a-z]/.test(base)) base = `f${base ? `_${base}` : ""}`.slice(0, 34);
  let name = `u_${base}`;
  for (let i = 2; used.has(name); i++) name = `u_${base}_${i}`;
  return name;
}

/** A new table code for `label`, not in `taken`. */
export function tableCodeFor(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = slugOf(label, 24);
  if (!base || !/^[a-z]/.test(base)) base = `t${base ? `_${base}` : ""}`.slice(0, 24);
  if (base.length < 2) base = `${base}_t`;
  let code = base;
  for (let i = 2; used.has(code); i++) code = `${base}_${i}`;
  return code;
}

// ---------------------------------------------------------------- fields and drafts

export interface StudioField {
  name: string;
  label: string;
  type: FieldType;
  /** a choice list's key (shared lists), or null for options of its own */
  choices?: string | null;
  options?: Option[] | null;
  /** reference target: a table key, or `custom:<code>` for another custom table of the package */
  ref?: string | null;
  required?: boolean;
  list?: boolean;
  search?: boolean;
  filter?: boolean;
  help?: string | null;
  section?: string | null;
  max_length?: number | null;
  sort_order?: number | null;
}

export interface TableDraft {
  label: string;
  plural: string;
  description: string;
  icon: string;
  fields: StudioField[];
}

interface Rule {
  re: RegExp;
  type: FieldType;
  options?: string[];
}

// the first rule that matches a phrase decides its type (order matters: «شماره تماس» is a phone, not a number)
const RULES: Rule[] = [
  { re: /ایمیل|پست الکترونیک|رایانامه|email/, type: "email" },
  { re: /تلفن|موبایل|همراه|شماره تماس|تماس|phone|mobile/, type: "phone" },
  { re: /نشانی وب|وبگاه|لینک|پیوند|url|website/, type: "url" },
  { re: /مبلغ|هزینه|قیمت|بودجه|ریال|تومان|price|cost|amount/, type: "money" },
  { re: /درصد|percent/, type: "percent" },
  { re: /امتیاز|رضایت|rating/, type: "rating" },
  { re: /زمان|ساعت|time/, type: "datetime" },
  { re: /تاریخ|روز|date/, type: "date" },
  { re: /مدت|duration/, type: "duration" },
  { re: /تعداد|شمار|سن|count|qty/, type: "int" },
  { re: /^آیا|دارد$|فعال|تایید شده|تأیید شده|مجاز|enabled/, type: "bool" },
  { re: /برچسب|tags/, type: "tags" },
  { re: /گروه|تیم|team|group/, type: "group" },
  { re: /میزبان|مسئول|کارشناس|کاربر|درخواست کننده|درخواستکننده|تحویل گیرنده|تحویلگیرنده|گیرنده|مدیر|کارمند|همکار|owner|user|assignee/, type: "user" },
  { re: /وضعیت|status/, type: "choice", options: ["باز", "در جریان", "انجام شده"] },
  { re: /اولویت|priority/, type: "choice", options: ["کم", "متوسط", "زیاد"] },
  { re: /نوع|دسته|سطح|گونه|type|category|level/, type: "choice", options: [] },
  { re: /توضیح|شرح|یادداشت|متن|description|notes?/, type: "text" },
];

const REQUIRED = /\s*\(?\s*(الزامی|اجباری|ضروری|required)\s*\)?\s*/g;

/** The type (and default options) a Persian or English phrase suggests. */
export function typeOfPhrase(phrase: string): { type: FieldType; options?: string[] } {
  const p = normalizeSearch(phrase).toLowerCase();
  for (const r of RULES) if (r.re.test(p)) return { type: r.type, options: r.options };
  return { type: "string" };
}

const optionsOf = (labels: string[] | undefined): Option[] | null =>
  labels ? labels.map((label, i) => ({ value: slugOf(label, 30) || `o${i + 1}`, label, color: (["blue", "gold", "green", "gray", "red"] as const)[i % 5] })) : null;

/**
 * A table drafted from a Persian description without a model (the studio skill's rule-based answer): the part before
 * «با فیلدهای» / «شامل» / «:» names the table, the rest lists fields separated by «،», «,», «؛», « و » or lines.
 */
export function draftFromText(text: string): TableDraft {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const split = clean.split(/\s*(?:با فیلدهای|با فیلد|با ستون‌های|با ستون های|شامل|دارای|:)\s*/);
  let head = (split.length > 1 ? split[0] : clean.split(/[،,؛;]/)[0]) ?? "";
  const tail = split.length > 1 ? split.slice(1).join("، ") : clean.split(/[،,؛;]/).slice(1).join("، ");
  head = head
    .replace(/^(?:لطفا|لطفاً)\s+/, "")
    .replace(/^(?:یک|یه)\s+/, "")
    .replace(/^(?:جدول|فهرست|لیست)\s+(?:برای|جهت)?\s*/, "")
    .replace(/^(?:برای|جهت)\s+/, "")
    .replace(/\s+(?:بساز|بسازید|می‌خواهم|میخواهم|لازم است)$/, "")
    .trim();
  const label = (head || "جدول تازه").slice(0, 60);
  const plural = /(?:ها|های|ان)$/.test(label) ? label : `${label}‌ها`;
  const phrases = tail
    .split(/\s*(?:[،,؛;\n]|\s+و\s+)\s*/)
    .map((s) => s.replace(/[.。]+$/, "").trim())
    .filter((s) => s.length > 1)
    .slice(0, 40);
  const taken = new Set<string>();
  const fields: StudioField[] = [];
  for (const raw of phrases) {
    const required = REQUIRED.test(raw);
    REQUIRED.lastIndex = 0;
    const phrase = raw.replace(REQUIRED, " ").replace(/\s+/g, " ").trim();
    if (!phrase) continue;
    const t = typeOfPhrase(phrase);
    const name = fieldNameFor(phrase, taken);
    taken.add(name);
    const f: StudioField = { name, label: phrase.slice(0, 80), type: t.type, list: fields.length < 4, filter: ["choice", "user", "group", "date", "bool"].includes(t.type), search: t.type === "string" || t.type === "text" };
    if (required) f.required = true;
    if (t.type === "choice") f.options = optionsOf(t.options) ?? [];
    fields.push(f);
  }
  return { label, plural, description: clean.slice(0, 500), icon: iconFor(label), fields };
}

/** An icon for a table name. */
export function iconFor(label: string): string {
  const l = normalizeSearch(label);
  if (/ملاقات|جلسه|نوبت|رزرو|برنامه/.test(l)) return "calendar-days";
  if (/کلید|رمز|دسترسی/.test(l)) return "key-round";
  if (/کالا|انبار|بسته|دارایی|تجهیز/.test(l)) return "package";
  if (/مهمان|کارمند|نیرو|افراد|پرسنل/.test(l)) return "users";
  if (/ساختمان|اتاق|مکان/.test(l)) return "building-2";
  if (/خودرو|حمل|ارسال/.test(l)) return "truck";
  if (/تعمیر|نگهداری|سرویس/.test(l)) return "wrench";
  return "table";
}

/** Why a studio field is not acceptable (Persian), or null. */
export function fieldProblem(f: StudioField): string | null {
  if (!FIELD_NAME.test(f.name)) return `نام فنی «${f.name}» باید با u_ شروع شود و فقط حرف کوچک لاتین، رقم و _ داشته باشد`;
  if (!String(f.label ?? "").trim()) return `برچسب فیلد «${f.name}» خالی است`;
  if (!STUDIO_TYPES.includes(f.type)) return `نوع «${f.type}» برای فیلد سفارشی مجاز نیست`;
  if ((f.type === "ref" || f.type === "refs") && !f.ref) return `فیلد «${f.label}» جدول مقصد ندارد`;
  if (f.options) for (const o of f.options) if (!String(o.value ?? "").trim()) return `گزینه‌ای از «${f.label}» مقدار ندارد`;
  if (f.options) for (const o of f.options) if (o.color && !(COLOR_KEYS as readonly string[]).includes(o.color)) return `رنگ «${o.color}» شناخته نیست`;
  return null;
}

// ---------------------------------------------------------------- packages

export interface PackageTable {
  /** the table's code (stable between organisations) */
  code: string;
  label: string;
  plural: string;
  description?: string | null;
  icon?: string | null;
  fields: StudioField[];
  form?: FormArrangement | null;
}

export interface StudioPackage {
  format: "itsm-studio";
  version: 1;
  exported_at: string;
  /** what the package is (shown before an import) */
  title?: string | null;
  tables: PackageTable[];
  /** custom fields added to built-in tables */
  fields: { table: string; fields: StudioField[]; form?: FormArrangement | null }[];
  /** the organisation's rows of the choice lists the fields use */
  choices: { list: string; options: Option[] }[];
}

/** Why a package cannot be imported (Persian), or null. */
export function packageProblem(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return "فایل بستهٔ استودیو نیست";
  const p = raw as Partial<StudioPackage>;
  if (p.format !== "itsm-studio") return "این فایل بستهٔ استودیو نیست (format)";
  if (p.version !== 1) return `نسخهٔ ${String(p.version)} بسته پشتیبانی نمی‌شود`;
  if (!Array.isArray(p.tables) || !Array.isArray(p.fields) || !Array.isArray(p.choices)) return "ساختار بسته کامل نیست";
  if (p.tables.length > CUSTOM_SLOTS.length) return `بسته بیش از ${CUSTOM_SLOTS.length} جدول دارد`;
  const codes = new Set<string>();
  for (const t of p.tables) {
    if (!t || !TABLE_CODE.test(String(t.code ?? ""))) return `کد جدول «${String(t?.code)}» معتبر نیست`;
    if (codes.has(t.code)) return `کد جدول «${t.code}» تکراری است`;
    codes.add(t.code);
    if (!String(t.label ?? "").trim()) return `جدول «${t.code}» نام ندارد`;
    if (!Array.isArray(t.fields)) return `فیلدهای جدول «${t.code}» معتبر نیست`;
    for (const f of t.fields) {
      const why = fieldProblem(f);
      if (why) return why;
      if (f.ref?.startsWith("custom:") && !p.tables.some((x) => `custom:${x.code}` === f.ref)) return `مقصد «${f.ref}» فیلد «${f.label}» در بسته نیست`;
    }
  }
  for (const g of p.fields) {
    if (!g || !/^[a-z][a-z0-9_]{0,62}$/.test(String(g.table ?? ""))) return "نام جدول فیلدهای سفارشی معتبر نیست";
    if (!Array.isArray(g.fields)) return `فیلدهای «${g.table}» معتبر نیست`;
    for (const f of g.fields) {
      const why = fieldProblem(f);
      if (why) return why;
    }
  }
  for (const c of p.choices) if (!c || !/^[a-z][a-z0-9_.]{0,79}$/.test(String(c.list ?? "")) || !Array.isArray(c.options)) return "فهرست گزینه‌ای در بسته معتبر نیست";
  return null;
}

export interface FieldChange {
  name: string;
  label: string;
  change: "new" | "changed" | "same";
  /** what changed (labels of the properties) */
  what?: string[];
}

export interface TablePlan {
  code: string;
  label: string;
  action: "create" | "update";
  /** the slot it lands in (existing table: its slot; new: the next free one, null when none is left) */
  slot: string | null;
  fields: FieldChange[];
}

const PROPS: [keyof StudioField, string][] = [
  ["label", "برچسب"], ["type", "نوع"], ["required", "الزامی"], ["choices", "فهرست گزینه"], ["options", "گزینه‌ها"], ["ref", "مقصد"], ["help", "راهنما"], ["section", "بخش"], ["list", "ستون فهرست"],
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What importing `incoming` fields does to `current` ones (fields are added or changed, never removed). */
export function fieldChanges(current: StudioField[], incoming: StudioField[]): FieldChange[] {
  const byName = new Map(current.map((f) => [f.name, f]));
  return incoming.map((f) => {
    const cur = byName.get(f.name);
    if (!cur) return { name: f.name, label: f.label, change: "new" as const };
    const what = PROPS.filter(([k]) => !same(cur[k] ?? (k === "required" || k === "list" ? false : null), f[k] ?? (k === "required" || k === "list" ? false : null))).map(([, l]) => l);
    return { name: f.name, label: f.label, change: what.length ? ("changed" as const) : ("same" as const), what };
  });
}
