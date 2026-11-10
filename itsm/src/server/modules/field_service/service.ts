// Field-service operations the generic API cannot express (each with the caller's context unless it says so):
//   · the dispatch board (FSM-005, signature screen): technicians of a day with their shifts and booked visits,
//     the unassigned queue, clashes; assigning by drag (or the keyboard alternative) checks feasibility and answers
//     with the warnings; candidates and immediate auto-assignment (FSM-006); work orders from any record (FSM-001)
//   · the technician's day (FSM-017/008/019/023): their visits in route order with navigation links; accept, depart
//     (ETA), arrive and leave with their position (kept briefly, seen by dispatch only), checklist answers, customer
//     sign-off with the signature as an attachment, the service report
//   · appointment slots and booking (FSM-014): free windows from real shifts and bookings, never who or where
//   · planned maintenance (FSM-026/ESM-031): plans generate work orders (or facilities requests) ahead of time
//   · field KPIs (FSM-030)
import { clashes, fieldKpis, freeSlots, mapLink, rankCandidates, routeOrder, scoreCandidate, parseSkills, toPoint, dueOccurrences, nextDue, type TechFacts, type TaskFacts, type Span } from "@shared/field_service/logic";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { workingIntervals } from "@shared/sla/calendar";
import { localInstant } from "@shared/sla/calendar";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, addLinkIn, createIn, get, isSystemCtx, list, orgTz, transitionIn, updateIn, validationError } from "../../engine";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { BOOKED, calendarFor, dispatches, fsmConfig, ids, isUuid, liveRow, liveRows, mayWriteRecord, msOf, sysOf, todayOf, TASK_OPEN, type Row } from "./common";

const DAY = 86_400_000;

/** The instants of a local day (00:00 to 24:00 in the organisation's zone). */
function dayBounds(ctx: Ctx, day: string): Span {
  const tz = orgTz(ctx);
  return { start: localInstant(day, 0, tz), end: localInstant(day, 24 * 60, tz) };
}

const facts = (t: Row, tasks: Row[], day: Span, cal: Awaited<ReturnType<typeof calendarFor>>, slot: Span | null): TechFacts => {
  const mine = tasks.filter((x) => x.technician_id === t.user_id && BOOKED.includes(String(x.state)));
  const busy = mine.map((x) => ({ start: msOf(x.scheduled_start) ?? 0, end: msOf(x.scheduled_end) ?? (msOf(x.scheduled_start) ?? 0) + 3_600_000 })).filter((s) => s.start < day.end && s.end > day.start);
  const onShift = slot && cal ? workingIntervals(cal, slot.start, slot.end).reduce((n, [a, b]) => n + (b - a), 0) >= slot.end - slot.start : null;
  return {
    user_id: String(t.user_id), name: String(t.name ?? ""), territories: ids(t.territories), skills: parseSkills(t.skills), available: t.available !== false, active: t.active !== false,
    contractor: !!t.contractor, max_tasks_per_day: Number(t.max_tasks_per_day ?? 6), day_tasks: busy.length, busy,
    origin: toPoint(t.last_lat, t.last_lng) ?? toPoint(t.home_lat, t.home_lng), on_shift: onShift,
  };
};

