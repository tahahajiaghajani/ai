// The model registry and the predictions of this runtime (sm_ai_models, sm_ai_predictions; migration 0064). Rows are
// written by the runtime's jobs and by AI administrators' settings (ai:full, audited); predictions are read only
// through ./views.ts, which shows each one to people who read its record. Trained parameters are loaded once per model
// version and kept in memory.
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../../../context";
import type { Queryable } from "../../../db";
import { pgArray } from "../../../db";
import type { ModelKind, ModelSpec } from "./specs";

export type ModelStatus = "new" | "training" | "ready" | "below_baseline" | "insufficient" | "failed" | "retired";
export type TrainSchedule = "daily" | "weekly" | "monthly" | "manual";
export type PredictionStatus = "open" | "applied" | "auto_applied" | "dismissed" | "outcome";

export interface ModelRow {
  id: string;
  org_id: string;
  key: string;
  kind: ModelKind;
  name: string;
  table_key: string;
  target: string | null;
  inputs: string[];
  enabled: boolean;
  status: ModelStatus;
  version: number;
  seed: number;
  threshold_show: number;
  threshold_apply: number | null;
  schedule: TrainSchedule;
  metrics: Record<string, unknown> | null;
  baseline: Record<string, unknown> | null;
  beats_baseline: boolean;
  history: { version: number; trained_at: string; rows: number; summary: Record<string, number | null>; beats: boolean }[];
  training_rows: number;
  trained_at: string | null;
  train_after: string | null;
  last_error: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface PredictionRow {
  id: string;
  model_id: string;
  model_key: string;
  model_version: number;
  kind: ModelKind;
  table_key: string;
  record_id: string;
  field: string | null;
  value: string | null;
  score: number;
  alternatives: { value: string; score: number; [k: string]: unknown }[];
  why: { feature: string; weight: number }[];
  status: PredictionStatus;
  actual: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

const MODEL_COLS = `id, org_id, key, kind, name, table_key, target, inputs, enabled, status, version, seed, threshold_show::float8 as threshold_show,
  threshold_apply::float8 as threshold_apply, schedule, metrics, baseline, beats_baseline, history, training_rows, trained_at, train_after, last_error, updated_by, updated_at`;

const fixModel = (r: ModelRow): ModelRow => ({ ...r, threshold_show: Number(r.threshold_show), threshold_apply: r.threshold_apply === null ? null : Number(r.threshold_apply), inputs: r.inputs ?? [], history: r.history ?? [] });

export async function modelRows(q: Queryable, orgId: string, opts: { table?: string; kind?: ModelKind } = {}): Promise<ModelRow[]> {
  const params: unknown[] = [orgId];
  let where = "org_id = $1";
  if (opts.table) where += ` and table_key = $${params.push(opts.table)}`;
  if (opts.kind) where += ` and kind = $${params.push(opts.kind)}`;
  const rows = await q.query<ModelRow>(`select ${MODEL_COLS} from sm_ai_models where ${where} order by table_key, kind, key`, params);
  return rows.map(fixModel);
}

export async function modelRow(q: Queryable, orgId: string, key: string): Promise<ModelRow | null> {
  const r = await q.one<ModelRow>(`select ${MODEL_COLS} from sm_ai_models where org_id = $1 and key = $2`, [orgId, key]);
  return r ? fixModel(r) : null;
}

/** Defaults of a new model: classifiers suggest from 50%, never apply by themselves; a first training soon. */
function defaults(spec: ModelSpec): { threshold_show: number; schedule: TrainSchedule } {
  if (spec.kind === "risk") return { threshold_show: spec.def.alert ?? 0.6, schedule: "weekly" };
  if (spec.kind === "duplicate") return spec.pass ? { threshold_show: 0.9, schedule: "daily" } : { threshold_show: 0.82, schedule: "manual" };
  if (spec.kind === "cluster") return { threshold_show: 0.5, schedule: "daily" };
  return { threshold_show: 0.5, schedule: "weekly" };
}

/**
 * Bring the registry in step with the schema: a row for every spec (switched on, first training due now), names and
 * inputs kept current, and models whose table or field is gone marked «retired» (kept for their history).
 */
export async function syncModels(ctx: Ctx, specs: readonly ModelSpec[]): Promise<number> {
  const existing = new Map((await modelRows(ctx.db, ctx.org.id)).map((m) => [m.key, m]));
  const wanted = new Set(specs.map((s) => s.key));
  let created = 0;
  await ctx.write(
    async (tx) => {
      for (const s of specs) {
        const cur = existing.get(s.key);
        if (!cur) {
          const d = defaults(s);
          await tx.query(
            `insert into sm_ai_models (id, org_id, key, kind, name, table_key, target, inputs, threshold_show, schedule, seed, train_after)
             values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, now()) on conflict (org_id, key) do nothing`,
            [uuidv7(), ctx.org.id, s.key, s.kind, s.name, s.table, s.target, JSON.stringify(s.inputs), d.threshold_show, d.schedule, 1],
          );
          created++;
        } else if (cur.name !== s.name || JSON.stringify(cur.inputs) !== JSON.stringify(s.inputs) || cur.status === "retired") {
          await tx.query(`update sm_ai_models set name = $3, inputs = $4::jsonb, status = case when status = 'retired' then 'new' else status end, updated_at = now() where org_id = $1 and key = $2`, [
            ctx.org.id,
            s.key,
            s.name,
            JSON.stringify(s.inputs),
          ]);
        }
      }
      const gone = [...existing.values()].filter((m) => !wanted.has(m.key) && m.status !== "retired").map((m) => m.key);
      if (gone.length) await tx.query(`update sm_ai_models set status = 'retired', updated_at = now() where org_id = $1 and key = any($2::text[])`, [ctx.org.id, pgArray(gone)]);
    },
    { internal: true },
  );
  return created;
}

export interface TrainingOutcome {
  status: ModelStatus;
  metrics: Record<string, unknown> | null;
  baseline: Record<string, unknown> | null;
  beats: boolean;
  params: unknown;
  rows: number;
  error: string | null;
  /** headline numbers kept in the history (accuracy, macro-F1, AUC, skill…) */
  summary: Record<string, number | null>;
}

const HISTORY = 24;
const NEXT: Record<TrainSchedule, string | null> = { daily: "1 day", weekly: "7 days", monthly: "30 days", manual: null };

/**
 * Store a training run. A model that trained becomes the next version (its earlier versions stay in the history);
 * a run that could not train keeps the parameters of the current version and only records why.
 */
export async function saveTraining(ctx: Ctx, m: ModelRow, out: TrainingOutcome): Promise<void> {
  const trained = out.status === "ready" || out.status === "below_baseline";
  const next = NEXT[m.schedule];
  await ctx.write(
    async (tx) => {
      if (trained) {
        const history = [...m.history, { version: m.version + 1, trained_at: new Date().toISOString(), rows: out.rows, summary: out.summary, beats: out.beats }].slice(-HISTORY);
        await tx.query(
          `update sm_ai_models set status = $3, version = version + 1, metrics = $4::jsonb, baseline = $5::jsonb, beats_baseline = $6, params = $7::jsonb,
             training_rows = $8, trained_at = now(), history = $9::jsonb, last_error = null,
             train_after = ${next ? `now() + interval '${next}'` : "null"}, updated_at = now()
           where id = $1 and org_id = $2`,
          [m.id, ctx.org.id, out.status, JSON.stringify(out.metrics), JSON.stringify(out.baseline), out.beats, JSON.stringify(out.params), out.rows, JSON.stringify(history)],
        );
      } else {
        await tx.query(
          `update sm_ai_models set status = case when params is null then $3 else status end, last_error = $4, training_rows = $5,
             train_after = ${next ? `now() + interval '${next}'` : "null"}, updated_at = now() where id = $1 and org_id = $2`,
          [m.id, ctx.org.id, out.status, out.error, out.rows],
        );
      }
    },
    { internal: true },
  );
  if (trained) paramsCache.delete(m.id);
}

/** Nothing new to learn from: keep the model as it is and look again at its next scheduled time. */
export async function rescheduleModel(ctx: Ctx, m: ModelRow): Promise<void> {
  const next = NEXT[m.schedule];
  await ctx.write((tx) => tx.query(`update sm_ai_models set train_after = ${next ? `now() + interval '${next}'` : "null"}, updated_at = now() where id = $1 and org_id = $2`, [m.id, ctx.org.id]), { internal: true });
}

const paramsCache = new Map<string, { version: number; value: unknown }>();

/**
 * The parameters of a model's current version, prepared once by `load` (a vocabulary index…) and kept in memory until
 * a new version is trained. Null when it has none or is not usable (switched off, below its baseline).
 */
export async function usableParams<T>(q: Queryable, m: ModelRow, load: (raw: unknown) => T): Promise<T | null> {
  if (!m.enabled || m.status !== "ready" || !m.beats_baseline) return null;
  const hit = paramsCache.get(m.id);
  if (hit && hit.version === m.version) return hit.value as T;
  const row = await q.one<{ params: unknown; version: number }>(`select params, version from sm_ai_models where id = $1`, [m.id]);
  if (!row?.params) return null;
  const value = load(row.params);
  paramsCache.set(m.id, { version: row.version, value });
  if (paramsCache.size > 64) paramsCache.delete(paramsCache.keys().next().value!);
  return value;
}

export const clearParamsCache = (): void => paramsCache.clear();

// ----- predictions -----------------------------------------------------------------------------------------------

export interface PredictionInput {
  model: ModelRow;
  record_id: string;
  field: string | null;
  value: string | null;
  score: number;
  alternatives?: PredictionRow["alternatives"];
  why?: PredictionRow["why"];
  status?: PredictionStatus;
}

/**
 * Store a model's prediction of a record (one per model and record). A prediction a person already decided keeps its
 * decision unless the predicted value changed.
 */
export async function upsertPredictions(ctx: Ctx, items: readonly PredictionInput[]): Promise<void> {
  if (!items.length) return;
  await ctx.write(
    async (tx) => {
      for (const p of items) {
        await tx.query(
          `insert into sm_ai_predictions (id, org_id, model_id, model_key, model_version, kind, table_key, record_id, field, value, score, alternatives, why, status)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14)
           on conflict (org_id, model_key, record_id) do update set model_id = excluded.model_id, model_version = excluded.model_version, field = excluded.field,
             score = excluded.score, alternatives = excluded.alternatives, why = excluded.why, updated_at = now(),
             status = case when sm_ai_predictions.value is distinct from excluded.value then excluded.status else sm_ai_predictions.status end,
             decided_by = case when sm_ai_predictions.value is distinct from excluded.value then null else sm_ai_predictions.decided_by end,
             decided_at = case when sm_ai_predictions.value is distinct from excluded.value then null else sm_ai_predictions.decided_at end,
             value = excluded.value`,
          [uuidv7(), ctx.org.id, p.model.id, p.model.key, p.model.version, p.model.kind, p.model.table_key, p.record_id, p.field, p.value, p.score, JSON.stringify(p.alternatives ?? []), JSON.stringify(p.why ?? []), p.status ?? "open"],
        );
      }
    },
    { internal: true },
  );
}

/** Remove the predictions of a model for records it no longer applies to (an SLA that ended, a change closed). */
export async function dropPredictions(ctx: Ctx, modelKey: string, keepIds: readonly string[]): Promise<number> {
  const r = await ctx.write(
    (tx) => tx.query<{ id: string }>(`delete from sm_ai_predictions where org_id = $1 and model_key = $2 and status = 'open' and not (record_id = any($3::uuid[])) returning id`, [ctx.org.id, modelKey, pgArray([...keepIds])]),
    { internal: true },
  );
  return r.length;
}

const PRED_COLS = `id, model_id, model_key, model_version, kind, table_key, record_id, field, value, score::float8 as score, alternatives, why, status, actual, decided_by, decided_at, created_at, updated_at`;

export async function predictionsOf(q: Queryable, orgId: string, table: string, recordId: string): Promise<PredictionRow[]> {
  return q.query<PredictionRow>(`select ${PRED_COLS} from sm_ai_predictions where org_id = $1 and table_key = $2 and record_id = $3 order by model_key`, [orgId, table, recordId]);
}

export async function predictionById(q: Queryable, orgId: string, id: string): Promise<PredictionRow | null> {
  return q.one<PredictionRow>(`select ${PRED_COLS} from sm_ai_predictions where org_id = $1 and id = $2`, [orgId, id]);
}

/** The highest-scoring open predictions of a model (risk lists), at or above a score. */
export async function topPredictions(q: Queryable, orgId: string, modelKey: string, minScore: number, limit = 200): Promise<PredictionRow[]> {
  return q.query<PredictionRow>(`select ${PRED_COLS} from sm_ai_predictions where org_id = $1 and model_key = $2 and score >= $3 order by score desc, record_id limit $4`, [orgId, modelKey, minScore, limit]);
}

export async function decidePrediction(ctx: Ctx, id: string, status: "applied" | "dismissed"): Promise<void> {
  await ctx.write((tx) => tx.query(`update sm_ai_predictions set status = $3, decided_by = $4, decided_at = now(), updated_at = now() where org_id = $1 and id = $2`, [ctx.org.id, id, status, ctx.user.id]), {
    internal: true,
  });
}

/** Record the value a record ended with (acceptance and online accuracy of the model). */
export async function recordOutcome(ctx: Ctx, modelKey: string, recordId: string, actual: string | null): Promise<void> {
  await ctx.write(
    (tx) =>
      tx.query(`update sm_ai_predictions set actual = $4, status = case when status = 'open' then 'outcome' else status end, updated_at = now() where org_id = $1 and model_key = $2 and record_id = $3`, [
        ctx.org.id,
        modelKey,
        recordId,
        actual,
      ]),
    { internal: true },
  );
}
