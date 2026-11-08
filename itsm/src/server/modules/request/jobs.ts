// Background work of the request module (on the web version and on Windows apps that are not linked to it —
// `actsHere`: a linked Windows app pushes its writes and the web version reacts):
//   flows           the zero-touch check of a flow-driven item (fulfil.ts `checkFlows`) when one of its runs ends
//                   (`record.flow_ended`); `request.flows` jobs queued by earlier versions check once
//   request.link    links a record an item produced or was converted into (after the write committed)
//   request.sweep   every 15 minutes while there is something to watch: delivered items confirmed automatically
//                   after N working days (REQ-046), reminders and auto-cancel of items waiting for the requester
//                   (REQ-045), revocation of time-bound access (REQ-031), item reviews (REQ-055), expired subscriptions
//   request.stats   nightly: the statistical delivery expectation of every item (p50/p85/p95 over the window,
//                   REQ-017) and its orders in the last 90 days
import { percentile, workingDaysDue } from "@shared/request/due";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { addJournalIn, addLink, createIn, emitEvent, onRecordEvent, systemCtx, transitionIn, updateIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { actsHere, notifyPeople } from "../notify";
import { iso, isUuid, liveRows, requestConfig, secondsBetween, sysOf, type Row } from "./common";
import { calendarOf, checkFlows, JOB_FLOWS, JOB_LINK } from "./fulfil";

export const JOB_SWEEP = "request.sweep";
export const JOB_STATS = "request.stats";
export const SWEEP_EVERY = 15 * 60_000;
const lastSweep = new Map<string, number>();
const lastStats = new Map<string, number>();

/** Queue the sweep of an organisation (at most every ten minutes per process). */
export async function ensureSweep(q: Queryable, orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: JOB_SWEEP, orgId, delayMs: 60_000, dedupeKey: JOB_SWEEP, maxAttempts: 5 });
}
export const resetSweepThrottle = () => {
  lastSweep.clear();
  lastStats.clear();
};

export interface SweepResult {
  confirmed: number;
  reminded: number;
  cancelled: number;
  revoked: number;
  reviews: number;
  expired: number;
  /** something is still to watch (the sweep runs again) */
  pending: boolean;
}

const DAY = 86_400_000;
const today = (now: number) => new Date(now).toISOString().slice(0, 10);

