// What people see of the predictive AI (docs/spec/AI.md §13.6). The rule: a prediction is shown to whoever may read its
// record, and only through what they see of it —
//   · the record is read with the viewer's own access (`get`: 404 when they may not read it);
//   · a classifier's suggestion is computed NOW from the row as the viewer sees it (hidden fields never feed it) and
//     shown only for a field they see; «چرا؟» names words of the visible text and values of visible fields only;
//   · a duplicate is shown only when the viewer also reads the other record; labels of groups, services and other
//     records are resolved with the viewer's access («(محدود)» otherwise);
//   · a risk score lists its drivers by field label, never another record's data.
// Applying writes the field through the record service with the viewer's access. Models and their metrics are for AI
// administrators only (their per-class counts are organisation-wide aggregates).
import type { FieldDef, TableDef } from "@shared/model/types";
import { refTarget } from "@shared/model/types";
import { faDigits } from "@shared/format";
import type { MlDraftInput, MlModelPatch, MlModelView, MlPrediction, MlReason, MlRecordView } from "@shared/ai/ml";
import type { Ctx } from "../../../context";
import { bad, forbidden, notFound } from "../../../http/errors";
import { access } from "../../../access/provider";
import { readableIds } from "../../../access/service";
import { condEnv, get, orgSchema, RefSet, resolveDisplay, update, type OrgSchema } from "../../../engine";
import { audit } from "../../data/crud";
import { classifiersOf, classify, liveOutputs } from "./score";
import { modelSpecs, riskModelDef, slaRiskDef, type ModelSpec } from "./specs";
import { decidePrediction, modelRow, modelRows, predictionById, predictionsOf, type ModelRow, type PredictionRow } from "./store";

const RESTRICTED = "(محدود)";

function optionLabel(schema: OrgSchema, f: FieldDef, value: string): string | null {
  if (f.type !== "choice" && f.type !== "multichoice") return null;
  const opts = Array.isArray(f.choices) ? f.choices : typeof f.choices === "string" ? schema.choices(f.choices) : [];
  return opts.find((o) => o.value === value)?.label ?? value;
}

/** Labels of values of fields (choices by their option, references with the viewer's access). */
async function labeller(ctx: Ctx, schema: OrgSchema, def: TableDef, pairs: { field: string; value: string }[]): Promise<(field: string, value: string) => string> {
  const refs = new RefSet();
  for (const p of pairs) {
    const f = def.fields.find((x) => x.name === p.field);
    if (f && ["ref", "group", "user", "refs", "users"].includes(f.type)) refs.add(refTarget(f, def.key), p.value);
  }
  const display = refs.size ? await resolveDisplay(ctx.db, ctx, await condEnv(ctx), schema, refs) : {};
  return (field, value) => {
    const f = def.fields.find((x) => x.name === field);
    if (!f) return value;
    const o = optionLabel(schema, f, value);
    if (o !== null) return o;
    if (["ref", "group", "user", "refs", "users"].includes(f.type)) return display[value.toLowerCase()] ?? RESTRICTED;
    if (f.type === "bool") return value === "true" ? "بله" : "خیر";
    return value;
  };
}

const quality = (m: ModelRow): MlPrediction["quality"] => {
  const x = (m.metrics ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof x[k] === "number" ? (x[k] as number) : null);
  return m.kind === "risk" ? { auc: n("auc"), skill: n("skill") } : { accuracy: n("accuracy"), macro_f1: n("macro_f1") };
};

/** «چرا؟» of a classifier: words of the text, «فیلد: مقدار» of inputs the viewer sees. */
function classifierReasons(why: { feature: string; weight: number }[], def: TableDef, visible: ReadonlySet<string> | null, label: (f: string, v: string) => string): MlReason[] {
  const out: MlReason[] = [];
  for (const w of why) {
    if (w.feature.startsWith("@")) {
      const [field, ...rest] = w.feature.slice(1).split("=");
      const f = def.fields.find((x) => x.name === field);
      if (!f || (visible && !visible.has(field))) continue;
      out.push({ label: `${f.label}: ${label(field, rest.join("="))}`, weight: w.weight });
    } else out.push({ label: w.feature.replace(/_/g, " "), weight: w.weight });
  }
  return out;
}

