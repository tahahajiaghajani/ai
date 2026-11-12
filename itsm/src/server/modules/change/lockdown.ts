// Change lockdowns (catalogue CHG-046): during a crisis or a major incident every change — or the changes of some
// services, CIs or a condition — stops; only emergency changes may proceed. The start of a lockdown (at once, or later
// through the sweep) puts the changes in flight (scheduled, being implemented) on hold with the reason «قرنطینهٔ
// تغییرات» when `hold_in_flight` is set, once (`applied_at`); the
// lifecycle guard refuses scheduling or implementing a non-emergency change it covers; ending it resumes the changes it
// held (unless another active lockdown still covers them). Conflicts of kind «lockdown» show the overlap on the calendar.
//
// Writes run side by side (no organisation lock): what a lockdown holds is decided from the changes as stored, and the
// lifecycle guard decides from the lockdowns as stored. They take turns on the organisation's lockdown key
// (`lockLockdowns`): a lockdown starting or ending, a non-emergency change moving into scheduling or implementation
// from outside them, and «ادامه» of a held change — so the later one's reads see what the earlier one committed (a
// change authorized while a lockdown starts is held by it; a lockdown starting while another ends holds what that one
// resumes).
import { lockdownApplies } from "@shared/change/logic";
import type { Ctx } from "../../context";
import { lockKey, type Tx } from "../../db";
import { addJournalIn, defFor, emitEvent, updateIn } from "../../engine";
import { enqueue } from "../../jobs";
import { eqAll, liveRows, msOf, sysOf, type Row } from "./common";
import { activeLockdowns, holdsOn, lockdownLike } from "./schedule";

/** States whose changes a lockdown holds. */
export const IN_FLIGHT = ["scheduled", "implement"];

/**
 * Take the organisation's lockdown key until the transaction ends (see the head of this file). The engine's own lock
 * of a change comes first where a change's write takes it (the lifecycle guard), the key first where the work then
 * locks changes: a lockdown's start and end (the changes they hold or resume) and «ادامه» of a held change.
 */
export async function lockLockdowns(tx: Tx, orgId: string): Promise<void> {
  await lockKey(tx, `change.lockdown:${orgId}`);
}

/** Put the in-flight changes a lockdown covers on hold. Returns how many. */
export async function applyLockdown(tx: Tx, ctx: Ctx, lockdown: Row, actor: string | null): Promise<number> {
  const sys = sysOf(ctx);
  // a change being authorized or resumed at this moment commits first and is read here as it is now
  await lockLockdowns(tx, ctx.org.id);
  const { def } = await defFor(sys, "change_request", tx);
  const l = lockdownLike(lockdown);
  let n = 0;
  for (const c of await liveRows(tx, sys, "change_request", { and: [{ f: "state", op: "in", v: IN_FLIGHT }, { f: "on_hold", op: "eq", v: false }] }, { order: "t.planned_start", limit: 1000 })) {
    if (!lockdownApplies(l, c, await holdsOn(tx, sys, c))) continue;
    const stored = await updateIn(tx, sys, "change_request", String(c.id), { on_hold: true, on_hold_reason: "lockdown", lockdown_id: lockdown.id }, { trusted: true });
    await addJournalIn(tx, sysOf(ctx, actor), def, stored, { kind: "system", body: `با شروع قرنطینهٔ تغییرات «${lockdown.title}» این تغییر متوقف شد.` }, { trusted: true, author: actor });
    n++;
  }
  await emitEvent(tx, sys, { kind: "record.change_lockdown.started", table: "change_lockdown", id: String(lockdown.id), number: lockdown.number ?? null, data: { held: n } });
  await enqueue(tx, { kind: "change.recheck", orgId: ctx.org.id, dedupeKey: "change.recheck" });
  return n;
}

/** Is the lockdown active, holding changes in flight, started by `at` and not applied yet? */
export const lockdownDue = (l: Row, at: number): boolean => l.state === "active" && l.hold_in_flight !== false && !l.applied_at && (msOf(l.starts_at) ?? 0) <= at;

/**
 * Apply a lockdown whose start has come, once: the changes in flight it covers go on hold and it records when
 * (`applied_at`) and how many. Called on create, when its start moves into the past, and by the sweep.
 */
export async function startLockdown(tx: Tx, ctx: Ctx, lockdown: Row, actor: string | null): Promise<number> {
  const held = await applyLockdown(tx, ctx, lockdown, actor);
  await updateIn(tx, sysOf(ctx), "change_lockdown", String(lockdown.id), { held_count: Number(lockdown.held_count ?? 0) + held, applied_at: new Date().toISOString() }, { trusted: true, keepVersion: true });
  return held;
}

/** Resume the changes a lockdown held (those no other active lockdown covers). Returns how many. */
export async function releaseLockdown(tx: Tx, ctx: Ctx, lockdown: Row, actor: string | null): Promise<number> {
  const sys = sysOf(ctx);
  // a lockdown starting at this moment either committed (it is among the others here) or waits and holds what this resumes
  await lockLockdowns(tx, ctx.org.id);
  const { def } = await defFor(sys, "change_request", tx);
  const others = (await activeLockdowns(tx, sys)).filter((x) => x.id !== lockdown.id);
  let n = 0;
  for (const c of await liveRows(tx, sys, "change_request", eqAll({ lockdown_id: lockdown.id }), { limit: 1000 })) {
    if (!c.on_hold || c.on_hold_reason !== "lockdown") continue;
    const holds = await holdsOn(tx, sys, c);
    const still = others.find((o) => lockdownApplies(lockdownLike(o), c, holds));
    const stored = await updateIn(tx, sys, "change_request", String(c.id), still ? { lockdown_id: still.id } : { on_hold: false, on_hold_reason: null, lockdown_id: null }, { trusted: true });
    if (!still) {
      await addJournalIn(tx, sysOf(ctx, actor), def, stored, { kind: "system", body: `قرنطینهٔ تغییرات «${lockdown.title}» پایان یافت؛ توقف این تغییر برداشته شد.` }, { trusted: true, author: actor });
      n++;
    }
  }
  await emitEvent(tx, sys, { kind: "record.change_lockdown.released", table: "change_lockdown", id: String(lockdown.id), number: lockdown.number ?? null, data: { resumed: n } });
  await enqueue(tx, { kind: "change.recheck", orgId: ctx.org.id, dedupeKey: "change.recheck" });
  return n;
}
