// The generated record tools (docs/spec/AI.md §11.8, catalogue AI-072/075). For every table the caller may read, tools
// generated from its metadata — `search_<t>` (conditions, sort, limit), `get_<t>` (one record), `aggregate_<t>` (counts
// and metrics by fields or Jalali periods), `history_<t>` (field history and journal) — and, where the caller may write,
// drafts: `draft_create_<t>`, `draft_update_<t>`, `draft_transition_<t>` (the table's state model), `draft_batch_<t>`
// (one proposal that changes many records), plus `draft_journal_entry` and `draft_link_records`. A table added later is
// covered as it is; a module adds tools of its own with `registerTool`.
//
// Every tool runs the record service with the CALLER's context — the engine repeats the route's checks (area grants,
// row rules, the fields they see, participant reads) — returns only the fields the caller sees minus what never reaches
// a model (./fields.ts), and never writes: a draft is checked by running the write and rolling it back, then stored as a
// proposal that a person applies with their own access (./record-executors.ts). Configuration tables (settings, members
// and roles, flows, notifications, AI) get read tools only: changing how the system behaves stays on its pages.
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { FieldDef, TableDef } from "@shared/model/types";
import { STATE_CATEGORIES } from "@shared/model/types";
import { LINK_KINDS } from "@shared/model/links";
import type { AiRef } from "@shared/ai/types";
import { formatNumber } from "@shared/format";
import { formatJalaliDateTime } from "@shared/jalali";
import { physicalTables } from "@shared/tables";
import { grantIn } from "@shared/access";
import type { Tx } from "../../../db";
import {
  addJournalIn, addLinkIn, aggregate, condEnv, createIn, get, list, listHistory, listJournal, orgSchema, requireReadable, savepoint, transitionIn, updateIn, JOURNAL_KINDS,
  type OrgSchema, type RecordResult,
} from "../../../engine";
import { checkSide } from "../../../engine/hooks";
import { access } from "../../../access/provider";
import { subjectOf } from "../../../access/subject";
import { AppError, bad, forbidden } from "../../../http/errors";
import { orgTimeZone } from "../usage";
import { AI_CLOSED, aiChannelOpen, aiChannelRule } from "../rag/registry";
import { defineTool, type AiProposalInput, type AiToolDef, type ToolResult } from "./registry";
import { bounded, pathOf } from "./common";
import { conditionOf, fieldLine, legendOf, resolveValues, settableFields, shapeRow, shownFields, toolPathsProblem, toolTextSearch, valuesSchema, whereSchema, type WhereLeaf } from "./fields";

export type RecordOp = "search" | "get" | "aggregate" | "history" | "create" | "update" | "transition" | "batch" | "journal" | "link";

/** A tool the catalogue may offer this turn: cheap to list, built (schemas from the metadata) only when offered. */
export interface ToolEntry {
  name: string;
  title_fa: string;
  kind: "read" | "propose" | "meta";
  table: string | null;
  op: RecordOp | null;
  /** what tool retrieval matches a question against (labels, field labels, the operation's words) */
  terms: string;
  build(): AiToolDef;
}

// ---------------------------------------------------------------- which tables, which tools

/** Tables that never get generated tools (private logs of the AI layer itself); modules may add theirs. */
const NO_TOOLS = new Set<string>();
/** Areas whose tables get read tools only (configuration: changing how the system behaves stays on its pages). */
const READ_ONLY_AREAS = new Set(["settings", "users", "org", "notifications", "flows", "ai", "integrations", "sla"]);
/** Tables changed only through their own screens (decisions, deliveries, saved views, simulations). */
const READ_ONLY_TABLES = new Set([
  "approval", "delegation", "notification", "notification_pref", "view", "cmdb_map", "cmdb_query", "ci_impact_sim", "custom_field", "choice", "request_answer", "request_cart", "request_cart_line", "catalog_item_version", "kb_version", "task_sla",
  // written only by their module (a draft would always be refused): stored KPI scores and deliveries, the report
  // settings; DevOps machine data and deployment gates; go/no-go decisions (the release page and the approvals service)
  "analytics_score", "analytics_delivery", "analytics_config",
  "dev_event", "dev_commit", "dev_pull_request", "dev_build", "change_gate",
  "release_decision",
  // event management: raw events (the ingestion's), pages (the escalation's); ITAM ledgers and licence positions,
  // supplier scorecards and allocation results (computed by their modules)
  "event", "page",
  "stock_movement", "asset_assignment", "license_position", "license_reconcile_run",
  "supplier_scorecard", "allocation_result",
]);

/** A module keeps a table out of the generated tools (its own tools cover it). Returns the removal. */
export function excludeFromTools(table: string): () => void {
  NO_TOOLS.add(table);
  return () => NO_TOOLS.delete(table);
}

const toolless = (def: TableDef) => def.virtual || def.key.startsWith("ai_") || def.key.startsWith("va_") || NO_TOOLS.has(def.key);
export const draftable = (def: TableDef) => !READ_ONLY_AREAS.has(String(def.area)) && !READ_ONLY_TABLES.has(def.key);

/** May the caller change some records of the table (a role's write scope, or creating)? Each draft checks the record itself. */
function mayWrite(ctx: Ctx, def: TableDef): boolean {
  try {
    const g = grantIn(subjectOf(ctx).eff, String(def.area));
    return g.write !== "none" || g.create;
  } catch {
    return access().canCreate(ctx, def, null);
  }
}

/** A tool name of at most 64 characters (providers' limit). */
const toolName = (op: string, table: string) => `${op}_${table}`.slice(0, 64);

const OP_WORDS: Record<RecordOp, string> = {
  search: "search find list show which filter فهرست جست‌وجو پیدا کن نشان بده کدام همه رکوردها",
  get: "get details open record read جزئیات باز کن نمایش رکورد",
  aggregate: "count how many total sum average chart trend report تعداد چند مجموع میانگین نمودار روند گزارش آمار",
  history: "history changes who changed notes journal comments timeline تاریخچه تغییرات یادداشت پاسخ‌ها سابقه",
  create: "create new open register add ثبت کن بساز ایجاد تازه جدید باز کن",
  update: "update change set assign edit modify تغییر بده ویرایش اختصاص بده محول کن تنظیم کن",
  transition: "close resolve cancel reopen move state status ببند حل کن لغو وضعیت انتقال بازگشایی",
  batch: "all every bulk many batch همه همهٔ گروهی دسته‌جمعی یکجا",
  journal: "note comment reply work note یادداشت پاسخ نظر بنویس",
  link: "link relate duplicate caused by پیوند مرتبط تکراری ناشی از وصل کن",
};

