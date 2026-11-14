// Workflows across the Windows app and the authority (design F §3.6.3 step 3, §7.2–7.3, package F4b):
//   · the push subscriber: a submission that arrives pending (a Windows app's push; a person's own create through the
//     record API) is applied on arrival — once; its missing files are waited for, then it is refused (./apply.ts);
//   · `process.timer` re-checks pending submissions in case an event was missed (../timers): every push of a new
//     submission makes sure the timer looks within the hour, in the push's own transaction;
//   · the upload rule and the open-case check of linking (./upload.ts).
// `installProcessSync()` is mounted once with the modules (src/server/routes/modules.ts).
import type { ServerConfig } from "../../../context";
import { onRecordEvent, registerHooks, setPushCreateRefusal } from "../../../engine";
import { registerJobHandler } from "../../../jobs";
import { setUploadRule } from "../access";
import { wakeTimer, RECHECK_MS } from "../timers/timer";
import { applyPending, APPLY_JOB } from "./apply";
import { uploadAllowed } from "./upload";

export { applyPending, applyPendingIn, missingFiles, filesMissingNote, APPLY_JOB, FILES_WAIT_MS, type PushedOutcome } from "./apply";
export { uploadAllowed } from "./upload";
export { openCasesRefusal, OPEN_CASE_STATES } from "./link";

/** A member whose roles lack `work` create acts online only (§6.5): what their Windows app's push is told. */
export const WEB_ONLY = "این مرحله را در نسخهٔ وب انجام دهید";

let installed = false;

export function installProcessSync(): void {
  if (installed) return;
  installed = true;
  setUploadRule(uploadAllowed);
  setPushCreateRefusal("process_submission", WEB_ONLY);
  onRecordEvent(
    "process.submission_arrived",
    async (e, jctx) => {
      await applyPending(jctx.cfg as ServerConfig, e.org_id, e.id, Date.parse(e.at) || Date.now());
    },
    { tables: ["process_submission"], kinds: ["record.created"] },
  );
  registerHooks("process_submission", {
    // a new submission from a Windows app: the hourly re-check is queued with it, whatever happens to its event
    async validatePush(p) {
      if (!p.prev && p.ctx.actor !== "system") await wakeTimer(p.tx, p.ctx.org.id, Date.now() + RECHECK_MS);
      return null;
    },
  });
  registerJobHandler(APPLY_JOB, async (job, jctx) => {
    if (!job.org_id) return;
    const since = Number(job.payload?.since);
    await applyPending(jctx.cfg as ServerConfig, job.org_id, String(job.payload?.submission ?? ""), Number.isFinite(since) ? since : null);
  });
}
