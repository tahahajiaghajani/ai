// Behaviour of the ITAM tables on every write path (API, imports, flows, jobs), inside the write's transaction:
//
//   asset (before)  the model's category, class, depreciation rule and standard warranty; quantity 1 for individually
//                   tracked models; a name from the model and tag; the substate that fits the state; lifecycle stamps
//                   (received, deployed, retired, disposed); a check-in clears the assignee
//   asset (after)   an asset tag from the record number; the assignment history (asset_assignment: open on check-out,
//                   closed on check-in or hand-over); the stock movement ledger (receipt, issue, return, transfer,
//                   repair, adjustment, disposal); the acknowledgement on hand-over when the model asks for one; the
//                   linked CI kept in step (user, location, cost centre, serial, tag, install and operational status,
//                   retirement and disposal — ITAM-002) or queued for creation; stock rules re-checked
//   guards          asset_can_deploy (someone, a unit or a place), asset_can_dispose (data-bearing assets need a
//                   sanitisation method, time and certificate), disposal_can_complete, requisition_has_lines,
//                   po_has_lines, receipt_can_post
//   ledgers         stock movements and assignments are written by the module only (system)
//   procurement     line amounts and the requisition's and order's totals (once per transaction), lines only while
//                   the parent is a draft (a requisition's too: what its approvers approve is what is ordered), a
//                   requisition approved by someone else than whom it is for or who raised it, a goods receipt that
//                   posts at most what is left of each order line (summed over its lines, the order lines locked); a
//                   posted goods receipt creates the assets (dated on the organisation's calendar) and updates the order
//   repairs         the asset goes in repair and back (or retired when beyond repair); warranty cover detected
//   disposal        items (added only while the order is requested: approval covers them) retire their assets; a
//                   completed order disposes them with the sanitisation evidence
//   audits          starting one lists the expected assets; completing one records the results on the assets
//   software        installs normalised to software models (patterns), entitlement costs, seat counts of SaaS
//                   subscriptions, reconciliation queued after changes
import type { FieldDef, TableDef } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import { ASSET_STATES, MOVEMENT_KINDS } from "@shared/tables/itam";
import { assetTagFor, ciStatusOf, depreciation, matchSoftware, substateFor, type DepMethod } from "@shared/itam/logic";
import { addJalaliMonths } from "@shared/supplier/logic";
import { addDays, toJalali } from "@shared/jalali";
import { deviceClass, tagFromPattern } from "@shared/itam/bank";
import { D, mul, round } from "@shared/money";
import { addJournalIn, createIn, onBeforeCommit, pushGuard, registerHooks, transitionIn, updateIn, savepoint, type PushArgs, type TableHooks, type WriteArgs } from "../../engine";
import { access } from "../../access/provider";
import { bad, conflict, forbidden } from "../../http/errors";
import { enqueue } from "../../jobs";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { eqAll, isUuid, itamConfig, liveRow, liveRows, localDate, orgToday, sysOf, type Row } from "./common";

const entering = (w: WriteArgs, state: string) => w.next.state === state && (w.op === "create" || w.prev?.state !== state);
const leaving = (w: WriteArgs, state: string) => w.op !== "create" && w.prev?.state === state && w.next.state !== state;
const isSys = (ctx: Ctx) => ctx.actor === "system";
const now = () => new Date().toISOString();

/** Work a route hands to the asset's hooks for the write it is about to make (condition, note, request item). */
export interface HandOver {
  condition?: string | null;
  note?: string | null;
  request_item_id?: string | null;
  condition_in?: string | null;
}
const handOvers = new WeakMap<Tx, Map<string, HandOver>>();
export function setHandOver(tx: Tx, assetId: string, info: HandOver): void {
  let m = handOvers.get(tx);
  if (!m) handOvers.set(tx, (m = new Map()));
  m.set(assetId, info);
}
const handOverOf = (tx: Tx, assetId: string): HandOver => handOvers.get(tx)?.get(assetId) ?? {};

/** A child row (a line, an item) is changed by whoever may change its parent record; the system always may. */
export async function needParentWrite(w: WriteArgs, parentTable: string, field: string, opts: { draftStates?: string[] } = {}): Promise<Row | null> {
  const id = w.next?.[field] ?? w.prev?.[field];
  if (!isUuid(id)) return null;
  const parent = await liveRow(w.tx, sysOf(w.ctx), parentTable, id);
  if (!parent) throw bad("رکورد اصلی پیدا نشد");
  if (!isSys(w.ctx)) {
    const def = tableDef(parentTable)!;
    if (!access().canWrite(w.ctx, def, parent)) throw forbidden(`برای تغییر این ردیف باید بتوانید «${def.label}» را تغییر دهید`);
  }
  if (opts.draftStates && !opts.draftStates.includes(String(parent.state)) && !isSys(w.ctx)) {
    throw conflict(`${tableDef(parentTable)!.label} دیگر پیش‌نویس نیست و سطرهای آن تغییر نمی‌کند`);
  }
  return parent;
}

/** Ledgers the module writes itself (stock movements, assignment history). */
export function systemOnly(label: string) {
  return (w: WriteArgs) => {
    if (!isSys(w.ctx)) throw forbidden(`${label} را سامانه ثبت می‌کند و دستی تغییر نمی‌کند`);
  };
}

const modelOf = (w: WriteArgs, id: unknown) => liveRow(w.tx, sysOf(w.ctx), "asset_model", id);
const movementLabel = (kind: string) => MOVEMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;

// ---------------------------------------------------------------------------------------------------------------
// The asset

/** The book value of an asset today by its depreciation rule (null when it has no cost, rule or start date). */
export function bookValueOf(rule: Row | null | undefined, a: Row, today: string): { book_value: string; accumulated_depreciation: string; book_value_at: string } | null {
  if (!rule || a.purchase_cost === null || a.purchase_cost === undefined || a.purchase_cost === "") return null;
  const start = String((rule.start_basis === "purchase" ? a.purchase_date : a.in_service_date || a.purchase_date) ?? "");
  if (!start) return null;
  const salvage = a.salvage_value ?? (rule.salvage_percent ? String((Number(a.purchase_cost) * Number(rule.salvage_percent)) / 100) : "0");
  const d = depreciation({ cost: a.purchase_cost, salvage, lifeMonths: Number(rule.life_months ?? 36), method: rule.method as DepMethod, ratePercent: rule.rate_percent, start, asOf: today });
  return { book_value: d.bookValue, accumulated_depreciation: d.accumulated, book_value_at: today };
}