function tableTerms(def: TableDef, fields: FieldDef[]): string {
  return [def.key, def.label, def.plural, def.description ?? "", ...fields.slice(0, 30).map((f) => f.label)].join(" ");
}

// ---------------------------------------------------------------- shared steps

const idInput = {
  id: z.string().max(40).optional().describe("The record's id (uuid) from a search"),
  number: z.string().max(40).optional().describe("Or its number, e.g. INC0001234"),
};

/** The record a tool works on: by id or number, read with the caller's access (404 / a Persian error otherwise). */
async function recordOf(ctx: Ctx, def: TableDef, input: { id?: string | null; number?: string | null }): Promise<RecordResult> {
  let id = String(input.id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    const n = String(input.number ?? input.id ?? "").trim();
    if (!n) throw bad(`شناسه یا شمارهٔ ${def.label} را بدهید`);
    if (!def.numbered) throw bad(`${def.label} شماره ندارد؛ شناسهٔ آن را از جست‌وجو بدهید`);
    const r = await list(ctx, def.key, { filter: { f: "number", op: "eq", v: n.toUpperCase() }, size: 1, total: false, fields: ["id"], where: aiChannelRule(def.key) });
    if (!r.rows.length) throw new AppError(404, "not_found", `${def.label} «${n}» پیدا نشد یا در دسترس شما نیست`);
    id = String(r.rows[0].id);
  }
  const rec = await get(ctx, def.key, id.toLowerCase());
  // the record's own AI-use rule (a privileged legal request, an article «هرگز»…) holds for the generated tools too
  if (!(await aiChannelOpen(ctx.db, ctx.org.id, def.key, String(rec.row.id)))) throw new AppError(403, "ai_closed", AI_CLOSED);
  return rec;
}

export const recordPath = (table: string, id: string) => pathOf(table, id) ?? `r/${table}/${id}`;

export function recordRef(def: TableDef, row: Record<string, unknown>, display: Record<string, string>): AiRef {
  const id = String(row.id);
  const title = display[id] ?? (typeof row[def.display] === "string" ? String(row[def.display]) : "");
  const label = [row.number, title].filter(Boolean).join(" — ") || def.label;
  return { type: def.key, id, label: label.slice(0, 120), path: recordPath(def.key, id) };
}

/** Run writes and roll them back: the exact checks of the real write (access, values, rules, locks) without a trace. */
class DryRunDone extends Error {}
export async function dryRun<T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await ctx.write(async (tx) => {
      out = await fn(tx);
      throw new DryRunDone();
    });
  } catch (e) {
    if (!(e instanceof DryRunDone)) throw e;
  }
  return out as T;
}

/** A note inside `tx` exactly as the journal API adds it: the record read again with the caller's access, the module's side checks. */
export async function journalIn(tx: Tx, ctx: Ctx, def: TableDef, id: string, input: { kind: "comment" | "work_note"; body: string }): Promise<void> {
  const env = await condEnv(ctx);
  const row = await requireReadable(ctx, def, id, env, tx);
  await checkSide({ tx, ctx, def, record: row, kind: "journal", journal: { kind: input.kind } });
  await addJournalIn(tx, ctx, def, row, input);
}

/** A write's error as one Persian sentence for the model (validation problems field by field). */
export function problemText(e: unknown): string {
  if (e instanceof AppError) {
    const fields = (e.details as { fields?: Record<string, string> } | undefined)?.fields;
    return fields && Object.keys(fields).length > 1 ? Object.values(fields).join("؛ ") : e.message;
  }
  return "این تغییر انجام‌شدنی نیست";
}

const valueText = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Array.isArray(v) ? v.join("، ") : String(v));

/** Label/value rows of values (choices and names as people read them). */
function previewOf(schema: OrgSchema, def: TableDef, data: Record<string, unknown>, display: Record<string, string>, tz: string): { label: string; value: string }[] {
  const shaped = shapeRow(schema, def, data, display, tz, def.fields.filter((f) => f.name in data));
  return Object.entries(shaped)
    .filter(([k]) => k !== "id" && k !== "number")
    .slice(0, 16)
    .map(([k, v]) => ({ label: def.fields.find((f) => f.name === k)?.label ?? k, value: valueText(v).slice(0, 400) }));
}

/** Display names of the references in `data` the caller may read (for previews). */
async function displayFor(ctx: Ctx, def: TableDef, data: Record<string, unknown>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    const v = data[f.name];
    if (v === null || v === undefined) continue;
    const target = f.type === "user" || f.type === "users" ? "user" : f.type === "group" ? (f.ref ?? "group") : f.type === "ref" || f.type === "refs" ? (f.ref === "$self" ? def.key : f.ref) : null;
    if (!target) continue;
    const ids = (Array.isArray(v) ? v : [v]).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
    if (!ids.length) continue;
    const r = await list(ctx, target, { ids, size: ids.length, total: false }).catch(() => null);
    if (r) Object.assign(out, r.display, Object.fromEntries(r.rows.map((x) => [String(x.id), r.display[String(x.id)] ?? String(x.number ?? "")])));
  }
  return out;
}

const DEFAULT_SEARCH_FIELDS = 12;

/** The fields a search returns by default: number, display, state, assignment and the list columns. */
function searchFields(ctx: Ctx, def: TableDef): FieldDef[] {
  const shown = shownFields(ctx, def);
  const want = new Set<string>([def.display, ...(def.states ? [def.states.field] : []), ...(def.list?.columns ?? [])]);
  if (def.scope.group) want.add(def.scope.group);
  for (const f of ["assigned_to", "priority", "caller_id", "opened_at", "updated_at"]) want.add(f);
  return shown.filter((f) => (want.has(f.name) && !["text", "markdown"].includes(f.type)) || f.name === def.display).slice(0, DEFAULT_SEARCH_FIELDS);
}

