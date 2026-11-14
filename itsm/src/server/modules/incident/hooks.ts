// Behaviour of the incident tables on every write path (API, imports, flows, jobs; a Windows app for its own writes),
// inside the write's transaction:
//
//   incident (before, own hook — runs before the platform's "*" hooks)
//     · hold reasons only while waiting; «در انتظار از» stamped when the wait starts
//     · milestones: accepted_at / time_to_accept on the first start of work, time_to_resolve on resolution
//     · security incidents: confidential and handed to the security group of the settings
//     · VIP flag from the affected person's profile; parent links without loops
//     · the major-incident overlay: declaration stamps, cadence, resolved/reopened with the incident
//   incident (before, "*" hook registered after the SLA service — sees the matrix's priority and the assignment)
//     · major-incident candidates by the criteria of the settings
//   incident (after): a template's tasks, a note when the criteria flag a candidate
//   guards: incident_can_resolve (open mandatory tasks), incident_can_reopen (the reopen window)
//   incident_task: not on closed incidents
//   incident_review: defaults from the incident; publishing needs an owner on every preventive action and marks the
//     major incident «بازبینی انجام شد»
//   incident_template: the tasks JSON; templates and canned responses are created only by those who may keep them
//   announcement: its window and audience, the incident it names, publishing stamps
//   incident_period_review: not a requester's; a period that ends after it starts
//   interaction: not a requester's; a readable incident (required by the wrap-up «رخداد ثبت شد»); end and duration
//
// Reactions that must happen once (notifications, cascades, auto problems and reviews) are event subscribers
// (jobs.ts), never hooks: hooks do not run again when the cloud applies a Windows app's push.
import { stateCategory } from "@shared/model/task";
import type { FieldDef } from "@shared/model/types";
import { announcementProblem, majorCandidate, nextUpdateAt, reopenAllowed, templateTasks, templateTasksProblem } from "@shared/incident/logic";
import { INCIDENT_REQUESTER_FIELDS } from "@shared/tables/incident";
import { addJournalIn, createIn, defFor, registerHooks, updateIn, validationError, type WriteArgs } from "../../engine";
import { access } from "../../access/provider";
import { AppError, forbidden } from "../../http/errors";
import type { Ctx } from "../../context";
import { lockKey, type Queryable } from "../../db";
import { eqAll, faList, incidentConfig, liveRow, liveRows, lockedRow, requesterOnly, secondsBetween, sysOf, type Row } from "./common";
import { canWork } from "./major";

const DONE = ["resolved", "closed", "canceled"];
const entering = (w: WriteArgs, state: string) => w.next.state === state && (w.op === "create" || w.prev?.state !== state);
const changed = (w: WriteArgs, f: string) => w.op === "create" ? w.next[f] !== null && w.next[f] !== undefined && w.next[f] !== "" : w.changed.has(f);

// ---------------------------------------------------------------------------------------------------------------
// incident: before the platform's hooks

const REQUESTER_FIELDS = new Set(INCIDENT_REQUESTER_FIELDS);
/** A field's default when it is a plain value (`$me`, `$now`… are the engine's to fill). */
const plainDefault = (f: FieldDef): unknown => (typeof f.default === "string" && f.default.startsWith("$") ? null : f.default ?? (f.type === "bool" ? false : null));

/**
 * A requester files an incident; the desk's fields are not theirs: values a requester-only caller sent for them are
 * dropped (as ITSM tools ignore fields a user may not create), and the incident starts in the model's first state.
 */
function requesterCreate(w: WriteArgs): void {
  const model = w.def.states;
  if (model && w.next[model.field] !== model.initial) throw forbidden(`رخداد تازه فقط در وضعیت «${model.states.find((s) => s.value === model.initial)?.label ?? model.initial}» ثبت می‌شود`);
  for (const name of w.input ?? []) {
    if (REQUESTER_FIELDS.has(name) || name.startsWith("u_") || name === model?.field) continue;
    const f = w.def.fields.find((x) => x.name === name);
    if (!f || f.base || f.system || f.readonly) continue; // the engine keeps those to itself
    w.next[name] = plainDefault(f);
  }
}