/** «چرا؟» of a risk score: feature labels (and option labels of categorical ones), the direction in the weight. */
function riskReasons(why: { feature: string; weight: number }[], def: TableDef, labels: Record<string, string>, visible: ReadonlySet<string> | null, label: (f: string, v: string) => string): MlReason[] {
  const out: MlReason[] = [];
  for (const w of why) {
    const [name, value] = w.feature.split("=");
    const f = def.fields.find((x) => x.name === name);
    if (f && visible && !visible.has(name)) continue;
    const head = labels[name] ?? f?.label ?? name;
    out.push({ label: value !== undefined ? `${head}: ${f ? label(name, value) : faDigits(value)}` : head, weight: w.weight });
  }
  return out;
}

function riskLabels(spec: ModelSpec | undefined, def: TableDef): Record<string, string> {
  if (spec?.kind === "risk") return spec.def.labels;
  return slaRiskDef(def).labels;
}

/** Predictions of a record for the viewer (see the file's head). */
export async function recordPredictions(ctx: Ctx, table: string, id: string): Promise<MlRecordView> {
  if (!ctx.can("ai", "view")) return { predictions: [], note: null };
  const rec = await get(ctx, table, id);
  const schema = await orgSchema(ctx);
  const def = schema.def(table);
  if (!def) throw notFound("جدول پیدا نشد");
  const row = rec.row as Record<string, unknown>;
  const visible = access().visibleFields(ctx, def);
  const sees = (f: string | null) => !!f && (!visible || visible.has(f)) && f in row;
  const readonly = new Set<string>((rec.meta as { readonly?: string[] }).readonly ?? []);
  const canWrite = (rec.meta as { canWrite?: boolean }).canWrite === true;
  const specs = modelSpecs(schema);
  const models = await modelRows(ctx.db, ctx.org.id, { table });
  const stored = await predictionsOf(ctx.db, ctx.org.id, table, id);
  const out: MlPrediction[] = [];

  // classifiers: now, from what the viewer sees
  const usable = await classifiersOf(ctx.db, ctx.org.id, table, specs);
  // labels that name no live row (a deleted or retired group) are never suggested
  const live = (await liveOutputs(ctx.db, ctx.org.id, def, classify(usable, row))).filter((o) => sees(o.field));
  // duplicates: the other record must be readable too
  const dups = stored.filter((p) => p.kind === "duplicate" && p.value);
  const dupReadable = dups.length ? await readableIds(ctx, table, dups.flatMap((p) => [p.value!, ...p.alternatives.map((a) => a.value)])) : new Set<string>();
  const pairs = [
    ...live.flatMap((o) => [...o.top.map((t) => ({ field: o.field, value: t.label })), ...(row[o.field] ? [{ field: o.field, value: String(row[o.field]) }] : [])]),
    ...live.flatMap((o) => o.why.filter((w) => w.feature.startsWith("@")).map((w) => ({ field: w.feature.slice(1).split("=")[0], value: w.feature.split("=").slice(1).join("=") }))),
    ...stored.filter((p) => p.kind === "risk").flatMap((p) => p.why.filter((w) => w.feature.includes("=")).map((w) => ({ field: w.feature.split("=")[0], value: w.feature.split("=").slice(1).join("=") }))),
  ];
  const label = await labeller(ctx, schema, def, pairs);
  const dupLabels = dupReadable.size ? await recordLabels(ctx, schema, def, [...dupReadable]) : new Map<string, string>();

  for (const o of live) {
    const f = def.fields.find((x) => x.name === o.field)!;
    const s = stored.find((p) => p.model_key === o.model.key);
    const top = o.top[0];
    const current = row[o.field] === null || row[o.field] === undefined || row[o.field] === "" ? null : String(row[o.field]);
    out.push({
      id: s?.id ?? null,
      model: o.model.key,
      kind: "classifier",
      name: o.model.name,
      field: o.field,
      field_label: f.label,
      value: top.label,
      value_label: label(o.field, top.label),
      current,
      current_label: current === null ? null : label(o.field, current),
      score: top.confidence,
      alternatives: o.top.map((t) => ({ value: t.label, label: label(o.field, t.label), score: t.confidence })),
      why: classifierReasons(o.why, def, visible, label),
      status: s && s.value === top.label ? s.status : "open",
      model_version: o.model.version,
      trained_at: o.model.trained_at,
      quality: quality(o.model),
      confident: top.confidence >= o.model.threshold_show,
      alert: null,
      can_apply: canWrite && !readonly.has(o.field) && current !== top.label,
    });
  }
  for (const p of stored) {
    const m = models.find((x) => x.key === p.model_key);
    if (!m || !m.enabled) continue;
    if (p.kind === "risk") {
      const spec = specs.find((x) => x.key === p.model_key) as ModelSpec | undefined;
      const alert = m.threshold_show;
      out.push({
        id: p.id,
        model: p.model_key,
        kind: "risk",
        name: m.name,
        field: null,
        field_label: spec?.kind === "risk" ? spec.def.outcome : (riskModelDef(p.model_key)?.outcome ?? null),
        value: null,
        value_label: null,
        current: null,
        current_label: null,
        score: Number(p.score),
        alternatives: p.alternatives.map((a) => ({ value: String(a.value), label: String(a.label ?? ""), score: Number(a.score) })),
        why: riskReasons(p.why, def, riskLabels(spec, def), visible, label),
        status: p.status,
        model_version: p.model_version,
        trained_at: m.trained_at,
        quality: quality(m),
        confident: Number(p.score) >= alert,
        alert,
        can_apply: false,
      });
    } else if (p.kind === "duplicate" && p.value && dupReadable.has(p.value)) {
      out.push({
        id: p.id,
        model: p.model_key,
        kind: "duplicate",
        name: m.name,
        field: null,
        field_label: null,
        value: p.value,
        value_label: dupLabels.get(p.value) ?? RESTRICTED,
        current: null,
        current_label: null,
        score: Number(p.score),
        alternatives: p.alternatives.filter((a) => dupReadable.has(String(a.value))).map((a) => ({ value: String(a.value), label: dupLabels.get(String(a.value)) ?? RESTRICTED, score: Number(a.score) })),
        why: [],
        status: p.status,
        model_version: p.model_version,
        trained_at: m.trained_at,
        quality: null,
        confident: true,
        alert: null,
        can_apply: false,
      });
    }
  }
  const note = !out.length && models.some((m) => m.enabled) ? noteFor(models) : null;
  return { predictions: out, note };
}