function describeTable(schema: OrgSchema, def: TableDef, fields: FieldDef[]): string {
  const states = def.states ? ` States (field ${def.states.field}): ${def.states.states.map((s) => `${s.value}=${s.label}`).join(", ")}.` : "";
  return `«${def.plural}» (${def.key}${def.description ? `: ${def.description}` : ""}).${states} Fields: ${fields.slice(0, 40).map((f) => fieldLine(schema, def, f)).join("; ")}${fields.length > 40 ? "; …" : ""}.`;
}

// ---------------------------------------------------------------- read tools

function searchTool(schema: OrgSchema, def: TableDef, fields: FieldDef[]): AiToolDef {
  const input = z.object({
    where: whereSchema.optional().describe("Conditions on fields (use field names). Choice values or labels, record names or numbers, Jalali dates are understood."),
    match: z.enum(["all", "any"]).optional().describe("all (default): every condition holds; any: at least one"),
    text: z.string().max(200).optional().describe("Words to look for (number, title, description), Persian-aware"),
    sort: z.string().max(120).optional().describe("Fields to sort by, '-' for descending, comma separated, e.g. \"-priority,number\""),
    limit: z.number().int().min(1).max(50).optional().describe("Rows to return (default 15, at most 50)"),
    fields: z.array(z.string().max(80)).max(20).optional().describe("Return only these fields (default: the main columns)"),
  });
  return defineTool({
    name: toolName("search", def.key),
    title_fa: `جست‌وجوی ${def.plural}`,
    description: `Search ${describeTable(schema, def, fields)} Returns only records and fields the person may read, with the total count. Use get_${def.key} for one record's full details, aggregate_${def.key} for counts.`,
    input,
    kind: "read",
    area: "ai",
    level: "view",
    async run(ctx, p) {
      const tz = orgTimeZone(ctx);
      const sch = await orgSchema(ctx);
      const tdef = sch.def(def.key) ?? def;
      const { cond, problems } = await conditionOf(ctx, sch, tdef, { where: p.where as WhereLeaf[] | undefined, match: p.match }, tz);
      if (problems.length) throw bad(problems.join("؛ "));
      // what a tool never shows, it never sorts or text-searches by either (the order and the matches tell its values)
      const kept = toolPathsProblem(ctx, sch, tdef, String(p.sort ?? "").split(",").map((x) => x.trim().replace(/^[-+]/, "")));
      if (kept) throw bad(kept);
      if (p.text && !toolTextSearch(tdef)) throw bad(`جست‌وجوی متنی «${tdef.plural}» در ابزارهای هوش مصنوعی ممکن نیست؛ با شرط روی فیلدها جست‌وجو کنید`);
      const shown = shownFields(ctx, tdef);
      const wanted = p.fields?.length ? shown.filter((f) => p.fields!.includes(f.name)) : searchFields(ctx, tdef);
      const size = p.limit ?? 15;
      const r = await list(ctx, tdef.key, { filter: cond, q: p.text || undefined, sort: p.sort || undefined, size, fields: [...new Set(["number", ...wanted.map((f) => f.name)])].filter((n) => tdef.fields.some((f) => f.name === n)), total: true, where: aiChannelRule(tdef.key) });
      const rows = r.rows.map((row) => shapeRow(sch, tdef, row, r.display, tz, wanted));
      return {
        data: { table: tdef.plural, total: r.total, returned: rows.length, truncated: (r.total ?? 0) > rows.length, rows, fields: legendOf(wanted) },
        refs: r.rows.slice(0, 10).map((row) => recordRef(tdef, row, r.display)),
        summary_fa: `${formatNumber(r.total ?? rows.length)} ${tdef.label} پیدا شد`,
      };
    },
  });
}

function getTool(schema: OrgSchema, def: TableDef, fields: FieldDef[]): AiToolDef {
  return defineTool({
    name: toolName("get", def.key),
    title_fa: `خواندن ${def.label}`,
    description: `One ${def.label} (${def.key}) with every field the person may see, and the state changes they may make now. ${describeTable(schema, def, fields)}`,
    input: z.object(idInput),
    kind: "read",
    area: "ai",
    level: "view",
    async run(ctx, p) {
      const tz = orgTimeZone(ctx);
      const sch = await orgSchema(ctx);
      const tdef = sch.def(def.key) ?? def;
      const r = await recordOf(ctx, tdef, p);
      const shown = shownFields(ctx, tdef);
      const row = shapeRow(sch, tdef, r.row, r.display, tz, shown);
      return {
        data: {
          table: tdef.label,
          record: row,
          fields: legendOf(shown.filter((f) => f.name in row)),
          you_may_change_it: r.meta.canWrite,
          transitions_you_may_take: r.meta.transitions.map((t) => ({ to: t.to, label: t.label, requires: t.requires })),
          ...(r.meta.locked ? { locked: true } : {}),
        },
        refs: [recordRef(tdef, r.row, r.display)],
        summary_fa: `${tdef.label} ${r.row.number ?? ""}`.trim(),
      };
    },
  });
}

