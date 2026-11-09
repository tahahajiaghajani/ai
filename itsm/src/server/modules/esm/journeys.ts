// Employee journeys (ESM-012…015): a journey is started from a versioned template (generic API or «آغاز سفر»); its
// activities are copied from the template version and planned on the working calendar from the anchor date (start
// and due dates in working days, prerequisites, conditions on the journey). The engine advances a journey one step
// per call, idempotently: activities whose start has come (a few working days ahead) and whose prerequisites are done
// create their work in the department that does it — an HR task for the employee, the manager or HR (sign, form,
// upload, acknowledge, learning), an order from the IT catalogue placed for the new hire (laptop, account), a case
// in another department (a desk from facilities), an approval of the manager, a notification. Each activity follows
// its work record (done when the record is done, failed when it is cancelled) and every department works its record
// under its own access; the journey keeps only the link. Moving the anchor re-plans open activities (and the due
// dates of their HR tasks). Progress, overdue work and day-one readiness roll up into the journey, which completes
// when every activity is finished.
import { evaluate, type Cond } from "@shared/model/conditions";
import { stateCategory } from "@shared/model/task";
import { tableDef } from "@shared/tables";
import { JOURNEY_TYPES } from "@shared/tables/esm";
import { activityFromRecord, journeyProgress, planJourney, readyToStart, templateProblems, ACTIVITY_FINISHED, type LiveActivity, type PlanActivity } from "@shared/esm/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { access } from "../../access/provider";
import { condEnv, createIn, get, isSystemCtx, list, onBeforeCommit, orgSchema, savepoint, transitionIn, updateIn, validationError, type WriteArgs } from "../../engine";
import { bad, forbidden, notFound } from "../../http/errors";
import { notifyPeople } from "../notify";
import { requestApprovalIn } from "../sla/approvals";
import { placeOrder } from "../request/ordering";
import { calendarFor, defaultDepartment, departmentById, esmConfig, eqAll, ids, isUuid, liveRow, liveRows, sysOf, todayOf, type Row } from "./common";

const OPEN_JOURNEY = ["planned", "active", "waiting"];

/** The template's active activities in their order. */
export async function templateActivities(q: Tx | Ctx["db"], ctx: Ctx, templateId: string): Promise<Row[]> {
  return liveRows(q, sysOf(ctx), "journey_template_activity", { and: [{ f: "template_id", op: "eq", v: templateId }, { f: "active", op: "eq", v: true }] }, { order: "t.sort_order, t.code", limit: 500 });
}

export async function activitiesOf(q: Tx | Ctx["db"], ctx: Ctx, journeyId: string): Promise<Row[]> {
  return liveRows(q, sysOf(ctx), "journey_activity", eqAll({ journey_id: journeyId }), { order: "t.sort_order, t.code", limit: 1000 });
}

const planOf = (a: Row): PlanActivity => ({
  code: String(a.code),
  start_offset: a.start_offset === null || a.start_offset === undefined || a.start_offset === "" ? null : Number(a.start_offset),
  duration_days: Number(a.duration_days ?? 1),
  after: Array.isArray(a.after) ? (a.after as string[]) : [],
});

const liveOf = (a: Row): LiveActivity => ({ code: String(a.code), state: String(a.state), after: planOf(a).after, start_date: (a.start_date as string) ?? null, due_date: (a.due_date as string) ?? null, day_one: !!a.day_one });

/** Who does an activity: the employee, their manager or the journey's HR owner (each falling back to the next). */
function assigneeOf(kind: unknown, j: Row): string | null {
  const subject = isUuid(j.subject_person_id) ? j.subject_person_id : null;
  const manager = isUuid(j.manager_id) ? j.manager_id : null;
  const hr = isUuid(j.hr_owner_id) ? j.hr_owner_id : null;
  if (kind === "subject") return subject ?? manager ?? hr;
  if (kind === "manager") return manager ?? hr;
  if (kind === "group") return null;
  return hr;
}

const readersOf = (j: Row): string[] => ids([j.subject_person_id, j.manager_id]);

