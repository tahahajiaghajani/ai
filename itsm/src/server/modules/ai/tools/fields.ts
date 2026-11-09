// Field metadata for the generated record tools (docs/spec/AI.md §11.8). One place decides, for every table and field:
//   · what a tool shows a model or accepts from one — the fields the caller sees (the engine strips the rest), never a
//     secret, an `ai_private` field, a field kept out of replicas (`noSync`) or one a module keeps from models
//     (`keepFromPrompts`), never the engine's bookkeeping columns;
//   · how a field is described to a model: its label, type, required or not, the Persian labels of its choices and the
//     table a reference points at — so the schemas follow the metadata, and a table added later is covered as is;
//   · how a value a model sends becomes what the field stores: choices by value or by label, references by the display
//     value of a record THE CALLER may read (a name never resolves to a record they cannot see), members by name,
//     Jalali or ISO dates, Persian digits — with a Persian error the model can act on;
//   · how a row reads to a model: choice labels, names, Jalali dates (the values the record page shows).
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { FieldDef, TableDef } from "@shared/model/types";
import { refTarget } from "@shared/model/types";
import { OPS, opsFor, type Cond, type Op } from "@shared/model/conditions";
import { normalizeDigits } from "@shared/money";
import { list, optionsOf, parseDate, parseDateTime, type OrgSchema } from "../../../engine";
import { access } from "../../../access/provider";
import { readableIds } from "../../../access/service";
import { keptFromPrompts, promptValue } from "../skills/context";
import { faNorm } from "./common";