function aggregateTool(schema: OrgSchema, def: TableDef, fields: FieldDef[]): AiToolDef {
  const input = z.object({
    where: whereSchema.optional(),
    match: z.enum(["all", "any"]).optional(),
    text: z.string().max(200).optional(),
    group_by: z
      .array(z.object({ field: z.string().max(80), bucket: z.enum(["day", "week", "month", "quarter", "year"]).optional().describe("Dates: Jalali buckets (weeks start on Saturday)") }))
      .max(3)
      .optional()
      .describe("Group by up to three fields"),
    metrics: z
      .array(z.object({ fn: z.enum(["count", "sum", "avg", "min", "max", "median", "p90"]), field: z.string().max(80).optional() }))
      .max(5)
      .optional()
      .describe("Default: count"),
    limit: z.number().int().min(1).max(200).optional(),
  });
  return defineTool({
    name: toolName("aggregate", def.key),
    title_fa: `آمار ${def.plural}`,
    description: `Counts and metrics of ${def.plural} (${def.key}) the person may read, grouped by fields or Jalali periods; numbers come from the database. Returns a data_ref for render_chart (x "label", series "value"). ${describeTable(schema, def, fields)}`,
    input,
    kind: "read",
    area: "ai",
    level: "view",
    async run(ctx, p, rt) {
      const tz = orgTimeZone(ctx);
      const sch = await orgSchema(ctx);
      const tdef = sch.def(def.key) ?? def;
      const { cond, problems } = await conditionOf(ctx, sch, tdef, { where: p.where as WhereLeaf[] | undefined, match: p.match }, tz);
      if (problems.length) throw bad(problems.join("؛ "));
      // groups are labelled with their values and metrics computed from them: only fields a tool may show
      const kept = toolPathsProblem(ctx, sch, tdef, [...(p.group_by ?? []).map((g) => g.field), ...(p.metrics ?? []).map((m) => m.field)]);
      if (kept) throw bad(kept);
      if (p.text && !toolTextSearch(tdef)) throw bad(`جست‌وجوی متنی «${tdef.plural}» در ابزارهای هوش مصنوعی ممکن نیست؛ با شرط روی فیلدها جست‌وجو کنید`);
      const metrics = p.metrics?.length ? p.metrics : [{ fn: "count" as const }];
      const r = await aggregate(ctx, tdef.key, { filter: cond, q: p.text || undefined, groupBy: p.group_by ?? [], metrics, limit: p.limit ?? 50, where: aiChannelRule(tdef.key) });
      const mkey = (m: { fn: string; field?: string }) => (m.fn === "count" && !m.field ? "count" : `${m.fn}:${m.field}`);
      const rows = r.rows.map((x) => ({ label: x.labels.join(" / "), ...Object.fromEntries(metrics.map((m) => [mkey(m), x.values[mkey(m)] ?? null])) }));
      const chartRows = rows.map((x) => ({ label: x.label, value: x[mkey(metrics[0]) as keyof typeof x] as unknown }));
      const dataRef = rows.length ? await rt.putData(chartRows as Record<string, unknown>[], { title: tdef.plural }) : undefined;
      const b = bounded(rows, 60);
      return {
        data: { table: tdef.plural, groups: r.groups.map((g) => g.label), rows: b.rows, total_groups: b.total_rows, truncated: b.truncated, totals: r.totals, ...(dataRef ? { data_ref: dataRef } : {}) },
        ...(dataRef ? { data_ref: dataRef, table: { title: tdef.plural, columns: [{ key: "label", title: r.groups.map((g) => g.label).join(" / ") || "همه" }, { key: "value", title: "مقدار", numeric: true }], total_rows: rows.length } } : {}),
        summary_fa: `آمار ${tdef.plural}`,
      };
    },
  });
}

function historyTool(def: TableDef): AiToolDef {
  return defineTool({
    name: toolName("history", def.key),
    title_fa: `تاریخچهٔ ${def.label}`,
    description: `The field history (who changed what, when) and the notes and replies of one ${def.label} (${def.key}). Internal work notes appear only for people allowed to read them.`,
    input: z.object({ ...idInput, notes: z.boolean().optional().describe("Include notes and replies (default true)"), limit: z.number().int().min(1).max(60).optional() }),
    kind: "read",
    area: "ai",
    level: "view",
    async run(ctx, p) {
      const tz = orgTimeZone(ctx);
      const sch = await orgSchema(ctx);
      const tdef = sch.def(def.key) ?? def;
      const r = await recordOf(ctx, tdef, p);
      const id = String(r.row.id);
      const limit = p.limit ?? 30;
      const shown = new Set(shownFields(ctx, tdef).map((f) => f.name));
      const out: Record<string, unknown> = { record: recordRef(tdef, r.row, r.display).label };
      if (tdef.features?.history !== false) {
        const h = await listHistory(ctx, tdef.key, id, { limit: 200 });
        out.changes = h.entries
          .filter((e) => shown.has(e.field))
          .slice(-limit)
          .map((e) => {
            const f = tdef.fields.find((x) => x.name === e.field)!;
            const fmt = (v: unknown) => valueText(shapeRow(sch, tdef, { id, [f.name]: v }, h.display, tz, [f])[f.name]);
            return { at: formatJalaliDateTime(e.at, tz), field: e.label, name: e.field, from: fmt(e.old), to: fmt(e.new), by: e.actor ? (h.display[e.actor] ?? null) : "سامانه" };
          });
      }
      if (p.notes !== false && tdef.features?.journal) {
        const j = await listJournal(ctx, tdef.key, id, { limit });
        out.notes = j.entries.map((e) => ({
          at: formatJalaliDateTime(e.created_at, tz),
          kind: JOURNAL_KINDS[e.kind] ?? e.kind,
          visibility: e.visibility === "internal" ? "internal" : "public",
          by: e.author ? (j.display[e.author] ?? null) : "سامانه",
          text: e.body.length > 1200 ? `${e.body.slice(0, 1200)}…` : e.body,
        }));
      }
      return { data: out, refs: [recordRef(tdef, r.row, r.display)], summary_fa: `تاریخچهٔ ${tdef.label} ${r.row.number ?? ""}`.trim() };
    },
  });
}

// ---------------------------------------------------------------- drafts (proposals; nothing is written)

const reasonInput = z.string().max(600).optional().describe("Why, in one Persian sentence (shown on the card)");

function proposal(def: TableDef, kind: string, title: string, summary: string, payload: unknown, extra: Partial<AiProposalInput>): AiProposalInput {
  return { kind, title_fa: title, summary_fa: summary.slice(0, 500), payload, preview: [], area: "ai", level: "view", warnings: ["پیش‌نویس هوش مصنوعی — پیش از تأیید بازبینی کنید"], ...extra };
}

function draftResult(p: AiProposalInput, data: Record<string, unknown>): ToolResult {
  return { data: { status: "draft", ...data }, proposal: p, summary_fa: p.title_fa };
}