async function assetBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const today = orgToday(w.ctx);
  if (w.op === "create" || w.changed.has("model_id")) {
    const model = await modelOf(w, n.model_id);
    if (model) {
      if (w.op === "create" && model.status === "prohibited" && !w.trusted) throw conflict(`مدل «${model.name}» ممنوع است و دارایی تازه از آن ثبت نمی‌شود`);
      n.category = model.category ?? null;
      n.asset_class = model.asset_class ?? "hardware";
      if (model.tracking !== "quantity") n.quantity = 1;
      if (!n.depreciation_rule_id && model.depreciation_rule_id) n.depreciation_rule_id = model.depreciation_rule_id;
      if (w.op === "create" && !n.warranty_end && Number(model.warranty_months ?? 0) > 0) {
        const start = n.warranty_start || n.purchase_date || today;
        n.warranty_start = start;
        n.warranty_end = addDays(addJalaliMonths(String(start), Number(model.warranty_months)), -1);
      }
      if (!n.name) n.name = `${model.name}${n.asset_tag ? ` — ${n.asset_tag}` : n.serial_number ? ` — ${n.serial_number}` : ""}`.slice(0, 200);
    }
  }
  if (!n.name) n.name = String(n.asset_tag || n.serial_number || "دارایی");
  if (w.op === "create" || w.changed.has("state") || w.changed.has("substate")) {
    const fit = substateFor(String(n.state), n.substate);
    if (fit !== (n.substate ?? null)) n.substate = fit;
    if (n.state === "in_use" && n.usage_type === "loaner" && (n.substate === "assigned" || !n.substate)) n.substate = "loaner";
  }
  const at = now();
  if (entering(w, "in_stock") && !n.received_at) n.received_at = at;
  if (entering(w, "in_use")) {
    if (!n.deployed_at) n.deployed_at = at;
    if (!n.in_service_date) n.in_service_date = today;
  }
  if (n.state === "in_use" && (w.op === "create" || w.changed.has("assigned_to") || entering(w, "in_use")) && n.assigned_to) n.assigned_at = at;
  // a check-in ends the hand-over: nobody holds it in stock
  if (leaving(w, "in_use") && ["in_stock", "retired", "disposed"].includes(String(n.state))) {
    n.assigned_to = null;
    n.assigned_at = null;
    n.expected_return_at = null;
    n.usage_type = "permanent";
    n.reserved_for = null;
  }
  if (entering(w, "retired")) n.retired_at = at;
  if (entering(w, "disposed")) n.disposed_at = at;
  if (n.state === "in_stock" && n.substate !== "reserved" && w.changed.has("substate")) n.reserved_for = null;
  if (Number(n.quantity ?? 1) < 0) throw bad("تعداد نمی‌تواند منفی باشد");
  // the book value from the first day (the daily sweep moves it on every month), and as of the day it is retired or
  // disposed (what is written off at disposal is the value then, not last month's)
  if ((["purchase_cost", "purchase_date", "in_service_date", "depreciation_rule_id", "salvage_value"].some((f) => w.changed.has(f)) || entering(w, "retired") || entering(w, "disposed")) && n.depreciation_rule_id) {
    const rule = await liveRow(w.tx, sysOf(w.ctx), "depreciation_rule", n.depreciation_rule_id);
    const b = bookValueOf(rule, n, today);
    if (b) Object.assign(n, b);
  }
}

/** Open and close rows of the assignment history. */
async function assignmentHistory(w: WriteArgs, row: Row, prev: Row | null): Promise<void> {
  const holderChanged = ["assigned_to", "department_id", "location_id"].some((f) => w.changed.has(f));
  const using = row.state === "in_use";
  const wasUsing = prev?.state === "in_use";
  if (!using && !wasUsing) return;
  if (using && wasUsing && !holderChanged) return;
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  const info = handOverOf(w.tx, row.id);
  const open = await liveRows(w.tx, sys, "asset_assignment", { and: [{ f: "asset_id", op: "eq", v: row.id }, { f: "to_at", op: "empty" }] });
  const at = now();
  for (const a of open) await updateIn(w.tx, sys, "asset_assignment", a.id, { to_at: at, condition_in: info.condition_in ?? null }, { trusted: true });
  if (!using) return;
  const who = row.assigned_to ? String(row.assigned_to) : null;
  const created = await createIn(w.tx, sys, "asset_assignment", {
    asset_id: row.id, assigned_to: who, department_id: row.department_id ?? null, location_id: row.location_id ?? null, usage_type: row.usage_type ?? "permanent",
    from_at: at, expected_return_at: row.expected_return_at ?? null, condition_out: info.condition ?? null, note: info.note ?? null,
    request_item_id: info.request_item_id ?? row.request_item_id ?? null, assigned_by: w.ctx.actor === "system" ? null : w.ctx.user.id,
    label: `${row.number ?? ""} ${row.name ?? ""}`.trim().slice(0, 300),
  }, { trusted: true });
  // an acknowledgement when the model asks for one and a person receives it
  if (who) {
    const model = await liveRow(w.tx, sys, "asset_model", row.model_id);
    if (model?.requires_acknowledgement) {
      const ack = await createIn(w.tx, sys, "asset_acknowledgement", {
        asset_id: row.id, user_id: who, assignment_id: created.id, requested_at: at, terms: model.acknowledgement_terms ?? null,
        label: `${row.number ?? ""} — ${row.name ?? ""}`.slice(0, 300),
      }, { trusted: true });
      await updateIn(w.tx, sys, "asset_assignment", created.id, { acknowledgement_id: ack.id }, { trusted: true });
      await updateIn(w.tx, sys, "asset", row.id, { ack_state: "pending" }, { trusted: true, keepVersion: true });
    } else if (row.ack_state !== "none") {
      await updateIn(w.tx, sys, "asset", row.id, { ack_state: "none" }, { trusted: true, keepVersion: true });
    }
  }
}

/** The stock movement ledger: what entered or left which stockroom. */
async function stockMovements(w: WriteArgs, row: Row, prev: Row | null): Promise<void> {
  const before = prev && prev.state === "in_stock" && isUuid(prev.stockroom_id) ? { room: String(prev.stockroom_id), model: String(prev.model_id), qty: Number(prev.quantity ?? 1) } : null;
  const after = row.state === "in_stock" && isUuid(row.stockroom_id) ? { room: String(row.stockroom_id), model: String(row.model_id), qty: Number(row.quantity ?? 1) } : null;
  if (!before && !after) return;
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  const ref = String(row.number ?? "");
  const move = (kind: string, room: string, model: string, quantity: number) =>
    quantity === 0
      ? Promise.resolve()
      : createIn(w.tx, sys, "stock_movement", { kind, stockroom_id: room, model_id: model, asset_id: row.id, quantity, reference: ref, moved_by: w.ctx.actor === "system" ? null : w.ctx.user.id, label: `${movementLabel(kind)} — ${ref}`.slice(0, 300) }, { trusted: true }).then(() => undefined);
  if (before && after && before.room === after.room && before.model === after.model) {
    if (before.qty !== after.qty) await move("adjustment", after.room, after.model, after.qty - before.qty);
    return;
  }
  if (before) {
    const to = String(row.state);
    const kind = to === "in_use" ? "issue" : to === "in_repair" ? "repair_out" : to === "retired" || to === "disposed" ? "disposal" : "transfer_out";
    await move(kind, before.room, before.model, -before.qty);
  }
  if (after) {
    const from = prev ? String(prev.state) : null;
    const kind = !prev || from === "on_order" ? "receipt" : from === "in_use" ? "return" : from === "in_repair" ? "repair_in" : from === "in_transit" || from === "in_stock" ? "transfer_in" : "adjustment";
    await move(kind, after.room, after.model, after.qty);
  }
}

