// Release and deployment management (docs/modules/release_FA.md): the tables are in src/shared/tables/release.ts, the
// pure logic in src/shared/release/logic.ts, the screens in src/ui/modules/release, the HTTP API in
// src/server/routes/release.ts. `installReleaseModule()` (once per process, src/server/routes/modules.ts, after the
// SLA service and the change module) wires it in:
//   · hooks of its tables and the guards «release_go», «release_emergency», «release_task_ready», «deployment_gate»
//   · the go/no-go decision on the approvals service (onApprovalSettled) and the approver source «release_manager»
//   · jobs, the sweep and the subscribers (links, changes, new incidents)
//   · the AI skills release.notes / release.deployment_risk / release.briefing (rule-based fallbacks)
//   · record meta `release` on GET /r/release/:id (whether the caller holds the release manager's authority)
//   · the seed of a new organisation (seed.ts), queued after the SLA service's calendars and the change module's seed
// Extension points: deployments are shared with DevOps (src/server/modules/devops writes them from pipelines);
// `tagIncident` runs for every new incident (early life support, suspects after a production deployment).
import { registerOrgSeed } from "../orgs/service";
import { registerApproverSource, SEED_DELAY_MS } from "../sla";
import { access } from "../../access/provider";
import { registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { groupUsers, roleHolders } from "../change";
import { installReleaseHooks } from "./hooks";
import { installDecisionHooks } from "./decision";
import { installReleaseJobs } from "./jobs";
import { installReleaseSkills } from "./ai";
import { RELEASE_MANAGERS_GROUP, seedReleaseDefaultsIn, type SeedCounts } from "./seed";
import { eqAll, liveRows, managesReleases, sysOf, type Row } from "./common";

let installed = false;

/** Add the defaults of release management to an organisation (as the system; idempotent). */
export async function seedReleaseDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedReleaseDefaultsIn(tx, sys, opts));
}

const others = (row: Row, people: string[]) => people.filter((p) => p !== row.assigned_to && p !== row.opened_by);

export function installReleaseModule(): void {
  if (installed) return;
  installed = true;
  installReleaseHooks();
  installDecisionHooks();
  installReleaseJobs();
  installReleaseSkills();
  // «مدیر انتشار» in approval rules: the record's release manager when they hold the authority, else the release
  // managers' group, else every holder of the role — never the person who carries out the deployment
  registerApproverSource("release_manager", async (q, ctx, _def, row) => {
    const sys = sysOf(ctx);
    const holders = await roleHolders(q, sys, "release_manager");
    const named = typeof row.release_manager_id === "string" ? row.release_manager_id : null;
    if (named && holders.includes(named) && others(row, [named]).length) return [named];
    const [group] = await liveRows(q, sys, "group", eqAll({ name: RELEASE_MANAGERS_GROUP }), { limit: 1 });
    const fromGroup = group ? others(row, await groupUsers(q, sys, [String(group.id)])) : [];
    return fromGroup.length ? fromGroup : others(row, holders);
  });
  registerRecordMeta("release", async ({ q, ctx, def, row }) => ({
    release: { can_work: access().canWrite(ctx, def, row), manages: await managesReleases(q, ctx) },
  }));
  registerRecordMeta("deployment", async ({ q, ctx, def, row }) => ({
    deployment: { can_work: access().canWrite(ctx, def, row), manages: await managesReleases(q, ctx) },
  }));
  registerJobHandler("release.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedReleaseDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "release.seed", orgId, delayMs: SEED_DELAY_MS + 120_000, dedupeKey: "release.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedReleaseDefaultsIn, RELEASE_SEED_VERSION, RELEASE_MANAGERS_GROUP, SEED_CHECKS, SEED_ENVIRONMENTS, SEED_POLICIES, type SeedCounts } from "./seed";
export { releaseConfig, managesReleases, environmentOf, isProductionEnv, liveRow, liveRows, sysOf, isUuid, type Row } from "./common";
export { evaluateChecksIn, ensureResultsIn, storedReadiness, applicableChecks, releaseChanges, freezesFor, linkedIds, copyOf } from "./checks";
export { decideRelease, recordDecisionIn, releasePeople, type Decision } from "./decision";
export { deploymentEffects, moveChange, recountRelease, recountDeployment, tagIncident, linkedReleases } from "./deploy";
export { computeReleaseRisk, recalcRiskIn, deploymentRiskFacts } from "./risk";
export { setupRelease, recalcRelease, releaseSweep, ensureReleaseSweep, resetReleaseSweepThrottle, RELEASE_SWEEP_EVERY } from "./jobs";
export { roadmap, readinessBoard, releaseOverview, releaseDashboard } from "./views";
export { noteFacts, ruleNotes, saveDraftNote, type Audience } from "./notes";
export { draftNotes, deploymentNarrative, briefingFacts, releaseRiskExplanation, releaseSkills, noAi } from "./ai";