function createTool(schema: OrgSchema, def: TableDef, fields: FieldDef[], required: string[]): AiToolDef {
  return defineTool({
    name: toolName("draft_create", def.key),
    title_fa: `پیش‌نویس ${def.label} تازه`,
    description: `Drafts a new ${def.label} (${def.key}) for the person to confirm; nothing is saved now. Give values by field name (labels, names and Jalali dates are understood). Required: ${required.join(", ") || "—"}. The draft is checked exactly like the form; fix the reported problems and call again.`,
    input: z.object({ values: valuesSchema(schema, def, fields), reason: reasonInput }),
    kind: "propose",
    area: "ai",
    level: "view",
    async run(ctx, p) {
      const tz = orgTimeZone(ctx);
      const sch = await orgSchema(ctx);
      const tdef = sch.def(def.key) ?? def;
      if (!access().canCreate(ctx, tdef, null)) throw forbidden(`اجازهٔ ثبت ${tdef.label} را ندارید`);
      const { data, problems } = await resolveValues(ctx, sch, tdef, settableFields(ctx, tdef, null), (p.values ?? {}) as Record<string, unknown>, tz);
      if (problems.length) throw bad(problems.join("؛ "));
      try {
        await dryRun(ctx, (tx) => createIn(tx, ctx, tdef.key, data));
      } catch (e) {
        throw bad(`این پیش‌نویس ثبت‌شدنی نیست: ${problemText(e)}`);
      }
      const display = await displayFor(ctx, tdef, data);
      const preview = previewOf(sch, tdef, data, display, tz);
      const title = String(data[tdef.display] ?? "").slice(0, 80);
      return draftResult(
        proposal(tdef, "record.create", `${tdef.label} تازه${title ? `: ${title}` : ""}`, p.reason ?? preview.map((x) => `${x.label}: ${x.value}`).join("؛ "), { table: tdef.key, data }, { preview, edit_path: `r/${tdef.key}/new` }),
        { table: tdef.label, values: preview },
      );
    },
  });
}

function updateTool(schema: OrgSchema, def: TableDef, fields: FieldDef[]): AiToolDef {
  return defineTool({
    name: toolName("draft_update", def.key),
    title_fa: `پیش‌نویس تغییر ${def.label}`,
    description: `Drafts a change of one ${def.label} (${def.key}): the card shows each field's current and new value; nothing is saved now. States change with draft_transition_${def.key}. It is refused if the person may not change the record or a field.`,
    input: z.object({ ...idInput, values: valuesSchema(schema, def, fields), reason: reasonInput }),
    kind: "propose",
    area: "ai",
    level: "view",
    async run(ctx, p) {
      const tz = orgTimeZone(ctx);
      const sch = await orgSchema(ctx);
      const tdef = sch.def(def.key) ?? def;
      const cur = await recordOf(ctx, tdef, p);
      if (!cur.meta.canWrite) throw forbidden(`اجازهٔ تغییر این ${tdef.label} را ندارید${cur.meta.locked ? " (در این وضعیت قفل است)" : ""}`);
      const { data, problems } = await resolveValues(ctx, sch, tdef, settableFields(ctx, tdef, cur.row), (p.values ?? {}) as Record<string, unknown>, tz);
      if (problems.length) throw bad(problems.join("؛ "));
      const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      for (const k of Object.keys(data)) if (same(data[k], cur.row[k])) delete data[k];
      if (!Object.keys(data).length) throw bad("مقدارهای پیشنهادی با مقدار کنونی یکی است؛ تغییری نمانده است");
      const id = String(cur.row.id);
      try {
        await dryRun(ctx, (tx) => updateIn(tx, ctx, tdef.key, id, data, { version: cur.row.version as number }));
      } catch (e) {
        throw bad(`این تغییر انجام‌شدنی نیست: ${problemText(e)}`);
      }
      const display = { ...cur.display, ...(await displayFor(ctx, tdef, data)) };
      const after = previewOf(sch, tdef, data, display, tz);
      const before = previewOf(sch, tdef, Object.fromEntries(Object.keys(data).map((k) => [k, cur.row[k] ?? null])), display, tz);
      const lines = Object.keys(data).map((k) => {
        const label = tdef.fields.find((f) => f.name === k)?.label ?? k;
        return { cells: [label, before.find((x) => x.label === label)?.value ?? "—", after.find((x) => x.label === label)?.value ?? "—"] };
      });
      const ref = recordRef(tdef, cur.row, cur.display);
      return draftResult(
        proposal(tdef, "record.update", `تغییر ${ref.label}`, p.reason ?? lines.map((l) => `${l.cells[0]}: ${l.cells[1]} ← ${l.cells[2]}`).join("؛ "), {
          table: tdef.key, id, data, snapshot: Object.fromEntries(Object.keys(data).map((k) => [k, cur.row[k] ?? null])),
        }, { preview: [{ label: tdef.label, value: ref.label }], lines, line_headers: ["فیلد", "مقدار کنونی", "مقدار تازه"], edit_path: ref.path, record: { table: tdef.key, id, fields: Object.keys(data) } }),
        { record: ref.label, changes: lines.map((l) => ({ field: l.cells[0], from: l.cells[1], to: l.cells[2] })) },
      );
    },
  });
}

const noteInput = {
  note: z.string().max(20_000).optional().describe("A note to add with the change"),
  note_kind: z.enum(["work_note", "comment"]).optional().describe("work_note (internal, default) or comment (a public reply the requester sees)"),
};