async function incidentBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  if (w.op === "create" && !w.trusted && requesterOnly(w.ctx, w.def.area)) requesterCreate(w);
  const n = w.next;
  const now = new Date().toISOString();
  const def = w.def;
  const cat = stateCategory(def.states, n.state);

  // waiting: a reason while on hold, nothing otherwise; when the wait started (follow-ups count from there)
  if (n.state !== "on_hold") {
    if (n.hold_reason) n.hold_reason = null;
    if (n.hold_since) n.hold_since = null;
  } else if (entering(w, "on_hold") || (w.prev && w.prev.hold_reason !== n.hold_reason)) {
    n.hold_since = now;
    n.follow_ups = 0;
    n.last_follow_up_at = null;
  }

  // milestones
  if (entering(w, "in_progress") && !n.accepted_at) {
    n.accepted_at = now;
    n.time_to_accept = secondsBetween(n.opened_at ?? now, now);
  }
  if (cat === "resolved" || cat === "closed") {
    if (n.resolved_at && (n.time_to_resolve === null || n.time_to_resolve === undefined || changed(w, "resolved_at"))) n.time_to_resolve = secondsBetween(n.opened_at, n.resolved_at);
  } else if (n.time_to_resolve !== null && n.time_to_resolve !== undefined) n.time_to_resolve = null;

  const cfg = await incidentConfig(w.tx, w.ctx);

  // security incidents: hidden from everyone but the security group and the people on the record
  if (n.security_incident && changed(w, "security_incident")) {
    n.confidential = true;
    if (cfg.security_group_id && n.assignment_group_id !== cfg.security_group_id) {
      n.assignment_group_id = cfg.security_group_id;
      if (w.op !== "create") n.assigned_to = null;
    }
  }

  // the affected person's VIP flag
  if (w.op === "create" || w.changed.has("caller_id") || w.changed.has("requested_for")) {
    const who = n.requested_for || n.caller_id;
    let vip = false;
    if (who) {
      const [p] = await liveRows(w.tx, sysOf(w.ctx), "member_profile", eqAll({ user_id: who }), { limit: 1 });
      vip = !!p?.vip;
    }
    if (!!n.vip !== vip) n.vip = vip;
  }

  // parent links: never the record itself, never a loop
  if (n.parent_id && changed(w, "parent_id")) {
    if (n.parent_id === n.id) throw validationError({ parent_id: "رخداد نمی‌تواند والد خودش باشد" });
    const sys = sysOf(w.ctx);
    // new parent links of the organisation take turns (A under B while B goes under A): the later walk sees the
    // earlier link committed
    await lockKey(w.tx, "incident.parent_links:" + w.ctx.org.id);
    let at: string | null = n.parent_id;
    for (let depth = 0; at && depth < 20; depth++) {
      const p: Row | null = await liveRow(w.tx, sys, "incident", at);
      if (!p) break;
      if (p.id === n.id) throw validationError({ parent_id: "این پیوند والد و فرزند حلقه می‌سازد" });
      at = p.parent_id ?? null;
    }
  }
  if (n.merged_into && n.merged_into === n.id) throw validationError({ merged_into: "رخداد در خودش ادغام نمی‌شود" });

  // the major-incident overlay follows the incident and its declaration
  if (w.changed.has("major_state") || w.op === "create") {
    if (n.major_state === "accepted" && w.prev?.major_state !== "accepted") {
      if (!n.mi_declared_at) {
        n.mi_declared_at = now;
        n.mi_declared_by = w.ctx.actor === "system" ? null : w.ctx.user.id;
      }
      if (n.comm_cadence === null || n.comm_cadence === undefined) n.comm_cadence = cfg.mi_default_cadence;
      // the first update is due one cadence after the (re-)declaration
      n.next_update_at = nextUpdateAt(now, n.comm_cadence);
    }
    if (n.major_state === "downgraded" || n.major_state === "rejected") n.next_update_at = null;
  }
  if (n.major_state === "accepted" && cat && DONE.includes(cat) && cat !== "canceled") n.major_state = "resolved";
  if (n.major_state === "accepted" && cat === "canceled") n.major_state = "downgraded";
  if (n.major_state === "resolved" && cat && !DONE.includes(cat)) n.major_state = "accepted";
  if (n.major_state !== "accepted") {
    if (n.next_update_at) n.next_update_at = null;
  } else if (w.changed.has("comm_cadence") && w.op !== "create") {
    n.next_update_at = nextUpdateAt(n.last_update_at ?? n.mi_declared_at ?? now, n.comm_cadence);
  } else if (!n.next_update_at) {
    // a reopened major incident: updates are due again
    n.next_update_at = nextUpdateAt(now, n.comm_cadence);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// incident: after the platform's beforeWrite hooks (priority from the matrix, the group from assignment rules)

async function incidentLate(w: WriteArgs): Promise<void> {
  if (w.def.key !== "incident" || w.op === "delete") return;
  const n = w.next;
  const cat = stateCategory(w.def.states, n.state);
  if (cat && DONE.includes(cat)) {
    if (n.major_state === "candidate") n.major_state = null;
    return;
  }
  if (n.major_state && n.major_state !== "candidate") return;
  const touched = w.op === "create" || ["priority", "impact", "urgency", "affected_users", "major_state"].some((f) => w.changed.has(f));
  if (!touched) return;
  const cfg = await incidentConfig(w.tx, w.ctx);
  const reason = majorCandidate(cfg, { ...n, major_state: null });
  if (reason && n.major_state !== "candidate") n.major_state = "candidate";
  else if (!reason && n.major_state === "candidate") n.major_state = null;
}

// ---------------------------------------------------------------------------------------------------------------
// incident: after the save

async function incidentAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete") return;
  const row = w.row;
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  // a template's tasks (incident models)
  if (w.op === "create" && row.template_id) {
    const t = await liveRow(w.tx, sysOf(w.ctx), "incident_template", row.template_id);
    const tasks = t ? templateTasks(t.tasks) : [];
    for (const [i, task] of tasks.entries()) {
      await createIn(w.tx, sys, "incident_task", {
        incident_id: row.id,
        short_description: task.short_description,
        description: task.description ?? null,
        assignment_group_id: task.assignment_group_id ?? row.assignment_group_id ?? null,
        mandatory: task.mandatory !== false,
        sort_order: (i + 1) * 10,
        caller_id: w.ctx.actor === "system" ? null : w.ctx.user.id,
      }, { trusted: true });
    }
    if (t) await note(w, `الگوی «${t.name}» به کار رفت${tasks.length ? ` و ${tasks.length} کار ساخته شد` : ""}.`);
  }
  if (w.changed.has("major_state") && row.major_state === "candidate") {
    const cfg = await incidentConfig(w.tx, w.ctx);
    const reason = majorCandidate(cfg, { ...row, major_state: null });
    await note(w, `${reason ?? "معیار رخداد عمده برقرار است"}؛ مدیر رخداد عمده آن را اعلام یا رد کند.`);
  }
}

