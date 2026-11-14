// When a case's run fails (design F §3.6.6, package F4b): the step guard, a subflow or HTTP error, or an unwired error
// port ends the run `failed`, and `record.flow_ended` lands on the case (a run canceled while its case is still open
// counts the same). The subscriber then, under the case's lock and only for the case's current run:
//   · closes the run's open tasks as «لغو»;
//   · sets the case «نیاز به بررسی» (attention);
//   · writes a journal note with the error;
//   · tells the process managers «پروندهٔ PRC… متوقف شد».
// The managers then choose (F4c's routes call these services):
//   · «ادامه از مرحلهٔ …» (`resumeFromStep`): a new run on the same version and data, starting at a form step outside
//     parallel blocks (the executor's `startAt`; `restartTargets` lists them) — the case's run becomes that one;
//   · «لغو پرونده» (`cancelAsManager`): the case closes «لغوشده», its open tasks «لغو», and its run stops.
// Both are journaled and recorded in «گزارش رویدادها»; both need the case's managers (named, or through a group).
import { processNodeLabel, restartTargets } from "@shared/process/graph";
import type { Ctx, ServerConfig } from "../../../context";
import type { Tx } from "../../../db";
import { bad, conflict, forbidden, notFound } from "../../../http/errors";
import { isSystemCtx, onRecordEvent, systemCtx, updateIn } from "../../../engine";
import { enqueue } from "../../../jobs";
import { startRun } from "../../flows";
import { audit } from "../../data/crud";
import { notifyPeople } from "../../notify/deliver";
import { OPEN_STATES, participantsOf, processesRunHere, refreshCase } from "../engine";
import { caseJournal } from "../engine/journal";
import { caseTasks, isId, loadVersionInfo, lockCase, type CaseRow } from "../engine/store";
import { myGroupsSql } from "../access/sources";
import { caseManagers } from "../timers/timer";

const iso = (ms: number) => new Date(ms).toISOString();

/** The run of a case failed (or was canceled while the case was open): «نیاز به بررسی». */
export async function caseRunFailed(cfg: ServerConfig, orgId: string, caseId: string, data: Record<string, unknown>): Promise<void> {
  if (data.kind !== "process" || (data.state !== "failed" && data.state !== "canceled")) return;
  const sys = await systemCtx(cfg, orgId);
  await sys.write(async (tx) => {
    const kase = await lockCase(tx, orgId, caseId);
    if (!kase || kase.run_ref !== data.run_id || (kase.state !== "active" && kase.state !== "waiting")) return;
    const tasks = await caseTasks(tx, orgId, caseId);
    const now = iso(Date.now());
    for (const t of tasks.filter((x) => x.status === "open")) {
      await updateIn(tx, sys, "process_task", t.id, { status: "canceled", closed_at: now }, { trusted: true });
      t.status = "canceled";
    }
    const version = await loadVersionInfo(tx, orgId, kase.version_id);
    if (version) await refreshCase(tx, sys, kase, version.graph, { tasks, set: { state: "attention" } });
    else await updateIn(tx, sys, "process_case", caseId, { state: "attention", participants: participantsOf(tasks), current_steps: [], open_rounds: {} }, { trusted: true });
    const error = String(data.error ?? "").trim().slice(0, 1000) || "خطای ناشناخته";
    await caseJournal(tx, sys, kase, `اجرای پرونده متوقف شد و پرونده نیاز به بررسی دارد: ${error}`, { data: { run: data.run_id, error } });
    const managers = await caseManagers(tx, kase);
    if (managers.length) {
      await notifyPeople(tx, orgId, {
        table: "process_case", id: kase.id, users: managers, event: "custom", label: "پرونده متوقف شد", channels: ["in_app", "email"], actor: null, source: "گردش‌کارها",
        subject: ["پروندهٔ", kase.number, "متوقف شد"].filter(Boolean).join(" "),
        body: `پروندهٔ «${kase.title ?? ""}» در «${kase.process_name ?? ""}» متوقف شد: ${error}. آن را از مرحله‌ای ادامه دهید یا لغو کنید.`,
      });
    }
  });
}

/** Is the caller one of the case's process managers (named, or a valid member of a manager group)? */
async function managesCase(tx: Tx, ctx: Ctx, kase: CaseRow): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  const me = ctx.user.id;
  if ((kase.managers ?? []).includes(me)) return true;
  if (!(kase.manager_groups ?? []).length) return false;
  const r = await tx.one<{ ok: boolean }>(`select coalesce($1::jsonb ?| ${myGroupsSql("$2::uuid")}, false) as ok`, [JSON.stringify(kase.manager_groups), me]);
  return r?.ok === true;
}

const NOT_MANAGER = "این کار با مسئولان این گردش‌کار است";

/** Lock a case for a manager's action (404 for a case the caller does not manage, as for one they cannot see). */
async function managedCase(tx: Tx, ctx: Ctx, caseId: string): Promise<CaseRow> {
  const kase = isId(caseId) ? await lockCase(tx, ctx.org.id, caseId) : null;
  if (!kase) throw notFound("پرونده پیدا نشد");
  if (!(await managesCase(tx, ctx, kase))) throw forbidden(NOT_MANAGER);
  return kase;
}