function noteFor(models: ModelRow[]): string | null {
  const cls = models.filter((m) => m.kind === "classifier" && m.enabled);
  if (!cls.length) return null;
  if (cls.every((m) => m.status === "new" || m.status === "training")) return "مدل‌های پیش‌بینی این جدول هنوز آموزش ندیده‌اند.";
  if (cls.every((m) => m.status === "insufficient")) return "برای آموزش مدل‌های این جدول هنوز دادهٔ کافی نیست.";
  if (cls.every((m) => m.status !== "ready" || !m.beats_baseline)) return "مدل‌های این جدول از خط پایه بهتر نبودند و به کار نمی‌روند.";
  return null;
}

/** «شماره — عنوان» of records of a table the viewer reads (display field only when visible). */
async function recordLabels(ctx: Ctx, schema: OrgSchema, def: TableDef, ids: string[]): Promise<Map<string, string>> {
  const refs = new RefSet();
  for (const id of ids) refs.add(def.key, id);
  const display = await resolveDisplay(ctx.db, ctx, await condEnv(ctx), schema, refs);
  return new Map(ids.map((id) => [id, display[id.toLowerCase()] ?? RESTRICTED]));
}

/** Suggestions for a record being created, from the values the person typed (nothing is stored). */
export async function draftPredictions(ctx: Ctx, input: MlDraftInput): Promise<MlPrediction[]> {
  if (!ctx.can("ai", "view")) return [];
  const schema = await orgSchema(ctx);
  const def = schema.def(input.table);
  if (!def || def.virtual) throw bad("جدول پیدا نشد");
  if (!access().canCreate(ctx, def) && !access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const visible = access().visibleFields(ctx, def);
  const writable = access().writableFields(ctx, def, null);
  // only what the person may see and set feeds the models
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.values ?? {})) if (def.fields.some((f) => f.name === k) && (!visible || visible.has(k))) values[k] = typeof v === "string" ? v.slice(0, 6000) : v;
  const usable = await classifiersOf(ctx.db, ctx.org.id, def.key, modelSpecs(schema));
  const outs = (await liveOutputs(ctx.db, ctx.org.id, def, classify(usable, values))).filter((o) => (!visible || visible.has(o.field)) && (!writable || writable.has(o.field)));
  const label = await labeller(ctx, schema, def, outs.flatMap((o) => [...o.top.map((t) => ({ field: o.field, value: t.label })), ...o.why.filter((w) => w.feature.startsWith("@")).map((w) => ({ field: w.feature.slice(1).split("=")[0], value: w.feature.split("=").slice(1).join("=") }))]));
  return outs.map((o) => {
    const f = def.fields.find((x) => x.name === o.field)!;
    const top = o.top[0];
    const current = values[o.field] === null || values[o.field] === undefined || values[o.field] === "" ? null : String(values[o.field]);
    return {
      id: null,
      model: o.model.key,
      kind: "classifier" as const,
      name: o.model.name,
      field: o.field,
      field_label: f.label,
      value: top.label,
      value_label: label(o.field, top.label),
      current,
      current_label: current === null ? null : label(o.field, current),
      score: top.confidence,
      alternatives: o.top.map((t) => ({ value: t.label, label: label(o.field, t.label), score: t.confidence })),
      why: classifierReasons(o.why, def, visible, label),
      status: "open" as const,
      model_version: o.model.version,
      trained_at: o.model.trained_at,
      quality: quality(o.model),
      confident: top.confidence >= o.model.threshold_show,
      alert: null,
      can_apply: current !== top.label,
    };
  });
}