/** One pass of the sweep as the system of the organisation. */
export async function sweep(sys: Ctx, now = Date.now()): Promise<SweepResult> {
  const out: SweepResult = { confirmed: 0, reminded: 0, cancelled: 0, revoked: 0, reviews: 0, expired: 0, pending: false };
  const q = sys.db;
  const cfg = await requestConfig(q, sys);
  const cal = await calendarOf(q, sys, null);
  const def = tableDef("request_item")!;
  const after = (from: unknown, days: number) => {
    const t = Date.parse(String(from ?? ""));
    if (!Number.isFinite(t) || days <= 0) return null;
    return workingDaysDue(cal, t, days);
  };
  // delivered items the requester did not confirm
  const delivered = await liveRows(q, sys, "request_item", { f: "state", op: "eq", v: "delivered" }, { limit: 500 });
  if (delivered.length) out.pending = true;
  for (const r of delivered) {
    const due = after(r.resolved_at, cfg.confirm_days);
    if (!cfg.confirm_days || due === null || due > now) continue;
    await sys.write(async (tx) => {
      await transitionIn(tx, sys, "request_item", String(r.id), "closed_complete", {}, { trusted: true });
      await addJournalIn(tx, sys, def, r, { kind: "system", body: `تحویل پس از ${cfg.confirm_days.toLocaleString("fa-IR")} روز کاری بی‌پاسخ خودبه‌خود تأیید شد.` }, { trusted: true });
    });
    out.confirmed++;
  }
  // waiting for the requester: a reminder, then cancellation
  const waiting = await liveRows(q, sys, "request_item", { f: "state", op: "eq", v: "awaiting_info" }, { limit: 500 });
  if (waiting.length) out.pending = true;
  for (const r of waiting) {
    const cancelAt = after(r.info_since, cfg.info_cancel_days);
    if (cfg.info_cancel_days && cancelAt !== null && cancelAt <= now) {
      await sys.write(async (tx) => {
        await transitionIn(tx, sys, "request_item", String(r.id), "cancelled", { close_code: "cancelled", close_notes: "پاسخی از درخواست‌کننده نرسید؛ قلم خودبه‌خود لغو شد" }, { trusted: true });
      });
      out.cancelled++;
      continue;
    }
    const remindAt = after(r.info_since, cfg.info_reminder_days);
    if (cfg.info_reminder_days && !r.reminded_at && remindAt !== null && remindAt <= now) {
      await sys.write(async (tx) => {
        await updateIn(tx, sys, "request_item", String(r.id), { reminded_at: iso(now) }, { trusted: true, keepVersion: true });
        const users = [...new Set([r.requested_for, r.caller_id].filter(isUuid))];
        await emitEvent(tx, sys, { kind: "record.request.info_reminder", table: "request_item", id: String(r.id), number: (r.number as string) ?? null, data: { users } });
      });
      out.reminded++;
    }
  }
  // time-bound access that ended (REQ-031): a revocation task for the fulfilment group (marked `revocation`: closing
  // the item, which usually happens before the access ends, does not cancel it); items closed incomplete may have been
  // given access too
  const ending = await liveRows(q, sys, "request_item", {
    and: [{ f: "access_until", op: "lt", v: today(now) }, { f: "revoked_at", op: "empty" }, { f: "state", op: "in", v: ["delivered", "closed_complete", "closed_incomplete"] }],
  }, { limit: 200 });
  for (const r of ending) {
    await sys.write(async (tx) => {
      await createIn(tx, sys, "request_task", {
        request_item_id: r.id,
        short_description: `لغو دسترسی: ${String(r.short_description ?? "").slice(0, 150)}`,
        assignment_group_id: r.assignment_group_id ?? null,
        instructions: `مهلت دسترسی این قلم (${String(r.access_until)}) به پایان رسید؛ دسترسی را بردارید و این وظیفه را ببندید.`,
        class_of_service: "fixed_date",
        revocation: true,
      }, { trusted: true });
      await updateIn(tx, sys, "request_item", String(r.id), { revoked_at: iso(now) }, { trusted: true, keepVersion: true, allowLocked: true });
      await emitEvent(tx, sys, { kind: "record.request.access_expired", table: "request_item", id: String(r.id), number: (r.number as string) ?? null, data: { users: [r.requested_for].filter(isUuid) } });
    });
    out.revoked++;
  }
  const upcoming = await liveRows(q, sys, "request_item", { and: [{ f: "access_until", op: "gte", v: today(now) }, { f: "revoked_at", op: "empty" }] }, { limit: 1 });
  if (upcoming.length) out.pending = true;
  // item reviews (REQ-055)
  const reviews = await liveRows(q, sys, "catalog_item", { and: [{ f: "next_review_at", op: "lte", v: today(now) }, { f: "review_interval_days", op: "gt", v: 0 }, { f: "state", op: "eq", v: "published" }] }, { limit: 100 });
  for (const it of reviews) {
    const users = [...new Set([it.owner_id, ...(Array.isArray(it.editors) ? it.editors : [])].filter(isUuid))];
    await sys.write(async (tx) => {
      await updateIn(tx, sys, "catalog_item", String(it.id), { next_review_at: today(now + Number(it.review_interval_days) * DAY) }, { trusted: true, keepVersion: true });
      if (users.length) {
        await notifyPeople(tx, sys.org.id, {
          table: "catalog_item", id: String(it.id), users, label: "بازبینی دوره‌ای قلم کاتالوگ",
          subject: "زمان بازبینی «{{record.display}}» رسیده است",
          body: `آمار سفارش، زمان انجام و فرم این قلم را بازبینی کنید؛ اگر دیگر لازم نیست آن را بازنشسته کنید.\n\nسفارش‌های ۹۰ روز اخیر: ${Number(it.orders_90d ?? 0).toLocaleString("fa-IR")}`,
          source: "درخواست خدمت",
        });
      }
    });
    out.reviews++;
  }
  // subscriptions past their end
  const subs = await liveRows(q, sys, "request_subscription", { and: [{ f: "end_on", op: "lt", v: today(now) }, { f: "state", op: "in", v: ["active", "suspended"] }] }, { limit: 200 });
  for (const s of subs) {
    await sys.write((tx) => transitionIn(tx, sys, "request_subscription", String(s.id), "expired", {}, { trusted: true }));
    out.expired++;
  }
  return out;
}

