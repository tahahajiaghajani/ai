// The AI layer's plug-in points in analytics (catalogue ANA-023/028, the assistant's numbers). Until the AI layer
// registers an implementation with `registerAnalyticsAi`, everything answers without a model: a Persian question is
// read by the rule-based parser over the tables the asker may read (`parseQuestion`: tables, measures, breakdowns,
// Jalali periods, option filters, top N, the chart), and a result is described by sentences built from the computed
// numbers. Whatever produced a definition, it is validated against the schema and RUN WITH THE ASKER'S ACCESS like
// every report — a model never sees or produces data, only a definition; narratives get the numbers code computed.
//
// Declared here as well (docs/spec/AI.md §11): the skills «analytics.ask» (question → definition, JSON) and
// «analytics.narrate» (a description of a computed result), each with its rule-based fallback, and the assistant's
// read-only tools `analytics_report` (a governed aggregate as the caller) and `kpi_scorecard` (the caller's KPIs).
import { createHash } from "node:crypto";
import { z } from "zod";
import { parseQuestion, type NlChip, type NlTable } from "@shared/analytics/nl";
import { MEASURE_FNS, specProblem, VIZ_TYPES, groupable, TIME_PRESETS, windowLabel } from "@shared/analytics/model";
import { deltaPct, formatValue, STATUS_LABELS, UNITS } from "@shared/analytics/kpi";
import type { ReportResult, ReportSpec, ScorecardItem } from "@shared/analytics/types";
import type { Breakdown } from "@shared/analytics/api";
import { DATE_UNITS } from "@shared/model/jalali-buckets";
import { isNever } from "@shared/model/conditions";
import { faDigits } from "@shared/format";
import { todayISO } from "@shared/jalali";
import { TABLES } from "@shared/tables";
import type { Ctx } from "../../context";
import { access } from "../../access/provider";
import { orgSchema, orgTz } from "../../engine";
import { registerSkill, defineSkill } from "../ai/skills/registry";
import { isAiUnavailable, runForModule } from "../ai/skills/runtime";
import { registerTool } from "../ai/tools";
import { defineTool } from "../ai/tools/registry";
import { canRead, ready } from "./common";
import { runReport } from "./query";
import { scorecard } from "./indicators";

export interface AskOutput {
  spec: ReportSpec | null;
  chips: NlChip[];
  problem: string | null;
}

/** Numbers a narrative may use (all computed by code with the asker's access). */
export interface NarrativeFacts {
  title: string;
  table: string;
  window: string | null;
  measures: { key: string; label: string; unit: string; total: string; previous: string | null; change_pct: number | null }[];
  groups: { label: string; values: Record<string, string>; share_pct: number | null }[];
  records: number;
  suppressed: number;
  truncated: boolean;
}

export interface AnalyticsAi {
  /** ANA-023: a question (Persian or English) → a report definition over `tables` (validated and run by the caller) */
  questionToReport?(ctx: Ctx, question: string, tables: NlTable[], opts: { today: string }): Promise<AskOutput>;
  /** ANA-028: a description of a computed result — trends, the largest groups, the change against the previous period */
  narrate?(ctx: Ctx, facts: NarrativeFacts): Promise<{ text: string }>;
}

let impl: AnalyticsAi = {};

/** Plug the AI layer's analytics skills in (a later registration replaces the earlier one); returns an unregister function. */
export function registerAnalyticsAi(next: AnalyticsAi): () => void {
  impl = next;
  return () => {
    if (impl === next) impl = {};
  };
}

export const analyticsAi = (): AnalyticsAi => impl;

/** Which analytics AI capabilities are registered («analytics.questionToReport» …). */
export function analyticsAiCapabilities(): string[] {
  return Object.keys(impl).filter((k) => typeof (impl as Record<string, unknown>)[k] === "function").map((k) => `analytics.${k}`);
}

/** The tables the asker may report on, with their option lists (the parser's and a model's vocabulary). */
export async function askTables(ctx: Ctx): Promise<NlTable[]> {
  const schema = await orgSchema(ctx);
  const out: NlTable[] = [];
  for (const t of TABLES.values()) {
    const def = schema.def(t.key);
    if (!def || def.virtual || isNever(def.rowAccess?.read) || def.module === "analytics" || !access().canReadTable(ctx, def)) continue;
    const visible = access().visibleFields(ctx, def);
    const trimmed = visible ? { ...def, fields: def.fields.filter((f) => visible.has(f.name)) } : def;
    out.push({ def: trimmed, options: (f) => (f.choices ? (Array.isArray(f.choices) ? f.choices : schema.choices(f.choices)) : []) });
  }
  return out;
}

