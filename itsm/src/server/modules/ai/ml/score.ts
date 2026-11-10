// Scoring (docs/spec/AI.md §13.3). Classifiers run in-process (no model call, no network): on a record's creation and
// on changes of its text (the `ai.ml.score` job), for a draft being typed (POST /ai/ml/predict, with the person's own
// values), and inside the assignment rules when a rule asks for «گروه با پیش‌بینی هوش مصنوعی» — applied only at or
// above the model's auto-apply threshold, recorded as `auto_applied`. Duplicates: a new record against the recent
// records of its table (local embeddings). Risk models: every open record of their table, every few minutes.
import type { TableDef } from "@shared/model/types";
import type { Ctx } from "../../../context";
import type { Queryable, Tx } from "../../../db";
import { uuidv7 } from "@shared/id";
import { localEmbed } from "../rag/local-embed";
import { loadClassifier, predictText, type LoadedClassifier } from "./core/classify";
import { nearest } from "./core/cluster";
import { scoreRisk, type RiskParams } from "./core/risk";
import { readRows, rowText } from "./data";
import { riskData } from "./risk-models";
import type { ClassifierSpec, DuplicateSpec, ModelSpec, RiskSpec } from "./specs";
import { dropPredictions, modelRow, modelRows, upsertPredictions, usableParams, type ModelRow, type PredictionInput } from "./store";
import { rowTokens } from "./train";
import { liveRefLabels } from "./labels";

const DAY = 86_400_000;

export interface ClassifierOutput {
  model: ModelRow;
  field: string;
  top: { label: string; confidence: number }[];
  why: { feature: string; weight: number }[];
}

/** The usable classifiers of a table (switched on, trained, beating their baseline), with their specs. */
export async function classifiersOf(q: Queryable, orgId: string, table: string, specs: readonly ModelSpec[]): Promise<{ m: ModelRow; spec: ClassifierSpec; c: LoadedClassifier }[]> {
  const out: { m: ModelRow; spec: ClassifierSpec; c: LoadedClassifier }[] = [];
  for (const m of await modelRows(q, orgId, { table, kind: "classifier" })) {
    const spec = specs.find((s) => s.key === m.key);
    if (!spec || spec.kind !== "classifier") continue;
    const c = await usableParams(q, m, (raw) => loadClassifier(raw as never));
    if (c) out.push({ m, spec, c });
  }
  return out;
}

/** Classifier answers without labels that name no live row any more (an answer left with none is dropped). */
export async function liveOutputs(q: Queryable, orgId: string, def: TableDef, outs: ClassifierOutput[]): Promise<ClassifierOutput[]> {
  const kept: ClassifierOutput[] = [];
  for (const o of outs) {
    const live = await liveRefLabels(q, orgId, def, o.field, o.top.map((t) => t.label));
    const top = live ? o.top.filter((t) => live.has(t.label)) : o.top;
    if (top.length) kept.push(top.length === o.top.length ? o : { ...o, top });
  }
  return kept;
}

/** Every usable classifier's answer for a row (an empty text gives none). */
export function classify(models: readonly { m: ModelRow; spec: ClassifierSpec; c: LoadedClassifier }[], row: Record<string, unknown>): ClassifierOutput[] {
  const out: ClassifierOutput[] = [];
  for (const { m, spec, c } of models) {
    const p = predictText(c, rowTokens(row, spec), 3);
    if (!p.top.length) continue;
    out.push({ model: m, field: spec.target, top: p.top, why: p.why });
  }
  return out;
}

/** Score one record with the classifiers of its table and store the predictions (the `ai.ml.score` job). */
export async function scoreRecord(sys: Ctx, def: TableDef, id: string, specs: readonly ModelSpec[]): Promise<number> {
  const models = await classifiersOf(sys.db, sys.org.id, def.key, specs);
  const dup = specs.find((s): s is DuplicateSpec => s.kind === "duplicate" && s.table === def.key);
  const cols = [...new Set([...models.flatMap((x) => [...x.spec.text, ...x.spec.inputs, x.spec.target]), ...(dup?.text ?? [])])];
  if (!cols.length) return 0;
  const [row] = await readRows(sys, def, cols, { ids: [id], limit: 1 });
  if (!row) return 0;
  const items: PredictionInput[] = (await liveOutputs(sys.db, sys.org.id, def, classify(models, row))).map((o) => ({
    model: o.model,
    record_id: id,
    field: o.field,
    value: o.top[0].label,
    score: o.top[0].confidence,
    alternatives: o.top.map((t) => ({ value: t.label, score: t.confidence })),
    why: o.why,
  }));
  if (dup) {
    const d = await duplicateOf(sys, def, dup, row);
    if (d) items.push(d);
  }
  await upsertPredictions(sys, items);
  return items.length;
}

/**
 * The most similar recent record of the same table (created in the last 14 days, open or not), when its similarity
 * reaches the duplicate model's threshold. Stored with the other record's id as its value and up to four more.
 */