/** The dispatch board of a day: technicians (lanes) with shift and visits, the unassigned queue and clashes. */
export async function dispatchBoard(ctx: Ctx, input: { day?: string | null; territory?: string | null }): Promise<Row> {
  const day = input.day && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : todayOf(ctx);
  const span = dayBounds(ctx, day);
  const techFilter: Row[] = [{ f: "active", op: "eq", v: true }];
  if (isUuid(input.territory)) techFilter.push({ f: "territories", op: "eq", v: input.territory });
  const techs = (await list(ctx, "technician", { filter: { and: techFilter } as never, size: 200, sort: "name" })).rows;
  const tasks = await list(ctx, "wo_task", {
    filter: { and: [{ f: "scheduled_start", op: "lt", v: new Date(span.end).toISOString() }, { f: "scheduled_end", op: "gt", v: new Date(span.start).toISOString() }, { f: "state", op: "nin", v: ["cancelled"] }] },
    size: 500, sort: "scheduled_start", fields: ["number", "short_description", "state", "priority", "technician_id", "scheduled_start", "scheduled_end", "work_order_id", "territory_id", "required_skills", "sla_due", "window_start", "window_end"],
  });
  const queue = await list(ctx, "wo_task", { filter: { and: [{ f: "state", op: "eq", v: "pending_dispatch" }, ...(isUuid(input.territory) ? [{ f: "territory_id", op: "eq", v: input.territory }] : [])] } as never, size: 200, sort: "priority,sla_due", fields: ["number", "short_description", "priority", "required_skills", "est_work_minutes", "window_start", "window_end", "sla_due", "territory_id", "work_order_id"] });
  const lanes: Row[] = [];
  for (const t of techs) {
    const cal = await calendarFor(ctx.db, ctx, t.calendar_id);
    const shift = cal ? workingIntervals(cal, span.start, span.end).map(([a, b]) => ({ start: new Date(a).toISOString(), end: new Date(b).toISOString() })) : [{ start: new Date(span.start).toISOString(), end: new Date(span.end).toISOString() }];
    const mine = tasks.rows.filter((x) => x.technician_id === t.user_id);
    lanes.push({
      user_id: t.user_id, name: t.name, skills: t.skill_tags ?? [], contractor: !!t.contractor, available: t.available !== false, max: Number(t.max_tasks_per_day ?? 6), shift, tasks: mine,
      clashes: clashes(mine.map((x) => ({ id: String(x.id), start: msOf(x.scheduled_start), end: msOf(x.scheduled_end) }))),
    });
  }
  return { day, from: new Date(span.start).toISOString(), to: new Date(span.end).toISOString(), lanes, queue: queue.rows, display: { ...tasks.display, ...queue.display }, dispatcher: await dispatches(ctx.db, ctx) };
}

async function taskFacts(ctx: Ctx, task: Row, slot: Span | null): Promise<TaskFacts> {
  return { required_skills: (task.required_skills as string[]) ?? [], territory_id: (task.territory_id as string) ?? null, site: toPoint(task.site_lat, task.site_lng), slot };
}

/** Technicians ranked for a task (feasible first, with Persian reasons). */
export async function candidatesFor(ctx: Ctx, taskId: string, start?: string | null): Promise<Row[]> {
  const { row: task } = await get(ctx, "wo_task", taskId);
  const sys = sysOf(ctx);
  const startMs = msOf(start ?? task.scheduled_start ?? task.window_start) ?? Date.now();
  const slot = { start: startMs, end: startMs + Number(task.est_work_minutes ?? 60) * 60_000 };
  const day = dayBounds(ctx, todayOf(ctx, startMs));
  const techs = await liveRows(ctx.db, sys, "technician", { f: "active", op: "eq", v: true }, { limit: 500 });
  const tasks = await liveRows(ctx.db, sys, "wo_task", { and: [{ f: "state", op: "in", v: BOOKED }, { f: "scheduled_start", op: "lt", v: new Date(day.end).toISOString() }] }, { limit: 5000 });
  const cfg = await fsmConfig(ctx.db, ctx);
  const tf = await taskFacts(ctx, task, slot);
  const list_: TechFacts[] = [];
  for (const t of techs) list_.push(facts(t, tasks.filter((x) => String(x.id) !== taskId), day, await calendarFor(ctx.db, ctx, t.calendar_id), slot));
  return rankCandidates(tf, list_, { today: todayOf(ctx), speed: cfg.travel_speed_kmh, roadFactor: cfg.road_factor }).map((c) => ({ ...c, name: techs.find((t) => t.user_id === c.user_id)?.name ?? null }));
}

/**
 * Assign a task to a technician at a start (the board's drop): the caller must be able to change the task; the
 * assignment is refused when it is infeasible unless a dispatcher overrides; the answer carries the warnings.
 */
