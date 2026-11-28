// The user APIs of «گردش‌کارها» (design F §5, §8.6, package F4c): «کارتابل» with record approvals, «گردش‌کارهای من»,
// «انجام‌شده‌ها», a process's diagram and start form (./inbox.ts); the cases, one case and its printable view
// (./cases.ts); claiming a pool step and the managers' actions, «دوباره پیدا کردن انجام‌دهنده» among them (./actions.ts);
// the notifications' events and seeds
// (./notices.ts). `installProcessApi()` (once per process, src/server/routes/modules.ts) subscribes the notices and
// registers the seeding job; the routes are src/server/routes/process.ts.
import { installProcessNotices } from "./notices";

export { inbox, inboxCount, doneSteps, myProcesses, processView, myGroups, type Inbox, type InboxRow, type MyProcess, type ProcessView, type StepView, type DoneRow } from "./inbox";
export { casesList, caseDetail, casePrint, type CaseFilters, type CaseDetail, type CasePrint, type MyStep } from "./cases";
export { startProcess, submitStep, claimStep, reassignStep, reresolveStep, pauseCase, resumeCase, cancelCaseAs, resumeFrom, CONNECTION_NEEDED, type ReassignInput } from "./actions";
export { seedNotices, seedNoticesIn, stepOpenedNotice, emitWaiting, NOTICE_SEEDS, NOTICES_VERSION, EVENT_WAITING, EVENT_RETURNED, EVENT_UNASSIGNED, type SeedResult } from "./notices";
export { managesCase, personFacts } from "./common";

let installed = false;

export function installProcessApi(): void {
  if (installed) return;
  installed = true;
  installProcessNotices();
}
