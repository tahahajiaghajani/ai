// Field types («نوع فیلد», design F §3.1): a storage type of the engine (FieldType) with a widget, validation and
// display. The built-in types live here — read-only, listed first, their labels from the catalogue's vocabulary —
// and an organisation's own types are rows of `field_type` (src/shared/tables/fields.ts), each derived from one
// built-in type. A library field («فیلد», `field_def`) is a named u_* field of a type; `libraryFieldDef` builds its
// FieldDef for the engine's overlay (src/server/engine/schema.ts) and for the snapshot of a process version, so a
// change to a library field or to its type reaches every table that uses it.
// «پیوست» is the `json` storage type with the `files` widget and the `attachments` check: no storage type is added.
// Imported by the UI: keep it free of server imports.
import type { Cond } from "../model/conditions";
import type { FieldCheck, FieldDef, FieldGroup, FieldType, Option } from "../model/types";
import { COLOR_KEYS, FIELD_GROUPS, FIELD_TYPES } from "../model/types";
import { D, mul, normalizeDigits } from "../money";
import { faDigits } from "../format";
import { formatRial, type MoneyUnit } from "../financial/logic";
import { ATTACHMENTS_DEFAULT_MAX, ATTACHMENTS_MAX, acceptProblem, dateLimitProblem, patternProblem, resolveDateLimit } from "./validators";

export type FieldTypeGroup = "text" | "bank" | "number" | "money" | "bool" | "choice" | "date" | "people" | "reference" | "file" | "other";

/** Groups of the type picker, in order. */
export const FIELD_TYPE_GROUPS: Record<FieldTypeGroup, string> = {
  text: "متن",
  bank: "متن (بانکی)",
  number: "عدد",
  money: "مبلغ",
  bool: "بله/خیر",
  choice: "گزینه",
  date: "تاریخ",
  people: "افراد و سازمان",
  reference: "ارجاع",
  file: "پیوست",
  other: "دیگر",
};

/** How a value is shown and entered; the record UI kit renders each. */
export type Widget =
  | "input" | "textarea" | "editor" | "number" | "stars" | "duration" | "money"
  | "checkbox" | "switch" | "select" | "radio" | "multiselect" | "checklist" | "tags"
  | "date" | "datetime" | "user" | "users" | "group" | "record" | "records" | "position" | "files" | "swatches";

export const WIDGET_LABELS: Record<Widget, string> = {
  input: "کادر متن",
  textarea: "کادر چندخطی",
  editor: "ویرایشگر قالب‌دار",
  number: "کادر عدد",
  stars: "ستاره‌ها",
  duration: "مدت",
  money: "کادر مبلغ",
  checkbox: "کادر انتخاب",
  switch: "کلید روشن/خاموش",
  select: "فهرست کشویی",
  radio: "گزینه‌های تکی",
  multiselect: "چند گزینه",
  checklist: "فهرست تیک‌دار",
  tags: "برچسب‌ها",
  date: "تاریخ",
  datetime: "تاریخ و ساعت",
  user: "انتخاب شخص",
  users: "انتخاب چند شخص",
  group: "انتخاب گروه",
  record: "انتخاب رکورد",
  records: "انتخاب چند رکورد",
  position: "انتخاب نقش سازمانی",
  files: "افزودن پرونده",
  swatches: "رنگ‌ها",
};

/** Widgets each storage type may show with: a type changes its widget only within its storage type (radio ↔ select). */
const WIDGETS: Partial<Record<FieldType, Widget[]>> = {
  string: ["input"],
  text: ["textarea"],
  markdown: ["editor"],
  email: ["input"],
  url: ["input"],
  phone: ["input"],
  ip: ["input"],
  int: ["number"],
  decimal: ["number"],
  percent: ["number"],
  rating: ["stars", "number"],
  duration: ["duration"],
  money: ["money"],
  bool: ["checkbox", "switch"],
  choice: ["select", "radio"],
  multichoice: ["multiselect", "checklist"],
  tags: ["tags"],
  date: ["date"],
  datetime: ["datetime"],
  user: ["user"],
  users: ["users"],
  group: ["group"],
  ref: ["record"],
  refs: ["records"],
  json: ["files"],
  color: ["swatches"],
};