export async function assignTask(ctx: Ctx, taskId: string, input: { technician_id: string; start?: string | null; force?: boolean }): Promise<Row> {
  const { row: task } = await get(ctx, "wo_task", taskId);
  if (!TASK_OPEN.includes(String(task.state))) throw bad("این وظیفه دیگر جابه‌جا نمی‌شود");
  const start = msOf(input.start ?? task.scheduled_start ?? task.window_start) ?? Date.now();
  const ranked = await candidatesFor(ctx, taskId, new Date(start).toISOString());
  const me = ranked.find((c) => c.user_id === input.technician_id);
  if (!me) throw validationError({ technician_id: "تکنسین پیدا نشد" });
  const warnings: string[] = [...(me.blockers as string[])];
  if (warnings.length && !(input.force && (await dispatches(ctx.db, ctx)))) return { assigned: false, warnings };
  const end = start + Number(task.est_work_minutes ?? 60) * 60_000;
  const row = await ctx.write(async (tx) => {
    let r = await updateIn(tx, ctx, "wo_task", taskId, { technician_id: input.technician_id, scheduled_start: new Date(start).toISOString(), scheduled_end: new Date(end).toISOString() }, { version: Number(task.version) });
    if (r.state === "pending_dispatch") r = await transitionIn(tx, ctx, "wo_task", taskId, "assigned", {});
    const wo = await liveRow(tx, sysOf(ctx), "work_order", r.work_order_id);
    if (wo && ["draft", "qualification"].includes(String(wo.state))) await transitionIn(tx, sysOf(ctx), "work_order", String(wo.id), "scheduled", {}, { trusted: true });
    return r;
  });
  return { assigned: true, warnings, task: row, score: me.score };
}

/** Immediate auto-assignment (FSM-006): the best feasible technician now (or at the task's window). */
export async function autoAssign(ctx: Ctx, taskId: string): Promise<Row> {
  const ranked = await candidatesFor(ctx, taskId);
  const best = ranked.find((c) => c.feasible);
  if (!best) return { assigned: false, warnings: ["تکنسین شایسته‌ای در دسترس نیست"], candidates: ranked.slice(0, 5) };
  return assignTask(ctx, taskId, { technician_id: String(best.user_id) });
}

/** A work order for a record (FSM-001): copies what the visit needs and links the two; the caller files it. */
export async function workOrderFrom(ctx: Ctx, table: string, id: string, input: Row = {}): Promise<Row> {
  const def = tableDef(table);
  if (!def || def.virtual) throw notFound("این نوع رکورد در سامانه نیست");
  const { row: src } = await get(ctx, table, id);
  return ctx.write(async (tx) => {
    const sys = sysOf(ctx);
    const contactUser = src.requested_for ?? src.caller_id ?? null;
    const values: Row = {
      short_description: String(input.short_description ?? `کار در محل: ${src.short_description ?? src.name ?? src.number ?? ""}`).slice(0, 200),
      description: src.description ?? null, symptoms: input.symptoms ?? src.description ?? null, priority: src.priority ?? "3", location_id: src.location_id ?? null, ci_id: src.ci_id ?? null,
      account_id: src.account_id ?? null, contact_id: src.contact_id ?? null, caller_id: contactUser, template_id: input.template_id ?? null,
      work_type: input.work_type ?? (table === "facility_request" ? "maintenance" : "repair"), site_address: input.site_address ?? null, site_lat: input.site_lat ?? null, site_lng: input.site_lng ?? null,
      parent_table: table, parent_record: id, parent_number: src.number ?? null,
    };
    const wo = await createIn(tx, ctx, "work_order", values, { trusted: true });
    if (def.features?.links) await addLinkIn(tx, sys, "work_order", String(wo.id), { kind: "field_work", table, id });
    return { id: String(wo.id), number: wo.number ?? null };
  });
}

// ----- the technician's day ---------------------------------------------------------------------------------------------

