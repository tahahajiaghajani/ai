// Services of supplier and contract management (catalogue SUP-005/009/010/011/013/015/020/042): the renewal calendar
// (notice deadlines and ends of contracts, SaaS renewals, ends of entitlements, warranties and leases, obligations —
// read with the caller's access), a contract's renewal (a draft copy with its lines and coverage), the supplier 360,
// the monthly scorecards (delivery from purchase orders, quality from repairs of the assets it supplied, obligations
// kept, review ratings), the daily sweep (reminders once per threshold, expiry or automatic renewal, overdue
// obligations) and clause extraction from the contract's smart document or attachment (AI with a rule-based fallback).
import type { Cond } from "@shared/model/conditions";
import type { ExtractResult, Renewals, Supplier360 } from "@shared/financial/api";
import { addJalaliMonths, calendarMonths, dueReminder, endOutcome, monthKey, periodLabel, ratingToScore, reminderList, supplierScore, type CalendarEntry } from "@shared/supplier/logic";
import { extractContract } from "@shared/supplier/extract";
import { SUPPLIER_CONFIG_DEFAULTS } from "@shared/tables/supplier";
import { addDays, fromJalali, monthLength, toJalali } from "@shared/jalali";
import { D } from "@shared/money";
import type { Ctx } from "../../context";
import { bad, conflict, forbidden } from "../../http/errors";
import { access } from "../../access/provider";
import { createIn, defFor, emitEvent, get, list, listAttachments, readAttachment, transitionIn, updateIn } from "../../engine";
import { parseFile } from "../ai/rag/parsers";
import { storedPages } from "../ai/rag/docs";
import { configRow, hasGroup, holds, isUuid, liveRow, liveRows, orgToday, sysOf, type Row } from "../itam/common";

export const supplierConfig = (q: Ctx["db"], ctx: Ctx) => configRow(q, ctx, "supplier_config", SUPPLIER_CONFIG_DEFAULTS);

// ---------------------------------------------------------------------------------------------------------------
// The renewal calendar (SUP-009)