function transitionTool(schema: OrgSchema, def: TableDef, fields: FieldDef[]): AiToolDef {
  const states = def.states!;
  return defineTool({
    name: toolName("draft_transition", def.key),
    title_fa: `پیش‌نویس تغییر وضعیت ${def.label}`,
    description: `Drafts moving one ${def.label} (${def.key}) to another state of its state model (${states.states.map((s) => `${s.value}=${s.label}`).join(", ")}), with the values the transition requires and an optional note; nothing is saved now. Only transitions the person may take now are accepted (get_${def.key} lists them).`,
    input: z.object({ ...idInput, to: z.enum(states.states.map((s) => s.value) as [string, ...string[]]), values: valuesSchema(schema, def, fields).optional(), ...noteInput, reason: reasonInput }),
    kind: "propose",
    area: "ai",
    level: "view",
    async run(ctx, p) {
      const tz = orgTimeZone(ctx);
      const sch = await orgSchema(ctx);
      const tdef = sch.def(def.key) ?? def;
      const cur = await recordOf(ctx, tdef, p);
      const t = cur.meta.transitions.find((x) => x.to === p.to);
      const toLabel = tdef.states!.states.find((s) => s.value === p.to)?.label ?? p.to;
      if (!t) {
        const allowed = cur.meta.transitions.map((x) => x.label).join("، ");
        throw forbidden(`رفتن به «${toLabel}» برای شما ممکن نیست${allowed ? `؛ ممکن‌ها: ${allowed}` : ""}`);
      }
      const { data, problems } = await resolveValues(ctx, sch, tdef, settableFields(ctx, tdef, cur.row), (p.values ?? {}) as Record<string, unknown>, tz);
      if (problems.length) throw bad(problems.join("؛ "));
      const missing = t.requires.filter((r) => (data[r] ?? cur.row[r]) === null || (data[r] ?? cur.row[r]) === undefined || (data[r] ?? cur.row[r]) === "");
      if (missing.length) throw bad(`برای «${t.label}» این‌ها لازم است: ${missing.map((m) => tdef.fields.find((f) => f.name === m)?.label ?? m).join("، ")}`);
      const id = String(cur.row.id);
      const note = p.note?.trim() || null;
      const noteKind = p.note_kind ?? "work_note";
      try {
        await dryRun(ctx, async (tx) => {
          await transitionIn(tx, ctx, tdef.key, id, p.to, data, { version: cur.row.version as number });
          if (note && tdef.features?.journal) await journalIn(tx, ctx, tdef, id, { kind: noteKind, body: note });
        });
      } catch (e) {
        throw bad(`این تغییر وضعیت انجام‌شدنی نیست: ${problemText(e)}`);
      }
      const display = { ...cur.display, ...(await displayFor(ctx, tdef, data)) };
      const sf = tdef.states!.field;
      const fromLabel = tdef.states!.states.find((s) => s.value === cur.row[sf])?.label ?? String(cur.row[sf] ?? "—");
      const lines = [{ cells: [tdef.fields.find((f) => f.name === sf)?.label ?? "وضعیت", fromLabel, toLabel] }, ...previewOf(sch, tdef, data, display, tz).map((x) => ({ cells: [x.label, "", x.value] }))];
      const ref = recordRef(tdef, cur.row, cur.display);
      const preview = [{ label: tdef.label, value: ref.label }, ...(note ? [{ label: noteKind === "comment" ? "پاسخ عمومی" : "یادداشت داخلی", value: note.slice(0, 1500) }] : [])];
      return draftResult(
        proposal(tdef, "record.transition", `${t.label}: ${ref.label}`, p.reason ?? `${fromLabel} ← ${toLabel}`, { table: tdef.key, id, to: p.to, data, note, note_kind: noteKind, snapshot: { [sf]: cur.row[sf] ?? null } }, {
          preview, lines, line_headers: ["فیلد", "مقدار کنونی", "مقدار تازه"], edit_path: ref.path,
          record: { table: tdef.key, id, fields: [sf, ...Object.keys(data), ...(note && noteKind === "work_note" ? ["@g:internal"] : [])] },
        }),
        { record: ref.label, from: fromLabel, to: toLabel },
      );
    },
  });
}

/** At most this many records in one batch proposal. */
export const BATCH_MAX = 200;
const SAMPLE = 10;

