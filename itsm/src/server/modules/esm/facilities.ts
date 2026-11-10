// Workplace services of facilities (ESM-026…029): reservations of spaces and resources and the visitors' desk.
//   · a reservation copies its space's location and owner group (system columns the access rule reads), is checked
//     against the space (bookable, active, the longest booking) and against the bookings that hold the space; a free
//     space is confirmed at once, a space that needs approval asks its owner group (the approvals service), an
//     occupied one puts the booking on the waiting list; a booking that lets go of the space (cancelled, released,
//     no-show, completed early) promotes the first waiting booking that now fits
//   · recurrence: the first booking of a series creates the following occurrences (each checked on its own)
//   · check-in only within the window; a confirmed booking nobody checked in to is released at its deadline by a job
//   · services ordered with a booking (catering, AV, set-up, cleaning) become a facilities request linked to it
//   · visitors: arrival and departure stamps, lateness, NDA and safety acknowledgements before check-in, the host told
//     at arrival (`record.visit_arrived`)
import { checkInWindow, HOLDS_SPACE, noShowAt, overlaps, seriesOf } from "@shared/esm/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { createIn, emitEvent, isSystemCtx, orgTz, systemCtx, transitionIn, updateIn, validationError, type WriteArgs } from "../../engine";
import { enqueue, type JobContext } from "../../jobs";
import { requestApprovalIn } from "../sla/approvals";
import { onApprovalSettled, settledVerdict } from "../sla";
import { calendarFor, esmConfig, isUuid, liveRow, liveRows, msOf, sysOf, type Row } from "./common";

export const JOB_NO_SHOW = "esm.no_show";

const SERVICE_TYPES: Record<string, string> = { catering: "catering", av: "room_setup", setup: "room_setup", cleaning: "cleaning" };
const SERVICE_LABELS: Record<string, string> = { catering: "پذیرایی", av: "صوت و تصویر", setup: "چیدمان", cleaning: "نظافت" };

/** Bookings of a space that hold an overlapping time (the reservation itself left out). */
async function clashes(tx: Tx, ctx: Ctx, spaceId: string, start: number, end: number, self: unknown): Promise<Row[]> {
  const rows = await liveRows(tx, sysOf(ctx), "reservation", { and: [{ f: "space_id", op: "eq", v: spaceId }, { f: "state", op: "in", v: HOLDS_SPACE }] }, { limit: 500 });
  return rows.filter((r) => String(r.id) !== String(self ?? "") && overlaps({ start, end }, { start: msOf(r.start_at) ?? 0, end: msOf(r.end_at) ?? 0 }));
}

async function reservationBefore(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, prev, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  const space = await liveRow(tx, sys, "space", next.space_id);
  if (!space) throw validationError({ space_id: "فضا پیدا نشد" });
  const start = msOf(next.start_at);
  const end = msOf(next.end_at);
  if (start === null || end === null) return;
  if (end <= start) throw validationError({ end_at: "پایان باید پس از شروع باشد" });
  const timeChanged = op === "create" || ["start_at", "end_at", "space_id"].some((f) => w.changed.has(f));
  if (timeChanged && !w.trusted && !isSystemCtx(ctx)) {
    if (!space.bookable || space.active === false) throw validationError({ space_id: `«${space.name}» رزروپذیر نیست` });
    const maxH = Number(space.max_hours ?? 8);
    if (end - start > maxH * 3_600_000) throw validationError({ end_at: `بیشینهٔ رزرو «${space.name}» ${maxH} ساعت است` });
    if (op === "create" && end < Date.now()) throw validationError({ start_at: "زمان رزرو گذشته است" });
  }
  next.location_id = space.location_id ?? null;
  next.assignment_group_id = space.owner_group_id ?? null;
  if (op === "create") {
    // a free space that needs no approval is confirmed at once; one that needs approval is requested (its owner group
    // is asked); an occupied one waits in line — whatever state a person's request named
    const busy = await clashes(tx, ctx, String(space.id), start, end, null);
    if (busy.length) {
      next.state = "requested";
      const waiting = await liveRows(tx, sys, "reservation", { and: [{ f: "space_id", op: "eq", v: space.id }, { f: "state", op: "eq", v: "requested" }, { f: "waitlist_position", op: "nempty" }] }, { limit: 500 });
      next.waitlist_position = waiting.filter((r) => overlaps({ start, end }, { start: msOf(r.start_at) ?? 0, end: msOf(r.end_at) ?? 0 })).length + 1;
    } else if (!space.requires_approval) {
      next.state = "confirmed";
    } else if (!w.trusted && !isSystemCtx(ctx)) {
      next.state = "requested";
      next.waitlist_position = null;
    }
    return;
  }
  // a confirmed booking whose time moves must still fit
  if (timeChanged && HOLDS_SPACE.includes(String(next.state)) && (await clashes(tx, ctx, String(space.id), start, end, next.id)).length) {
    throw validationError({ start_at: "این زمان با رزرو دیگری از همین فضا هم‌پوشانی دارد" });
  }
  if (prev && w.changed.has("state")) {
    if (next.state === "checked_in") next.checked_in_at = new Date().toISOString();
    if (next.state === "released") next.released_at = new Date().toISOString();
    if (next.state === "confirmed") next.waitlist_position = null;
  }
}