/** My visits of a day in route order, with navigation links, parts and checklists (FSM-017/008). */
export async function myDay(ctx: Ctx, day?: string | null): Promise<Row> {
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : todayOf(ctx);
  const span = dayBounds(ctx, d);
  const res = await list(ctx, "wo_task", {
    filter: { and: [{ f: "technician_id", op: "is_me" }, { or: [{ and: [{ f: "scheduled_start", op: "gte", v: new Date(span.start).toISOString() }, { f: "scheduled_start", op: "lt", v: new Date(span.end).toISOString() }] }, { f: "state", op: "in", v: ["en_route", "on_site", "on_hold", "pending_parts"] }] }] },
    size: 100, sort: "scheduled_start",
  });
  const sys = sysOf(ctx);
  const cfg = await fsmConfig(ctx.db, ctx);
  const [me] = await liveRows(ctx.db, sys, "technician", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
  const origin = toPoint(me?.last_lat, me?.last_lng) ?? toPoint(me?.home_lat, me?.home_lng);
  const visits = res.rows.filter((t) => !["closed", "cancelled"].includes(String(t.state)));
  const route = routeOrder(origin, visits.map((t) => ({ id: String(t.id), point: toPoint(t.site_lat, t.site_lng) })), { speed: cfg.travel_speed_kmh, roadFactor: cfg.road_factor });
  const byId = new Map(res.rows.map((t) => [String(t.id), t]));
  const out: Row[] = [];
  for (const id of route.order) {
    const t = byId.get(id)!;
    const wo = await get(ctx, "work_order", String(t.work_order_id)).then((r) => r.row).catch(() => null);
    const parts = await list(ctx, "parts_requirement", { filter: { f: "wo_task_id", op: "eq", v: id }, size: 50 }).then((r) => r.rows).catch(() => []);
    const p = toPoint(t.site_lat, t.site_lng);
    out.push({ task: t, work_order: wo ? { id: wo.id, number: wo.number, site_address: wo.site_address ?? null, access_notes: wo.access_notes ?? null, symptoms: wo.symptoms ?? null, parent_number: wo.parent_number ?? null } : null, parts, nav: p ? mapLink(cfg.map_provider, p) : null, leg: route.legs.find((l) => l.id === id) ?? null });
  }
  return { day: d, visits: out, total_km: route.total_km, total_minutes: route.total_minutes, display: res.display, map_provider: cfg.map_provider };
}

async function myTask(ctx: Ctx, taskId: string): Promise<Row> {
  const { row } = await get(ctx, "wo_task", taskId);
  if (row.technician_id !== ctx.user.id && !(await dispatches(ctx.db, ctx))) throw forbidden("این وظیفه به شما سپرده نشده است");
  return row;
}

/** Remember the technician's position (dispatch sees it; it is cleared after the retention days). */
async function rememberPosition(tx: Tx, ctx: Ctx, lat: unknown, lng: unknown): Promise<void> {
  const p = toPoint(lat, lng);
  if (!p) return;
  const sys = sysOf(ctx);
  const [me] = await liveRows(tx, sys, "technician", { f: "user_id", op: "eq", v: ctx.user.id }, { limit: 1 });
  if (me) await updateIn(tx, sys, "technician", String(me.id), { last_lat: String(p.lat), last_lng: String(p.lng), last_seen_at: new Date().toISOString() }, { trusted: true, keepVersion: true });
}

/** A step of the visit from the technician's phone: accept, depart, arrive (check-in), complete, leave (check-out). */
export async function visitStep(ctx: Ctx, taskId: string, step: string, input: { lat?: unknown; lng?: unknown; resolution?: string | null; checklist_answers?: Record<string, unknown> | null; reason?: string | null }): Promise<Row> {
  const task = await myTask(ctx, taskId);
  return ctx.write(async (tx) => {
    const sys = sysOf(ctx, ctx.user.id);
    const p = toPoint(input.lat, input.lng);
    let r: Row = task;
    switch (step) {
      case "accept":
        r = await transitionIn(tx, ctx, "wo_task", taskId, "accepted", {});
        break;
      case "reject":
        r = await transitionIn(tx, ctx, "wo_task", taskId, "pending_dispatch", { hold_reason: String(input.reason ?? "").trim() || null });
        r = await updateIn(tx, sys, "wo_task", taskId, { technician_id: null, scheduled_start: null, scheduled_end: null }, { trusted: true });
        break;
      case "depart":
        await rememberPosition(tx, ctx, input.lat, input.lng);
        r = await transitionIn(tx, ctx, "wo_task", taskId, "en_route", {});
        break;
      case "arrive":
        await rememberPosition(tx, ctx, input.lat, input.lng);
        if (p) await updateIn(tx, sys, "wo_task", taskId, { check_in_lat: String(p.lat), check_in_lng: String(p.lng) }, { trusted: true, keepVersion: true });
        r = await transitionIn(tx, ctx, "wo_task", taskId, "on_site", {});
        break;
      case "complete": {
        if (input.checklist_answers) await updateIn(tx, ctx, "wo_task", taskId, { checklist_answers: input.checklist_answers }, {});
        r = await transitionIn(tx, ctx, "wo_task", taskId, "work_complete", { resolution: String(input.resolution ?? task.resolution ?? "").trim() || null });
        await updateIn(tx, sys, "wo_task", taskId, { service_report: await serviceReport(tx, ctx, taskId) }, { trusted: true, keepVersion: true });
        break;
      }
      case "leave":
        await rememberPosition(tx, ctx, input.lat, input.lng);
        if (p) r = await updateIn(tx, sys, "wo_task", taskId, { check_out_lat: String(p.lat), check_out_lng: String(p.lng) }, { trusted: true, keepVersion: true });
        break;
      default:
        throw bad("گام ناشناخته است");
    }
    return { task: r };
  });
}

/**
 * The customer's sign-off (FSM-023): the signer's name and the signature image (an attachment of the task) — once,
 * on work that is done (the customer signs the work and the report they see; afterwards the work's description and
 * checklist stay as signed, see the task hook).
 */
export async function signOff(ctx: Ctx, taskId: string, input: { signer_name: string; attachment_id?: string | null }): Promise<Row> {
  await myTask(ctx, taskId);
  const name = String(input.signer_name ?? "").trim();
  if (name.length < 3) throw validationError({ signer_name: "نام امضاکننده را کامل بنویسید" });
  return ctx.write(async (tx) => {
    const sys = sysOf(ctx, ctx.user.id);
    const task = await liveRow(tx, sysOf(ctx), "wo_task", taskId);
    if (!task) throw notFound("وظیفه پیدا نشد");
    if (task.state !== "work_complete") throw conflict("امضای مشتری پس از «کار انجام شد» گرفته می‌شود");
    if (task.signed_at) throw conflict("مشتری این کار را پیش‌تر امضا کرده است؛ امضا عوض نمی‌شود");
    if (input.attachment_id) {
      const a = await tx.one<{ id: string }>(`select id from sm_attachments where org_id = $1 and id = $2 and table_key = 'wo_task' and record_id = $3 and deleted_at is null`, [ctx.org.id, input.attachment_id, taskId]);
      if (!a) throw validationError({ attachment_id: "تصویر امضا پیوست این وظیفه نیست" });
    }
    await updateIn(tx, sys, "wo_task", taskId, { signer_name: name, signed_at: new Date().toISOString(), signature_id: input.attachment_id ?? null }, { trusted: true });
    const report = await serviceReport(tx, ctx, taskId);
    const row = await updateIn(tx, sys, "wo_task", taskId, { service_report: report }, { trusted: true, keepVersion: true });
    return { task: row, report };
  });
}

/** The service report of a visit (Markdown, RTL, Jalali): work done, parts, time, sign-off. */
export async function serviceReport(tx: Tx, ctx: Ctx, taskId: string): Promise<string> {
  const sys = sysOf(ctx);
  const t = await liveRow(tx, sys, "wo_task", taskId);
  if (!t) return "";
  const wo = await liveRow(tx, sys, "work_order", t.work_order_id);
  const parts = await liveRows(tx, sys, "parts_requirement", { and: [{ f: "wo_task_id", op: "eq", v: taskId }, { f: "state", op: "eq", v: "consumed" }] }, { limit: 100 });
  const tz = orgTz(sys);
  const lines = [
    `## گزارش خدمت ${t.number ?? ""}`,
    `- دستور کار: ${wo?.number ?? ""} — ${wo?.short_description ?? ""}`,
    wo?.site_address ? `- نشانی: ${wo.site_address}` : "",
    t.arrived_at ? `- رسیدن: ${formatJalaliDateTime(String(t.arrived_at), tz)}` : "",
    t.completed_at ? `- پایان کار: ${formatJalaliDateTime(String(t.completed_at), tz)}` : "",
    t.work_minutes !== null && t.work_minutes !== undefined ? `- زمان کار: ${t.work_minutes} دقیقه` : "",
    "",
    "### کار انجام‌شده",
    String(t.resolution ?? "—"),
    parts.length ? "\n### قطعه‌های مصرف‌شده" : "",
    ...parts.map((p) => `- ${p.part_name} × ${p.quantity}${p.serial_no ? ` (سریال ${p.serial_no})` : ""}`),
    t.signer_name ? `\n**تأیید مشتری:** ${t.signer_name}${t.signed_at ? ` — ${formatJalaliDateTime(String(t.signed_at), tz)}` : ""}` : "",
  ];
  return lines.filter((x) => x !== "").join("\n");
}

// ----- appointment booking (FSM-014) -----------------------------------------------------------------------------------

async function bookingAllowed(ctx: Ctx, wo: Row): Promise<boolean> {
  if (isSystemCtx(ctx)) return true;
  if ([wo.caller_id, wo.requested_for].includes(ctx.user.id)) return true;
  return mayWriteRecord(ctx.db, ctx, "work_order", wo.id);
}

/** Free visit slots of a work order's next visit (capacity only — no technician, no place). */
export async function appointmentSlots(ctx: Ctx, woId: string, input: { from?: string | null; days?: number | null }): Promise<Row> {
  const sys = sysOf(ctx);
  const wo = await liveRow(ctx.db, sys, "work_order", woId);
  if (!wo || !(await bookingAllowed(ctx, wo))) throw notFound("دستور کار پیدا نشد");
  const [task] = await liveRows(ctx.db, sys, "wo_task", { and: [{ f: "work_order_id", op: "eq", v: woId }, { f: "state", op: "in", v: ["pending_dispatch", "assigned", "accepted"] }] }, { order: "t.created_at", limit: 1 });
  if (!task) return { slots: [] };
  const from = Math.max(Date.now() + 2 * 3_600_000, msOf(input.from) ?? 0);
  const to = from + Math.min(14, Math.max(1, Number(input.days ?? 5))) * DAY;
  const techs = (await liveRows(ctx.db, sys, "technician", { and: [{ f: "active", op: "eq", v: true }, { f: "available", op: "eq", v: true }] }, { limit: 500 })).filter((t) => !wo.territory_id || !((t.territories as string[]) ?? []).length || ((t.territories as string[]) ?? []).includes(String(wo.territory_id)));
  const booked = await liveRows(ctx.db, sys, "wo_task", { and: [{ f: "state", op: "in", v: BOOKED }, { f: "scheduled_start", op: "lt", v: new Date(to).toISOString() }, { f: "scheduled_end", op: "gt", v: new Date(from).toISOString() }] }, { limit: 5000 });
  const today = todayOf(ctx);
  const people: { working: Span[]; busy: Span[] }[] = [];
  for (const t of techs) {
    const gap = (task.required_skills as string[] | undefined)?.length ? scoreCandidate({ required_skills: (task.required_skills as string[]) ?? [], site: null, slot: null }, facts(t, [], { start: from, end: to }, null, null), { today }) : null;
    if (gap && gap.blockers.some((b) => b.startsWith("مهارت"))) continue;
    const cal = await calendarFor(ctx.db, ctx, t.calendar_id);
    const working = cal ? workingIntervals(cal, from, to).map(([a, b]) => ({ start: a, end: b })) : [{ start: from, end: to }];
    const busy = booked.filter((b) => b.technician_id === t.user_id).map((b) => ({ start: msOf(b.scheduled_start) ?? 0, end: msOf(b.scheduled_end) ?? 0 }));
    people.push({ working, busy });
  }
  const slots = freeSlots(people, { from, to, duration: Number(task.est_work_minutes ?? 60), buffer: Number(task.est_travel_minutes ?? 30) || 30, step: 60, max: 30 });
  return { task: { id: task.id, number: task.number }, slots: slots.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), capacity: s.capacity })) };
}

