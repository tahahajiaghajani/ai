// «پرسش تحلیلی» — natural language → a governed report (catalogue AI-111/112, ANA-023; docs/spec/AI.md §15). The AI
// layer implements the analytics module's hook (`registerAnalyticsAi`) and answers `askReport(ctx, question)`:
//   1. a model turns the question into a report DEFINITION (the skill «analytics.ask»: JSON over the table catalogue the
//      asker may read — names, labels, option values, never record data);
//   2. the definition is checked against the metadata AND the asker's access before anything runs: an unknown table or
//      field, a table they may not read, a field they do not see on any hop of a path → refused with a Persian reason
//      (never quietly replaced by something else);
//   3. the numbers are computed by the analytics engine (`runReport`, SQL over `readable(asker)`) — never by a model;
//   4. a narrative, when a model may be used, describes those numbers only (the facts block) under the table's
//      data-use policy; otherwise sentences are built from them.
// Without a model the rule-based reader of the analytics module answers what it understands; what it cannot read
// becomes a guided start in the report designer with example questions over the asker's own tables.
import { condPaths, isNever, resolvePath } from "@shared/model/conditions";
import { parseQuestion, type NlChip, type NlTable } from "@shared/analytics/nl";
import { dimLabel, measureLabel, normalizeSpec, specProblem, starterSpec, VIZ, windowLabel } from "@shared/analytics/model";
import type { ReportSpec } from "@shared/analytics/types";
import type { AskReportResult } from "@shared/ai/ml";
import { faDigits } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { TABLES } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import type { Ctx } from "../../context";
import { bad, forbidden } from "../../http/errors";
import { access } from "../../access/provider";
import { create, orgSchema, orgTz } from "../../engine";
import { askTables, designerPath, ruleNarrative, type AnalyticsAi, type NarrativeFacts } from "../analytics/ai";
import { canAuthor, canRead, isRestricted, modelKeptField, narrativeFacts, registerAnalyticsAi, runReport } from "../analytics";
import { ready } from "../analytics/common";
import { isAiUnavailable, runForModule } from "./skills/runtime";
import { logGuard } from "./datause";

/** Every field path a definition names (measures, their filters, breakdowns, the period, columns, the filter). */
export function specPaths(spec: ReportSpec): string[] {
  const out = [
    ...(spec.measures ?? []).flatMap((m) => [m.field, m.from, ...condPaths(m.filter ?? null)]),
    ...(spec.dims ?? []).map((d) => d.field),
    spec.time?.field,
    ...(spec.columns ?? []),
    ...condPaths(spec.filter ?? null),
  ];
  return [...new Set(out.filter((p): p is string => typeof p === "string" && !!p))];
}

/**
 * Why a definition may not be answered for this asker, in Persian, or null: an unknown or unreportable table, a table
 * they may not read, an unknown field, a field they do not see (on any hop of a dotted path, whose table they must read
 * too), or a structural problem of the definition.
 */
export async function askRefusal(ctx: Ctx, spec: ReportSpec): Promise<string | null> {
  const schema = await orgSchema(ctx);
  const key = String((spec as { table?: unknown })?.table ?? "");
  const def = schema.def(key);
  if (!def || def.virtual) return `جدولی به نام «${key}» در این سازمان نیست؛ پرسش را دربارهٔ یکی از جدول‌هایی بپرسید که می‌بینید.`;
  if (isNever(def.rowAccess?.read) || def.module === "analytics") return `از «${def.plural}» گزارش گرفته نمی‌شود.`;
  if (!access().canReadTable(ctx, def)) return `به «${def.plural}» دسترسی ندارید؛ به این پرسش پاسخ داده نمی‌شود.`;
  for (const path of specPaths(spec)) {
    const r = resolvePath(def, path, schema.lookup);
    if (!r) return `فیلدی به نام «${path}» در «${def.plural}» نیست.`;
    for (const step of [...r.hops, { def: r.def, field: r.field }]) {
      if (step.field.base && step.field.name === "id") continue;
      if (step.def.key !== def.key && !access().canReadTable(ctx, step.def)) return `به «${step.def.plural}» دسترسی ندارید؛ پاسخی بر پایهٔ «${step.field.label}» داده نمی‌شود.`;
      const visible = access().visibleFields(ctx, step.def);
      if (visible && !visible.has(step.field.name)) return `فیلد «${step.field.label}» از «${step.def.plural}» برای شما خواندنی نیست؛ پاسخی بر پایهٔ آن داده نمی‌شود.`;
    }
  }
  return specProblem(spec, def, schema.lookup);
}

