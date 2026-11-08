// What a skill reads, always through the engine with the caller's context (a person, or the service member of a
// triggered skill) — never the system's:
//   · the record (`get`: 404 when the caller may not read it; only the fields they see), trimmed to what a model may
//     read: no secrets, no `ai_private` field, no field of a group the skill's configuration does not allow, no field a
//     module keeps from models (`keepFromPrompts`), no hidden or structured field unless the skill asks for it;
//   · its journal (`listJournal`: internal notes only for those who may read them; a skill can ask for public replies
//     only), related rows (`list`) and links (`listLinks`) — each through the same access;
//   · sources of a grounded skill (`retrieve`, which runs only as a member and cites only readable records).
import type { Ctx } from "../../../context";
import type { FieldDef, FieldGroup, Option, TableDef } from "@shared/model/types";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { answerLanguage } from "@shared/ai/skills";
import { get, list, listJournal, listLinks, orgSchema } from "../../../engine";
import type { OrgSchema } from "../../../engine";
import { bad } from "../../../http/errors";
import { retrieve, type RetrievedPassage } from "../rag";
import { orgTimeZone } from "../usage";
import type { JournalData, PromptField, RecordData, SkillDef, SkillRuntimeInput } from "./types";
import type { SkillConfig } from "@shared/ai/skills";

/** Fields a module keeps from every model, whatever the caller sees (request answers classed sensitive or secret …). */
const KEPT_FROM_PROMPTS = new Map<string, Set<string>>();

/** A module names fields of its table that never reach a prompt (e.g. the request module's private and secret answers). */
export function keepFromPrompts(table: string, fields: string[]): () => void {
  const set = KEPT_FROM_PROMPTS.get(table) ?? new Set<string>();
  for (const f of fields) set.add(f);
  KEPT_FROM_PROMPTS.set(table, set);
  return () => {
    for (const f of fields) set.delete(f);
  };
}

export const keptFromPrompts = (table: string): ReadonlySet<string> => KEPT_FROM_PROMPTS.get(table) ?? new Set();

const LONG_TYPES = new Set(["json", "conditions"]);
const ENGINE_FIELDS = new Set(["created_by", "updated_by", "workspace_id", "domain_id", "unit_id", "watch_list", "custom"]);
const JOURNAL_LABEL: Record<string, string> = { comment: "پاسخ عمومی", work_note: "یادداشت داخلی", email_in: "ایمیل دریافتی", email_out: "ایمیل فرستاده", approval: "تأیید" };
const MAX_FIELD_CHARS = 6000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Field groups whose values may reach this skill's model (on top of what the caller sees). */
export function allowedGroups(cfg: Pick<SkillConfig, "field_groups">): Set<FieldGroup> {
  return new Set(cfg.field_groups.filter((g) => g !== "ai_private") as FieldGroup[]);
}

/** May a field of this table reach a model in this skill (before the caller's own visibility, applied by the engine)? */
export function promptable(def: TableDef, f: FieldDef, groups: Set<FieldGroup>, explicit: Set<string> | null): boolean {
  if (f.type === "secret") return false;
  if (f.group === "ai_private") return false;
  if (f.group && !groups.has(f.group)) return false;
  if (keptFromPrompts(def.key).has(f.name)) return false;
  if (explicit) return explicit.has(f.name);
  if (f.hidden || LONG_TYPES.has(f.type) || ENGINE_FIELDS.has(f.name)) return false;
  return true;
}

function optionsOf(schema: OrgSchema, f: FieldDef): Option[] {
  if (Array.isArray(f.choices)) return f.choices;
  if (typeof f.choices === "string") return schema.choices(f.choices);
  return [];
}

