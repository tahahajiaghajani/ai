// Availability, capacity and IT service continuity (docs/modules/continuity_FA.md). The tables are in
// src/shared/tables/continuity.ts, the screens in src/ui/modules/continuity, the HTTP API in
// src/server/routes/continuity.ts. `installContinuityModule()` (once per process, src/server/routes/modules.ts, after
// the event module whose sinks it uses) wires the module into the platform: hooks of its tables (hooks.ts), the
// reactions to major incidents and the capacity sink of monitoring events (jobs.ts), the reviews sweep, and the seed.
import { systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { installContinuityHooks } from "./hooks";
import { installContinuityJobs } from "./jobs";
import { seedContinuityDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

export async function seedContinuityDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg as never, orgId);
  return sys.write((tx) => seedContinuityDefaultsIn(tx, sys, opts));
}

export function installContinuityModule(): void {
  if (installed) return;
  installed = true;
  installContinuityHooks();
  installContinuityJobs();
  registerJobHandler("continuity.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedContinuityDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "continuity.seed", orgId, delayMs: SEED_DELAY_MS + 120_000, dedupeKey: "continuity.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedContinuityDefaultsIn, CONTINUITY_SEED_VERSION, TEMPLATE_IMPACTS, type SeedCounts } from "./seed";
export { continuityConfig } from "./common";
export { availabilityReport, availabilityFor, serviceTrend, type AvailabilityReport, type ServiceAvailability, type ServiceTrend } from "./availability";
export { startExercise, markStep, finishExercise, biaFromTemplate, continuityDashboard, outageFromIncident, type ContinuityDashboard } from "./operations";
export { proposeFromIncident, proposeEnd, continuitySweep } from "./jobs";