export async function renewals(ctx: Ctx, months = 12): Promise<Renewals> {
  const today = orgToday(ctx);
  const j = toJalali(today);
  const startMonth = fromJalali(j.jy, j.jm, 1);
  const lastIdx = j.jy * 12 + (j.jm - 1) + Math.max(1, Math.min(36, months)) - 1;
  const end = fromJalali(Math.floor(lastIdx / 12), (lastIdx % 12) + 1, monthLength(Math.floor(lastIdx / 12), (lastIdx % 12) + 1));
  const entries: CalendarEntry[] = [];
  const financial = await hasGroup(ctx, "financial");
  const window = (f: string): Cond => ({ f, op: "between", v: [addDays(startMonth, -60), end] });
  if (await holds(ctx, "contract", "read")) {
    const r = await list(ctx, "contract", { filter: { and: [{ f: "state", op: "in", v: ["active", "negotiation", "pending_approval"] }, { or: [window("end_date"), window("notice_date")] }] }, size: 1000, total: false, fields: ["number", "name", "end_date", "notice_date", "annual_value", "renewal_type", "state"] });
    for (const c of r.rows) {
      const amount = financial ? ((c.annual_value as string) ?? null) : null;
      if (c.notice_date) entries.push({ date: String(c.notice_date), kind: "notice", table: "contract", id: String(c.id), title: String(c.name ?? ""), number: (c.number as string) ?? null, amount });
      if (c.end_date) entries.push({ date: String(c.end_date), kind: c.renewal_type === "auto" ? "renewal" : "end", table: "contract", id: String(c.id), title: String(c.name ?? ""), number: (c.number as string) ?? null, amount });
    }
    const o = await list(ctx, "contract_obligation", { filter: { and: [{ f: "state", op: "in", v: ["open", "in_progress", "waiting"] }, window("due_date")] }, size: 500, total: false, fields: ["number", "title", "due_date"] }).catch(() => null);
    for (const x of o?.rows ?? []) entries.push({ date: String(x.due_date), kind: "obligation", table: "contract_obligation", id: String(x.id), title: String(x.title ?? ""), number: (x.number as string) ?? null });
    const g = await list(ctx, "contract_guarantee", { filter: { and: [{ f: "state", op: "eq", v: "active" }, window("expiry_date")] }, size: 500, total: false, fields: ["number", "reference_no", "kind", "expiry_date", "amount"] }).catch(() => null);
    for (const x of g?.rows ?? []) entries.push({ date: String(x.expiry_date), kind: "guarantee", table: "contract_guarantee", id: String(x.id), title: String(x.reference_no ?? x.number ?? ""), number: (x.number as string) ?? null, amount: financial ? ((x.amount as string) ?? null) : null });
  }
  if (await holds(ctx, "software", "read")) {
    const s = await list(ctx, "saas_subscription", { filter: { and: [{ f: "state", op: "in", v: ["trial", "active", "cancel_pending"] }, window("renewal_date")] }, size: 500, total: false, fields: ["number", "name", "renewal_date", "annual_cost"] });
    for (const x of s.rows) entries.push({ date: String(x.renewal_date), kind: "renewal", table: "saas_subscription", id: String(x.id), title: String(x.name ?? ""), number: (x.number as string) ?? null, amount: financial ? ((x.annual_cost as string) ?? null) : null });
    const e = await list(ctx, "license_entitlement", { filter: { and: [{ f: "state", op: "eq", v: "active" }, window("end_date")] }, size: 500, total: false, fields: ["number", "name", "end_date", "total_cost"] });
    for (const x of e.rows) entries.push({ date: String(x.end_date), kind: "entitlement", table: "license_entitlement", id: String(x.id), title: String(x.name ?? ""), number: (x.number as string) ?? null, amount: financial ? ((x.total_cost as string) ?? null) : null });
  }
  if (await holds(ctx, "asset", "read")) {
    const a = await list(ctx, "asset", { filter: { and: [{ f: "state", op: "nin", v: ["disposed", "canceled", "retired"] }, { or: [window("warranty_end"), window("lease_end")] }] }, size: 1000, total: false, fields: ["number", "name", "warranty_end", "lease_end"] });
    for (const x of a.rows) {
      if (x.warranty_end && String(x.warranty_end) >= addDays(startMonth, -60) && String(x.warranty_end) <= end) entries.push({ date: String(x.warranty_end), kind: "warranty", table: "asset", id: String(x.id), title: String(x.name ?? ""), number: (x.number as string) ?? null });
      if (x.lease_end && String(x.lease_end) >= addDays(startMonth, -60) && String(x.lease_end) <= end) entries.push({ date: String(x.lease_end), kind: "lease", table: "asset", id: String(x.id), title: String(x.name ?? ""), number: (x.number as string) ?? null });
    }
  }
  const overdue = entries.filter((e) => e.date < today && (e.kind === "notice" || e.kind === "obligation")).sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcoming = entries.filter((e) => e.date >= startMonth);
  const in30 = addDays(today, 30);
  const in90 = addDays(today, 90);
  const value90 = upcoming.filter((e) => (e.kind === "end" || e.kind === "renewal") && e.date >= today && e.date <= in90 && e.amount).reduce<ReturnType<typeof D>>((a, e) => a.plus(D(e.amount)), D(0));
  return {
    months: calendarMonths(upcoming, today, months),
    overdue,
    counts: {
      notice_30: upcoming.filter((e) => e.kind === "notice" && e.date >= today && e.date <= in30).length,
      end_90: upcoming.filter((e) => (e.kind === "end" || e.kind === "renewal") && e.date >= today && e.date <= in90).length,
      auto: upcoming.filter((e) => e.kind === "renewal" && e.table === "contract").length,
      value_90: financial ? value90.toString() : null,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Renewal (SUP-009/010)

/** A draft renewal: the contract copied from its end (lines and coverage too), linked as `previous_contract_id`. */
export async function renewContract(ctx: Ctx, id: string, input: { start_date?: string | null; end_date?: string | null; value?: string | null }): Promise<{ id: string; number: string | null }> {
  const { row } = await get(ctx, "contract", id);
  const { def } = await defFor(ctx, "contract");
  if (!access().canCreate(ctx, def, null)) throw forbidden("اجازهٔ ثبت قرارداد را ندارید");
  if (!["active", "expired"].includes(String(row.state))) throw conflict("فقط قرارداد فعال یا منقضی تمدید می‌شود");
  const [already] = await liveRows(ctx.db, sysOf(ctx), "contract", { and: [{ f: "previous_contract_id", op: "eq", v: id }, { f: "state", op: "nin", v: ["canceled"] }] } as Cond, { limit: 1 });
  if (already) throw conflict(`تمدید این قرارداد پیش‌تر ثبت شده است (${already.number ?? ""})`);
  const start = input.start_date ?? (row.end_date ? addDays(String(row.end_date), 1) : orgToday(ctx));
  const months = Number(row.renewal_term_months ?? 12);
  const end = input.end_date ?? addDays(addJalaliMonths(start, months), -1);
  if (end < start) throw bad("پایان تمدید پیش از شروع آن است");
  const copy: Row = {};
  for (const f of ["supplier_id", "contract_type", "vendor_ref", "owner_id", "owner_group_id", "parent_id", "notice_period_days", "renewal_type", "renewal_term_months", "reminder_days", "annual_value", "payment_frequency", "currency", "cost_center_id", "cost_type_id", "service_id", "sla_definitions", "uc_targets", "terms", "confidential", "access_list"]) {
    if (row[f] !== undefined && row[f] !== null) copy[f] = row[f];
  }
  const created = await ctx.write(async (tx) => {
    const c = await createIn(tx, ctx, "contract", { ...copy, name: `${String(row.name ?? "")} — تمدید`.slice(0, 200), state: "draft", start_date: start, end_date: end, value: input.value ?? row.value ?? null, previous_contract_id: id });
    const sys = sysOf(ctx, ctx.user.id);
    for (const l of await liveRows(tx, sys, "contract_line", { f: "contract_id", op: "eq", v: id } as Cond, { limit: 2000 })) {
      await createIn(tx, ctx, "contract_line", { contract_id: c.id, description: l.description, quantity: l.quantity, unit_price: l.unit_price, period: l.period, model_id: l.model_id, software_model_id: l.software_model_id });
    }
    for (const v of await liveRows(tx, sys, "contract_coverage", { f: "contract_id", op: "eq", v: id } as Cond, { limit: 5000 })) {
      await createIn(tx, ctx, "contract_coverage", { contract_id: c.id, target_kind: v.target_kind, asset_id: v.asset_id, ci_id: v.ci_id, service_id: v.service_id, software_model_id: v.software_model_id, location_id: v.location_id, coverage_level: v.coverage_level, valid_from: start, valid_to: end, note: v.note });
    }
    return c;
  });
  return { id: String(created.id), number: (created.number as string) ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// The supplier 360 (SUP-042)

export async function supplier360(ctx: Ctx, id: string): Promise<Supplier360> {
  const { row } = await get(ctx, "supplier", id);
  const financial = await hasGroup(ctx, "financial");
  const today = orgToday(ctx);
  const contracts = (await holds(ctx, "contract", "read")) ? (await list(ctx, "contract", { filter: { f: "supplier_id", op: "eq", v: id }, sort: "-end_date", size: 100, total: false, fields: ["number", "name", "contract_type", "state", "end_date", "annual_value"] })).rows : [];
  const obligations = contracts.length ? (await list(ctx, "contract_obligation", { filter: { and: [{ f: "contract_id", op: "in", v: contracts.map((c) => c.id) }, { f: "state", op: "in", v: ["open", "in_progress", "waiting", "breached"] }] }, sort: "due_date", size: 50, total: false, fields: ["number", "title", "due_date", "state"] }).catch(() => null))?.rows ?? [] : [];
  const cards = (await list(ctx, "supplier_scorecard", { filter: { f: "supplier_id", op: "eq", v: id }, sort: "-period", size: 12, total: false }).catch(() => null))?.rows ?? [];
  let assets = { total: 0, in_use: 0, in_repair: 0 };
  let repairs = 0;
  if (await holds(ctx, "asset", "read")) {
    const a = await list(ctx, "asset", { filter: { f: "vendor_id", op: "eq", v: id }, size: 1, total: true, fields: ["number"] });
    const u = await list(ctx, "asset", { filter: { and: [{ f: "vendor_id", op: "eq", v: id }, { f: "state", op: "eq", v: "in_use" }] }, size: 1, total: true, fields: ["number"] });
    const r = await list(ctx, "asset", { filter: { and: [{ f: "vendor_id", op: "eq", v: id }, { f: "state", op: "eq", v: "in_repair" }] }, size: 1, total: true, fields: ["number"] });
    assets = { total: a.total ?? 0, in_use: u.total ?? 0, in_repair: r.total ?? 0 };
    repairs = (await list(ctx, "repair_order", { filter: { f: "vendor_id", op: "eq", v: id }, size: 1, total: true, fields: ["number"] }).catch(() => null))?.total ?? 0;
  }
  let orders = { open: 0, late: 0 };
  if (await holds(ctx, "procurement", "read")) {
    const open = await list(ctx, "purchase_order", { filter: { and: [{ f: "supplier_id", op: "eq", v: id }, { f: "state", op: "in", v: ["ordered", "partially_received"] }] }, size: 200, total: false, fields: ["expected_date"] });
    orders = { open: open.rows.length, late: open.rows.filter((o) => o.expected_date && String(o.expected_date) < today).length };
  }
  let spend: Supplier360["spend"] = null;
  if (financial && (await holds(ctx, "financial", "read"))) {
    const jy = toJalali(today).jy;
    const from = fromJalali(jy, 1, 1);
    const entries = await list(ctx, "cost_entry", { filter: { and: [{ f: "supplier_id", op: "eq", v: id }, { f: "entry_date", op: "gte", v: from }] }, size: 5000, total: false, fields: ["amount", "source"] }).catch(() => null);
    const by = new Map<string, ReturnType<typeof D>>();
    for (const e of entries?.rows ?? []) by.set(String(e.source), (by.get(String(e.source)) ?? D(0)).plus(D(e.amount)));
    spend = { year: jy, total: [...by.values()].reduce<ReturnType<typeof D>>((a, b) => a.plus(b), D(0)).toString(), by_source: [...by.entries()].map(([source, amount]) => ({ source, amount: amount.toString() })) };
  }
  return {
    supplier: { id, name: String(row.name ?? ""), state: String(row.state), score: (row.score as number) ?? null },
    contracts: contracts.map((c) => ({ id: String(c.id), number: (c.number as string) ?? null, name: String(c.name ?? ""), type: (c.contract_type as string) ?? null, state: String(c.state), end_date: (c.end_date as string) ?? null, annual_value: financial ? ((c.annual_value as string) ?? null) : null })),
    obligations: obligations.map((o) => ({ id: String(o.id), number: (o.number as string) ?? null, title: String(o.title ?? ""), due_date: (o.due_date as string) ?? null, state: String(o.state) })),
    scorecards: cards.map((c) => ({ period: String(c.period), label: String(c.period_label ?? periodLabel(String(c.period))), score: (c.score as number) ?? null, delivery: (c.delivery_score as number) ?? null, quality: (c.quality_score as number) ?? null, sla: (c.sla_score as number) ?? null, review: (c.review_score as number) ?? null })),
    assets,
    repairs,
    orders,
    spend,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Scorecards (SUP-020)

/** The scorecard of every active supplier for the month of `today` (as the system; replaces the month's card). */
export async function computeScorecards(sys: Ctx): Promise<{ suppliers: number }> {
  const cfg = await supplierConfig(sys.db, sys);
  const today = orgToday(sys);
  const period = monthKey(today);
  const j = toJalali(today);
  const yearAgo = addDays(today, -365);
  const suppliers = await liveRows(sys.db, sys, "supplier", { f: "state", op: "in", v: ["active", "under_review", "onboarding"] } as Cond, { limit: 5000 });
  let n = 0;
  for (const s of suppliers) {
    const pos = await liveRows(sys.db, sys, "purchase_order", { and: [{ f: "supplier_id", op: "eq", v: s.id }, { f: "state", op: "in", v: ["received", "closed", "partially_received", "ordered"] }, { f: "order_date", op: "gte", v: yearAgo }] } as Cond, { limit: 2000 });
    const due = pos.filter((p) => p.expected_date && String(p.expected_date) <= today);
    const onTime = due.filter((p) => p.received_at && String(p.received_at).slice(0, 10) <= String(p.expected_date)).length;
    const delivery = due.length ? Math.round((onTime / due.length) * 100) : null;
    const supplied = await liveRows(sys.db, sys, "asset", { f: "vendor_id", op: "eq", v: s.id } as Cond, { limit: 20000 });
    const repairs = supplied.length ? await liveRows(sys.db, sys, "repair_order", { and: [{ f: "asset_id", op: "in", v: supplied.slice(0, 500).map((a) => a.id) }, { f: "created_at", op: "gte", v: yearAgo }] } as Cond, { limit: 5000 }) : [];
    const quality = supplied.length ? Math.max(0, Math.round(100 - (repairs.length / supplied.length) * 200)) : null;
    const contracts = await liveRows(sys.db, sys, "contract", { f: "supplier_id", op: "eq", v: s.id } as Cond, { limit: 500 });
    const obls = contracts.length ? await liveRows(sys.db, sys, "contract_obligation", { and: [{ f: "contract_id", op: "in", v: contracts.map((c) => c.id) }, { f: "party", op: "eq", v: "supplier" }, { f: "due_date", op: "between", v: [yearAgo, today] }] } as Cond, { limit: 5000 }) : [];
    const kept = obls.filter((o) => o.state === "fulfilled" && (!o.fulfilled_at || String(o.fulfilled_at).slice(0, 10) <= String(o.due_date))).length;
    const sla = obls.length ? Math.round((kept / obls.length) * 100) : null;
    const reviews = await liveRows(sys.db, sys, "supplier_review", { and: [{ f: "supplier_id", op: "eq", v: s.id }, { f: "review_date", op: "gte", v: yearAgo }, { f: "overall", op: "nempty" }] } as Cond, { limit: 100 });
    const avg = reviews.length ? reviews.reduce((a, r) => a + Number(r.overall), 0) / reviews.length : null;
    const review = ratingToScore(avg);
    const score = supplierScore({ delivery, quality, sla, review }, cfg);
    const metrics = { orders_due: due.length, on_time: onTime, assets: supplied.length, repairs: repairs.length, obligations: obls.length, kept, reviews: reviews.length };
    await sys.write(async (tx) => {
      const [card] = await liveRows(tx, sys, "supplier_scorecard", { and: [{ f: "supplier_id", op: "eq", v: s.id }, { f: "period", op: "eq", v: period }] } as Cond, { limit: 1 });
      const values = { delivery_score: delivery, quality_score: quality, sla_score: sla, review_score: review, score, metrics, computed_at: new Date().toISOString(), period_label: periodLabel(period) };
      if (card) await updateIn(tx, sys, "supplier_scorecard", card.id, values, { trusted: true });
      else await createIn(tx, sys, "supplier_scorecard", { supplier_id: s.id, period, ...values }, { trusted: true });
      if ((s.score ?? null) !== score) await updateIn(tx, sys, "supplier", s.id, { score, score_at: new Date().toISOString() }, { trusted: true, keepVersion: true });
    });
    n++;
  }
  void j;
  return { suppliers: n };
}

// ---------------------------------------------------------------------------------------------------------------
// The daily sweep (SUP-009/011)

export async function supplierSweep(sys: Ctx): Promise<{ reminders: number; expired: number; renewed: number; overdue: number; guarantees: number }> {
  const cfg = await supplierConfig(sys.db, sys);
  const today = orgToday(sys);
  const out = { reminders: 0, expired: 0, renewed: 0, overdue: 0, guarantees: 0 };
  const contracts = await liveRows(sys.db, sys, "contract", { f: "state", op: "eq", v: "active" } as Cond, { limit: 20000 });
  for (const c of contracts) {
    const outcome = endOutcome(c, today);
    if (outcome.action === "expire" && cfg.expire_auto) {
      await sys.write((tx) => transitionIn(tx, sys, "contract", c.id, "expired", {}));
      await sys.write((tx) => emitEvent(tx, sys, { kind: "record.contract.expired", table: "contract", id: c.id, number: c.number ?? null, data: { users: [c.owner_id].filter(isUuid) } }));
      out.expired++;
      continue;
    }
    if (outcome.action === "renew") {
      await sys.write(async (tx) => {
        await updateIn(tx, sys, "contract", c.id, { end_date: outcome.end_date }, { trusted: true });
        await emitEvent(tx, sys, { kind: "record.contract.auto_renewed", table: "contract", id: c.id, number: c.number ?? null, data: { users: [c.owner_id].filter(isUuid), end_date: outcome.end_date } });
      });
      out.renewed++;
      continue;
    }
    const thresholds = reminderList(c.reminder_days, cfg.default_reminders as number[]);
    const sent = Array.isArray((c.reminded as Row | null)?.notice) ? ((c.reminded as Row).notice as number[]) : [];
    const target = c.notice_date ?? c.end_date;
    const r = dueReminder(target, today, thresholds, sent);
    if (!r) continue;
    await sys.write(async (tx) => {
      await emitEvent(tx, sys, { kind: "record.contract.renewal_due", table: "contract", id: c.id, number: c.number ?? null, data: { users: [c.owner_id].filter(isUuid), days_left: r.days_left, notice_date: c.notice_date, end_date: c.end_date, renewal_type: c.renewal_type } });
      await updateIn(tx, sys, "contract", c.id, { reminded: { ...((c.reminded ?? {}) as Row), notice: [...sent, r.threshold, ...r.skipped] } }, { trusted: true, keepVersion: true });
    });
    out.reminders++;
  }
  const obligations = await liveRows(sys.db, sys, "contract_obligation", { and: [{ f: "state", op: "in", v: ["open", "in_progress", "waiting"] }, { f: "due_date", op: "lte", v: addDays(today, 7) }] } as Cond, { limit: 5000 });
  for (const o of obligations) {
    // one reminder when the due date comes within a week and one when it passes (again if the due date moves)
    const stage = String(o.due_date) < today ? "overdue" : "soon";
    const rem = (o.reminded ?? {}) as { due?: string; sent?: string[] };
    const sent = rem.due === o.due_date && Array.isArray(rem.sent) ? rem.sent : [];
    if (sent.includes(stage)) continue;
    await sys.write(async (tx) => {
      await emitEvent(tx, sys, { kind: "record.contract.obligation_due", table: "contract_obligation", id: o.id, number: o.number ?? null, data: { users: [o.owner_id].filter(isUuid), due_date: o.due_date, overdue: stage === "overdue" } });
      await updateIn(tx, sys, "contract_obligation", o.id, { reminded: { due: o.due_date, sent: [...sent, stage] } }, { trusted: true, keepVersion: true });
    });
    out.overdue++;
  }
  // guarantees and deposits (SUP-012): reminders before the end of validity (60, 30, 7 days), then «منقضی»
  const guarantees = await liveRows(sys.db, sys, "contract_guarantee", { and: [{ f: "state", op: "eq", v: "active" }, { f: "expiry_date", op: "nempty" }] } as Cond, { limit: 5000 });
  for (const g of guarantees) {
    const users = [g.owner_id].filter(isUuid);
    if (String(g.expiry_date) < today) {
      await sys.write(async (tx) => {
        await transitionIn(tx, sys, "contract_guarantee", g.id, "expired", {});
        await emitEvent(tx, sys, { kind: "record.contract.guarantee_expired", table: "contract_guarantee", id: g.id, number: g.number ?? null, data: { users, expiry_date: g.expiry_date } });
      });
      out.guarantees++;
      continue;
    }
    const sent = Array.isArray((g.reminded as Row | null)?.expiry) ? ((g.reminded as Row).expiry as number[]) : [];
    const r = dueReminder(g.expiry_date, today, [60, 30, 7], sent);
    if (!r) continue;
    await sys.write(async (tx) => {
      await emitEvent(tx, sys, { kind: "record.contract.guarantee_due", table: "contract_guarantee", id: g.id, number: g.number ?? null, data: { users, days_left: r.days_left, expiry_date: g.expiry_date } });
      await updateIn(tx, sys, "contract_guarantee", g.id, { reminded: { ...((g.reminded ?? {}) as Row), expiry: [...sent, r.threshold, ...r.skipped] } }, { trusted: true, keepVersion: true });
    });
    out.guarantees++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Clause extraction (SUP-013; AI with a rule-based fallback)

/** The text of a contract: its smart document (OCR'd when scanned), else its first readable attachment. */
export async function contractText(ctx: Ctx, contract: Row): Promise<{ kind: "document" | "attachment" | "none"; name: string | null; pages: { page: number; text: string }[] }> {
  if (isUuid(contract.document_id)) {
    const doc = await get(ctx, "doc_document", contract.document_id).catch(() => null);
    if (doc) {
      const pages = await storedPages(ctx.db, ctx.org.id, String(contract.document_id));
      if (pages.length) return { kind: "document", name: String(doc.row.title ?? ""), pages: pages.map((p) => ({ page: p.page, text: p.text })) };
    }
  }
  const atts = await listAttachments(ctx, "contract", String(contract.id)).catch(() => null);
  for (const a of atts?.attachments ?? []) {
    if (!/pdf|word|text|officedocument|html/i.test(String(a.mime)) && !/\.(pdf|docx|txt|html?)$/i.test(String(a.name))) continue;
    const { data } = await readAttachment(ctx, a.id);
    const parsed = await parseFile(String(a.name), String(a.mime), data);
    if (parsed.pages.some((p) => p.text.trim())) return { kind: "attachment", name: String(a.name), pages: parsed.pages };
  }
  return { kind: "none", name: null, pages: [] };
}

const FIELD_LABELS: Record<string, string> = {
  start_date: "شروع", end_date: "پایان", value: "ارزش کل", notice_period_days: "مهلت اعلام (روز)", renewal_type: "تمدید", payment_frequency: "دورهٔ پرداخت", uc_targets: "تعهدهای سطح خدمت",
};

/** Suggestions for a contract from its text (fields the caller may change, values that differ), with evidence. */
export function shapeExtraction(contract: Row, fields: { field: string; value: unknown; evidence: string | null; page: number | null }[], writable: (f: string) => boolean): ExtractResult["suggestions"] {
  return fields
    .filter((f) => FIELD_LABELS[f.field] && writable(f.field))
    .filter((f) => String(contract[f.field] ?? "") !== String(f.value ?? ""))
    .map((f) => ({ field: f.field, label: FIELD_LABELS[f.field], value: f.value, current: contract[f.field] ?? null, evidence: f.evidence, page: f.page }));
}

export function ruleExtraction(contract: Row, pages: { page: number; text: string }[], writable: (f: string) => boolean): Pick<ExtractResult, "suggestions" | "obligations" | "summary"> {
  const r = extractContract(pages);
  return {
    suggestions: shapeExtraction(contract, r.fields, writable),
    obligations: r.obligations.map((o) => ({ title: o.title, party: o.party, due_hint: o.due_hint, evidence: o.evidence })),
    summary: null,
  };
}

export { periodLabel };
