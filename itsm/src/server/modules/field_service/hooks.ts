// Hooks of field service (same transaction as the write):
//   · work orders: the account of the contact, the territory of the location, coverage from the customer's onsite
//     entitlement (and the chargeability it implies, FSM-004), the dispatch group, the first task from the template
//   · tasks (FSM-002/003/021): copies of their work order (group, place, account, priority), the template's skills,
//     duration and checklist, the visit number; every step of the visit stamped (dispatched, accepted, en route with
//     an ETA, arrived, completed) with travel and work minutes; no completion with required checklist items open
//   · the work order follows its tasks: counts, visits, technicians (who read it), first-time fix, «در حال انجام» when a
//     technician arrives and «کار انجام شد» when every task is done; the customer hears «در راه است» and the result as
//     public replies on the record the work order was made for (no technician's name or position)
//   · parts copy their task's technician and group; time entries compute their minutes; technicians keep their
//     valid skill tags
import { checklistMissing, haversineKm, parseChecklist, parseSkills, toPoint, travelMinutes, validSkillTags } from "@shared/field_service/logic";
import { resolveEntitlement, type EntitlementLike } from "@shared/csm/logic";
import { formatJalaliDateTime } from "@shared/jalali";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, createIn, emitEvent, isSystemCtx, onBeforeCommit, orgTz, registerHooks, transitionIn, updateIn, validationError, type WriteArgs } from "../../engine";
import { forbidden } from "../../http/errors";
import { fsmConfig, ids, isUuid, liveRow, liveRows, msOf, sysOf, todayOf, type Row } from "./common";

// ----- work orders -----------------------------------------------------------------------------------------------------

/** The territory whose locations include `location` (or one above it). */
async function territoryOf(tx: Tx, ctx: Ctx, location: unknown): Promise<Row | null> {
  if (!isUuid(location)) return null;
  const sys = sysOf(ctx);
  const loc = await liveRow(tx, sys, "location", location);
  const line = new Set<string>([String(location), ...String(loc?.path ?? "").split("/").filter(Boolean)]);
  const territories = await liveRows(tx, sys, "territory", { f: "active", op: "eq", v: true }, { limit: 500 });
  return territories.find((t) => ((t.locations as string[]) ?? []).some((l) => line.has(String(l)))) ?? null;
}

async function workOrderBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  if (isUuid(next.contact_id) && !isUuid(next.account_id)) next.account_id = (await liveRow(tx, sys, "customer_contact", next.contact_id))?.account_id ?? null;
  if (!isUuid(next.territory_id) && (op === "create" || w.changed.has("location_id"))) {
    const t = await territoryOf(tx, ctx, next.location_id);
    if (t) next.territory_id = t.id;
  }
  // coverage (FSM-004): the customer's onsite entitlement decides chargeability
  if (op === "create" || w.changed.has("account_id")) {
    if (isUuid(next.account_id) && tableDef("entitlement")) {
      const cands = (await liveRows(tx, sys, "entitlement", { f: "account_id", op: "eq", v: next.account_id }, { limit: 200 })) as (EntitlementLike & Row)[];
      const r = resolveEntitlement(cands, { account_id: String(next.account_id), today: todayOf(ctx), channel: "onsite" });
      next.coverage = r.status === "covered" ? "covered" : "not_covered";
      next.entitlement_id = r.status === "covered" ? (r.entitlement?.id ?? null) : null;
      if (!w.input?.has("billing_type")) next.billing_type = r.status === "covered" ? "contract" : "billable";
    } else next.coverage = "unknown";
  }
}

async function workOrderAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx, row, op } = w;
  if (op !== "create") return;
  const sys = sysOf(ctx);
  if (!row.assignment_group_id) {
    const t = isUuid(row.territory_id) ? await liveRow(tx, sys, "territory", row.territory_id) : null;
    const g = (t?.dispatch_group_id as string) ?? (await fsmConfig(tx, ctx)).default_group_id;
    if (g) await updateIn(tx, sys, "work_order", String(row.id), { assignment_group_id: g }, { trusted: true, keepVersion: true });
  }
  // the template's first visit
  if (isUuid(row.template_id)) {
    const tpl = await liveRow(tx, sys, "wo_task_template", row.template_id);
    if (tpl) await createIn(tx, sys, "wo_task", { short_description: String(tpl.name).slice(0, 200), work_order_id: row.id, template_id: tpl.id }, { trusted: true });
  }
}