/** Keep the linked CI in step (ITAM-002): ITAM masters assignment, place, cost centre, tag and the lifecycle. */
async function syncCi(w: WriteArgs, row: Row): Promise<void> {
  if (!isUuid(row.ci_id)) return;
  const sys = sysOf(w.ctx);
  const ci = await liveRow(w.tx, sys, "ci", row.ci_id);
  if (!ci) return;
  const status = ciStatusOf(String(row.state), row.substate);
  const patch: Row = {};
  const want: Row = {
    used_by: row.state === "in_use" ? row.assigned_to ?? null : null,
    location_id: row.location_id ?? ci.location_id ?? null,
    serial_number: row.serial_number || ci.serial_number || null,
    asset_tag: row.asset_tag || ci.asset_tag || null,
  };
  if (isUuid(row.cost_center_id)) want.cost_center_id = row.cost_center_id;
  if (status.install_status) want.install_status = status.install_status;
  if (status.operational_status) want.operational_status = status.operational_status;
  for (const [k, v] of Object.entries(want)) if ((ci[k] ?? null) !== (v ?? null)) patch[k] = v;
  try {
    await savepoint(w.tx, async () => {
      if (Object.keys(patch).length) await updateIn(w.tx, sys, "ci", ci.id, patch, { trusted: true });
      const target = status.ci_state;
      if (target === "retired" && !["retired", "disposed"].includes(String(ci.state))) await transitionIn(w.tx, sys, "ci", ci.id, "retired", {});
      if (target === "disposed" && ci.state !== "disposed") {
        if (ci.state !== "retired") await transitionIn(w.tx, sys, "ci", ci.id, "retired", {});
        await transitionIn(w.tx, sys, "ci", ci.id, "disposed", { disposal_notes: `اسقاط دارایی ${row.number ?? ""}${row.certificate_no ? ` — گواهی پاک‌سازی ${row.certificate_no}` : ""}` });
      }
      if (target === "operational" && ["retired", "maintenance", "end_of_life", "planned", "on_order", "build", "test"].includes(String(ci.state))) {
        await transitionIn(w.tx, sys, "ci", ci.id, "operational", {}).catch(() => undefined);
      }
    });
  } catch (e) {
    await addJournalIn(w.tx, sys, w.def, row, { kind: "system", body: `پیکربندی ${ci.number ?? ""} همگام نشد: ${(e as Error).message}` }, { trusted: true }).catch(() => undefined);
  }
}

async function assetAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const row = w.next;
  const prev = w.prev;
  const sys = sysOf(w.ctx);
  if (w.op === "create" && !row.asset_tag) {
    const cfg = await itamConfig(w.tx, w.ctx);
    let tag = assetTagFor(cfg.tag_prefix, row.number);
    if (cfg.tag_pattern) {
      // the organisation's numbering («پلاک اموال»): branch code, device class code, Jalali year, record digits
      const branch = isUuid(row.branch_id) ? await liveRow(w.tx, sys, "org_unit", row.branch_id) : null;
      tag = tagFromPattern(String(cfg.tag_pattern), {
        prefix: cfg.tag_prefix, branch: (branch?.code as string) ?? null, cls: deviceClass(row.category)?.code ?? String(row.category ?? "").toUpperCase().slice(0, 4), year: toJalali(orgToday(w.ctx)).jy, number: row.number as string,
      }) ?? tag;
    }
    if (tag) {
      const name = row.name && !String(row.name).includes("—") && !row.serial_number ? `${row.name} — ${tag}` : row.name;
      await updateIn(w.tx, sys, "asset", row.id, { asset_tag: tag, name }, { trusted: true, keepVersion: true }).catch(() => undefined);
      row.asset_tag = tag;
    }
  }
  if (w.op === "create" || ["state", "assigned_to", "department_id", "location_id"].some((f) => w.changed.has(f))) await assignmentHistory(w, row, prev);
  if (w.op === "create" || ["state", "stockroom_id", "quantity", "model_id"].some((f) => w.changed.has(f))) await stockMovements(w, row, prev);
  if (isUuid(row.ci_id) && (w.op === "create" || ["state", "substate", "assigned_to", "location_id", "cost_center_id", "serial_number", "asset_tag", "ci_id"].some((f) => w.changed.has(f)))) await syncCi(w, row);
  // a CI for assets whose model has a CI class (queued: the reconciliation engine identifies it first)
  if (!isUuid(row.ci_id) && !["on_order", "canceled", "disposed"].includes(String(row.state)) && (w.op === "create" || w.changed.has("model_id") || w.changed.has("serial_number"))) {
    await enqueue(w.tx, { kind: "itam.ci_link", orgId: w.ctx.org.id, payload: { id: row.id }, dedupeKey: `itam.ci_link:${row.id}`, maxAttempts: 3 });
  }
  if (w.op === "create" || ["state", "substate", "stockroom_id", "quantity", "model_id"].some((f) => w.changed.has(f))) {
    await enqueue(w.tx, { kind: "itam.stock_check", orgId: w.ctx.org.id, payload: {}, dedupeKey: "itam.stock_check", delayMs: 5000, maxAttempts: 3 });
  }
}