/** The widgets a storage type may show with (a reference to `position` also with the position picker). */
export function widgetsFor(base: FieldType, ref?: string | null): Widget[] {
  const out = [...(WIDGETS[base] ?? [])];
  if (base === "ref" && ref === "position") out.push("position");
  return out;
}

/** What a field type adds to its storage type; a library field may set the same keys its built-in type allows. */
export interface FieldTypeSettings {
  widget?: Widget;
  ltr?: boolean;
  maxLength?: number;
  pattern?: string;
  patternMessage?: string;
  check?: FieldCheck;
  min?: number;
  /** numbers: the largest value; attachments: the most files */
  max?: number;
  decimals?: number;
  /** money: Rials or Tomans (default: the organisation's `currency_display`) */
  unit?: MoneyUnit;
  minDate?: string;
  maxDate?: string;
  /** attachments: accepted kinds of file */
  accept?: string[];
  /** choice types: inline options, or the key of a shared choice list */
  options?: Option[];
  choices?: string;
  /** references: the target table and the condition its records must satisfy */
  ref?: string;
  refFilter?: Cond;
}
export type SettingKey = keyof FieldTypeSettings;

/** Settings kept in a type row's `display`; the others are in `validation` (the widget has a column of its own). */
export const DISPLAY_KEYS: SettingKey[] = ["ltr", "unit"];

export interface BuiltinFieldType {
  key: string;
  label: string;
  group: FieldTypeGroup;
  base: FieldType;
  /** the type's settings (its widget first) */
  settings: FieldTypeSettings & { widget: Widget };
  /** what an organisation's type or a library field may set (a widget always, within the storage type) */
  editable: SettingKey[];
}

const TEXT: SettingKey[] = ["maxLength"];
const CHOICES: SettingKey[] = ["options", "choices"];
const RANGE: SettingKey[] = ["min", "max"];
const DATES: SettingKey[] = ["minDate", "maxDate"];

function t(key: string, label: string, group: FieldTypeGroup, base: FieldType, settings: FieldTypeSettings & { widget: Widget }, editable: SettingKey[] = []): BuiltinFieldType {
  return { key, label, group, base, settings, editable };
}

/** The built-in field types, in the order of the type picker. Keys are stored in rows: never rename one. */
export const BUILTIN_FIELD_TYPES: readonly BuiltinFieldType[] = [
  t("string", "متن کوتاه", "text", "string", { widget: "input" }, [...TEXT, "pattern", "patternMessage", "ltr"]),
  t("text", "متن چندخطی", "text", "text", { widget: "textarea" }, TEXT),
  t("markdown", "متن قالب‌دار", "text", "markdown", { widget: "editor" }, TEXT),
  t("email", "ایمیل", "text", "email", { widget: "input", ltr: true }),
  t("url", "نشانی وب", "text", "url", { widget: "input", ltr: true }),
  t("phone", "تلفن", "text", "phone", { widget: "input", ltr: true }),
  t("ip", "نشانی IP", "text", "ip", { widget: "input", ltr: true }),
  t("national_id", "کد ملی", "bank", "string", { widget: "input", ltr: true, check: "national_id" }),
  t("iban", "شمارهٔ شبا", "bank", "string", { widget: "input", ltr: true, check: "iban" }),
  t("card", "شمارهٔ کارت", "bank", "string", { widget: "input", ltr: true, check: "card" }),
  t("postal_code", "کد پستی", "bank", "string", { widget: "input", ltr: true, check: "postal_code" }),
  t("mobile", "تلفن همراه", "bank", "string", { widget: "input", ltr: true, check: "mobile" }),
  t("int", "عدد صحیح", "number", "int", { widget: "number" }, RANGE),
  t("decimal", "عدد اعشاری", "number", "decimal", { widget: "number" }, [...RANGE, "decimals"]),
  t("percent", "درصد", "number", "percent", { widget: "number" }, [...RANGE, "decimals"]),
  t("rating", "امتیاز", "number", "rating", { widget: "stars", max: 5 }, ["max"]),
  t("duration", "مدت", "number", "duration", { widget: "duration" }, RANGE),
  t("money", "مبلغ", "money", "money", { widget: "money", decimals: 0 }, [...RANGE, "unit"]),
  t("checkbox", "کادر انتخاب", "bool", "bool", { widget: "checkbox" }),
  t("switch", "کلید روشن/خاموش", "bool", "bool", { widget: "switch" }),
  t("select", "فهرست کشویی", "choice", "choice", { widget: "select" }, CHOICES),
  t("radio", "گزینه‌های تکی", "choice", "choice", { widget: "radio" }, CHOICES),
  t("multiselect", "چند گزینه", "choice", "multichoice", { widget: "multiselect" }, CHOICES),
  t("checklist", "فهرست تیک‌دار", "choice", "multichoice", { widget: "checklist" }, CHOICES),
  t("tags", "برچسب‌ها", "choice", "tags", { widget: "tags" }),
  t("date", "تاریخ", "date", "date", { widget: "date" }, DATES),
  t("datetime", "تاریخ و ساعت", "date", "datetime", { widget: "datetime" }, DATES),
  t("user", "شخص", "people", "user", { widget: "user" }),
  t("users", "چند شخص", "people", "users", { widget: "users" }),
  t("group", "گروه", "people", "group", { widget: "group" }),
  t("unit", "واحد سازمانی", "people", "ref", { widget: "record", ref: "org_unit" }, ["refFilter"]),
  t("location", "مکان", "people", "ref", { widget: "record", ref: "location" }, ["refFilter"]),
  t("position", "نقش سازمانی", "people", "ref", { widget: "position", ref: "position" }, ["refFilter"]),
  t("record", "رکورد", "reference", "ref", { widget: "record" }, ["ref", "refFilter"]),
  t("records", "چند رکورد", "reference", "refs", { widget: "records" }, ["ref", "refFilter"]),
  t("attachment", "پیوست", "file", "json", { widget: "files", check: "attachments", max: ATTACHMENTS_DEFAULT_MAX }, ["max", "accept"]),
  t("color", "رنگ", "other", "color", { widget: "swatches" }),
];

