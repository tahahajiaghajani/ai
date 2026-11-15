// Jobs of service level management:
//   · slm.measure — measure one agreement now (queued by writes of agreements and targets, deduplicated)
//   · slm.sweep   — every six hours per organisation while agreements are in force: measure the current period,
//     close the previous one (final rows and credits), start agreements whose enablement reached their start date,
//     remind owners of reviews due and agreements that are about to end (once per due date), and open the interval
//     review of an agreement whose review is due (the planned-interval scheduler of SLM-002/046)
import { addDays, diffDays } from "@shared/jalali";
import { addJalaliMonths, inForce } from "@shared/slm/logic";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import type { Period } from "@shared/slm/logic";
import { zonedMidnight } from "@shared/model/jalali-buckets";
import { createIn, emitEvent, onRecordEvent, orgTz, systemCtx, transitionIn, updateIn } from "../../engine";
import { enqueue, registerJobHandler } from "../../jobs";
import { actsHere } from "../notify";
import { lockedRow } from "../incident/common";
import { isUuid, liveRows, slmConfig, sysOf, todayOf, type Row } from "./common";
import { agreementPeriod, storeMeasures } from "./measure";

const SWEEP_EVERY = 6 * 3_600_000;
const lastSweep = new Map<string, number>();

export async function ensureSlmSweep(q: Queryable, orgId: string, delayMs = 60_000): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 30 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "slm.sweep", orgId, delayMs, dedupeKey: "slm.sweep", maxAttempts: 5 });
}
export const resetSlmSweepThrottle = () => lastSweep.clear();

/**
 * Close an agreement's periods that ended without final rows (final rows, credits), newest first back to the first
 * one already final: `latest` (the period just closed — always, when the agreement was in force in it), and the ones
 * before it that were measured while in force (they have rows) but never closed — a sweep that missed a period
 * boundary, an agreement revived after it expired. A period before the agreement's start is never closed.
 */
export async function finalizeClosedIn(tx: Tx, sys: Ctx, a: Row, latest: Period, now: number, maxBack = 24): Promise<number> {
  const todo: Period[] = [];
  let p = latest;
  for (let i = 0; i < maxBack; i++) {
    if (a.valid_from && String(p.end) <= String(a.valid_from).slice(0, 10)) break;
    const rows = await liveRows(tx, sys, "slm_compliance", { and: [{ f: "agreement_id", op: "eq", v: a.id }, { f: "period_key", op: "eq", v: p.key }] }, { limit: 50 });
    if (rows.some((r) => r.final)) break;
    if (i > 0 && !rows.length) break;
    todo.unshift(p);
    p = agreementPeriod(a, addDays(p.start, -1));
  }
  for (const period of todo) await storeMeasures(tx, sys, String(a.id), { period, final: true, now });
  return todo.length;
}

/**
 * One pass of the sweep over an organisation (as the system). Returns what it did (tests read it). A pass cut short
 * by its deadline returns `cursor` (the last agreement it finished, by id); the next run resumes after it, so every
 * agreement is reached however many there are.
 */