const assetGuards = {
  asset_can_deploy: async (w: WriteArgs) => (w.next.assigned_to || w.next.location_id || w.next.department_id ? null : "برای تحویل، تحویل‌گیرنده، واحد یا مکان را مشخص کنید"),
  asset_can_dispose: async (w: WriteArgs) => {
    const model = await modelOf(w, w.next.model_id);
    if (!model?.data_bearing) return null;
    const n = w.next;
    if (!n.sanitization_method || n.sanitization_method === "not_applicable") return "این دارایی حامل داده است: روش پاک‌سازی داده را ثبت کنید";
    if (!n.sanitized_at || !n.certificate_no) return "زمان پاک‌سازی و شمارهٔ گواهی پاک‌سازی داده لازم است";
    return null;
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Acknowledgements

/**
 * The holder's signature: only the person the acknowledgement names accepts or declines it, and only on that decision
 * are its signature, note and decision time written; others (asset managers, a Windows app's push) only expire a
 * pending one or ask again after a decline or an expiry.
 */
function ackHolderOnly(w: WriteArgs): void {
  if (isSys(w.ctx)) return;
  const n = w.next;
  const holder = w.ctx.user.id === n.user_id;
  const deciding = w.changed.has("state") && ["accepted", "declined"].includes(String(n.state));
  if (deciding && !holder) throw forbidden("فقط تحویل‌گیرنده این تعهدنامه را می‌پذیرد یا رد می‌کند");
  const signed = ["signature_name", "decision_note", "decided_at"].filter((f) => w.changed.has(f));
  if (!signed.length) return;
  if (!holder) throw forbidden("امضا و توضیح تعهدنامه را فقط تحویل‌گیرنده می‌نویسد");
  if (!deciding || (w.prev && w.prev.state !== "pending")) throw forbidden("امضای تعهدنامه فقط همراه پذیرش یا رد آن ثبت می‌شود");
}

async function ackBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  ackHolderOnly(w);
  const n = w.next;
  if (w.op === "create") {
    const asset = await liveRow(w.tx, sysOf(w.ctx), "asset", n.asset_id);
    if (!asset) throw bad("دارایی پیدا نشد");
    if (!n.terms) {
      const model = await modelOf(w, asset.model_id);
      n.terms = model?.acknowledgement_terms ?? null;
    }
    n.label = `${asset.number ?? ""} — ${asset.name ?? ""}`.slice(0, 300);
    if (!n.requested_at) n.requested_at = now();
  }
  if (w.changed.has("state") && ["accepted", "declined"].includes(String(n.state))) n.decided_at = now();
  if (w.changed.has("state") && n.state === "pending") {
    n.decided_at = null;
    n.requested_at = now();
  }
}

async function ackAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !(w.op === "create" || w.changed.has("state"))) return;
  const map: Record<string, string> = { pending: "pending", accepted: "accepted", declined: "declined", expired: "pending" };
  const asset = await liveRow(w.tx, sysOf(w.ctx), "asset", w.next.asset_id);
  if (asset && asset.assigned_to === w.next.user_id) await updateIn(w.tx, sysOf(w.ctx), "asset", asset.id, { ack_state: map[String(w.next.state)] ?? "pending" }, { trusted: true, keepVersion: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Audits

async function auditAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const sys = sysOf(w.ctx);
  const a = w.next;
  // the person who runs the count sees and changes only the assets they may: the expected list is read with their
  // access (another domain's, a restricted group's or a secure workspace's assets on the same floor stay out), and
  // completion stamps or marks missing only assets they may change
  const actor = w.ctx;
  if (entering(w, "in_progress")) {
    const where = a.scope_kind === "branch"
      ? { and: [{ f: "branch_id", op: "eq", v: a.branch_id }, { f: "state", op: "in", v: ["in_stock", "in_use", "in_repair"] }] }
      : a.scope_kind === "location"
      ? { and: [{ f: "location_id", op: "eq", v: a.location_id }, { f: "state", op: "in", v: ["in_stock", "in_use"] }] }
      : { and: [{ f: "stockroom_id", op: "eq", v: a.stockroom_id }, { f: "state", op: "eq", v: "in_stock" }] };
    const assets = await liveRows(w.tx, actor, "asset", where as never, { limit: 5000, order: "t.no" });
    for (const asset of assets) {
      await createIn(w.tx, sys, "inventory_audit_item", { audit_id: a.id, asset_id: asset.id, expected: true, result: "pending", branch_id: a.branch_id ?? null, label: `${asset.number ?? ""} — ${asset.name ?? ""}`.slice(0, 300) }, { trusted: true });
    }
    await updateIn(w.tx, sys, "inventory_audit", a.id, { expected_count: assets.length, found_count: 0, missing_count: 0, unexpected_count: 0, started_at: now() }, { trusted: true, keepVersion: true });
  }
  if (entering(w, "completed")) {
    const items = await liveRows(w.tx, sys, "inventory_audit_item", { f: "audit_id", op: "eq", v: a.id }, { limit: 10000 });
    const at = now();
    let found = 0;
    let missing = 0;
    let unexpected = 0;
    for (const it of items) {
      let result = String(it.result);
      if (result === "pending") {
        result = "missing";
        await updateIn(w.tx, sys, "inventory_audit_item", it.id, { result }, { trusted: true });
      }
      if (result === "found") found++;
      else if (result === "missing") missing++;
      else unexpected++;
      if (!isUuid(it.asset_id)) continue;
      const asset = await liveRow(w.tx, sys, "asset", it.asset_id);
      if (!asset) continue;
      if (!isSys(actor) && !access().canWrite(actor, tableDef("asset")!, asset)) continue;
      const patch: Row = { last_audit_at: at, last_audit_result: result === "found" ? "found" : result === "missing" ? "missing" : "moved" };
      await updateIn(w.tx, sys, "asset", asset.id, patch, { trusted: true, keepVersion: true });
      if (result === "missing" && a.mark_missing && ["in_stock", "in_use", "in_transit"].includes(String(asset.state))) {
        await transitionIn(w.tx, sys, "asset", asset.id, "missing", { retire_reason: `در شمارش ${a.number ?? ""} دیده نشد`, substate: "lost" }).catch(() => undefined);
      }
    }
    await updateIn(w.tx, sys, "inventory_audit", a.id, { found_count: found, missing_count: missing, unexpected_count: unexpected, completed_at: at }, { trusted: true, keepVersion: true });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Repairs

async function repairBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create" || w.changed.has("asset_id") || w.changed.has("contract_id")) {
    const asset = await liveRow(w.tx, sysOf(w.ctx), "asset", n.asset_id);
    if (!asset) throw bad("دارایی پیدا نشد");
    if (["disposed", "canceled", "on_order"].includes(String(asset.state))) throw conflict("این دارایی را نمی‌توان به تعمیر فرستاد");
    const today = orgToday(w.ctx);
    n.under_warranty = !!(asset.warranty_end && String(asset.warranty_end) >= today) || !!n.contract_id;
    if (!n.contract_id && n.under_warranty && asset.warranty_contract_id) n.contract_id = asset.warranty_contract_id;
    if (w.op === "create") n.previous_state = String(asset.state);
  }
  if (entering(w, "awaiting_vendor") && !n.sent_at) n.sent_at = now();
  if ((entering(w, "repaired") || entering(w, "beyond_repair")) && !n.returned_at) n.returned_at = now();
  if (w.op === "create" && n.vendor_id && n.repair_kind !== "vendor") n.repair_kind = "vendor";
}

async function repairAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  const r = w.next;
  const asset = await liveRow(w.tx, sys, "asset", r.asset_id);
  if (!asset) return;
  if (w.op === "create" && ["in_stock", "in_use", "in_transit"].includes(String(asset.state))) {
    await transitionIn(w.tx, sys, "asset", asset.id, "in_repair", { substate: r.repair_kind === "vendor" ? "vendor_repair" : "internal_repair" });
  }
  if (entering(w, "awaiting_vendor") && asset.state === "in_repair" && asset.substate !== "vendor_repair") await updateIn(w.tx, sys, "asset", asset.id, { substate: "vendor_repair" }, { trusted: true });
  if (entering(w, "repaired") && asset.state === "in_repair") {
    const back = r.previous_state === "in_use" && asset.assigned_to ? "in_use" : "in_stock";
    if (back === "in_stock" && !asset.stockroom_id) {
      await addJournalIn(w.tx, sys, tableDef("asset")!, asset, { kind: "system", body: `تعمیر ${r.number ?? ""} انجام شد؛ برای بازگشت به انبار، انبار را مشخص کنید` }, { trusted: true });
    } else {
      await transitionIn(w.tx, sys, "asset", asset.id, back, {});
    }
  }
  if (entering(w, "beyond_repair") && !["retired", "disposed"].includes(String(asset.state))) {
    await transitionIn(w.tx, sys, "asset", asset.id, "retired", { retire_reason: `غیرقابل تعمیر (${r.number ?? ""}): ${String(r.resolution ?? "").slice(0, 500)}` });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Disposal

async function disposalItemBefore(w: WriteArgs): Promise<void> {
  const order = await needParentWrite(w, "disposal_order", "order_id");
  if (w.op === "delete") return;
  if (order && ["completed", "closed", "canceled"].includes(String(order.state))) throw conflict("این دستور اسقاط بسته شده است");
  // what was approved is what is disposed: an asset joins an order only while it waits for approval
  if (order && order.state !== "requested" && (w.op === "create" || w.changed.has("asset_id")) && !isSys(w.ctx)) throw conflict("این دستور اسقاط تأیید شده است؛ دارایی تازه را با دستور اسقاط دیگری بفرستید");
  const asset = await liveRow(w.tx, sysOf(w.ctx), "asset", w.next.asset_id);
  if (!asset) throw bad("دارایی پیدا نشد");
  if (asset.state === "disposed") throw conflict(`دارایی ${asset.number ?? ""} پیش‌تر اسقاط شده است`);
  w.next.label = `${asset.number ?? ""} — ${asset.name ?? ""}`.slice(0, 300);
  if (w.changed.has("sanitized_at") && w.next.sanitized_at && !w.next.sanitized_by && !isSys(w.ctx)) w.next.sanitized_by = w.ctx.user.id;
}

async function disposalItemAfter(w: WriteArgs): Promise<void> {
  if (w.op !== "create") return;
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  const order = await liveRow(w.tx, sys, "disposal_order", w.next.order_id);
  const asset = await liveRow(w.tx, sys, "asset", w.next.asset_id);
  if (!asset || !order) return;
  if (["in_stock", "in_use", "in_repair", "missing"].includes(String(asset.state))) {
    await transitionIn(w.tx, sys, "asset", asset.id, "retired", { retire_reason: `اسقاط با ${order.number ?? ""}`, substate: "awaiting_disposal" });
  }
  await updateIn(w.tx, sys, "asset", asset.id, { disposal_order_id: order.id }, { trusted: true, keepVersion: true });
}

async function dataBearing(w: WriteArgs, asset: Row): Promise<boolean> {
  const model = await modelOf(w, asset.model_id);
  return !!model?.data_bearing;
}

const disposalGuards = {
  disposal_can_complete: async (w: WriteArgs) => {
    const sys = sysOf(w.ctx);
    const items = await liveRows(w.tx, sys, "disposal_item", { f: "order_id", op: "eq", v: w.next.id }, { limit: 2000 });
    if (!items.length) return "دارایی‌ای در این دستور اسقاط نیست";
    const missing: string[] = [];
    for (const it of items) {
      const asset = await liveRow(w.tx, sys, "asset", it.asset_id);
      if (!asset) continue;
      if (!(await dataBearing(w, asset))) continue;
      if (!it.sanitization_method || it.sanitization_method === "not_applicable" || !it.sanitized_at || !it.certificate_no) missing.push(String(asset.number ?? asset.name));
    }
    return missing.length ? `گواهی پاک‌سازی داده برای این دارایی‌ها کامل نیست: ${missing.slice(0, 10).join("، ")}` : null;
  },
};

async function disposalAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !entering(w, "completed")) return;
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  const items = await liveRows(w.tx, sys, "disposal_item", { f: "order_id", op: "eq", v: w.next.id }, { limit: 2000 });
  for (const it of items) {
    const asset = await liveRow(w.tx, sys, "asset", it.asset_id);
    if (!asset || asset.state === "disposed") continue;
    if (asset.state !== "retired") await transitionIn(w.tx, sys, "asset", asset.id, "retired", { retire_reason: `اسقاط با ${w.next.number ?? ""}` });
    await transitionIn(w.tx, sys, "asset", asset.id, "disposed", {
      disposal_method: w.next.method, sanitization_method: it.sanitization_method ?? "not_applicable", sanitized_at: it.sanitized_at ?? null,
      certificate_no: it.certificate_no ?? w.next.certificate_no ?? null, disposal_order_id: w.next.id,
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Procurement

const lineAmount = (qty: unknown, price: unknown) => (price === null || price === undefined || price === "" ? null : round(mul((qty ?? 0) as string, price as string), 0));

async function rollupTotal(tx: Tx, ctx: Ctx, parentTable: string, lineTable: string, field: string, id: string): Promise<void> {
  onBeforeCommit(tx, `itam.total:${parentTable}:${id}`, async () => {
    const sys = sysOf(ctx);
    const parent = await liveRow(tx, sys, parentTable, id);
    if (!parent) return;
    const lines = await liveRows(tx, sys, lineTable, { f: field, op: "eq", v: id }, { limit: 5000 });
    let total = D(0);
    for (const l of lines) total = total.plus(D(l.amount ?? 0));
    if (D(parent.total ?? 0).eq(total) && parent.total !== null) return;
    await updateIn(tx, sys, parentTable, id, { total: total.toString() }, { trusted: true, keepVersion: true });
  });
}

async function requisitionLineBefore(w: WriteArgs): Promise<void> {
  await needParentWrite(w, "purchase_requisition", "requisition_id", { draftStates: ["draft"] });
  if (w.op === "delete") return;
  const n = w.next;
  if (n.model_id && (w.op === "create" || w.changed.has("model_id"))) {
    const model = await modelOf(w, n.model_id);
    if (model?.status === "prohibited") throw conflict(`مدل «${model.name}» ممنوع است`);
    if (!n.description) n.description = model?.name ?? null;
    if ((n.unit_price === null || n.unit_price === undefined || n.unit_price === "") && model?.unit_cost) n.unit_price = model.unit_cost;
  }
  if (!n.description) throw bad("شرح یا مدل کالا را وارد کنید");
  n.amount = lineAmount(n.quantity, n.unit_price);
}

async function poLineBefore(w: WriteArgs): Promise<void> {
  await needParentWrite(w, "purchase_order", "po_id", { draftStates: ["draft"] });
  if (w.op === "delete") return;
  const n = w.next;
  if (n.model_id && (w.op === "create" || w.changed.has("model_id"))) {
    const model = await modelOf(w, n.model_id);
    if (model?.status === "prohibited") throw conflict(`مدل «${model.name}» ممنوع است`);
    if (!n.description) n.description = model?.name ?? null;
    if ((n.unit_price === null || n.unit_price === undefined || n.unit_price === "") && model?.unit_cost) n.unit_price = model.unit_cost;
  }
  if (!n.description) throw bad("شرح یا مدل کالا را وارد کنید");
  if (w.op === "create" && !n.line_no) {
    const lines = await liveRows(w.tx, sysOf(w.ctx), "purchase_order_line", { f: "po_id", op: "eq", v: n.po_id }, { limit: 5000 });
    n.line_no = lines.reduce((m, l) => Math.max(m, Number(l.line_no ?? 0)), 0) + 1;
  }
  if (Number(n.received_qty ?? 0) > Number(n.quantity ?? 0) && !w.trusted) throw conflict("تعداد سفارش از تعداد دریافت‌شده کمتر نمی‌شود");
  n.amount = lineAmount(n.quantity, n.unit_price);
}

const procurementGuards = {
  requisition_has_lines: async (w: WriteArgs) => ((await liveRows(w.tx, sysOf(w.ctx), "purchase_requisition_line", { f: "requisition_id", op: "eq", v: w.next.id }, { limit: 1 })).length ? null : "درخواست خرید قلمی ندارد"),
  /** «تأیید» by an approver: lines, and never the person the requisition is for or who raised it */
  requisition_can_approve: async (w: WriteArgs) => {
    const lines = await procurementGuards.requisition_has_lines(w);
    if (lines || isSys(w.ctx)) return lines;
    const me = w.ctx.user.id;
    if ([w.next.requested_for, w.next.created_by, w.prev?.created_by].includes(me)) return "درخواست خریدی را که برای شما یا به دست شما ثبت شده است دیگری تأیید می‌کند";
    return null;
  },
  po_has_lines: async (w: WriteArgs) => ((await liveRows(w.tx, sysOf(w.ctx), "purchase_order_line", { f: "po_id", op: "eq", v: w.next.id }, { limit: 1 })).length ? null : "سفارش خرید سطری ندارد"),
  receipt_can_post: async (w: WriteArgs) => {
    const sys = sysOf(w.ctx);
    const po = await liveRow(w.tx, sys, "purchase_order", w.next.po_id);
    if (!po || !["ordered", "partially_received"].includes(String(po.state))) return "فقط کالای سفارش‌های ثبت‌شده دریافت می‌شود";
    const lines = await liveRows(w.tx, sys, "goods_receipt_line", { f: "receipt_id", op: "eq", v: w.next.id }, { limit: 2000 });
    if (!lines.length) return "رسید سطری ندارد";
    // the receipt's quantity per order line (two lines of one order line add up), against the order line locked for
    // this transaction (two receipts posted at once wait for each other and the second sees the first's quantity)
    const wanted = new Map<string, number>();
    for (const l of lines) wanted.set(String(l.po_line_id), (wanted.get(String(l.po_line_id)) ?? 0) + Number(l.quantity ?? 0));
    const table = tableDef("purchase_order_line")!.table;
    for (const [lineId, qty] of wanted) {
      if (!isUuid(lineId)) return "سطر رسید به این سفارش تعلق ندارد";
      await w.tx.query(`select id from ${table} where id = $1::uuid and org_id = $2 for update`, [lineId, w.ctx.org.id]);
      const pl = await liveRow(w.tx, sys, "purchase_order_line", lineId);
      if (!pl || pl.po_id !== po.id) return "سطر رسید به این سفارش تعلق ندارد";
      const left = Number(pl.quantity ?? 0) - Number(pl.received_qty ?? 0);
      if (qty > left) return `از «${pl.description ?? ""}» فقط ${left} عدد باقی مانده است`;
    }
    return null;
  },
};

const splitLines = (v: unknown): string[] => String(v ?? "").split(/[\r\n,؛;]+/).map((s) => s.trim()).filter(Boolean);

/** Post a goods receipt: the assets, the order lines' received quantities and the order's state. */
async function postReceipt(w: WriteArgs): Promise<void> {
  const sys = sysOf(w.ctx, w.ctx.actor === "system" ? null : w.ctx.user.id);
  const grn = w.next;
  const po = await liveRow(w.tx, sys, "purchase_order", grn.po_id);
  if (!po) return;
  const rate = po.currency && po.currency !== "IRR" && po.fx_rate ? D(po.fx_rate) : D(1);
  const lines = await liveRows(w.tx, sys, "goods_receipt_line", { f: "receipt_id", op: "eq", v: grn.id }, { limit: 2000, order: "t.created_at" });
  // the organisation's calendar date of the receipt (01:30 Tehran on the 1st is that month's purchase)
  const date = localDate(w.ctx, String(grn.received_at ?? now()));
  let created = 0;
  for (const l of lines) {
    const pl = await liveRow(w.tx, sys, "purchase_order_line", l.po_line_id);
    if (!pl) continue;
    const model = pl.model_id ? await liveRow(w.tx, sys, "asset_model", pl.model_id) : null;
    const qty = Number(l.quantity ?? 0);
    const unit = pl.unit_price === null || pl.unit_price === undefined ? null : round(D(pl.unit_price).mul(rate).toString(), 0);
    const base: Row = {
      model_id: pl.model_id, state: "in_stock", substate: "available", stockroom_id: grn.stockroom_id, vendor_id: po.supplier_id ?? null, po_id: po.id,
      purchase_date: date, cost_center_id: po.cost_center_id ?? null,
    };
    if (pl.model_id && model) {
      if (model.tracking === "quantity") {
        await createIn(w.tx, sys, "asset", { ...base, quantity: qty, purchase_cost: unit === null ? null : round(D(unit).mul(qty).toString(), 0) }, { trusted: true });
        created++;
      } else {
        const serials = splitLines(l.serials);
        const tags = splitLines(l.asset_tags);
        for (let i = 0; i < qty; i++) {
          await createIn(w.tx, sys, "asset", { ...base, serial_number: serials[i] ?? null, asset_tag: tags[i] ?? null, purchase_cost: unit }, { trusted: true });
          created++;
        }
      }
    }
    await updateIn(w.tx, sys, "purchase_order_line", pl.id, { received_qty: Number(pl.received_qty ?? 0) + qty }, { trusted: true });
  }
  const all = await liveRows(w.tx, sys, "purchase_order_line", { f: "po_id", op: "eq", v: po.id }, { limit: 5000 });
  const complete = all.every((x) => Number(x.received_qty ?? 0) >= Number(x.quantity ?? 0));
  const to = complete ? "received" : "partially_received";
  if (po.state !== to) await transitionIn(w.tx, sys, "purchase_order", po.id, to, {});
  if (complete) await updateIn(w.tx, sys, "purchase_order", po.id, { received_at: now() }, { trusted: true });
  await updateIn(w.tx, sys, "goods_receipt", grn.id, { assets_created: created }, { trusted: true, keepVersion: true });
}

async function receiptLineBefore(w: WriteArgs): Promise<void> {
  await needParentWrite(w, "goods_receipt", "receipt_id", { draftStates: ["draft"] });
  if (w.op === "delete") return;
  const pl = await liveRow(w.tx, sysOf(w.ctx), "purchase_order_line", w.next.po_line_id);
  if (!pl) throw bad("سطر سفارش پیدا نشد");
  if (w.op === "create" || w.changed.has("po_line_id")) {
    const same = await liveRows(w.tx, sysOf(w.ctx), "goods_receipt_line", { and: [{ f: "receipt_id", op: "eq", v: w.next.receipt_id }, { f: "po_line_id", op: "eq", v: pl.id }, { f: "id", op: "ne", v: w.next.id }] }, { limit: 1 });
    if (same.length) throw conflict(`«${pl.description ?? ""}» در این رسید سطر دارد؛ تعداد همان سطر را تغییر دهید`);
  }
  w.next.model_id = pl.model_id ?? null;
  w.next.label = `${pl.description ?? ""} × ${w.next.quantity ?? 1}`.slice(0, 300);
}

// ---------------------------------------------------------------------------------------------------------------
// Software

async function installBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const sys = sysOf(w.ctx);
  if (w.op === "create" || w.changed.has("ci_id")) {
    const ci = await liveRow(w.tx, sys, "ci", n.ci_id);
    if (ci) {
      if (!n.user_id && ci.used_by) n.user_id = ci.used_by;
      n.cores = ci.cpu_count ?? n.cores ?? null;
    }
  }
  if (w.op === "create") {
    if (!n.first_seen_at) n.first_seen_at = now();
    if (!n.last_seen_at) n.last_seen_at = n.first_seen_at;
  }
  if (w.changed.has("software_model_id") && n.software_model_id && w.input?.has("software_model_id") && !isSys(w.ctx)) n.normalized_by = "manual";
  else if (!n.software_model_id || ((w.changed.has("raw_name") || w.changed.has("raw_publisher")) && n.normalized_by !== "manual")) {
    const models = await liveRows(w.tx, sys, "software_model", null, { limit: 5000 });
    const hit = matchSoftware({ name: String(n.raw_name ?? ""), publisher: n.raw_publisher ?? null }, models as never);
    n.software_model_id = hit?.id ?? null;
    n.normalized_by = hit ? "rule" : "none";
  }
  if (w.changed.has("active")) n.removed_at = n.active ? null : now();
}

async function queueReconcile(w: WriteArgs): Promise<void> {
  await enqueue(w.tx, { kind: "itam.reconcile", orgId: w.ctx.org.id, payload: { trigger: "change" }, dedupeKey: "itam.reconcile", delayMs: 60_000, maxAttempts: 3 });
}

async function entitlementBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const qty = Number(n.quantity ?? 0);
  if (["unit_cost", "quantity"].some((f) => w.changed.has(f)) && n.unit_cost && !w.input?.has("total_cost")) n.total_cost = round(mul(n.unit_cost, qty), 0);
  else if (n.total_cost && !n.unit_cost && qty > 0) n.unit_cost = round(D(n.total_cost).div(qty).toString(), 0);
  if (n.start_date && n.end_date && n.end_date < n.start_date) throw bad("پایان مجوز پیش از شروع آن است");
}

async function allocationBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (!n.user_id && !n.ci_id) throw bad("کاربر یا دستگاه را مشخص کنید");
  if (w.changed.has("released_at") && n.released_at) n.active = false;
  if (w.op === "create" || w.changed.has("entitlement_id")) {
    const e = await liveRow(w.tx, sysOf(w.ctx), "license_entitlement", n.entitlement_id);
    if (!e) throw bad("مجوز پیدا نشد");
    n.label = `${e.number ?? ""} — ${e.name ?? ""}`.slice(0, 300);
  }
}

async function seatsRollup(tx: Tx, ctx: Ctx, subscriptionId: string): Promise<void> {
  onBeforeCommit(tx, `itam.seats:${subscriptionId}`, async () => {
    const sys = sysOf(ctx);
    const sub = await liveRow(tx, sys, "saas_subscription", subscriptionId);
    if (!sub) return;
    const accounts = await liveRows(tx, sys, "saas_account", eqAll({ subscription_id: subscriptionId, active: true }), { limit: 100000 });
    const since = addDays(orgToday(ctx), -30);
    const active = accounts.filter((a) => a.last_active_at && String(a.last_active_at).slice(0, 10) >= since).length;
    if (Number(sub.seats_assigned ?? -1) === accounts.length && Number(sub.seats_active ?? -1) === active) return;
    await updateIn(tx, sys, "saas_subscription", subscriptionId, { seats_assigned: accounts.length, seats_active: active }, { trusted: true, keepVersion: true });
  });
}

// ---------------------------------------------------------------------------------------------------------------

const labelOf = async (w: WriteArgs, table: string, id: unknown) => {
  const r = await liveRow(w.tx, sysOf(w.ctx), table, id);
  return r ? String(r.number ? `${r.number} — ${r.name ?? r.title ?? ""}` : r.name ?? r.title ?? "") : "";
};

// pure checks of definitions and lines (they only read; values they derive are the Windows app's on a push)
const modelBefore = (w: WriteArgs) => {
  if (w.op === "delete") return;
  if (w.next.tracking === "quantity" && w.next.asset_class === "hardware") w.next.asset_class = "consumable";
  if (w.next.end_of_sale && w.next.release_date && w.next.end_of_sale < w.next.release_date) throw bad("پایان فروش پیش از عرضه است");
};
async function stockroomBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !w.changed.has("parent_id") || !w.next.parent_id) return;
  let cur: unknown = w.next.parent_id;
  for (let i = 0; i < 30 && isUuid(cur); i++) {
    if (cur === w.next.id) throw bad("انبار نمی‌تواند زیرمجموعهٔ خودش باشد");
    cur = (await liveRow(w.tx, sysOf(w.ctx), "stockroom", cur))?.parent_id;
  }
}
async function stockRuleBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (n.max_qty !== null && n.max_qty !== undefined && Number(n.max_qty) < Number(n.min_qty ?? 0)) throw bad("سطح هدف از نقطهٔ سفارش کمتر است");
  if (w.op === "create" || w.changed.has("model_id") || w.changed.has("stockroom_id")) n.label = `${await labelOf(w, "asset_model", n.model_id)} در ${await labelOf(w, "stockroom", n.stockroom_id)}`.slice(0, 300);
}
const reservationBefore = (w: WriteArgs) => {
  if (w.op !== "delete" && w.next.from_date && w.next.to_date && w.next.to_date < w.next.from_date) throw bad("پایان رزرو پیش از شروع آن است");
};
const auditBefore = (w: WriteArgs) => {
  if (w.op === "delete") return;
  const k = w.next.scope_kind;
  if (k === "branch" ? !w.next.branch_id : k === "location" ? !w.next.location_id : !w.next.stockroom_id) {
    throw bad(k === "branch" ? "شعبهٔ شمارش را مشخص کنید" : k === "location" ? "مکان شمارش را مشخص کنید" : "انبار شمارش را مشخص کنید");
  }
  // a branch's staff count their own branch: the audit is anchored to it (scope.unit)
  if (!isSys(w.ctx) && w.via !== "sync" && (w.op === "create" || w.changed.has("branch_id")) && w.next.branch_id && !access().canWrite(w.ctx, w.def, w.next)) {
    throw forbidden("شمارش را فقط برای شعبه یا واحدی می‌توانید برنامه بگذارید که اموال آن با شماست");
  }
};
async function auditItemBefore(w: WriteArgs): Promise<void> {
  await needParentWrite(w, "inventory_audit", "audit_id", { draftStates: ["planned", "in_progress"] });
  if (w.op !== "delete" && (w.op === "create" || w.changed.has("asset_id")) && w.next.asset_id) w.next.label = (await labelOf(w, "asset", w.next.asset_id)).slice(0, 300);
}
async function catalogModelBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  w.next.label = `${await labelOf(w, "catalog_item", w.next.catalog_item_id)} ← ${await labelOf(w, "asset_model", w.next.model_id)}`.slice(0, 300);
}
const subscriptionBefore = (w: WriteArgs) => {
  if (w.op === "delete") return;
  const n = w.next;
  if ((w.changed.has("seats") || w.changed.has("cost_per_seat")) && n.cost_per_seat && !w.input?.has("annual_cost")) {
    n.annual_cost = round(mul(n.cost_per_seat, Number(n.seats ?? 0) * (n.billing_cycle === "monthly" ? 12 : 1)), 0);
  }
};
async function saasAccountBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  if (!w.next.user_id && !w.next.email && !w.next.external_id) throw bad("کاربر، رایانامه یا شناسهٔ بیرونی حساب را وارد کنید");
  w.next.label = `${await labelOf(w, "saas_subscription", w.next.subscription_id)} — ${w.next.email ?? w.next.external_id ?? ""}`.slice(0, 300);
}