function batchTool(schema: OrgSchema, def: TableDef, fields: FieldDef[]): AiToolDef {
  const states = def.states;
  return defineTool({
    name: toolName("draft_batch", def.key),
    title_fa: `پیش‌نویس گروهی ${def.plural}`,
    description: `ONE proposal that changes every ${def.label} (${def.key}) matching the conditions (at most ${BATCH_MAX}): update values, move to a state${states ? ` (${states.states.map((s) => `${s.value}=${s.label}`).join(", ")})` : ""} or add a note. Use it for multi-record requests («close all … with a note»): write the plan as short steps; the card shows the count and a sample, and applying it writes each record with the person's own access and reports every row. Records the person may not change are left out and reported.`,
    input: z.object({
      where: whereSchema.describe("Which records (the same conditions as search)"),
      match: z.enum(["all", "any"]).optional(),
      text: z.string().max(200).optional(),
      action: z.enum(states ? ["update", "transition", "note"] : ["update", "note"]),
      values: valuesSchema(schema, def, fields).optional(),
      ...(states ? { to: z.enum(states.states.map((s) => s.value) as [string, ...string[]]).optional() } : {}),
      ...noteInput,
      plan: z.array(z.string().max(200)).max(8).optional().describe("The plan in short Persian steps (shown on the card)"),
    }),
    kind: "propose",
    area: "ai",
    level: "view",
    async run(ctx, raw) {
      const p = raw as { where: WhereLeaf[]; match?: "all" | "any"; text?: string; action: "update" | "transition" | "note"; values?: Record<string, unknown>; to?: string; note?: string; note_kind?: "work_note" | "comment"; plan?: string[] };
      const tz = orgTimeZone(ctx);
      const sch = await orgSchema(ctx);
      const tdef = sch.def(def.key) ?? def;
      if (!p.where?.length && !p.text) throw bad("شرط انتخاب رکوردها را بدهید");
      const { cond, problems } = await conditionOf(ctx, sch, tdef, { where: p.where, match: p.match }, tz);
      if (problems.length) throw bad(problems.join("؛ "));
      if (p.action === "transition" && !p.to) throw bad("وضعیت مقصد (to) را بدهید");
      const note = p.note?.trim() || null;
      const noteKind = p.note_kind ?? "work_note";
      if (p.action === "note" && !note) throw bad("متن یادداشت را بدهید");
      if ((p.action === "note" || note) && !tdef.features?.journal) throw bad(`${tdef.plural} یادداشت ندارند`);
      // the values once (each record is checked again below, with its own writable fields)
      let data: Record<string, unknown> = {};
      if (p.values && Object.keys(p.values).length) {
        const r = await resolveValues(ctx, sch, tdef, settableFields(ctx, tdef, null), p.values, tz);
        if (r.problems.length) throw bad(r.problems.join("؛ "));
        data = r.data;
      }
      if (p.action === "update" && !Object.keys(data).length) throw bad("مقدارهای تازه (values) را بدهید");
      const sf0 = tdef.states?.field;
      const watched = [...Object.keys(data), ...(sf0 && p.action === "transition" ? [sf0] : [])];
      const found = await list(ctx, tdef.key, { filter: cond, q: p.text || undefined, size: BATCH_MAX + 1, total: true, fields: [...new Set(["number", tdef.display, ...(sf0 ? [sf0] : []), ...watched])], where: aiChannelRule(tdef.key) });
      if (!found.rows.length) throw bad("هیچ رکوردی با این شرط‌ها در دسترس شما نیست");
      if ((found.total ?? found.rows.length) > BATCH_MAX) throw bad(`${formatNumber(found.total ?? 0)} رکورد جور است؛ یک پیشنهاد گروهی حداکثر ${formatNumber(BATCH_MAX)} رکورد را تغییر می‌دهد — شرط‌ها را تنگ‌تر کنید`);
      // every record is tried with the person's access in one rolled-back transaction: who would fail, and why
      const ok: { id: string; row: Record<string, unknown> }[] = [];
      const refused: string[] = [];
      await dryRun(ctx, async (tx) => {
        for (const row of found.rows) {
          const id = String(row.id);
          const label = String(row.number ?? found.display[id] ?? id);
          try {
            await savepoint(tx, async () => {
              if (p.action === "update") await updateIn(tx, ctx, tdef.key, id, data);
              else if (p.action === "transition") await transitionIn(tx, ctx, tdef.key, id, p.to!, data);
              else if (Object.keys(data).length) await updateIn(tx, ctx, tdef.key, id, data);
              if (note) await journalIn(tx, ctx, tdef, id, { kind: noteKind, body: note });
              ok.push({ id, row });
            });
          } catch (e) {
            refused.push(`${label}: ${problemText(e)}`);
          }
        }
      });
      if (!ok.length) throw bad(`هیچ‌یک از ${formatNumber(found.rows.length)} رکورد را نمی‌توان این‌طور تغییر داد؛ ${refused.slice(0, 3).join("؛ ")}`);
      const sf = tdef.states?.field;
      const toLabel = p.to ? (tdef.states?.states.find((s) => s.value === p.to)?.label ?? p.to) : null;
      const display = await displayFor(ctx, tdef, data);
      const changes = previewOf(sch, tdef, data, display, tz);
      const what = [toLabel ? `وضعیت ← ${toLabel}` : null, ...changes.map((c) => `${c.label} ← ${c.value}`), note ? (noteKind === "comment" ? "پاسخ عمومی" : "یادداشت داخلی") : null].filter(Boolean).join("، ");
      const lines = ok.slice(0, SAMPLE).map((x) => {
        const cur = sf ? (tdef.states!.states.find((s) => s.value === x.row[sf])?.label ?? String(x.row[sf] ?? "")) : "";
        return { cells: [String(x.row.number ?? ""), String(found.display[x.id] ?? x.row[tdef.display] ?? "").slice(0, 80), cur, toLabel ?? (changes.map((c) => c.value).join("، ") || "یادداشت")] };
      });
      const plan = (p.plan ?? []).slice(0, 8).map((s, i) => ({ label: `گام ${formatNumber(i + 1)}`, value: s }));
      const title = `${formatNumber(ok.length)} ${tdef.label}: ${what}`.slice(0, 160);
      const fieldsTouched = [...Object.keys(data), ...(sf && p.action === "transition" ? [sf] : []), ...(note && noteKind === "work_note" ? ["@g:internal"] : [])];
      return draftResult(
        proposal(tdef, "record.batch", title, `${formatNumber(ok.length)} رکورد از ${formatNumber(found.rows.length)} رکورد جور: ${what}`, {
          table: tdef.key, action: p.action, ids: ok.map((x) => x.id), data, to: p.to ?? null, note, note_kind: noteKind,
          // what each record looked like: a record whose changed fields (or state) moved since is left alone
          snapshots: Object.fromEntries(ok.map((x) => [x.id, Object.fromEntries(watched.map((f) => [f, x.row[f] ?? null]))])),
        }, {
          preview: [{ label: "تعداد", value: `${formatNumber(ok.length)} ${tdef.label}` }, ...plan, ...(note ? [{ label: noteKind === "comment" ? "پاسخ عمومی" : "یادداشت داخلی", value: note.slice(0, 600) }] : [])],
          lines,
          line_headers: ["شماره", "عنوان", "اکنون", "پس از تأیید"],
          warnings: ["پیش‌نویس هوش مصنوعی — پیش از تأیید بازبینی کنید", ...(refused.length ? [`${formatNumber(refused.length)} رکورد کنار گذاشته شد: ${refused.slice(0, 3).join("؛ ")}${refused.length > 3 ? "؛ …" : ""}`] : [])],
          count: ok.length,
          record: { table: tdef.key, id: null, fields: [...fieldsTouched, ...ok.map((x) => `@r:${tdef.key}:${x.id}`)] },
        }),
        { count: ok.length, left_out: refused.length, sample: lines.map((l) => l.cells[0] || l.cells[1]) },
      );
    },
  });
}

function journalTool(tables: TableDef[]): AiToolDef {
  return defineTool({
    name: "draft_journal_entry",
    title_fa: "پیش‌نویس یادداشت",
    description: `Drafts a note on one record: a work note (internal, for the people who work on it) or a comment (a public reply the requester sees). Nothing is posted until the person confirms it. Tables: ${tables.map((t) => t.key).join(", ")}.`,
    input: z.object({ table: z.enum(tables.map((t) => t.key) as [string, ...string[]]), ...idInput, kind: z.enum(["work_note", "comment"]), body: z.string().min(1).max(20_000) }),
    kind: "propose",
    area: "ai",
    level: "view",
    async run(ctx, p) {
      const sch = await orgSchema(ctx);
      const tdef = sch.def(p.table);
      if (!tdef?.features?.journal) throw bad("این جدول یادداشت ندارد");
      const cur = await recordOf(ctx, tdef, p);
      const id = String(cur.row.id);
      try {
        await dryRun(ctx, (tx) => journalIn(tx, ctx, tdef, id, { kind: p.kind, body: p.body }));
      } catch (e) {
        throw bad(`این یادداشت ثبت‌شدنی نیست: ${problemText(e)}`);
      }
      const ref = recordRef(tdef, cur.row, cur.display);
      const internal = p.kind === "work_note";
      return draftResult(
        proposal(tdef, "record.journal", `${internal ? "یادداشت داخلی" : "پاسخ عمومی"} برای ${ref.label}`, p.body, { table: tdef.key, id, kind: p.kind, body: p.body }, {
          preview: [{ label: internal ? "یادداشت داخلی" : "پاسخ عمومی (درخواست‌کننده می‌بیند)", value: p.body.slice(0, 1500) }],
          edit_path: ref.path,
          record: { table: tdef.key, id, fields: internal ? ["@g:internal"] : [] },
        }),
        { record: ref.label, kind: p.kind },
      );
    },
  });
}

