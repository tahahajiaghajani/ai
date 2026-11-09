// The predictive AI (docs/spec/AI.md §13): classical models trained per organisation on its own data, in TypeScript,
// on every runtime (the Windows app too, offline) — text classifiers, duplicate detection, clustering into problem
// candidates, SLA breach and change failure probabilities, volume forecasts and anomalies. Numbers come from code; no
// model call is ever needed. Installed after the modules whose tables it learns from (`installAiMl` in
// routes/modules.ts).
import { registerHooks, registerRecordMeta, orgSchema } from "../../../engine";
import { setAssignmentPredictor } from "../../sla";
import { installMlJobs } from "./jobs";
import { installRiskModels } from "./risk-models";
import { predictGroup, storeApplied } from "./score";
import { modelSpecs } from "./specs";

export { ensureMlTick, runModel } from "./jobs";
export { forecastFor, holidaysBetween } from "./forecast";
export { clustersFor, decideCluster, runClusters } from "./clusters";
export { applyPrediction, dismissPrediction, draftPredictions, modelViews, patchModel, recordPredictions } from "./views";
export { modelSpecs, registerPredictionTarget, registerRiskModel, type ModelSpec, type RiskModelDef } from "./specs";
export { modelRow, modelRows, syncModels, clearParamsCache } from "./store";

/** Tables with at least one model, per organisation (record meta asks often: a short memory). */
const tablesWithModels = new Map<string, { at: number; tables: Set<string> }>();

let installed = false;

export function installAiMl(): void {
  if (installed) return;
  installed = true;
  installRiskModels();
  installMlJobs();
  // «گروه با پیش‌بینی هوش مصنوعی» of assignment rules: the group classifier, at its auto-apply threshold
  setAssignmentPredictor(async (q, ctx, def, row) => predictGroup(q, ctx, def, row, modelSpecs(await orgSchema(ctx, q))));
  registerHooks("*", {
    async afterWrite(w) {
      if (w.op === "create" && w.def.scope.group) await storeApplied(w.tx, w.ctx, w.def, w.next);
    },
  });
  // the record page shows the «پیش‌بینی هوشمند» panel to members who may use AI on tables that have models
  registerRecordMeta("*", async ({ ctx, def }) => {
    if (ctx.actor === "system" || !ctx.can("ai", "view") || def.extends !== "task") return { ai_predictions: false };
    const now = Date.now();
    let hit = tablesWithModels.get(ctx.org.id);
    if (!hit || now - hit.at > 30_000) {
      const rows = await ctx.db.query<{ table_key: string }>(`select distinct table_key from sm_ai_models where org_id = $1 and enabled and status <> 'retired'`, [ctx.org.id]);
      hit = { at: now, tables: new Set(rows.map((r) => r.table_key)) };
      tablesWithModels.set(ctx.org.id, hit);
    }
    return { ai_predictions: hit.tables.has(def.key) };
  });
}