/**
 * The stored prediction behind an action, checked against the record's access: deciding it (applying or dismissing)
 * is changing the record — its write access, and the predicted field seen and writable (a reader who may not change the
 * record does not decide for those who work it).
 */
async function ownPrediction(ctx: Ctx, id: string): Promise<{ p: PredictionRow; row: Record<string, unknown>; version: number }> {
  const p = await predictionById(ctx.db, ctx.org.id, id);
  if (!p) throw notFound("پیش‌بینی پیدا نشد");
  const rec = await get(ctx, p.table_key, p.record_id);
  const meta = rec.meta as { canWrite?: boolean; readonly?: string[] };
  const row = rec.row as Record<string, unknown>;
  if (meta.canWrite !== true) throw forbidden("تصمیم دربارهٔ پیشنهادهای این رکورد با کسانی است که آن را تغییر می‌دهند");
  if (p.field && (!(p.field in row) || (meta.readonly ?? []).includes(p.field))) throw forbidden("این فیلد را نمی‌توانید تغییر دهید");
  return { p, row, version: Number((row as { version?: number }).version ?? 0) };
}

/**
 * Apply a classifier's suggestion: the field is written through the record service with the viewer's own access (a
 * field they may not change is refused there), then the prediction is marked «به کار رفت».
 */
export async function applyPrediction(ctx: Ctx, id: string, input: { value?: string | null; version?: number }): Promise<{ ok: true }> {
  const { p, row, version } = await ownPrediction(ctx, id);
  if (p.kind !== "classifier" || !p.field) throw bad("این پیش‌بینی مقداری برای اعمال ندارد");
  // what the record page offers: the stored prediction, and the model's answer now for the record as the viewer sees
  // it (a retrained model or an edited text suggests labels the stored row never had)
  const allowed = new Set([p.value, ...p.alternatives.map((a) => String(a.value))]);
  const schema = await orgSchema(ctx);
  const def = schema.def(p.table_key);
  if (def) {
    const usable = (await classifiersOf(ctx.db, ctx.org.id, p.table_key, modelSpecs(schema))).filter((x) => x.m.key === p.model_key);
    for (const o of await liveOutputs(ctx.db, ctx.org.id, def, classify(usable, row))) for (const t of o.top) allowed.add(t.label);
  }
  const value = input.value ?? p.value;
  if (!value || !allowed.has(value)) throw bad("این مقدار در پیشنهادهای مدل نیست");
  if (!(p.field in row)) throw forbidden("این فیلد را نمی‌بینید");
  await update(ctx, p.table_key, p.record_id, { [p.field]: value }, { version: input.version ?? version });
  await decidePrediction(ctx, id, "applied");
  return { ok: true };
}

