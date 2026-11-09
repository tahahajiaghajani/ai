// Background work of IT asset management. Everything acts once — on the web version, or on a Windows app that is not
// linked to one (`actsHere`): a linked Windows app pushes its writes and the web version reacts when it applies them.
//
//   itam.ci_link        the CI of a new asset, through the CMDB's reconciliation engine (ITAM-002)
//   itam.stock_check    stock rules re-checked after stock moved (alerts, automatic requisitions — ITAM-015)
//   itam.sw_sync        installations from the CMDB's runs_on relationships, then a reconciliation (ITAM-050)
//   itam.reconcile      the effective licence position (debounced after entitlement and install changes — ITAM-058)
//   itam.renormalize    installs matched again after a software model's patterns changed (ITAM-048)
//   itam.sweep          daily per organisation: book values (ITAM-042), warranty and lease reminders (ITAM-034/041),
//                       acknowledgement reminders and expiry (ITAM-010), overdue loaners (ITAM-012), entitlement and
//                       SaaS renewal reminders and expiry (ITAM-053/070), the discovery sync and reconciliation
//   subscriber itam.ci       a CI's serial or retirement noted on its asset (ITAM-002)
//   subscriber itam.request  requested items of catalogue items bound to models: an asset reserved when fulfilment
//                            starts (else a purchase requisition), handed over when delivered, released when
//                            cancelled (ITAM-020/021)
import type { Cond } from "@shared/model/conditions";
import { depreciation, type DepMethod } from "@shared/itam/logic";
import { dueReminder, reminderList } from "@shared/supplier/logic";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { addJournalIn, createIn, emitEvent, onRecordEvent, systemCtx, transitionIn, updateIn, type RecordEvent } from "../../engine";
import { enqueue, registerJobHandler, type JobContext } from "../../jobs";
import { actsHere, notifyPeople } from "../notify";
import { eqAll, isUuid, itamConfig, liveRow, liveRows, orgToday, type Row } from "./common";
import { assetsForDiscovered, fromCi, linkCi } from "./assets";
import { checkStockRules } from "./stock";
import { reconcile, renormalize, syncInstalls } from "./sam";
import { setHandOver } from "./hooks";

export const SWEEP_EVERY = 24 * 3600_000;
const lastSweep = new Map<string, number>();

/** Queue the organisation's daily sweep (at most once per hour per process; one queued job per organisation). */
export async function ensureItamSweep(q: JobContext["db"], orgId: string, delayMs = 5 * 60_000): Promise<void> {
  if (Date.now() - (lastSweep.get(orgId) ?? 0) < 3600_000) return;
  lastSweep.set(orgId, Date.now());
  await enqueue(q, { kind: "itam.sweep", orgId, delayMs, dedupeKey: "itam.sweep", maxAttempts: 5 });
}
export const resetItamSweepThrottle = () => lastSweep.clear();

const sentOf = (row: Row, key: string): number[] => {
  const r = (row.reminded ?? {}) as Record<string, unknown>;
  return Array.isArray(r[key]) ? (r[key] as number[]) : [];
};
const withSent = (row: Row, key: string, values: number[]): Row => ({ ...((row.reminded ?? {}) as Row), [key]: values });

export interface ItamSweepResult {
  book_values: number;
  reminders: number;
  expired: number;
  acks_reminded: number;
  acks_expired: number;
  overdue: number;
}

