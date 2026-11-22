// The pure logic of «فیلدها» (design F §3.1, §3.3, §8.1, package F5): who may use which tab, the tab an address opens
// (old links included), the library's search and chips, usage lines, the type picker, a sheet's draft and what it
// sends, the live preview's field, the rows of «فیلدهای جدول‌ها» with their locks and blockers, and what promoting a
// table-only field to the library sends, and what adding one of the demo pack's fields says. No React, no requests:
// tested in tests/workflows-admin-fields-ui.test.ts (the pack notice in tests/workflows-admin-forms-ui.test.ts).
import type { AccessGate } from "@shared/access";
import type { Cond } from "@shared/model/conditions";
import type { FieldDef, FieldType, Option, TableDef } from "@shared/model/types";
import { FIELD_GROUPS, FIELD_TYPES } from "@shared/model/types";
import type { Level } from "@shared/permissions";
import {
  DISPLAY_KEYS, LIBRARY_NAME, TYPE_KEY, builtinFieldType, libraryFieldDef, resolveFieldType, typeRowSettings, widgetsFor,
  type BuiltinFieldType, type FieldTypeGroup, type FieldTypeSettings, type ResolvedFieldType, type SettingKey, type Widget,
} from "@shared/forms/fieldtypes";
import { lockedFields, type FieldLock } from "@shared/forms/locked";
import { FIELD_CHECKS } from "@shared/forms/validators";
import { tableDef } from "@shared/tables";
import type { RequiredFor } from "@shared/forms/paths";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import type { MoneyUnit } from "@shared/financial/logic";
import { faDigits } from "@shared/format";
import { matchesFa } from "../../../../lib/fa";
import type { RecordRow } from "../../../../records/model/types";
import type { FieldUsage, LibraryEntry, OrgTypeEntry, TypesResult } from "./api";

// ---------------------------------------------------------------------------------------------------------------
// Who may use what (the server stays the authority; these only decide what is offered)

export interface FieldsAccess {
  /** the library and the types are readable: `process_design` read or `settings` edit (F1's routes) */
  designRead: boolean;
  /** library fields and types are written: `process_design` write or `settings` edit */
  designWrite: boolean;
  /** `settings` edit: attaching library fields, «پنهان در فرم», «الزامی برای…», labels of a table's fields */
  settingsEdit: boolean;
  /** the `choice` and `custom_field` rows are readable (the generic API, area «تنظیمات») */
  settingsRead: boolean;
  /** choice options are changed or added (`choice` write and create) */
  choicesWrite: boolean;
  /** table-only fields are created, changed and removed (`custom_field` create and write) */
  customWrite: boolean;
}

export interface AccessProbe {
  /** the membership's level in a platform area */
  can: (area: "settings", level: Level) => boolean;
  /** the access model's grant */
  allows: (gate: AccessGate) => boolean;
  /** false while the organisation is read-only */
  writable: boolean;
}