/** Refuse a suggestion (its record still readable): kept for the model's acceptance figures. */
export async function dismissPrediction(ctx: Ctx, id: string): Promise<{ ok: true }> {
  await ownPrediction(ctx, id);
  await decidePrediction(ctx, id, "dismissed");
  return { ok: true };
}

// ----- administration (ai:full) -----------------------------------------------------------------------------------

export async function modelViews(ctx: Ctx): Promise<MlModelView[]> {
  ctx.need("ai", "full");
  const schema = await orgSchema(ctx);
  // acceptance «درست»: of the predictions whose record's final value is known, how many it matched — counted over the
  // same rows, never over applied ones (applying a suggestion makes the record agree with it)
  const counts = await ctx.db.query<{ model_key: string; status: string; n: number; judged: number; agreed: number }>(
    `select model_key, status, count(*)::int as n,
       count(*) filter (where actual is not null and status not in ('applied', 'auto_applied'))::int as judged,
       count(*) filter (where actual is not null and actual = value and status not in ('applied', 'auto_applied'))::int as agreed
     from sm_ai_predictions where org_id = $1 group by 1, 2`,
    [ctx.org.id],
  );
  return (await modelRows(ctx.db, ctx.org.id)).map((m) => {
    const def = schema.def(m.table_key);
    const c = counts.filter((x) => x.model_key === m.key);
    const n = (s: string) => c.filter((x) => x.status === s).reduce((a, x) => a + Number(x.n), 0);
    return {
      key: m.key,
      kind: m.kind,
      name: m.name,
      table: m.table_key,
      table_label: def?.plural ?? m.table_key,
      target: m.target,
      target_label: m.target ? (def?.fields.find((f) => f.name === m.target)?.label ?? (m.kind === "risk" ? (riskModelDef(m.key)?.outcome ?? "نقض توافق") : m.target)) : null,
      inputs: m.inputs,
      enabled: m.enabled,
      status: m.status,
      version: m.version,
      seed: m.seed,
      threshold_show: m.threshold_show,
      threshold_apply: m.threshold_apply,
      schedule: m.schedule,
      metrics: m.metrics,
      baseline: m.baseline,
      beats_baseline: m.beats_baseline,
      history: m.history,
      training_rows: m.training_rows,
      trained_at: m.trained_at,
      train_after: m.train_after,
      last_error: m.last_error,
      predictions: { open: n("open"), applied: n("applied"), auto_applied: n("auto_applied"), dismissed: n("dismissed"), outcome: c.reduce((a, x) => a + Number(x.judged), 0), agreed: c.reduce((a, x) => a + Number(x.agreed), 0) },
    };
  });
}

/** Change a model's switch, thresholds, schedule or seed (AI administrators; audited as an AI change). */
export async function patchModel(ctx: Ctx, key: string, patch: MlModelPatch): Promise<void> {
  ctx.need("ai", "full");
  const m = await modelRow(ctx.db, ctx.org.id, key);
  if (!m) throw notFound("مدل پیدا نشد");
  if (patch.threshold_apply !== undefined && patch.threshold_apply !== null && m.kind !== "classifier") throw bad("اعمال خودکار فقط برای مدل‌های طبقه‌بندی است");
  const sets: string[] = [];
  const params: unknown[] = [m.id, ctx.org.id];
  const set = (col: string, v: unknown) => sets.push(`${col} = $${params.push(v)}`);
  if (patch.enabled !== undefined) set("enabled", patch.enabled);
  if (patch.threshold_show !== undefined) set("threshold_show", patch.threshold_show);
  if (patch.threshold_apply !== undefined) set("threshold_apply", patch.threshold_apply);
  if (patch.schedule !== undefined) set("schedule", patch.schedule);
  if (patch.seed !== undefined) set("seed", patch.seed);
  if (!sets.length) return;
  await ctx.write(async (tx) => {
    await tx.query(`update sm_ai_models set ${sets.join(", ")}, updated_by = $${params.push(ctx.user.id)}, updated_at = now() where id = $1 and org_id = $2`, params);
    await audit(tx, ctx, "ai.model.update", "ai_model", m.id, `تنظیم مدل «${m.name}»`, { key, before: { enabled: m.enabled, threshold_show: m.threshold_show, threshold_apply: m.threshold_apply, schedule: m.schedule, seed: m.seed }, after: patch });
  });
}