async function reservationFree(w: WriteArgs): Promise<string | null> {
  const { tx, ctx, next } = w;
  const start = msOf(next.start_at);
  const end = msOf(next.end_at);
  if (start === null || end === null) return null;
  const busy = await clashes(tx, ctx, String(next.space_id), start, end, next.id);
  return busy.length ? `فضا در این زمان رزرو شده است (${busy.map((b) => b.number ?? "").filter(Boolean).join("، ")})` : null;
}

async function reservationWindow(w: WriteArgs): Promise<string | null> {
  const { tx, ctx, next } = w;
  if (w.trusted || isSystemCtx(ctx)) return null;
  const space = await liveRow(tx, sysOf(ctx), "space", next.space_id);
  const start = msOf(next.start_at) ?? 0;
  const end = msOf(next.end_at) ?? 0;
  const win = checkInWindow(start, end, Number(space?.check_in_minutes ?? 15));
  const now = Date.now();
  if (now < win.start) return "هنوز زمان ورود این رزرو نرسیده است (از ۱۵ دقیقه پیش از شروع)";
  if (now > win.end && space?.auto_release !== false) return "مهلت ثبت حضور این رزرو گذشته است";
  return null;
}

async function reservationAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { ctx, tx, row, op, prev } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  if (op === "create") {
    const space = await liveRow(tx, sys, "space", row.space_id);
    // a recurring booking: the next occurrences of its series (each checked on its own)
    if (row.recurrence && row.recurrence !== "none" && !row.series_id) {
      const series = String(row.id);
      await updateIn(tx, sys, "reservation", series, { series_id: series }, { trusted: true, keepVersion: true });
      const cal = await calendarFor(tx, ctx, null);
      const occ = seriesOf({ start: msOf(row.start_at)!, end: msOf(row.end_at)! }, String(row.recurrence), (row.recurrence_until as string) ?? null, { tz: orgTz(sys), cal, max: 52 });
      for (const o of occ.slice(1)) {
        await createIn(tx, sysOf(ctx, (row.booked_by as string) ?? null), "reservation", {
          title: row.title, space_id: row.space_id, start_at: new Date(o.start).toISOString(), end_at: new Date(o.end).toISOString(), attendees: row.attendees ?? null,
          booked_for: row.booked_for, booked_by: row.booked_by, recurrence: "none", series_id: series, services: row.services ?? [], service_notes: row.service_notes ?? null,
        }, { trusted: true });
      }
    }
    // services ordered with the booking become a facilities request
    const services = Array.isArray(row.services) ? (row.services as string[]) : [];
    if (services.length && row.state !== "cancelled") {
      const type = SERVICE_TYPES[services[0]] ?? "room_setup";
      await createIn(tx, sysOf(ctx, (row.booked_by as string) ?? null), "facility_request", {
        short_description: `${services.map((s) => SERVICE_LABELS[s] ?? s).join("، ")} برای «${row.title}»`.slice(0, 200),
        description: [row.service_notes, `رزرو ${row.number ?? ""} از ${row.start_at} تا ${row.end_at}`].filter(Boolean).join("\n\n"),
        request_type: type, space_id: row.space_id, preferred_at: row.start_at, reservation_id: row.id, location_id: space?.location_id ?? null,
        requested_for: row.booked_for ?? null, caller_id: row.booked_by ?? row.booked_for ?? null,
      }, { trusted: true });
    }
    if (row.state === "requested" && space?.requires_approval && !row.waitlist_position) {
      const group = space.owner_group_id;
      if (isUuid(group)) await requestApprovalIn(tx, sys, "reservation", String(row.id), { groups: [String(group)], name: `رزرو «${space.name}»`, rule: "any" });
    }
  }
  if (row.state === "confirmed" && (op === "create" || prev?.state !== "confirmed")) await scheduleNoShow(tx, ctx, row);
  // the space is free again for the time this booking held: the first waiting booking that fits takes it
  if (prev && HOLDS_SPACE.includes(String(prev.state)) && !HOLDS_SPACE.includes(String(row.state))) await promoteWaiting(tx, ctx, row);
}

