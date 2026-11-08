// Change lockdowns (catalogue CHG-046): during a crisis or a major incident every change — or the changes of some
// services, CIs or a condition — stops; only emergency changes may proceed. Starting a lockdown puts the changes in
// flight (scheduled, being implemented) on hold with the reason «قرنطینهٔ تغییرات» when `hold_in_flight` is set; the
// lifecycle guard refuses scheduling or implementing a non-emergency change it covers; ending it resumes the changes it
// held (unless another active lockdown still covers them). Conflicts of kind «lockdown» show the overlap on the calendar.
import { lockdownApplies } from "@shared/change/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { addJournalIn, defFor, emitEvent, updateIn } from "../../engine";
import { enqueue } from "../../jobs";
import { eqAll, liveRows, sysOf, type Row } from "./common";
import { activeLockdowns, holdsOn, lockdownLike } from "./schedule";

/** States whose changes a lockdown holds. */
export const IN_FLIGHT = ["scheduled", "implement"];

/** Put the in-flight changes a lockdown covers on hold. Returns how many. */
export async function applyLockdown(tx: Tx, ctx: Ctx, lockdown: Row, actor: string | null): Promise<number> {
  const sys = sysOf(ctx);
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
  await enqueue(tx, { kind: "change.recheck", orgId: ctx.org.id, dedupeKey: "change.recheck", delayMs: 1000 });
  return n;
}

/** Resume the changes a lockdown held (those no other active lockdown covers). Returns how many. */
export async function releaseLockdown(tx: Tx, ctx: Ctx, lockdown: Row, actor: string | null): Promise<number> {
  const sys = sysOf(ctx);
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
  await enqueue(tx, { kind: "change.recheck", orgId: ctx.org.id, dedupeKey: "change.recheck", delayMs: 1000 });
  return n;
}