/** Engine columns a tool never shows or accepts (the id and the number are returned on their own). */
const BOOKKEEPING = new Set(["org_id", "no", "rev", "version", "deleted_at", "origin", "custom", "workspace_id", "domain_id"]);
/** Types a tool does not read or write (structured definitions, secrets). */
const OPAQUE = new Set(["json", "conditions", "secret"]);
const MAX_TEXT = 1500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** May this field reach a model through a generated tool at all (the caller's own visibility comes on top)? */
export function toolField(def: TableDef, f: FieldDef): boolean {
  if (OPAQUE.has(f.type) || f.group === "ai_private" || f.noSync) return false;
  if (BOOKKEEPING.has(f.name)) return false;
  if (keptFromPrompts(def.key).has(f.name)) return false;
  return true;
}

/** The fields of `def` a tool shows this caller (in form order). */
export function shownFields(ctx: Ctx, def: TableDef): FieldDef[] {
  const visible = access().visibleFields(ctx, def);
  return def.fields.filter((f) => toolField(def, f) && !f.hidden && (!visible || visible.has(f.name)));
}

/** The fields a caller may set through a draft (a new record: `row` null). */
export function settableFields(ctx: Ctx, def: TableDef, row: Record<string, unknown> | null): FieldDef[] {
  const visible = access().visibleFields(ctx, def);
  const writable = access().writableFields(ctx, def, row);
  return def.fields.filter(
    (f) =>
      toolField(def, f) &&
      !f.readonly &&
      !f.system &&
      !f.base &&
      !(def.states && f.name === def.states.field) &&
      (!visible || visible.has(f.name)) &&
      (!writable || writable.has(f.name)),
  );
}

const typeWord: Record<string, string> = {
  string: "text", text: "long text", markdown: "markdown text", int: "integer", decimal: "decimal", money: "amount (Rial, decimal string)",
  percent: "percent", bool: "yes/no", date: "date (Jalali «1405/08/12» or ISO)", datetime: "date-time (Jalali or ISO)", duration: "seconds",
  choice: "choice", multichoice: "choices (list)", ref: "reference", refs: "references (list)", user: "member", users: "members (list)",
  group: "group", email: "e-mail", url: "URL", phone: "phone", ip: "IP address", tags: "tags (list)", color: "colour", rating: "rating",
};

/** One line describing a field to a model: name, label, type, choices (value=label), the referenced table. */
export function fieldLine(schema: OrgSchema, def: TableDef, f: FieldDef, opts: { required?: boolean } = {}): string {
  const parts = [`${f.name} «${f.label}»: ${typeWord[f.type] ?? f.type}`];
  const target = refTarget(f, def.key);
  if (target && target !== "user") parts.push(`→ ${target} (give its name, number or id)`);
  if (target === "user") parts.push("(give the person's name or id)");
  if (f.type === "choice" || f.type === "multichoice") {
    const opts2 = optionsOf(f, schema).filter((o) => o.active !== false);
    if (opts2.length) parts.push(`[${opts2.slice(0, 24).map((o) => (o.value === o.label ? o.value : `${o.value}=${o.label}`)).join(", ")}${opts2.length > 24 ? ", …" : ""}]`);
  }
  if (opts.required) parts.push("REQUIRED");
  return parts.join(" ");
}

/** A field's value in a draft (lenient: the server matches labels, names and Jalali dates). */
function inputSchema(schema: OrgSchema, def: TableDef, f: FieldDef): z.ZodTypeAny {
  const d = fieldLine(schema, def, f);
  switch (f.type) {
    case "int":
    case "decimal":
    case "money":
    case "percent":
    case "rating":
    case "duration":
      return z.union([z.number(), z.string().max(40)]).describe(d);
    case "bool":
      return z.union([z.boolean(), z.string().max(10)]).describe(d);
    case "multichoice":
    case "refs":
    case "users":
    case "tags":
      return z.union([z.array(z.string().max(200)).max(50), z.string().max(400)]).describe(d);
    default:
      return z.string().max(f.maxLength ?? 20_000).describe(d);
  }
}

/** The `values` object of a draft: one optional property per settable field. */
export function valuesSchema(schema: OrgSchema, def: TableDef, fields: FieldDef[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields.slice(0, 80)) shape[f.name] = inputSchema(schema, def, f).optional();
  return z.object(shape);
}

// ---------------------------------------------------------------- values a model sends

type Resolved = { value: unknown } | { error: string };

const normDigits = (s: string) => normalizeDigits(s).replace(/[٬,]/g, "").trim();

async function resolveRef(ctx: Ctx, target: string, raw: string, label: string): Promise<Resolved> {
  const s = raw.trim();
  if (!s) return { value: null };
  if (UUID_RE.test(s)) {
    if (target === "user") return { value: s.toLowerCase() };
    const ok = await readableIds(ctx, target, [s]).catch(() => new Set<string>());
    return ok.has(s.toLowerCase()) ? { value: s.toLowerCase() } : { error: `«${label}»: رکوردی با این شناسه در دسترس شما نیست` };
  }
  // a number, a name or words of it: a record the caller may read (members by name)
  const r = await list(ctx, target, { q: s.slice(0, 120), size: 5, total: false }).catch(() => null);
  if (!r?.rows.length) return { error: `«${label}»: «${s}» پیدا نشد (یا در دسترس شما نیست)` };
  const norm = faNorm(s);
  const exact = r.rows.find((x) => faNorm(r.display[String(x.id)] ?? "") === norm || faNorm(String(x.number ?? "")) === norm);
  if (!exact && r.rows.length > 1) {
    const names = r.rows.slice(0, 5).map((x) => r.display[String(x.id)] ?? String(x.number ?? x.id));
    return { error: `«${label}»: «${s}» با چند رکورد جور است (${names.join("، ")}); دقیق‌تر بنویسید` };
  }
  return { value: String((exact ?? r.rows[0]).id) };
}

/** A value a model sent for `f`, matched to what the field stores — or a Persian error the model can act on. */
export async function resolveValue(ctx: Ctx, schema: OrgSchema, def: TableDef, f: FieldDef, raw: unknown, tz: string): Promise<Resolved> {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) return { value: null };
  const many = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v).split(/[،,]/)).map((x) => x.trim()).filter(Boolean);
  switch (f.type) {
    case "choice":
    case "color": {
      const opts = optionsOf(f, schema);
      if (!opts.length) return { value: String(raw) };
      const s = faNorm(String(raw));
      const o = opts.find((x) => faNorm(x.value) === s) ?? opts.find((x) => faNorm(x.label) === s);
      if (!o) return { error: `«${f.label}»: «${raw}» در گزینه‌ها نیست (${opts.filter((x) => x.active !== false).slice(0, 12).map((x) => x.label).join("، ")})` };
      return { value: o.value };
    }
    case "multichoice": {
      const opts = optionsOf(f, schema);
      const out: string[] = [];
      for (const v of many(raw)) {
        const s = faNorm(v);
        const o = opts.find((x) => faNorm(x.value) === s) ?? opts.find((x) => faNorm(x.label) === s);
        if (!o) return { error: `«${f.label}»: «${v}» در گزینه‌ها نیست` };
        out.push(o.value);
      }
      return { value: out };
    }
    case "tags":
      return { value: many(raw).slice(0, 20) };
    case "bool": {
      if (typeof raw === "boolean") return { value: raw };
      const s = faNorm(String(raw));
      if (/^(true|1|yes|بله|بلی|آری|درست)$/.test(s)) return { value: true };
      if (/^(false|0|no|خیر|نه|نادرست)$/.test(s)) return { value: false };
      return { error: `«${f.label}» بله یا خیر است` };
    }
    case "int":
    case "rating":
    case "duration": {
      const n = Number(normDigits(String(raw)));
      if (!Number.isFinite(n)) return { error: `«${f.label}» باید عدد باشد` };
      return { value: Math.round(n) };
    }
    case "decimal":
    case "money":
    case "percent": {
      const s = normDigits(String(raw));
      if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: `«${f.label}» باید عدد باشد` };
      return { value: s };
    }
    case "date": {
      const d = parseDate(String(raw), tz);
      return d ? { value: d } : { error: `«${f.label}»: تاریخ «${raw}» خوانده نشد (مثل ۱۴۰۵/۰۸/۱۲)` };
    }
    case "datetime": {
      const d = parseDateTime(String(raw), tz);
      return d ? { value: d } : { error: `«${f.label}»: زمان «${raw}» خوانده نشد` };
    }
    case "ref":
    case "user":
    case "group":
      return resolveRef(ctx, refTarget(f, def.key) ?? "", Array.isArray(raw) ? String(raw[0] ?? "") : String(raw), f.label);
    case "refs":
    case "users": {
      const target = refTarget(f, def.key) ?? "";
      const out: string[] = [];
      for (const v of many(raw).slice(0, 50)) {
        const r = await resolveRef(ctx, target, v, f.label);
        if ("error" in r) return r;
        if (r.value) out.push(String(r.value));
      }
      return { value: out };
    }
    default: {
      const s = Array.isArray(raw) ? raw.join("، ") : String(raw);
      return { value: f.maxLength ? s.slice(0, f.maxLength) : s.slice(0, 100_000) };
    }
  }
}