const BY_KEY = new Map(BUILTIN_FIELD_TYPES.map((b) => [b.key, b]));

export const builtinFieldType = (key: unknown): BuiltinFieldType | undefined => (typeof key === "string" ? BY_KEY.get(key) : undefined);

/**
 * The built-in types an organisation may use now: a type whose fixed target table does not exist yet (the
 * «نقش سازمانی» picker before the positions package lands) is left out.
 */
export function availableBuiltinTypes(tableExists: (key: string) => boolean): BuiltinFieldType[] {
  return BUILTIN_FIELD_TYPES.filter((b) => !b.settings.ref || tableExists(b.settings.ref));
}

/** Options of the `base` column of an organisation's type: every built-in type, by group. */
export const BUILTIN_TYPE_OPTIONS: Option[] = BUILTIN_FIELD_TYPES.map((b, i) => ({ value: b.key, label: `${FIELD_TYPE_GROUPS[b.group]} · ${b.label}`, order: i + 1 }));

// ---------------------------------------------------------------------------------------------------------------
// Settings: cleaning what an organisation stored

/** Longest text a field of each text storage type may hold (the engine's defaults). */
export const TEXT_MAX: Partial<Record<FieldType, number>> = { string: 500, text: 20_000, markdown: 200_000 };

/** Callbacks for what a shared cleaner cannot know (the server passes them; the UI may). */
export interface SettingsEnv {
  /** does the table exist (a reference target)? */
  tableExists?: (key: string) => boolean;
  /** the problem with a condition on a table's records (`validateCond` against the table), or null */
  condProblem?: (table: string, cond: unknown) => string | null;
}

const LIST_KEY = /^[a-z][a-z0-9_.]{0,79}$/;
const TABLE_KEY = /^[a-z][a-z0-9_]{0,62}$/;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The inline options of a choice type, cleaned; problems for empty or repeated values. */
export function cleanOptions(raw: unknown, problems: string[] = []): Option[] {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) {
    problems.push("گزینه‌ها باید فهرست باشند");
    return [];
  }
  const out: Option[] = [];
  const seen = new Set<string>();
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const x = o as Record<string, unknown>;
    const value = normalizeDigits(String(x.value ?? "")).trim();
    if (!value) {
      problems.push("هر گزینه مقداری لازم دارد");
      continue;
    }
    if (value.length > 80) {
      problems.push(`مقدار گزینهٔ «${value.slice(0, 20)}…» حداکثر ۸۰ نویسه است`);
      continue;
    }
    if (seen.has(value)) {
      problems.push(`گزینهٔ «${value}» تکراری است`);
      continue;
    }
    seen.add(value);
    const opt: Option = { value, label: String(x.label ?? value).trim().slice(0, 120) || value };
    if (typeof x.color === "string" && (COLOR_KEYS as readonly string[]).includes(x.color)) opt.color = x.color as Option["color"];
    if (isNum(x.order)) opt.order = x.order;
    if (x.active === false) opt.active = false;
    if (typeof x.parent === "string" && x.parent.trim()) opt.parent = x.parent.trim().slice(0, 80);
    out.push(opt);
  }
  if (out.length > 500) problems.push("حداکثر ۵۰۰ گزینه");
  return out.slice(0, 500);
}

