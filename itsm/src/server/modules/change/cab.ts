// CAB meetings and the CAB workbench (catalogue CHG-036–039): the next meeting of a CAB from its weekly schedule, the
// agenda built from the changes that wait for it (highest risk first), one-click decisions — approve and reject are the
// person's own approval in the approvals service, so a CAB decision is an approval like any other; defer and «اطلاعات
// بیشتر» are the meeting's — the votes so far, minutes drafted from the decisions and sent to the people of the meeting.
import { agendaOrder, nextMeeting, localParts, riskLabel } from "@shared/change/logic";
import { formatJalali, formatJalaliDateTime } from "@shared/jalali";
import { AGENDA_DECISIONS } from "@shared/tables/change";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { access } from "../../access/provider";
import { addJournalIn, createIn, defFor, emitEvent, get, list, orgTz, transitionIn, updateIn, validationError } from "../../engine";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { activeDelegations, decide, delegatorsOf } from "../sla";
import { changeAi } from "./ai";
import { cabPeople, cycleApprovals, myOpenApproval, tally } from "./authorize";
import { changeConfig, eqAll, iso, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";

const LIVE_MEETING = ["planned", "in_progress"];
const decisionLabel = (v: unknown) => AGENDA_DECISIONS.find((o) => o.value === v)?.label ?? String(v ?? "");

/** The next meeting of a CAB with a weekly schedule (created when it has none still to come). */
export async function ensureNextMeeting(tx: Tx, ctx: Ctx, cab: Row): Promise<Row | null> {
  if (cab.active === false || cab.meeting_weekday === null || cab.meeting_weekday === undefined || cab.meeting_weekday === "" || !cab.meeting_time) return null;
  const sys = sysOf(ctx);
  const now = Date.now();
  const [upcoming] = await liveRows(tx, sys, "cab_meeting", { and: [{ f: "cab_id", op: "eq", v: cab.id }, { f: "state", op: "in", v: LIVE_MEETING }, { f: "ends_at", op: "gt", v: iso(now) }] }, { order: "t.starts_at", limit: 1 });
  if (upcoming) return upcoming;
  const tz = orgTz(ctx);
  const next = nextMeeting(Number(cab.meeting_weekday), String(cab.meeting_time), Number(cab.meeting_minutes) || 60, now, tz);
  if (!next) return null;
  return createIn(tx, sys, "cab_meeting", {
    title: `${cab.name} — ${formatJalali(localParts(next.start, tz).date, { style: "long" })}`,
    cab_id: cab.id, starts_at: iso(next.start), ends_at: iso(next.end), chair_id: cab.manager_id ?? null,
    attendees: await cabPeople(tx, sys, cab), location: cab.location ?? null, conference_url: cab.conference_url ?? null,
  }, { trusted: true });
}

/** Is this CAB the one a change without its own CAB goes to? */
async function isDefaultFor(q: Queryable, ctx: Ctx, cab: Row, change: Row): Promise<boolean> {
  const cfg = await changeConfig(q, ctx);
  if (change.type === "emergency") return cab.id === cfg.emergency_cab_id || (!cfg.emergency_cab_id && cab.kind === "emergency");
  return cab.id === cfg.default_cab_id || (!cfg.default_cab_id && cab.kind === "change");
}

/**
 * Bring a meeting's agenda up to date: changes waiting for this CAB join it (highest risk, then earliest start);
 * pending items of changes decided elsewhere take that outcome. Returns how many were added.
 */
export async function refreshAgenda(tx: Tx, ctx: Ctx, meetingId: string): Promise<{ added: number; synced: number }> {
  const sys = sysOf(ctx);
  const meeting = await liveRow(tx, sys, "cab_meeting", meetingId);
  if (!meeting || !LIVE_MEETING.includes(String(meeting.state))) return { added: 0, synced: 0 };
  const cab = await liveRow(tx, sys, "cab", meeting.cab_id);
  if (!cab) return { added: 0, synced: 0 };
  const cond = cab.agenda_condition ?? { and: [{ f: "state", op: "eq", v: "authorize" }, { f: "cab_required", op: "eq", v: true }] };
  const waiting: Row[] = [];
  for (const c of await liveRows(tx, sys, "change_request", cond, { order: "t.planned_start", limit: 300 })) {
    if (cab.agenda_condition || c.cab_id === cab.id || (!c.cab_id && (await isDefaultFor(tx, sys, cab, c)))) waiting.push(c);
  }
  waiting.sort(agendaOrder);
  const items = await liveRows(tx, sys, "cab_agenda_item", eqAll({ meeting_id: meetingId }), { order: "t.sort_order" });
  const have = new Set(items.filter((i) => i.kind === "authorize").map((i) => String(i.change_id)));
  let order = Math.max(0, ...items.map((i) => Number(i.sort_order) || 0));
  let added = 0;
  for (const c of waiting) {
    if (have.has(String(c.id))) continue;
    order += 10;
    await createIn(tx, sys, "cab_agenda_item", { title: String(c.number ?? ""), meeting_id: meetingId, change_id: c.id, kind: "authorize", sort_order: order, presenter_id: c.change_owner_id ?? null }, { trusted: true });
    if (c.cab_meeting_id !== meetingId) await updateIn(tx, sys, "change_request", String(c.id), { cab_meeting_id: meetingId, ...(c.status_reason ? {} : { status_reason: "awaiting_cab" }) }, { trusted: true, keepVersion: true });
    added++;
  }
  let synced = 0;
  for (const i of items) {
    if (i.kind !== "authorize" || !["pending", "voting"].includes(String(i.decision))) continue;
    const c = await liveRow(tx, sys, "change_request", i.change_id);
    if (!c || c.state === "authorize") continue;
    const decision = c.state === "new" && c.status_reason === "rejected" ? "rejected" : c.state === "canceled" || c.state === "new" ? "reviewed" : "approved";
    await updateIn(tx, sys, "cab_agenda_item", i.id, { decision, decided_at: iso(Date.now()), decision_notes: i.decision_notes ?? "پیش از بررسی در جلسه تعیین تکلیف شد" }, { trusted: true });
    synced++;
  }
  return { added, synced };
}

export type AgendaDecision = "approved" | "rejected" | "deferred" | "info_requested" | "reviewed";

/**
 * A decision on an agenda item. Approve and reject record the caller's own approval of the change (the approvals
 * service decides, with separation of duties and delegation); the item shows the round's outcome or the votes so far.
 * Defer, «اطلاعات بیشتر» and «مرور شد» are the meeting's decisions (whoever may change the meeting).
 */
export async function decideItem(ctx: Ctx, meetingId: string, itemId: string, input: { decision: AgendaDecision; comment?: string | null }): Promise<Row> {
  if (!isUuid(meetingId) || !isUuid(itemId)) throw notFound("این مورد پیدا نشد");
  const comment = typeof input.comment === "string" ? input.comment.trim().slice(0, 4000) : "";
  const meeting = (await get(ctx, "cab_meeting", meetingId)).row;
  if (!LIVE_MEETING.includes(String(meeting.state))) throw conflict("این جلسه بسته شده است");
  const sys = sysOf(ctx);
  const item = await liveRow(ctx.db, sys, "cab_agenda_item", itemId);
  if (!item || item.meeting_id !== meetingId) throw notFound("این مورد در دستور این جلسه نیست");
  const change = (await get(ctx, "change_request", String(item.change_id))).row;
  const me = ctx.user.id;
  if (input.decision === "approved" || input.decision === "rejected") {
    if (input.decision === "rejected" && !comment) throw validationError({ comment: "علت رد را بنویسید" });
    if (item.kind !== "authorize") throw bad("این مورد برای مرور است، نه تأیید");
    const delegators = delegatorsOf(await activeDelegations(ctx.db, ctx, "approvals"), me);
    const mine = await myOpenApproval(ctx.db, ctx, String(change.id), delegators);
    if (!mine) throw forbidden("شما در تأیید این تغییر رأی ندارید؛ تصمیم را تأییدکنندگانِ آن ثبت می‌کنند");
    await decide(ctx, String(mine.id), { decision: input.decision, comment: comment || null });
    const after = (await liveRow(ctx.db, sys, "change_request", String(change.id)))!;
    const votes = tally(await cycleApprovals(ctx.db, sys, after));
    const outcome = after.state === "authorize" ? "voting" : after.state === "new" ? "rejected" : "approved";
    return ctx.write(async (tx) => {
      const stored = await updateIn(tx, sys, "cab_agenda_item", itemId, { decision: outcome, decided_by: me, decided_at: iso(Date.now()), decision_notes: comment || item.decision_notes || null, votes }, { trusted: true });
      if (outcome !== "voting") await updateIn(tx, sys, "change_request", String(change.id), { cab_recommendation: outcome }, { trusted: true, keepVersion: true });
      return stored;
    });
  }
  const { def: mdef } = await defFor(ctx, "cab_meeting");
  if (!access().canWrite(ctx, mdef, meeting)) throw forbidden("ثبت این تصمیم با رئیس جلسه یا مدیر تغییر است");
  if (input.decision === "info_requested" && !comment) throw validationError({ comment: "بنویسید چه اطلاعاتی لازم است" });
  if (!["deferred", "info_requested", "reviewed"].includes(input.decision)) throw bad("تصمیم معتبر نیست");
  return ctx.write(async (tx) => {
    const stored = await updateIn(tx, sys, "cab_agenda_item", itemId, { decision: input.decision, decided_by: me, decided_at: iso(Date.now()), decision_notes: comment || null }, { trusted: true });
    if (item.kind === "authorize") {
      const patch: Row = { cab_recommendation: input.decision };
      if (input.decision === "deferred" && change.state === "authorize") patch.status_reason = "awaiting_cab";
      await updateIn(tx, sys, "change_request", String(change.id), patch, { trusted: true, keepVersion: true });
    }
    if (input.decision === "info_requested") {
      const { def } = await defFor(sys, "change_request", tx);
      await addJournalIn(tx, sysOf(ctx, me), def, change, { kind: "work_note", body: `هیئت CAB اطلاعات بیشتری خواست: ${comment}` }, { trusted: true, author: me });
      const users = [change.change_owner_id, change.caller_id, change.assigned_to].filter((x): x is string => typeof x === "string" && !!x && x !== me);
      await emitEvent(tx, sys, { kind: "record.change.cab_info_requested", table: "change_request", id: String(change.id), number: change.number ?? null, actor: me, data: { users: [...new Set(users)], comment } });
    }
    return stored;
  });
}

/** The workbench: a meeting (the given one, else the one in progress, else the next, else the latest), its agenda and votes. */
export async function workbench(ctx: Ctx, meetingId?: string | null): Promise<Row> {
  const meetings = await list(ctx, "cab_meeting", {
    filter: { f: "state", op: "in", v: ["planned", "in_progress", "completed"] }, sort: "-starts_at", size: 30,
    fields: ["number", "title", "cab_id", "starts_at", "ends_at", "state", "chair_id"], total: false,
  });
  const now = Date.now();
  const rows = meetings.rows;
  const chosen =
    (meetingId ? rows.find((m) => m.id === meetingId) : null) ??
    rows.find((m) => m.state === "in_progress") ??
    [...rows].filter((m) => m.state === "planned" && (msOf(m.ends_at) ?? 0) > now).sort((a, b) => (msOf(a.starts_at) ?? 0) - (msOf(b.starts_at) ?? 0))[0] ??
    rows[0] ?? null;
  if (meetingId && !chosen) throw notFound("این جلسه پیدا نشد");
  if (!chosen) return { meeting: null, meetings: rows, items: [], changes: [], display: meetings.display, votes: {}, can_manage: false };
  const meeting = await get(ctx, "cab_meeting", String(chosen.id));
  const items = await list(ctx, "cab_agenda_item", { filter: { f: "meeting_id", op: "eq", v: chosen.id }, sort: "sort_order", size: 200, fields: ["title", "change_id", "kind", "sort_order", "decision", "decided_by", "decided_at", "decision_notes", "presenter_id"], total: false });
  const ids = items.rows.map((i) => String(i.change_id)).filter(isUuid);
  const changes = ids.length
    ? await list(ctx, "change_request", {
        ids, size: 200, total: false,
        fields: ["number", "short_description", "state", "type", "risk", "risk_score", "planned_start", "planned_end", "conflict_status", "conflict_count", "approval", "assignment_group_id", "assigned_to", "change_owner_id", "in_blackout", "outside_window", "is_late", "cab_recommendation", "outage_expected", "backout_tested"],
      })
    : { rows: [], display: {} };
  const sys = sysOf(ctx);
  const delegators = delegatorsOf(await activeDelegations(ctx.db, ctx, "approvals"), ctx.user.id);
  const votes: Record<string, Row> = {};
  for (const c of changes.rows) {
    const t = tally(await cycleApprovals(ctx.db, sys, c));
    const mine = c.state === "authorize" ? await myOpenApproval(ctx.db, ctx, String(c.id), delegators) : null;
    votes[String(c.id)] = { ...t, my_approval: mine?.id ?? null };
  }
  const { def } = await defFor(ctx, "cab_meeting");
  return {
    meeting: meeting.row, meta: meeting.meta, meetings: rows, items: items.rows, changes: changes.rows,
    display: { ...meetings.display, ...meeting.display, ...items.display, ...changes.display }, votes,
    can_manage: access().canWrite(ctx, def, meeting.row) && LIVE_MEETING.includes(String(meeting.row.state)),
  };
}

/** Minutes drafted from the meeting's decisions (deterministic; the AI layer's draft when it registered one). */
export async function draftMinutes(ctx: Ctx, meetingId: string): Promise<{ text: string; ai: boolean }> {
  const ai = changeAi().draftMinutes;
  if (ai) {
    await get(ctx, "cab_meeting", meetingId);
    return { text: (await ai(ctx, meetingId)).text, ai: true };
  }
  const w = await workbench(ctx, meetingId);
  const m = w.meeting as Row;
  const d = w.display as Record<string, string>;
  const tz = orgTz(ctx);
  const names = (ids: unknown) => (Array.isArray(ids) ? ids.map((x) => d[String(x)] ?? "—") : []);
  const present = names(m.present);
  const invited = names(m.attendees);
  const lines: string[] = [
    `# صورت‌جلسهٔ ${m.title}`,
    "",
    `- زمان: ${formatJalaliDateTime(m.starts_at, tz)} تا ${formatJalaliDateTime(m.ends_at, tz)}`,
    `- رئیس جلسه: ${m.chair_id ? (d[m.chair_id] ?? "—") : "—"}`,
    `- حاضران: ${present.length ? present.join("، ") : "ثبت نشده"} (${present.length} از ${invited.length} دعوت‌شده)`,
    "",
    "## تصمیم‌ها",
    "",
  ];
  const byId = new Map((w.changes as Row[]).map((c) => [String(c.id), c]));
  const actions: string[] = [];
  for (const [i, it] of (w.items as Row[]).entries()) {
    const c = byId.get(String(it.change_id));
    const title = c ? `${c.number} — ${c.short_description}` : "(تغییری که دسترسی دیدنش را ندارید)";
    const v = (w.votes as Record<string, Row>)[String(it.change_id)];
    const votes = v && v.total ? ` (${v.approved} موافق، ${v.rejected} مخالف از ${v.total})` : "";
    lines.push(`${i + 1}. **${title}**${c ? ` — ریسک ${riskLabel(c.risk)}` : ""}: ${decisionLabel(it.decision)}${votes}${it.decision_notes ? ` — ${it.decision_notes}` : ""}`);
    if (it.decision === "info_requested") actions.push(`- ${c?.number ?? "تغییر"}: فرستادن اطلاعات خواسته‌شده (${it.decision_notes ?? ""})`);
    if (it.decision === "deferred") actions.push(`- ${c?.number ?? "تغییر"}: بررسی در جلسهٔ بعد`);
  }
  if (!(w.items as Row[]).length) lines.push("موردی در دستور جلسه نبود.");
  if (actions.length) lines.push("", "## اقدام‌ها", "", ...actions);
  if (m.notes) lines.push("", "## یادداشت‌ها", "", String(m.notes));
  return { text: lines.join("\n"), ai: false };
}

/** End a meeting with its minutes (the meeting's hook sends them to its people). */
export async function completeMeeting(ctx: Ctx, meetingId: string, input: { minutes?: string | null; version?: number }): Promise<Row> {
  return ctx.write(async (tx) => {
    if (typeof input.minutes === "string") await updateIn(tx, ctx, "cab_meeting", meetingId, { minutes: input.minutes.slice(0, 200_000) }, { version: input.version });
    return transitionIn(tx, ctx, "cab_meeting", meetingId, "completed");
  });
}

/** Create the next meeting of a CAB and fill its agenda (whoever may create meetings). */
export async function scheduleNext(ctx: Ctx, cabId: string): Promise<Row> {
  const { def } = await defFor(ctx, "cab_meeting");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ ساخت جلسهٔ CAB را ندارید");
  const cab = (await get(ctx, "cab", cabId)).row;
  return ctx.write(async (tx) => {
    const m = await ensureNextMeeting(tx, ctx, cab);
    if (!m) throw validationError({ meeting_weekday: "روز و ساعت جلسه‌های این هیئت تعیین نشده است" });
    await refreshAgenda(tx, ctx, String(m.id));
    return m;
  });
}
