// Major incidents (catalogue INC-045 … INC-055): the overlay's actions (propose, declare, reject, downgrade), the
// war room's timeline (a projection of the incident's history, communications, child incidents, SLA breaches and
// the events people add by hand or promote from the journal), stakeholder updates with their cadence, and the first
// draft of the post-incident review.
//
// Who may do what: proposing and working the timeline need full write access to the incident (an agent of its group
// or above); declaring, rejecting and downgrading need the `approve` grant of the incident area (major-incident
// managers, team leads for their groups) — asked of the access provider as a transition with
// `roles: { area: "incident", level: "full" }`, so the access model stays the one decision point.
import { uuidv7 } from "@shared/id";
import { formatJalaliDateTime } from "@shared/jalali";
import { stateCategory } from "@shared/model/task";
import type { TableDef, Transition } from "@shared/model/types";
import {
  addWorkingDays, eventProblem, humanDuration, majorActionAllowed, nextUpdateAt, reviewDraft, sortTimeline, storedEvents, TIMELINE_KINDS, type MAJOR_ACTIONS,
  type TimelineItem, type TimelineKind,
} from "@shared/incident/logic";
import { MAJOR_DECLARED, MAJOR_STATES } from "@shared/tables/incident";
import type { BusinessCalendar } from "@shared/sla/calendar";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { access } from "../../access/provider";
import {
  addJournalIn, condEnv, createIn, defFor, get, list, listHistory, listJournal, optionsOf, orgTz, requireReadable, updateIn, type OrgSchema,
} from "../../engine";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { notifyPeople } from "../notify";
import { calendarFor, slaConfig } from "../sla";
import { eqAll, incidentConfig, isUuid, liveRows, sysOf, type Row } from "./common";

export type MajorAction = keyof typeof MAJOR_ACTIONS;

const OVERLAY: Record<MajorAction, string> = { propose: "proposed", declare: "accepted", reject: "rejected", downgrade: "downgraded" };
const ACTION_LABEL: Record<MajorAction, string> = { propose: "پیشنهاد رخداد عمده", declare: "اعلام رخداد عمده", reject: "رد پیشنهاد رخداد عمده", downgrade: "خروج از رخداد عمده" };

const as = (def: TableDef, to: string, label: string, level: "edit" | "full"): Transition => ({ from: "*", to, label, roles: { area: def.area, level } });

/**
 * May the caller work the record as an agent — full write access in the table's area, not only as its requester
 * (asked of the access provider as a transition with `roles: { area, level: "edit" }`)?
 */
export function canWork(ctx: Ctx, def: TableDef, row: Row): boolean {
  return ctx.actor === "system" || access().canTransition(ctx, def, row, as(def, String(row.state ?? ""), "کار روی رکورد", "edit"));
}

/** May the caller take the area's managing decisions on this record (the `approve` grant: major incidents, re-analysis)? */
export function canManageMajor(ctx: Ctx, def: TableDef, row: Row): boolean {
  return ctx.actor === "system" || access().canTransition(ctx, def, row, as(def, String(row.state ?? ""), "تصمیم مدیر", "full"));
}

/** The incident locked for this transaction (404 when the caller may not read it). */
export async function lockIncident(tx: Tx, ctx: Ctx, id: string): Promise<{ def: TableDef; schema: OrgSchema; row: Row }> {
  if (!isUuid(id)) throw notFound("رخداد پیدا نشد");
  const { def, schema } = await defFor(ctx, "incident", tx);
  const env = await condEnv(ctx);
  const row = await requireReadable(ctx, def, id, env, tx, { lock: true });
  delete row.$writable;
  return { def, schema, row };
}

/** A note of the system on an incident (internal), authored by the person who acted. */
export async function workNote(tx: Tx, ctx: Ctx, def: TableDef, row: Row, body: string, data: Record<string, unknown> | null = null): Promise<void> {
  await addJournalIn(tx, sysOf(ctx), def, row, { kind: "system", visibility: "internal", body, data }, { trusted: true, author: ctx.actor === "system" ? null : ctx.user.id });
}