/** The planned dates of a template's activities for an anchor date (the template page's preview). */
export async function previewTemplate(ctx: Ctx, templateId: string, anchor: string): Promise<{ problems: { code: string; message: string }[]; activities: Row[] }> {
  const sys = sysOf(ctx);
  const tpl = await liveRow(ctx.db, sys, "journey_template", templateId);
  if (!tpl) throw notFound("الگوی سفر پیدا نشد");
  const acts = await templateActivities(ctx.db, ctx, templateId);
  const problems = templateProblems(acts.map((a) => ({ ...planOf(a), name: a.name, kind: a.kind, catalog_item_code: a.catalog_item_code, case_table: a.case_table, assignee: a.assignee, group_id: a.group_id })));
  const cal = await calendarFor(ctx.db, ctx, tpl.calendar_id);
  const plan = problems.some((p) => /دور می‌زنند|در این الگو نیست/.test(p.message)) ? new Map() : planJourney(acts.map(planOf), { anchor, start: todayOf(ctx), cal });
  return { problems, activities: acts.map((a) => ({ code: a.code, name: a.name, phase: a.phase, kind: a.kind, assignee: a.assignee, day_one: !!a.day_one, after: a.after ?? [], ...(plan.get(String(a.code)) ?? { start_date: null, due_date: null }) })) };
}

// ----- the journey's own hooks ------------------------------------------------------------------------------------------

async function journeyBefore(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, prev, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  if (op === "create" || w.changed.has("template_id")) {
    const tpl = await liveRow(tx, sys, "journey_template", next.template_id);
    if (!tpl) throw validationError({ template_id: "الگوی سفر پیدا نشد" });
    if (tpl.active === false && !w.trusted) throw validationError({ template_id: `الگوی «${tpl.name}» فعال نیست` });
    if (op !== "create") throw validationError({ template_id: "الگوی سفر آغازشده تغییر نمی‌کند؛ سفر تازه‌ای آغاز کنید" });
    next.type = tpl.type;
    next.template_version = Number(tpl.template_version ?? 1);
    if (!next.calendar_id) next.calendar_id = tpl.calendar_id ?? null;
    const dept = (await departmentById(tx, ctx, tpl.department_id)) ?? (await defaultDepartment(tx, ctx, "hr_case"));
    next.workspace_id = dept?.dept_workspace_id ?? null;
    if (!next.assignment_group_id) next.assignment_group_id = tpl.owner_group_id ?? dept?.default_group_id ?? null;
    if (!String(next.name ?? "").trim()) {
      const who = isUuid(next.subject_person_id) ? (await tx.one<{ name: string }>(`select coalesce(nullif(full_name, ''), email) as name from sm_users where id = $1`, [String(next.subject_person_id)]))?.name : next.subject_name;
      const label = JOURNEY_TYPES.find((t) => t.value === tpl.type)?.label ?? tpl.name;
      next.name = `${label}: ${who ?? "کارمند تازه"}`.slice(0, 200);
    }
  } else if (prev) next.workspace_id = prev.workspace_id;
  if (op === "create" && !isUuid(next.subject_person_id) && !String(next.subject_name ?? "").trim()) throw validationError({ subject_person_id: "کارمند یا نام او را مشخص کنید" });
  const to = String(next.state ?? "");
  if (prev && w.changed.has("state")) {
    if (to === "active" && !prev.started_at) next.started_at = new Date().toISOString();
    if (to === "completed" || to === "cancelled") {
      next.completed_at = new Date().toISOString();
      const started = Date.parse(String(next.started_at ?? prev.started_at ?? ""));
      if (to === "completed" && Number.isFinite(started)) next.cycle_time = Math.max(0, Math.round((Date.now() - started) / 1000));
    }
  }
}

async function journeyAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { ctx, tx, row, op, prev } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  const id = String(row.id);
  if (op === "create") {
    await createActivitiesIn(tx, ctx, row);
    // started once the create is stored (the activities exist by then)
    onBeforeCommit(tx, `esm.journey.start:${id}`, async () => {
      const fresh = await liveRow(tx, sys, "journey", id);
      if (fresh?.state === "planned") await transitionIn(tx, sys, "journey", id, "active", {}, { trusted: true });
      await advanceJourneyIn(tx, ctx, id);
    });
    return;
  }
  if (w.changed.has("anchor_date") || w.changed.has("calendar_id")) await replanJourneyIn(tx, ctx, row);
  if (["subject_person_id", "manager_id", "assignment_group_id"].some((f) => w.changed.has(f))) {
    for (const a of await activitiesOf(tx, ctx, id)) {
      await updateIn(tx, sys, "journey_activity", String(a.id), { journey_readers: readersOf(row), hr_group_id: row.assignment_group_id ?? null }, { trusted: true, keepVersion: true });
    }
  }
  if (w.changed.has("state") && row.state === "cancelled") await cancelOpenWorkIn(tx, ctx, row);
  if (w.changed.has("state") && row.state === "active" && prev?.state === "waiting") onBeforeCommit(tx, `esm.journey.advance:${id}`, async () => void (await advanceJourneyIn(tx, ctx, id)));
}