/**
 * The stock-movement and assignment ledgers a Windows app pushes: its own asset hooks wrote them there (as the
 * system) when the member checked an asset out, in or moved it — the cloud runs no hooks for the pushed asset, so it
 * takes these rows, but only from a member who may change the asset they record (a ledger row of an asset the member
 * may not change is refused). A row that names no asset is the module's alone.
 */
export function ledgerOnPush(label: string): (p: PushArgs) => Promise<string | null> {
  return async (p) => {
    const asset = isUuid(p.next.asset_id) ? await liveRow(p.tx, sysOf(p.ctx), "asset", p.next.asset_id) : null;
    if (!asset) return `${label} را سامانه ثبت می‌کند و دستی تغییر نمی‌کند`;
    if (!access().canWrite(p.ctx, tableDef("asset")!, asset)) return `${label} فقط از تغییر دارایی‌ای می‌آید که می‌توانید آن را تغییر دهید`;
    if (p.prev && ["asset_id", "kind", "quantity", "model_id"].some((f) => p.changed.has(f))) return `${label} تغییر نمی‌کند`;
    return null;
  };
}

/** What the cloud computes itself (licence positions and their reconcile runs): never taken from a Windows app. */
const computedOnPush = (label: string) => () => `${label} را تطبیق مجوزهای همین سامانه می‌سازد`;

