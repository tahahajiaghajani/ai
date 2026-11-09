// Event management, AIOps light and on-call (docs/modules/event_FA.md). The tables are in src/shared/tables/event.ts,
// the screens in src/ui/modules/event, the HTTP API in src/server/routes/event.ts (and the sign-in-free ingestion and
// acknowledgement endpoints on /api/public). `installEventModule()` (once per process, src/server/routes/modules.ts,
// after incident management and the CMDB) wires the module into the platform:
//   · hooks of its tables (hooks.ts): CI binding and anchors, severity matrix default, stamps, noise labels, group
//     roll-ups, on-call checks
//   · subscribers and jobs (jobs.ts): the processing pipeline, escalation timers, delayed incident rules, the sweep
//     (snoozes, maintenance, auto-close, heartbeats, page links, retention), SNS confirmations
//   · on-call as the notification service's `oncall` recipients and the assignment rules' «کشیک» method (oncall.ts)
//   · AI skills with rule-based answers, the assistant's on-call tool and the `{{block.oncall}}` template block (ai.ts)
//   · record meta `event` on alerts and correlated groups: what the caller may do
//   · the seed of a new organisation (seed.ts), queued after the SLA service's calendars
// Extension points: `registerEventSink` (other modules see every processed event: continuity's capacity records),
// `onCallForGroup` / `scheduleShifts` (who is on call), `startEscalation` (page for an alert).
import { registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { registerOrgSeed } from "../orgs/service";
import { SEED_DELAY_MS } from "../sla";
import { canRespond, canConfigure } from "./common";
import { installEventHooks } from "./hooks";
import { installEventJobs } from "./jobs";
import { installOnCallSources } from "./oncall";
import { installEventAi } from "./ai";
import { seedEventDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

/** Add the defaults of event management to an organisation (as the system; idempotent). */
export async function seedEventDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg as never, orgId);
  return sys.write((tx) => seedEventDefaultsIn(tx, sys, opts));
}

export function installEventModule(): void {
  if (installed) return;
  installed = true;
  installEventHooks();
  installEventJobs();
  installOnCallSources();
  installEventAi();
  for (const table of ["alert", "alert_group"]) {
    registerRecordMeta(table, async ({ ctx, def, row }) => ({ event: { can_respond: canRespond(ctx, def, row), can_configure: await canConfigure(ctx) } }));
  }
  registerJobHandler("event.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedEventDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "event.seed", orgId, delayMs: SEED_DELAY_MS + 90_000, dedupeKey: "event.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedEventDefaultsIn, EVENT_SEED_VERSION, NETWORK_TEAM, type SeedCounts } from "./seed";
export { eventConfig, canRespond, canConfigure, canManageOncall, inGroup } from "./common";
export { ingest, sourceOfKey, newSourceKey, forgetSources, parseBody, MAX_EVENT_BYTES, resetIngestThrottle, type SourceRow, type IngestResult } from "./ingest";
export { processPending, processEvent, simulateRule, maintenanceFor, bindCi, registerEventSink, type EventSink } from "./pipeline";
export { correlate, rollupGroup, causesOf, dependentsOf } from "./correlate";
export { routeAlert, startEscalation, stopEscalation, escalateStep, pageUser, ackByToken, ackView, ackLink, expirePages, sha256, type AckView } from "./escalation";
export { raiseIncident, applyIncidentRules, maybeResolveIncident, incidentDone } from "./incidents";
export { alertAction, alertActionIn, bulkAction, groupAction, acknowledgeIn, ALERT_ACTIONS, type AlertAction, type GroupAction } from "./actions";
export { scheduleShifts, onCallForGroup, onCallOfSchedule, myShifts, takeOnCall, schedulesOf } from "./oncall";
export { opsReport, noiseReport, noiseText, oncallLoadReport, type OpsReport, type NoiseReport } from "./reports";
export { sweep, ensureSweep, resetSweepThrottle, SWEEP_EVERY } from "./jobs";
export { groupFacts, ruleSummary, ruleCauses, withAi, EVENT_SKILLS } from "./ai";