/** The chips of a definition: how the question was read. */
export function specChips(spec: ReportSpec, def: TableDef, lookup?: Parameters<typeof resolvePath>[2]): NlChip[] {
  const field = (p: string | null | undefined) => (p ? (resolvePath(def, p, lookup)?.field ?? null) : null);
  const chips: NlChip[] = [{ kind: "table", label: def.plural }];
  for (const m of spec.measures ?? []) chips.push({ kind: "measure", label: m.label || measureLabel(m, field(m.field), field(m.from)) });
  for (const d of spec.dims ?? []) chips.push({ kind: "dim", label: dimLabel(d, field(d.field)) });
  if (spec.time?.window) chips.push({ kind: "time", label: windowLabel(spec.time.window) });
  else if (spec.time?.from && spec.time?.to) chips.push({ kind: "time", label: `${spec.time.from} تا ${spec.time.to}` });
  const filters = condPaths(spec.filter ?? null).size;
  if (filters) chips.push({ kind: "filter", label: `${faDigits(filters)} شرط` });
  if (VIZ[spec.viz]) chips.push({ kind: "viz", label: VIZ[spec.viz].label });
  return chips;
}

/** Example questions over the tables the asker reads (a guided start). */
export function exampleQuestions(tables: readonly NlTable[]): string[] {
  const out: string[] = [];
  for (const t of tables) {
    if (t.def.extends !== "task") continue;
    const has = (n: string) => t.def.fields.some((f) => f.name === n);
    if (has("priority")) out.push(`تعداد ${t.def.plural} به تفکیک اولویت در ۳۰ روز گذشته`);
    if (has("assignment_group_id")) out.push(`${t.def.plural} باز به تفکیک گروه پشتیبانی`);
    if (has("time_to_resolve")) out.push(`میانگین زمان حل ${t.def.plural} در این ماه`);
    if (out.length >= 6) break;
  }
  if (!out.length) for (const t of tables.slice(0, 3)) out.push(`تعداد ${t.def.plural} در این ماه`);
  return out.slice(0, 6);
}

const tableKeyOfLabel = (label: string): string | null => [...TABLES.values()].find((t) => t.plural === label || t.label === label)?.key ?? null;

/** A narrative of computed numbers: a model's under the table's data-use policy, else rule-based sentences. */
async function narrateFor(ctx: Ctx, table: string, facts: NarrativeFacts, model: boolean): Promise<{ text: string; ai: boolean }> {
  if (model && ctx.can("ai", "view")) {
    try {
      const r = await runForModule(ctx, "analytics.narrate", { params: {} }, { ephemeral: true, facts: { facts }, dataTables: [table] });
      const text = String(r.text ?? "").trim();
      if (text) return { text, ai: true };
    } catch (e) {
      if (!isAiUnavailable(e)) throw e;
    }
  }
  return { text: ruleNarrative(facts), ai: false };
}

/** The model's reading of a question (the skill «analytics.ask»), checked; null when no model may answer. */
async function modelDefinition(ctx: Ctx, question: string): Promise<{ spec: ReportSpec | null; refusal: string | null } | null> {
  if (!ctx.can("ai", "view")) return null;
  try {
    const r = await runForModule(ctx, "analytics.ask", { params: { question } }, { ephemeral: true });
    const out = (r.json ?? {}) as { spec?: Partial<ReportSpec> | null; problem?: string | null };
    if (!out.spec) return { spec: null, refusal: out.problem?.trim() || "پرسش روشن نبود؛ جدول، سنجه یا بازهٔ زمانی را روشن‌تر بنویسید." };
    const spec = { v: 1, ...out.spec } as ReportSpec;
    const refusal = await askRefusal(ctx, spec);
    // a question that reached beyond the asker's access goes to the governance log (the reason, never the question)
    if (refusal) await logGuard(ctx, { kind: "access", feature: "analytics.ask", tables: TABLES.has(String(spec.table)) ? [String(spec.table)] : [], detail: refusal });
    return refusal ? { spec: null, refusal } : { spec: normalizeSpec(spec), refusal: null };
  } catch (e) {
    if (isAiUnavailable(e)) return null;
    throw e;
  }
}