async function scheduleNoShow(tx: Tx, ctx: Ctx, row: Row): Promise<void> {
  const sys = sysOf(ctx);
  const space = await liveRow(tx, sys, "space", row.space_id);
  const cfg = await esmConfig(tx, ctx);
  const at = noShowAt(msOf(row.start_at) ?? 0, msOf(row.end_at) ?? 0, Number(space?.check_in_minutes ?? 15), cfg.no_show_grace_minutes, space?.auto_release !== false);
  if (at === null) return;
  await enqueue(tx, { kind: JOB_NO_SHOW, orgId: ctx.org.id, payload: { id: row.id }, runAt: new Date(Math.max(Date.now(), at)), dedupeKey: `esm.no_show:${row.id}`, maxAttempts: 5 });
}

/** Promote the first waiting booking (by position) that now fits the freed time. */
export async function promoteWaiting(tx: Tx, ctx: Ctx, freed: Row): Promise<string | null> {
  const sys = sysOf(ctx);
  const span = { start: msOf(freed.start_at) ?? 0, end: msOf(freed.end_at) ?? 0 };
  const waiting = (await liveRows(tx, sys, "reservation", { and: [{ f: "space_id", op: "eq", v: freed.space_id }, { f: "state", op: "eq", v: "requested" }, { f: "waitlist_position", op: "nempty" }] }, { order: "t.waitlist_position, t.created_at", limit: 200 }))
    .filter((r) => overlaps(span, { start: msOf(r.start_at) ?? 0, end: msOf(r.end_at) ?? 0 }) && (msOf(r.end_at) ?? 0) > Date.now());
  const space = await liveRow(tx, sys, "space", freed.space_id);
  for (const r of waiting) {
    if ((await clashes(tx, ctx, String(r.space_id), msOf(r.start_at)!, msOf(r.end_at)!, r.id)).length) continue;
    if (space?.requires_approval && r.approval !== "approved") {
      // a space that needs approval: the booking leaves the line and its owner group is asked (never confirmed unasked)
      await updateIn(tx, sys, "reservation", String(r.id), { waitlist_position: null }, { trusted: true, keepVersion: true });
      if (isUuid(space.owner_group_id) && r.approval !== "requested") await requestApprovalIn(tx, sys, "reservation", String(r.id), { groups: [String(space.owner_group_id)], name: `رزرو «${space.name}»`, rule: "any" });
      return String(r.id);
    }
    await transitionIn(tx, sys, "reservation", String(r.id), "confirmed", {}, { trusted: true });
    await emitEvent(tx, sys, { kind: "record.reservation_promoted", table: "reservation", id: String(r.id), number: (r.number as string) ?? null, data: { users: [r.booked_for, r.booked_by].filter(isUuid) } });
    return String(r.id);
  }
  return null;
}

/** The no-show job: a confirmed booking nobody checked in to lets go of its space. */
export async function noShowJob(job: { org_id: string | null; payload: Record<string, unknown> }, jctx: JobContext): Promise<{ again: number } | void> {
  if (!job.org_id || !isUuid(job.payload?.id)) return;
  const sys = await systemCtx(jctx.cfg, job.org_id);
  return sys.write(async (tx) => {
    const r = await liveRow(tx, sys, "reservation", job.payload.id);
    if (!r || r.state !== "confirmed") return;
    const space = await liveRow(tx, sys, "space", r.space_id);
    const cfg = await esmConfig(tx, sys);
    const at = noShowAt(msOf(r.start_at) ?? 0, msOf(r.end_at) ?? 0, Number(space?.check_in_minutes ?? 15), cfg.no_show_grace_minutes, space?.auto_release !== false);
    if (at === null) return;
    // the booking moved later since the job was queued: wait for its new deadline
    if (Date.now() < at) return { again: Math.max(60_000, at - Date.now()) };
    await transitionIn(tx, sys, "reservation", String(r.id), "no_show", {}, { trusted: true });
  });
}

// ----- visitors -----------------------------------------------------------------------------------------------------------