async function note(w: WriteArgs & { row: Row }, body: string, data: Record<string, unknown> | null = null): Promise<void> {
  const { def } = await defFor(sysOf(w.ctx), w.def.key, w.tx);
  await addJournalIn(w.tx, sysOf(w.ctx), def, w.row, { kind: "system", visibility: "internal", body, data }, { trusted: true, author: null });
}

// ---------------------------------------------------------------------------------------------------------------
// guards

/** Open mandatory tasks of an incident (the system reads them all: a person resolving must not skip hidden ones). */
export async function openMandatoryTasks(q: Queryable, ctx: Ctx, incidentId: string): Promise<Row[]> {
  return liveRows(q, sysOf(ctx), "incident_task", { and: [{ f: "incident_id", op: "eq", v: incidentId }, { f: "active", op: "eq", v: true }, { f: "mandatory", op: "eq", v: true }] }, { order: "t.no", limit: 50 });
}

async function canResolve(w: WriteArgs): Promise<string | null> {
  const open = await openMandatoryTasks(w.tx, w.ctx, String(w.next.id));
  if (!open.length) return null;
  // name only the tasks the person may read; the others are counted
  const seen = new Set((await liveRows(w.tx, w.ctx, "incident_task", { f: "incident_id", op: "eq", v: String(w.next.id) }, { limit: 200 })).map((t) => t.id));
  const named = open.filter((t) => seen.has(t.id)).slice(0, 5).map((t) => String(t.number));
  const rest = open.length - named.length;
  return `پیش از حل رخداد، کارهای الزامیِ باز را ببندید: ${faList([...named, ...(rest ? [`${rest} کار دیگر`] : [])])}`;
}

