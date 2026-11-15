// The forms of a process version (design F §3.2, D10, package F2). At publish, `snapshotForms` writes into the version
// each form's layout and everything a replica needs about every field the forms use: the storage type, widget, label,
// help, placeholder and default; the validation (pattern and its message, the named check, min, max, decimals,
// maxLength, date limits, accepted files); the options — inline ones, or the shared list's options as they are at
// publish; `ref` and `refFilter`; the field group and the money unit. A Windows app shows and checks a step from the
// version alone (`readSnapshot`, `snapshotFields`): it never needs `field_def`, `field_type`, `custom_field` or `choice`
// rows, and a field retired or changed later never changes a running case.
// A later change to a shared list reaches running processes with the next publish: the snapshot keeps a fingerprint of
// each list it resolved, so the hub can name the processes that carry an older one (`listsChanged`: «فهرست "…" پس از
// انتشار تغییر کرده است»).
// Imported by the UI: keep it free of server imports.
import type { FieldDef, FieldGroup, FieldType, Option } from "../model/types";
import { COLOR_KEYS, FIELD_GROUPS, FIELD_TYPES } from "../model/types";
import { cleanFormLayout, layoutFields, type FormLayoutV2 } from "./layout";
import { isFieldCheck } from "./validators";

export const SNAPSHOT_VERSION = 1;

export interface SnapshotForm {
  id: string;
  name: string;
  /** the form's version: how many publishes took a changed layout of it */
  version_no: number;
  layout: FormLayoutV2;
}

export interface SnapshotList {
  /** the fingerprint of the list's options at publish (`optionsFingerprint`) */
  hash: string;
  /** the fields of the snapshot whose options it gave */
  fields: string[];
}

export interface FormsSnapshot {
  v: typeof SNAPSHOT_VERSION;
  /** when it was taken (ISO instant) */
  at: string;
  /** the forms, by id */
  forms: Record<string, SnapshotForm>;
  /** every library field the forms use, by name: its whole definition, with its options resolved */
  fields: Record<string, FieldDef>;
  /** the shared choice lists resolved into fields, by key */
  lists: Record<string, SnapshotList>;
}

/** Keys of a field's definition a snapshot keeps (list columns, search, sorting and sections belong to tables). */
export const SNAPSHOT_FIELD_KEYS = [
  "label", "type", "widget", "help", "placeholder", "default", "choices", "dependsOn", "ref", "refFilter", "min", "max", "maxLength", "ltr",
  "pattern", "patternMessage", "check", "decimals", "unit", "minDate", "maxDate", "accept", "group", "library",
] as const satisfies readonly (keyof FieldDef)[];

