// Jobs of workforce and agent experience:
//   · wfm.absence — at the start of approved time off the person's profile goes out of office (with the delegate); at
//     its end the profile is restored and the time off ends
//   · wfm.sweep (daily while the module has data): certificates about to expire are announced once
//     (`record.wfm.cert_expiring`), time off whose start or end was missed is applied or ended, and the member
//     profiles are re-synced with skills that expired
import { addDays } from "@shared/jalali";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { emitEvent, systemCtx, transitionIn, updateIn } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { actsHere } from "../notify";
import { isUuid, liveRow, liveRows, msOf, sysOf, todayOf, type Row } from "./common";
import { applyAbsenceIn, clearAbsenceIn, syncProfileSkills } from "./hooks";

const SWEEP_EVERY = 24 * 3_600_000;
const lastSweep = new Map<string, number>();

export async function ensureWorkforceSweep(q: Queryable, orgId: string, delayMs = 60_000): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 60 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "wfm.sweep", orgId, delayMs, dedupeKey: "wfm.sweep", maxAttempts: 5 });
}
export const resetWorkforceSweepThrottle = () => lastSweep.clear();

/** Apply or end one absence according to the clock. */
export async function absenceTick(sys: Ctx, id: string, now = Date.now()): Promise<"applied" | "ended" | "none"> {
  return sys.write(async (tx) => {
    const a = await liveRow(tx, sys, "wfm_absence", id);
    if (!a || a.state !== "approved") return "none";
    const s = msOf(a.start_at) ?? now;
    const e = msOf(a.end_at) ?? now;
    if (e <= now) {
      await transitionIn(tx, sys, "wfm_absence", id, "ended", {}, { trusted: true });
      const fresh = await liveRow(tx, sys, "wfm_absence", id);
      if (fresh?.applied) await clearAbsenceIn(tx, sys, fresh);
      return "ended";
    }
    if (s <= now && !a.applied) {
      await applyAbsenceIn(tx, sys, a);
      return "applied";
    }
    return "none";
  });
}

/** One pass of the daily sweep (tests call it directly). */
export async function workforceSweep(sys: Ctx, now = Date.now()): Promise<{ certificates: number; absences: number; profiles: number }> {
  const today = todayOf(sys, now);
  const out = { certificates: 0, absences: 0, profiles: 0 };
  const certs = await liveRows(sys.db, sys, "wfm_certification", { and: [{ f: "expires_at", op: "gte", v: today }, { f: "expires_at", op: "lte", v: addDays(today, 30) }, { f: "reminded_at", op: "empty" }] }, { limit: 1000 });
  for (const c of certs) {
    await sys.write(async (tx) => {
      await emitEvent(tx, sys, { kind: "record.wfm.cert_expiring", table: "wfm_certification", id: String(c.id), data: { users: [c.user_id].filter(isUuid), expires_at: c.expires_at } });
      await updateIn(tx, sys, "wfm_certification", String(c.id), { reminded_at: new Date(now).toISOString() }, { trusted: true, keepVersion: true });
    });
    out.certificates++;
  }
  const iso = new Date(now).toISOString();
  const due = await liveRows(sys.db, sys, "wfm_absence", { and: [{ f: "state", op: "eq", v: "approved" }, { or: [{ f: "end_at", op: "lte", v: iso }, { and: [{ f: "start_at", op: "lte", v: iso }, { f: "applied", op: "eq", v: false }] }] }] }, { limit: 1000 });
  for (const a of due) if ((await absenceTick(sys, String(a.id), now)) !== "none") out.absences++;
  // skills that expired since yesterday no longer route
  const expired = await liveRows(sys.db, sys, "wfm_person_skill", { and: [{ f: "expires_at", op: "gte", v: addDays(today, -1) }, { f: "expires_at", op: "lt", v: today }] }, { limit: 2000 });
  const people = [...new Set(expired.map((p: Row) => String(p.user_id)))];
  for (const u of people) if (await sys.write((tx) => syncProfileSkills(tx, sys, u))) out.profiles++;
  return out;
}

let installed = false;

export function installWorkforceJobs(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return [
    registerJobHandler("wfm.absence", async (job, jctx) => {
      const id = String(job.payload?.id ?? "");
      if (!job.org_id || !isUuid(id)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await absenceTick(sys, id);
      if (actsHere(jctx.cfg)) await ensureWorkforceSweep(jctx.db, job.org_id);
    }),
    registerJobHandler("wfm.sweep", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await workforceSweep(sys);
      const any = await liveRows(sys.db, sys, "wfm_skill", null, { limit: 1 });
      return any.length ? { again: SWEEP_EVERY } : undefined;
    }),
  ];
}

export { sysOf };