async function canReopen(w: WriteArgs): Promise<string | null> {
  if (w.ctx.actor === "system") return null;
  const cfg = await incidentConfig(w.tx, w.ctx);
  if (reopenAllowed(w.prev?.resolved_at, cfg.reopen_window_days)) return null;
  return `مهلت بازگشایی (${cfg.reopen_window_days} روز پس از حل) گذشته است؛ به جای آن «رخداد پیگیری» ثبت کنید`;
}

// ---------------------------------------------------------------------------------------------------------------
// incident_task, incident_review, incident_template

/**
 * Tasks and reviews belong to the people working the incident: a caller (not the system) who adds one, or moves one to
 * another incident, must be able to read that incident and work it as an agent — not only as its requester.
 */
async function assertWorksIncident(w: WriteArgs, what: string): Promise<void> {
  if (w.ctx.actor === "system" || w.trusted) return;
  const inc = await liveRow(w.tx, w.ctx, "incident", w.next.incident_id);
  if (!inc) throw validationError({ incident_id: "رخداد پیدا نشد" });
  const { def } = await defFor(w.ctx, "incident", w.tx);
  if (!canWork(w.ctx, def, inc)) throw forbidden(`${what} را کسی می‌سازد که روی ${inc.number ? `رخداد ${inc.number}` : "این رخداد"} کار می‌کند`);
}

/** Definitions (templates, canned responses, announcements): the caller creates only what they could change afterwards. */
export function assertCanKeep(w: WriteArgs): void {
  if (w.op !== "create" || w.ctx.actor === "system" || w.trusted) return;
  if (!access().canWrite(w.ctx, w.def, w.next)) throw forbidden(`ساختن «${w.def.label}» با مدیران رخداد${w.def.scope?.group ? " یا اعضای گروه آن" : ""} است`);
}

async function taskBefore(w: WriteArgs): Promise<void> {
  if (w.op !== "create" && !w.changed.has("incident_id")) return;
  if (w.op === "delete") return;
  await assertWorksIncident(w, "کار رخداد");
  // shared lock until commit: a closing of the incident in flight finishes first (and the task is refused); one that
  // comes later waits for this task
  const inc = await lockedRow(w.tx, sysOf(w.ctx), "incident", w.next.incident_id, "share");
  if (!inc) return; // the engine's reference check answers
  const cat = stateCategory((await defFor(sysOf(w.ctx), "incident", w.tx)).def.states, inc.state);
  if (cat === "closed" || cat === "canceled") throw validationError({ incident_id: "این رخداد بسته شده است و کار تازه نمی‌پذیرد" });
  if (w.op === "create" && !w.next.assignment_group_id && inc.assignment_group_id) w.next.assignment_group_id = inc.assignment_group_id;
  if (w.op === "create" && !w.next.workspace_id && inc.workspace_id) w.next.workspace_id = inc.workspace_id;
}

