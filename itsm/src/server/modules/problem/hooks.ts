// Behaviour of the problem tables on every write path, inside the write's transaction:
//
//   problem          proactive from the source; milestones (root cause found, workaround published, fix, the
//                    monitoring window) and their durations; «پذیرش ریسک» closes with its code; the RCA canvas checked
//                    and cleaned; the risk score; the last activity
//   guard            problem_can_close: open mandatory problem tasks, and (settings) at least one linked incident
//   problem_task     not on closed problems; activity on the problem
//   known_error      publication stamps and the next review; the problem's KE flag, technical debt and risk follow
//   problem_candidate the incident count follows its incidents
//   problem_template kept by its group or a manager; its tasks JSON checked. A problem created from one takes its
//                    analysis method and canvas sections, and (after the save) its tasks
//   incident         (this module's hook on incident) a changed problem or known error recounts them
import { stateCategory } from "@shared/model/task";
import { PROACTIVE_SOURCES, PROBLEM_TASK_TYPES } from "@shared/tables/problem";
import { templateTasks, templateTasksProblem } from "@shared/incident/logic";
import { ACTIVE_KE_STATES, cleanRca, rcaProblem, riskScore, techDebt } from "@shared/problem/logic";
import { addDays, todayISO } from "@shared/jalali";
import type { Ctx } from "../../context";
import { onBeforeCommit, type Queryable, type Tx } from "../../db";
import { addJournalIn, createIn, defFor, orgTz, registerHooks, updateIn, validationError, type WriteArgs } from "../../engine";
import { forbidden } from "../../http/errors";
import { countRows, eqAll, faList, liveRow, liveRows, lockedRow, problemConfig, secondsBetween, sysOf, type Row } from "../incident/common";
import { canWork } from "../incident/major";
import { assertCanKeep } from "../incident/hooks";

const entering = (w: WriteArgs, state: string) => w.next.state === state && (w.op === "create" || w.prev?.state !== state);
const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

// ---------------------------------------------------------------------------------------------------------------
// problem

async function problemBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const now = new Date().toISOString();
  // a problem model: the analysis it runs (what the caller did not choose)
  if (w.op === "create" && n.template_id) {
    const t = await liveRow(w.tx, sysOf(w.ctx), "problem_template", n.template_id);
    if (t) {
      if (!n.rca_method && t.rca_method) n.rca_method = t.rca_method;
      if ((!Array.isArray(n.rca_sections) || !n.rca_sections.length) && Array.isArray(t.rca_sections) && t.rca_sections.length) n.rca_sections = t.rca_sections;
    }
  }
  if (w.op === "create" || w.changed.has("source")) n.proactive = PROACTIVE_SOURCES.includes(String(n.source ?? ""));
  if (w.op === "create" || w.changed.has("rca")) {
    const p = rcaProblem(n.rca);
    if (p) throw validationError({ rca: p });
    if (n.rca !== null && n.rca !== undefined) n.rca = cleanRca(n.rca);
  }
  if (n.duplicate_of && n.duplicate_of === n.id) throw validationError({ duplicate_of: "مشکل تکراریِ خودش نیست" });

  // milestones
  if (entering(w, "fix_in_progress") && !n.rca_at) {
    n.rca_at = now;
    n.time_to_rca = secondsBetween(n.opened_at ?? now, now);
  }
  if (!isEmpty(n.workaround) && !n.workaround_at) n.workaround_at = now;
  if (entering(w, "resolved")) {
    n.fix_at = now;
    n.time_to_fix = secondsBetween(n.rca_at ?? n.opened_at ?? now, now);
    const cfg = await problemConfig(w.tx, w.ctx);
    n.monitoring_until = cfg.monitoring_days > 0 ? addDays(todayISO(orgTz(w.ctx)), cfg.monitoring_days) : null;
    n.monitoring_done = false;
  } else if (w.prev?.state === "resolved" && n.state === "rca") {
    n.monitoring_until = null;
    n.monitoring_done = false;
  }
  // «پذیرش ریسک»: closing an open analysis keeps its code
  if (entering(w, "closed") && w.prev && w.prev.state !== "resolved" && isEmpty(n.close_code)) n.close_code = "risk_accepted";

  if (w.op === "create" || ["impact", "likelihood", "priority", "incident_count", "known_error"].some((f) => w.changed.has(f))) {
    const score = riskScore({ impact: n.impact, likelihood: n.likelihood, priority: n.priority, incident_count: n.incident_count, active_known_errors: n.known_error ? 1 : 0 });
    if (n.risk_score !== score) n.risk_score = score;
  }
  if (w.ctx.actor !== "system" && !w.trusted) n.last_activity_at = now;
}

