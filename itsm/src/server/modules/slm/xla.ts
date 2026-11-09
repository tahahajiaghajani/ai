// Live experience scores of records (SLM-039): when a record of a table with an XLA policy changes (assignment,
// state, a comment, a breach), a deduplicated job scores it as the system — the first matching policy by order
// (its condition is tested in SQL, so it may walk references), facts from the record (reopens, reassignments, first
// response), its breached timers, the requester's public comments and the survey answer about it — and keeps one
// `slm_xla_score` row per record. A score that falls below the policy's threshold raises `record.slm.xla_low` once,
// for the assignee (a notification rule names it).
import { tableDef } from "@shared/tables";
import { xlaScore, type XlaFacts, type XlaResult } from "@shared/slm/logic";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import { pgArray, type Queryable, type Tx } from "../../db";
import { createIn, emitEvent, onRecordEvent, removeIn, systemCtx, updateIn } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { actsHere } from "../notify";
import { countRows, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";
import { recordExperience } from "./experience";

/** The active policies of a table, in order (cached per transaction-less read). */
export async function policiesFor(q: Queryable, ctx: Ctx, table: string): Promise<Row[]> {
  return liveRows(q, sysOf(ctx), "slm_xla_policy", { and: [{ f: "table_key", op: "eq", v: table }, { f: "active", op: "eq", v: true }] }, { order: "t.sort_order, t.created_at", limit: 50 });
}

/** The first policy whose condition holds for the record (tested in SQL). */
export async function policyOf(q: Queryable, ctx: Ctx, table: string, id: string): Promise<Row | null> {
  const sys = sysOf(ctx);
  for (const p of await policiesFor(q, sys, table)) {
    const cond = p.condition && typeof p.condition === "object" && Object.keys(p.condition).length ? (p.condition as Cond) : null;
    const hit = await liveRows(q, sys, table, cond ? { and: [{ f: "id", op: "eq", v: id }, cond] } : { f: "id", op: "eq", v: id }, { limit: 1 }).catch(() => []);
    if (hit.length) return p;
  }
  return null;
}

/** The facts an XLA score is made of. */
export async function xlaFacts(q: Queryable, ctx: Ctx, table: string, rec: Row, now = Date.now()): Promise<XlaFacts> {
  const sys = sysOf(ctx);
  const breaches = await countRows(q, sys, "task_sla", { and: [{ f: "table_key", op: "eq", v: table }, { f: "record_id", op: "eq", v: rec.id }, { f: "breached", op: "eq", v: true }] });
  const opened = msOf(rec.opened_at) ?? msOf(rec.created_at);
  const first = msOf(rec.first_response_at);
  const end = msOf(rec.resolved_at) ?? now;
  const requesters = [rec.caller_id, rec.requested_for].filter(isUuid);
  let comments = 0;
  if (requesters.length) {
    const r = await q.one<{ n: string | number }>(
      `select count(*) as n from sm_journal j where j.org_id = $1 and j.table_key = $2 and j.record_id = $3::uuid and j.kind = 'comment' and j.deleted_at is null and j.author = any($4::uuid[])`,
      [ctx.org.id, table, rec.id, pgArray(requesters)],
    ).catch(() => null);
    comments = Number(r?.n ?? 0);
  }
  const survey = await recordExperience(q, ctx, table, String(rec.id));
  return {
    breaches,
    reopens: Number(rec.reopen_count ?? 0) || 0,
    reassignments: Number(rec.reassignment_count ?? 0) || 0,
    first_response_hours: opened !== null && first !== null ? (first - opened) / 3_600_000 : null,
    open_hours: opened !== null ? Math.max(0, (end - opened) / 3_600_000) : 0,
    customer_comments: comments,
    survey_happiness: survey?.happiness ?? null,
    survey_csat: survey?.csat ?? null,
  };
}

/** Score one record now and store it (inside `tx`, as the system). Null when no policy applies. */
export async function scoreRecordIn(tx: Tx, ctx: Ctx, table: string, id: string): Promise<(XlaResult & { policy_id: string }) | null> {
  const sys = sysOf(ctx);
  const def = tableDef(table);
  if (!def || def.virtual) return null;
  const rec = await liveRow(tx, sys, table, id);
  const [existing] = await liveRows(tx, sys, "slm_xla_score", { and: [{ f: "table_key", op: "eq", v: table }, { f: "record_id", op: "eq", v: id }] }, { limit: 1 });
  const policy = rec ? await policyOf(tx, sys, table, id) : null;
  if (!rec || !policy) {
    // the record left every policy (or was deleted): its score goes too
    if (existing) await removeIn(tx, sys, "slm_xla_score", String(existing.id), { trusted: true });
    return null;
  }
  const facts = await xlaFacts(tx, sys, table, rec);
  const r = xlaScore(policy, facts);
  const group = def.scope.group && rec[def.scope.group] ? rec[def.scope.group] : null;
  const values = {
    table_key: table, record_id: id, record_number: rec.number ?? null, policy_id: policy.id, score: r.score, band: r.band,
    reliability: r.reliability, quality: r.quality, effort: r.effort, survey: r.survey, drivers: r.drivers,
    service_id: isUuid(rec.service_id) ? rec.service_id : null, assignment_group_id: isUuid(group) ? group : null, assigned_to: isUuid(rec.assigned_to) ? rec.assigned_to : null,
    computed_at: new Date().toISOString(),
  };
  const low = r.score < Number(policy.threshold ?? 50);
  const alertNow = low && !existing?.alerted;
  const row = existing
    ? await updateIn(tx, sys, "slm_xla_score", existing.id, { ...values, alerted: low ? existing.alerted || alertNow : false }, { trusted: true })
    : await createIn(tx, sys, "slm_xla_score", { ...values, alerted: alertNow }, { trusted: true });
  if (alertNow) {
    await emitEvent(tx, sys, {
      kind: "record.slm.xla_low", table, id, number: rec.number ?? null,
      data: { users: [rec.assigned_to].filter(isUuid), score: r.score, threshold: Number(policy.threshold ?? 50), xla_score_id: row.id },
    });
  }
  return { ...r, policy_id: String(policy.id) };
}

let installed = false;

/** Rescore records when they change (tables with an active policy only; the job checks). */
export function installXla(): (() => void)[] {
  if (installed) return [];
  installed = true;
  const off: (() => void)[] = [];
  off.push(
    onRecordEvent("slm.xla", async (e, jctx) => {
      if (!actsHere(jctx.cfg) || e.table.startsWith("slm_") || e.via === "sync") return;
      const def = tableDef(e.table);
      if (!def || def.virtual || !def.states) return;
      const sys = await systemCtx(jctx.cfg, e.org_id);
      if (!(await policiesFor(jctx.db, sys, e.table)).length) return;
      await enqueue(jctx.db, { kind: "slm.xla", orgId: e.org_id, payload: { table: e.table, id: e.id }, delayMs: 20_000, dedupeKey: `slm.xla:${e.table}:${e.id}`, maxAttempts: 4 });
    }, { kinds: ["record.created", "record.updated", "record.state_changed", "record.assigned", "record.commented", "record.sla_breach"] }),
  );
  off.push(
    registerJobHandler("slm.xla", async (job, jctx) => {
      const table = String(job.payload?.table ?? "");
      const id = String(job.payload?.id ?? "");
      if (!job.org_id || !table || !isUuid(id)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await sys.write((tx) => scoreRecordIn(tx, sys, table, id));
    }),
  );
  return off;
}