function linkTool(tables: TableDef[]): AiToolDef {
  const keys = tables.map((t) => t.key) as [string, ...string[]];
  return defineTool({
    name: "draft_link_records",
    title_fa: "پیش‌نویس پیوند رکوردها",
    description: `Drafts a link between two records (${Object.entries(LINK_KINDS).map(([k, v]) => `${k}=${v.out}`).join(", ")}). Both records must be readable and the person must be able to change the first. Tables: ${keys.join(", ")}.`,
    input: z.object({
      table: z.enum(keys), ...idInput, kind: z.enum(Object.keys(LINK_KINDS) as [string, ...string[]]),
      to_table: z.enum(keys), to_id: z.string().max(40).optional(), to_number: z.string().max(40).optional(), note: z.string().max(500).optional(),
    }),
    kind: "propose",
    area: "ai",
    level: "view",
    async run(ctx, p) {
      const sch = await orgSchema(ctx);
      const a = sch.def(p.table);
      const b = sch.def(p.to_table);
      if (!a || !b) throw bad("جدول شناخته نیست");
      const from = await recordOf(ctx, a, p);
      const to = await recordOf(ctx, b, { id: p.to_id, number: p.to_number });
      const fromId = String(from.row.id);
      const toId = String(to.row.id);
      try {
        await dryRun(ctx, (tx) => addLinkIn(tx, ctx, a.key, fromId, { kind: p.kind, table: b.key, id: toId, note: p.note ?? null }));
      } catch (e) {
        throw bad(`این پیوند ثبت‌شدنی نیست: ${problemText(e)}`);
      }
      const fr = recordRef(a, from.row, from.display);
      const tr = recordRef(b, to.row, to.display);
      const rel = LINK_KINDS[p.kind]?.out ?? p.kind;
      return draftResult(
        proposal(a, "record.link", `پیوند: ${fr.label} ${rel} ${tr.label}`, p.note ?? `${fr.label} ${rel} ${tr.label}`, { table: a.key, id: fromId, kind: p.kind, to_table: b.key, to_id: toId, note: p.note ?? null }, {
          preview: [{ label: "از", value: fr.label }, { label: "رابطه", value: rel }, { label: "به", value: tr.label }],
          edit_path: fr.path,
          record: { table: a.key, id: fromId, fields: [`@r:${b.key}:${toId}`] },
        }),
        { from: fr.label, relation: rel, to: tr.label },
      );
    },
  });
}

// ---------------------------------------------------------------- the catalogue

/**
 * The generated tools this caller may use now, cheap to list (each is built only when offered). Read tools for every
 * table they may read; drafts where they may write (and when proposals are on); never a tool of a table they cannot read.
 */
export async function recordTools(ctx: Ctx, opts: { proposals: boolean; tables?: ReadonlySet<string> | null }): Promise<ToolEntry[]> {
  const schema = await orgSchema(ctx);
  const out: ToolEntry[] = [];
  const journalTables: TableDef[] = [];
  const linkTables: TableDef[] = [];
  for (const base of physicalTables()) {
    if (toolless(base) || (opts.tables && !opts.tables.has(base.key))) continue;
    const def = schema.def(base.key);
    if (!def || !access().canReadTable(ctx, def)) continue;
    const shown = shownFields(ctx, def);
    const terms = tableTerms(def, shown);
    const add = (op: RecordOp, kind: ToolEntry["kind"], title: string, build: () => AiToolDef) =>
      out.push({ name: op === "create" || op === "update" || op === "transition" || op === "batch" ? toolName(`draft_${op}`, def.key) : toolName(op, def.key), title_fa: title, kind, table: def.key, op, terms: `${terms} ${OP_WORDS[op]}`, build });
    add("search", "read", `جست‌وجوی ${def.plural}`, () => searchTool(schema, def, shown));
    add("get", "read", `خواندن ${def.label}`, () => getTool(schema, def, shown));
    add("aggregate", "read", `آمار ${def.plural}`, () => aggregateTool(schema, def, shown));
    if (def.features?.history !== false || def.features?.journal) add("history", "read", `تاریخچهٔ ${def.label}`, () => historyTool(def));
    if (!opts.proposals || !draftable(def)) continue;
    const writes = mayWrite(ctx, def);
    if (access().canCreate(ctx, def, null)) {
      const fields = settableFields(ctx, def, null);
      const required = fields.filter((f) => f.required && (f.default === undefined || f.default === null)).map((f) => f.name);
      if (fields.length) add("create", "propose", `پیش‌نویس ${def.label} تازه`, () => createTool(schema, def, fields, required));
    }
    if (writes) {
      const fields = settableFields(ctx, def, null);
      if (fields.length) add("update", "propose", `پیش‌نویس تغییر ${def.label}`, () => updateTool(schema, def, fields));
      if (def.states) add("transition", "propose", `پیش‌نویس تغییر وضعیت ${def.label}`, () => transitionTool(schema, def, fields));
      add("batch", "propose", `پیش‌نویس گروهی ${def.plural}`, () => batchTool(schema, def, fields));
      if (def.features?.links) linkTables.push(def);
    }
    if (def.features?.journal && (writes || access().canCreate(ctx, def, null))) journalTables.push(def);
  }
  if (journalTables.length) {
    out.push({ name: "draft_journal_entry", title_fa: "پیش‌نویس یادداشت", kind: "propose", table: null, op: "journal", terms: `${journalTables.map((t) => `${t.label} ${t.plural}`).join(" ")} ${OP_WORDS.journal}`, build: () => journalTool(journalTables) });
  }
  if (linkTables.length) {
    out.push({ name: "draft_link_records", title_fa: "پیش‌نویس پیوند رکوردها", kind: "propose", table: null, op: "link", terms: `${linkTables.map((t) => `${t.label} ${t.plural}`).join(" ")} ${OP_WORDS.link}`, build: () => linkTool(linkTables) });
  }
  return out;
}

/** The labels of a state category (for descriptions and previews). */
export const stateCategoryLabel = (c: string) => STATE_CATEGORIES[c as keyof typeof STATE_CATEGORIES]?.label ?? c;