/** «ادامه از مرحلهٔ …»: a new run of a case that needs attention, from form step `node`. Returns the new run's id. */
export async function resumeFromStep(ctx: Ctx, caseId: string, node: string, input: { comment?: string | null } = {}): Promise<{ run: string }> {
  if (!(await processesRunHere(ctx.cfg, ctx.org.id))) throw conflict("این کار به اتصال نیاز دارد");
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  return sys.write(async (tx) => {
    const kase = await managedCase(tx, ctx, caseId);
    if (kase.state !== "attention") throw conflict("فقط پرونده‌ای که متوقف شده است از مرحله‌ای دوباره ادامه می‌یابد");
    const version = await loadVersionInfo(tx, ctx.org.id, kase.version_id);
    if (!version) throw conflict("نسخهٔ گردش‌کار این پرونده پیدا نشد");
    const target = version.graph.nodes.find((n) => n.id === node);
    if (!target || !restartTargets(version.graph).includes(node)) throw bad("پرونده از این مرحله ادامه نمی‌یابد؛ مرحلهٔ فرمی بیرون از شاخه‌های موازی را برگزینید");
    const label = processNodeLabel(target);
    const runId = await startRun(tx, {
      orgId: ctx.org.id,
      flow: { id: String(kase.process_id ?? version.process_id), name: kase.process_name || version.name },
      version: { id: version.id, no: version.version_no },
      trigger: { kind: "process", table: "process_case", id: kase.id, event: "resume", actor: ctx.user.id, inputs: { from: node } },
      actorId: isSystemCtx(ctx) ? null : ctx.user.id,
      runAs: { kind: "system", userId: null },
      depth: 0,
      startAt: node,
    });
    await refreshCase(tx, sys, kase, version.graph, { set: { run_ref: runId, state: "active", outcome: null, ended_at: null } });
    const comment = String(input.comment ?? "").trim().slice(0, 1000);
    const who = isSystemCtx(ctx) ? "سامانه" : ctx.user.full_name || ctx.user.email;
    await caseJournal(tx, sys, kase, `${who} پرونده را از مرحلهٔ «${label}» ادامه داد${comment ? `: ${comment}` : ""}`, { author: isSystemCtx(ctx) ? null : ctx.user.id, data: { from: node, run: runId } });
    if (!isSystemCtx(ctx)) await audit(tx, ctx, "process.resume_from", "process_case", kase.id, `${kase.number ?? ""}: ادامه از «${label}»`, { node, run: runId });
    return { run: runId };
  });
}

/** «لغو پرونده» by a process manager: any open case, whatever was done in it. */
export async function cancelAsManager(ctx: Ctx, caseId: string, input: { comment?: string | null } = {}): Promise<void> {
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  if (!(await processesRunHere(ctx.cfg, ctx.org.id))) throw conflict("این کار به اتصال نیاز دارد");
  await sys.write(async (tx) => {
    const kase = await managedCase(tx, ctx, caseId);
    if (!OPEN_STATES.has(kase.state)) throw conflict("این پرونده پیش‌تر بسته شده است");
    const comment = String(input.comment ?? "").trim().slice(0, 1000);
    if (!comment) throw bad("برای لغو پرونده، توضیح بنویسید");
    const tasks = await caseTasks(tx, ctx.org.id, kase.id);
    const now = iso(Date.now());
    for (const t of tasks.filter((x) => x.status === "open")) {
      await updateIn(tx, sys, "process_task", t.id, { status: "canceled", closed_at: now }, { trusted: true });
      t.status = "canceled";
    }
    const set = { state: "canceled", outcome: "canceled", ended_at: now };
    const version = await loadVersionInfo(tx, ctx.org.id, kase.version_id);
    if (version) await refreshCase(tx, sys, kase, version.graph, { tasks, set });
    else await updateIn(tx, sys, "process_case", kase.id, { ...set, participants: participantsOf(tasks), current_steps: [], open_rounds: {} }, { trusted: true });
    const who = isSystemCtx(ctx) ? "سامانه" : ctx.user.full_name || ctx.user.email;
    await caseJournal(tx, sys, kase, `${who} (مسئول گردش‌کار) پرونده را لغو کرد: ${comment}`, { author: isSystemCtx(ctx) ? null : ctx.user.id, data: { manager: true } });
    if (!isSystemCtx(ctx)) await audit(tx, ctx, "process.cancel", "process_case", kase.id, `${kase.number ?? ""}: لغو به دست مسئول گردش‌کار`, { comment });
    // the run stops after this commits (a failed run has ended already)
    if (kase.run_ref) await enqueue(tx, { kind: "process.cancel_run", orgId: ctx.org.id, payload: { run: kase.run_ref }, dedupeKey: `process.cancel_run:${kase.run_ref}`, maxAttempts: 10 });
  });
}

let installed = false;

/** Subscribe to the runs' failures (once per process). */
export function installProcessRecovery(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("process.case_failed", (e, jctx) => caseRunFailed(jctx.cfg as ServerConfig, e.org_id, e.id, e.data ?? {}), { tables: ["process_case"], kinds: ["record.flow_ended"] });
}
