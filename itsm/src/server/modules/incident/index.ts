// Incident management (docs/modules/incident_FA.md): the tables are in src/shared/tables/incident.ts, the screens in
// src/ui/modules/incident, the HTTP API in src/server/routes/incident.ts. `installIncidentModule()` (once per process,
// src/server/routes/modules.ts, after the SLA service) wires the module into the platform:
//   · hooks of its tables (hooks.ts) — one of them on "*" so it runs after the SLA service's priority matrix
//   · the ITIL priority matrix as the default of `incident` until the organisation keeps its own row
//   · record meta `incident` on GET /r/incident/:id: what the caller may do (work, manage major incidents) and which
//     AI skills are available
//   · event subscribers and jobs (jobs.ts): cascades, major-incident events and review drafts, reassignment alerts,
//     requester replies, comment propagation, the sweep (auto-close, follow-ups, late stakeholder updates)
//   · the seed of a new organisation (seed.ts), queued a little after the SLA service's calendars
// Extension points for later modules: the event module creates incidents from alerts with `createFromAlert`
// (alerts.ts), continuity plans subscribe to `record.incident.major_declared`, the AI layer registers its skills with
// `registerIncidentAi` (ai.ts).
import { registerPriorityDefault, SEED_DELAY_MS } from "../sla";
import { registerOrgSeed } from "../orgs/service";
import { registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { installIncidentHooks } from "./hooks";
import { installIncidentJobs } from "./jobs";
import { canManageMajor, canWork } from "./major";
import { aiCapabilities } from "./ai";
import { seedIncidentDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

/** Add the defaults of incident management to an organisation (as the system; idempotent). */
export async function seedIncidentDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedIncidentDefaultsIn(tx, sys, opts));
}

export function installIncidentModule(): void {
  if (installed) return;
  installed = true;
  installIncidentHooks();
  installIncidentJobs();
  registerPriorityDefault("incident");
  registerRecordMeta("incident", ({ ctx, def, row }) => ({
    incident: { can_work: canWork(ctx, def, row), can_manage_major: canManageMajor(ctx, def, row), ai: aiCapabilities().filter((k) => k.startsWith("incident.")) },
  }));
  registerJobHandler("incident.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedIncidentDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "incident.seed", orgId, delayMs: SEED_DELAY_MS + 60_000, dedupeKey: "incident.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedIncidentDefaultsIn, INCIDENT_SEED_VERSION, seedCategories, ensureRow, type SeedCounts } from "./seed";
export { incidentConfig, problemConfig, sysOf, liveRows, liveRow, countRows, eqAll, isUuid, faList, secondsBetween, type Row } from "./common";
export {
  majorAction, addTimelineEvent, changeTimelineEvent, promoteEntry, timelineOf, sendUpdate, draftReview, canWork, canManageMajor, lockIncident, workNote, officeCalendar,
  AUDIENCES, type Audience, type MajorAction, type MajorInput, type EventInput, type UpdateInput,
} from "./major";
export { escalate, mergeIncidents, createRelated, applyKnownError, readiness, similarIncidents, knownErrorMatches, type RelatedMode, type MergeResult, type Readiness } from "./actions";
export { sweep, ensureSweep, resetSweepThrottle, SWEEP_EVERY, type SweepResult } from "./jobs";
export { incidentDashboard, type IncidentDashboard } from "./dashboard";
export { registerIncidentAi, registerProblemAi, incidentAi, problemAi, aiCapabilities, type IncidentAi, type ProblemAi } from "./ai";
export { createFromAlert, type AlertInput } from "./alerts";
export { activeAnnouncements, announceFromIncident, audienceOf, endWithIncident, expireAnnouncements } from "./announce";
export { openMandatoryTasks } from "./hooks";
