// SLA at risk (SLM-025/049/050): running timers of the records a person works — assigned to them, or to their groups
// — ranked by urgency, each with the empirical probability that it ends breached (from the finished timers of the same
// definition) and a Persian reason. Records come through the engine with the caller's access (a record the caller may
// not read is never listed); the probability model reads only finished timers' percentages.
import type { AtRiskItem } from "@shared/slm/api";
import { breachProbability, urgencyOf, num } from "@shared/slm/logic";
import { tableDef } from "@shared/tables";
import { prepareSubject, subjectOf } from "../../access";
import type { Ctx } from "../../context";
import { list } from "../../engine";
import { isUuid, liveRows, msOf, sysOf, type Row } from "./common";

const HISTORY = 300;
const cache = new Map<string, { at: number; finished: { percent: number; breached: boolean }[] }>();

/** Finished timers of a definition (their last percentage and whether they breached), cached for ten minutes. */
async function finishedOf(ctx: Ctx, definitionId: string): Promise<{ percent: number; breached: boolean }[]> {
  const key = `${ctx.org.id}:${definitionId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.finished;
  const rows = await liveRows(ctx.db, sysOf(ctx), "task_sla", { and: [{ f: "definition_id", op: "eq", v: definitionId }, { f: "stage", op: "in", v: ["achieved", "breached"] }] }, { order: "t.stop_at desc nulls last", limit: HISTORY });
  const finished = rows.map((r) => ({ percent: num(r.percent) ?? (r.stage === "breached" ? 100 : 0), breached: r.stage === "breached" || !!r.breached }));
  cache.set(key, { at: Date.now(), finished });
  return finished;
}

export const resetRiskCache = () => cache.clear();

/**
 * Running timers of records assigned to the caller (`mine`) or to the caller's groups (`groups`), at or past `min`
 * percent, most urgent first.
 */
export async function atRisk(ctx: Ctx, opts: { scope?: "mine" | "groups"; min?: number; limit?: number } = {}): Promise<AtRiskItem[]> {
  const scope = opts.scope ?? "mine";
  const min = opts.min ?? 50;
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  await prepareSubject(ctx, ctx.db);
  const s = subjectOf(ctx);
  const groups = s.writeGroups;
  const sys = sysOf(ctx);
  const timers = await liveRows(ctx.db, sys, "task_sla", { and: [{ f: "active", op: "eq", v: true }, { or: [{ f: "percent", op: "gte", v: min }, { f: "breached", op: "eq", v: true }, { f: "planned_end_at", op: "lt", v: new Date(Date.now() + 2 * 3_600_000).toISOString() }] }] }, { order: "t.planned_end_at nulls last", limit: 2000 });
  const byTable = new Map<string, Row[]>();
  for (const t of timers) byTable.set(String(t.table_key), [...(byTable.get(String(t.table_key)) ?? []), t]);
  const out: AtRiskItem[] = [];
  const now = Date.now();
  for (const [table, ts] of byTable) {
    const def = tableDef(table);
    if (!def || def.virtual) continue;
    const groupField = def.scope.group && def.fields.some((f) => f.name === def.scope.group) ? def.scope.group : null;
    const assignee = def.fields.some((f) => f.name === "assigned_to") ? "assigned_to" : null;
    if (!assignee && !groupField) continue;
    const ids = [...new Set(ts.map((t) => String(t.record_id)).filter(isUuid))].slice(0, 500);
    const scopeCond = scope === "mine" ? (assignee ? { f: assignee, op: "is_me" } : null) : groupField && groups.length ? { f: groupField, op: "in", v: groups } : null;
    if (!scopeCond || !ids.length) continue;
    const fields = ["number", "priority", "state", assignee, groupField, def.display].filter((x): x is string => !!x && def.fields.some((f) => f.name === x));
    let recs: Row[] = [];
    try {
      recs = (await list(ctx, table, { ids, filter: scopeCond as never, fields, size: 500, total: false })).rows;
    } catch {
      continue;
    }
    const byId = new Map(recs.map((r) => [String(r.id), r]));
    for (const t of ts) {
      const rec = byId.get(String(t.record_id));
      if (!rec) continue;
      const percent = num(t.percent);
      const end = msOf(t.planned_end_at);
      const paused = t.stage === "paused";
      const remaining = end === null ? null : end - now;
      const prob = isUuid(t.definition_id) ? breachProbability(percent ?? 0, await finishedOf(ctx, String(t.definition_id))) : null;
      const u = urgencyOf({ percent, remaining_ms: t.breached ? 0 : remaining, priority: rec.priority ?? null, p: prob && prob.n >= 10 ? prob.p : null });
      out.push({
        task_sla_id: String(t.id), table, record_id: String(t.record_id), number: rec.number ?? t.record_number ?? null, title: rec[def.display] ? String(rec[def.display]) : null,
        priority: rec.priority ?? null, assigned_to: assignee ? rec[assignee] ?? null : null, group_id: groupField ? rec[groupField] ?? null : null,
        name: String(t.name ?? ""), type: String(t.type ?? "sla"), percent, planned_end_at: t.planned_end_at ?? null, remaining_ms: remaining, breached: !!t.breached, paused,
        probability: prob && prob.n >= 10 ? prob.p : null, level: u.level, reason: u.reason,
      });
    }
  }
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  out.sort((a, b) => rank[a.level] - rank[b.level] || (a.remaining_ms ?? Infinity) - (b.remaining_ms ?? Infinity));
  return out.slice(0, limit);
}