/**
 * The statistical expectation of every item (REQ-017): fulfilment times (opened → closed, completed items of the
 * window) per item — p50, p85, p95 and the sample size, never averaged across items — and its recent orders.
 */
export async function stats(sys: Ctx, now = Date.now()): Promise<{ items: number }> {
  const q = sys.db;
  const cfg = await requestConfig(q, sys);
  const since = iso(now - cfg.sle_window_days * DAY);
  const recent = iso(now - 90 * DAY);
  const done = await liveRows(q, sys, "request_item", { and: [{ f: "state", op: "eq", v: "closed_complete" }, { f: "closed_at", op: "gte", v: since }] }, { limit: 10_000 });
  const ordered = await liveRows(q, sys, "request_item", { f: "opened_at", op: "gte", v: recent }, { limit: 10_000 });
  const times = new Map<string, number[]>();
  for (const r of done) {
    const s = secondsBetween(r.opened_at, r.closed_at);
    if (s === null) continue;
    const k = String(r.cat_item_id);
    times.set(k, [...(times.get(k) ?? []), s]);
  }
  const orders = new Map<string, number>();
  for (const r of ordered) orders.set(String(r.cat_item_id), (orders.get(String(r.cat_item_id)) ?? 0) + 1);
  const items = await liveRows(q, sys, "catalog_item", null, { limit: 5000 });
  let changed = 0;
  for (const it of items) {
    const xs = times.get(String(it.id)) ?? [];
    const next: Row = {
      sle_p50: percentile(xs, 50), sle_p85: percentile(xs, 85), sle_p95: percentile(xs, 95), sle_samples: xs.length, orders_90d: orders.get(String(it.id)) ?? 0,
    };
    if (Object.entries(next).every(([k, v]) => (it[k] ?? null) === v || Number(it[k] ?? -1) === Number(v ?? -1))) continue;
    await sys.write((tx) => updateIn(tx, sys, "catalog_item", String(it.id), next, { trusted: true, keepVersion: true, allowLocked: true }));
    changed++;
  }
  return { items: changed };
}

async function react(e: RecordEvent, jctx: JobContext): Promise<void> {
  if (!actsHere(jctx.cfg) || !isUuid(e.org_id)) return;
  await ensureSweep(jctx.db, e.org_id);
  if (Date.now() - (lastStats.get(e.org_id) ?? 0) > DAY) {
    lastStats.set(e.org_id, Date.now());
    await enqueue(jctx.db, { kind: JOB_STATS, orgId: e.org_id, delayMs: 5 * 60_000, dedupeKey: JOB_STATS, maxAttempts: 3 });
  }
}

let installed = false;

export function installRequestJobs(): void {
  if (installed) return;
  installed = true;
  onRecordEvent("request.sweep", react, { tables: ["request_item", "request"], kinds: ["record.created", "record.state_changed"] });
  // a run of a flow-driven item ended: check the item now (the flow service tells, nothing polls)
  onRecordEvent("request.flows", async (e, jctx) => {
    if (!actsHere(jctx.cfg) || !isUuid(e.id) || e.data?.test) return;
    await checkFlows(jctx.cfg, e.org_id, e.id);
  }, { tables: ["request_item"], kinds: ["record.flow_ended"] });
  // checks queued by earlier versions (they polled): once, the run's end event does the rest
  registerJobHandler(JOB_FLOWS, async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    const id = String(job.payload.id ?? "");
    if (isUuid(id)) await checkFlows(jctx.cfg, job.org_id, id);
  });
  registerJobHandler(JOB_LINK, async (job, jctx) => {
    if (!job.org_id) return;
    const p = job.payload as Record<string, string>;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    try {
      await addLink(sys, p.from_table, p.from_id, { kind: p.kind || "related", table: p.to_table, id: p.to_id });
    } catch (e) {
      // already linked, or one side is gone: nothing to do
      jctx.log?.warn?.("request: link skipped", { error: String((e as Error)?.message ?? e) });
    }
  });
  registerJobHandler(JOB_SWEEP, async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    const sys = await systemCtx(jctx.cfg, job.org_id);
    const r = await sweep(sys);
    return r.pending ? { again: SWEEP_EVERY } : undefined;
  });
  registerJobHandler(JOB_STATS, async (job, jctx) => {
    if (!job.org_id || !actsHere(jctx.cfg)) return;
    await stats(await systemCtx(jctx.cfg, job.org_id));
  });
}

export { sysOf };
