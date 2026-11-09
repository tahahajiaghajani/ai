// The tools of an agent (docs/spec/AI.md §11.8): its allowed patterns (`get_*`, `search_incident`, `skill:incident.triage`)
// ∩ the tools its PRINCIPAL may use — the catalogue is built with the principal's member context, so a table its roles
// cannot read has no tool and a table they cannot write has no draft — minus the guardrails' forbidden tables. When the
// allowed generated tools are many, tool retrieval picks those that fit the goal and the record (small local models).
// Skills named `skill:<key>` become tools that run the skill as the principal and return its output as data (they never
// write: the agent proposes with the draft tools). Every tool is wrapped by the guardrails: a forbidden table in the
// input is refused, forbidden fields are removed from what reads return, and a proposal that would write a forbidden
// table, field or state is refused before it is stored (checked on its payload — what would really be written).
import { z } from "zod";
import type { Ctx } from "../../../context";
import type { AgentConfig } from "@shared/ai/agents";
import { fieldForbidden, guardrailProblem, skillToolName, tableForbidden, toolAllowed } from "@shared/ai/agents";
import { tableDef } from "@shared/tables";
import { resolvePath } from "@shared/model/conditions";
import { list, orgSchema } from "../../../engine";
import { bad, forbidden } from "../../../http/errors";
import { defineTool, type AiToolDef, type ToolResult } from "../tools/registry";
import { selectRecordTools, toolCatalog, TOOLS_PER_TURN } from "../tools";
import { resolveSkill, runSkill } from "../skills";

/** Registered tools an agent is never given: charts are the assistant's, starting agents is people's. */
const NOT_FOR_AGENTS = new Set(["render_chart", "start_agent"]);

/** At most this many generated tools are offered in one turn (registered tools and skills come on top). */
export const AGENT_TOOLS_PER_TURN = TOOLS_PER_TURN;

/** The record a skill tool runs on: a uuid, or a number read with the principal's access. */
async function recordId(ctx: Ctx, table: string, idOrNumber: string): Promise<string> {
  const v = idOrNumber.trim();
  if (/^[0-9a-f-]{36}$/i.test(v)) return v.toLowerCase();
  const def = (await orgSchema(ctx)).def(table);
  if (!def?.numbered) throw bad("شناسهٔ رکورد را از جست‌وجو بدهید");
  const r = await list(ctx, table, { filter: { f: "number", op: "eq", v: v.toUpperCase() }, size: 1, total: false, fields: ["id"] });
  if (!r.rows.length) throw bad(`«${v}» پیدا نشد یا در دسترس نیست`);
  return String(r.rows[0].id);
}

/** A skill as an agent's tool (run as the principal, output as data, nothing written). */
function skillTool(key: string, name: string, description: string, target: string): AiToolDef {
  return defineTool({
    name: skillToolName(key),
    title_fa: `مهارت «${name}»`,
    description: `Runs the AI skill «${name}» (${description.slice(0, 300)})${target === "record" ? " on one record (table + id or number)" : target === "text" ? " on a text" : ""} and returns its output as data: text, JSON or field suggestions with reasons. It writes nothing — propose changes with the draft tools.`,
    input: z.object({
      table: z.string().max(60).optional(),
      id: z.string().max(40).optional().describe("The record's id or number"),
      text: z.string().max(8000).optional(),
      params: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean()])).optional(),
    }),
    kind: "read",
    area: "ai",
    level: "view",
    async run(ctx, p): Promise<ToolResult> {
      const id = p.table && p.id ? await recordId(ctx, p.table, p.id) : null;
      const r = await runSkill(ctx, key, { table: p.table ?? null, id, text: p.text ?? null, params: p.params ?? {} }, { propose: false });
      return {
        data: {
          skill: r.name,
          ...(r.text ? { text: r.text } : {}),
          ...(r.json ? { json: r.json } : {}),
          ...(r.suggestions.length ? { suggestions: r.suggestions.map((s) => ({ field: s.field, label: s.label, value: s.value, display: s.display, current: s.current_display, reason: s.reason, confidence: s.confidence })) } : {}),
          ...(r.journal ? { journal: r.journal } : {}),
          ...(r.citations.length ? { sources: r.citations.map((c) => ({ n: c.n, title: c.title, number: c.number, table: c.table })) } : {}),
          ...(r.fallback ? { note: "rule-based answer (no model)" } : {}),
        },
        summary_fa: r.name,
      };
    },
  });
}