async function duplicateOf(sys: Ctx, def: TableDef, spec: DuplicateSpec, row: Record<string, unknown> & { id: string; created_at: string }): Promise<PredictionInput | null> {
  const m = await modelRow(sys.db, sys.org.id, spec.key);
  if (!m || !m.enabled) return null;
  const text = rowText(row, spec.text);
  if (text.length < 8) return null;
  const since = new Date(Date.parse(row.created_at) - 14 * DAY).toISOString();
  const recent = (await readRows(sys, def, spec.text, { sql: `t.created_at >= $1 and t.id <> $2`, params: [since, row.id], limit: 500 })).filter((r) => rowText(r, spec.text).length >= 8);
  if (!recent.length) return null;
  const v = localEmbed(text);
  const hits = nearest(v, recent.map((r) => localEmbed(rowText(r, spec.text))), m.threshold_show, 5);
  if (!hits.length) return null;
  return {
    model: m,
    record_id: row.id,
    field: null,
    value: recent[hits[0].index].id,
    score: hits[0].sim,
    alternatives: hits.map((h) => ({ value: recent[h.index].id, score: h.sim })),
    why: [],
  };
}

/** Score every open record of a risk model's table; predictions of records no longer open are removed. */
export async function scoreRisks(sys: Ctx, spec: RiskSpec): Promise<number> {
  const m = await modelRow(sys.db, sys.org.id, spec.key);
  if (!m) return 0;
  const params = await usableParams(sys.db, m, (raw) => raw as RiskParams);
  if (!params) {
    await dropPredictions(sys, spec.key, []);
    return 0;
  }
  const rows = await riskData(spec.def).open(sys);
  const items: PredictionInput[] = rows.map((r) => {
    const parts = (r.parts?.length ? r.parts : [{ key: r.record_id, label: "", x: r.x }]).map((p) => ({ ...p, s: scoreRisk(params, p.x) }));
    const top = parts.reduce((a, b) => (b.s.p > a.s.p ? b : a));
    return {
      model: m,
      record_id: r.record_id,
      field: null,
      value: null,
      score: top.s.p,
      alternatives: r.parts?.length ? parts.map((p) => ({ value: p.key, label: p.label, score: p.s.p })) : [],
      why: top.s.why,
    };
  });
  await upsertPredictions(sys, items);
  await dropPredictions(sys, spec.key, rows.map((r) => r.record_id));
  return items.length;
}

// ----- the assignment rules' predictor ----------------------------------------------------------------------------

/** Auto-applied group predictions waiting for their record's afterWrite (same transaction). */
const pendingApplied = new Map<string, PredictionInput>();
const pendingKey = (orgId: string, table: string, id: string) => `${orgId}:${table}:${id}`;

/**
 * «گروه با پیش‌بینی هوش مصنوعی» of an assignment rule: the group the table's group classifier predicts for the record
 * being written, when it is usable and its confidence reaches the model's auto-apply threshold (none set: never).
 */
export async function predictGroup(q: Queryable, ctx: Ctx, def: TableDef, row: Record<string, unknown>, specs: readonly ModelSpec[]): Promise<{ group: string; confidence: number } | null> {
  const field = def.scope.group;
  if (!field) return null;
  const key = `classify:${def.key}:${field}`;
  const spec = specs.find((s): s is ClassifierSpec => s.key === key && s.kind === "classifier");
  const m = spec ? await modelRow(q, ctx.org.id, key) : null;
  if (!spec || !m || m.threshold_apply === null) return null;
  const c = await usableParams(q, m, (raw) => loadClassifier(raw as never));
  if (!c) return null;
  const p = predictText(c, rowTokens(row, spec), 3);
  // the most confident label above the threshold that is still a live, active assignment group (a group deleted or
  // retired after training is skipped: the rule's own group or the next rule applies instead)
  const sure = p.top.filter((t) => t.confidence >= m.threshold_apply!);
  const live = await liveRefLabels(q, ctx.org.id, def, field, sure.map((t) => t.label), { assignment: true });
  const top = sure.find((t) => !live || live.has(t.label));
  if (!top) return null;
  if (typeof row.id === "string") {
    // a write that failed after its rules ran leaves its entry behind: keep the map small
    if (pendingApplied.size > 500) for (const k of [...pendingApplied.keys()].slice(0, 250)) pendingApplied.delete(k);
    pendingApplied.set(pendingKey(ctx.org.id, def.key, row.id), {
      model: m,
      record_id: row.id,
      field,
      value: top.label,
      score: top.confidence,
      alternatives: p.top.map((t) => ({ value: t.label, score: t.confidence })),
      why: p.why,
      status: "auto_applied",
    });
  }
  return { group: top.label, confidence: top.confidence };
}

/** The record was written: store the group it got from the predictor (the prediction says it was applied by AI). */
export async function storeApplied(tx: Tx, ctx: Ctx, def: TableDef, row: Record<string, unknown>): Promise<void> {
  const k = pendingKey(ctx.org.id, def.key, String(row.id));
  const p = pendingApplied.get(k);
  if (!p) return;
  pendingApplied.delete(k);
  if (def.scope.group && row[def.scope.group] !== p.value) return;
  await tx.query(
    `insert into sm_ai_predictions (id, org_id, model_id, model_key, model_version, kind, table_key, record_id, field, value, score, alternatives, why, status, decided_at)
     values ($1, $2, $3, $4, $5, 'classifier', $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, 'auto_applied', now())
     on conflict (org_id, model_key, record_id) do update set value = excluded.value, score = excluded.score, alternatives = excluded.alternatives, why = excluded.why,
       status = 'auto_applied', decided_at = now(), updated_at = now()`,
    [uuidv7(), ctx.org.id, p.model.id, p.model.key, p.model.version, def.key, p.record_id, p.field, p.value, p.score, JSON.stringify(p.alternatives ?? []), JSON.stringify(p.why ?? [])],
  );
}
