// The administration consoles (docs/modules/admin_FA.md): tables in src/shared/tables/admin.ts, screens in
// src/ui/modules/admin (the tenant console) and src/ui/modules/admin/platform (inside «مدیریت سامانه»), HTTP in
// src/server/routes/admin-tenant.ts (/api/o/:org/admin) and src/server/routes/admin-platform.ts (/api/admin, platform
// owner only). `installAdminModule()` (once per process, src/server/routes/modules.ts) wires:
//   · hooks: plan ceilings on custom fields, the studio's slots and codes, targets of imports and exports, notices
//   · jobs: announcements per organisation, backups, data exports, scheduled imports, the daily sweep (expired exports)
//   · the AI skills (studio draft, import mapping, access explanation) with rule-based answers
//   · the seed of a new organisation (seed.ts)
import { registerOrgSeed } from "../orgs/service";
import { systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import type { ServerConfig } from "../../context";
import { SEED_DELAY_MS } from "../sla";
import { installAdminHooks } from "./hooks";
import { installPlatformJobs } from "./platform";
import { installBackupJobs } from "./backup";
import { installImportJobs } from "./imports";
import { expireExports, installExportJobs } from "./exports";
import { installAdminSkills } from "./ai";
import { seedAdminDefaultsIn, type AdminSeedCounts } from "./seed";

let installed = false;

/** Add the console's defaults to an organisation (as the system; idempotent). */
export async function seedAdminDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<AdminSeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedAdminDefaultsIn(tx, sys, opts));
}

export function installAdminModule(): void {
  if (installed) return;
  installed = true;
  installAdminHooks();
  installPlatformJobs();
  installBackupJobs();
  installImportJobs();
  installExportJobs();
  installAdminSkills();
  registerJobHandler("admin.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedAdminDefaults(jctx.cfg, job.org_id);
  });
  // daily: expired exports lose their files
  registerJobHandler("admin.sweep", async (job, jctx) => {
    if (!job.org_id) return;
    await expireExports(jctx.cfg as ServerConfig, job.org_id);
    return { again: 24 * 3600_000 };
  });
  registerOrgSeed(async (tx, orgId) => {
    await enqueue(tx, { kind: "admin.seed", orgId, delayMs: SEED_DELAY_MS + 90_000, dedupeKey: "admin.seed", maxAttempts: 5 });
    await enqueue(tx, { kind: "admin.sweep", orgId, delayMs: 24 * 3600_000, dedupeKey: "admin.sweep", maxAttempts: 3 });
  });
}

export { needFeature, hasFeature, featureStates, orgPlan, usageOf, needWithinLimit } from "./common";
export { ADMIN_SEED_VERSION, seedAdminDefaultsIn } from "./seed";
