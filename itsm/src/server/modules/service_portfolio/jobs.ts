// Background work of the service portfolio (acts once — the web version, or a Windows app not linked to one):
//   service.status   recompute live statuses (debounced; queued by incident and CI events, and by the sweep)
//   service.seed     the defaults of a new organisation
//   service.sweep    hourly per organisation: statuses; once a day the scores of yesterday, review reminders to the
//                    owners (SPF-039), agreements past their end marked «پایان‌یافته», technology findings (SPF-028)
import { addDays, todayISO } from "@shared/jalali";
import { reviewDue } from "@shared/service_portfolio/logic";
import type { Ctx } from "../../context";
import { emitEvent, onRecordEvent, systemCtx, updateIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { actsHere } from "../notify";
import { CATALOGUE_STATES, isUuid, liveRows, serviceConfig, sysOf } from "./common";
import { refreshStatuses } from "./status";
import { scoreDay } from "./score";
import { technologyFindings } from "./technology";
import { seedPortfolioDefaultsIn } from "./seed";

export const SWEEP_EVERY = 60 * 60_000;
const lastSweep = new Map<string, number>();

export async function ensurePortfolioSweep(q: JobContext["db"], orgId: string): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 10 * 60_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "service.sweep", orgId, delayMs: 60_000, dedupeKey: "service.sweep", maxAttempts: 5 });
}

export const resetPortfolioSweepThrottle = () => lastSweep.clear();

const INCIDENT_FIELDS = ["service_id", "affected_services", "priority", "major_state", "state"];
const CI_FIELDS = ["operational_status", "state"];

/** Does an event change what a service's status is computed from? */
export function touchesStatus(e: RecordEvent): boolean {
  if (e.table === "incident") {
    if (e.kind === "record.created" || e.kind === "record.state_changed" || e.kind === "record.deleted") return true;
    return (e.changed ?? []).some((f) => INCIDENT_FIELDS.includes(f));
  }
  if (e.table === "ci") {
    if (e.kind === "record.state_changed" || e.kind === "record.deleted") return true;
    return (e.changed ?? []).some((f) => CI_FIELDS.includes(f));
  }
  if (e.table === "service") return (e.changed ?? []).includes("status_override") || e.kind === "record.state_changed";
  return false;
}

/** Remind owners of services whose review falls due within the warning window (once per due date). */
export async function reviewReminders(sys: Ctx): Promise<number> {
  const cfg = await serviceConfig(sys.db, sys);
  const today = todayISO(String(sys.org.settings?.timezone ?? "Asia/Tehran"));
  const horizon = addDays(today, Math.max(0, Number(cfg.review_warn_days ?? 14)));
  let n = 0;
  for (const s of await liveRows(sys.db, sys, "service", { f: "state", op: "in", v: CATALOGUE_STATES }, { limit: 5000 })) {
    const due = reviewDue(s.last_reviewed_at, s.review_months, s.live_at ?? s.created_at);
    if (!due || due > horizon || s.review_warned_for === due) continue;
    await sys.write(async (tx) => {
      const users = [s.owner_id, s.product_owner_id].filter(isUuid);
      await emitEvent(tx, sys, { kind: "record.service.review_due", table: "service", id: s.id, number: s.number ?? null, actor: null, data: { users, due, overdue: due < today } });
      await updateIn(tx, sys, "service", s.id, { review_warned_for: due }, { trusted: true, keepVersion: true, allowLocked: true });
    });
    n++;
  }
  return n;
}

/** Agreements past their end become «پایان‌یافته». */
export async function expireAgreements(sys: Ctx): Promise<number> {
  const today = todayISO(String(sys.org.settings?.timezone ?? "Asia/Tehran"));
  const rows = await liveRows(sys.db, sys, "service_agreement", { and: [{ f: "status", op: "eq", v: "active" }, { f: "valid_to", op: "lt", v: today }] }, { limit: 2000 });
  for (const r of rows) await sys.write((tx) => updateIn(tx, sys, "service_agreement", r.id, { status: "expired" }, { trusted: true }));
  return rows.length;
}

/** Hourly: statuses; daily: scores, reminders, agreements and technology findings. */
export async function portfolioSweep(sys: Ctx): Promise<{ pending: boolean }> {
  const any = await liveRows(sys.db, sys, "service", null, { limit: 1 });
  if (!any.length) return { pending: false };
  await sys.write((tx) => refreshStatuses(tx, sys)).catch((e) => sys.cfg.log?.warn?.("service status", { error: (e as Error).message }));
  const tz = String(sys.org.settings?.timezone ?? "Asia/Tehran");
  const yesterday = addDays(todayISO(tz), -1);
  const [fact] = await liveRows(sys.db, sys, "service_score_fact", { f: "day", op: "eq", v: yesterday }, { limit: 1 });
  if (!fact) {
    await sys.write((tx) => scoreDay(tx, sys, { day: yesterday })).catch((e) => sys.cfg.log?.warn?.("service score", { error: (e as Error).message }));
    await reviewReminders(sys).catch(() => undefined);
    await expireAgreements(sys).catch(() => undefined);
    await sys.write((tx) => technologyFindings(tx, sys)).catch(() => undefined);
  }
  return { pending: true };
}

async function sysFor(job: { org_id: string | null }, jctx: JobContext): Promise<Ctx | null> {
  return job.org_id ? systemCtx(jctx.cfg, job.org_id) : null;
}

export function installPortfolioJobs(): (() => void)[] {
  return [
    onRecordEvent("service_portfolio.status", async (e, jctx) => {
      if (!actsHere(jctx.cfg) || !touchesStatus(e)) return;
      await enqueue(jctx.db, { kind: "service.status", orgId: e.org_id, delayMs: 3_000, dedupeKey: "service.status", maxAttempts: 5 });
    }, { tables: ["incident", "ci", "service"], kinds: ["record.created", "record.updated", "record.state_changed", "record.deleted"] }),
    registerJobHandler("service.status", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg)) return;
      await sys.write((tx) => refreshStatuses(tx, sys));
      await ensurePortfolioSweep(jctx.db, sys.org.id);
    }),
    registerJobHandler("service.seed", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys) return;
      await sys.write((tx) => seedPortfolioDefaultsIn(tx, sys));
      await ensurePortfolioSweep(jctx.db, sys.org.id);
    }),
    registerJobHandler("service.sweep", async (job, jctx) => {
      const sys = await sysFor(job, jctx);
      if (!sys || !actsHere(jctx.cfg)) return;
      const r = await portfolioSweep(sysOf(sys));
      return r.pending ? { again: SWEEP_EVERY } : undefined;
    }),
  ];
}
