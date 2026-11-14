// The workflow engine on the server (design F §3.5–3.6, package F4a): cases run on the flows executor as runs of kind
// `process` (runs.ts) with the workflow's own steps (steps.ts: «مرحلهٔ فرم», «انتخاب», «تعیین مقدار», «اعلان»);
// submissions are applied in one transaction on the authority (apply.ts), online through service.ts; a run's end
// closes its case (ended.ts). `installProcessEngine()` (once per process, src/server/routes/modules.ts) registers it.
import { registerProcessRuns } from "./runs";
import { registerProcessSteps } from "./steps";
import { installCaseEnd } from "./ended";

export { PROCESS_RUN_KIND, processHandlers, processVersionGraph, caseContext } from "./runs";
export { applySubmission, roundSettles, LATE_NOTE, COMMENT_NEEDED, type ApplyResult, type ApplyOutcome } from "./apply";
export { startCase, submitTask, cancelCase, type SubmitResult, type StartCaseInput, type SubmitTaskInput } from "./service";
export { processesRunHere } from "./here";
export { STEP_OPENED, STEP_WAIT, parseWaitKey, resolveInput } from "./steps";
export { replayProgress, refreshCase, participantsOf, OPEN_STATES, type LogStep } from "./progress";
export { caseRunEnded } from "./ended";
export { stepWaitKey, lockCase, loadVersionInfo, caseTasks, type CaseRow, type TaskRow, type VersionInfo, type SubmissionRow } from "./store";

let installed = false;

export function installProcessEngine(): void {
  if (installed) return;
  installed = true;
  registerProcessSteps();
  registerProcessRuns();
  installCaseEnd();
}