// ----- tasks -----------------------------------------------------------------------------------------------------------

async function taskBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, prev, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  if (op === "create" || w.changed.has("work_order_id")) {
    const wo = await liveRow(tx, sys, "work_order", next.work_order_id);
    if (!wo) throw validationError({ work_order_id: "دستور کار پیدا نشد" });
    if (["closed_complete", "closed_incomplete", "cancelled"].includes(String(wo.state)) && !w.trusted) throw validationError({ work_order_id: "دستور کار بسته است" });
    if (!next.assignment_group_id) next.assignment_group_id = wo.assignment_group_id ?? null;
    Object.assign(next, { location_id: wo.location_id ?? null, territory_id: wo.territory_id ?? null, account_id: wo.account_id ?? null, site_lat: wo.site_lat ?? null, site_lng: wo.site_lng ?? null });
    if (op === "create") {
      if (!w.input?.has("priority") && wo.priority) next.priority = String(wo.priority);
      if (!w.input?.has("required_skills") && Array.isArray(wo.required_skills) && wo.required_skills.length) next.required_skills = wo.required_skills;
      const n = await liveRows(tx, sys, "wo_task", { f: "work_order_id", op: "eq", v: wo.id }, { limit: 500 });
      next.visit_no = n.length + 1;
    }
  }
  if (op === "create" && isUuid(next.template_id)) {
    const tpl = await liveRow(tx, sys, "wo_task_template", next.template_id);
    if (tpl) {
      if (!w.input?.has("required_skills")) next.required_skills = tpl.required_skills ?? [];
      if (!w.input?.has("est_work_minutes") && tpl.est_work_minutes) next.est_work_minutes = tpl.est_work_minutes;
      if (!w.input?.has("instructions")) next.instructions = [tpl.instructions, tpl.safety ? `**ایمنی:**\n${tpl.safety}` : null].filter(Boolean).join("\n\n") || null;
      next.checklist = parseChecklist(tpl.checklist);
    }
  }
  if (next.scheduled_start && !next.scheduled_end) next.scheduled_end = new Date((msOf(next.scheduled_start) ?? 0) + Number(next.est_work_minutes ?? 60) * 60_000).toISOString();
  next.checklist_done = checklistMissing(parseChecklist(next.checklist), (next.checklist_answers as Record<string, unknown>) ?? {}).length === 0;
  if (!prev || !w.changed.has("state")) return;
  const now = new Date().toISOString();
  const nowMs = Date.now();
  switch (next.state) {
    case "assigned":
      if (prev.state === "pending_dispatch") next.dispatched_at = now;
      break;
    case "accepted":
      next.accepted_at = now;
      break;
    case "en_route": {
      next.en_route_at = now;
      const cfg = await fsmConfig(tx, ctx);
      const tech = isUuid(next.technician_id) ? (await liveRows(tx, sys, "technician", { f: "user_id", op: "eq", v: next.technician_id }, { limit: 1 }))[0] : null;
      const from = toPoint(tech?.last_lat, tech?.last_lng) ?? toPoint(tech?.home_lat, tech?.home_lng);
      const to = toPoint(next.site_lat, next.site_lng);
      const minutes = from && to ? travelMinutes(haversineKm(from, to), cfg.travel_speed_kmh, cfg.road_factor) : Number(next.est_travel_minutes ?? 0) || null;
      next.eta_at = minutes ? new Date(nowMs + minutes * 60_000).toISOString() : null;
      break;
    }
    case "on_site": {
      if (!next.arrived_at) next.arrived_at = now;
      const left = msOf(next.en_route_at);
      if (left) next.travel_minutes = Math.max(0, Math.round((nowMs - left) / 60_000));
      break;
    }
    case "work_complete": {
      next.completed_at = now;
      const arrived = msOf(next.arrived_at);
      if (arrived) next.work_minutes = Math.max(0, Math.round((nowMs - arrived) / 60_000) - Number(next.break_minutes ?? 0));
      break;
    }
  }
}