/**
 * The settings of a type row or a library field, kept to what the built-in type allows and checked: the clean
 * settings (what the engine uses; anything unusable is left out) and the problems (what a write is refused for).
 */
export function cleanSettings(b: BuiltinFieldType, raw: unknown, env: SettingsEnv = {}): { settings: FieldTypeSettings; problems: string[] } {
  const problems: string[] = [];
  const s: FieldTypeSettings = {};
  if (raw === null || raw === undefined) return { settings: s, problems };
  if (typeof raw !== "object" || Array.isArray(raw)) return { settings: s, problems: ["تنظیمات نوع فیلد معتبر نیست"] };
  const x = raw as Record<string, unknown>;
  const editable = new Set<SettingKey>(b.editable);
  const has = (k: SettingKey) => x[k] !== undefined && x[k] !== null && x[k] !== "";
  for (const k of Object.keys(x) as SettingKey[]) {
    if (k === "widget" || !has(k) || editable.has(k)) continue;
    if (KNOWN_KEYS.has(k)) problems.push(`«${SETTING_LABELS[k]}» برای نوع «${b.label}» تنظیم نمی‌شود`);
  }
  if (has("widget")) {
    const ok = widgetsFor(b.base, b.settings.ref ?? (typeof x.ref === "string" ? x.ref : null));
    if (ok.includes(x.widget as Widget)) s.widget = x.widget as Widget;
    else problems.push(`نمایش «${String(x.widget)}» برای نوع «${b.label}» نیست`);
  }
  if (editable.has("ltr") && has("ltr")) s.ltr = x.ltr === true;
  if (editable.has("maxLength") && has("maxLength")) {
    const cap = TEXT_MAX[b.base] ?? 500;
    if (isNum(x.maxLength) && Number.isInteger(x.maxLength) && x.maxLength >= 1 && x.maxLength <= cap) s.maxLength = x.maxLength;
    else problems.push(`حداکثر طول باید عددی از ۱ تا ${faDigits(cap)} باشد`);
  }
  if (editable.has("pattern") && has("pattern")) {
    const p = patternProblem(x.pattern);
    if (p) problems.push(p);
    else s.pattern = String(x.pattern);
  }
  if (editable.has("patternMessage") && has("patternMessage")) {
    const m = String(x.patternMessage).trim();
    if (m.length > 200) problems.push("پیام الگو حداکثر ۲۰۰ نویسه است");
    else if (m) s.patternMessage = m;
  }
  if (s.patternMessage && !s.pattern) delete s.patternMessage;
  if (b.settings.check === "attachments") {
    if (editable.has("max") && has("max")) {
      if (isNum(x.max) && Number.isInteger(x.max) && x.max >= 1 && x.max <= ATTACHMENTS_MAX) s.max = x.max;
      else problems.push(`شمار پرونده‌ها باید عددی از ۱ تا ${faDigits(ATTACHMENTS_MAX)} باشد`);
    }
    if (has("accept")) {
      const p = acceptProblem(x.accept);
      if (p) problems.push(p);
      else s.accept = (x.accept as string[]).map((a) => String(a).trim().toLowerCase().replace(/^\./, ""));
    }
  } else {
    for (const k of ["min", "max"] as const) {
      if (!editable.has(k) || !has(k)) continue;
      if (isNum(x[k])) s[k] = x[k] as number;
      else problems.push(`«${SETTING_LABELS[k]}» باید عدد باشد`);
    }
    if (b.base === "rating" && s.max !== undefined && !(Number.isInteger(s.max) && s.max >= 1 && s.max <= 10)) {
      problems.push("بیشترین امتیاز باید عددی از ۱ تا ۱۰ باشد");
      delete s.max;
    }
    if (s.min !== undefined && s.max !== undefined && s.min > s.max) problems.push("کمینه از بیشینه بزرگ‌تر است");
  }
  if (editable.has("decimals") && has("decimals")) {
    if (isNum(x.decimals) && Number.isInteger(x.decimals) && x.decimals >= 0 && x.decimals <= 12) s.decimals = x.decimals;
    else problems.push("شمار رقم‌های اعشار باید عددی از ۰ تا ۱۲ باشد");
  }
  if (editable.has("unit") && has("unit")) {
    if (x.unit === "rial" || x.unit === "toman") s.unit = x.unit;
    else problems.push("واحد مبلغ باید ریال یا تومان باشد");
  }
  for (const k of ["minDate", "maxDate"] as const) {
    if (!editable.has(k) || !has(k)) continue;
    const p = dateLimitProblem(x[k]);
    if (p) problems.push(p);
    else s[k] = normalizeDigits(String(x[k])).trim();
  }
  if (s.minDate && s.maxDate && !s.minDate.startsWith("$") && !s.maxDate.startsWith("$") && s.minDate > s.maxDate) problems.push("آغاز محدودهٔ تاریخ پس از پایان آن است");
  if (editable.has("options") && has("options")) {
    const options = cleanOptions(x.options, problems);
    if (options.length) s.options = options;
  }
  if (editable.has("choices") && has("choices")) {
    const key = String(x.choices).trim();
    if (LIST_KEY.test(key)) s.choices = key;
    else problems.push("کلید فهرست گزینه‌ها معتبر نیست");
  }
  if (s.options && s.choices) problems.push("گزینه‌های ثابت یا یک فهرست گزینه؛ هر دو با هم نه");
  if (editable.has("ref") && has("ref")) {
    const key = String(x.ref).trim();
    if (!TABLE_KEY.test(key) || key === "user" || (env.tableExists && !env.tableExists(key))) problems.push(`جدول «${key}» وجود ندارد`);
    else s.ref = key;
  }
  if (editable.has("refFilter") && has("refFilter")) {
    const target = s.ref ?? b.settings.ref;
    if (typeof x.refFilter !== "object" || Array.isArray(x.refFilter)) problems.push("شرط رکوردهای قابل انتخاب معتبر نیست");
    else if (!target) problems.push("برای شرط رکوردها نخست جدول را برگزینید");
    else {
      const p = env.condProblem?.(target, x.refFilter) ?? null;
      if (p) problems.push(`شرط رکوردهای قابل انتخاب: ${p}`);
      else s.refFilter = x.refFilter as Cond;
    }
  }
  return { settings: s, problems };
}