export async function slmSweep(sys: Ctx, opts: { now?: number; deadline?: number; after?: string | null } = {}): Promise<{ measured: number; finalized: number; started: number; reminded: number; reviews: number; more: boolean; cursor: string | null }> {
  const now = opts.now ?? Date.now();
  const today = todayOf(sys, now);
  const cfg = await slmConfig(sys.db, sys);
  const out = { measured: 0, finalized: 0, started: 0, reminded: 0, reviews: 0, more: false, cursor: null as string | null };
  const after = isUuid(opts.after) ? String(opts.after) : null;
  const late = () => !!opts.deadline && Date.now() > opts.deadline;
  if (!after) {
    // enablement reached its start date → in force (the readiness guard still decides)
    for (const a of await liveRows(sys.db, sys, "service_agreement", { and: [{ f: "state", op: "eq", v: "enablement" }, { f: "valid_from", op: "lte", v: today }] }, { limit: 500 })) {
      try {
        await sys.write((tx) => transitionIn(tx, sys, "service_agreement", String(a.id), "active", {}, { trusted: true }));
        out.started++;
      } catch {
        // not ready (no targets, no supplier…): it stays in enablement for a person to finish
      }
    }
  }
  const resume = after ? [{ f: "id", op: "gt", v: after }] : [];
  const agreements = await liveRows(sys.db, sys, "service_agreement", { and: [{ f: "state", op: "in", v: ["active", "under_review", "renewal"] }, ...resume] } as never, { order: "t.id", limit: 5000 });
  for (const a of agreements) {
    // at least one agreement per run, so that a pass always moves on
    if (out.cursor && late()) {
      out.more = true;
      break;
    }
    const listed = a;
    await sys.write(async (tx) => {
      // the agreement locked and read again (storeMeasures locks it first): two sweeps at once remind once and open
      // one interval review per due date
      const a = (await lockedRow(tx, sys, "service_agreement", String(listed.id))) ?? listed;
      const period = agreementPeriod(a, today);
      const prev = agreementPeriod(a, addDays(period.start, -1));
      await storeMeasures(tx, sys, String(a.id), { period, now });
      out.measured++;
      // close the previous period once (its rows become final, missed targets with tiers become credits), and any
      // earlier one measured in force but never closed
      out.finalized += await finalizeClosedIn(tx, sys, a, prev, now);
      const patch: Row = {};
      // review due soon: remind once per due date and open the interval review
      if (a.next_review_at && diffDays(String(a.next_review_at), today) <= cfg.review_reminder_days && a.review_reminded_for !== a.next_review_at) {
        await emitEvent(tx, sys, { kind: "record.slm.review_due", table: "service_agreement", id: String(a.id), number: a.number ?? null, data: { users: [a.manager_id].filter(isUuid), due: a.next_review_at } });
        patch.review_reminded_for = a.next_review_at;
        out.reminded++;
        const open = await liveRows(tx, sys, "slm_review", { and: [{ f: "agreement_id", op: "eq", v: a.id }, { f: "state", op: "in", v: ["scheduled", "prepared", "held", "actions_open"] }] }, { limit: 1 });
        if (!open.length) {
          const to = addDays(String(a.next_review_at) < today ? today : String(a.next_review_at), -1);
          const from = addJalaliMonths(to, -(Number(a.review_months ?? 3) || 3));
          await createIn(tx, sys, "slm_review", {
            title: `بازبینی دوره‌ای ${a.name ?? ""}`.slice(0, 200), kind: "interval", agreement_id: a.id, service_id: a.service_id ?? null,
            period_from: addDays(from, 1), period_to: to, scheduled_at: new Date(zonedMidnight(String(a.next_review_at), orgTz(sys)) + 10 * 3_600_000).toISOString(),
            chair_id: isUuid(a.manager_id) ? a.manager_id : null, attendees: [a.customer_contact_id].filter(isUuid),
          }, { trusted: true });
          out.reviews++;
        }
      }
      // the agreement ends soon: remind once per end date
      if (a.valid_to && diffDays(String(a.valid_to), today) <= cfg.expiry_reminder_days && diffDays(String(a.valid_to), today) >= 0 && a.expiry_reminded_for !== a.valid_to) {
        await emitEvent(tx, sys, { kind: "record.slm.expiring", table: "service_agreement", id: String(a.id), number: a.number ?? null, data: { users: [a.manager_id].filter(isUuid), valid_to: a.valid_to } });
        patch.expiry_reminded_for = a.valid_to;
        out.reminded++;
      }
      if (Object.keys(patch).length) await updateIn(tx, sys, "service_agreement", String(a.id), patch, { trusted: true, keepVersion: true, allowLocked: true });
    });
    out.cursor = String(a.id);
  }
  // agreements that left force (expired, withdrawn): their last period is closed once it is over, with the periods
  // before it the sweep never closed — a credit for the last month is not lost because the agreement ended
  if (!out.more) {
    const since = addDays(today, -400);
    const ended = await liveRows(sys.db, sys, "service_agreement", { and: [{ f: "state", op: "in", v: ["expired", "withdrawn"] }, { f: "left_force_on", op: "gte", v: since }] }, { order: "t.id", limit: 2000 });
    for (const a of ended) {
      if (late()) {
        out.more = true;
        break;
      }
      const last = [a.valid_to, a.left_force_on].filter((d): d is string => typeof d === "string" && !!d).map((d) => d.slice(0, 10)).sort()[0];
      if (!last) continue;
      // its last day in force: its end date, or the day it was withdrawn when that came first
      const latest = agreementPeriod(a, last);
      if (today < latest.end) continue;
      const [final] = await liveRows(sys.db, sys, "slm_compliance", { and: [{ f: "agreement_id", op: "eq", v: a.id }, { f: "period_key", op: "eq", v: latest.key }, { f: "final", op: "eq", v: true }] }, { limit: 1 });
      if (final) continue;
      out.finalized += await sys.write((tx) => finalizeClosedIn(tx, sys, a, latest, now));
    }
  }
  if (!out.more) out.cursor = null;
  return out;
}

let installed = false;

export function installSlmJobs(): (() => void)[] {
  if (installed) return [];
  installed = true;
  return [
    registerJobHandler("slm.measure", async (job, jctx) => {
      const id = String(job.payload?.id ?? "");
      if (!job.org_id || !isUuid(id)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await sys.write((tx) => storeMeasures(tx, sys, id));
      if (actsHere(jctx.cfg)) await ensureSlmSweep(jctx.db, job.org_id);
    }),
    registerJobHandler("slm.sweep", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      // a pass cut short resumes after the last agreement it finished (kept in the job's payload)
      const r = await slmSweep(sys, { deadline: jctx.deadline, after: isUuid(job.payload?.cursor) ? String(job.payload.cursor) : null });
      await jctx.save(r.more && r.cursor ? { cursor: r.cursor } : {});
      if (r.more) return { again: 30_000 };
      const live = await liveRows(sys.db, sys, "service_agreement", { f: "state", op: "in", v: ["enablement", "active", "under_review", "renewal"] }, { limit: 1 });
      return live.length ? { again: SWEEP_EVERY } : undefined;
    }),
    onRecordEvent("slm.sweep", async (e, jctx) => {
      if (actsHere(jctx.cfg) && e.kind === "record.state_changed" && inForce(e.to)) await ensureSlmSweep(jctx.db, e.org_id);
    }, { tables: ["service_agreement"], kinds: ["record.state_changed"] }),
  ];
}

export { sysOf };