async function taskChecklist(w: WriteArgs): Promise<string | null> {
  const missing = checklistMissing(parseChecklist(w.next.checklist), (w.next.checklist_answers as Record<string, unknown>) ?? {});
  return missing.length ? `چک‌لیست کامل نیست: ${missing.map((m) => m.label).join("، ")}` : null;
}

/** A public reply on the record the work order was made for (customers hear about their visit there). */
async function tellCustomer(tx: Tx, ctx: Ctx, wo: Row, body: string): Promise<void> {
  const table = String(wo.parent_table ?? "");
  const def = tableDef(table);
  if (!def?.features?.journal || !isUuid(wo.parent_record)) return;
  const sys = sysOf(ctx);
  const parent = await liveRow(tx, sys, table, wo.parent_record);
  if (!parent || parent.active === false) return;
  await addJournalIn(tx, sys, def, parent, { kind: "comment", body }, { trusted: true });
}

async function taskAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx, row, prev } = w;
  if (w.op === "delete") return;
  const sys = sysOf(ctx);
  const woId = String(row.work_order_id ?? prev?.work_order_id ?? "");
  if (isUuid(woId)) onBeforeCommit(tx, `fsm.wo:${woId}`, () => rollupWorkOrderIn(tx, ctx, woId));
  if (!prev || !w.changed.has("state")) return;
  const wo = await liveRow(tx, sys, "work_order", woId);
  if (!wo) return;
  const tz = orgTz(sys);
  if (row.state === "en_route") await tellCustomer(tx, ctx, wo, `کارشناس خدمات در محل در راه است${row.eta_at ? `؛ زمان تقریبی رسیدن: ${formatJalaliDateTime(String(row.eta_at), tz)}` : ""}.`);
  if (row.state === "work_complete") await tellCustomer(tx, ctx, wo, `کار در محل انجام شد (${row.number ?? ""}).${row.resolution ? `\n\n${row.resolution}` : ""}${row.signer_name ? `\n\nتأییدکنندهٔ مشتری: ${row.signer_name}` : ""}`);
  if (row.state === "assigned" && isUuid(row.technician_id)) await emitEvent(tx, sys, { kind: "record.task_dispatched", table: "wo_task", id: String(row.id), number: (row.number as string) ?? null, data: { users: [row.technician_id] } });
}

/** A work order's counts, visits, technicians, first-time fix and state from its tasks. */
export async function rollupWorkOrderIn(tx: Tx, ctx: Ctx, woId: string): Promise<void> {
  const sys = sysOf(ctx);
  const wo = await liveRow(tx, sys, "work_order", woId);
  if (!wo) return;
  const tasks = await liveRows(tx, sys, "wo_task", { f: "work_order_id", op: "eq", v: woId }, { limit: 500 });
  const live = tasks.filter((t) => t.state !== "cancelled");
  const open = live.filter((t) => !["work_complete", "closed"].includes(String(t.state)));
  const visits = live.filter((t) => t.arrived_at).length;
  const starts = live.map((t) => msOf(t.scheduled_start)).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const patch: Row = {
    tasks_total: live.length, tasks_open: open.length, visits, technicians: ids(live.map((t) => t.technician_id)),
    scheduled_start: starts.length ? new Date(starts[0]).toISOString() : null,
    work_minutes: live.reduce((s, t) => s + Number(t.work_minutes ?? 0), 0), travel_minutes: live.reduce((s, t) => s + Number(t.travel_minutes ?? 0), 0),
    first_time_fix: live.length > 0 && open.length === 0 && visits <= 1,
  };
  const differs = Object.entries(patch).some(([k, v]) => JSON.stringify(wo[k] ?? null) !== JSON.stringify(v ?? null));
  if (differs) await updateIn(tx, sys, "work_order", woId, patch, { trusted: true, keepVersion: true });
  const st = String(wo.state);
  if (live.some((t) => t.state === "on_site") && ["scheduled", "awaiting_parts", "awaiting_customer"].includes(st)) await transitionIn(tx, sys, "work_order", woId, "in_progress", {}, { trusted: true });
  else if (live.length && !open.length && ["scheduled", "in_progress", "awaiting_parts", "awaiting_customer"].includes(st)) await transitionIn(tx, sys, "work_order", woId, "work_complete", {}, { trusted: true });
  else if (live.some((t) => t.state === "pending_parts") && st === "in_progress") await transitionIn(tx, sys, "work_order", woId, "awaiting_parts", {}, { trusted: true });
}

