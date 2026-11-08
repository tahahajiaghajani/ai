// Change enablement (docs/modules/change_FA.md): the tables are in src/shared/tables/change.ts, the pure logic in
// src/shared/change/logic.ts, the screens in src/ui/modules/change, the HTTP API in src/server/routes/change.ts.
// `installChangeModule()` (once per process, src/server/routes/modules.ts, after the SLA service) wires it in:
//   · hooks of its tables and the lifecycle guard (hooks.ts)
//   · the authorization cycle as a "*" hook after the SLA service's approvals, and the approver sources
//     change_manager / cab / ecab / service_owner of the approval rules (authorize.ts)
//   · jobs and the sweep (jobs.ts); the ITIL priority matrix as the default of `change_request`
//   · record meta `change` on GET /r/change_request/:id: the lifecycle the change uses and the AI skills available
//   · the seed of a new organisation (seed.ts), queued after the SLA service's calendars
// Extension points for later modules: the CMDB registers `registerImpactProvider` (impact.ts), the AI layer
// `registerChangeAi` (ai.ts), discovery reports configuration changes through POST /change/detected.
import { lifecycleOf } from "@shared/change/logic";
import { registerOrgSeed } from "../orgs/service";
import { registerPriorityDefault, SEED_DELAY_MS } from "../sla";
import { access } from "../../access/provider";
import { registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { aiCapabilities } from "./ai";
import { installAuthorization } from "./authorize";
import { installChangeHooks } from "./hooks";
import { installChangeJobs } from "./jobs";
import { seedChangeDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

/** Add the defaults of change enablement to an organisation (as the system; idempotent). */
export async function seedChangeDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedChangeDefaultsIn(tx, sys, opts));
}

export function installChangeModule(): void {
  if (installed) return;
  installed = true;
  installChangeHooks();
  installAuthorization();
  installChangeJobs();
  registerPriorityDefault("change_request");
  registerRecordMeta("change_request", ({ ctx, def, row }) => ({
    change: { lifecycle: lifecycleOf(row.model_states, row.type), can_work: access().canWrite(ctx, def, row), ai: aiCapabilities() },
  }));
  registerJobHandler("change.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedChangeDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "change.seed", orgId, delayMs: SEED_DELAY_MS + 90_000, dedupeKey: "change.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedChangeDefaultsIn, CHANGE_SEED_VERSION, SEED_MODELS, SEED_QUESTIONS, SEED_TEMPLATES, approvalRules, notificationRules, seedWindows, type SeedCounts } from "./seed";
export { changeConfig, sysOf, liveRows, liveRow, countRows, eqAll, isUuid, type Row } from "./common";
export { registerImpactProvider, impactProvider, type ImpactProvider } from "./impact";
export { registerChangeAi, changeAi, aiCapabilities, type ChangeAi, type PlanField, type PirSection } from "./ai";
export { cycleApprovals, tally, settleCycle, cabFor, cabPeople, groupUsers, roleHolders } from "./authorize";
export { ensureNextMeeting, refreshAgenda, decideItem, workbench, draftMinutes, completeMeeting, scheduleNext, type AgendaDecision } from "./cab";
export { recomputeConflicts, syncConflictState, slotsFor, riskFor, scheduleBlocks, occurrencesBetween, activeLockdowns, leadDays, CONFLICT_TRACKED } from "./schedule";
export { activateTasks, openMandatoryTasks, templateTasks, templateTasksProblem } from "./tasks";
export { ensurePir, draftPir, timelineOf } from "./pir";
export { applyLockdown, releaseLockdown } from "./lockdown";
export { sweep, ensureSweep, resetSweepThrottle, computeSuccessScores, countCausedIncidents, SWEEP_EVERY, type SweepResult } from "./jobs";
export { CONFLICT_TRIGGERS } from "./hooks";