/** The activities of a new journey from its template (planned on the calendar). */
async function createActivitiesIn(tx: Tx, ctx: Ctx, j: Row): Promise<void> {
  const sys = sysOf(ctx);
  if ((await activitiesOf(tx, ctx, String(j.id))).length) return;
  const acts = await templateActivities(tx, ctx, String(j.template_id));
  if (!acts.length) throw bad("الگوی سفر فعالیتی ندارد");
  const problems = templateProblems(acts.map((a) => ({ ...planOf(a), name: a.name, kind: a.kind, catalog_item_code: a.catalog_item_code, case_table: a.case_table, assignee: a.assignee, group_id: a.group_id })));
  if (problems.length) throw bad(`الگوی سفر ایراد دارد: ${problems[0].message}`);
  const cal = await calendarFor(tx, ctx, j.calendar_id);
  const plan = planJourney(acts.map(planOf), { anchor: String(j.anchor_date), start: todayOf(ctx), cal });
  for (const a of acts) {
    const p = plan.get(String(a.code));
    await createIn(tx, sys, "journey_activity", {
      journey_id: j.id, code: a.code, name: a.name, phase: a.phase, kind: a.kind, assignee_kind: a.assignee,
      assignee_id: assigneeOf(a.assignee, j), group_id: a.group_id ?? null, start_date: p?.start_date ?? null, due_date: p?.due_date ?? null,
      start_offset: a.start_offset ?? null, duration_days: a.duration_days ?? 1, after: a.after ?? [], day_one: !!a.day_one, condition: a.condition ?? null,
      catalog_item_code: a.catalog_item_code ?? null, order_answers: a.order_answers ?? null, case_table: a.case_table ?? null, case_department_id: a.case_department_id ?? null,
      document_url: a.document_url ?? null, instructions: a.instructions ?? null, sort_order: a.sort_order ?? 100,
      journey_readers: readersOf(j), hr_group_id: j.assignment_group_id ?? null, workspace_id: j.workspace_id ?? null,
    }, { trusted: true });
  }
}

/** Re-plan the open activities after the anchor date (or the calendar) moved; HR tasks follow their due date. */
export async function replanJourneyIn(tx: Tx, ctx: Ctx, j: Row): Promise<number> {
  const sys = sysOf(ctx);
  const acts = await activitiesOf(tx, ctx, String(j.id));
  const cal = await calendarFor(tx, ctx, j.calendar_id);
  const start = j.started_at ? String(j.started_at).slice(0, 10) : todayOf(ctx);
  const plan = planJourney(acts.map(planOf), { anchor: String(j.anchor_date), start, cal });
  let moved = 0;
  for (const a of acts) {
    if (ACTIVITY_FINISHED.has(String(a.state))) continue;
    const p = plan.get(String(a.code));
    if (!p || (p.start_date === a.start_date && p.due_date === a.due_date)) continue;
    moved++;
    await updateIn(tx, sys, "journey_activity", String(a.id), { start_date: p.start_date, due_date: p.due_date }, { trusted: true, keepVersion: true });
    if (a.record_table === "hr_task" && isUuid(a.record_id)) {
      const task = await liveRow(tx, sys, "hr_task", a.record_id);
      if (task && !["done", "skipped"].includes(String(task.state))) await updateIn(tx, sys, "hr_task", String(task.id), { due_date: p.due_date }, { trusted: true });
    }
  }
  onBeforeCommit(tx, `esm.journey.advance:${j.id}`, async () => void (await advanceJourneyIn(tx, ctx, String(j.id))));
  return moved;
}

