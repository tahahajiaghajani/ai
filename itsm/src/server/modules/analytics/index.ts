// Analytics, reporting and KPIs (docs/modules/analytics_FA.md): tables in src/shared/tables/analytics.ts, the shared
// model in src/shared/analytics, screens in src/ui/modules/analytics, HTTP API in src/server/routes/analytics.ts.
// `installAnalyticsModule()` (once per process, src/server/routes/modules.ts, after every module whose tables it
// reports on and before the AI skills) wires the module into the platform:
//   · hooks of its tables (hooks.ts): definitions validated against the schema and the author's access, sharing
//     compiled into row columns (sharing.ts; role holders recomputed when access changes), certification dropped on
//     a change by someone else, a new formula version for a changed formula, the module's own tables written only
//     by the system
//   · the report engine (query.ts): every aggregate in SQL over the rows the VIEWER may read (`readable`), field
//     groups respected, Jalali buckets, small-cell suppression
//   · indicators (indicators.ts): live values as the viewer, daily snapshots of the whole organisation readable only
//     by the indicator's score readers, thresholds and alerts
//   · dashboards (dashboards.ts), scheduled deliveries with Excel files (delivery.ts, xlsx.ts), JSON bundles
//     (bundle.ts), jobs (jobs.ts), the seed of a new organisation (seed.ts: the KPI library for the installed modules,
//     «داشبورد میز خدمت» and «داشبورد مدیریت تغییر»)
//   · AI (ai.ts): `registerAnalyticsAi` (question → definition, narratives), the skills «analytics.ask» and
//     «analytics.narrate» with rule-based fallbacks, the assistant's tools `analytics_report` and `kpi_scorecard`
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { installAnalyticsHooks } from "./hooks";
import { installSharingJobs } from "./sharing";
import { ensureTick, installAnalyticsJobs } from "./jobs";
import { installAnalyticsAi } from "./ai";
import { seedAnalyticsDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

/** Add the defaults of analytics to an organisation (as the system; idempotent). */
export async function seedAnalyticsDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  const out = await sys.write((tx) => seedAnalyticsDefaultsIn(tx, sys, opts));
  await ensureTick(cfg.db, orgId);
  return out;
}

export function installAnalyticsModule(): void {
  if (installed) return;
  installed = true;
  installAnalyticsHooks();
  installSharingJobs();
  installAnalyticsJobs();
  installAnalyticsAi();
  registerJobHandler("analytics.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedAnalyticsDefaults(jctx.cfg, job.org_id);
  });
  // after the other modules' seeds (groups, categories…): the library only needs their tables, which exist already
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "analytics.seed", orgId, delayMs: SEED_DELAY_MS + 120_000, dedupeKey: "analytics.seed", maxAttempts: 5 }).then(() => undefined));
}

export { ANALYTICS_SEED_VERSION, seedAnalyticsDefaultsIn, type SeedCounts } from "./seed";
export { runReport, isRestricted, type RunOptions } from "./query";
export { scorecard, scoreItem, indicatorHub, indicatorOf, collectIndicator, collectNow, collectAll, evaluatePeriod, pruneScores, readsScores, type IndicatorHub } from "./indicators";
export { dashboardView, runWidget, runOne, homeDashboard, canEditDefinition } from "./dashboards";
export { runSchedule, deliverTo, recipientsOf, dueSchedules, type DeliveryOutcome } from "./delivery";
export { exportBundle, importBundle } from "./bundle";
export { registerAnalyticsAi, analyticsAi, analyticsAiCapabilities, questionToReport, narrate, narrativeFacts, modelKeptField, ruleNarrative, indicatorNarrative, type AnalyticsAi, type NarrativeFacts } from "./ai";
export { ensureTick, snapshotStep, snapshotDue, hourIn, TICK_EVERY } from "./jobs";
export { recomputeRoleShares, roleHolders, compileFor } from "./sharing";
export { analyticsConfig, canAdmin, canAuthor, canRead } from "./common";
export { resultSheet, scorecardSheet, workbook, fileName, aboutSheet } from "./xlsx";
