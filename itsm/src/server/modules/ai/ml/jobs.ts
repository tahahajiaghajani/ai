// Background work of the predictive AI (docs/spec/AI.md §13.2), on EVERY runtime (each trains and scores on the data it
// holds; no model call, no network):
//   · `ai.ml.tick` every 15 minutes per organisation: keeps the registry in step with the schema, queues the training
//     runs that are due and the risk scoring of open records; reschedules itself. Queued by record events and the
//     /ai/ml routes, so every organisation that works gets it.
//   · `ai.ml.train` one model: a classifier or a risk model (./train.ts), a cluster run (./clusters.ts) — the
//     administrator's «آموزش دوباره» sets `force`.
//   · `ai.ml.risk` one risk model: scores every open record of its table.
//   · `ai.ml.score` one record: its classifiers' predictions and its likely duplicate (record events of task tables).
import type { ServerConfig } from "../../../context";
import type { Queryable } from "../../../db";
import { onRecordEvent, orgSchema, systemCtx } from "../../../engine";
import { enqueue, registerJobHandler } from "../../../jobs";
import { tableDef } from "@shared/tables";
import { runClusters } from "./clusters";
import { scoreRecord, scoreRisks } from "./score";
import { modelSpecs, textFields, type ModelSpec } from "./specs";
import { modelRow, modelRows, recordOutcome, saveTraining, syncModels } from "./store";
import { trainModel } from "./train";
import { ensureInsightsTick } from "../insights";

export const ML_TICK_EVERY = 15 * 60_000;

/** Make sure the organisation's ML tick is queued (inside the caller's transaction when there is one). */
export async function ensureMlTick(q: Queryable, orgId: string): Promise<void> {
  await enqueue(q, { kind: "ai.ml.tick", orgId, dedupeKey: "ai.ml.tick", maxAttempts: 100 });
}

async function specsOf(cfg: ServerConfig, orgId: string): Promise<{ sys: Awaited<ReturnType<typeof systemCtx>>; specs: ModelSpec[] }> {
  const sys = await systemCtx(cfg, orgId);
  return { sys, specs: modelSpecs(await orgSchema(sys)) };
}

/** Run one model now (the job's work; tests call it directly). */
export async function runModel(cfg: ServerConfig, orgId: string, key: string, opts: { force?: boolean } = {}): Promise<unknown> {
  const { sys, specs } = await specsOf(cfg, orgId);
  const spec = specs.find((s) => s.key === key);
  const m = await modelRow(sys.db, orgId, key);
  if (!spec || !m || (!m.enabled && !opts.force)) return null;
  if (spec.kind === "cluster") {
    const r = await runClusters(sys, spec);
    await saveTraining(sys, m, { status: "ready", metrics: { ...r }, baseline: null, beats: true, params: null, rows: r.points, error: null, summary: { clusters: r.clusters, points: r.points } });
    return r;
  }
  if (spec.kind === "duplicate") {
    await saveTraining(sys, m, { status: "ready", metrics: null, baseline: null, beats: true, params: null, rows: 0, error: null, summary: {} });
    return null;
  }
  const out = await trainModel(sys, m, spec, opts);
  if (spec.kind === "risk" && out) await scoreRisks(sys, spec);
  return out;
}

export function installMlJobs(): void {
  registerJobHandler("ai.ml.tick", async (job, jctx) => {
    const orgId = job.org_id;
    if (!orgId) return;
    const org = await jctx.db.one(`select 1 from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
    if (!org) return;
    const { sys, specs } = await specsOf(jctx.cfg as ServerConfig, orgId);
    await syncModels(sys, specs);
    const now = Date.now();
    for (const m of await modelRows(jctx.db, orgId)) {
      if (!m.enabled || m.status === "retired") continue;
      if (m.schedule !== "manual" && m.train_after && Date.parse(m.train_after) <= now) {
        await enqueue(jctx.db, { kind: "ai.ml.train", orgId, payload: { key: m.key }, dedupeKey: `ai.ml.train:${m.key}`, maxAttempts: 3 });
      } else if (m.kind === "duplicate" && m.status === "new") {
        await enqueue(jctx.db, { kind: "ai.ml.train", orgId, payload: { key: m.key }, dedupeKey: `ai.ml.train:${m.key}`, maxAttempts: 3 });
      }
      if (m.kind === "risk" && m.status === "ready" && m.beats_baseline) {
        await enqueue(jctx.db, { kind: "ai.ml.risk", orgId, payload: { key: m.key }, dedupeKey: `ai.ml.risk:${m.key}`, maxAttempts: 3 });
      }
    }
    return { again: ML_TICK_EVERY };
  });

  registerJobHandler("ai.ml.train", async (job, jctx) => {
    const orgId = job.org_id;
    const p = (job.payload ?? {}) as { key?: string; force?: boolean };
    if (!orgId || !p.key) return;
    await runModel(jctx.cfg as ServerConfig, orgId, p.key, { force: !!p.force });
  });

  registerJobHandler("ai.ml.risk", async (job, jctx) => {
    const orgId = job.org_id;
    const p = (job.payload ?? {}) as { key?: string };
    if (!orgId || !p.key) return;
    const { sys, specs } = await specsOf(jctx.cfg as ServerConfig, orgId);
    const spec = specs.find((s) => s.key === p.key);
    if (spec?.kind === "risk") await scoreRisks(sys, spec);
  });

  registerJobHandler("ai.ml.score", async (job, jctx) => {
    const orgId = job.org_id;
    const p = (job.payload ?? {}) as { table?: string; id?: string; outcome?: { field: string; value: string | null } };
    if (!orgId || !p.table || !p.id) return;
    const { sys, specs } = await specsOf(jctx.cfg as ServerConfig, orgId);
    const def = (await orgSchema(sys)).def(p.table);
    if (!def) return;
    if (p.outcome) {
      // the record's final value of a predicted field (acceptance and online accuracy)
      await recordOutcome(sys, `classify:${p.table}:${p.outcome.field}`, p.id, p.outcome.value);
      return;
    }
    await scoreRecord(sys, def, p.id, specs);
  });

  // record events of task tables with a text: score new records and records whose text changed; record outcomes
  onRecordEvent(
    "ai.ml",
    async (e, jctx) => {
      const def = tableDef(e.table);
      if (!def || def.extends !== "task" || def.virtual || !e.org_id) return;
      await ensureMlTick(jctx.db, e.org_id);
      await ensureInsightsTick(jctx.db, e.org_id);
      const text = textFields(def);
      if (!text.length) return;
      if (e.kind === "record.created" || (e.kind === "record.updated" && (e.changed ?? []).some((c) => text.includes(c)))) {
        await enqueue(jctx.db, { kind: "ai.ml.score", orgId: e.org_id, payload: { table: e.table, id: e.id }, dedupeKey: `ai.ml.score:${e.id}`, maxAttempts: 3 });
      }
      if (e.kind === "record.updated") {
        // a person (or a rule) set a predicted field: its final value is the prediction's outcome
        for (const field of (e.changed ?? []).filter((c) => ["category", "assignment_group_id", "priority", "service_id"].includes(c))) {
          const to = e.changes?.[field]?.to ?? null;
          await enqueue(jctx.db, { kind: "ai.ml.score", orgId: e.org_id, payload: { table: e.table, id: e.id, outcome: { field, value: to === null ? null : String(to) } }, maxAttempts: 3 });
        }
      }
    },
    { kinds: ["record.created", "record.updated"] },
  );
}