const SETTING_LABELS: Record<SettingKey, string> = {
  widget: "نمایش",
  ltr: "چپ‌به‌راست",
  maxLength: "حداکثر طول",
  pattern: "الگو",
  patternMessage: "پیام الگو",
  check: "بررسی",
  min: "کمینه",
  max: "بیشینه",
  decimals: "رقم‌های اعشار",
  unit: "واحد مبلغ",
  minDate: "از تاریخ",
  maxDate: "تا تاریخ",
  accept: "نوع پرونده‌ها",
  options: "گزینه‌ها",
  choices: "فهرست گزینه‌ها",
  ref: "جدول مقصد",
  refFilter: "شرط رکوردها",
};
const KNOWN_KEYS = new Set(Object.keys(SETTING_LABELS) as SettingKey[]);

// ---------------------------------------------------------------------------------------------------------------
// Types: built-in or the organisation's

/** A row of `field_type` (the columns the resolver reads). */
export interface FieldTypeRow {
  key: string;
  name: string;
  base: string;
  widget?: string | null;
  validation?: unknown;
  display?: unknown;
  options?: unknown;
  choices?: string | null;
  status?: string | null;
}

export interface ResolvedFieldType {
  key: string;
  label: string;
  group: FieldTypeGroup;
  /** the storage type */
  base: FieldType;
  /** the built-in type it is, or derives from */
  builtin: BuiltinFieldType;
  settings: FieldTypeSettings & { widget: Widget };
  /** an organisation's type (a row of `field_type`) */
  custom: boolean;
  retired: boolean;
}

/** Keys of an organisation's types: u_* like custom fields, so they never meet a built-in key. */
export const TYPE_KEY = /^u_[a-z0-9_]{1,40}$/;