/** Book a slot: the visit's customer window (dispatch then assigns within it). */
export async function bookAppointment(ctx: Ctx, woId: string, input: { start: string }): Promise<Row> {
  const sys = sysOf(ctx);
  const wo = await liveRow(ctx.db, sys, "work_order", woId);
  if (!wo || !(await bookingAllowed(ctx, wo))) throw notFound("دستور کار پیدا نشد");
  const offered = await appointmentSlots(ctx, woId, { from: input.start, days: 1 });
  const slot = (offered.slots as Row[]).find((s) => s.start === new Date(input.start).toISOString());
  if (!slot) throw validationError({ start: "این زمان دیگر آزاد نیست؛ زمان دیگری انتخاب کنید" });
  return ctx.write(async (tx) => {
    const r = await updateIn(tx, sysOf(ctx, ctx.user.id), "wo_task", String((offered.task as Row).id), { window_start: slot.start, window_end: slot.end }, { trusted: true });
    await addJournalIn(tx, sysOf(ctx, ctx.user.id), tableDef("work_order")!, wo, { kind: "system", body: `نوبت بازدید: ${formatJalaliDateTime(String(slot.start), orgTz(sys))}` }, { trusted: true });
    return { window_start: r.window_start, window_end: r.window_end };
  });
}

// ----- planned maintenance (FSM-026) --------------------------------------------------------------------------------------