async function cancelOpenWorkIn(tx: Tx, ctx: Ctx, j: Row): Promise<void> {
  const sys = sysOf(ctx);
  for (const a of await activitiesOf(tx, ctx, String(j.id))) {
    if (ACTIVITY_FINISHED.has(String(a.state))) continue;
    if (a.record_table === "hr_task" && isUuid(a.record_id)) {
      const task = await liveRow(tx, sys, "hr_task", a.record_id);
      if (task && ["open", "in_progress"].includes(String(task.state))) await transitionIn(tx, sys, "hr_task", String(task.id), "skipped", { outcome: "سفر لغو شد" }, { trusted: true });
    }
    await transitionIn(tx, sys, "journey_activity", String(a.id), "skipped", { outcome: "سفر لغو شد" }, { trusted: true });
  }
}

// ----- the engine ------------------------------------------------------------------------------------------------------

/** Advance a journey one step: start the activities that are due, then roll its progress up. Idempotent. */
export async function advanceJourneyIn(tx: Tx, ctx: Ctx, journeyId: string): Promise<{ started: number }> {
  const sys = sysOf(ctx);
  const j = await liveRow(tx, sys, "journey", journeyId);
  if (!j || !OPEN_JOURNEY.includes(String(j.state))) return { started: 0 };
  const cfg = await esmConfig(tx, ctx);
  const cal = await calendarFor(tx, ctx, j.calendar_id);
  const today = todayOf(ctx);
  let acts = await activitiesOf(tx, ctx, journeyId);
  let started = 0;
  if (j.state !== "waiting") {
    for (let round = 0; round < 6; round++) {
      const ready = readyToStart(acts.map(liveOf), { today, horizon: cfg.journey_horizon_days, cal });
      if (!ready.length) break;
      let changed = false;
      for (const code of ready) {
        const a = acts.find((x) => x.code === code)!;
        if (a.condition && !(await holdsOn(tx, ctx, a.condition as Cond, j))) {
          await transitionIn(tx, sys, "journey_activity", String(a.id), "skipped", { outcome: "شرط این فعالیت برای این سفر برقرار نبود" }, { trusted: true });
          changed = true;
          continue;
        }
        if (await startActivityIn(tx, ctx, j, a)) {
          started++;
          changed = true;
        }
      }
      if (!changed) break;
      acts = await activitiesOf(tx, ctx, journeyId);
    }
  }
  await rollupJourneyIn(tx, ctx, j, acts, today);
  return { started };
}

async function holdsOn(tx: Tx, ctx: Ctx, cond: Cond, j: Row): Promise<boolean> {
  const sys = sysOf(ctx);
  const schema = await orgSchema(sys, tx);
  try {
    return evaluate(cond, j, await condEnv(sys), schema.def("journey") ?? tableDef("journey")!, schema.lookup);
  } catch {
    return false;
  }
}

/** Mark an activity started with its work record (or failed with the reason). */
async function linkActivity(tx: Tx, ctx: Ctx, a: Row, rec: { table: string; id: string; number: string | null } | null, state: "in_progress" | "done" = "in_progress"): Promise<void> {
  const sys = sysOf(ctx);
  const patch: Row = { started_at: new Date().toISOString() };
  if (rec) Object.assign(patch, { record_table: rec.table, record_id: rec.id, record_number: rec.number });
  await updateIn(tx, sys, "journey_activity", String(a.id), patch, { trusted: true, keepVersion: true });
  await transitionIn(tx, sys, "journey_activity", String(a.id), state, {}, { trusted: true });
}