async function canClose(w: WriteArgs): Promise<string | null> {
  const sys = sysOf(w.ctx);
  const open = await liveRows(w.tx, sys, "problem_task", { and: [eqAll({ problem_id: String(w.next.id), active: true, mandatory: true })] }, { order: "t.no", limit: 20 });
  if (open.length) return `پیش از بستن، کارهای الزامیِ باز را ببندید: ${faList(open.slice(0, 5).map((t) => String(t.number)))}`;
  const cfg = await problemConfig(w.tx, w.ctx);
  if (cfg.close_requires_incident && !(await countRows(w.tx, sys, "incident", eqAll({ problem_id: String(w.next.id) })))) return "دست‌کم یک رخداد باید به این مشکل پیوند داشته باشد";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Counters of a problem and of a known error

/** Recount a problem's incidents and active known errors; its KE flag, technical debt and risk follow. */
export async function recountProblem(tx: Tx, ctx: Ctx, problemId: string | null | undefined): Promise<void> {
  if (!problemId) return;
  const sys = sysOf(ctx);
  const p = await liveRow(tx, sys, "problem", problemId);
  if (!p) return;
  const incidents = await countRows(tx, sys, "incident", eqAll({ problem_id: problemId }));
  const kes = await countRows(tx, sys, "known_error", { and: [eqAll({ problem_id: problemId }), { f: "state", op: "in", v: ACTIVE_KE_STATES }] });
  const values: Row = { incident_count: incidents, known_error: kes > 0, tech_debt: techDebt(kes, incidents) };
  const changed = Object.entries(values).some(([k, v]) => (p[k] ?? null) !== v);
  if (changed) await updateIn(tx, sys, "problem", problemId, values, { trusted: true, keepVersion: true, allowLocked: true });
}

/** Recount the incidents that use a known error. */
export async function recountKnownError(tx: Tx, ctx: Ctx, keId: string | null | undefined): Promise<void> {
  if (!keId) return;
  const sys = sysOf(ctx);
  const ke = await liveRow(tx, sys, "known_error", keId);
  if (!ke) return;
  const n = await countRows(tx, sys, "incident", eqAll({ known_error_id: keId }));
  if (Number(ke.incident_count ?? 0) !== n) await updateIn(tx, sys, "known_error", keId, { incident_count: n }, { trusted: true, keepVersion: true, allowLocked: true });
}

/**
 * The recounts of the writes of a transaction run just before commit, once per problem or known error, under its key:
 * two incidents linked to one problem at the same moment take turns there, and the later count sees both (each
 * counting in its own write saw only its own link, and the later write kept one too few). The recount takes the key,
 * then the row; a write that locks the row in its body first takes the key too (services.ts `lockProblem`,
 * incident/actions.ts `applyKnownError`), so the two orders never meet.
 */
export const problemRecountKey = (id: unknown) => `problem.recount:${id}`;
function recountProblemAtCommit(w: WriteArgs, id: unknown): void {
  if (!id) return;
  const { tx, ctx } = w;
  onBeforeCommit(tx, problemRecountKey(id), () => recountProblem(tx, ctx, String(id)));
}
function recountKnownErrorAtCommit(w: WriteArgs, id: unknown): void {
  if (!id) return;
  const { tx, ctx } = w;
  // the same key incident/actions.ts `applyKnownError` takes before it writes the known error's row
  onBeforeCommit(tx, `known_error.recount:${id}`, () => recountKnownError(tx, ctx, String(id)));
}

async function incidentAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") {
    recountProblemAtCommit(w, w.prev?.problem_id);
    recountKnownErrorAtCommit(w, w.prev?.known_error_id);
    return;
  }
  if (w.changed.has("problem_id")) {
    recountProblemAtCommit(w, w.row.problem_id);
    if (w.prev?.problem_id && w.prev.problem_id !== w.row.problem_id) recountProblemAtCommit(w, w.prev.problem_id);
  }
  if (w.changed.has("known_error_id")) {
    recountKnownErrorAtCommit(w, w.row.known_error_id);
    if (w.prev?.known_error_id && w.prev.known_error_id !== w.row.known_error_id) recountKnownErrorAtCommit(w, w.prev.known_error_id);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// problem_task, known_error, problem_candidate

async function closedProblem(q: Queryable, ctx: Ctx, id: unknown): Promise<Row | null> {
  // locked until commit (a task's write then stamps the problem): a closing in flight finishes first and is seen
  const p = await lockedRow(q, sysOf(ctx), "problem", id);
  if (!p) return null;
  const cat = stateCategory((await defFor(sysOf(ctx), "problem", q)).def.states, p.state);
  return cat === "closed" || cat === "canceled" ? p : null;
}

async function taskBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || (w.op !== "create" && !w.changed.has("problem_id"))) return;
  // tasks belong to the people working the problem (the system's own writes aside)
  if (w.ctx.actor !== "system" && !w.trusted) {
    const p = await liveRow(w.tx, w.ctx, "problem", w.next.problem_id);
    if (!p) throw validationError({ problem_id: "مشکل پیدا نشد" });
    if (!canWork(w.ctx, (await defFor(w.ctx, "problem", w.tx)).def, p)) throw forbidden(`کار مشکل را کسی می‌سازد که روی ${p.number ? `مشکل ${p.number}` : "این مشکل"} کار می‌کند`);
  }
  if (await closedProblem(w.tx, w.ctx, w.next.problem_id)) throw validationError({ problem_id: "این مشکل بسته شده است و کار تازه نمی‌پذیرد" });
  if (w.op === "create" && !w.next.assignment_group_id) {
    const p = await liveRow(w.tx, sysOf(w.ctx), "problem", w.next.problem_id);
    if (p?.assignment_group_id) w.next.assignment_group_id = p.assignment_group_id;
  }
}