export interface MajorInput {
  reason?: string | null;
  mi_manager_id?: string | null;
  mi_comms_id?: string | null;
  comm_cadence?: number | null;
  bridge_url?: string | null;
  chat_url?: string | null;
  stakeholders?: string[] | null;
}

/** Propose, declare, reject or downgrade a major incident. */
export async function majorAction(ctx: Ctx, id: string, action: MajorAction, input: MajorInput = {}): Promise<Row> {
  const reason = (input.reason ?? "").trim();
  if ((action === "propose" || action === "reject" || action === "downgrade") && !reason) throw bad("دلیل را بنویسید");
  return ctx.write(async (tx) => {
    const { def, row } = await lockIncident(tx, ctx, id);
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این رخداد را ندارید");
    if (action !== "propose" && !canManageMajor(ctx, def, row)) throw forbidden("اعلام، رد یا خروج رخداد عمده با مدیر رخداد عمده است");
    if (!majorActionAllowed(action, row.major_state)) throw conflict(`«${ACTION_LABEL[action]}» در وضعیت کنونی این رخداد ممکن نیست`);
    const cat = stateCategory(def.states, row.state);
    if ((action === "propose" || action === "declare") && cat && !["new", "active", "waiting"].includes(cat)) throw conflict("رخداد حل‌شده یا بسته را نمی‌توان عمده اعلام کرد");
    const data: Row = { major_state: OVERLAY[action], mi_reason: reason || null };
    if (action === "declare") {
      const me = ctx.actor === "system" ? null : ctx.user.id;
      data.mi_manager_id = input.mi_manager_id ?? row.mi_manager_id ?? me;
      if (input.mi_comms_id !== undefined) data.mi_comms_id = input.mi_comms_id;
      if (input.comm_cadence !== undefined && input.comm_cadence !== null) data.comm_cadence = input.comm_cadence;
      if (input.bridge_url !== undefined) data.bridge_url = input.bridge_url;
      if (input.chat_url !== undefined) data.chat_url = input.chat_url;
      if (input.stakeholders) data.stakeholders = [...new Set([...(row.stakeholders ?? []), ...input.stakeholders])];
    }
    const next = await updateIn(tx, ctx, "incident", id, data, { trusted: true });
    await workNote(tx, ctx, def, next, `${ACTION_LABEL[action]}${reason ? `: ${reason}` : ""}`, { major: action });
    return next;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The timeline

export interface EventInput {
  at?: string | null;
  kind: TimelineKind;
  title: string;
  body?: string | null;
  key?: boolean;
  entry_id?: string | null;
}

const MAX_EVENTS = 500;

/** Add an event to the incident's timeline (back-dating allowed, not into the future). */
export async function addTimelineEvent(ctx: Ctx, id: string, input: EventInput): Promise<TimelineItem> {
  const problem = eventProblem(input);
  if (problem) throw bad(problem);
  return ctx.write(async (tx) => {
    const { def, row } = await lockIncident(tx, ctx, id);
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این رخداد را ندارید");
    const events = storedEvents(row.timeline);
    if (events.length >= MAX_EVENTS) throw bad(`خط زمانی حداکثر ${MAX_EVENTS} رویداد دستی دارد`);
    if (input.entry_id && events.some((e) => e.entry_id === input.entry_id)) throw conflict("این یادداشت پیش‌تر به خط زمانی افزوده شده است");
    const ev = {
      id: uuidv7(),
      at: input.at ? new Date(Date.parse(input.at)).toISOString() : new Date().toISOString(),
      kind: input.kind,
      title: input.title.trim(),
      body: input.body?.trim() || null,
      by: ctx.actor === "system" ? null : ctx.user.id,
      entry_id: input.entry_id ?? null,
      key: input.key !== false,
    };
    await updateIn(tx, ctx, "incident", id, { timeline: [...events, ev] }, { trusted: true, keepVersion: true });
    return { ...ev, source: "manual", removable: true };
  });
}

/** Change (key flag) or remove a manual event of the timeline. */
export async function changeTimelineEvent(ctx: Ctx, id: string, eventId: string, change: { key?: boolean; remove?: boolean }): Promise<{ ok: true }> {
  return ctx.write(async (tx) => {
    const { def, row } = await lockIncident(tx, ctx, id);
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این رخداد را ندارید");
    const events = storedEvents(row.timeline);
    const at = events.findIndex((e) => e.id === eventId);
    if (at < 0) throw notFound("این رویداد در خط زمانی نیست");
    if (change.remove) events.splice(at, 1);
    else if (change.key !== undefined) events[at] = { ...events[at], key: !!change.key };
    await updateIn(tx, ctx, "incident", id, { timeline: events }, { trusted: true, keepVersion: true });
    return { ok: true as const };
  });
}

/** Put a journal entry of the incident on its timeline as a key event. */
export async function promoteEntry(ctx: Ctx, id: string, entryId: string, kind: TimelineKind = "note"): Promise<TimelineItem> {
  const j = await listJournal(ctx, "incident", id, { limit: 500 });
  const e = j.entries.find((x) => x.id === entryId);
  if (!e) throw notFound("این یادداشت پیدا نشد");
  const first = e.body.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "یادداشت";
  return addTimelineEvent(ctx, id, { at: e.created_at, kind, title: first.slice(0, 300), body: e.body.slice(0, 4000), key: true, entry_id: e.id });
}

/** Labels of a choice field's values. */
function choiceLabel(def: TableDef, schema: Pick<OrgSchema, "choices">, field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "خالی";
  const f = def.fields.find((x) => x.name === field);
  return (f ? optionsOf(f, schema).find((o) => o.value === String(v))?.label : undefined) ?? String(v);
}

const DECLARATIONS: Record<string, string> = {
  candidate: "نامزد رخداد عمده شد",
  proposed: "رخداد عمده پیشنهاد شد",
  accepted: "رخداد عمده اعلام شد",
  rejected: "پیشنهاد رخداد عمده رد شد",
  downgraded: "از رخداد عمده خارج شد",
  resolved: "رخداد عمده حل شد",
  pir_done: "بازبینی پس از رخداد منتشر شد",
};

export const AUDIENCES = {
  stakeholders: "ذی‌نفعان",
  affected: "کاربران متأثر",
  team: "تیم رسیدگی",
} as const;
export type Audience = keyof typeof AUDIENCES;

/** The timeline of an incident as the caller may see it: history, communications, children, breaches and manual events. */
export async function timelineOf(ctx: Ctx, id: string): Promise<{ items: TimelineItem[]; display: Record<string, string> }> {
  const r = await get(ctx, "incident", id);
  const { def, schema } = await defFor(ctx, "incident");
  const row = r.row;
  const display: Record<string, string> = { ...r.display };
  const name = (v: unknown) => (typeof v === "string" && v ? display[v] ?? "محدود" : "خالی");
  const items: TimelineItem[] = [];
  if (row.detected_at) items.push({ id: "detected", at: row.detected_at, kind: "detection", title: "بروز یا تشخیص اختلال", source: "record" });
  if (row.opened_at) items.push({ id: "opened", at: row.opened_at, kind: "state", title: "ثبت رخداد", source: "record" });

  const h = await listHistory(ctx, "incident", id, { limit: 1000 }).catch(() => ({ entries: [], display: {} as Record<string, string> }));
  Object.assign(display, h.display);
  for (const e of h.entries) {
    let kind: TimelineKind | null = null;
    let title = "";
    switch (e.field) {
      case "state":
        if (e.old === null || e.old === undefined) continue;
        kind = "state";
        title = `وضعیت: ${choiceLabel(def, schema, "state", e.old)} ← ${choiceLabel(def, schema, "state", e.new)}`;
        break;
      case "priority":
        if (e.old === null || e.old === undefined) continue;
        kind = "priority";
        title = `اولویت: ${choiceLabel(def, schema, "priority", e.old)} ← ${choiceLabel(def, schema, "priority", e.new)}`;
        break;
      case "major_state":
        if (!e.new || !DECLARATIONS[String(e.new)]) continue;
        kind = "declaration";
        title = DECLARATIONS[String(e.new)];
        break;
      case "assignment_group_id":
        if (!e.new) continue;
        kind = "assignment";
        title = `ارجاع به گروه ${name(e.new)}`;
        break;
      case "assigned_to":
        if (!e.new) continue;
        kind = "assignment";
        title = `کارشناس: ${name(e.new)}`;
        break;
      case "mi_manager_id":
        if (!e.new) continue;
        kind = "role";
        title = `مدیر رخداد عمده: ${name(e.new)}`;
        break;
      case "mi_comms_id":
        if (!e.new) continue;
        kind = "role";
        title = `مسئول اطلاع‌رسانی: ${name(e.new)}`;
        break;
      case "bridge_url":
        if (!e.new) continue;
        kind = "bridge";
        title = e.old ? "پیوند جلسهٔ هماهنگی تغییر کرد" : "جلسهٔ هماهنگی تشکیل شد";
        break;
      default:
        continue;
    }
    // changes made by the creating write sort after the creation itself
    const at = row.opened_at && Date.parse(e.at) < Date.parse(row.opened_at) ? row.opened_at : e.at;
    items.push({ id: `h:${e.id}`, at, kind, title, by: e.actor, source: "history", key: kind === "declaration" || kind === "state" });
  }

  const j = await listJournal(ctx, "incident", id, { limit: 500 }).catch(() => ({ entries: [], display: {} as Record<string, string> }));
  Object.assign(display, j.display);
  const promoted = new Set(storedEvents(row.timeline).map((e) => e.entry_id).filter(Boolean));
  for (const e of j.entries) {
    const comm = e.data && typeof e.data === "object" ? (e.data as { comm?: { audience?: string; subject?: string } }).comm : undefined;
    if (!comm || promoted.has(e.id)) continue;
    const who = AUDIENCES[(comm.audience ?? "") as Audience] ?? "";
    items.push({ id: `j:${e.id}`, at: e.created_at, kind: "communication", title: `اطلاع‌رسانی${who ? ` به ${who}` : ""}: ${comm.subject ?? ""}`.trim(), body: e.body.slice(0, 1000), by: e.author, source: "journal", key: true });
  }

  const kids = await list(ctx, "incident", { filter: { f: "parent_id", op: "eq", v: id }, fields: ["number", "short_description", "opened_at"], size: 200, total: false, sort: "opened_at" }).catch(() => null);
  for (const k of kids?.rows ?? []) {
    display[k.id] = `${k.number ?? ""} — ${k.short_description ?? ""}`;
    items.push({ id: `c:${k.id}`, at: k.opened_at ?? row.opened_at, kind: "child", title: `رخداد فرزند ${k.number ?? ""}: ${k.short_description ?? ""}`, source: "child", ref: { table: "incident", id: k.id, number: k.number ?? null } });
  }

  const breaches = await list(ctx, "task_sla", { filter: { and: [{ f: "table_key", op: "eq", v: "incident" }, { f: "record_id", op: "eq", v: id }, { f: "breached", op: "eq", v: true }] }, fields: ["name", "breached_at"], size: 20, total: false }).catch(() => null);
  for (const b of breaches?.rows ?? []) if (b.breached_at) items.push({ id: `s:${b.id}`, at: b.breached_at, kind: "sla", title: `نقض توافق «${b.name}»`, source: "sla", key: true });

  for (const e of storedEvents(row.timeline)) items.push({ ...e, source: "manual", removable: true });
  return { items: sortTimeline(items), display };
}

// ---------------------------------------------------------------------------------------------------------------
// Stakeholder updates

export interface UpdateInput {
  audience: Audience;
  subject: string;
  body: string;
  channels?: ("in_app" | "email" | "sms")[];
}

/** People of an audience (deduplicated; the sender left out). */
async function audienceOf(q: Queryable, ctx: Ctx, row: Row, audience: Audience, cfg: { propagate_comments: boolean }): Promise<string[]> {
  const sys = sysOf(ctx);
  const out = new Set<string>();
  const add = (...xs: unknown[]) => {
    for (const x of xs) if (isUuid(x)) out.add(x.toLowerCase());
  };
  if (audience === "stakeholders") add(...(row.stakeholders ?? []), row.mi_manager_id, row.mi_comms_id);
  if (audience === "affected") {
    add(...(row.affected_users ?? []));
    if (!cfg.propagate_comments) {
      for (const c of await liveRows(q, sys, "incident", { and: [{ f: "parent_id", op: "eq", v: row.id }, { f: "active", op: "eq", v: true }] }, { limit: 500 })) {
        add(c.caller_id, c.requested_for, ...(c.affected_users ?? []));
      }
    }
  }
  if (audience === "team") {
    add(row.assigned_to, row.mi_manager_id, row.mi_comms_id, ...(row.watch_list ?? []));
    if (row.assignment_group_id) for (const m of await liveRows(q, sys, "group_member", eqAll({ group_id: row.assignment_group_id }), { limit: 500 })) add(m.user_id);
  }
  if (ctx.actor !== "system") out.delete(ctx.user.id);
  return [...out];
}

/** Send a stakeholder update: logged on the incident, delivered through the notification service, cadence restarted. */
export async function sendUpdate(ctx: Ctx, id: string, input: UpdateInput): Promise<{ recipients: number }> {
  const subject = (input.subject ?? "").trim();
  const body = (input.body ?? "").trim();
  if (!subject || subject.length > 200) throw bad("موضوع اطلاع‌رسانی را بنویسید (حداکثر ۲۰۰ نویسه)");
  if (!body || body.length > 20_000) throw bad("متن اطلاع‌رسانی را بنویسید (حداکثر ۲۰٬۰۰۰ نویسه)");
  if (!(input.audience in AUDIENCES)) throw bad("مخاطب اطلاع‌رسانی معتبر نیست");
  const channels = [...new Set(input.channels?.length ? input.channels : ["in_app", "email"])].filter((c) => c === "in_app" || c === "email" || c === "sms");
  return ctx.write(async (tx) => {
    const { def, row } = await lockIncident(tx, ctx, id);
    if (!canWork(ctx, def, row)) throw forbidden("اجازهٔ کار روی این رخداد را ندارید");
    const cfg = await incidentConfig(tx, ctx);
    const users = await audienceOf(tx, ctx, row, input.audience, cfg);
    const comm = { audience: input.audience, subject, channels, recipients: users.length };
    const author = ctx.actor === "system" ? null : ctx.user.id;
    if (input.audience === "affected") {
      // a public reply: the requester (and, through propagation, the children's requesters) get it like any reply
      await addJournalIn(tx, ctx, def, row, { kind: "comment", body: `**${subject}**\n\n${body}`, data: { comm } }, { trusted: true, author });
    } else {
      await addJournalIn(tx, sysOf(ctx), def, row, { kind: "system", visibility: "internal", body: `**${subject}**\n\n${body}`, data: { comm } }, { trusted: true, author });
    }
    if (users.length) {
      await notifyPeople(tx, ctx.org.id, {
        table: "incident", id, users, event: "custom", label: "اطلاع‌رسانی رخداد عمده",
        subject: `${subject} — {{record.number}}`, body, short_text: subject, channels, actor: author, source: "اطلاع‌رسانی رخداد",
      });
    }
    const now = new Date().toISOString();
    const stamp: Row = { last_update_at: now, update_warned_at: null };
    if (row.major_state === "accepted") stamp.next_update_at = nextUpdateAt(now, row.comm_cadence);
    await updateIn(tx, ctx, "incident", id, stamp, { trusted: true, keepVersion: true });
    return { recipients: users.length };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The post-incident review

/** The organisation's default working calendar (null: none, then 24 × 7). */
export async function officeCalendar(q: Queryable, ctx: Ctx): Promise<BusinessCalendar | null> {
  const cfg = await slaConfig(q, ctx);
  const cal = cfg.rows.calendar.find((c) => c.is_default && c.active !== false);
  return cal ? calendarFor(q, ctx, cal.id) : null;
}

/** The review of an incident (its first live, not canceled one), or a new draft filled from the incident and its timeline. */
export async function draftReview(ctx: Ctx, id: string): Promise<{ row: Row; created: boolean }> {
  const existing = await list(ctx, "incident_review", { filter: { and: [{ f: "incident_id", op: "eq", v: id }, { f: "state", op: "ne", v: "canceled" }] }, size: 1, total: false });
  if (existing.rows[0]) return { row: existing.rows[0], created: false };
  const tl = await timelineOf(ctx, id);
  const inc = (await get(ctx, "incident", id)).row;
  const tz = orgTz(ctx);
  const kids = await list(ctx, "incident", { filter: { f: "parent_id", op: "eq", v: id }, size: 1, total: true, fields: ["number"] });
  const problem = inc.problem_id ? await get(ctx, "problem", inc.problem_id).catch(() => null) : null;
  const start = Date.parse(inc.detected_at ?? inc.opened_at ?? "");
  const end = Date.parse(inc.resolved_at ?? "");
  const draft = reviewDraft({
    number: inc.number ?? null,
    title: inc.short_description ?? "",
    description: inc.description,
    priority: inc.priority,
    opened_at: inc.opened_at,
    detected_at: inc.detected_at,
    resolved_at: inc.resolved_at,
    mi_declared_at: inc.mi_declared_at,
    business_impact: inc.business_impact,
    close_notes: inc.close_notes,
    workaround: inc.workaround,
    cause_notes: problem?.row.cause_notes ?? null,
    children: kids.total ?? 0,
    affected_users: (inc.affected_users ?? []).length,
    affected_services: [],
    communications: tl.items.filter((x) => x.kind === "communication").length,
    timeline: tl.items.map((x) => ({ when: formatJalaliDateTime(x.at, tz), kind: x.kind, title: x.title, key: x.key })),
    duration: Number.isNaN(start) || Number.isNaN(end) ? null : humanDuration(end - start),
  });
  const cfg = await incidentConfig(ctx.db, ctx);
  const cal = await officeCalendar(ctx.db, ctx);
  const due = new Date(addWorkingDays(cal, Date.now(), cfg.review_due_days)).toISOString();
  const made = await ctx.write(async (tx) => {
    // the incident locked and its reviews looked for again: the automatic draft of a resolved major incident and the
    // manager's «پیش‌نویس بازبینی» at the same moment make one review (the second finds the first)
    await lockIncident(tx, ctx, id);
    const [again] = await liveRows(tx, sysOf(ctx), "incident_review", { and: [{ f: "incident_id", op: "eq", v: id }, { f: "state", op: "ne", v: "canceled" }] }, { limit: 1 });
    if (again) return { id: String(again.id), row: null };
    const row = await createIn(tx, ctx, "incident_review", {
      ...draft,
      incident_id: id,
      review_trigger: MAJOR_DECLARED.includes(String(inc.major_state ?? "")) ? "major" : "manual",
      owner_id: inc.mi_manager_id ?? inc.assigned_to ?? (ctx.actor === "system" ? null : ctx.user.id),
      due_at: due,
    });
    return { id: String(row.id), row };
  });
  if (made.row) return { row: made.row, created: true };
  return { row: (await get(ctx, "incident_review", made.id)).row, created: false };
}

/** Labels of the overlay (for messages). */
export const majorLabel = (v: unknown): string => MAJOR_STATES.find((o) => o.value === v)?.label ?? "";
export { TIMELINE_KINDS };