/** A value as the model reads it: choice labels, reference and member names, Jalali dates, «بله/خیر». */
export function promptValue(schema: OrgSchema, f: FieldDef, raw: unknown, display: Record<string, string>, tz: string): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  if (Array.isArray(raw) && !raw.length) return null;
  switch (f.type) {
    case "choice": {
      const o = optionsOf(schema, f).find((x) => x.value === raw);
      return o?.label ?? String(raw);
    }
    case "multichoice":
      return (raw as unknown[]).map((v) => optionsOf(schema, f).find((x) => x.value === v)?.label ?? String(v));
    case "ref":
    case "user":
    case "group":
      return display[String(raw)] ?? "(محدود)";
    case "refs":
    case "users":
      return (raw as unknown[]).map((v) => display[String(v)] ?? "(محدود)");
    case "bool":
      return raw ? "بله" : "خیر";
    case "date":
      return formatJalali(String(raw));
    case "datetime":
      return formatJalaliDateTime(String(raw), tz);
    case "secret":
      return null;
    default:
      if (typeof raw === "string") return clip(raw, MAX_FIELD_CHARS);
      if (raw && typeof raw === "object") return clip(JSON.stringify(raw), MAX_FIELD_CHARS);
      return raw;
  }
}

/** The record of a skill, read with the caller's access and trimmed to what its model may read. */
export async function loadRecord(ctx: Ctx, table: string, id: string, def: SkillDef, cfg: SkillConfig): Promise<RecordData> {
  const schema = await orgSchema(ctx);
  const tdef = schema.def(table);
  if (!tdef || tdef.virtual) throw bad("این جدول شناخته نیست");
  const r = await get(ctx, table, id); // 404 unless the caller may read it
  const row = r.row as Record<string, unknown>;
  const groups = allowedGroups(cfg);
  const explicit = def.inputs?.fields?.length ? new Set([...def.inputs.fields, tdef.display]) : null;
  const tz = orgTimeZone(ctx);
  const fields: PromptField[] = [];
  for (const f of tdef.fields) {
    if (!(f.name in row)) continue; // not visible to the caller
    if (!promptable(tdef, f, groups, explicit)) continue;
    const value = promptValue(schema, f, row[f.name], r.display, tz);
    if (value === null || value === undefined) continue;
    fields.push({ name: f.name, label: f.label, type: f.type, group: f.group ?? null, raw: row[f.name], value });
  }
  const titleField = tdef.fields.find((f) => f.name === tdef.display);
  const title = titleField && fields.some((f) => f.name === titleField.name) ? String(fields.find((f) => f.name === titleField.name)!.value ?? "") : "";
  return {
    table,
    table_label: tdef.label,
    id: String(row.id),
    number: typeof row.number === "string" ? row.number : null,
    title,
    row,
    display: r.display,
    def: tdef,
    fields,
    version: typeof row.version === "number" ? row.version : null,
  };
}

/** The record's journal as the caller may read it (internal notes only with the `internal` group; or public only). */
export async function loadJournal(ctx: Ctx, rec: RecordData, mode: "all" | "public" | "none", limit = 30): Promise<JournalData[]> {
  if (mode === "none" || !rec.def.features?.journal) return [];
  const { entries, display } = await listJournal(ctx, rec.table, rec.id, { limit: Math.min(Math.max(limit, 1), 60) });
  return entries
    .filter((e) => e.kind in JOURNAL_LABEL)
    .filter((e) => mode === "all" || e.visibility === "public")
    .map((e) => ({
      kind: e.kind,
      kind_label: JOURNAL_LABEL[e.kind] ?? e.kind,
      visibility: e.visibility as "public" | "internal",
      author: e.author ? (display[e.author] ?? null) : null,
      at: e.created_at,
      body: clip(String(e.body ?? ""), 2000),
    }));
}