/** A question → a definition: the AI layer's when registered and available, else the rule-based parser. */
export async function questionToReport(ctx: Ctx, question: string): Promise<AskOutput & { ai: boolean }> {
  const tables = await askTables(ctx);
  const today = todayISO(orgTz(ctx));
  if (impl.questionToReport) {
    try {
      const r = await impl.questionToReport(ctx, question, tables, { today });
      if (r.spec) {
        const schema = await orgSchema(ctx);
        const problem = specProblem(r.spec, schema.def(r.spec.table), schema.lookup);
        if (!problem && tables.some((t) => t.def.key === r.spec!.table)) return { ...r, problem: null, ai: true };
      }
    } catch (e) {
      if (!isAiUnavailable(e)) throw e;
    }
  }
  return { ...parseQuestion(question, tables, { now: today }), ai: false };
}

// ----- narratives ------------------------------------------------------------------------------------------------------

/** The facts of a result (formatted numbers, shares of the first measure, the change against the previous period). */
export function narrativeFacts(title: string, spec: ReportSpec, r: ReportResult): NarrativeFacts {
  const m0 = r.measures[0];
  const total0 = m0 ? (r.totals[m0.key] ?? null) : null;
  return {
    title,
    table: r.table_label,
    window: spec.time?.window ? windowLabel(spec.time.window) : spec.time?.from && spec.time?.to ? `${spec.time.from} تا ${spec.time.to}` : null,
    measures: r.measures.map((m) => {
      const cur = r.totals[m.key] ?? null;
      const prev = r.previous ? (r.previous.totals[m.key] ?? null) : null;
      return { key: m.key, label: m.label, unit: UNITS[m.unit], total: formatValue(cur, m.unit), previous: r.previous ? formatValue(prev, m.unit) : null, change_pct: r.previous ? deltaPct(cur, prev) : null };
    }),
    groups: r.rows
      .filter((x) => !x.suppressed)
      .slice(0, 12)
      .map((x) => ({
        label: x.labels.join(" / "),
        values: Object.fromEntries(r.measures.map((m) => [m.label, formatValue(x.values[m.key] ?? null, m.unit)])),
        share_pct: m0 && m0.additive && total0 ? Math.round(((x.values[m0.key] ?? 0) / total0) * 1000) / 10 : null,
      })),
    records: r.total_n,
    suppressed: r.suppressed,
    truncated: r.truncated,
  };
}

const pct = (v: number) => `${faDigits(Math.abs(Math.round(v * 10) / 10))}٪`;

/** Sentences from the computed numbers only (the rule-based narrative). */
export function ruleNarrative(f: NarrativeFacts): string {
  const out: string[] = [];
  const m = f.measures[0];
  if (!m) return `«${f.title}»: ${faDigits(f.records)} رکورد.`;
  out.push(`${f.window ? `در ${f.window}، ` : ""}${m.label} در «${f.table}» ${m.total} است (${faDigits(f.records)} رکورد).`);
  if (m.change_pct !== null && m.previous !== null) out.push(m.change_pct === 0 ? `نسبت به دورهٔ پیش (${m.previous}) تغییری نکرده است.` : `نسبت به دورهٔ پیش (${m.previous}) ${pct(m.change_pct)} ${m.change_pct > 0 ? "بیشتر" : "کمتر"} شده است.`);
  const top = f.groups.filter((g) => g.label !== "سایر");
  if (top.length > 1 && top[0].share_pct !== null) {
    const [a, b] = top;
    out.push(`بیشترین سهم با «${a.label}» است (${pct(a.share_pct!)})${b?.share_pct !== null && b ? ` و پس از آن «${b.label}» (${pct(b.share_pct!)})` : ""}.`);
  } else if (top.length > 1) {
    out.push(`بیشترین مقدار: «${top[0].label}» (${Object.values(top[0].values)[0]}).`);
  }
  for (const x of f.measures.slice(1, 3)) out.push(`${x.label}: ${x.total}.`);
  if (f.suppressed) out.push(`${faDigits(f.suppressed)} گروه کوچک برای حفظ حریم خصوصی بی‌مقدار نشان داده شد.`);
  if (f.truncated) out.push("گروه‌های بیشتری از آنچه نشان داده شد وجود دارد.");
  return out.join(" ");
}