/** «پرسش تحلیلی»: see the file's head. */
export async function askReport(ctx: Ctx, question: string): Promise<AskReportResult> {
  await ready(ctx);
  if (!canRead(ctx)) throw forbidden("به گزارش‌ها دسترسی ندارید");
  const q = question.trim().slice(0, 500);
  if (q.length < 2) throw bad("پرسش کوتاه است");
  const tables = await askTables(ctx);
  const schema = await orgSchema(ctx);
  let mode: AskReportResult["mode"] = "guided";
  let spec: ReportSpec | null = null;
  let chips: NlChip[] = [];
  let refusal: string | null = null;
  const fromModel = await modelDefinition(ctx, q);
  if (fromModel) {
    mode = "ai";
    spec = fromModel.spec;
    refusal = fromModel.refusal;
    if (spec) chips = specChips(spec, schema.def(spec.table)!, schema.lookup);
  } else {
    // no model: the rule-based reader of the analytics module, over the same readable tables
    const r = parseQuestion(q, tables, { now: todayISO(orgTz(ctx)) });
    if (r.spec && !(await askRefusal(ctx, r.spec))) {
      mode = "rules";
      spec = r.spec;
      chips = r.chips;
    } else refusal = r.problem;
  }
  let result: AskReportResult["result"] = null;
  if (spec) {
    try {
      result = await runReport(ctx, spec);
    } catch (e) {
      if (!isRestricted(e) && !(e instanceof Error && "status" in e && [400, 403].includes((e as { status: number }).status))) throw e;
      refusal = e instanceof Error ? e.message : String(e);
      spec = null;
    }
  }
  const def = spec ? schema.def(spec.table) : null;
  const m0 = result?.measures[0];
  const title = spec && def ? `${m0?.label ?? "گزارش"} — ${def.plural}` : q;
  const narrative = spec && result ? await narrateFor(ctx, spec.table, narrativeFacts(title, spec, result), !(await modelKeptField(ctx, spec))) : null;
  // a guided start: the designer on the closest readable table, and example questions
  const guide = !spec ? (tables.find((t) => q.includes(t.def.plural) || q.includes(t.def.label)) ?? tables.find((t) => t.def.extends === "task") ?? tables[0]) : null;
  const designer = spec ? designerPath(spec, title) : guide ? designerPath(starterSpec(guide.def), `گزارش ${guide.def.plural}`) : null;
  return {
    question: q,
    mode: spec ? mode : "guided",
    spec,
    chips,
    refusal,
    result,
    title,
    narrative,
    designer_path: designer,
    can_save: !!spec && canAuthor(ctx),
    suggestions: spec ? [] : exampleQuestions(tables),
  };
}

/** «باز کردن به‌صورت گزارش»: the definition saved as the asker's own report (their create right, checked again). */
export async function saveAskedReport(ctx: Ctx, input: { spec: ReportSpec; name: string; question?: string | null }): Promise<{ id: string; path: string }> {
  await ready(ctx);
  if (!canAuthor(ctx)) throw forbidden("اجازهٔ ساخت گزارش ندارید");
  const refusal = await askRefusal(ctx, input.spec);
  if (refusal) throw bad(refusal);
  const spec = normalizeSpec(input.spec);
  const r = await create(ctx, "analytics_report", {
    name: input.name.trim().slice(0, 150) || "گزارش پرسش",
    table_key: spec.table,
    spec,
    description: input.question ? `ساخته‌شده از پرسش: «${input.question.slice(0, 400)}»` : null,
  });
  return { id: String(r.row.id), path: `analytics/reports/${String(r.row.id)}` };
}

/**
 * The analytics module's hook, implemented by the AI layer: the same checked reading of a question for its «پرسش از
 * داده‌ها» page, and narratives under the table's data-use policy.
 */
export const AI_ANALYTICS: AnalyticsAi = {
  async questionToReport(ctx, question) {
    const r = await modelDefinition(ctx, question);
    if (!r) return { spec: null, chips: [], problem: null };
    if (!r.spec) return { spec: null, chips: [], problem: r.refusal };
    const schema = await orgSchema(ctx);
    return { spec: r.spec, chips: specChips(r.spec, schema.def(r.spec.table)!, schema.lookup), problem: null };
  },
  async narrate(ctx, facts) {
    const table = tableKeyOfLabel(facts.table);
    const r = await runForModule(ctx, "analytics.narrate", { params: {} }, { ephemeral: true, facts: { facts }, ...(table ? { dataTables: [table] } : {}) });
    return { text: String(r.text ?? "") };
  },
};

let installed = false;

export function installNlReport(): void {
  if (installed) return;
  installed = true;
  registerAnalyticsAi(AI_ANALYTICS);
}