/**
 * May a field of `table` reach this agent's model: not forbidden by its guardrails, and — for a field of a field group —
 * only when the agent's `field_groups` name the group (as for skills; `ai_private` never reaches a model anyway).
 */
export function agentSees(a: AgentConfig, table: string, field: string): boolean {
  if (fieldForbidden(a, table, field)) return false;
  const group = tableDef(table)?.fields.find((f) => f.name === field)?.group;
  return !group || a.field_groups.includes(group);
}

/**
 * Why a field path (`field` or `ref.field`) a tool would group, measure, sort or filter by may not reach this agent's
 * model (every hop checked against its guardrails and field groups), or null.
 */
function agentPathProblem(a: AgentConfig, table: string, path: unknown): string | null {
  const def = tableDef(table);
  if (!def || typeof path !== "string" || !path.trim()) return null;
  const r = resolvePath(def, path.trim().replace(/^[-+]/, ""));
  if (!r) return null;
  for (const step of [...r.hops, { def: r.def, field: r.field }]) {
    if (step.field.base && step.field.name === "id") continue;
    if (!agentSees(a, step.def.key, step.field.name)) return `فیلد «${step.field.label}» برای این عامل ممنوع است`;
  }
  return null;
}

/** The field paths a tool's input names (conditions, groups, metrics, the measured and dated field, the order). */
function inputPaths(p: Record<string, unknown>): unknown[] {
  const objs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
  return [
    p.field,
    p.date_field,
    ...objs(p.group_by).map((g) => g.field),
    ...objs(p.metrics).map((m) => m.field),
    ...objs(p.where).map((w) => w.field),
    ...String(typeof p.sort === "string" ? p.sort : "").split(",").map((x) => x.trim()),
  ];
}

/** Remove what the agent may not see from what a read tool of `table` returns (a record, rows, the legend). */
function stripFields(a: AgentConfig, table: string, data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const drop = (o: unknown) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o;
    return Object.fromEntries(Object.entries(o as Record<string, unknown>).filter(([k]) => agentSees(a, table, k)));
  };
  const d = { ...(data as Record<string, unknown>) };
  if (d.record) d.record = drop(d.record);
  if (Array.isArray(d.rows)) d.rows = d.rows.map(drop);
  if (d.fields) d.fields = drop(d.fields);
  // a record's history names the field of every change; a skill's suggestions the field they would set
  if (Array.isArray(d.changes)) d.changes = d.changes.filter((c) => !!c && typeof c === "object" && agentSees(a, table, String((c as { name?: unknown }).name ?? "")));
  if (Array.isArray(d.suggestions)) d.suggestions = d.suggestions.filter((x) => !!x && typeof x === "object" && agentSees(a, table, String((x as { field?: unknown }).field ?? "")));
  // internal notes reach the model only with the «internal» group (as for skills)
  if (Array.isArray(d.notes) && !a.field_groups.includes("internal")) d.notes = d.notes.filter((n) => !(n && typeof n === "object" && (n as { visibility?: string }).visibility === "internal"));
  return d;
}