/** «این عدد را توضیح بده» without a model: the period's value, the previous period, the target and the largest element. */
export function indicatorNarrative(i: ScorecardItem, breakdowns: Breakdown[]): string {
  const v = (x: number | null) => formatValue(x, i.unit, i.decimals);
  const out = [`${i.name} در ${i.current.label}: ${i.current.value === null ? "بی‌مقدار" : v(i.current.value)}.`];
  if (i.previous.value !== null) out.push(`دورهٔ پیش (${i.previous.label}): ${v(i.previous.value)}${i.delta !== null ? ` — ${pct(i.delta)} ${i.delta > 0 ? "بیشتر" : "کمتر"}` : ""}.`);
  if (i.target !== null) out.push(`هدف ${v(i.target)} است و وضعیت «${STATUS_LABELS[i.status]}».`);
  const b = breakdowns.find((x) => x.elements.length);
  const top = b?.elements[0];
  if (b && top) out.push(`در تفکیک «${b.label}»، «${top.label}» با ${v(top.value)} در صدر است.`);
  return faDigits(out.join(" "));
}

/** A narrative of a result: the AI layer's when registered and available, else the rule-based sentences. */
export async function narrate(ctx: Ctx, facts: NarrativeFacts): Promise<{ text: string; ai: boolean }> {
  if (impl.narrate) {
    try {
      const r = await impl.narrate(ctx, facts);
      if (r.text?.trim()) return { text: r.text.trim(), ai: true };
    } catch (e) {
      if (!isAiUnavailable(e)) throw e;
    }
  }
  return { text: ruleNarrative(facts), ai: false };
}

// ----- skills ----------------------------------------------------------------------------------------------------------

const window = z.object({ unit: z.enum(Object.keys(DATE_UNITS) as [string, ...string[]]), from: z.number().int().min(-400).max(400), to: z.number().int().min(-400).max(400) });
const specSchema = z.object({
  table: z.string().max(60),
  measures: z.array(z.object({ fn: z.enum(MEASURE_FNS as [string, ...string[]]), field: z.string().max(80).nullish(), from: z.string().max(80).nullish(), filter: z.any().nullish(), label: z.string().max(80).nullish() })).max(6),
  dims: z.array(z.object({ field: z.string().max(80), bucket: z.string().max(20).nullish(), ranges: z.array(z.number()).max(20).nullish() })).max(3),
  filter: z.any().nullish(),
  time: z.object({ field: z.string().max(80), window: window.nullish(), from: z.string().max(10).nullish(), to: z.string().max(10).nullish() }).nullish(),
  viz: z.enum(VIZ_TYPES as [string, ...string[]]),
  limit: z.number().int().min(1).max(500).nullish(),
  columns: z.array(z.string().max(80)).max(12).nullish(),
});

/** The vocabulary of a question: readable tables, their groupable fields and option values (bounded). */
async function tableCatalog(ctx: Ctx): Promise<unknown> {
  const tables = await askTables(ctx);
  return tables.slice(0, 25).map((t) => ({
    key: t.def.key,
    label: t.def.plural,
    fields: t.def.fields
      .filter((f) => !f.hidden && !f.system && (groupable(f) || ["int", "decimal", "duration", "money", "percent"].includes(f.type)))
      .slice(0, 50)
      .map((f) => ({ name: f.name, label: f.label, type: f.type, options: f.type === "choice" ? t.options(f).slice(0, 15).map((o) => ({ value: o.value, label: o.label })) : undefined })),
  }));
}