export function fieldsAccess({ can, allows, writable }: AccessProbe): FieldsAccess {
  // F1's `holdsSettings(edit)`: the membership's level, or the access model's grant in «تنظیمات»
  const settingsEdit = can("settings", "edit") || allows({ area: "settings", op: "write" }) || allows({ area: "settings", op: "create" });
  const designRead = allows({ area: PROCESS_DESIGN_AREA }) || settingsEdit;
  const designWrite = allows({ area: PROCESS_DESIGN_AREA, op: "write" }) || allows({ area: PROCESS_DESIGN_AREA, op: "create" }) || settingsEdit;
  const settingsWrite = allows({ area: "settings", op: "write" });
  return {
    designRead,
    designWrite: writable && designWrite,
    settingsEdit: writable && settingsEdit,
    settingsRead: allows({ area: "settings" }),
    choicesWrite: writable && settingsWrite && allows({ area: "settings", op: "create" }),
    customWrite: writable && settingsWrite && allows({ area: "settings", op: "create" }),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tabs

export type FieldsTab = "library" | "types" | "choices" | "tables";

export const FIELDS_TABS: { key: FieldsTab; label: string }[] = [
  { key: "library", label: "کتابخانه" },
  { key: "types", label: "انواع فیلد" },
  { key: "choices", label: "فهرست‌های گزینه" },
  { key: "tables", label: "فیلدهای جدول‌ها" },
];

/** The tabs a person may open: the library's for its readers, the lists and the tables' fields for `settings` readers. */
export function visibleTabs(a: Pick<FieldsAccess, "designRead" | "settingsRead">): FieldsTab[] {
  return FIELDS_TABS.map((t) => t.key).filter((k) => (k === "library" || k === "types" ? a.designRead : a.settingsRead));
}

/**
 * The tab an address opens: `?tab=`, else an old link's parameter — `settings/fields?table=custom_03` (the studio,
 * the old custom-field manager) opens «فیلدهای جدول‌ها», `?list=` «فهرست‌های گزینه» — else the first tab the person
 * may open. A tab they may not open falls back the same way.
 */
export function tabOf(params: URLSearchParams, visible: readonly FieldsTab[]): FieldsTab | null {
  const asked = params.get("tab") as FieldsTab | null;
  if (asked && visible.includes(asked)) return asked;
  if (params.get("table") && visible.includes("tables")) return "tables";
  if (params.get("list") && visible.includes("choices")) return "choices";
  return visible[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// The library: search, chips, usage

export interface LibraryChip {
  key: "money" | "date" | "choice" | "people";
  label: string;
  groups: FieldTypeGroup[];
}

export const LIBRARY_CHIPS: LibraryChip[] = [
  { key: "money", label: "مبلغ", groups: ["money"] },
  { key: "date", label: "تاریخ", groups: ["date"] },
  { key: "choice", label: "گزینه", groups: ["choice"] },
  { key: "people", label: "افراد", groups: ["people"] },
];

export interface LibraryFilter {
  q: string;
  /** chips of type groups: a field of any of them */
  chips: LibraryChip["key"][];
  /** «بازنشسته»: only retired fields */
  retired: boolean;
}

export function filterLibrary(rows: readonly LibraryEntry[], f: LibraryFilter): LibraryEntry[] {
  const groups = new Set(LIBRARY_CHIPS.filter((c) => f.chips.includes(c.key)).flatMap((c) => c.groups));
  return rows.filter(
    (r) =>
      (!f.q.trim() || matchesFa(`${r.label} ${r.name} ${r.type_label} ${r.help ?? ""}`, f.q)) &&
      (!groups.size || (!!r.group && groups.has(r.group))) &&
      (!f.retired || r.status === "retired"),
  );
}

export const isUsed = (u: FieldUsage | null | undefined): boolean => !!u && u.tables.length + u.forms.length + u.versions.length > 0;

/** «۲ جدول، ۱ فرم، ۱ نسخهٔ منتشرشده»; empty when unused. */
export function usageText(u: FieldUsage | null | undefined): string {
  if (!u) return "";
  const parts: string[] = [];
  if (u.tables.length) parts.push(`${faDigits(u.tables.length)} جدول`);
  if (u.forms.length) parts.push(`${faDigits(u.forms.length)} فرم`);
  if (u.versions.length) parts.push(`${faDigits(u.versions.length)} نسخهٔ منتشرشده`);
  return parts.join("، ");
}

export const fieldGroupLabel = (g: string | null | undefined): string => (g && g in FIELD_GROUPS ? FIELD_GROUPS[g as keyof typeof FIELD_GROUPS] : "");

/** What «بازنشسته کردن» says before it happens. */
export const RETIRE_TEXT = "در فرم‌ها و نسخه‌های تازه پیشنهاد نمی‌شود؛ جاهایی که به کار رفته می‌ماند.";

// ---------------------------------------------------------------------------------------------------------------
// Types: what a sheet may pick and resolve

export interface TypeChoice {
  key: string;
  label: string;
  group: FieldTypeGroup;
  storage: FieldType;
  custom: boolean;
  retired: boolean;
}

/** Every type a field may be of: the built-in types this server can use, then the organisation's. */
export function typeChoices(t: TypesResult | undefined): TypeChoice[] {
  if (!t) return [];
  const out: TypeChoice[] = t.builtin.filter((b) => b.available).map((b) => ({ key: b.key, label: b.label, group: b.group, storage: b.storage, custom: false, retired: false }));
  for (const o of t.types) {
    const b = builtinFieldType(o.base);
    if (b) out.push({ key: o.key, label: o.name, group: b.group, storage: b.base, custom: true, retired: o.status === "retired" });
  }
  return out;
}

/**
 * The type picker's options, grouped like §3.1: retired types are offered for nothing new (a field keeps its own),
 * and a field already in use is offered only types of its storage (radio ↔ select).
 */
export function typeOptions(choices: readonly TypeChoice[], groups: Record<FieldTypeGroup, string>, o: { storage?: FieldType | null; current?: string | null } = {}) {
  const fits = choices.filter((c) => (!c.retired || c.key === o.current) && (!o.storage || c.storage === o.storage || c.key === o.current));
  return (Object.keys(groups) as FieldTypeGroup[])
    .map((g) => ({ label: groups[g], options: fits.filter((c) => c.group === g).map((c) => ({ value: c.key, label: c.custom ? `${c.label} (سازمان)` : c.label })) }))
    .filter((g) => g.options.length);
}

/** A type by key as the page knows it: a built-in type, or one of the organisation's with its resolved settings. */
export function resolvedType(key: string | null | undefined, t: TypesResult | undefined): ResolvedFieldType | null {
  if (!key) return null;
  const builtin = resolveFieldType(key);
  if (builtin) return builtin;
  const row = t?.types.find((x) => x.key === key);
  const b = row ? builtinFieldType(row.base) : undefined;
  if (!row || !b) return null;
  return { key: row.key, label: row.name, group: b.group, base: b.base, builtin: b, settings: { ...b.settings, ...(row.settings ?? {}), widget: (row.settings?.widget ?? b.settings.widget) as Widget }, custom: true, retired: row.status === "retired" };
}

// ---------------------------------------------------------------------------------------------------------------
// Settings of a type or a library field (the keys its built-in type allows)

export type OptionsMode = "inline" | "list" | "inherit";

export interface SettingsDraft {
  ltr?: boolean;
  maxLength?: number | null;
  pattern?: string;
  patternMessage?: string;
  min?: number | null;
  max?: number | null;
  decimals?: number | null;
  unit?: MoneyUnit | null;
  minDate?: string;
  maxDate?: string;
  accept?: string[];
  ref?: string | null;
  refFilter?: Cond | null;
  optionsMode: OptionsMode;
  options: Option[];
  choices?: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A draft from stored settings (a row's validation, display, options and choices). */
export function settingsDraft(raw: unknown, options: unknown, choices: unknown, inheritable = false): SettingsDraft {
  const s = obj(raw);
  const inline = Array.isArray(options) ? (options as Option[]) : [];
  const list = typeof choices === "string" && choices ? choices : null;
  return {
    ltr: s.ltr === true ? true : undefined,
    maxLength: num(s.maxLength),
    pattern: str(s.pattern),
    patternMessage: str(s.patternMessage),
    min: num(s.min),
    max: num(s.max),
    decimals: num(s.decimals),
    unit: s.unit === "rial" || s.unit === "toman" ? s.unit : null,
    minDate: str(s.minDate),
    maxDate: str(s.maxDate),
    accept: Array.isArray(s.accept) ? (s.accept as unknown[]).map(String) : [],
    ref: typeof s.ref === "string" ? s.ref : null,
    refFilter: s.refFilter && typeof s.refFilter === "object" ? (s.refFilter as Cond) : null,
    optionsMode: inline.length ? "inline" : list ? "list" : inheritable ? "inherit" : "inline",
    options: inline,
    choices: list,
  };
}

/** The keys of the draft a built-in type lets a type or a field set (options and choices apart). */
export const editableKeys = (b: BuiltinFieldType): SettingKey[] => b.editable.filter((k) => k !== "options" && k !== "choices");

/** The draft's settings the built-in type allows, empty ones left out (what the cleaner keeps). */
export function settingsOut(b: BuiltinFieldType, d: SettingsDraft): Partial<FieldTypeSettings> {
  const out: Record<string, unknown> = {};
  for (const k of editableKeys(b)) {
    const v = d[k as keyof SettingsDraft];
    if (v === undefined || v === null || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  if (!out.pattern) delete out.patternMessage;
  return out as Partial<FieldTypeSettings>;
}

/** Inline options as stored: trimmed, ordered, a label for each. */
export function cleanOptionList(options: readonly Option[]): Option[] {
  return options
    .filter((o) => o.value.trim())
    .map((o, i) => ({ ...o, value: o.value.trim(), label: o.label.trim() || o.value.trim(), order: i + 1 }));
}

/** Choice storage needs its options: inline, a shared list, or (an organisation's type that has them) the type's own. */
export const isChoiceStorage = (t: FieldType | null | undefined): boolean => t === "choice" || t === "multichoice";

/** The type carries options of its own (an organisation's choice type): its fields may keep them. */
export const typeHasOptions = (t: ResolvedFieldType | null | undefined): boolean => !!t && !!(t.settings.options?.length || t.settings.choices);

/** A draft's options mode as its type allows it: «گزینه‌های نوع» only when the type carries options. */
export const optionsModeOf = (d: SettingsDraft, t: ResolvedFieldType | null | undefined): OptionsMode =>
  d.optionsMode === "inherit" && !typeHasOptions(t) ? "inline" : d.optionsMode;

// ---------------------------------------------------------------------------------------------------------------
// A library field's sheet

export interface FieldDraft {
  /** the part after u_ */
  name: string;
  label: string;
  type: string;
  help: string;
  placeholder: string;
  default_value: string;
  depends_on: string | null;
  field_group: string | null;
  list: boolean;
  search: boolean;
  filter: boolean;
  settings: SettingsDraft;
}

export const NAME_PART = /^[a-z0-9_]{1,40}$/;

export function fieldDraft(row: RecordRow | null, defaultType = "string"): FieldDraft {
  const r = row ?? ({} as RecordRow);
  return {
    name: String(r.name ?? "").replace(/^u_/, ""),
    label: String(r.label ?? ""),
    type: String(r.type ?? defaultType),
    help: String(r.help ?? ""),
    placeholder: String(r.placeholder ?? ""),
    default_value: r.default_value === null || r.default_value === undefined ? "" : String(r.default_value),
    depends_on: typeof r.depends_on === "string" && r.depends_on ? r.depends_on : null,
    field_group: typeof r.field_group === "string" && r.field_group ? r.field_group : null,
    list: r.list === true,
    search: r.search === true,
    filter: r.filter === true,
    // an organisation's type may carry the options: the field then inherits them
    settings: settingsDraft(r.validation, r.options, r.choices, true),
  };
}

/** Problems the sheet shows before sending (the server checks everything again, in Persian). */
export function fieldDraftProblems(d: FieldDraft, t: ResolvedFieldType | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!NAME_PART.test(d.name)) out.name = "نام فنی فقط حرف کوچک لاتین، رقم و _ (حداکثر ۴۰ نویسه)";
  if (!d.label.trim()) out.label = "برچسب را بنویسید";
  if (!t) out.type = "نوع فیلد را برگزینید";
  if (t && isChoiceStorage(t.base)) {
    const mode = optionsModeOf(d.settings, t);
    const own = mode === "inline" ? cleanOptionList(d.settings.options).length > 0 : mode === "list" ? !!d.settings.choices : true;
    if (!own) out.options = mode === "list" ? "فهرست گزینه‌ها را برگزینید" : "دست‌کم یک گزینه بیفزایید";
  }
  if (t && t.builtin.editable.includes("ref") && !d.settings.ref && !t.settings.ref) out.ref = "جدول مقصد را برگزینید";
  return out;
}

/** What POST/PATCH /fields/library sends for a draft. */
export function fieldPayload(d: FieldDraft, t: ResolvedFieldType): Record<string, unknown> {
  const s = d.settings;
  const validation = settingsOut(t.builtin, s);
  const choice = isChoiceStorage(t.base);
  const mode = optionsModeOf(s, t);
  const text = FIELD_TYPES[t.base]?.sql === "text";
  return {
    name: `u_${d.name}`,
    label: d.label.trim(),
    type: d.type,
    help: d.help.trim() || null,
    placeholder: d.placeholder.trim() || null,
    default_value: d.default_value.trim() || null,
    options: choice && mode === "inline" ? cleanOptionList(s.options) : null,
    choices: choice && mode === "list" ? (s.choices ?? null) : null,
    depends_on: choice ? d.depends_on : null,
    validation: Object.keys(validation).length ? validation : null,
    field_group: d.field_group,
    list: d.list,
    search: d.search && text,
    filter: d.filter,
  };
}

/** The field a library draft makes, exactly as the engine's overlay would build it (the live preview). */
export function previewField(d: FieldDraft, t: ResolvedFieldType | null): FieldDef | null {
  if (!t) return null;
  const name = LIBRARY_NAME.test(`u_${d.name}`) ? `u_${d.name}` : "u_preview";
  const p = fieldPayload(d, t);
  return libraryFieldDef(
    { name, label: d.label.trim() || "پیش‌نمایش", type: d.type, help: d.help || null, placeholder: d.placeholder || null, options: p.options, choices: p.choices as string | null, validation: p.validation },
    t,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// An organisation's type's sheet

export interface TypeDraft {
  /** the part after u_ */
  key: string;
  name: string;
  base: string;
  widget: Widget | null;
  description: string;
  settings: SettingsDraft;
}

export function typeDraft(row: RecordRow | null, base = "string"): TypeDraft {
  const r = row ?? ({} as RecordRow);
  return {
    key: String(r.key ?? "").replace(/^u_/, ""),
    name: String(r.name ?? ""),
    base: String(r.base ?? base),
    widget: typeof r.widget === "string" && r.widget ? (r.widget as Widget) : null,
    description: String(r.description ?? ""),
    settings: settingsDraft({ ...obj(r.validation), ...obj(r.display) }, r.options, r.choices),
  };
}

export function typeDraftProblems(d: TypeDraft): Record<string, string> {
  const out: Record<string, string> = {};
  if (!TYPE_KEY.test(`u_${d.key}`)) out.key = "کلید فقط حرف کوچک لاتین، رقم و _ (حداکثر ۴۰ نویسه)";
  if (!d.name.trim()) out.name = "نام نوع را بنویسید";
  if (!builtinFieldType(d.base)) out.base = "نوع پایه را برگزینید";
  return out;
}

/** What POST/PATCH /fields/types sends: the widget in its column, `ltr` and `unit` in `display`, the rest in `validation`. */
export function typePayload(d: TypeDraft): Record<string, unknown> {
  const b = builtinFieldType(d.base);
  const all = b ? (settingsOut(b, d.settings) as Record<string, unknown>) : {};
  const display: Record<string, unknown> = {};
  const validation: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) ((DISPLAY_KEYS as string[]).includes(k) ? display : validation)[k] = v;
  const choice = !!b && isChoiceStorage(b.base);
  return {
    key: `u_${d.key}`,
    name: d.name.trim(),
    base: d.base,
    widget: b && d.widget && widgetsFor(b.base, b.settings.ref).includes(d.widget) ? d.widget : null,
    validation: Object.keys(validation).length ? validation : null,
    display: Object.keys(display).length ? display : null,
    options: choice && d.settings.optionsMode === "inline" && d.settings.options.length ? cleanOptionList(d.settings.options) : null,
    choices: choice && d.settings.optionsMode === "list" ? (d.settings.choices ?? null) : null,
    description: d.description.trim() || null,
  };
}

/** The type a draft makes (its preview, and the settings its fields would start from). */
export function draftType(d: TypeDraft): ResolvedFieldType | null {
  const b = builtinFieldType(d.base);
  if (!b) return null;
  const p = typePayload(d);
  const { settings } = typeRowSettings(b, { widget: p.widget as string | null, validation: p.validation, display: p.display, options: p.options, choices: p.choices as string | null });
  return { key: `u_${d.key || "preview"}`, label: d.name || b.label, group: b.group, base: b.base, builtin: b, settings, custom: true, retired: false };
}

export const typeOfEntry = (e: OrgTypeEntry): string => e.base_label;

/** A type's fixed settings in words («بررسی کد ملی»، «چپ‌به‌راست»، «تا ۵ پرونده»…), for its read-only sheet. */
export function settingsLines(t: ResolvedFieldType): string[] {
  const s = t.settings;
  const out: string[] = [];
  if (s.check && s.check !== "attachments") out.push(`بررسی ${FIELD_CHECKS[s.check].label}`);
  if (s.ltr) out.push("چپ‌به‌راست");
  if (s.check === "attachments") out.push(`تا ${faDigits(s.max ?? 0)} پرونده`);
  else if (t.base === "rating" && s.max) out.push(`تا ${faDigits(s.max)} ستاره`);
  if (s.decimals !== undefined) out.push(s.decimals ? `${faDigits(s.decimals)} رقم اعشار` : "بی‌اعشار");
  if (s.ref) out.push(`از «${tableDef(s.ref)?.plural ?? s.ref}»`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// «فیلدهای جدول‌ها»

export type TableFieldKind = "module" | "library" | "table";

export interface TableFieldRow {
  name: string;
  label: string;
  type: FieldType;
  kind: TableFieldKind;
  /** a module field's own label, when the organisation relabelled it */
  defaultLabel: string | null;
  help: string | null;
  placeholder: string | null;
  formHidden: boolean;
  formRequired: RequiredFor | null;
  /** the module requires it (never the organisation's requirement) */
  moduleRequired: boolean;
  locks: FieldLock[];
  /** an organisation field that is switched off (its values stay in the records) */
  active: boolean;
  /** its `custom_field` row: the field itself (u_*) or the override of a module field */
  row: RecordRow | null;
}

export const KIND_LABELS: Record<TableFieldKind, string> = { module: "فیلد ماژول", library: "از کتابخانه", table: "فیلد همین جدول" };

/**
 * Every field of a table as its form knows it — form-hidden ones included, module-internal ones (`hidden`) and base
 * columns left out — then the organisation's fields that are switched off. `eff` is the organisation's definition (the
 * schema the page reads), `base` the module's (the registry: locks and what the module requires), `rows` the table's
 * `custom_field` rows.
 */
export function tableFieldRows(eff: Pick<TableDef, "fields">, base: TableDef | undefined, rows: readonly RecordRow[]): TableFieldRow[] {
  const locks = base ? lockedFields(base) : {};
  const own = new Map((base?.fields ?? []).filter((f) => !f.custom).map((f) => [f.name, f]));
  const rowOf = (name: string) => rows.find((r) => r.name === name && r.active !== false) ?? rows.find((r) => r.name === name) ?? null;
  const out: TableFieldRow[] = eff.fields
    .filter((f) => !f.base && !f.hidden)
    .map((f) => {
      const module = own.get(f.name);
      return {
        name: f.name,
        label: f.label,
        type: f.type,
        kind: f.library ? "library" : f.custom ? "table" : "module",
        defaultLabel: module && module.label !== f.label ? module.label : null,
        help: f.help ?? null,
        placeholder: f.placeholder ?? null,
        formHidden: !!f.formHidden,
        formRequired: f.formRequired ?? null,
        moduleRequired: !!module?.required,
        locks: f.custom ? [] : (locks[f.name] ?? []),
        active: true,
        row: rowOf(f.name),
      };
    });
  const listed = new Set(out.map((r) => r.name));
  for (const r of rows) {
    const name = String(r.name ?? "");
    if (!name.startsWith("u_") || listed.has(name) || r.active !== false) continue;
    listed.add(name);
    out.push({
      name, label: String(r.label ?? name), type: (r.type as FieldType) ?? "string", kind: r.library_id ? "library" : "table", defaultLabel: null,
      help: (r.help as string) ?? null, placeholder: (r.placeholder as string) ?? null, formHidden: r.form_hidden === true, formRequired: null,
      moduleRequired: false, locks: [], active: false, row: r,
    });
  }
  return out;
}

const lockText = (locks: readonly FieldLock[]) => `قفل است: ${locks.map((l) => l.label).join("، ")}`;

/** Why «پنهان در فرم» is not offered for a field (the server refuses the same, with the same reasons), or null. */
export function hideBlocker(r: TableFieldRow): string | null {
  if (!r.active) return "این فیلد خاموش است";
  if (r.locks.length) return lockText(r.locks);
  if (r.moduleRequired) return "ماژول آن را الزامی می‌خواهد";
  if (r.formRequired) return "الزامی است؛ نخست الزام را بردارید";
  return null;
}

/** Why «الزامی برای…» is not offered for a field, or null. */
export function requireBlocker(r: TableFieldRow): string | null {
  if (!r.active) return "این فیلد خاموش است";
  if (r.locks.length) return lockText(r.locks);
  if (r.formHidden) return "در فرم پنهان است؛ نخست آن را در فرم نمایش دهید";
  return null;
}

/** The organisation's requirement: «الزامی برای همه» / «الزامی برای کارشناسان» (the module's shows as a lock chip). */
export function requirementText(r: TableFieldRow): string | null {
  if (r.formRequired === "agents") return "الزامی برای کارشناسان";
  if (r.formRequired === "all") return "الزامی برای همه";
  return null;
}

/** Library fields that may be added to a table: active, not on it yet. */
export function attachable(lib: readonly LibraryEntry[], table: string, onTable: ReadonlySet<string>): LibraryEntry[] {
  return lib.filter((f) => f.status !== "retired" && !f.usage.tables.includes(table) && !onTable.has(f.name)).sort((a, b) => a.label.localeCompare(b.label, "fa"));
}

/**
 * What adding one of the demo pack's library fields to the organisation's own form or table says (release 1.1.5: the
 * form designers' palettes and «افزودن از کتابخانه»): «حذف داده‌های نمایشی» takes it out again — from a process form
 * (its published versions keep their snapshot), and from a table together with the values its records stored under it
 * (modules/demo/refs.ts). null: no pack field, or a form of the pack's own (it leaves whole with the pack).
 */
export function packFieldNotice(entry: Pick<LibraryEntry, "label" | "demo"> | null | undefined, place: { form: { demo?: boolean } } | { table: string }): string | null {
  if (!entry?.demo) return null;
  if ("form" in place) return place.form.demo ? null : `«${entry.label}» از دادهٔ نمایشی است؛ با «حذف داده‌های نمایشی» از این فرم برداشته می‌شود.`;
  return `«${entry.label}» از دادهٔ نمایشی است؛ با «حذف داده‌های نمایشی» از «${place.table}» برداشته می‌شود و مقدارهایی که رکوردها در آن ثبت کنند هم پاک می‌شود.`;
}

// ---------------------------------------------------------------------------------------------------------------
// «افزودن به کتابخانه»: a table-only field becomes a library field of the same name and storage

/** The built-in type that stores what each storage type of a table-only field stores (references by target below). */
const TYPE_OF_STORAGE: Partial<Record<FieldType, string>> = {
  string: "string", text: "text", markdown: "markdown", email: "email", url: "url", phone: "phone", ip: "ip", int: "int", decimal: "decimal",
  percent: "percent", rating: "rating", duration: "duration", money: "money", bool: "switch", choice: "select", multichoice: "multiselect",
  tags: "tags", date: "date", datetime: "datetime", user: "user", users: "users", group: "group", color: "color",
};
const REF_TYPES: Record<string, string> = { org_unit: "unit", location: "location", position: "position" };

/**
 * What POST /fields/library sends to make a library field of a table-only field (its `custom_field` row): same name,
 * label, storage, options or list and target table, so its stored values keep their meaning; the row is then pointed at
 * the new library field. A problem instead when it cannot be one.
 */
export function promoteBody(row: RecordRow): { body: Record<string, unknown> } | { problem: string } {
  const name = String(row.name ?? "");
  if (!LIBRARY_NAME.test(name)) return { problem: "فقط فیلدهای سازمان (u_…) به کتابخانه افزوده می‌شوند" };
  if (row.library_id) return { problem: "این فیلد از کتابخانه است" };
  const storage = row.type as FieldType;
  const validation: Record<string, unknown> = {};
  let type = TYPE_OF_STORAGE[storage];
  if (storage === "ref" || storage === "refs") {
    const target = String(row.ref ?? "");
    if (!target) return { problem: "جدول مقصد این فیلد معلوم نیست" };
    if (storage === "ref" && REF_TYPES[target]) type = REF_TYPES[target];
    else {
      type = storage === "ref" ? "record" : "records";
      validation.ref = target;
    }
  }
  if (!type) return { problem: `فیلدهای «${FIELD_TYPES[storage]?.label ?? storage}» به کتابخانه افزوده نمی‌شوند` };
  const b = builtinFieldType(type)!;
  if (b.editable.includes("maxLength") && typeof row.max_length === "number" && row.max_length > 0) validation.maxLength = row.max_length;
  const choice = isChoiceStorage(storage);
  const body: Record<string, unknown> = {
    name,
    label: String(row.label ?? name),
    type,
    help: row.help ?? null,
    options: choice && !row.choices && Array.isArray(row.options) ? cleanOptionList(row.options as Option[]) : null,
    choices: choice && row.choices ? row.choices : null,
    validation: Object.keys(validation).length ? validation : null,
    field_group: row.field_group ?? null,
    list: row.list === true,
    search: row.search === true && FIELD_TYPES[storage]?.sql === "text",
    filter: row.filter === true,
  };
  return { body };
}