async function failActivity(tx: Tx, ctx: Ctx, a: Row, why: string): Promise<void> {
  const sys = sysOf(ctx);
  if (a.state === "pending") await transitionIn(tx, sys, "journey_activity", String(a.id), "in_progress", {}, { trusted: true });
  await transitionIn(tx, sys, "journey_activity", String(a.id), "failed", { outcome: why.slice(0, 2000) }, { trusted: true });
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Create the work of one activity in the department that does it. Returns false when it must wait (an order for an
 * employee who has no account yet).
 */
async function startActivityIn(tx: Tx, ctx: Ctx, j: Row, a: Row): Promise<boolean> {
  const sys = sysOf(ctx);
  const actor = isUuid(j.hr_owner_id) ? String(j.hr_owner_id) : null;
  const asOwner = sysOf(ctx, actor);
  const subject = isUuid(j.subject_person_id) ? String(j.subject_person_id) : null;
  const assignee = isUuid(a.assignee_id) ? String(a.assignee_id) : assigneeOf(a.assignee_kind, j);
  const who = j.subject_name || "کارمند تازه";
  const title = `${a.name} — ${j.name}`.slice(0, 200);
  const body = [a.instructions ? String(a.instructions) : "", a.document_url ? `[سند](${a.document_url})` : "", `سفر: ${j.number ?? ""} ${j.name}`].filter(Boolean).join("\n\n");
  switch (a.kind) {
    case "order": {
      if (!subject) {
        if (!a.outcome) await updateIn(tx, sys, "journey_activity", String(a.id), { outcome: "سفارش پس از ساخت حساب کاربری کارمند ثبت می‌شود" }, { trusted: true, keepVersion: true });
        return false;
      }
      const [item] = await liveRows(tx, sys, "catalog_item", { and: [{ f: "code", op: "eq", v: String(a.catalog_item_code ?? "") }] }, { limit: 1 });
      if (!item) {
        await failActivity(tx, ctx, a, `قلم کاتالوگ «${a.catalog_item_code}» پیدا نشد`);
        return true;
      }
      try {
        const res = await savepoint(tx, () =>
          placeOrder(asOwner, { lines: [{ item_id: String(item.id), requested_for: subject, answers: (a.order_answers as Record<string, unknown>) ?? {} }], requested_for: subject, instructions: `${a.name} — ${j.name}`, channel: "api" }, { inTx: tx }),
        );
        const it = res.items[0];
        await linkActivity(tx, ctx, a, it ? { table: "request_item", id: it.id, number: it.number } : res.produced ? { table: res.produced.table, id: res.produced.id, number: res.produced.number } : null);
      } catch (e) {
        await failActivity(tx, ctx, a, `سفارش ثبت نشد: ${messageOf(e)}`);
      }
      return true;
    }
    case "case": {
      const table = String(a.case_table ?? "");
      if (!tableDef(table)) {
        await failActivity(tx, ctx, a, "نوع پرونده معتبر نیست");
        return true;
      }
      try {
        const row = await savepoint(tx, () =>
          createIn(tx, asOwner, table, {
            short_description: title, description: body, requested_for: subject ?? j.manager_id ?? actor, caller_id: actor ?? j.manager_id ?? null,
            department_id: a.case_department_id ?? null, journey_id: j.id, location_id: j.location_id ?? null,
          }, { trusted: true }),
        );
        await linkActivity(tx, ctx, a, { table, id: String(row.id), number: (row.number as string) ?? null });
      } catch (e) {
        await failActivity(tx, ctx, a, `پرونده ساخته نشد: ${messageOf(e)}`);
      }
      return true;
    }
    case "approval": {
      const approver = assignee ?? (isUuid(j.manager_id) ? String(j.manager_id) : null);
      if (!approver) {
        await failActivity(tx, ctx, a, "تأییدکننده‌ای برای این فعالیت نیست");
        return true;
      }
      await transitionIn(tx, sys, "journey_activity", String(a.id), "in_progress", {}, { trusted: true });
      await updateIn(tx, sys, "journey_activity", String(a.id), { started_at: new Date().toISOString() }, { trusted: true, keepVersion: true });
      try {
        await savepoint(tx, () => requestApprovalIn(tx, sys, "journey_activity", String(a.id), { users: [approver], name: String(a.name), comment: body.slice(0, 2000), rule: "any" }));
      } catch (e) {
        await failActivity(tx, ctx, { ...a, state: "in_progress" }, `درخواست تأیید ثبت نشد: ${messageOf(e)}`);
      }
      return true;
    }
    case "notify": {
      const to = ids([assignee]);
      if (to.length) await notifyPeople(tx, ctx.org.id, { table: "journey", id: String(j.id), users: to, label: String(a.name), subject: `${a.name}: {{record.display}}`, body: body || String(a.name), channels: ["in_app", "email"], actor, source: "سفر کارمند" });
      await linkActivity(tx, ctx, a, null, "done");
      return true;
    }
    default: {
      // a task for the employee, the manager, HR or a group (sign, form, upload, acknowledge, learning, survey)
      let owner = assignee;
      if (!owner && isUuid(a.group_id)) owner = ((await liveRow(tx, sys, "group", a.group_id))?.manager_id as string) ?? actor;
      if (!owner) {
        await failActivity(tx, ctx, a, `کسی برای «${a.name}» پیدا نشد (${who})`);
        return true;
      }
      const type = a.kind === "task" ? "task" : String(a.kind);
      const task = await createIn(tx, sys, "hr_task", {
        short_description: String(a.name).slice(0, 200), type, assigned_to: owner, due_date: a.due_date ?? null, journey_id: j.id, journey_activity_id: a.id,
        assignment_group_id: j.assignment_group_id ?? null, instructions: a.instructions ?? null, document_url: a.document_url ?? null,
      }, { trusted: true });
      await linkActivity(tx, ctx, a, { table: "hr_task", id: String(task.id), number: (task.number as string) ?? null });
      return true;
    }
  }
}

/** Progress, overdue activities, day-one readiness and the next due date into the journey; complete it when done. */
export async function rollupJourneyIn(tx: Tx, ctx: Ctx, j: Row, acts: Row[], today = todayOf(ctx)): Promise<void> {
  const sys = sysOf(ctx);
  const fresh = await activitiesOf(tx, ctx, String(j.id));
  const p = journeyProgress(fresh.map(liveOf), today);
  for (const a of fresh) {
    const overdue = !ACTIVITY_FINISHED.has(String(a.state)) && !!a.due_date && String(a.due_date) < today;
    if (!!a.overdue !== overdue) await updateIn(tx, sys, "journey_activity", String(a.id), { overdue }, { trusted: true, keepVersion: true });
  }
  const patch: Row = {
    progress: String(p.progress), activities_total: p.total, activities_done: p.done, activities_overdue: p.overdue,
    day_one_total: p.day_one_total, day_one_done: p.day_one_done, day_one_ready: p.day_one_ready, next_due: p.next_due,
  };
  const now = (await liveRow(tx, sys, "journey", String(j.id))) ?? j;
  const differs = Object.entries(patch).some(([k, v]) => String(now[k] ?? "") !== String(v ?? ""));
  if (differs) await updateIn(tx, sys, "journey", String(j.id), patch, { trusted: true, keepVersion: true });
  if (p.finished && ["active", "waiting"].includes(String(now.state))) await transitionIn(tx, sys, "journey", String(j.id), "completed", {}, { trusted: true });
  void acts;
}

/**
 * A work record of journeys changed state: the activities linked to it follow (done when the record is done, failed
 * when it was cancelled, skipped when an HR task was skipped) and their journeys advance.
 */
export async function followRecordIn(tx: Tx, ctx: Ctx, table: string, id: string): Promise<number> {
  const sys = sysOf(ctx);
  const acts = await liveRows(tx, sys, "journey_activity", { and: [{ f: "record_table", op: "eq", v: table }, { f: "record_id", op: "eq", v: id }] }, { limit: 50 });
  if (!acts.length) return 0;
  const rec = await liveRow(tx, sys, table, id);
  const def = tableDef(table);
  const category = rec ? stateCategory(def?.states, rec.state) : "canceled";
  let moved = 0;
  for (const a of acts) {
    if (!["pending", "in_progress"].includes(String(a.state))) continue;
    let target: string | null = activityFromRecord(category);
    if (table === "hr_task" && rec?.state === "skipped") target = "skipped";
    if (!target) continue;
    if (a.state === "pending") await transitionIn(tx, sys, "journey_activity", String(a.id), "in_progress", {}, { trusted: true });
    const outcome = target === "done" ? null : `${def?.label ?? "رکورد کاری"} ${rec?.number ?? ""} بسته شد بی‌آنکه انجام شود`;
    await transitionIn(tx, sys, "journey_activity", String(a.id), target, outcome ? { outcome } : {}, { trusted: true });
    moved++;
    onBeforeCommit(tx, `esm.journey.advance:${a.journey_id}`, async () => void (await advanceJourneyIn(tx, ctx, String(a.journey_id))));
  }
  return moved;
}

// ----- activity hooks ----------------------------------------------------------------------------------------------------

async function activityBefore(w: WriteArgs): Promise<void> {
  const { next, prev, op } = w;
  if (op === "delete") return;
  if (prev && w.changed.has("state")) {
    if (["done", "skipped", "failed"].includes(String(next.state))) next.done_at = new Date().toISOString();
    if (next.state === "pending") next.done_at = null;
  }
}

async function activityDone(w: WriteArgs): Promise<string | null> {
  const { next, tx, ctx } = w;
  if (w.trusted || isSystemCtx(ctx)) return null;
  if (next.approval === "requested") return "این فعالیت منتظر تأیید است";
  if (next.record_table && isUuid(next.record_id)) {
    const rec = await liveRow(tx, sysOf(ctx), String(next.record_table), next.record_id);
    const cat = rec ? stateCategory(tableDef(String(next.record_table))?.states, rec.state) : null;
    if (rec && cat && !["resolved", "closed", "canceled"].includes(cat)) return `رکورد کاری ${rec.number ?? ""} هنوز باز است؛ با بسته‌شدن آن این فعالیت خودبه‌خود انجام می‌شود`;
  }
  return null;
}

async function activityAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx, row, op } = w;
  if (op === "delete" || !w.changed.has("state")) return;
  onBeforeCommit(tx, `esm.journey.advance:${row.journey_id}`, async () => void (await advanceJourneyIn(tx, ctx, String(row.journey_id))));
}