/** Rows related to the record (children, reviews …) with the caller's access, formatted like the record's fields. */
export async function loadRelated(ctx: Ctx, rec: RecordData, def: SkillDef, cfg: SkillConfig): Promise<Record<string, Record<string, unknown>[]>> {
  const out: Record<string, Record<string, unknown>[]> = {};
  const schema = await orgSchema(ctx);
  const groups = allowedGroups(cfg);
  const tz = orgTimeZone(ctx);
  for (const rel of def.inputs?.related ?? []) {
    const rdef = schema.def(rel.table);
    if (!rdef || rdef.virtual) continue;
    const res = await list(ctx, rel.table, { filter: { f: rel.field, op: "eq", v: rec.id }, size: Math.min(rel.limit ?? 10, 30), fields: rel.fields, total: false }).catch(() => null);
    if (!res) continue;
    out[rel.label] = res.rows.map((row) => {
      const o: Record<string, unknown> = {};
      if (row.number) o["شماره"] = row.number;
      for (const f of rdef.fields) {
        if (!(f.name in row) || !promptable(rdef, f, groups, rel.fields ? new Set(rel.fields) : null)) continue;
        const v = promptValue(schema, f, row[f.name], res.display, tz);
        if (v !== null && v !== undefined) o[f.label] = typeof v === "string" ? clip(v, 1500) : v;
      }
      return o;
    });
  }
  return out;
}

/** Links of the record to records the caller may read. */
export async function loadLinks(ctx: Ctx, rec: RecordData): Promise<SkillRuntimeInput["links"]> {
  if (!rec.def.features?.links) return [];
  const { links } = await listLinks(ctx, rec.table, rec.id).catch(() => ({ links: [] }));
  return links.slice(0, 30).map((l) => ({ kind: l.label, table: l.other.table, number: l.other.number, title: l.other.display, state: l.other.state_label }));
}

/** The search of a grounded skill: the record's title and description (or the text). */
export function defaultQuery(input: Pick<SkillRuntimeInput, "record" | "text" | "params">): string {
  if (typeof input.params.query === "string" && input.params.query.trim()) return input.params.query.trim().slice(0, 500);
  if (input.record) {
    const desc = input.record.fields.find((f) => f.name === "description" || f.name === "summary" || f.name === "symptoms");
    return `${input.record.title} ${typeof desc?.value === "string" ? desc.value.slice(0, 400) : ""}`.trim().slice(0, 600);
  }
  return String(input.text ?? "").slice(0, 600);
}

/** Sources of a grounded skill, found with the caller's access (never the record itself), renumbered 1…k. */
export async function ground(ctx: Ctx, def: SkillDef, cfg: SkillConfig, input: SkillRuntimeInput): Promise<RetrievedPassage[]> {
  if (cfg.grounding === "none") return [];
  const q = (def.query ?? defaultQuery)(input);
  if (q.trim().length < 2) return [];
  const k = Math.max(1, Math.min(12, cfg.grounding_k));
  const tables =
    cfg.grounding === "similar" ? [input.table ?? ""].filter(Boolean) : cfg.grounding === "knowledge" ? ["kb_article", "kb_snippet"] : ["doc_document"];
  const scope = cfg.grounding === "documents" && cfg.collections.length ? { collections: cfg.collections } : { tables };
  const r = await retrieve(ctx, q, { ...scope, k: k + 2 }).catch(() => ({ passages: [] as RetrievedPassage[] }));
  const passages = r.passages.filter((p) => !(input.id && p.citation.id === input.id)).slice(0, k);
  return passages.map((p, i) => ({ ...p, n: i + 1, citation: { ...p.citation, n: i + 1 } }));
}

/**
 * The language of the answer: what the caller asked for (a parameter), else — for a text skill — the language the
 * text is written in (an English paragraph is improved in English), else the member's own language (Persian unless
 * their preferences say otherwise).
 */
export function languageOf(ctx: Ctx, input: Pick<SkillRuntimeInput, "record" | "text" | "params">, target: SkillDef["target"]): "fa" | "en" {
  const asked = typeof input.params.language === "string" ? input.params.language : null;
  if (asked === "fa" || asked === "en") return asked;
  if (target === "text" && input.text) return answerLanguage(input.text, null);
  const prefs = (ctx.user.prefs ?? {}) as Record<string, unknown>;
  return prefs.language === "en" ? "en" : "fa";
}