/** A type row's settings: the built-in's, with the row's validation, display, widget and options on top. */
export function typeRowSettings(b: BuiltinFieldType, row: Omit<FieldTypeRow, "key" | "name" | "base">, env: SettingsEnv = {}): { settings: FieldTypeSettings & { widget: Widget }; problems: string[] } {
  const validation = row.validation && typeof row.validation === "object" && !Array.isArray(row.validation) ? (row.validation as Record<string, unknown>) : {};
  const display = row.display && typeof row.display === "object" && !Array.isArray(row.display) ? (row.display as Record<string, unknown>) : {};
  const problems: string[] = [];
  if (row.validation !== null && row.validation !== undefined && validation !== row.validation) problems.push("اعتبارسنجی نوع فیلد معتبر نیست");
  if (row.display !== null && row.display !== undefined && display !== row.display) problems.push("تنظیمات نمایش نوع فیلد معتبر نیست");
  for (const k of DISPLAY_KEYS) if (k in validation) problems.push(`«${SETTING_LABELS[k]}» در تنظیمات نمایش می‌آید`);
  for (const k of Object.keys(display)) if (!(DISPLAY_KEYS as string[]).includes(k)) problems.push(`«${SETTING_LABELS[k as SettingKey] ?? k}» در تنظیمات نمایش نمی‌آید`);
  const raw: Record<string, unknown> = { ...validation, ...display, widget: row.widget ?? undefined, options: row.options ?? undefined, choices: row.choices ?? undefined };
  const clean = cleanSettings(b, raw, env);
  return { settings: { ...b.settings, ...clean.settings, widget: clean.settings.widget ?? b.settings.widget }, problems: [...problems, ...clean.problems] };
}

/** A field type by key: a built-in type, or one of the organisation's rows (whose base is a built-in type). */
export function resolveFieldType(key: unknown, rows?: Iterable<FieldTypeRow> | ReadonlyMap<string, FieldTypeRow>, env: SettingsEnv = {}): ResolvedFieldType | null {
  const b = builtinFieldType(key);
  if (b) return { key: b.key, label: b.label, group: b.group, base: b.base, builtin: b, settings: { ...b.settings }, custom: false, retired: false };
  if (typeof key !== "string" || !TYPE_KEY.test(key) || !rows) return null;
  let row: FieldTypeRow | undefined;
  if (rows instanceof Map) row = rows.get(key);
  else for (const r of rows as Iterable<FieldTypeRow>) if (r.key === key) row = r;
  if (!row) return null;
  const base = builtinFieldType(row.base);
  if (!base) return null;
  const { settings } = typeRowSettings(base, row, env);
  return { key, label: row.name || key, group: base.group, base: base.base, builtin: base, settings, custom: true, retired: row.status === "retired" };
}

/** Does changing a field from one type to another keep its storage (and so every stored value)? */
export const sameStorage = (a: Pick<ResolvedFieldType, "base">, b: Pick<ResolvedFieldType, "base">): boolean => a.base === b.base;

// ---------------------------------------------------------------------------------------------------------------
// Library fields

/** Names of library fields: u_* like the custom fields they become on a table (`custom_field.name`). */
export const LIBRARY_NAME = /^u_[a-z0-9_]{1,40}$/;

/** A row of `field_def` (the columns the overlay reads). */
export interface LibraryFieldRow {
  name: string;
  label: string;
  type: string;
  help?: string | null;
  placeholder?: string | null;
  /** a value or a default token ($today, $now, $me, $my_unit, $my_domain) */
  default_value?: unknown;
  options?: unknown;
  choices?: string | null;
  depends_on?: string | null;
  validation?: unknown;
  field_group?: string | null;
  list?: boolean | null;
  search?: boolean | null;
  filter?: boolean | null;
  status?: string | null;
}

/** A library field's own settings (on top of its type's): what its built-in type allows. */
export function libraryFieldSettings(row: Pick<LibraryFieldRow, "validation" | "options" | "choices">, type: ResolvedFieldType, env: SettingsEnv = {}): { settings: FieldTypeSettings; problems: string[] } {
  const validation = row.validation && typeof row.validation === "object" && !Array.isArray(row.validation) ? (row.validation as Record<string, unknown>) : {};
  const problems = row.validation !== null && row.validation !== undefined && validation !== row.validation ? ["اعتبارسنجی فیلد معتبر نیست"] : [];
  const clean = cleanSettings(type.builtin, { ...validation, options: row.options ?? undefined, choices: row.choices ?? undefined }, env);
  return { settings: clean.settings, problems: [...problems, ...clean.problems] };
}