async function taskAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || w.ctx.actor === "system" || !w.row.problem_id) return;
  const p = await liveRow(w.tx, sysOf(w.ctx), "problem", w.row.problem_id);
  if (p && p.active) await updateIn(w.tx, sysOf(w.ctx), "problem", p.id, { last_activity_at: new Date().toISOString() }, { trusted: true, keepVersion: true });
}

async function keBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (entering(w, "published") && !n.published_at) {
    n.published_at = new Date().toISOString();
    n.published_by = w.ctx.actor === "system" ? null : w.ctx.user.id;
  }
  if (entering(w, "published") && !n.review_at) {
    const cfg = await problemConfig(w.tx, w.ctx);
    if (cfg.ke_review_days > 0) n.review_at = addDays(todayISO(orgTz(w.ctx)), cfg.ke_review_days);
  }
  if (w.op === "create" && n.problem_id) {
    const p = await liveRow(w.tx, sysOf(w.ctx), "problem", n.problem_id);
    if (p) {
      if (!n.assignment_group_id && p.assignment_group_id) n.assignment_group_id = p.assignment_group_id;
      if (!n.workspace_id && p.workspace_id) n.workspace_id = p.workspace_id;
    }
  }
}

async function keAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op !== "delete" && !w.changed.has("state") && !w.changed.has("problem_id")) return;
  recountProblemAtCommit(w, w.row.problem_id ?? w.prev?.problem_id);
  if (w.prev?.problem_id && w.prev.problem_id !== w.row.problem_id) recountProblemAtCommit(w, w.prev.problem_id);
}

function candidateBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  if (w.op === "create" || w.changed.has("incidents")) {
    const n = Array.isArray(w.next.incidents) ? w.next.incidents.length : 0;
    if (w.next.incident_count !== n) w.next.incident_count = n;
  }
}

function configBefore(w: WriteArgs): void {
  if (w.op === "delete") throw validationError({ name: "تنظیمات مشکل حذف نمی‌شود؛ مقدارها را تغییر دهید" });
}

const TASK_TYPES = new Set(PROBLEM_TASK_TYPES.map((o) => o.value));

function templateBefore(w: WriteArgs): void {
  assertCanKeep(w);
  if (w.op === "delete" || (w.op !== "create" && !w.changed.has("tasks"))) return;
  const p = templateTasksProblem(w.next.tasks);
  if (p) throw validationError({ tasks: p });
  const bad = templateTasks(w.next.tasks).findIndex((t) => t.task_type && !TASK_TYPES.has(t.task_type));
  if (bad >= 0) throw validationError({ tasks: `نوع کار ${bad + 1} یکی از «عمومی»، «تحلیل علت» یا «رفع» نیست` });
}

/** A problem created from a template gets the template's tasks (as the system, for the person who created it). */
async function problemAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op !== "create" || !w.row.template_id) return;
  const t = await liveRow(w.tx, sysOf(w.ctx), "problem_template", w.row.template_id);
  if (!t) return;
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  const tasks = templateTasks(t.tasks);
  for (const [i, task] of tasks.entries()) {
    await createIn(w.tx, sys, "problem_task", {
      problem_id: w.row.id,
      short_description: task.short_description,
      description: task.description ?? null,
      task_type: task.task_type ?? "general",
      assignment_group_id: task.assignment_group_id ?? w.row.assignment_group_id ?? null,
      mandatory: task.mandatory !== false,
      caller_id: w.ctx.actor === "system" ? null : w.ctx.user.id,
    }, { trusted: true });
  }
  const { def } = await defFor(sysOf(w.ctx), "problem", w.tx);
  await addJournalIn(w.tx, sysOf(w.ctx), def, w.row, { kind: "system", visibility: "internal", body: `الگوی «${t.name}» به کار رفت${tasks.length ? ` و ${tasks.length} کار ساخته شد` : ""}.` }, { trusted: true, author: w.ctx.actor === "system" ? null : w.ctx.user.id });
}

/** The hooks of the problem tables (installed once by `installProblemModule`). */
export function installProblemHooks(): (() => void)[] {
  return [
    registerHooks("problem", { beforeWrite: problemBefore, afterWrite: problemAfter, guards: { problem_can_close: canClose } }),
    registerHooks("problem_task", { beforeWrite: taskBefore, afterWrite: taskAfter }),
    registerHooks("known_error", { beforeWrite: keBefore, afterWrite: keAfter }),
    registerHooks("problem_candidate", { beforeWrite: candidateBefore }),
    registerHooks("problem_config", { beforeWrite: configBefore }),
    registerHooks("problem_template", { beforeWrite: templateBefore }),
    registerHooks("incident", { afterWrite: incidentAfter }),
  ];
}