const ASK_SKILL = defineSkill({
  key: "analytics.ask",
  name: "پرسش از داده‌ها",
  description: "پرسش فارسی یا انگلیسی دربارهٔ داده‌ها را به تعریف یک گزارش تبدیل می‌کند؛ گزارش با دسترسی خود پرسنده اجرا می‌شود",
  module: "analytics",
  catalog: ["ANA-023"],
  target: "none",
  tables: [],
  output: "json",
  schema: z.object({ spec: specSchema.nullable(), problem: z.string().max(300).nullish() }),
  tier: "standard",
  params: [{ name: "question", label: "پرسش", type: "text", required: true, max: 500 }],
  roles: ["agent", "auditor"],
  surfaces: ["module"],
  order: 1,
  system:
    "کار تو: تبدیل یک پرسش به تعریف یک گزارش (JSON) روی جدول‌ها و فیلدهایی که در بلوک tables آمده‌اند — هیچ نام دیگری نساز. سنجه‌ها: count, count_distinct, sum, avg, min, max, median, p90, p95, ratio (ratio با شرط filter). بُعدها: نام فیلد، و برای تاریخ‌ها bucket یکی از day, week, month, quarter, year, hour, weekday, hour_of_day. بازه‌ها نسبت به امروز در تقویم جلالی: window با unit و from/to (۰ = دورهٔ جاری، ۱- = دورهٔ پیش). viz یکی از column, bar, line, area, pie, donut, heatmap, funnel, pareto, score, gauge, table, pivot, list, grouped. اگر پرسش روشن نیست spec را null بگذار و problem را به فارسی بنویس.",
  template: "امروز: {{today}}\n\nجدول‌ها:\n{{tables}}\n\nپرسش:\n{{params.question}}",
  factKeys: ["tables"],
  facts: async (ctx) => ({ tables: await tableCatalog(ctx) }),
  fallback: async (ctx, input) => {
    const r = parseQuestion(String(input.params.question ?? ""), await askTables(ctx), { now: todayISO(orgTz(ctx)) });
    return { json: { spec: r.spec, problem: r.problem } };
  },
});

const NARRATE_SKILL = defineSkill({
  key: "analytics.narrate",
  name: "شرح گزارش",
  description: "روند، بزرگ‌ترین گروه‌ها و تغییر نسبت به دورهٔ پیش را از عددهای محاسبه‌شدهٔ یک گزارش شرح می‌دهد",
  module: "analytics",
  catalog: ["ANA-028"],
  target: "none",
  tables: [],
  output: "text",
  tier: "fast",
  roles: ["agent", "auditor"],
  surfaces: ["module"],
  order: 2,
  system: "کار تو: شرح کوتاه (دو تا چهار جمله) یک گزارش برای مدیر. فقط عددهای بلوک facts را به کار ببر و عددی نساز؛ اگر داده کم است همین را بگو. در پایان اگر نکته‌ای برای پیگیری هست یک پیشنهاد کوتاه بده.",
  template: "گزارش و عددهای محاسبه‌شده:\n{{facts}}",
  fallback: async (_ctx, input) => {
    const facts = (input.params.facts ?? null) as NarrativeFacts | null;
    return { text: facts ? ruleNarrative(facts) : "عددی برای شرح داده نشده است." };
  },
});

/** The default implementation through the declared skills (the AI layer may replace it with its own). */
export const SKILL_AI: AnalyticsAi = {
  async questionToReport(ctx, question) {
    const r = await runForModule(ctx, "analytics.ask", { params: { question } }, { ephemeral: true });
    const out = (r.json ?? {}) as { spec?: ReportSpec | null; problem?: string | null };
    return { spec: out.spec ? ({ v: 1, ...out.spec } as ReportSpec) : null, chips: [], problem: out.problem ?? null };
  },
  async narrate(ctx, facts) {
    const r = await runForModule(ctx, "analytics.narrate", { params: {} }, { ephemeral: true, facts: { facts } });
    return { text: String(r.text ?? "") };
  },
};

// ----- the assistant's tools -------------------------------------------------------------------------------------------

/** Characters `encodeURIComponent` leaves that an in-app link (`safePath`) does not take. */
const strictEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The report designer opened on a definition (`?spec=`, as «پرسش از داده‌ها» opens it): the assistant's link to adjust
 * and save a report it computed in a conversation. Null when the definition is too long for a link.
 */
export function designerPath(spec: ReportSpec, name: string): string | null {
  const path = `analytics/reports/new?spec=${strictEncode(JSON.stringify(spec))}&name=${strictEncode(name.slice(0, 120))}`;
  return path.length <= 4000 ? path : null;
}

