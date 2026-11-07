// Reactions and background work of problem management (acting once: on the web version, or on a Windows app that is
// not linked to one):
//
//   subscriber «problem»        a major incident resolved without a problem → a problem for it (settings of incident
//                               management: mi_auto_problem); a problem resolved → the incidents waiting on it are
//                               resolved (settings: resolve_waiting_incidents); keeps the daily sweep queued
//   job problem.resolve_incidents   those incidents, 50 at a time
//   job problem.sweep            once a day per organisation: the candidate rules, reminders about inactive problems,
//                               the end of the monitoring window after a fix (recurrence check), known errors due for
//                               review
import { addDays, todayISO } from "@shared/jalali";
import type { Cond } from "@shared/model/conditions";
import { addJournalIn, defFor, onRecordEvent, orgTz, systemCtx, transitionIn, updateIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import type { Ctx } from "../../context";
import { actsHere, notifyPeople } from "../notify";
import { countRows, eqAll, incidentConfig, isUuid, liveRow, liveRows, problemConfig, type Row } from "../incident";
import { createFromIncidents, runCandidates } from "./services";

export const PROBLEM_SWEEP_EVERY = 24 * 3600_000;
const lastSweep = new Map<string, number>();

export async function ensureProblemSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 3600_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "problem.sweep", orgId, delayMs: 5 * 60_000, dedupeKey: "problem.sweep", maxAttempts: 5 });
}

export const resetProblemSweepThrottle = () => lastSweep.clear();

async function react(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
  await ensureProblemSweep(jctx.db, e.org_id);
  if (e.table === "incident" && e.kind === "record.updated" && e.changes?.major_state?.to === "resolved") {
    const sys = await systemCtx(jctx.cfg, e.org_id);
    const cfg = await incidentConfig(jctx.db, sys);
    const inc = await liveRow(jctx.db, sys, "incident", e.id);
    if (!cfg.mi_auto_problem || !inc || inc.problem_id) return;
    const author = inc.mi_manager_id ?? inc.assigned_to ?? e.actor ?? null;
    await createFromIncidents(author ? await systemCtx(jctx.cfg, e.org_id, { onBehalfOf: author }) : sys, [e.id], { source: "major_incident" });
  }
  if (e.table === "problem" && e.kind === "record.state_changed" && e.to === "resolved") {
    const sys = await systemCtx(jctx.cfg, e.org_id);
    const cfg = await problemConfig(jctx.db, sys);
    if (cfg.resolve_waiting_incidents && (await countRows(jctx.db, sys, "incident", eqAll({ problem_id: e.id, state: "on_hold", hold_reason: "awaiting_problem" })))) {
      await enqueue(jctx.db, { kind: "problem.resolve_incidents", orgId: e.org_id, payload: { id: e.id, actor: e.actor }, dedupeKey: `problem.resolve_incidents:${e.id}` });
    }
  }
}

async function resolveWaiting(orgId: string, payload: Row, jctx: JobContext): Promise<{ again: number } | void> {
  const sys = await systemCtx(jctx.cfg, orgId, { onBehalfOf: isUuid(payload.actor) ? payload.actor : null });
  const p = await liveRow(jctx.db, sys, "problem", payload.id);
  if (!p || p.state !== "resolved") return;
  const tried = new Set<string>(Array.isArray(payload.tried) ? payload.tried : []);
  const rows = (await liveRows(jctx.db, sys, "incident", eqAll({ problem_id: p.id, state: "on_hold", hold_reason: "awaiting_problem" }), { order: "t.no", limit: 50 + tried.size })).filter((r) => !tried.has(r.id)).slice(0, 50);
  for (const r of rows) {
    tried.add(r.id);
    await sys.write((tx) =>
      transitionIn(tx, sys, "incident", r.id, "resolved", { close_code: "resolved_by_problem", close_notes: `با رفع مشکل ${p.number} حل شد.${p.fix_notes ? `\n\n${p.fix_notes}` : ""}` }),
    ).catch((err) => sys.cfg.log?.warn?.("problem resolve incidents", { id: r.id, error: (err as Error).message }));
  }
  if (rows.length === 50) {
    await jctx.save({ ...payload, tried: [...tried] });
    return { again: 0 };
  }
}

export interface ProblemSweepResult {
  candidates: { created: number; updated: number; skipped: number };
  reminded: number;
  monitored: number;
  reviews: number;
}