/** The daily sweep of an organisation (as the system). */
export async function itamSweep(sys: Ctx): Promise<ItamSweepResult> {
  const today = orgToday(sys);
  const cfg = await itamConfig(sys.db, sys);
  const out: ItamSweepResult = { book_values: 0, reminders: 0, expired: 0, acks_reminded: 0, acks_expired: 0, overdue: 0 };
  const month = today.slice(0, 7);

  // book values of depreciating assets (once a month per asset)
  const rules = new Map((await liveRows(sys.db, sys, "depreciation_rule", null, { limit: 500 })).map((r) => [String(r.id), r]));
  const assets = await liveRows(sys.db, sys, "asset", { and: [{ f: "purchase_cost", op: "nempty" }, { f: "depreciation_rule_id", op: "nempty" }, { f: "state", op: "nin", v: ["disposed", "canceled", "on_order"] }] } as Cond, { limit: 50000 });
  const due = assets.filter((a) => !a.book_value_at || String(a.book_value_at).slice(0, 7) !== month);
  for (let i = 0; i < due.length; i += 200) {
    await sys.write(async (tx) => {
      for (const a of due.slice(i, i + 200)) {
        const rule = rules.get(String(a.depreciation_rule_id));
        const start = String((rule?.start_basis === "purchase" ? a.purchase_date : a.in_service_date || a.purchase_date) ?? "");
        if (!rule || !start) continue;
        const salvage = a.salvage_value ?? (rule.salvage_percent ? String((Number(a.purchase_cost) * Number(rule.salvage_percent)) / 100) : "0");
        const d = depreciation({ cost: a.purchase_cost, salvage, lifeMonths: Number(rule.life_months ?? 36), method: rule.method as DepMethod, ratePercent: rule.rate_percent, start, asOf: today });
        await updateIn(tx, sys, "asset", a.id, { book_value: d.bookValue, accumulated_depreciation: d.accumulated, book_value_at: today }, { trusted: true, keepVersion: true });
        out.book_values++;
      }
    });
  }

  // warranty and lease reminders
  const thresholds = reminderList(cfg.warranty_reminders, [90, 30, 7]);
  const live = await liveRows(sys.db, sys, "asset", { and: [{ f: "state", op: "nin", v: ["disposed", "canceled", "retired"] }, { or: [{ f: "warranty_end", op: "nempty" }, { f: "lease_end", op: "nempty" }] }] } as Cond, { limit: 50000 });
  for (const a of live) {
    const w = dueReminder(a.warranty_end, today, thresholds, sentOf(a, "warranty"));
    const l = dueReminder(a.lease_end, today, thresholds, sentOf(a, "lease"));
    if (!w && !l) continue;
    await sys.write(async (tx) => {
      let reminded = (a.reminded ?? {}) as Row;
      const users = [a.managed_by].filter(isUuid);
      if (w) {
        await emitEvent(tx, sys, { kind: "record.itam.warranty_expiring", table: "asset", id: a.id, number: a.number ?? null, data: { users, days_left: w.days_left, end: a.warranty_end } });
        reminded = withSent({ reminded }, "warranty", [...sentOf(a, "warranty"), w.threshold, ...w.skipped]);
        out.reminders++;
      }
      if (l) {
        await emitEvent(tx, sys, { kind: "record.itam.lease_ending", table: "asset", id: a.id, number: a.number ?? null, data: { users, days_left: l.days_left, end: a.lease_end } });
        reminded = withSent({ reminded }, "lease", [...sentOf(a, "lease"), l.threshold, ...l.skipped]);
        out.reminders++;
      }
      await updateIn(tx, sys, "asset", a.id, { reminded }, { trusted: true, keepVersion: true });
    });
  }

  // overdue loaners (once a day: the date is remembered)
  const loaners = await liveRows(sys.db, sys, "asset", { and: [{ f: "state", op: "eq", v: "in_use" }, { f: "usage_type", op: "eq", v: "loaner" }, { f: "expected_return_at", op: "lt", v: today }] } as Cond, { limit: 5000 });
  for (const a of loaners) {
    const r = (a.reminded ?? {}) as Row;
    if (r.overdue === today) continue;
    await sys.write(async (tx) => {
      await emitEvent(tx, sys, { kind: "record.itam.loaner_overdue", table: "asset", id: a.id, number: a.number ?? null, data: { users: [a.assigned_to, a.managed_by].filter(isUuid), due: a.expected_return_at } });
      await updateIn(tx, sys, "asset", a.id, { reminded: { ...r, overdue: today } }, { trusted: true, keepVersion: true });
    });
    out.overdue++;
  }

  // acknowledgements: reminders, then expiry
  const acks = await liveRows(sys.db, sys, "asset_acknowledgement", { f: "state", op: "eq", v: "pending" } as Cond, { limit: 10000 });
  const nowMs = Date.now();
  for (const k of acks) {
    const asked = Date.parse(String(k.requested_at ?? k.created_at));
    const last = Date.parse(String(k.reminded_at ?? k.requested_at ?? k.created_at));
    await sys.write(async (tx) => {
      if (nowMs - asked > cfg.ack_expire_days * 86400_000) {
        await transitionIn(tx, sys, "asset_acknowledgement", k.id, "expired", {});
        out.acks_expired++;
      } else if (nowMs - last > cfg.ack_remind_days * 86400_000) {
        await notifyPeople(tx, sys.org.id, { table: "asset_acknowledgement", id: k.id, users: [k.user_id].filter(isUuid), subject: "یادآوری: تعهدنامهٔ دارایی", body: `لطفاً تحویل ${k.label ?? "دارایی"} را در «دارایی‌های من» تأیید کنید.`, source: "دارایی‌ها" });
        await updateIn(tx, sys, "asset_acknowledgement", k.id, { reminded_at: new Date().toISOString() }, { trusted: true });
        out.acks_reminded++;
      }
    });
  }

  // entitlements: reminders before the end, expiry after it
  const ents = await liveRows(sys.db, sys, "license_entitlement", { and: [{ f: "state", op: "eq", v: "active" }, { f: "end_date", op: "nempty" }] } as Cond, { limit: 20000 });
  for (const e of ents) {
    await sys.write(async (tx) => {
      if (String(e.end_date) < today) {
        await transitionIn(tx, sys, "license_entitlement", e.id, "expired", {});
        out.expired++;
        return;
      }
      const r = dueReminder(e.end_date, today, [90, 60, 30, 7], sentOf(e, "end"));
      if (!r) return;
      await emitEvent(tx, sys, { kind: "record.itam.entitlement_expiring", table: "license_entitlement", id: e.id, number: e.number ?? null, data: { users: [e.owner_id].filter(isUuid), days_left: r.days_left, end: e.end_date } });
      await updateIn(tx, sys, "license_entitlement", e.id, { reminded: withSent(e, "end", [...sentOf(e, "end"), r.threshold, ...r.skipped]) }, { trusted: true, keepVersion: true });
      out.reminders++;
    });
  }

  // SaaS renewals
  const subs = await liveRows(sys.db, sys, "saas_subscription", { and: [{ f: "state", op: "in", v: ["trial", "active", "cancel_pending"] }, { f: "renewal_date", op: "nempty" }] } as Cond, { limit: 5000 });
  for (const s of subs) {
    const r = dueReminder(s.renewal_date, today, [90, 60, 30, 7], sentOf(s, "renewal"));
    if (!r) continue;
    await sys.write(async (tx) => {
      await emitEvent(tx, sys, { kind: "record.itam.saas_renewal", table: "saas_subscription", id: s.id, number: s.number ?? null, data: { users: [s.owner_id].filter(isUuid), days_left: r.days_left, renewal: s.renewal_date, seats: s.seats, active: s.seats_active } });
      await updateIn(tx, sys, "saas_subscription", s.id, { reminded: withSent(s, "renewal", [...sentOf(s, "renewal"), r.threshold, ...r.skipped]) }, { trusted: true, keepVersion: true });
    });
    out.reminders++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Requested items of catalogue items bound to models (ITAM-020/021)

async function onRequestItem(e: RecordEvent, sys: Ctx): Promise<void> {
  if (e.kind !== "record.state_changed" || !isUuid(e.id)) return;
  const to = String((e as unknown as { to?: string }).to ?? "");
  const item = await liveRow(sys.db, sys, "request_item", e.id);
  if (!item) return;
  const reserved = await liveRows(sys.db, sys, "asset", { f: "request_item_id", op: "eq", v: item.id } as Cond, { limit: 100 });
  if (to === "in_fulfilment") {
    if (reserved.length || !isUuid(item.cat_item_id)) return;
    const bindings = await liveRows(sys.db, sys, "catalog_item_model", { f: "catalog_item_id", op: "eq", v: item.cat_item_id } as Cond, { order: "t.preference, t.created_at", limit: 10 });
    if (!bindings.length) return;
    const qty = Math.max(1, Number(item.quantity ?? 1));
    await sys.write(async (tx) => {
      const notes: string[] = [];
      let missing = qty;
      for (const b of bindings) {
        if (!b.consume_stock || missing <= 0) continue;
        const free = await liveRows(tx, sys, "asset", eqAll({ model_id: b.model_id, state: "in_stock", substate: "available" }), { order: "t.received_at nulls last, t.no", limit: missing });
        for (const a of free) {
          await updateIn(tx, sys, "asset", a.id, { substate: "reserved", reserved_for: item.requested_for ?? item.caller_id ?? null, request_item_id: item.id }, { trusted: true });
          notes.push(`${a.number ?? ""} (${a.name ?? ""})`);
          missing--;
        }
      }
      const rdef = tableDef("request_item");
      if (notes.length && rdef) await addJournalIn(tx, sys, rdef, item, { kind: "work_note", body: `از موجودی رزرو شد: ${notes.join("، ")}` }, { trusted: true });
      const buy = bindings.find((b) => b.raise_purchase);
      if (missing > 0 && buy) {
        const prq = await createIn(tx, sys, "purchase_requisition", {
          title: `تأمین برای ${item.number ?? "قلم درخواست"}`, source: "request", request_item_id: item.id, requested_for: item.requested_for ?? item.caller_id ?? null,
          justification: `موجودی کافی برای «${item.short_description ?? ""}» نیست (${missing} عدد).`,
        }, { trusted: true });
        await createIn(tx, sys, "purchase_requisition_line", { requisition_id: prq.id, model_id: buy.model_id, quantity: missing }, { trusted: true });
        if (rdef) await addJournalIn(tx, sys, rdef, item, { kind: "work_note", body: `موجودی کافی نبود؛ درخواست خرید ${prq.number ?? ""} ثبت شد.` }, { trusted: true });
      }
    });
    return;
  }
  if (["delivered", "closed_complete"].includes(to)) {
    const holder = item.requested_for ?? item.caller_id ?? null;
    if (!isUuid(holder)) return;
    await sys.write(async (tx) => {
      for (const a of reserved) {
        if (a.state !== "in_stock" || a.substate !== "reserved") continue;
        setHandOver(tx, a.id, { request_item_id: item.id, note: `تحویل با ${item.number ?? ""}` });
        await transitionIn(tx, sys, "asset", a.id, "in_use", { assigned_to: holder, location_id: item.location_id ?? a.location_id ?? null, substate: "assigned" });
      }
    });
    return;
  }
  if (["cancelled", "rejected", "closed_incomplete"].includes(to)) {
    await sys.write(async (tx) => {
      for (const a of reserved) if (a.state === "in_stock" && a.substate === "reserved") await updateIn(tx, sys, "asset", a.id, { substate: "available", reserved_for: null, request_item_id: null }, { trusted: true });
    });
  }
}

export function installItamJobs(): (() => void)[] {
  return [
    registerJobHandler("itam.ci_link", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      const id = String((job.payload as { id?: string }).id ?? "");
      if (isUuid(id)) await linkCi(sys, id);
    }),
    registerJobHandler("itam.stock_check", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      await checkStockRules(await systemCtx(jctx.cfg, job.org_id));
    }),
    registerJobHandler("itam.reconcile", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const trigger = (job.payload as { trigger?: "manual" | "schedule" | "change" }).trigger ?? "change";
      await reconcile(await systemCtx(jctx.cfg, job.org_id), trigger);
    }),
    registerJobHandler("itam.renormalize", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const r = await renormalize(await systemCtx(jctx.cfg, job.org_id));
      if (r.changed) await enqueue(jctx.db, { kind: "itam.reconcile", orgId: job.org_id, payload: { trigger: "change" }, dedupeKey: "itam.reconcile", delayMs: 5000, maxAttempts: 3 });
    }),
    registerJobHandler("itam.sw_sync", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await syncInstalls(sys);
      await reconcile(sys, "schedule");
    }),
    registerJobHandler("itam.sweep", async (job, jctx) => {
      if (!job.org_id || !actsHere(jctx.cfg)) return;
      const sys = await systemCtx(jctx.cfg, job.org_id);
      await itamSweep(sys);
      await syncInstalls(sys).catch(() => undefined);
      if ((await itamConfig(sys.db, sys)).auto_assets !== false) await assetsForDiscovered(sys, 200).catch(() => undefined);
      await reconcile(sys, "schedule").catch(() => undefined);
      return { again: SWEEP_EVERY };
    }),
    onRecordEvent("itam.ci", async (e, jctx) => {
      if (!actsHere(jctx.cfg) || !isUuid(e.org_id) || !isUuid(e.id)) return;
      const changed = e.kind === "record.state_changed" ? ["state"] : Array.isArray((e as { changed?: string[] }).changed) ? (e as { changed: string[] }).changed : [];
      if (!changed.some((c) => c === "serial_number" || c === "state")) return;
      await fromCi(await systemCtx(jctx.cfg, e.org_id), e.id, changed);
    }, { tables: ["ci"], kinds: ["record.updated", "record.state_changed"] }),
    onRecordEvent("itam.request", async (e, jctx) => {
      if (!actsHere(jctx.cfg) || !isUuid(e.org_id)) return;
      await ensureItamSweep(jctx.db, e.org_id);
      await onRequestItem(e, await systemCtx(jctx.cfg, e.org_id));
    }, { tables: ["request_item"], kinds: ["record.state_changed"] }),
  ];
}