/**
 * The FieldDef of a library field of a type: what the engine's overlay adds to a table (`custom` and `library` set)
 * and what a process version snapshots. Null when it cannot be a field (a bad name, a reference without a table).
 * The library field's own options, choices and settings win over its type's.
 */
export function libraryFieldDef(row: LibraryFieldRow, type: ResolvedFieldType, env: SettingsEnv = {}): FieldDef | null {
  if (!LIBRARY_NAME.test(row.name)) return null;
  const own = libraryFieldSettings(row, type, env).settings;
  const s: FieldTypeSettings = { ...type.settings, ...own };
  if (own.options) delete s.choices;
  if (own.choices) delete s.options;
  const f: FieldDef = { name: row.name, label: row.label || row.name, type: type.base, custom: true, library: row.name };
  if (s.widget) f.widget = s.widget;
  if (s.ltr) f.ltr = true;
  if (s.check) f.check = s.check;
  if (s.maxLength !== undefined) f.maxLength = s.maxLength;
  if (s.pattern) {
    f.pattern = s.pattern;
    if (s.patternMessage) f.patternMessage = s.patternMessage;
  }
  if (s.min !== undefined) f.min = s.min;
  if (s.max !== undefined) f.max = s.max;
  if (s.decimals !== undefined) f.decimals = s.decimals;
  if (s.unit) f.unit = s.unit;
  if (s.minDate) f.minDate = s.minDate;
  if (s.maxDate) f.maxDate = s.maxDate;
  if (s.accept?.length) f.accept = [...s.accept];
  if (type.base === "choice" || type.base === "multichoice") {
    f.choices = s.options ? s.options.map((o) => ({ ...o })) : s.choices ? s.choices : [];
    if (row.depends_on && LIBRARY_NAME.test(row.depends_on)) f.dependsOn = row.depends_on;
  }
  if (type.base === "ref" || type.base === "refs") {
    if (!s.ref) return null;
    f.ref = s.ref;
    if (s.refFilter) f.refFilter = s.refFilter;
  }
  if (row.help) f.help = row.help;
  if (row.placeholder) f.placeholder = row.placeholder;
  if (row.default_value !== null && row.default_value !== undefined && row.default_value !== "") f.default = row.default_value;
  if (row.field_group && row.field_group in FIELD_GROUPS) f.group = row.field_group as FieldGroup;
  if (row.list) f.list = true;
  if (row.search && FIELD_TYPES[type.base].sql === "text") f.search = true;
  if (row.filter) f.filter = true;
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Money: stored in Rials; shown in the organisation's `currency_display` unless the field sets its own unit

export const moneyUnitOf = (f: Pick<FieldDef, "unit">, orgDisplay: MoneyUnit = "rial"): MoneyUnit => f.unit ?? orgDisplay;

/** A money value for people, in the field's unit (or the organisation's). */
export function formatFieldMoney(f: Pick<FieldDef, "unit">, value: unknown, orgDisplay: MoneyUnit = "rial", opts: { suffix?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "";
  return formatRial(String(value), moneyUnitOf(f, orgDisplay), opts);
}

/** What a person typed in the field's unit, as the Rials to store (Tomans × 10; Persian digits and separators accepted). */
export function rialFromInput(input: unknown, unit: MoneyUnit): string | null {
  if (input === null || input === undefined || String(input).trim() === "") return null;
  const s = normalizeDigits(String(input)).replace(/[,٬'\s‌]/g, "").replace(/[٫/]/g, ".");
  if (!/^-?\d{1,20}(\.\d{1,12})?$/.test(s)) return null;
  return unit === "toman" ? D(mul(s, 10)).toString() : D(s).toString();
}

/** A field's date limits resolved for today (the designer's preview and the date picker's bounds). */
export function dateBounds(f: Pick<FieldDef, "minDate" | "maxDate">, today: string): { min: string | null; max: string | null } {
  return { min: resolveDateLimit(f.minDate, today), max: resolveDateLimit(f.maxDate, today) };
}