/** Values of a draft, matched field by field (unknown or unsettable fields are refused by name). */
export async function resolveValues(
  ctx: Ctx,
  schema: OrgSchema,
  def: TableDef,
  allowed: FieldDef[],
  input: Record<string, unknown>,
  tz: string,
): Promise<{ data: Record<string, unknown>; problems: string[] }> {
  const data: Record<string, unknown> = {};
  const problems: string[] = [];
  const byName = new Map(allowed.map((f) => [f.name, f]));
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v === undefined) continue;
    const f = byName.get(k);
    if (!f) {
      const known = def.fields.find((x) => x.name === k);
      problems.push(known ? `«${known.label}» را با این ابزار نمی‌توانید تغییر دهید` : `فیلد «${k}» در «${def.label}» نیست`);
      continue;
    }
    const r = await resolveValue(ctx, schema, def, f, v, tz);
    if ("error" in r) problems.push(r.error);
    else data[k] = r.value;
  }
  return { data, problems };
}

// ---------------------------------------------------------------- filters a model sends

export interface WhereLeaf {
  field: string;
  op: string;
  value?: unknown;
}

const LEAF_OPS = Object.keys(OPS).filter((o) => !OPS[o as Op].rule) as Op[];

/** The `where` list of a search or an aggregate (all of them, or any of them, hold). */
export const whereSchema = z
  .array(
    z.object({
      field: z.string().max(80).describe("A field name of this table (dot-walks of a reference allowed: «caller_id.title»)."),
      op: z.enum(LEAF_OPS as [Op, ...Op[]]).describe("eq ne in nin lt lte gt gte between contains ncontains starts ends empty nempty is_me is_my_group in_my_groups relative"),
      value: z.unknown().optional().describe("The value: a choice's value or label, a record's name or number, a Jalali or ISO date, a list for in/nin, [from, to] for between, {unit, n, dir} for relative («7 days past»: {unit:\"day\", n:7, dir:\"past\"})."),
    }),
  )
  .max(12);

