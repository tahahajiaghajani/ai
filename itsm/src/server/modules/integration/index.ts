// The integration hub (docs/modules/integration_FA.md): tables in src/shared/tables/integration.ts, screens in
// src/ui/modules/integration, HTTP in src/server/routes/integration.ts (/api/o/:org/integration for the hub, and on the
// public API /api/v1: the record API with keys of integration users, /openapi.json, /in/:id, /scim/:source/…,
// /issues/:connection/hook). `installIntegrationModule()` (once per process, src/server/routes/modules.ts) wires:
//   · hooks: service accounts of integration users, ceilings, targets, secrets made when none was given
//   · subscribers and jobs: outbound webhooks, issue comments, directory synchronisation, scheduled exports
//   · the seed of a new organisation (notification rules of the hub)
import { registerOrgSeed } from "../orgs/service";
import { systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { SEED_DELAY_MS } from "../sla";
import { installIntegrationHooks } from "./hooks";
import { installWebhooks } from "./webhooks";
import { installIssueSync } from "./issues";
import { installDirectoryJobs } from "./directory";
import { installExportSchedules } from "./exports";
import { seedIntegrationDefaultsIn } from "./seed";

let installed = false;

export async function seedIntegrationDefaults(cfg: JobConfig, orgId: string): Promise<Record<string, number>> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedIntegrationDefaultsIn(tx, sys));
}

export function installIntegrationModule(): void {
  if (installed) return;
  installed = true;
  installIntegrationHooks();
  installWebhooks();
  installIssueSync();
  installDirectoryJobs();
  installExportSchedules();
  registerJobHandler("integration.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedIntegrationDefaults(jctx.cfg, job.org_id);
  });
  // the day-one rules after the notification service's own seed
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "integration.seed", orgId, delayMs: SEED_DELAY_MS + 120_000, dedupeKey: "integration.seed", maxAttempts: 5 }).then(() => undefined));
}

export { principalCtx, intLog } from "./common";
export { resolveKey } from "./users";
export { linkIssue, refsOf, ECHO_MARK } from "./issues";