async function taskAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || !w.changed.has("state") || w.row.active) return;
  const id = String(w.row.incident_id ?? "");
  if (!id || !w.row.mandatory) return;
  const open = await openMandatoryTasks(w.tx, w.ctx, id);
  if (open.length) return;
  const inc = await liveRow(w.tx, sysOf(w.ctx), "incident", id);
  if (!inc || !inc.active) return;
  const { def } = await defFor(sysOf(w.ctx), "incident", w.tx);
  await addJournalIn(w.tx, sysOf(w.ctx), def, inc, { kind: "system", visibility: "internal", body: `همهٔ کارهای الزامی رخداد انجام شد (آخرین: ${w.row.number}).` }, { trusted: true, author: null });
}

async function reviewBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create" || w.changed.has("incident_id")) await assertWorksIncident(w, "بازبینی پس از رخداد");
  if (w.op === "create") {
    const inc = await liveRow(w.tx, sysOf(w.ctx), "incident", n.incident_id);
    if (inc) {
      if (!n.assignment_group_id) n.assignment_group_id = inc.assignment_group_id ?? null;
      if (!n.workspace_id && inc.workspace_id) n.workspace_id = inc.workspace_id;
    }
  }
  if (entering(w, "published")) {
    n.published_at = new Date().toISOString();
    n.published_by = w.ctx.actor === "system" ? null : w.ctx.user.id;
  } else if (w.prev?.state === "published" && n.state !== "published" && n.state !== "archived") {
    n.published_at = null;
    n.published_by = null;
  }
}

async function reviewAfter(w: WriteArgs & { row: Row }): Promise<void> {
  if (w.op === "delete" || !w.changed.has("state")) return;
  // locked: a reopening of the incident at this moment finishes first and its overlay is not marked «بازبینی انجام شد»
  const inc = await lockedRow(w.tx, sysOf(w.ctx), "incident", w.row.incident_id);
  if (!inc) return;
  const sys = sysOf(w.ctx);
  if (w.row.state === "published" && inc.major_state === "resolved") {
    await updateIn(w.tx, sys, "incident", inc.id, { major_state: "pir_done" }, { trusted: true, keepVersion: true, allowLocked: true });
  } else if (w.prev?.state === "published" && w.row.state === "in_review" && inc.major_state === "pir_done") {
    await updateIn(w.tx, sys, "incident", inc.id, { major_state: "resolved" }, { trusted: true, keepVersion: true, allowLocked: true });
  }
}

async function canPublish(w: WriteArgs): Promise<string | null> {
  const actions = await liveRows(w.tx, sysOf(w.ctx), "corrective_action", { and: [{ f: "review_id", op: "eq", v: String(w.next.id) }, { f: "action_type", op: "eq", v: "prevent" }] }, { limit: 200 });
  const orphans = actions.filter((a) => !a.assigned_to && a.state !== "canceled");
  if (orphans.length) return `پیش از انتشار، برای اقدام‌های پیشگیری مسئول تعیین کنید: ${faList(orphans.slice(0, 5).map((a) => String(a.number)))}`;
  return null;
}

function templateBefore(w: WriteArgs): void {
  assertCanKeep(w);
  if (w.op === "delete" || (w.op !== "create" && !w.changed.has("tasks"))) return;
  const p = templateTasksProblem(w.next.tasks);
  if (p) throw validationError({ tasks: p });
}

/**
 * Announcements: kept by their group or a manager, a window that ends after it starts, a target when the audience is
 * targeted, an incident the author may read; publishing stamps when and by whom (and «from now» when no start is set).
 */
const ANNOUNCEMENT_TARGETS = ["starts_at", "ends_at", "audience", "groups", "units", "locations", "users"];

