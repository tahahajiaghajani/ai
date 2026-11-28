// The end of a case's run (design F §3.6.3, F4a): `record.flow_ended` lands on the case. A run that reached a «پایان»
// (or ran out of paths) closes the case with that end's outcome — completed, rejected or canceled — and its last
// progress; a failed or canceled run is F4b's («نیاز به بررسی», the managers told, the open tasks closed as «لغو»).
// Only the case's current run counts (a run «ادامه از مرحلهٔ …» replaced is ignored), and a case already closed (the
// requester canceled it) stays as it is. A requester's cancel stops the run after its transaction: the job
// `process.cancel_run`.
import type { ServerConfig } from "../../../context";
import { onRecordEvent, systemCtx, updateIn } from "../../../engine";
import { registerJobHandler } from "../../../jobs";
import { cancelRun } from "../../flows";
import { END_OUTCOMES, type EndOutcome } from "@shared/process/graph";
import { CASE_OUTCOMES } from "@shared/tables/process";
import { caseJournal } from "./journal";
import { OPEN_STATES, refreshCase } from "./progress";
import { caseTasks, loadVersionInfo, lockCase } from "./store";

/** Close a case whose run completed. */
export async function caseRunEnded(cfg: ServerConfig, orgId: string, caseId: string, data: Record<string, unknown>): Promise<void> {
  if (data.kind !== "process" || data.state !== "completed") return;
  const sys = await systemCtx(cfg, orgId);
  await sys.write(async (tx) => {
    const kase = await lockCase(tx, orgId, caseId);
    if (!kase || kase.run_ref !== data.run_id || !OPEN_STATES.has(kase.state)) return;
    const end = data.end && typeof data.end === "object" ? (data.end as { outcome?: unknown }) : null;
    const outcome: EndOutcome = (END_OUTCOMES as readonly string[]).includes(String(end?.outcome)) ? (end!.outcome as EndOutcome) : "completed";
    const now = new Date().toISOString();
    const tasks = await caseTasks(tx, orgId, caseId);
    // a step still open when an end was reached (another branch ended the case): nobody needs to act any more
    for (const t of tasks.filter((x) => x.status === "open")) {
      await updateIn(tx, sys, "process_task", t.id, { status: "not_needed", closed_at: now }, { trusted: true });
      t.status = "not_needed";
    }
    const set = { state: outcome, outcome, ended_at: now };
    const version = await loadVersionInfo(tx, orgId, kase.version_id);
    if (version) await refreshCase(tx, sys, kase, version.graph, { tasks, set });
    else await updateIn(tx, sys, "process_case", caseId, { ...set, current_steps: [], open_rounds: {} }, { trusted: true });
    const label = CASE_OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome;
    await caseJournal(tx, sys, kase, `پرونده با نتیجهٔ «${label}» به پایان رسید`);
  });
}

let installed = false;

/** Subscribe to the runs' ends (once per process). */
export function installCaseEnd(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("process.case_ended", (e, jctx) => caseRunEnded(jctx.cfg as ServerConfig, e.org_id, e.id, e.data ?? {}), { tables: ["process_case"], kinds: ["record.flow_ended"] });
}

registerJobHandler(
  "process.cancel_run",
  async (job, jctx) => {
    const run = String(job.payload?.run ?? "");
    if (/^[0-9a-f-]{36}$/i.test(run)) await cancelRun(jctx.cfg as ServerConfig, run, "پرونده لغو شد");
  },
  {
    // its last attempt did not finish: the canceled case's run is canceled all the same (once more, a compare-and-set),
    // so it never goes on stepping a case that ended
    onExhausted: async (job, ectx) => {
      const run = String(job.payload?.run ?? "");
      if (/^[0-9a-f-]{36}$/i.test(run)) await cancelRun(ectx.cfg as ServerConfig, run, "پرونده لغو شد");
    },
  },
);
