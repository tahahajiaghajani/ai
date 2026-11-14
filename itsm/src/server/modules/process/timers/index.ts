// Time in workflows (design F §3.4–3.5, package F4b): the organisation's `process.timer` (reminders, escalations, the
// «پایان مهلت» port, pending submissions looked at again — ./timer.ts) and `process.delegation` (open tasks follow
// delegations and out-of-office switches as they start and end — ./delegation.ts). Both act on the authority only.
// `installProcessTimers()` is mounted once with the modules (src/server/routes/modules.ts).
import { formStepOf } from "@shared/process/graph";
import type { ServerConfig } from "../../../context";
import { onRecordEvent } from "../../../engine";
import { registerJobHandler } from "../../../jobs";
import { STEP_OPENED } from "../engine";
import { loadVersionInfo } from "../engine/store";
import { applyPending } from "../sync/apply";
import { delegationChanged, DELEGATION_JOB, reresolveTasks } from "./delegation";
import { firstTimer, hasTimers, timerPass, TIMER_JOB, wakeTimer } from "./timer";

export { timerPass, roundTimers, roundTimersIn, wakeTimer, caseManagers, firstTimer, hasTimers, TIMER_JOB, RECHECK_MS, type Clock } from "./timer";
export { reresolveTasks, queueDelegation, delegationChanged, DELEGATION_JOB } from "./delegation";

let installed = false;

export function installProcessTimers(): void {
  if (installed) return;
  installed = true;
  registerJobHandler(TIMER_JOB, async (job, jctx) => {
    if (!job.org_id) return;
    const cfg = jctx.cfg as ServerConfig;
    const org = job.org_id;
    const next = await timerPass(cfg, org, (id) => applyPending(cfg, org, id, null));
    if (next !== null) return { again: Math.max(1000, next - Date.now()) };
  });
  registerJobHandler(DELEGATION_JOB, async (job, jctx) => {
    if (!job.org_id) return;
    const users = Array.isArray(job.payload?.users) ? job.payload.users.map(String) : [];
    await reresolveTasks(jctx.cfg as ServerConfig, job.org_id, users);
  });
  // a step that opens with a time wakes the timer by then
  onRecordEvent(
    "process.timer_wake",
    async (e, jctx) => {
      const node = String(e.data?.node ?? "");
      const kase = await jctx.db.one<{ version_id: string | null }>(`select version_id from sm_process_cases where org_id = $1 and id = $2`, [e.org_id, e.id]);
      const version = kase ? await loadVersionInfo(jctx.db, e.org_id, kase.version_id) : null;
      const n = version?.graph.nodes.find((x) => x.id === node && x.type === "form_step");
      if (!version || !n) return;
      const step = formStepOf(n.config);
      if (!hasTimers(version.graph, n.id, step)) return;
      const opened = Date.parse(e.at) || Date.now();
      const due = typeof e.data?.due_at === "string" ? Date.parse(e.data.due_at) : NaN;
      const at = firstTimer(step, opened, Number.isFinite(due) ? due : null);
      if (at !== null) await wakeTimer(jctx.db, e.org_id, at);
    },
    { tables: ["process_case"], kinds: [STEP_OPENED] },
  );
  onRecordEvent("process.delegation_watch", (e, jctx) => delegationChanged(jctx.cfg as ServerConfig, e), {
    tables: ["delegation", "member_profile"],
    kinds: ["record.created", "record.updated", "record.deleted"],
  });
}