const reportTool = defineTool({
  name: "analytics_report",
  title_fa: "گزارش از داده‌ها",
  description:
    "A governed aggregate over one ITSM table, computed in SQL with the caller's own access (only the records the caller may read are counted). Input: table key (incident, change_request, request_item, problem, kb_article, task_sla…), measure (count, count_distinct, sum, avg, min, max, median, p90, p95; durations are seconds), optional field to measure, up to two group-by fields (a date field takes a Jalali bucket: day, week, month, quarter, year, weekday, hour_of_day), an optional relative window (preset key: today, 7d, 30d, 90d, week, month, last_month, quarter, last_quarter, 6m, 12m, year, last_year) on a date field. Returns at most 30 groups with labels, the totals and the record count, and a link that opens the report in the designer, where the person can adjust and save it. Use it for «how many», «average time», «by priority» questions instead of guessing numbers.",
  input: z.object({
    table: z.string().max(60),
    measure: z.enum(MEASURE_FNS.filter((f) => f !== "ratio") as [string, ...string[]]).default("count"),
    field: z.string().max(80).optional(),
    group_by: z.array(z.object({ field: z.string().max(80), bucket: z.enum(["day", "week", "month", "quarter", "year", "weekday", "hour_of_day"]).optional() })).max(2).optional(),
    window: z.enum(TIME_PRESETS.map((p) => p.key) as [string, ...string[]]).optional(),
    date_field: z.string().max(80).optional(),
  }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    await ready(ctx);
    if (!canRead(ctx)) return { data: { allowed: false, reason: "no access to reports" }, summary_fa: "دسترسی به گزارش‌ها ندارید" };
    const preset = TIME_PRESETS.find((p) => p.key === input.window);
    const spec: ReportSpec = {
      v: 1,
      table: input.table,
      measures: [{ fn: input.measure as ReportSpec["measures"][number]["fn"], field: input.field ?? null }],
      dims: (input.group_by ?? []).map((g) => ({ field: g.field, bucket: (g.bucket ?? null) as never })),
      time: preset && input.date_field ? { field: input.date_field, window: preset.window } : null,
      viz: "table",
      limit: input.group_by?.length === 1 ? 30 : null,
      sort: { by: "value", dir: "desc" },
    };
    const r = await runReport(ctx, spec);
    const m = r.measures[0];
    const path = designerPath(spec, `${m?.label ?? "گزارش"} — ${r.table_label}`);
    return {
      // the conversation's report, opened in the designer to adjust and save (run again there with the reader's access)
      ...(path ? { refs: [{ type: "analytics_report", id: `draft-${createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 12)}`, label: "گشودن و ذخیرهٔ این گزارش در طراح", path }] } : {}),
      data: {
        table: r.table_label,
        measure: m ? { label: m.label, unit: UNITS[m.unit] } : null,
        window: preset?.label ?? null,
        total: m ? formatValue(r.totals[m.key] ?? null, m.unit) : null,
        records: r.total_n,
        groups: r.rows.slice(0, 30).map((x) => ({ group: x.labels.join(" / "), value: x.suppressed ? "withheld (small group)" : m ? formatValue(x.values[m.key] ?? null, m.unit) : null, records: x.n })),
        truncated: r.truncated || r.rows.length > 30,
      },
      summary_fa: `${faDigits(r.total_n)} رکورد در «${r.table_label}»`,
    };
  },
});

const scorecardTool = defineTool({
  name: "kpi_scorecard",
  title_fa: "کارت امتیاز شاخص‌ها",
  description:
    "The organisation's performance indicators (MTTA, MTTR, first-contact resolution, reopen rate, SLA compliance, backlog, change success rate…) for the current period as the caller may see them (computed with the caller's access), with the previous period, the change in percent, the target and the status (good/warn/bad). Optional practice filter: incident, problem, change, request, knowledge, sla, cmdb, release (DORA and release KPIs), project.",
  input: z.object({ practice: z.string().max(20).optional() }),
  kind: "read",
  area: "ai",
  level: "view",
  async run(ctx, input) {
    await ready(ctx);
    if (!canRead(ctx)) return { data: { allowed: false, reason: "no access to reports" }, summary_fa: "دسترسی به گزارش‌ها ندارید" };
    const { items } = await scorecard(ctx, { practice: input.practice, trend: 2 });
    return {
      data: {
        indicators: items.slice(0, 20).map((i) => ({
          name: i.name,
          period: i.current.label,
          value: i.restricted ? null : formatValue(i.current.value, i.unit, i.decimals),
          previous: formatValue(i.previous.value, i.unit, i.decimals),
          change_pct: i.delta,
          target: i.target === null ? null : formatValue(i.target, i.unit, i.decimals),
          status: STATUS_LABELS[i.status],
          restricted: !!i.restricted,
        })),
      },
      summary_fa: `${faDigits(items.length)} شاخص`,
    };
  },
});

let installed = false;

/** Declare the skills, the assistant's tools and the default (skill-based) implementation of the hook. */
export function installAnalyticsAi(): void {
  if (installed) return;
  installed = true;
  registerSkill(ASK_SKILL);
  registerSkill(NARRATE_SKILL);
  registerTool(reportTool as never);
  registerTool(scorecardTool as never);
  if (!Object.keys(impl).length) registerAnalyticsAi(SKILL_AI);
}