export const journeyHooks = { journeyBefore, journeyAfter, activityBefore, activityDone, activityAfter };

// ----- reads for the screens -----------------------------------------------------------------------------------------------

/** The journey tracker (signature screen): the journey, its activities by phase with their work records as the caller reads them. */
export async function journeyTracker(ctx: Ctx, id: string): Promise<Row> {
  const { row, display, meta } = await get(ctx, "journey", id);
  const acts = await list(ctx, "journey_activity", { filter: eqAll({ journey_id: id }), sort: "sort_order", size: 500, fields: ["name", "code", "phase", "kind", "state", "assignee_id", "group_id", "start_date", "due_date", "day_one", "overdue", "record_table", "record_id", "record_number", "outcome", "done_at", "approval", "after"] });
  const records: Record<string, { number: string | null; state: string | null; state_label: string | null; readable: boolean }> = {};
  for (const a of acts.rows) {
    if (!a.record_table || !isUuid(a.record_id)) continue;
    try {
      const r = await get(ctx, String(a.record_table), String(a.record_id));
      const def = tableDef(String(a.record_table));
      const label = def?.states?.states.find((s) => s.value === r.row.state)?.label ?? null;
      records[String(a.id)] = { number: (r.row.number as string) ?? null, state: (r.row.state as string) ?? null, state_label: label, readable: true };
    } catch {
      records[String(a.id)] = { number: (a.record_number as string) ?? null, state: null, state_label: null, readable: false };
    }
  }
  const tasks = await list(ctx, "hr_task", { filter: eqAll({ journey_id: id }), sort: "due_date", size: 200, fields: ["number", "short_description", "type", "state", "assigned_to", "due_date"] });
  return { journey: row, meta, display: { ...display, ...acts.display, ...tasks.display }, activities: acts.rows, records, tasks: tasks.rows, can_write: !!meta.canWrite };
}

