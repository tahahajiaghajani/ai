// The SLA service (docs/spec/services/sla.md): working calendars and holidays, SLA timers, approvals and the rules of
// records (business rules, assignment rules, priority matrix, categories, UI policies). `installSlaService()` wires
// it into the engine once per process (src/server/routes/modules.ts): hooks on every table in a fixed order, record
// meta, jobs, the approvals' participant source and the seed of new organisations.
//
// Order of the hooks every table gets ("*"):
//   afterWrite   SLA timers → approval rows → business rules (after)   (nested writes of rules see both applied)
//   beforeWrite  priority matrix → categories → business rules (before) → assignment rules → UI policies →
//                approvals (the `approval` field) → SLA timers (`sla_due`)   (each sees what the previous ones set)
import { registerOrgSeed } from "../orgs/service";
import { installCalendarHooks, installCalendarJobs, queueSeed } from "./calendars";
import { installSlaEngine } from "./sla";
import { installApprovals } from "./approvals";
import { installRules } from "./rules";
import { installPolicies } from "./policies";
import { installSlaFlowSteps } from "./flows";

let installed = false;

export function installSlaService(): void {
  if (installed) return;
  installed = true;
  const sla = installSlaEngine();
  const approvals = installApprovals();
  installCalendarHooks();
  installCalendarJobs();
  sla.apply();
  approvals.apply();
  installRules();
  installPolicies();
  approvals.plan();
  sla.plan();
  approvals.rest();
  sla.rest();
  registerOrgSeed((tx, orgId) => queueSeed(tx, orgId));
  // flows' «درخواست تأیید» and «به وقت کاری» (docs/spec/SERVICES.md)
  installSlaFlowSteps();
}

export { seedCalendars, seedCalendarsIn, holidaysBetween, calendarFor, SEED_DELAY_MS } from "./calendars";
export { fireTimer, recordTimers, slaTimeline, schedule as scheduleSlaTimer } from "./sla";
export {
  decide, decideMany, myApprovals, myApprovalCount, recordApprovals, requestApproval, requestApprovalIn, cancelApprovals, activeDelegations, delegateOf, delegatorsOf, managerOf, registerApproverSource, approverSources,
  cancelApprovalsIn, rerunApprovalRules, rerunApprovalRulesIn, onApprovalSettled, settledVerdict, type ApprovalSettled, type ApprovalSettledFn, type CancelOptions, type RerunOptions,
} from "./approvals";
export { registerPriorityDefault, setOnCallResolver, MAX_RULE_DEPTH } from "./rules";
export { uiPolicies, policiesOf } from "./policies";
export { config as slaConfig, forgetConfig } from "./common";
export { approvalStep, slaBusinessClock, roundKey, roundResult, installSlaFlowSteps } from "./flows";