async function woHasTasks(w: WriteArgs): Promise<string | null> {
  const n = await liveRows(w.tx, sysOf(w.ctx), "wo_task", { f: "work_order_id", op: "eq", v: w.next.id }, { limit: 1 });
  return n.length ? null : "دستور کار هنوز وظیفه‌ای ندارد؛ نخست وظیفه‌ای بسازید";
}

async function woTasksDone(w: WriteArgs): Promise<string | null> {
  const tasks = await liveRows(w.tx, sysOf(w.ctx), "wo_task", { f: "work_order_id", op: "eq", v: w.next.id }, { limit: 500 });
  const open = tasks.filter((t) => !["work_complete", "closed", "cancelled"].includes(String(t.state)));
  return open.length ? `${open.length} وظیفهٔ این دستور کار هنوز باز است` : null;
}

// ----- parts, time, technicians ----------------------------------------------------------------------------------------

async function childOfTask(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, op } = w;
  if (op === "delete") return;
  const task = await liveRow(tx, sysOf(ctx), "wo_task", next.wo_task_id);
  if (!task) throw validationError({ wo_task_id: "وظیفه پیدا نشد" });
  next.work_order_id = task.work_order_id;
  next.assignment_group_id = task.assignment_group_id ?? null;
  if (w.def.key === "parts_requirement") next.technician_id = task.technician_id ?? null;
  if (w.def.key === "field_time_entry") {
    const a = msOf(next.started_at);
    const b = msOf(next.ended_at);
    if (a !== null && b !== null) {
      if (b < a) throw validationError({ ended_at: "پایان باید پس از آغاز باشد" });
      next.minutes = Math.round((b - a) / 60_000);
    }
    // a technician records their own time; dispatchers anyone's
    if (!isSystemCtx(ctx) && !w.trusted && next.user_id !== ctx.user.id && op === "create" && task.technician_id !== ctx.user.id) {
      const { dispatches } = await import("./common");
      if (!(await dispatches(tx, ctx))) throw forbidden("زمان دیگران را توزیع‌کننده ثبت می‌کند");
    }
  }
}

async function partAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { tx, ctx, row, prev } = w;
  if (!prev || !w.changed.has("state") || row.state !== "consumed") return;
  // asset management (when installed) moves its stock on this event; the record keeps what was used
  await emitEvent(tx, sysOf(ctx), { kind: "record.part_consumed", table: "parts_requirement", id: String(row.id), data: { part_name: row.part_name, part_code: row.part_code ?? null, quantity: row.quantity, serial_no: row.serial_no ?? null, stockroom: row.stockroom ?? null, work_order_id: row.work_order_id } });
}

async function technicianBefore(w: WriteArgs): Promise<void> {
  const { tx, ctx, next, op } = w;
  if (op === "delete") return;
  if (op === "create" || w.changed.has("user_id")) {
    const u = isUuid(next.user_id) ? await tx.one<{ name: string }>(`select coalesce(nullif(full_name, ''), email) as name from sm_users where id = $1`, [String(next.user_id)]) : null;
    next.name = u?.name ?? null;
  }
  if (next.skills !== null && next.skills !== undefined && !Array.isArray(next.skills)) throw validationError({ skills: "مهارت‌ها فهرستی از {skill, level, expires_on} است" });
  next.skill_tags = validSkillTags(parseSkills(next.skills), todayOf(ctx));
}

export function installFieldHooks(): (() => void)[] {
  return [
    registerHooks("work_order", { beforeWrite: workOrderBefore, afterWrite: workOrderAfter, guards: { wo_has_tasks: woHasTasks, wo_tasks_done: woTasksDone } }),
    registerHooks("wo_task", { beforeWrite: taskBefore, afterWrite: taskAfter, guards: { wot_checklist: taskChecklist } }),
    registerHooks("parts_requirement", { beforeWrite: childOfTask, afterWrite: partAfter }),
    registerHooks("field_time_entry", { beforeWrite: childOfTask }),
    registerHooks("technician", { beforeWrite: technicianBefore }),
  ];
}