/** Persian/label/name values of a filter leaf matched to stored values (choices, references, dates). */
async function resolveLeaf(ctx: Ctx, schema: OrgSchema, def: TableDef, leaf: WhereLeaf, tz: string): Promise<Cond | { error: string }> {
  const op = leaf.op as Op;
  if (!OPS[op] || OPS[op].rule) return { error: `عملگر «${leaf.op}» شناخته نیست` };
  const path = String(leaf.field ?? "").trim();
  const head = path.split(".")[0];
  const f = def.fields.find((x) => x.name === head);
  if (!f) return { error: `فیلد «${path}» در «${def.label}» نیست` };
  if (!toolField(def, f)) return { error: `«${f.label}» در جست‌وجوی هوش مصنوعی به کار نمی‌رود` };
  const shape = OPS[op].value;
  if (shape === "none") return { f: path, op };
  if (shape === "relative" || path.includes(".")) return { f: path, op, v: leaf.value };
  if (!opsFor(f.type, refTarget(f, def.key)).includes(op)) return { error: `«${f.label}» عملگر «${op}» را نمی‌پذیرد` };
  const one = async (v: unknown): Promise<Resolved> => {
    if (["contains", "ncontains", "starts", "ends"].includes(op)) return { value: String(v ?? "") };
    if (f.type === "multichoice" || f.type === "refs" || f.type === "users") {
      const single: FieldDef = { ...f, type: f.type === "multichoice" ? "choice" : f.type === "refs" ? "ref" : "user" };
      return resolveValue(ctx, schema, def, single, v, tz);
    }
    return resolveValue(ctx, schema, def, f, v, tz);
  };
  if (shape === "list" || shape === "pair") {
    const vals = Array.isArray(leaf.value) ? leaf.value : String(leaf.value ?? "").split(/[،,]/).map((x) => x.trim()).filter(Boolean);
    const out: unknown[] = [];
    for (const v of vals.slice(0, 100)) {
      const r = await one(v);
      if ("error" in r) return r;
      out.push(r.value);
    }
    return { f: path, op, v: out };
  }
  const r = await one(leaf.value);
  if ("error" in r) return r;
  return { f: path, op, v: r.value };
}

/** A condition from a tool's `where` list (and an optional raw condition the engine validates), or the problems. */
export async function conditionOf(
  ctx: Ctx,
  schema: OrgSchema,
  def: TableDef,
  input: { where?: WhereLeaf[] | null; match?: "all" | "any" | null; filter?: unknown },
  tz: string,
): Promise<{ cond: Cond | null; problems: string[] }> {
  const leaves: Cond[] = [];
  const problems: string[] = [];
  for (const w of input.where ?? []) {
    const r = await resolveLeaf(ctx, schema, def, w, tz);
    if ("error" in r) problems.push(r.error);
    else leaves.push(r);
  }
  const parts: Cond[] = [];
  if (leaves.length) parts.push(leaves.length === 1 ? leaves[0] : input.match === "any" ? { or: leaves } : { and: leaves });
  if (input.filter && typeof input.filter === "object" && !Array.isArray(input.filter)) parts.push(input.filter as Cond);
  return { cond: parts.length ? (parts.length === 1 ? parts[0] : { and: parts }) : null, problems };
}

// ---------------------------------------------------------------- rows as a model reads them

/** A row as a model reads it: the id, the number, then the shown fields by name with labels, names and Jalali dates. */
export function shapeRow(schema: OrgSchema, def: TableDef, row: Record<string, unknown>, display: Record<string, string>, tz: string, fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id };
  if (row.number) out.number = row.number;
  for (const f of fields) {
    if (!(f.name in row) || f.name === "number") continue;
    let v = promptValue(schema, f, row[f.name], display, tz);
    if (typeof v === "string" && v.length > MAX_TEXT) v = `${v.slice(0, MAX_TEXT)}…`;
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
    out[f.name] = v;
  }
  return out;
}

/** The field legend of a table for a model (name → label), the shown fields only. */
export function legendOf(fields: FieldDef[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, f.label]));
}
