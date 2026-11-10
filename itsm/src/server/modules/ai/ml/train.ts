// Training runs (docs/spec/AI.md §13.2), one model per run, as the system on this runtime's data:
//   · a classifier reads the table's records of the last year whose target is set (confidential records and secure
//     workspaces left out), trains naive Bayes and logistic regression on a seeded holdout and keeps the better one;
//   · a risk model reads its examples (./risk-models.ts) and trains a logistic regression split by time;
//   · a model is USED only when it beats its baseline (majority class / base rate); otherwise it is stored «زیر خط
//     پایه» with its metrics, and predictions stop until a later run beats it;
//   · nothing new since the last run (no record of the table changed): the run is skipped — the model stays as it is.
import type { Ctx } from "../../../context";
import { orgSchema } from "../../../engine";
import { trainTextClassifier, type TextExample } from "./core/classify";
import { fieldToken, textTokens } from "./core/features";
import { trainRisk } from "./core/risk";
import { readRows, rowText } from "./data";
import { liveRefLabels } from "./labels";
import { riskData } from "./risk-models";
import type { ClassifierSpec, ModelSpec, RiskSpec } from "./specs";
import { rescheduleModel, saveTraining, type ModelRow, type TrainingOutcome } from "./store";

const MIN_EXAMPLES = 50;
const DAY = 86_400_000;

/** The tokens of a row for a classifier: its text, then its categorical inputs. */
export function rowTokens(row: Record<string, unknown>, spec: Pick<ClassifierSpec, "text" | "inputs">): string[] {
  return [...textTokens(rowText(row, spec.text)), ...spec.inputs.map((i) => fieldToken(i, row[i])).filter((t): t is string => !!t)];
}

/** Has any record of the table changed since the model was trained (a run with nothing new is skipped)? */
async function changedSince(sys: Ctx, table: string, since: string | null): Promise<boolean> {
  if (!since) return true;
  const def = (await orgSchema(sys)).def(table);
  if (!def) return false;
  const r = await sys.db.one<{ n: number }>(`select count(*)::int as n from ${def.table} t where t.org_id = $1 and t.updated_at > $2`, [sys.org.id, since]);
  return Number(r?.n ?? 0) > 0;
}

async function trainClassifier(sys: Ctx, m: ModelRow, spec: ClassifierSpec): Promise<TrainingOutcome> {
  const def = (await orgSchema(sys)).def(spec.table)!;
  const rows = await readRows(sys, def, [...spec.text, spec.target, ...spec.inputs], {
    where: { f: spec.target, op: "nempty" },
    training: true,
    sql: `t.created_at >= $1`,
    params: [new Date(Date.now() - 365 * DAY).toISOString()],
    limit: 20_000,
  });
  // labels that name no live row any more (a deleted or retired group) are not learnt
  const live = await liveRefLabels(sys.db, sys.org.id, def, spec.target, [...new Set(rows.map((r) => String(r[spec.target])))]);
  const examples: TextExample[] = rows
    .map((r) => ({ tokens: rowTokens(r, spec), label: String(r[spec.target]) }))
    .filter((e) => e.tokens.length > 0 && (!live || live.has(e.label)));
  const empty = { metrics: null, baseline: null, beats: false, params: null, summary: {} };
  if (examples.length < MIN_EXAMPLES) {
    return { ...empty, status: "insufficient", rows: examples.length, error: `دادهٔ کافی نیست: دست‌کم ${MIN_EXAMPLES} رکورد با «${def.fields.find((f) => f.name === spec.target)?.label ?? spec.target}» لازم است و ${examples.length} رکورد هست` };
  }
  const t = trainTextClassifier(examples, { seed: m.seed, thresholds: [0.5, 0.6, 0.7, 0.8, 0.9] });
  if ("refused" in t) return { ...empty, status: "insufficient", rows: examples.length, error: t.refused };
  return {
    status: t.beats ? "ready" : "below_baseline",
    metrics: { ...t.metrics, algo: t.params.algo, candidates: t.candidates, train_n: t.train_n, test_n: t.test_n, dropped: t.dropped, vocabulary: t.params.vocab.terms.length },
    baseline: { accuracy: t.baseline.accuracy, macro_f1: t.baseline.macro_f1, label: t.baseline.label },
    beats: t.beats,
    params: t.params,
    rows: examples.length,
    error: null,
    summary: { accuracy: t.metrics.accuracy, macro_f1: t.metrics.macro_f1, baseline_accuracy: t.baseline.accuracy, baseline_macro_f1: t.baseline.macro_f1 },
  };
}

async function trainRiskModel(sys: Ctx, m: ModelRow, spec: RiskSpec): Promise<TrainingOutcome> {
  const examples = await riskData(spec.def).examples(sys);
  const empty = { metrics: null, baseline: null, beats: false, params: null, summary: {} };
  if (examples.length < MIN_EXAMPLES) return { ...empty, status: "insufficient", rows: examples.length, error: `دادهٔ کافی نیست: دست‌کم ${MIN_EXAMPLES} نمونهٔ پایان‌یافته لازم است و ${examples.length} نمونه هست` };
  const t = trainRisk(examples, spec.def.features, { seed: m.seed });
  if ("refused" in t) return { ...empty, status: "insufficient", rows: examples.length, error: t.refused };
  return {
    status: t.beats ? "ready" : "below_baseline",
    metrics: { ...t.metrics, train_n: t.train_n, test_n: t.test_n, columns: t.params.columns.length },
    baseline: { base_rate: t.metrics.base_rate, brier: t.metrics.brier_base },
    beats: t.beats,
    params: t.params,
    rows: examples.length,
    error: null,
    summary: { auc: t.metrics.auc, skill: t.metrics.skill, brier: t.metrics.brier, base_rate: t.metrics.base_rate },
  };
}

/**
 * Train one model now and store the run. `force` trains even when nothing changed (an administrator's «آموزش
 * دوباره», a new seed). Duplicate and cluster models have nothing to train here (their jobs run on their own).
 */
export async function trainModel(sys: Ctx, m: ModelRow, spec: ModelSpec, opts: { force?: boolean } = {}): Promise<TrainingOutcome | null> {
  if (spec.kind !== "classifier" && spec.kind !== "risk") return null;
  if (!opts.force && m.trained_at && m.status !== "new" && !(await changedSince(sys, spec.table, m.trained_at))) {
    // nothing new: keep the model, look again at the next scheduled time
    await rescheduleModel(sys, m);
    return null;
  }
  let out: TrainingOutcome;
  try {
    out = spec.kind === "classifier" ? await trainClassifier(sys, m, spec) : await trainRiskModel(sys, m, spec);
  } catch (e) {
    out = { status: "failed", metrics: null, baseline: null, beats: false, params: null, rows: 0, error: e instanceof Error ? e.message.slice(0, 300) : String(e), summary: {} };
  }
  await saveTraining(sys, m, out);
  return out;
}