async function announcementBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  assertCanKeep(w);
  const n = w.next;
  if (w.op === "create" || ANNOUNCEMENT_TARGETS.some((f) => w.changed.has(f))) {
    const problem = announcementProblem(n);
    if (problem) throw validationError(problem);
  }
  if (n.incident_id && (w.op === "create" || w.changed.has("incident_id")) && w.ctx.actor !== "system" && !w.trusted) {
    if (!(await liveRow(w.tx, w.ctx, "incident", n.incident_id))) throw validationError({ incident_id: "رخداد پیدا نشد" });
  }
  const now = new Date().toISOString();
  if (entering(w, "published")) {
    if (n.ends_at && Date.parse(n.ends_at) <= Date.now()) throw validationError({ ends_at: "بازهٔ نمایش این اطلاعیه گذشته است؛ «نمایش تا» را تغییر دهید" });
    if (!n.starts_at) n.starts_at = now;
    n.published_at = now;
    n.published_by = w.ctx.actor === "system" ? null : w.ctx.user.id;
    n.ended_at = null;
  }
  if (entering(w, "ended")) n.ended_at = now;
}

/** Periodic reviews: run by agents and managers (never a requester), over a period that ends after it starts. */
function periodBefore(w: WriteArgs): void {
  if (w.op === "delete") return;
  if (w.op === "create" && !w.trusted && requesterOnly(w.ctx, w.def.area)) throw forbidden("بازبینی دوره‌ای رخدادها با کارشناسان و مدیران است");
  const from = String(w.next.period_from ?? "");
  const to = String(w.next.period_to ?? "");
  if (from && to && to < from) throw validationError({ period_to: "پایان دوره باید پس از آغاز آن باشد" });
}

/**
 * Interactions: recorded by agents (never a requester); the incident they name must be one the author may read; the
 * wrap-up «رخداد ثبت شد» needs that incident; when one ends, its end and duration are kept.
 */
async function interactionBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create" && !w.trusted && requesterOnly(w.ctx, w.def.area)) throw forbidden("ثبت تعامل با کارشناسان است");
  if (n.incident_id && (w.op === "create" || w.changed.has("incident_id")) && w.ctx.actor !== "system" && !w.trusted) {
    if (!(await liveRow(w.tx, w.ctx, "incident", n.incident_id))) throw validationError({ incident_id: "رخداد پیدا نشد" });
  }
  if (n.wrap_up === "incident" && !n.incident_id) throw validationError({ incident_id: "برای نتیجهٔ «رخداد ثبت شد»، رخداد را مشخص کنید" });
  if (entering(w, "closed") && !n.ended_at) n.ended_at = new Date().toISOString();
  if (w.op === "create" || w.changed.has("ended_at") || w.changed.has("started_at") || entering(w, "closed")) {
    const d = secondsBetween(n.started_at, n.ended_at);
    if (n.ended_at && d === null) throw validationError({ ended_at: "پایان باید پس از آغاز باشد" });
    n.duration = d;
  }
}

function configBefore(w: WriteArgs): void {
  if (w.op === "delete") throw new AppError(409, "conflict", "تنظیمات رخداد حذف نمی‌شود؛ مقدارها را تغییر دهید");
}

/** The hooks of the incident tables (installed once by `installIncidentModule`). */
export function installIncidentHooks(): (() => void)[] {
  return [
    registerHooks("incident", { beforeWrite: incidentBefore, afterWrite: incidentAfter, guards: { incident_can_resolve: canResolve, incident_can_reopen: canReopen } }),
    // registered after installSlaService() (src/server/routes/modules.ts): runs after the priority matrix and the
    // assignment rules of the "*" hooks, so the criteria see the final priority
    registerHooks("*", { beforeWrite: incidentLate }),
    registerHooks("incident_task", { beforeWrite: taskBefore, afterWrite: taskAfter }),
    registerHooks("incident_review", { beforeWrite: reviewBefore, afterWrite: reviewAfter, guards: { review_can_publish: canPublish } }),
    registerHooks("incident_template", { beforeWrite: templateBefore }),
    registerHooks("incident_response", { beforeWrite: assertCanKeep }),
    registerHooks("announcement", { beforeWrite: announcementBefore }),
    registerHooks("incident_period_review", { beforeWrite: periodBefore }),
    registerHooks("interaction", { beforeWrite: interactionBefore }),
    registerHooks("incident_config", { beforeWrite: configBefore }),
  ];
}