/** One daily pass over an organisation's problems (as the system; also called by tests and «اجرای قاعده‌ها»). */
export async function problemSweep(sys: Ctx, now = Date.now()): Promise<ProblemSweepResult> {
  const cfg = await problemConfig(sys.db, sys);
  const out: ProblemSweepResult = { candidates: await runCandidates(sys, now), reminded: 0, monitored: 0, reviews: 0 };
  const iso = new Date(now).toISOString();
  const today = todayISO(orgTz(sys));

  // inactive problems: the coordinator and the manager are reminded once per period
  if (cfg.inactivity_days > 0) {
    const before = new Date(now - cfg.inactivity_days * 86_400_000).toISOString();
    // activity = what people did (a write of theirs or of the problem's tasks), never the system's own bookkeeping
    const quiet: Cond = { or: [{ and: [{ f: "last_activity_at", op: "nempty" }, { f: "last_activity_at", op: "lt", v: before }] }, { and: [{ f: "last_activity_at", op: "empty" }, { f: "opened_at", op: "lt", v: before }] }] };
    const idle = await liveRows(sys.db, sys, "problem", { and: [{ f: "active", op: "eq", v: true }, quiet, { or: [{ f: "reminded_at", op: "empty" }, { f: "reminded_at", op: "lt", v: before }] }] }, { limit: 200 });
    for (const p of idle) {
      const users = [...new Set([p.assigned_to, p.manager_id].filter(isUuid))];
      await sys.write(async (tx) => {
        if (users.length) {
          await notifyPeople(tx, sys.org.id, { table: "problem", id: p.id, users, event: "custom", label: "مشکل بی‌فعالیت", subject: "مشکل {{record.number}} مدتی است پیشرفتی نداشته است", body: `در ${cfg.inactivity_days} روز گذشته روی این مشکل کاری ثبت نشده است.`, channels: ["in_app", "email"], source: "مشکلات" });
        }
        await updateIn(tx, sys, "problem", p.id, { reminded_at: iso }, { trusted: true, keepVersion: true });
      }).then(() => out.reminded++, (e) => sys.cfg.log?.warn?.("problem inactivity", { id: p.id, error: (e as Error).message }));
    }
  }

  // the monitoring window after a fix ends: did incidents come back?
  const watched = await liveRows(sys.db, sys, "problem", { and: [{ f: "state", op: "eq", v: "resolved" }, { f: "monitoring_until", op: "lt", v: today }, { f: "monitoring_done", op: "eq", v: false }] }, { limit: 200 });
  for (const p of watched) {
    const recurred = p.fix_at ? await countRows(sys.db, sys, "incident", { and: [eqAll({ problem_id: p.id }), { f: "opened_at", op: "gt", v: p.fix_at }] }) : 0;
    await sys.write(async (tx) => {
      const { def } = await defFor(sys, "problem", tx);
      const body = recurred ? `پایش پس از رفع پایان یافت: ${recurred} رخداد تازه پس از رفع پیوند خورده است؛ رفع را بازبینی کنید.` : "پایش پس از رفع بدون رخداد تازه پایان یافت؛ مشکل را می‌توان بست.";
      await addJournalIn(tx, sys, def, p, { kind: "system", visibility: "internal", body, data: { monitoring: recurred } }, { trusted: true, author: null });
      const users = [...new Set([p.assigned_to, p.manager_id].filter(isUuid))];
      if (users.length) await notifyPeople(tx, sys.org.id, { table: "problem", id: p.id, users, event: "custom", label: "پایان پایش پس از رفع", subject: "پایان پایش مشکل {{record.number}}", body, channels: ["in_app"], source: "مشکلات" });
      await updateIn(tx, sys, "problem", p.id, { monitoring_done: true }, { trusted: true, keepVersion: true });
    }).then(() => out.monitored++, () => undefined);
  }

  // known errors due for review: the owner is told and the next review is set
  if (cfg.ke_review_days > 0) {
    const due = await liveRows(sys.db, sys, "known_error", { and: [{ f: "state", op: "in", v: ["published", "fix_scheduled", "vendor", "no_action"] }, { f: "review_at", op: "lte", v: today }] }, { limit: 200 });
    for (const k of due) {
      await sys.write(async (tx) => {
        if (isUuid(k.owner_id)) await notifyPeople(tx, sys.org.id, { table: "known_error", id: k.id, users: [k.owner_id], event: "custom", label: "بازبینی خطای شناخته‌شده", subject: "زمان بازبینی خطای شناخته‌شدهٔ {{record.number}}", body: "راه‌حل موقت هنوز درست است؟ اثربخشی آن را ثبت کنید یا خطا را بازنشسته کنید.", channels: ["in_app"], source: "مشکلات" });
        await updateIn(tx, sys, "known_error", k.id, { review_at: addDays(today, cfg.ke_review_days) }, { trusted: true, keepVersion: true });
      }).then(() => out.reviews++, () => undefined);
    }
  }
  return out;
}

export function installProblemJobs(): (() => void)[] {
  return [
    onRecordEvent("problem", react, { tables: ["incident", "problem"], kinds: ["record.updated", "record.state_changed", "record.created"] }),
    registerJobHandler("problem.resolve_incidents", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      return resolveWaiting(job.org_id, job.payload, jctx);
    }),
    registerJobHandler("problem.sweep", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await problemSweep(sys);
      const open = await countRows(jctx.db, sys, "problem", { f: "active", op: "eq", v: true });
      const incidents = await countRows(jctx.db, sys, "incident", { f: "opened_at", op: "relative", v: { unit: "day", n: 30, dir: "past" } });
      return open || incidents ? { again: PROBLEM_SWEEP_EVERY } : undefined;
    }),
  ];
}