export function installItamHooks(): (() => void)[] {
  const off: (() => void)[] = [];
  // every module check also answers a Windows app's push (a push runs no beforeWrite): `pushGuard` asks the same hook
  // of the pushed row — the hooks below only read and refuse; what they derive on the copy is dropped
  const guarded = (table: string, before: (w: WriteArgs) => unknown, more: Omit<TableHooks, "beforeWrite" | "validatePush"> = {}) =>
    off.push(registerHooks(table, { beforeWrite: before as TableHooks["beforeWrite"], validatePush: pushGuard(before), ...more }));
  guarded("asset", assetBefore, { afterWrite: assetAfter, guards: assetGuards });
  guarded("asset_model", modelBefore);
  guarded("stockroom", stockroomBefore);
  guarded("stock_rule", stockRuleBefore, {
    async afterWrite(w) {
      if (w.op !== "delete" && ["min_qty", "max_qty", "active", "model_id", "stockroom_id"].some((f) => w.changed.has(f)) || w.op === "create") {
        await enqueue(w.tx, { kind: "itam.stock_check", orgId: w.ctx.org.id, payload: {}, dedupeKey: "itam.stock_check", delayMs: 2000, maxAttempts: 3 });
      }
    },
  });
  off.push(registerHooks("stock_movement", { beforeWrite: systemOnly("گردش انبار"), validatePush: ledgerOnPush("گردش انبار") }));
  off.push(registerHooks("asset_assignment", { beforeWrite: systemOnly("تاریخچهٔ تحویل"), validatePush: ledgerOnPush("تاریخچهٔ تحویل") }));
  guarded("asset_acknowledgement", ackBefore, { afterWrite: ackAfter });
  guarded("asset_reservation", reservationBefore);
  guarded("inventory_audit", auditBefore, { afterWrite: auditAfter });
  guarded("inventory_audit_item", auditItemBefore);
  guarded("repair_order", repairBefore, { afterWrite: repairAfter });
  off.push(registerHooks("disposal_order", { afterWrite: disposalAfter, guards: disposalGuards }));
  guarded("disposal_item", disposalItemBefore, { afterWrite: disposalItemAfter });
  guarded("catalog_item_model", catalogModelBefore);
  off.push(registerHooks("purchase_requisition", { guards: { requisition_has_lines: procurementGuards.requisition_has_lines, requisition_can_approve: procurementGuards.requisition_can_approve } }));
  guarded("purchase_requisition_line", requisitionLineBefore, {
    async afterWrite(w) {
      await rollupTotal(w.tx, w.ctx, "purchase_requisition", "purchase_requisition_line", "requisition_id", String(w.next?.requisition_id ?? w.prev?.requisition_id));
    },
  });
  off.push(registerHooks("purchase_order", { guards: { po_has_lines: procurementGuards.po_has_lines } }));
  guarded("purchase_order_line", poLineBefore, {
    async afterWrite(w) {
      await rollupTotal(w.tx, w.ctx, "purchase_order", "purchase_order_line", "po_id", String(w.next?.po_id ?? w.prev?.po_id));
    },
  });
  off.push(registerHooks("goods_receipt", {
    async afterWrite(w) {
      if (w.op !== "delete" && entering(w, "posted")) await postReceipt(w);
    },
    guards: { receipt_can_post: procurementGuards.receipt_can_post },
  }));
  guarded("goods_receipt_line", receiptLineBefore);
  guarded("software_install", installBefore, { afterWrite: queueReconcile });
  off.push(registerHooks("software_model", {
    async afterWrite(w) {
      if (w.op === "create" || ["match_patterns", "publisher_patterns", "exclude_patterns", "license_metric", "list_price"].some((f) => w.changed.has(f))) {
        await enqueue(w.tx, { kind: "itam.renormalize", orgId: w.ctx.org.id, payload: {}, dedupeKey: "itam.renormalize", delayMs: 5000, maxAttempts: 3 });
      }
    },
  }));
  guarded("license_entitlement", entitlementBefore, { afterWrite: queueReconcile });
  guarded("license_allocation", allocationBefore, { afterWrite: queueReconcile });
  off.push(registerHooks("license_position", { beforeWrite: systemOnly("وضعیت مجوزها"), validatePush: computedOnPush("وضعیت مجوزها") }));
  off.push(registerHooks("license_reconcile_run", { beforeWrite: systemOnly("اجرای تطبیق مجوزها"), validatePush: computedOnPush("اجرای تطبیق مجوزها") }));
  guarded("saas_subscription", subscriptionBefore);
  guarded("saas_account", saasAccountBefore, {
    async afterWrite(w) {
      await seatsRollup(w.tx, w.ctx, String(w.next?.subscription_id ?? w.prev?.subscription_id));
    },
  });
  return off;
}

export const ASSET_STATE_LABEL = (v: unknown) => ASSET_STATES.states.find((s) => s.value === v)?.label ?? String(v ?? "");
export type { FieldDef, TableDef };