/** Storage types a form field never has (secrets never travel; conditions are not values people enter). */
const NOT_IN_FORMS = new Set<FieldType>(["secret", "conditions"]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function parse(raw: unknown): Record<string, unknown> | null {
  let o: unknown = raw;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return isObj(o) ? o : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Fingerprints

function fnv(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A short fingerprint of a text (two 32-bit FNV-1a passes): enough to tell a change, never a secret. */
export function textHash(s: string): string {
  return fnv(s, 0x811c9dc5).toString(16).padStart(8, "0") + fnv(s, 0x050c5d1f).toString(16).padStart(8, "0");
}

/** JSON with keys in a stable order (two equal values give the same text). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (isObj(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** The fingerprint of a list's options: what people see and pick (value, label, colour, order, parent, active). */
export function optionsFingerprint(options: readonly Option[]): string {
  return textHash(stableJson(options.map((o) => [o.value, o.label, o.color ?? null, o.order ?? null, o.parent ?? null, o.active !== false])));
}

/** The fingerprint of a layout (a form's layout changed since a publish?). */
export const layoutHash = (layout: FormLayoutV2): string => textHash(stableJson(layout));

// ---------------------------------------------------------------------------------------------------------------
// Taking a snapshot

/** A row of `form` (the columns the snapshot reads). */
export interface FormRowLike {
  id: string;
  name: string;
  layout: unknown;
  version_no?: number | null;
}

/** A library field as the online form builds it (`libraryFieldDef` of its row and type), with its status. */
export interface LibraryFieldLike {
  def: FieldDef | null;
  retired: boolean;
}

export interface SnapshotEnv {
  /** the organisation's library field of that name (null when there is none) */
  field(name: string): LibraryFieldLike | null | undefined;
  /** the organisation's options of a shared choice list, now */
  choices(list: string): Option[];
  /** the instant of the snapshot (default now) */
  at?: string;
}

const cloneOption = (o: Option): Option => {
  const out: Option = { value: String(o.value), label: String(o.label ?? o.value) };
  if (o.color) out.color = o.color;
  if (typeof o.order === "number") out.order = o.order;
  if (o.active === false) out.active = false;
  if (o.parent) out.parent = o.parent;
  if (o.locked) out.locked = true;
  return out;
};

/** A field's definition as a snapshot keeps it (`choices` always an array of options). */
function frozen(name: string, f: FieldDef, env: SnapshotEnv, lists: Record<string, SnapshotList>): FieldDef {
  const out = { name } as FieldDef;
  const src = f as unknown as Record<string, unknown>;
  const dst = out as unknown as Record<string, unknown>;
  for (const k of SNAPSHOT_FIELD_KEYS) if (src[k] !== undefined && src[k] !== null) dst[k] = clone(src[k]);
  if (f.type === "choice" || f.type === "multichoice") {
    if (typeof f.choices === "string") {
      const options = env.choices(f.choices).map(cloneOption);
      const list = (lists[f.choices] ??= { hash: optionsFingerprint(options), fields: [] });
      list.fields.push(name);
      out.choices = options;
    } else out.choices = (Array.isArray(f.choices) ? f.choices : []).map(cloneOption);
  } else delete out.choices;
  out.library ??= name;
  return out;
}

/**
 * The snapshot of `forms` for a version: each layout (clean), and every field the layouts use, from the library as the
 * online forms build it, with shared lists resolved. `problems` names what a publish must refuse: a form or a field
 * that is missing or cannot be used, and retired fields (a new version is never built on one). The snapshot leaves
 * such fields out.
 */
export function snapshotForms(forms: readonly FormRowLike[], env: SnapshotEnv): { snapshot: FormsSnapshot; problems: string[] } {
  const problems: string[] = [];
  const out: FormsSnapshot = { v: SNAPSHOT_VERSION, at: env.at ?? new Date().toISOString(), forms: {}, fields: {}, lists: {} };
  const defs = new Map<string, FieldDef>();
  for (const row of forms) {
    const layout = cleanFormLayout(row.layout);
    out.forms[row.id] = { id: row.id, name: row.name, version_no: Number(row.version_no ?? 0) || 0, layout };
    for (const name of layoutFields(layout)) {
      if (defs.has(name)) continue;
      const lib = env.field(name);
      if (!lib?.def) {
        problems.push(`فیلد «${name}» فرم «${row.name}» در کتابخانه نیست یا به کار نمی‌رود`);
        continue;
      }
      if (lib.retired) {
        problems.push(`فیلد «${lib.def.label}» فرم «${row.name}» بازنشسته است؛ آن را از فرم بردارید یا دوباره فعال کنید`);
        continue;
      }
      if (NOT_IN_FORMS.has(lib.def.type)) {
        problems.push(`فیلد «${lib.def.label}» در فرم‌ها به کار نمی‌رود`);
        continue;
      }
      defs.set(name, lib.def);
    }
  }
  for (const [name, f] of defs) out.fields[name] = frozen(name, f, env, out.lists);
  // a field depends on another one only when both travel with the version
  for (const f of Object.values(out.fields)) if (f.dependsOn && !out.fields[f.dependsOn]) delete f.dependsOn;
  return { snapshot: out, problems: [...new Set(problems)] };
}

// ---------------------------------------------------------------------------------------------------------------
// Reading a snapshot (what a version row holds, possibly from an older runtime: never trusted blindly)

const STRING_KEYS = ["widget", "help", "placeholder", "dependsOn", "ref", "pattern", "patternMessage", "minDate", "maxDate", "library"] as const;
const NUMBER_KEYS = ["min", "max", "maxLength", "decimals"] as const;

function readOptions(raw: unknown): Option[] {
  const out: Option[] = [];
  const seen = new Set<string>();
  for (const o of Array.isArray(raw) ? raw : []) {
    if (!isObj(o) || o.value === undefined || o.value === null) continue;
    const value = String(o.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const opt: Option = { value, label: typeof o.label === "string" && o.label ? o.label : value };
    if (typeof o.color === "string" && (COLOR_KEYS as readonly string[]).includes(o.color)) opt.color = o.color as Option["color"];
    if (typeof o.order === "number" && Number.isFinite(o.order)) opt.order = o.order;
    if (o.active === false) opt.active = false;
    if (typeof o.parent === "string" && o.parent) opt.parent = o.parent;
    if (o.locked === true) opt.locked = true;
    out.push(opt);
  }
  return out;
}

/** One field of a stored snapshot (null when it cannot be a form field). */
export function readSnapshotField(name: string, raw: unknown): FieldDef | null {
  if (!isObj(raw)) return null;
  const type = raw.type as FieldType;
  if (typeof type !== "string" || !(type in FIELD_TYPES) || NOT_IN_FORMS.has(type)) return null;
  if (typeof raw.label !== "string" || !raw.label) return null;
  const f: FieldDef = { name, label: raw.label, type };
  const dst = f as unknown as Record<string, unknown>;
  for (const k of STRING_KEYS) if (typeof raw[k] === "string" && raw[k]) dst[k] = raw[k];
  for (const k of NUMBER_KEYS) if (typeof raw[k] === "number" && Number.isFinite(raw[k])) dst[k] = raw[k];
  if (raw.ltr === true) f.ltr = true;
  if (isFieldCheck(raw.check)) f.check = raw.check;
  if (raw.unit === "rial" || raw.unit === "toman") f.unit = raw.unit;
  if (typeof raw.group === "string" && raw.group in FIELD_GROUPS) f.group = raw.group as FieldGroup;
  if (Array.isArray(raw.accept)) f.accept = raw.accept.filter((a): a is string => typeof a === "string").slice(0, 40);
  if (isObj(raw.refFilter)) f.refFilter = clone(raw.refFilter) as FieldDef["refFilter"];
  if (raw.default !== undefined && raw.default !== null) f.default = clone(raw.default);
  if (type === "choice" || type === "multichoice") f.choices = readOptions(raw.choices);
  if ((type === "ref" || type === "refs") && !f.ref) return null;
  return f;
}

/** A stored snapshot (the version's `forms`), checked; null when it is not one. */
export function readSnapshot(raw: unknown): FormsSnapshot | null {
  const o = parse(raw);
  if (!o || o.v !== SNAPSHOT_VERSION || !isObj(o.forms) || !isObj(o.fields)) return null;
  const fields: Record<string, FieldDef> = {};
  for (const [name, x] of Object.entries(o.fields)) {
    const f = readSnapshotField(name, x);
    if (f) fields[name] = f;
  }
  const forms: Record<string, SnapshotForm> = {};
  for (const [id, x] of Object.entries(o.forms)) {
    if (!isObj(x)) continue;
    forms[id] = { id, name: typeof x.name === "string" && x.name ? x.name : id, version_no: typeof x.version_no === "number" ? x.version_no : 0, layout: cleanFormLayout(x.layout) };
  }
  const lists: Record<string, SnapshotList> = {};
  for (const [key, x] of Object.entries(isObj(o.lists) ? o.lists : {})) {
    if (!isObj(x) || typeof x.hash !== "string") continue;
    lists[key] = { hash: x.hash, fields: Array.isArray(x.fields) ? x.fields.filter((n): n is string => typeof n === "string") : [] };
  }
  return { v: SNAPSHOT_VERSION, at: typeof o.at === "string" ? o.at : "", forms, fields, lists };
}

/** The fields of a snapshot by name (a FieldSource for `effectiveRights`, `formView` and the value checks). */
export const snapshotFields = (s: FormsSnapshot): Map<string, FieldDef> => new Map(Object.entries(s.fields));

/** The shared lists whose options changed since the snapshot was taken (their keys). */
export function listsChanged(s: FormsSnapshot, choices: (list: string) => Option[]): string[] {
  return Object.entries(s.lists)
    .filter(([key, l]) => optionsFingerprint(choices(key)) !== l.hash)
    .map(([key]) => key);
}