/** Generate the due occurrences of every active plan (work orders, or facilities requests), idempotently. */
export async function generateMaintenanceIn(tx: Tx, ctx: Ctx, today = todayOf(ctx)): Promise<number> {
  const sys = sysOf(ctx);
  const plans = await liveRows(tx, sys, "maintenance_plan", { f: "status", op: "eq", v: "active" }, { limit: 2000 });
  let made = 0;
  for (const p of plans) {
    const dues = dueOccurrences({ next_due: String(p.next_due), every_n: Number(p.every_n ?? 1), interval_unit: String(p.interval_unit ?? "month"), lead_days: Number(p.lead_days ?? 7), horizon: Number(p.horizon ?? 1) }, today);
    if (!dues.length) continue;
    for (const due of dues) {
      if (p.last_generated_due && String(p.last_generated_due) >= due) continue;
      const title = `${p.name} — ${formatJalali(due)}`.slice(0, 200);
      if (p.generates === "facility_request" && tableDef("facility_request")) {
        await createIn(tx, sys, "facility_request", { short_description: title, description: p.description ?? null, request_type: "maintenance", location_id: p.location_id ?? null, preferred_at: `${due}T05:30:00.000Z`, assignment_group_id: p.group_id ?? null }, { trusted: true });
      } else {
        const wo = await createIn(tx, sys, "work_order", {
          short_description: title, description: p.description ?? null, work_type: "maintenance", priority: p.priority ?? "4", ci_id: p.ci_id ?? null, location_id: p.location_id ?? null, account_id: p.account_id ?? null,
          territory_id: p.territory_id ?? null, assignment_group_id: p.group_id ?? null, template_id: p.template_id ?? null, maintenance_plan_id: p.id, due_at: `${due}T12:00:00.000Z`, state: "qualification",
        }, { trusted: true });
        // the first visit waits for the due day's window
        for (const t of await liveRows(tx, sys, "wo_task", { f: "work_order_id", op: "eq", v: wo.id }, { limit: 10 })) {
          await updateIn(tx, sys, "wo_task", String(t.id), { window_start: localIso(ctx, due, 8 * 60), window_end: localIso(ctx, due, 16 * 60) }, { trusted: true });
        }
      }
      made++;
      await updateIn(tx, sys, "maintenance_plan", String(p.id), { last_generated_due: due, next_due: nextDue(due, Number(p.every_n ?? 1), String(p.interval_unit ?? "month")) }, { trusted: true });
    }
  }
  return made;
}