/** A tool wrapped by the agent's guardrails (see the file's head). */
function guarded(a: AgentConfig, t: AiToolDef, table: string | null): AiToolDef {
  return {
    ...t,
    async run(ctx, input, rt) {
      const p = (input ?? {}) as Record<string, unknown>;
      for (const k of ["table", "to_table"]) {
        if (typeof p[k] === "string" && tableForbidden(a, p[k] as string)) throw forbidden(`جدول «${p[k]}» برای این عامل ممنوع است`);
      }
      // the tables a module tool reads or writes (a catalogue order writes requests), whatever its input says
      for (const x of t.tables ?? []) if (tableForbidden(a, x)) throw forbidden(`جدول «${x}» برای این عامل ممنوع است`);
      // what a tool groups, measures, sorts or filters by returns those values: only fields the agent may see
      const tbl0 = table ?? (typeof p.table === "string" ? p.table : null);
      if (tbl0) {
        for (const path of inputPaths(p)) {
          const problem = agentPathProblem(a, tbl0, path);
          if (problem) throw forbidden(problem);
        }
      }
      rt = { ...rt, limits: { table: (x) => !tableForbidden(a, x), field: (x, f) => agentSees(a, x, f), groups: a.field_groups } };
      const res = await t.run(ctx, input, rt);
      if (res.proposal) {
        const problem = guardrailProblem(a, res.proposal);
        if (problem) throw forbidden(`${problem}؛ این پیشنهاد ساخته نشد`);
      }
      const tbl = table ?? (typeof p.table === "string" ? p.table : null);
      return tbl ? { ...res, data: stripFields(a, tbl, res.data) } : res;
    },
  };
}

/**
 * The tools an agent is offered now, built with its principal's context. `question` and `record` steer tool retrieval
 * when the allowed generated tools are more than a turn should carry.
 */
export async function agentTools(pctx: Ctx, a: AgentConfig, opts: { question: string; record?: { table: string; id: string } | null; max?: number }): Promise<AiToolDef[]> {
  const { registered, generated } = await toolCatalog(pctx, { proposals: true });
  // never «start_agent»: an agent does not start agents (no loops; a test run starts nothing real)
  const reg = registered.filter((t) => toolAllowed(a.tools, t.name) && !NOT_FOR_AGENTS.has(t.name));
  const gen = generated.filter((e) => toolAllowed(a.tools, e.name) && !tableForbidden(a, e.table));
  const max = opts.max ?? AGENT_TOOLS_PER_TURN;
  const picked = gen.length > max ? selectRecordTools(gen, { question: opts.question, context: opts.record ? { record: { type: opts.record.table, id: opts.record.id } } : null }, { max }) : gen;
  const skills: AiToolDef[] = [];
  for (const pattern of a.tools) {
    if (!pattern.startsWith("skill:")) continue;
    const rs = await resolveSkill(pctx, pattern.slice(6)).catch(() => null);
    if (!rs || !rs.cfg.enabled) continue;
    skills.push(skillTool(rs.cfg.key, rs.cfg.name, rs.cfg.description, rs.def.target));
  }
  return [
    ...reg.map((t) => guarded(a, t, null)),
    ...picked.map((e) => guarded(a, e.build(), e.table)),
    ...skills.map((t) => guarded(a, t, null)),
  ];
}

/** Every tool name the studio's picker offers: the generated tools of every table, the registered tools and the skills. */
export async function toolNamesFor(pctx: Ctx | null, adminCtx: Ctx): Promise<{ available: Set<string>; all: { name: string; title_fa: string; kind: "read" | "propose" | "meta"; table: string | null }[] }> {
  const admin = await toolCatalog(adminCtx, { proposals: true });
  const mine = pctx ? await toolCatalog(pctx, { proposals: true }) : null;
  const all = new Map<string, { name: string; title_fa: string; kind: "read" | "propose" | "meta"; table: string | null }>();
  for (const t of admin.registered) all.set(t.name, { name: t.name, title_fa: t.title_fa, kind: t.kind, table: null });
  for (const e of admin.generated) all.set(e.name, { name: e.name, title_fa: e.title_fa, kind: e.kind, table: e.table });
  const available = new Set<string>();
  if (mine) {
    for (const t of mine.registered) {
      available.add(t.name);
      if (!all.has(t.name)) all.set(t.name, { name: t.name, title_fa: t.title_fa, kind: t.kind, table: null });
    }
    for (const e of mine.generated) {
      available.add(e.name);
      if (!all.has(e.name)) all.set(e.name, { name: e.name, title_fa: e.title_fa, kind: e.kind, table: e.table });
    }
  }
  return { available, all: [...all.values()].filter((t) => !NOT_FOR_AGENTS.has(t.name)) };
}