/** Start a journey from a template for a person (the «آغاز سفر» form): checks the caller may create journeys. */
export async function startJourney(ctx: Ctx, input: Row): Promise<Row> {
  if (!isSystemCtx(ctx)) {
    await orgSchema(ctx);
    if (!access().canCreate(ctx, tableDef("journey")!)) throw forbidden("اجازهٔ آغاز سفر کارمند را ندارید");
  }
  const allowed = ["template_id", "anchor_date", "subject_person_id", "subject_name", "manager_id", "hr_owner_id", "employment_type", "location_id", "org_unit_id", "name", "notes", "calendar_id", "assignment_group_id"];
  const values = Object.fromEntries(Object.entries(input).filter(([k]) => allowed.includes(k)));
  const id = await ctx.write(async (tx) => {
    const row = await createIn(tx, ctx, "journey", values);
    return String(row.id);
  });
  return (await get(ctx, "journey", id)).row;
}

/** Days a person has to do their HR tasks and journey activities (my to-dos). */
export async function myTodos(ctx: Ctx): Promise<Row> {
  const tasks = await list(ctx, "hr_task", { filter: { and: [{ f: "assigned_to", op: "is_me" }, { f: "state", op: "in", v: ["open", "in_progress"] }] }, sort: "due_date", size: 100 });
  const journeys = await list(ctx, "journey", { filter: { and: [{ or: [{ f: "subject_person_id", op: "is_me" }, { f: "manager_id", op: "is_me" }] }, { f: "state", op: "in", v: OPEN_JOURNEY }] }, sort: "anchor_date", size: 50, fields: ["number", "name", "type", "state", "anchor_date", "progress", "day_one_ready", "subject_person_id", "manager_id"] });
  return { tasks: tasks.rows, journeys: journeys.rows, display: { ...tasks.display, ...journeys.display } };
}