const localIso = (ctx: Ctx, day: string, minutes: number) => new Date(localInstant(day, minutes, orgTz(ctx))).toISOString();

/** Positions older than the retention days are cleared (FSM-019): check-in and check-out points and the last position. */
export async function clearPositionsIn(tx: Tx, ctx: Ctx): Promise<number> {
  const sys = sysOf(ctx);
  const cfg = await fsmConfig(tx, ctx);
  const before = new Date(Date.now() - cfg.location_retention_days * DAY).toISOString();
  let n = 0;
  for (const t of await liveRows(tx, sys, "wo_task", { and: [{ f: "completed_at", op: "lt", v: before }, { or: [{ f: "check_in_lat", op: "nempty" }, { f: "check_out_lat", op: "nempty" }] }] }, { limit: 2000 })) {
    await updateIn(tx, sys, "wo_task", String(t.id), { check_in_lat: null, check_in_lng: null, check_out_lat: null, check_out_lng: null }, { trusted: true, keepVersion: true });
    n++;
  }
  for (const t of await liveRows(tx, sys, "technician", { and: [{ f: "last_seen_at", op: "lt", v: before }] }, { limit: 2000 })) {
    await updateIn(tx, sys, "technician", String(t.id), { last_lat: null, last_lng: null, last_seen_at: null }, { trusted: true, keepVersion: true });
    n++;
  }
  return n;
}

/** Field KPIs of the last 30 days (FSM-030), as the caller reads tasks. */
export async function fieldDashboard(ctx: Ctx): Promise<Row> {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const res = await list(ctx, "wo_task", { filter: { f: "created_at", op: "gte", v: since }, size: 500, fields: ["work_order_id", "state", "visit_no", "created_at", "dispatched_at", "arrived_at", "sla_due", "travel_minutes", "work_minutes", "window_start", "window_end"] });
  const open = await list(ctx, "wo_task", { filter: { f: "state", op: "eq", v: "pending_dispatch" }, size: 1, fields: ["number"] });
  return { ...fieldKpis(res.rows as never), unassigned: open.total ?? 0, sample: res.rows.length };
}