async function visitBefore(w: WriteArgs): Promise<void> {
  const { next, prev, op, ctx } = w;
  if (op === "delete") return;
  // a visit is announced, not created already in: arrival goes through «ثبت ورود» (its NDA and safety guard)
  if (op === "create" && !w.trusted && !isSystemCtx(ctx)) {
    next.state = "expected";
    return;
  }
  if (!prev || !w.changed.has("state")) return;
  const now = new Date().toISOString();
  if (next.state === "checked_in") {
    next.checked_in_at = now;
    const expected = msOf(next.expected_at);
    next.late_minutes = expected === null ? null : Math.max(0, Math.round((Date.now() - expected) / 60_000));
  }
  if (next.state === "checked_out") next.checked_out_at = now;
}

async function visitAcknowledged(w: WriteArgs): Promise<string | null> {
  const { next } = w;
  if (next.requires_nda && next.nda_ack !== true) return "مهمان هنوز تعهد محرمانگی را نپذیرفته است";
  if (next.safety_ack !== true) return "مهمان هنوز توجیه ایمنی را نپذیرفته است";
  return null;
}

async function visitAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { ctx, tx, row, op } = w;
  if (op === "delete") return;
  if (w.changed.has("state") && row.state === "checked_in" && isUuid(row.host_id)) {
    await emitEvent(tx, sysOf(ctx), { kind: "record.visit_arrived", table: "visit", id: String(row.id), number: (row.number as string) ?? null, data: { users: [row.host_id] } });
  }
}

export const facilityHooks = { reservationBefore, reservationAfter, reservationFree, reservationWindow, visitBefore, visitAfter, visitAcknowledged };

/** A settled approval of a booking that needed one: approved and free → confirmed, else waiting or cancelled. */
export function installReservationApprovals(): () => void {
  return onApprovalSettled("reservation", async (s) => {
    const { tx, ctx, record } = s;
    const verdict = settledVerdict(s);
    if (record.state !== "requested" || !verdict) return;
    const sys = sysOf(ctx);
    if (verdict === "rejected") {
      await transitionIn(tx, sys, "reservation", String(record.id), "cancelled", {}, { trusted: true });
      return;
    }
    const busy = await clashes(tx, ctx, String(record.space_id), msOf(record.start_at) ?? 0, msOf(record.end_at) ?? 0, record.id);
    if (busy.length) await updateIn(tx, sys, "reservation", String(record.id), { waitlist_position: 1 }, { trusted: true, keepVersion: true });
    else await transitionIn(tx, sys, "reservation", String(record.id), "confirmed", {}, { trusted: true });
  });
}

/** Spaces with their bookings in a window (the booking screen): readable spaces, busy spans without names. */
export async function availability(ctx: Ctx, input: { from: string; to: string; kind?: string | null; location?: string | null; capacity?: number | null }): Promise<Row> {
  const where: Row[] = [{ f: "active", op: "eq", v: true }, { f: "bookable", op: "eq", v: true }];
  if (input.kind) where.push({ f: "kind", op: "eq", v: input.kind });
  if (isUuid(input.location)) where.push({ f: "location_id", op: "eq", v: input.location });
  if (input.capacity) where.push({ f: "capacity", op: "gte", v: input.capacity });
  const spaces = await liveRows(ctx.db, ctx, "space", { and: where as never }, { order: "t.name", limit: 300 });
  const from = msOf(input.from) ?? Date.now();
  const to = msOf(input.to) ?? from + 86_400_000;
  const busy = spaces.length
    ? await liveRows(ctx.db, sysOf(ctx), "reservation", { and: [{ f: "space_id", op: "in", v: spaces.map((s) => s.id) }, { f: "state", op: "in", v: [...HOLDS_SPACE, "requested"] }, { f: "end_at", op: "gt", v: new Date(from).toISOString() }, { f: "start_at", op: "lt", v: new Date(to).toISOString() }] }, { order: "t.start_at", limit: 5000 })
    : [];
  return {
    spaces: spaces.map((s) => ({
      id: s.id, name: s.name, kind: s.kind, capacity: s.capacity, attributes: s.attributes ?? [], location_id: s.location_id, requires_approval: !!s.requires_approval, map_x: s.map_x, map_y: s.map_y,
      busy: busy.filter((r) => r.space_id === s.id).map((r) => ({ start: r.start_at, end: r.end_at, state: r.state, mine: r.booked_for === ctx.user.id || r.booked_by === ctx.user.id, id: r.booked_for === ctx.user.id || r.booked_by === ctx.user.id ? r.id : null })),
    })),
  };
}
