// Workforce and agent experience (docs/modules/workforce_FA.md): tables in src/shared/tables/workforce.ts, pure logic in
// src/shared/workforce, screens in src/ui/modules/workforce, HTTP API in src/server/routes/workforce.ts.
// `installWorkforceModule()` (once per process, routes/modules.ts, after service level management) wires it in:
//   · the participant source (access.ts): every member reads their own workforce rows, their teams' rosters,
//     capacity and skill needs, and the reference data — managers read through the module's roles
//   · hooks (hooks.ts): skills ↔ member profiles (the platform's skills assignment method), time off ↔ out of office
//     and delegates, rosters, capacity, coverage, kudos
//   · the approvals service: the approver source «team_lead» (leads of the time off's team); a settled round approves
//     or rejects the time off
//   · points from record events (gamification.ts), jobs (jobs.ts), the coaching skill (performance.ts), the seed
// Shifts here are working shifts only: on-call rotations, paging and escalation belong to the event module
// (`oncall_*`, area oncall).
import { registerOrgSeed } from "../orgs/service";
import { onApprovalSettled, registerApproverSource, settledVerdict, SEED_DELAY_MS } from "../sla";
import { systemCtx, transitionIn } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { installWorkforceAccess } from "./access";
import { installWorkforceHooks } from "./hooks";
import { installWorkforceJobs } from "./jobs";
import { installGamification } from "./gamification";
import { installWorkforceSkills } from "./performance";
import { isUuid, liveRows, msOf, sysOf } from "./common";
import { seedWorkforceDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

/** Add the defaults of workforce and agent experience to an organisation (as the system; idempotent). */
export async function seedWorkforceDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedWorkforceDefaultsIn(tx, sys, opts));
}

export function installWorkforceModule(): void {
  if (installed) return;
  installed = true;
  installWorkforceAccess();
  installWorkforceHooks();
  installWorkforceJobs();
  installGamification();
  installWorkforceSkills();
  // «سرپرست تیم» in approval rules: the leads of the record's team (time off: its group_id), never the person
  registerApproverSource("team_lead", async (q, ctx, _def, row) => {
    if (!isUuid(row.group_id)) return [];
    const now = Date.now();
    const leads = await liveRows(q, sysOf(ctx), "group_member", { and: [{ f: "group_id", op: "eq", v: row.group_id }, { f: "kind", op: "eq", v: "lead" }] });
    return leads
      .filter((m) => (!m.valid_from || (msOf(m.valid_from) ?? 0) <= now) && (!m.valid_to || (msOf(m.valid_to) ?? 0) > now))
      .map((m) => String(m.user_id))
      .filter((u) => u !== row.user_id);
  });
  onApprovalSettled("wfm_absence", async (s) => {
    const verdict = settledVerdict(s);
    if (s.record.state !== "requested" || !verdict) return;
    await transitionIn(s.tx, sysOf(s.ctx), "wfm_absence", String(s.record.id), verdict === "approved" ? "approved" : "rejected", verdict === "rejected" ? { reject_reason: "در گردش تأیید رد شد" } : {}, { trusted: true });
  });
  registerJobHandler("wfm.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedWorkforceDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "wfm.seed", orgId, delayMs: SEED_DELAY_MS + 90_000, dedupeKey: "wfm.seed", maxAttempts: 5 }).then(() => undefined));
}

export { WORKFORCE_SEED_VERSION, WORKFORCE_ROLES, IT_SKILLS, SHIFT_PATTERNS, seedWorkforceDefaultsIn, type SeedCounts } from "./seed";
export { workforceConfig, managesWorkforce, overseenGroups, overseesGroup, myGroups, groupsOfUser } from "./common";
export { syncProfileSkills, applyAbsenceIn, clearAbsenceIn, workingDaysOf } from "./hooks";
export { teamBoard, shiftNow, patternsOf, rostersIn, absencesIn } from "./schedule";
export { capacityView, openLoads, dailyCounts, workTables } from "./capacity";
export { suggestAssignees, experts, inferSkills, coverageReport, skillsForRecord } from "./routing";
export { setPresence, heartbeat, teamPresence, setPrefs } from "./presence";
export { agentHome, ruleNextAction, registerNextBestAction } from "./home";
export { performanceView, personMetrics, mayReadIndividual, coachingFor, workforceSkills } from "./performance";
export { leaderboard, sendKudos, pointsOf, awardIn, awardResolution } from "./gamification";
export { workforceSweep, absenceTick, ensureWorkforceSweep, resetWorkforceSweepThrottle } from "./jobs";
export { WFM_PERSONAL, WFM_PUBLIC, WFM_TEAM } from "./access";
