// Bank-grade IT asset management (docs/modules/itam_bank_gap.md; guide itam_FA.md «اموال شعبه‌ها و ناوگان خودپرداز»):
//   · branch scoping: an asset's `branch_id` is its access anchor (TableDef scope.unit) — a branch's staff read their
//     branch's assets, a region's managers their region (unit_tree); the branch changes only through a transfer (or
//     by someone who manages assets everywhere), and a branch's staff register assets only in branches they may change
//   · transfers («حواله و رسید انتقال»): a dispatch note of the sending branch with items, approval, dispatch (the
//     assets go «در راه»), and the receipt of the receiving branch (participant source «itam.transfer_receiver»: they
//     read the notes addressed to their branch; `receiveTransfer` checks their grant there and moves the assets as the
//     system), with per-item results and discrepancies
//   · the chain of custody (`asset_custody`): an insert-only ledger per asset, each row's SHA-256 over the row and the
//     previous row's hash (`verifyCustody` re-computes it), written by the module only
//   · device status periods (`device_status_event`) of ATMs, CRSs and kiosks: availability, maintenance penalties,
//     the fleet view, preventive maintenance plans of the field-service module, the failure-risk score (AI skill
//     `itam.atm_failure_risk` with a rule-based answer)
//   · the asset register «دفتر اموال» by Jalali fiscal year; physical audit reconciliation; branch managers' periodic
//     attestation; wipe certificates of disposal items
import { createHash } from "node:crypto";
import type { Cond } from "@shared/model/conditions";
import { tableDef } from "@shared/tables";
import { CUSTODY_EVENTS, DEVICE_STATUS, FLEET_CATEGORIES, MODEL_CATEGORIES, SANITIZATION_METHODS, TRANSFER_REASONS } from "@shared/tables/itam";
import {
  RESOLUTIONS_FOR, attestationDue, attestationPeriod, availabilityOf, cleanAttributes, daysTo, deviceClass, eosBucket, failureRisk, fiscalYearDepreciation,
  isFleetCategory, monthsBetween, openDiscrepancies, osEndOfSupport, penaltyOf, receiptOutcome, transferProblem,
  type AuditResolution, type AuditResult, type StatusPeriod, type TransferItemResult,
} from "@shared/itam/bank";
import type { DepMethod } from "@shared/itam/logic";
import { addDays, jalaliYearRange } from "@shared/jalali";
import { D } from "@shared/money";
import type { Ctx } from "../../context";
import { pgArray, type Tx, type Queryable } from "../../db";
import { aggregate, createIn, emitEvent, get, registerHooks, transitionIn, updateIn, pushGuard, type PushArgs, type WriteArgs } from "../../engine";
import { access } from "../../access/provider";
import { registerParticipantSource, subjectOf } from "../../access";
import { bad, conflict, forbidden } from "../../http/errors";
import { onApprovalSettled, settledVerdict } from "../sla";
import { holds, hasGroup, isUuid, itamConfig, liveRow, liveRows, orgToday, sysOf, type Row } from "./common";
import { ledgerOnPush, needParentWrite, systemOnly } from "./hooks";

const NIL = "00000000-0000-0000-0000-000000000000";
const nowIso = () => new Date().toISOString();
const isSys = (ctx: Ctx) => ctx.actor === "system";
const actorOf = (ctx: Ctx): string | null => (isUuid(ctx.user?.id) && ctx.user.id !== NIL ? ctx.user.id : null);
const labelIn = (options: { value: string; label: string }[], v: unknown) => options.find((o) => o.value === v)?.label ?? String(v ?? "");
const assetLabel = (a: Row) => [a.asset_tag || a.number, a.name, a.serial_number ? `سریال ${a.serial_number}` : null].filter(Boolean).join(" — ").slice(0, 300);

/** The caller's own unit (their profile's), or null. */
function unitOf(ctx: Ctx): string | null {
  try {
    return subjectOf(ctx).unitId ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Chain of custody

/** Assets whose custody rows the current operation writes itself (a transfer, a receipt, an attestation). */
const handled = new WeakMap<Tx, Set<string>>();
function markHandled(tx: Tx, assetId: string): void {
  let s = handled.get(tx);
  if (!s) handled.set(tx, (s = new Set()));
  s.add(String(assetId));
}
const isHandled = (tx: Tx, assetId: unknown) => !!handled.get(tx)?.has(String(assetId));

export interface CustodyInput {
  event: string;
  branch_id?: unknown;
  from_branch_id?: unknown;
  holder_id?: unknown;
  from_holder_id?: unknown;
  reference?: string | null;
  note?: string | null;
  at?: string;
}

const idOrNull = (v: unknown): string | null => (isUuid(v) ? String(v).toLowerCase() : null);
const isoOrNull = (v: unknown): string | null => (v ? new Date(String(v)).toISOString() : null);

/** The SHA-256 of a custody row chained to the previous row's hash (the same canonical form on write and verify). */
export function custodyDigest(prev: string, r: Row): string {
  const canon = JSON.stringify([
    prev || "", idOrNull(r.asset_id), Number(r.seq), isoOrNull(r.at), String(r.event ?? ""), idOrNull(r.branch_id), idOrNull(r.from_branch_id),
    idOrNull(r.holder_id), idOrNull(r.from_holder_id), idOrNull(r.actor_id), r.reference ?? null, r.note ?? null,
  ]);
  return createHash("sha256").update(canon).digest("hex");
}

/** Append a custody row for an asset (inside the write's transaction, as the system). */
export async function addCustody(tx: Tx, ctx: Ctx, asset: Row, e: CustodyInput): Promise<void> {
  const sys = sysOf(ctx);
  const [last] = await liveRows(tx, sys, "asset_custody", { f: "asset_id", op: "eq", v: asset.id }, { order: "t.seq desc", limit: 1 });
  const row: Row = {
    asset_id: asset.id, seq: Number(last?.seq ?? 0) + 1, at: e.at ?? nowIso(), event: e.event,
    branch_id: idOrNull(e.branch_id), from_branch_id: idOrNull(e.from_branch_id), holder_id: idOrNull(e.holder_id), from_holder_id: idOrNull(e.from_holder_id),
    actor_id: actorOf(ctx), reference: e.reference ? String(e.reference).slice(0, 120) : null, note: e.note ? String(e.note).slice(0, 300) : null,
  };
  const prev = String(last?.hash ?? "");
  await createIn(tx, sys, "asset_custody", { ...row, prev_hash: prev || null, hash: custodyDigest(prev, row), label: `${asset.asset_tag || asset.number || ""} — ${labelIn(CUSTODY_EVENTS, e.event)}`.slice(0, 300) }, { trusted: true });
}

/** Re-compute an asset's chain: intact, or the first row whose hash does not follow. */
export async function verifyCustody(q: Queryable, ctx: Ctx, assetId: string): Promise<{ rows: number; ok: boolean; broken_at: number | null }> {
  const rows = await liveRows(q, sysOf(ctx), "asset_custody", { f: "asset_id", op: "eq", v: assetId }, { order: "t.seq", limit: 10000 });
  let prev = "";
  for (const r of rows) {
    if (String(r.prev_hash ?? "") !== prev || custodyDigest(prev, r) !== r.hash) return { rows: rows.length, ok: false, broken_at: Number(r.seq) };
    prev = String(r.hash);
  }
  return { rows: rows.length, ok: true, broken_at: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Device status periods

const statusInfo = new WeakMap<Tx, Map<string, { reason?: string | null; incident_id?: string | null }>>();
export function setStatusInfo(tx: Tx, assetId: string, info: { reason?: string | null; incident_id?: string | null }): void {
  let m = statusInfo.get(tx);
  if (!m) statusInfo.set(tx, (m = new Map()));
  m.set(assetId, info);
}

async function statusPeriod(tx: Tx, ctx: Ctx, asset: Row): Promise<void> {
  const sys = sysOf(ctx);
  const at = nowIso();
  const open = await liveRows(tx, sys, "device_status_event", { and: [{ f: "asset_id", op: "eq", v: asset.id }, { f: "to_at", op: "empty" }] }, { limit: 20 });
  for (const e of open) {
    await updateIn(tx, sys, "device_status_event", String(e.id), { to_at: at, minutes: Math.max(0, Math.round((Date.parse(at) - Date.parse(String(e.from_at))) / 60_000)) }, { trusted: true });
  }
  if (!asset.device_status) return;
  const info = statusInfo.get(tx)?.get(String(asset.id)) ?? {};
  await createIn(tx, sys, "device_status_event", {
    asset_id: asset.id, status: asset.device_status, from_at: at, branch_id: idOrNull(asset.branch_id), contract_id: idOrNull(asset.support_contract_id),
    incident_id: idOrNull(info.incident_id), reason: info.reason ? String(info.reason).slice(0, 300) : null,
    label: `${asset.asset_tag || asset.number || ""} — ${labelIn(DEVICE_STATUS, asset.device_status)}`.slice(0, 300),
  }, { trusted: true });
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks

async function assetBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  if (w.op === "create" || w.changed.has("attributes") || w.changed.has("category")) {
    if (n.attributes !== null && n.attributes !== undefined) {
      const r = cleanAttributes(n.category, n.attributes);
      if (r.problem && !isSys(w.ctx)) throw bad(r.problem);
      n.attributes = r.values;
    }
  }
  if (w.op === "create" && !n.device_status && isFleetCategory(n.category)) n.device_status = "in_service";
  // the published end of support of a known operating system, unless one was entered
  if ((w.op === "create" || w.changed.has("os_name")) && n.os_name && !n.os_eos_date && !w.input?.has("os_eos_date")) n.os_eos_date = osEndOfSupport(n.os_name);
  if (w.changed.has("device_status") || (w.op === "create" && n.device_status)) n.device_status_at = nowIso();
  if (isSys(w.ctx) || w.via === "sync") return;
  const everywhere = await holds(w.ctx, "asset", "write", "all", w.tx);
  if (w.op === "update" && w.changed.has("branch_id") && !everywhere) throw forbidden("جابه‌جایی دارایی میان شعبه‌ها با حوالهٔ انتقال است");
  if (w.op === "create" && !everywhere) {
    if (!n.branch_id) n.branch_id = unitOf(w.ctx);
    if (!mayActFor(w.ctx, n.branch_id)) throw forbidden("دارایی را فقط برای شعبه یا واحدی می‌توانید ثبت کنید که اموال آن با شماست");
  }
}

/**
 * A Windows app's pushed asset (its own hooks ran there): a change of branch is taken only from someone who manages
 * assets everywhere, or as the receipt of a transfer into a branch the member may act for; a new asset only in such
 * a branch.
 */
async function assetPush(p: PushArgs): Promise<string | null> {
  if (isSys(p.ctx)) return null;
  const everywhere = await holds(p.ctx, "asset", "write", "all", p.tx);
  if (everywhere) return null;
  if (!p.prev) return p.next.branch_id && !mayActFor(p.ctx, p.next.branch_id) ? "دارایی را فقط برای شعبه یا واحدی می‌توانید ثبت کنید که اموال آن با شماست" : null;
  if (!p.changed.has("branch_id")) return null;
  const sys = sysOf(p.ctx);
  for (const it of await liveRows(p.tx, sys, "asset_transfer_item", { f: "asset_id", op: "eq", v: p.next.id }, { limit: 50 })) {
    const t = await liveRow(p.tx, sys, "asset_transfer", it.transfer_id);
    if (t && ["in_transit", "received", "received_partial"].includes(String(t.state)) && String(t.to_branch_id) === String(p.next.branch_id) && String(t.from_branch_id) === String(p.prev.branch_id) && mayActFor(p.ctx, t.to_branch_id)) return null;
  }
  return "جابه‌جایی دارایی میان شعبه‌ها با حوالهٔ انتقال است";
}

async function assetAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const row = w.next;
  const prev = w.prev ?? {};
  const events: CustodyInput[] = [];
  if (w.op === "create") events.push({ event: "registered", branch_id: row.branch_id, holder_id: row.assigned_to, reference: row.number ? String(row.number) : null });
  else if (!isHandled(w.tx, row.id)) {
    if (w.changed.has("branch_id")) events.push({ event: "branch_changed", branch_id: row.branch_id, from_branch_id: prev.branch_id, holder_id: row.assigned_to });
    if (w.changed.has("assigned_to")) events.push({ event: row.assigned_to ? "assigned" : "returned", branch_id: row.branch_id, holder_id: row.assigned_to, from_holder_id: prev.assigned_to });
    if (w.changed.has("state")) {
      const ev = row.state === "missing" ? "missing" : row.state === "in_repair" ? "repair_out" : prev.state === "in_repair" ? "repair_in" : row.state === "disposed" ? "disposed" : null;
      if (ev) events.push({ event: ev, branch_id: row.branch_id, holder_id: row.assigned_to, note: ev === "missing" ? (row.retire_reason as string) ?? null : ev === "disposed" && row.certificate_no ? `گواهی ${row.certificate_no}` : null });
    }
  }
  for (const e of events) await addCustody(w.tx, w.ctx, row, e);
  if ((w.op === "create" && row.device_status) || (w.op === "update" && w.changed.has("device_status"))) await statusPeriod(w.tx, w.ctx, row);
}

// ----- transfers -----

const OPEN_TRANSFER = ["draft", "pending_approval", "approved", "in_transit"];
const DISPATCHABLE = ["in_stock", "in_use", "in_repair"];

async function transferBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete") {
    if (!isSys(w.ctx) && w.prev?.state !== "draft") throw conflict("فقط حوالهٔ پیش‌نویس حذف می‌شود");
    return;
  }
  const n = w.next;
  if (n.from_branch_id && n.to_branch_id && String(n.from_branch_id) === String(n.to_branch_id)) throw bad("مبدأ و مقصد انتقال یکی است");
  if (isSys(w.ctx) || w.via === "sync") return;
  if (w.op === "update" && w.prev?.state !== "draft" && ["from_branch_id", "to_branch_id", "from_stockroom_id"].some((f) => w.changed.has(f))) throw conflict("مبدأ و مقصد حوالهٔ صادرشده تغییر نمی‌کند");
  // the sending branch issues the note: only for a branch whose assets the caller may change
  if ((w.op === "create" || w.changed.has("from_branch_id")) && !mayActFor(w.ctx, n.from_branch_id)) throw forbidden("حواله را فقط برای دارایی‌های شعبه یا واحدی می‌توانید صادر کنید که اموال آن با شماست");
  if (entering(w, "in_transit")) {
    n.dispatched_at = nowIso();
    n.dispatched_by = actorOf(w.ctx);
  }
}

const entering = (w: WriteArgs, state: string) => w.next.state === state && (w.op === "create" || w.prev?.state !== state);

async function itemsOf(q: Queryable, ctx: Ctx, transferId: unknown): Promise<Row[]> {
  return liveRows(q, sysOf(ctx), "asset_transfer_item", { f: "transfer_id", op: "eq", v: transferId }, { limit: 5000, order: "t.created_at" });
}

const transferGuards = {
  async transfer_has_items(w: WriteArgs): Promise<string | null> {
    return transferProblem(w.next, await itemsOf(w.tx, w.ctx, w.next.id));
  },
  async transfer_can_dispatch(w: WriteArgs): Promise<string | null> {
    const items = await itemsOf(w.tx, w.ctx, w.next.id);
    const p = transferProblem(w.next, items);
    if (p) return p;
    for (const it of items) {
      const a = await liveRow(w.tx, sysOf(w.ctx), "asset", it.asset_id);
      if (!a) return `دارایی «${it.label ?? ""}» پیدا نشد`;
      if (String(a.branch_id ?? "") !== String(w.next.from_branch_id)) return `دارایی «${assetLabel(a)}» دیگر در شعبهٔ مبدأ ثبت نیست`;
      if (!DISPATCHABLE.includes(String(a.state))) return `دارایی «${assetLabel(a)}» در وضعیت «${String(a.state)}» است و ارسال نمی‌شود`;
    }
    return null;
  },
};

async function transferAfter(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !entering(w, "in_transit")) return;
  const sys = sysOf(w.ctx);
  const t = w.next;
  for (const it of await itemsOf(w.tx, w.ctx, t.id)) {
    const a = await liveRow(w.tx, sys, "asset", it.asset_id);
    if (!a) continue;
    markHandled(w.tx, String(a.id));
    await transitionIn(w.tx, sys, "asset", String(a.id), "in_transit", { assigned_to: null, substate: null });
    await addCustody(w.tx, w.ctx, a, { event: "dispatched", branch_id: t.from_branch_id, from_branch_id: t.from_branch_id, from_holder_id: a.assigned_to, reference: t.number ? String(t.number) : null, note: `به ${await unitName(w.tx, w.ctx, t.to_branch_id)}${t.waybill_no ? ` — بارنامه ${t.waybill_no}` : ""}` });
  }
}

async function unitName(q: Queryable, ctx: Ctx, id: unknown): Promise<string> {
  const u = await liveRow(q, sysOf(ctx), "org_unit", id);
  return u ? String(u.name ?? "") : "—";
}

async function transferItemBefore(w: WriteArgs): Promise<void> {
  const parent = await needParentWrite(w, "asset_transfer", "transfer_id");
  if (!parent) throw bad("حواله پیدا نشد");
  if (!isSys(w.ctx) && w.via !== "sync" && parent.state !== "draft") throw conflict("اقلام حواله فقط در پیش‌نویس تغییر می‌کند؛ آنچه تأیید شده همان است که ارسال می‌شود");
  if (w.op === "delete") return;
  const n = w.next;
  n.from_branch_id = parent.from_branch_id;
  n.to_branch_id = parent.to_branch_id;
  if (w.op === "create" || w.changed.has("asset_id")) {
    const a = await liveRow(w.tx, sysOf(w.ctx), "asset", n.asset_id);
    if (!a) throw bad("دارایی پیدا نشد");
    if (!isSys(w.ctx) && String(a.branch_id ?? "") !== String(parent.from_branch_id)) throw bad(`دارایی «${assetLabel(a)}» در شعبهٔ مبدأ این حواله ثبت نشده است`);
    if (!isSys(w.ctx) && w.via !== "sync" && !access().canWrite(w.ctx, tableDef("asset")!, a)) throw forbidden("فقط دارایی‌ای را می‌توانید در حواله بگذارید که تغییر آن با شماست");
    if (["disposed", "canceled", "retired", "missing", "on_order", "in_transit"].includes(String(a.state))) throw conflict(`دارایی «${assetLabel(a)}» قابل انتقال نیست`);
    const busy = await liveRows(w.tx, sysOf(w.ctx), "asset_transfer_item", { and: [{ f: "asset_id", op: "eq", v: a.id }, { f: "transfer_id", op: "ne", v: parent.id }] }, { limit: 20 });
    for (const b of busy) {
      const other = await liveRow(w.tx, sysOf(w.ctx), "asset_transfer", b.transfer_id);
      if (other && OPEN_TRANSFER.includes(String(other.state))) throw conflict(`دارایی «${assetLabel(a)}» در حوالهٔ باز ${other.number ?? ""} است`);
    }
    n.label = assetLabel(a);
  }
}

async function transferItemAfter(w: WriteArgs): Promise<void> {
  const id = w.next?.transfer_id ?? w.prev?.transfer_id;
  if (!isUuid(id)) return;
  const count = (await itemsOf(w.tx, w.ctx, id)).length;
  await updateIn(w.tx, sysOf(w.ctx), "asset_transfer", String(id), { item_count: count }, { trusted: true, keepVersion: true });
}

export interface ReceiveInput {
  items: { id: string; result: TransferItemResult; condition_in?: string | null; note?: string | null }[];
  note?: string | null;
}

/** May the caller act for `branchId` (would they be able to change an asset of that branch that names nobody)? */
export function mayActFor(ctx: Ctx, branchId: unknown): boolean {
  if (isSys(ctx)) return true;
  return access().canWrite(ctx, tableDef("asset")!, { org_id: ctx.org.id, branch_id: branchId, state: "in_stock" });
}

/** The receiving branch takes the receipt of a transfer: per item received, damaged or missing. */
export async function receiveTransfer(ctx: Ctx, id: string, input: ReceiveInput): Promise<{ state: string; received: number; discrepancies: number }> {
  const { row: t } = await get(ctx, "asset_transfer", id);
  if (t.state !== "in_transit") throw conflict("این حواله در راه نیست");
  if (!mayActFor(ctx, t.to_branch_id)) throw forbidden("رسید این حواله با شعبه یا واحد گیرنده است");
  const sys = sysOf(ctx, ctx.user.id);
  const byId = new Map(input.items.map((i) => [String(i.id), i]));
  return ctx.write(async (tx) => {
    const items = await itemsOf(tx, ctx, id);
    const toBranch = await liveRow(tx, sys, "org_unit", t.to_branch_id);
    let toRoom = isUuid(t.to_stockroom_id) ? String(t.to_stockroom_id) : null;
    if (!toRoom) {
      const [room] = await liveRows(tx, sys, "stockroom", { and: [{ f: "branch_id", op: "eq", v: t.to_branch_id }, { f: "active", op: "eq", v: true }] }, { limit: 1 });
      toRoom = room ? String(room.id) : null;
    }
    const results: TransferItemResult[] = [];
    for (const it of items) {
      const r = byId.get(String(it.id));
      const result: TransferItemResult = r && ["received", "damaged", "missing"].includes(r.result) ? r.result : "missing";
      results.push(result);
      await updateIn(tx, sys, "asset_transfer_item", String(it.id), { result, condition_in: result === "missing" ? null : r?.condition_in ?? (result === "damaged" ? "damaged" : "good"), note: r?.note ?? it.note ?? null }, { trusted: true });
      const a = await liveRow(tx, sys, "asset", it.asset_id);
      if (!a) continue;
      markHandled(tx, String(a.id));
      if (result === "missing") {
        await transitionIn(tx, sys, "asset", String(a.id), "missing", { retire_reason: `در انتقال ${t.number ?? ""} به شعبهٔ گیرنده نرسید`, substate: "lost" });
        await addCustody(tx, ctx, a, { event: "transfer_missing", branch_id: t.from_branch_id, from_branch_id: t.from_branch_id, reference: t.number ? String(t.number) : null, note: r?.note ?? null });
        continue;
      }
      const base: Row = { branch_id: t.to_branch_id, location_id: toBranch?.location_id ?? a.location_id ?? null };
      if (toRoom) await transitionIn(tx, sys, "asset", String(a.id), "in_stock", { ...base, stockroom_id: toRoom, substate: result === "damaged" ? "defective" : "available" });
      else await transitionIn(tx, sys, "asset", String(a.id), "in_use", { ...base, department_id: t.to_branch_id, substate: "assigned", stockroom_id: null });
      await addCustody(tx, ctx, a, { event: "received", branch_id: t.to_branch_id, from_branch_id: t.from_branch_id, holder_id: null, reference: t.number ? String(t.number) : null, note: result === "damaged" ? `رسید با آسیب${r?.note ? ` — ${r.note}` : ""}` : r?.note ?? null });
    }
    const out = receiptOutcome(results);
    await updateIn(tx, sys, "asset_transfer", id, {
      received_at: nowIso(), received_by: actorOf(ctx), received_count: out.received, discrepancy_count: out.discrepancies, receipt_note: input.note ? String(input.note).slice(0, 2000) : null,
    }, { trusted: true });
    await transitionIn(tx, sys, "asset_transfer", id, out.state, {});
    if (out.discrepancies) {
      await emitEvent(tx, sys, { kind: "record.itam.transfer_discrepancy", table: "asset_transfer", id, number: (t.number as string) ?? null, data: { discrepancies: out.discrepancies, missing: out.missing, damaged: out.damaged } });
    }
    return { state: out.state, received: out.received, discrepancies: out.discrepancies };
  });
}

// ----- audits: branch scope and reconciliation -----

async function auditItemBranch(w: WriteArgs): Promise<void> {
  if (w.op !== "create" || w.next.branch_id) return;
  const audit = await liveRow(w.tx, sysOf(w.ctx), "inventory_audit", w.next.audit_id);
  if (audit?.branch_id) w.next.branch_id = audit.branch_id;
  if (w.next.result === "moved" && isUuid(w.next.asset_id)) {
    const a = await liveRow(w.tx, sysOf(w.ctx), "asset", w.next.asset_id);
    if (a?.branch_id) w.next.expected_branch_id = a.branch_id;
  }
}

/** Recount an audit's open discrepancies (after completion and after every settlement). */
async function recountDiscrepancies(tx: Tx, ctx: Ctx, auditId: string): Promise<number> {
  const sys = sysOf(ctx);
  const items = await liveRows(tx, sys, "inventory_audit_item", { f: "audit_id", op: "eq", v: auditId }, { limit: 20000 });
  const open = openDiscrepancies(items);
  await updateIn(tx, sys, "inventory_audit", auditId, { discrepancy_open: open }, { trusted: true, keepVersion: true });
  return open;
}

async function auditAfterBank(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || !entering(w, "completed")) return;
  // completion has turned unseen items into «missing» (the module's audit hook ran first); stamp custody of the seen
  const sys = sysOf(w.ctx);
  const items = await liveRows(w.tx, sys, "inventory_audit_item", { and: [{ f: "audit_id", op: "eq", v: w.next.id }, { f: "result", op: "eq", v: "found" }] }, { limit: 20000 });
  for (const it of items) {
    const a = await liveRow(w.tx, sys, "asset", it.asset_id);
    if (a) await addCustody(w.tx, w.ctx, a, { event: "audited", branch_id: a.branch_id, holder_id: a.assigned_to, reference: w.next.number ? String(w.next.number) : null });
  }
  await recountDiscrepancies(w.tx, w.ctx, String(w.next.id));
}

const auditGuards = {
  async audit_can_close(w: WriteArgs): Promise<string | null> {
    const items = await liveRows(w.tx, sysOf(w.ctx), "inventory_audit_item", { f: "audit_id", op: "eq", v: w.next.id }, { limit: 20000 });
    const open = openDiscrepancies(items);
    return open ? `${open} مغایرت هنوز تعیین تکلیف نشده است` : null;
  },
};

export interface ResolveInput {
  resolution: AuditResolution;
  note?: string | null;
  /** «registered»: the model of the asset to add (an unknown code) */
  model_id?: string | null;
}

/** Settle one discrepancy of a completed audit (the reconciliation): the asset follows the decision. */
export async function resolveAuditItem(ctx: Ctx, itemId: string, input: ResolveInput): Promise<{ item: Row; open: number; asset_id: string | null; transfer_id: string | null }> {
  const { row: item } = await get(ctx, "inventory_audit_item", itemId);
  const { row: audit } = await get(ctx, "inventory_audit", String(item.audit_id));
  if (audit.state !== "completed") throw conflict("تعیین تکلیف پس از پایان شمارش و پیش از بستن آن است");
  if (!access().canWrite(ctx, tableDef("inventory_audit")!, audit)) throw forbidden("تعیین تکلیف مغایرت‌های این شمارش با مسئول آن است");
  const allowed = RESOLUTIONS_FOR[String(item.result) as AuditResult] ?? [];
  if (!allowed.includes(input.resolution)) throw bad("این تعیین تکلیف برای این قلم ممکن نیست");
  const sys = sysOf(ctx, ctx.user.id);
  const everywhere = await holds(ctx, "asset", "write", "all");
  return ctx.write(async (tx) => {
    let assetId: string | null = isUuid(item.asset_id) ? String(item.asset_id) : null;
    let transferId: string | null = null;
    const a = assetId ? await liveRow(tx, sys, "asset", assetId) : null;
    if (input.resolution === "confirmed_missing" && a && ["in_stock", "in_use", "in_transit", "in_repair"].includes(String(a.state))) {
      if (!access().canWrite(ctx, tableDef("asset")!, a)) throw forbidden("این دارایی را نمی‌توانید تغییر دهید");
      await transitionIn(tx, sys, "asset", String(a.id), "missing", { retire_reason: `در شمارش ${audit.number ?? ""} دیده نشد${input.note ? ` — ${input.note}` : ""}`, substate: "lost" });
    }
    if (input.resolution === "found" && a) await updateIn(tx, sys, "asset", String(a.id), { last_audit_result: "found", last_audit_at: nowIso() }, { trusted: true, keepVersion: true });
    if (input.resolution === "written_off" && a) {
      if (!everywhere) throw forbidden("حذف از دفتر با مدیر دارایی است");
      if (!["retired", "disposed", "canceled"].includes(String(a.state))) {
        if (a.state !== "missing") await transitionIn(tx, sys, "asset", String(a.id), "missing", { retire_reason: `در شمارش ${audit.number ?? ""} دیده نشد`, substate: "lost" });
        await transitionIn(tx, sys, "asset", String(a.id), "retired", { retire_reason: `حذف از دفتر پس از شمارش ${audit.number ?? ""}${input.note ? ` — ${input.note}` : ""}` });
      }
    }
    if (input.resolution === "transferred" && a) {
      const here = audit.branch_id;
      if (!isUuid(here)) throw bad("این شمارش شعبه ندارد؛ جابه‌جایی را با حوالهٔ انتقال ثبت کنید");
      if (String(a.branch_id ?? "") !== String(here)) {
        if (everywhere) {
          // the register follows the count (custody «تغییر شعبه در دفتر» with the audit as reference)
          markHandled(tx, String(a.id));
          await updateIn(tx, sys, "asset", String(a.id), { branch_id: here }, { trusted: true });
          await addCustody(tx, ctx, a, { event: "branch_changed", branch_id: here, from_branch_id: a.branch_id, holder_id: a.assigned_to, reference: audit.number ? String(audit.number) : null, note: "پس از شمارش" });
        } else {
          // a draft transfer from the registered branch, for that branch to approve and dispatch
          // nobody of the counting branch owns it: the registered branch sends it for approval and dispatches it
          const t = await createIn(tx, sys, "asset_transfer", { title: `اصلاح دفتر پس از شمارش ${audit.number ?? ""}`, reason: "relocation", from_branch_id: a.branch_id, to_branch_id: here, requested_by: null, notes: input.note ?? null }, { trusted: true });
          await createIn(tx, sys, "asset_transfer_item", { transfer_id: t.id, asset_id: a.id, condition_out: "good", note: `دیده‌شده در شمارش ${audit.number ?? ""}` }, { trusted: true });
          transferId = String(t.id);
        }
      }
    }
    if (input.resolution === "registered") {
      if (!isUuid(input.model_id)) throw bad("مدل دارایی تازه را انتخاب کنید");
      if (!(await holds(ctx, "asset", "create", "own", tx))) throw forbidden("ثبت دارایی تازه با مسئول اموال است");
      const created = await createIn(tx, sys, "asset", {
        model_id: input.model_id, state: "in_use", branch_id: audit.branch_id ?? null, department_id: audit.branch_id ?? null, location_id: audit.location_id ?? null,
        serial_number: item.scanned_code ? String(item.scanned_code).slice(0, 120) : null, notes: `در شمارش ${audit.number ?? ""} پیدا شد${input.note ? ` — ${input.note}` : ""}`,
      }, { trusted: true });
      assetId = String(created.id);
    }
    const updated = await updateIn(tx, sys, "inventory_audit_item", itemId, {
      resolution: input.resolution, resolved_by: actorOf(ctx), resolved_at: nowIso(), transfer_id: transferId, asset_id: assetId, note: input.note ? String(input.note).slice(0, 300) : item.note ?? null,
    }, { trusted: true });
    const open = await recountDiscrepancies(tx, ctx, String(audit.id));
    return { item: updated, open, asset_id: assetId, transfer_id: transferId };
  });
}

// ----- attestation -----

async function attestationBefore(w: WriteArgs): Promise<void> {
  if (w.op === "delete" || isSys(w.ctx) || w.via === "sync") return;
  if (w.op === "update" && ["branch_id", "manager_id", "period_label", "due_date"].some((f) => w.changed.has(f)) && !(await holds(w.ctx, "asset", "write", "unit_tree", w.tx))) {
    throw forbidden("دوره، شعبه و رئیس شعبهٔ تأیید را مدیر اموال تعیین می‌کند");
  }
}

export interface AttestInput {
  signed_name: string;
  exceptions: { asset_id: string; issue: "missing" | "damaged" | "wrong_location" | "other"; note?: string | null }[];
  note?: string | null;
}

const ISSUES: Record<string, string> = { missing: "موجود نیست", damaged: "آسیب‌دیده", wrong_location: "جای نادرست", other: "سایر" };

/** The branch's live assets an attestation covers. */
async function branchAssets(q: Queryable, ctx: Ctx, branchId: unknown): Promise<Row[]> {
  return liveRows(q, ctx, "asset", { and: [{ f: "branch_id", op: "eq", v: branchId }, { f: "state", op: "nin", v: ["disposed", "canceled", "on_order"] }] } as Cond, { limit: 20000, order: "t.no" });
}

/** The manager (or whoever may change the branch's assets) attests the branch's list, with exceptions. */
export async function attest(ctx: Ctx, id: string, input: AttestInput): Promise<{ state: string; exceptions: number }> {
  const { row: att } = await get(ctx, "branch_attestation", id);
  if (att.state !== "open") throw conflict("این تأیید باز نیست");
  const def = tableDef("branch_attestation")!;
  // the named branch manager attests; when none is named (or for them), only someone who approves in the area and
  // may change the attestation — never the branch's asset officer, whose work the attestation checks
  const isManager = !!att.manager_id && att.manager_id === ctx.user.id;
  if (!isManager && !(access().canWrite(ctx, def, att) && (await holds(ctx, "asset", "approve")))) throw forbidden("تأیید اموال شعبه با رئیس شعبه است");
  const name = String(input.signed_name ?? "").trim();
  if (name.length < 3) throw bad("نام امضاکننده را بنویسید");
  const sys = sysOf(ctx, ctx.user.id);
  const assets = await branchAssets(ctx.db, sys, att.branch_id);
  const ids = new Set(assets.map((a) => String(a.id)));
  const exceptions = (input.exceptions ?? []).filter((e) => ids.has(String(e.asset_id)));
  return ctx.write(async (tx) => {
    const at = nowIso();
    const list = exceptions.map((e) => {
      const a = assets.find((x) => String(x.id) === String(e.asset_id))!;
      return { asset_id: String(a.id), label: assetLabel(a), issue: e.issue, issue_label: ISSUES[e.issue] ?? e.issue, note: e.note ? String(e.note).slice(0, 300) : null };
    });
    const bad = new Set(list.map((e) => e.asset_id));
    for (const a of assets) {
      if (bad.has(String(a.id))) continue;
      markHandled(tx, String(a.id));
      await updateIn(tx, sys, "asset", String(a.id), { last_attested_at: at }, { trusted: true, keepVersion: true });
      await addCustody(tx, ctx, a, { event: "attested", branch_id: a.branch_id, holder_id: a.assigned_to, reference: att.number ? String(att.number) : null, note: `امضا: ${name}` });
    }
    const state = list.length ? "attested_exceptions" : "attested";
    await updateIn(tx, sys, "branch_attestation", id, { asset_count: assets.length, exception_count: list.length, exceptions: list, signed_name: name.slice(0, 120), attested_at: at, attested_by: actorOf(ctx), overdue: false, review_note: input.note ?? att.review_note ?? null }, { trusted: true });
    await transitionIn(tx, sys, "branch_attestation", id, state, {});
    if (list.length) await emitEvent(tx, sys, { kind: "record.itam.attestation_exceptions", table: "branch_attestation", id, number: (att.number as string) ?? null, data: { exceptions: list.length } });
    return { state, exceptions: list.length };
  });
}

/** Open the period's attestation for every branch that holds assets (idempotent per branch and period); flag overdue. */
export async function openAttestations(sys: Ctx, today = orgToday(sys)): Promise<{ opened: number; overdue: number }> {
  const cfg = await itamConfig(sys.db, sys);
  const p = attestationPeriod(today, Number(cfg.attestation_months ?? 0));
  let opened = 0;
  let overdue = 0;
  const late = await liveRows(sys.db, sys, "branch_attestation", { and: [{ f: "state", op: "eq", v: "open" }, { f: "due_date", op: "lt", v: today }, { f: "overdue", op: "eq", v: false }] } as Cond, { limit: 2000 });
  if (late.length) {
    await sys.write(async (tx) => {
      for (const a of late) {
        await updateIn(tx, sys, "branch_attestation", String(a.id), { overdue: true }, { trusted: true });
        overdue++;
      }
    });
  }
  if (!p) return { opened, overdue };
  const rows = await sys.db.query<{ branch_id: string; n: string }>(
    `select branch_id, count(*) as n from sm_assets where org_id = $1 and deleted_at is null and branch_id is not null and state not in ('disposed', 'canceled', 'on_order') group by branch_id`,
    [sys.org.id],
  );
  const existing = new Set((await liveRows(sys.db, sys, "branch_attestation", { f: "period_label", op: "eq", v: p.label }, { limit: 20000 })).map((a) => String(a.branch_id)));
  const todo = rows.filter((r) => !existing.has(String(r.branch_id)));
  for (let i = 0; i < todo.length; i += 100) {
    await sys.write(async (tx) => {
      for (const r of todo.slice(i, i + 100)) {
        const unit = await liveRow(tx, sys, "org_unit", r.branch_id);
        if (!unit) continue;
        await createIn(tx, sys, "branch_attestation", {
          title: `تأیید اموال ${unit.name ?? ""} — ${p.label}`.slice(0, 200), branch_id: unit.id, manager_id: unit.manager_id ?? null, period_label: p.label,
          due_date: attestationDue(today, Number(cfg.attestation_due_days ?? 30)), asset_count: Number(r.n),
        }, { trusted: true });
        opened++;
      }
    });
  }
  return { opened, overdue };
}

// ----- disposal: wipe certificates -----

async function disposalItemBank(w: WriteArgs): Promise<void> {
  if (w.op === "delete") return;
  const n = w.next;
  const ready = !!(n.sanitized_at && n.certificate_no && n.sanitization_method);
  if (!ready) {
    n.certificate_issued_at = null;
    n.certificate_hash = null;
    return;
  }
  if (["sanitized_at", "certificate_no", "sanitization_method", "sanitized_by", "witness_id", "wipe_tool", "asset_id"].some((f) => w.changed.has(f)) || !n.certificate_hash) {
    const a = await liveRow(w.tx, sysOf(w.ctx), "asset", n.asset_id);
    n.certificate_issued_at = nowIso();
    n.certificate_hash = createHash("sha256").update(JSON.stringify(certificateBody(a ?? {}, n))).digest("hex");
    if (a && w.changed.has("sanitized_at")) await addCustody(w.tx, w.ctx, a, { event: "wiped", branch_id: a.branch_id, reference: String(n.certificate_no), note: labelIn(SANITIZATION_METHODS, n.sanitization_method) });
  }
}

/** What a wipe certificate certifies (hashed into `certificate_hash`, printed by the UI). */
function certificateBody(a: Row, item: Row): Row {
  return {
    asset_number: a.number ?? null, asset_tag: a.asset_tag ?? null, serial_number: a.serial_number ?? null, model: a.model_id ?? null, name: a.name ?? null,
    method: item.sanitization_method ?? null, tool: item.wipe_tool ?? null, sanitized_at: isoOrNull(item.sanitized_at), sanitized_by: idOrNull(item.sanitized_by),
    witness_id: idOrNull(item.witness_id), certificate_no: item.certificate_no ?? null, order_id: idOrNull(item.order_id),
  };
}

/** The data of a printable wipe certificate (the caller must read the item). */
export async function wipeCertificate(ctx: Ctx, itemId: string): Promise<Row> {
  const { row: item } = await get(ctx, "disposal_item", itemId);
  if (!item.certificate_hash) throw conflict("گواهی هنوز صادر نشده است: روش، زمان پاک‌سازی و شمارهٔ گواهی را ثبت کنید");
  const sys = sysOf(ctx);
  const a = await liveRow(ctx.db, sys, "asset", item.asset_id);
  const order = await liveRow(ctx.db, sys, "disposal_order", item.order_id);
  const model = a ? await liveRow(ctx.db, sys, "asset_model", a.model_id) : null;
  const people = await namesOf(ctx, [item.sanitized_by, item.witness_id]);
  const branch = a?.branch_id ? await liveRow(ctx.db, sys, "org_unit", a.branch_id) : null;
  return {
    certificate_no: item.certificate_no, issued_at: item.certificate_issued_at, hash: item.certificate_hash, verified: !!item.verified,
    method: labelIn(SANITIZATION_METHODS, item.sanitization_method), tool: item.wipe_tool ?? null, sanitized_at: item.sanitized_at,
    sanitized_by: people.get(String(item.sanitized_by)) ?? null, witness: people.get(String(item.witness_id)) ?? null,
    asset: a ? { number: a.number, tag: a.asset_tag, name: a.name, serial: a.serial_number, model: model?.name ?? null, branch: branch?.name ?? null } : null,
    order: order ? { number: order.number, title: order.title, state: order.state } : null,
    org: ctx.org.name ?? "",
  };
}

async function namesOf(ctx: Ctx, ids: unknown[]): Promise<Map<string, string>> {
  const list = ids.filter(isUuid).map((x) => String(x));
  if (!list.length) return new Map();
  const rows = await ctx.db.query<{ id: string; name: string }>(`select id, coalesce(nullif(full_name, ''), email) as name from sm_users where id = any($1::uuid[])`, [pgArray(list)]);
  return new Map(rows.map((r) => [String(r.id), r.name]));
}

// ---------------------------------------------------------------------------------------------------------------
// Fleet: status, availability, contracts, preventive maintenance, risk

export interface FleetInput {
  days?: number;
}

const FLEET: Cond = { and: [{ f: "category", op: "in", v: FLEET_CATEGORIES }, { f: "state", op: "nin", v: ["disposed", "canceled", "retired", "on_order"] }] };

/** The ATM/CRS/kiosk fleet the caller may read: devices, status counts, availability, EOS, contracts and penalties. */
export async function fleet(ctx: Ctx, input: FleetInput = {}): Promise<Row> {
  const days = Math.max(1, Math.min(365, Math.floor(input.days ?? 30)));
  const today = orgToday(ctx);
  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const devices = await liveRows(ctx.db, ctx, "asset", FLEET, { limit: 5000, order: "t.no" });
  const ids = devices.map((d) => String(d.id));
  const sys = sysOf(ctx);
  const periods = ids.length
    ? await liveRows(ctx.db, sys, "device_status_event", { and: [{ f: "asset_id", op: "in", v: ids }, { or: [{ f: "to_at", op: "empty" }, { f: "to_at", op: "gte", v: from }] }] } as Cond, { limit: 50000 })
    : [];
  const byAsset = new Map<string, StatusPeriod[]>();
  for (const p of periods) {
    const k = String(p.asset_id);
    if (!byAsset.has(k)) byAsset.set(k, []);
    byAsset.get(k)!.push({ status: String(p.status), from_at: String(p.from_at), to_at: p.to_at ? String(p.to_at) : null });
  }
  const units = new Map((await liveRows(ctx.db, sys, "org_unit", null, { limit: 20000 })).map((u) => [String(u.id), u]));
  const regionOf = (branchId: unknown) => {
    const u = units.get(String(branchId ?? ""));
    if (!u) return null;
    const parent = u.parent_id ? units.get(String(u.parent_id)) : null;
    return parent ?? u;
  };
  const slas = await liveRows(ctx.db, sys, "maintenance_sla", { f: "active", op: "eq", v: true }, { limit: 500 });
  // contract names as the caller may read them (a branch's staff may not read the vendor contracts)
  const contractIds = [...new Set(devices.map((d) => d.support_contract_id).filter(isUuid).map(String))];
  const contracts = new Map((contractIds.length ? await liveRows(ctx.db, ctx, "contract", { f: "id", op: "in", v: contractIds }, { limit: 5000 }).catch(() => [] as Row[]) : []).map((c) => [String(c.id), c]));
  const financial = await hasGroup(ctx, "financial");
  // incidents of the devices' CIs in the last 90 days (failure-risk input), counted as the system: a count, no content
  const ciIds = devices.map((d) => d.ci_id).filter(isUuid).map(String);
  const incidents = new Map<string, number>();
  if (ciIds.length && tableDef("incident")) {
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const rows = await ctx.db.query<{ ci_id: string; n: string }>(`select ci_id, count(*) as n from sm_incidents where org_id = $1 and deleted_at is null and ci_id = any($2::uuid[]) and created_at >= $3 group by ci_id`, [ctx.org.id, pgArray(ciIds), since]).catch(() => []);
    for (const r of rows) incidents.set(String(r.ci_id), Number(r.n));
  }
  // work orders and maintenance plans (field service) of the devices' CIs
  const openWo = new Map<string, number>();
  const nextPm = new Map<string, string>();
  if (ciIds.length && tableDef("work_order")) {
    const wo = await ctx.db.query<{ ci_id: string; n: string }>(`select ci_id, count(*) as n from sm_work_orders where org_id = $1 and deleted_at is null and ci_id = any($2::uuid[]) and state not in ('closed', 'canceled', 'completed') group by ci_id`, [ctx.org.id, pgArray(ciIds)]).catch(() => []);
    for (const r of wo) openWo.set(String(r.ci_id), Number(r.n));
    const pm = await ctx.db.query<{ ci_id: string; d: string }>(`select ci_id, min(next_due)::text as d from sm_maintenance_plans where org_id = $1 and deleted_at is null and status = 'active' and ci_id = any($2::uuid[]) group by ci_id`, [ctx.org.id, pgArray(ciIds)]).catch(() => []);
    for (const r of pm) nextPm.set(String(r.ci_id), String(r.d).slice(0, 10));
  }
  const models = new Map((await liveRows(ctx.db, sys, "asset_model", { f: "category", op: "in", v: FLEET_CATEGORIES }, { limit: 2000 })).map((m) => [String(m.id), m]));

  const statusCounts: Record<string, number> = Object.fromEntries(DEVICE_STATUS.map((s) => [s.value, 0]));
  const eos = { past: 0, soon: 0, ok: 0, unknown: 0 };
  const regions = new Map<string, { id: string; name: string; devices: number; up: number; total: number }>();
  const contractAgg = new Map<string, { id: string; name: string; number: string | null; devices: number; up: number; total: number; breaches: number; late_hours: number; penalty: string; target: string | null }>();
  const rows = devices.map((d) => {
    const ps = byAsset.get(String(d.id)) ?? [];
    const av = availabilityOf(ps, from, to);
    statusCounts[String(d.device_status ?? "in_service")] = (statusCounts[String(d.device_status ?? "in_service")] ?? 0) + 1;
    const bucket = eosBucket(today, d.os_eos_date);
    eos[bucket]++;
    const region = regionOf(d.branch_id);
    if (region) {
      const r = regions.get(String(region.id)) ?? { id: String(region.id), name: String(region.name ?? ""), devices: 0, up: 0, total: 0 };
      r.devices++;
      r.up += av.up_minutes;
      r.total += av.window_minutes;
      regions.set(String(region.id), r);
    }
    let penalty: Row | null = null;
    if (isUuid(d.support_contract_id)) {
      const c = contracts.get(String(d.support_contract_id));
      const sla = slas.find((s) => String(s.contract_id) === String(d.support_contract_id) && (!Array.isArray(s.categories) || !s.categories.length || (s.categories as string[]).includes(String(d.category))));
      const agg = contractAgg.get(String(d.support_contract_id)) ?? { id: String(d.support_contract_id), name: String(c?.name ?? "—"), number: (c?.number as string) ?? null, devices: 0, up: 0, total: 0, breaches: 0, late_hours: 0, penalty: "0", target: sla?.availability_target ? String(sla.availability_target) : null };
      agg.devices++;
      agg.up += av.up_minutes;
      agg.total += av.window_minutes;
      if (sla) {
        const p = penaltyOf(ps, { restore_hours: Number(sla.restore_hours ?? 8), penalty_per_hour: sla.penalty_per_hour as string, penalty_cap: sla.penalty_cap as string, counts_maintenance: !!sla.counts_maintenance }, from, to);
        agg.breaches += p.breaches;
        agg.late_hours += p.late_hours;
        agg.penalty = D(agg.penalty).plus(p.amount).toFixed(0);
        penalty = { breaches: p.breaches, late_hours: p.late_hours, amount: financial ? p.amount : null };
      }
      contractAgg.set(String(d.support_contract_id), agg);
    }
    const model = models.get(String(d.model_id));
    const age = d.in_service_date || d.purchase_date ? monthsBetween(String(d.in_service_date || d.purchase_date), today) : null;
    const risk = failureRisk({
      incidents_90d: isUuid(d.ci_id) ? incidents.get(String(d.ci_id)) ?? 0 : 0,
      downtime_minutes_30d: Object.values(availabilityOf(ps, new Date(Date.now() - 30 * 86_400_000).toISOString(), to).down).reduce((x, y) => x + y, 0),
      age_months: age, life_months: Number(model?.useful_life_months ?? deviceClass(d.category)?.life_months ?? 84), eos_days: daysTo(today, d.os_eos_date), status: (d.device_status as string) ?? null,
    });
    return {
      id: String(d.id), number: d.number ?? null, asset_tag: d.asset_tag ?? null, name: d.name ?? null, category: d.category, terminal_id: d.terminal_id ?? null,
      branch_id: d.branch_id ?? null, branch: units.get(String(d.branch_id ?? ""))?.name ?? null, region: region?.name ?? null, site_type: d.site_type ?? null,
      device_status: d.device_status ?? "in_service", device_status_at: d.device_status_at ?? null, os_name: d.os_name ?? null, os_eos_date: d.os_eos_date ?? null, eos: bucket,
      firmware_version: d.firmware_version ?? null, model: model?.name ?? null, contract: isUuid(d.support_contract_id) ? contracts.get(String(d.support_contract_id))?.name ?? null : null,
      availability: av.availability, down_minutes: av.window_minutes - av.up_minutes, penalty, open_work_orders: isUuid(d.ci_id) ? openWo.get(String(d.ci_id)) ?? 0 : 0,
      next_pm: isUuid(d.ci_id) ? nextPm.get(String(d.ci_id)) ?? null : null, ci_id: d.ci_id ?? null, risk,
    };
  });
  const pct = (up: number, total: number) => (total ? D(up).mul(100).div(total).toFixed(2) : "100.00");
  const allUp = rows.reduce((x, r) => x + (Number(r.availability) / 100), 0);
  return {
    days, from, to, total: rows.length, status: statusCounts, eos,
    availability: rows.length ? D(allUp).mul(100).div(rows.length).toFixed(2) : "100.00",
    regions: [...regions.values()].map((r) => ({ id: r.id, name: r.name, devices: r.devices, availability: pct(r.up, r.total) })).sort((a, b) => Number(a.availability) - Number(b.availability)),
    contracts: [...contractAgg.values()].map((c) => ({ id: c.id, name: c.name, number: c.number, devices: c.devices, availability: pct(c.up, c.total), target: c.target, below_target: c.target ? Number(pct(c.up, c.total)) < Number(c.target) : false, breaches: c.breaches, late_hours: c.late_hours, penalty: financial ? c.penalty : null })),
    devices: rows,
    financial,
    can_manage: await holds(ctx, "asset", "write", "group"),
    can_plan: !!tableDef("maintenance_plan") && (await holds(ctx, "field_service", "create", "own")),
  };
}

/** Change a device's operational status (the caller must be able to change the asset); an incident when asked. */
export async function setDeviceStatus(ctx: Ctx, id: string, input: { status: string; reason?: string | null; incident?: boolean }): Promise<{ asset: Row; incident: { id: string; number: string | null } | null }> {
  if (!DEVICE_STATUS.some((s) => s.value === input.status)) throw bad("وضعیت عملیاتی معتبر نیست");
  const { row: a } = await get(ctx, "asset", id);
  if (!isFleetCategory(a.category)) throw bad("وضعیت عملیاتی برای خودپرداز، CRS و کیوسک است");
  if (!access().canWrite(ctx, tableDef("asset")!, a)) throw forbidden("وضعیت این دستگاه را نمی‌توانید تغییر دهید");
  const sys = sysOf(ctx, ctx.user.id);
  return ctx.write(async (tx) => {
    let incident: { id: string; number: string | null } | null = null;
    if (input.incident && input.status !== "in_service" && tableDef("incident") && (await holds(ctx, "incident", "create", "own", tx))) {
      const title = input.status === "out_of_cash" ? `خودپرداز بدون وجه نقد: ${a.name ?? a.number ?? ""}` : `${labelIn(DEVICE_STATUS, input.status)}: ${a.name ?? a.number ?? ""}`;
      const inc = await createIn(tx, sys, "incident", {
        short_description: title.slice(0, 200), description: [input.reason ?? "", a.terminal_id ? `شناسهٔ پایانه: ${a.terminal_id}` : ""].filter(Boolean).join("\n") || null,
        ci_id: isUuid(a.ci_id) ? a.ci_id : null, location_id: a.location_id ?? null, caller_id: ctx.user.id, impact: "2", urgency: input.status === "out_of_cash" ? "2" : "3",
      }, { trusted: true });
      incident = { id: String(inc.id), number: (inc.number as string) ?? null };
    }
    setStatusInfo(tx, id, { reason: input.reason ?? null, incident_id: incident?.id ?? null });
    const asset = await updateIn(tx, sys, "asset", id, { device_status: input.status }, { trusted: true });
    return { asset, incident };
  });
}

/** Preventive maintenance: a field-service maintenance plan for every fleet device with a CI and no active plan. */
export async function createPmPlans(ctx: Ctx, input: { every_n?: number; interval_unit?: string; group_id?: string | null; lead_days?: number }): Promise<{ created: number; skipped: number }> {
  if (!tableDef("maintenance_plan")) throw conflict("ماژول خدمات میدانی نصب نیست");
  if (!(await holds(ctx, "field_service", "create", "own"))) throw forbidden("ساخت برنامهٔ نگهداری با کارشناس خدمات میدانی است");
  const devices = (await liveRows(ctx.db, ctx, "asset", FLEET, { limit: 5000, order: "t.no" })).filter((d) => isUuid(d.ci_id));
  const sys = sysOf(ctx, ctx.user.id);
  const existing = new Set((await liveRows(ctx.db, sys, "maintenance_plan", { f: "status", op: "eq", v: "active" }, { limit: 20000 })).map((p) => String(p.ci_id ?? "")));
  const todo = devices.filter((d) => !existing.has(String(d.ci_id)));
  const every = Math.max(1, Math.min(12, Math.floor(input.every_n ?? 3)));
  const unit = ["day", "week", "month"].includes(String(input.interval_unit)) ? String(input.interval_unit) : "month";
  const today = orgToday(ctx);
  let created = 0;
  for (let i = 0; i < todo.length; i += 100) {
    await ctx.write(async (tx) => {
      for (const d of todo.slice(i, i + 100)) {
        await createIn(tx, sys, "maintenance_plan", {
          name: `نگهداری پیشگیرانهٔ ${d.name ?? d.number ?? ""}`.slice(0, 160), status: "active", generates: "work_order", ci_id: d.ci_id, location_id: d.location_id ?? null,
          group_id: isUuid(input.group_id) ? input.group_id : null, every_n: every, interval_unit: unit, lead_days: Math.max(0, Math.min(30, input.lead_days ?? 7)), horizon: 1,
          next_due: addDays(today, 7), priority: "4",
          description: `بازدید دوره‌ای ${labelIn(MODEL_CATEGORIES, d.category)}${d.terminal_id ? ` (پایانهٔ ${d.terminal_id})` : ""}: تمیزکاری قطعه‌های مکانیکی، آزمون کارت‌خوان و دیسپنسر، به‌روزرسانی نرم‌افزار و بررسی وصله‌های امنیتی.`,
        }, { trusted: true });
        created++;
      }
    });
  }
  return { created, skipped: devices.length - created };
}

/** The failure-risk facts of one device (AI skill `itam.atm_failure_risk`). */
export async function deviceRisk(ctx: Ctx, id: string): Promise<Row> {
  const { row: a } = await get(ctx, "asset", id);
  const f = await fleet(ctx, { days: 30 });
  const d = (f.devices as Row[]).find((x) => x.id === String(a.id));
  return { device: d ?? { id: String(a.id), name: a.name, risk: null }, fleet_availability: f.availability };
}

export function riskText(f: Row): string {
  const d = (f.device ?? {}) as Row;
  const r = d.risk as { score: number; level: string; reasons: string[] } | null;
  if (!r) return "این دستگاه در ناوگان خودپرداز نیست.";
  const level = r.level === "high" ? "زیاد" : r.level === "medium" ? "متوسط" : "کم";
  const lines = [`**ریسک خرابی ${d.name ?? ""}: ${level} (${r.score} از ۱۰۰)**`];
  if (r.reasons.length) lines.push(...r.reasons.map((x) => `- ${x}`));
  else lines.push("- نشانهٔ خاصی از خرابی در سابقهٔ دستگاه نیست.");
  lines.push("", r.level === "high" ? "پیشنهاد: بازدید پیشگیرانه در هفتهٔ پیش رو، بررسی قطعه‌های پرخرابی و برنامهٔ جایگزینی." : r.level === "medium" ? "پیشنهاد: در نوبت بعدی نگهداری پیشگیرانه بررسی شود." : "اقدام فوری لازم نیست.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------
// The asset register «دفتر اموال» by Jalali fiscal year

export interface RegisterInput {
  fy: number;
  branch_id?: string | null;
  category?: string | null;
}

/** The asset register of a fiscal year: cost, opening and closing accumulated depreciation and book values per asset. */
export async function assetRegister(ctx: Ctx, input: RegisterInput): Promise<Row> {
  const fy = Math.floor(input.fy);
  if (!(fy >= 1300 && fy <= 1500)) throw bad("سال مالی معتبر نیست");
  const financial = await hasGroup(ctx, "financial");
  if (!financial) throw forbidden("دفتر اموال با مبالغ است و گروه فیلد «مالی» را می‌خواهد");
  const range = jalaliYearRange(fy);
  const where: Cond[] = [{ f: "state", op: "nin", v: ["canceled", "on_order"] }, { f: "purchase_cost", op: "nempty" }];
  if (isUuid(input.branch_id)) where.push({ f: "branch_id", op: "eq", v: input.branch_id });
  if (input.category) where.push({ f: "category", op: "eq", v: input.category });
  const assets = await liveRows(ctx.db, ctx, "asset", { and: where } as Cond, { limit: 50000, order: "t.no" });
  const sys = sysOf(ctx);
  const rules = new Map((await liveRows(ctx.db, sys, "depreciation_rule", null, { limit: 500 })).map((r) => [String(r.id), r]));
  const units = new Map((await liveRows(ctx.db, sys, "org_unit", null, { limit: 20000 })).map((u) => [String(u.id), u]));
  const models = new Map((await liveRows(ctx.db, sys, "asset_model", null, { limit: 5000 })).map((m) => [String(m.id), m]));
  const rows: Row[] = [];
  const totals = { cost: D(0), opening_cost: D(0), additions: D(0), disposals: D(0), opening_accumulated: D(0), charge: D(0), closing_accumulated: D(0), closing_book: D(0) };
  const byBranch = new Map<string, { branch: string; count: number; cost: ReturnType<typeof D>; charge: ReturnType<typeof D>; book: ReturnType<typeof D> }>();
  for (const a of assets) {
    const start = String(a.in_service_date || a.purchase_date || "").slice(0, 10) || null;
    if (start && start > range.end) continue;
    const endRaw = a.disposed_at || (a.state === "retired" ? a.retired_at : null);
    const end = endRaw ? String(endRaw).slice(0, 10) : null;
    if (end && end < range.start) continue;
    const rule = rules.get(String(a.depreciation_rule_id ?? ""));
    const salvage = a.salvage_value ?? (rule?.salvage_percent ? D(a.purchase_cost as string).mul(rule.salvage_percent as string).div(100).toFixed(0) : "0");
    const r = fiscalYearDepreciation({
      cost: a.purchase_cost as string, salvage: salvage as string, lifeMonths: Number(rule?.life_months ?? models.get(String(a.model_id))?.useful_life_months ?? 36),
      method: (rule?.method as DepMethod) ?? "none", ratePercent: (rule?.rate_percent as string) ?? null, start: rule?.start_basis === "purchase" ? String(a.purchase_date ?? start ?? "").slice(0, 10) || null : start,
      convention: rule?.start_convention === "next_month" ? "next_month" : "same_month", end,
    }, fy);
    const branch = units.get(String(a.branch_id ?? ""));
    rows.push({
      id: String(a.id), number: a.number, asset_tag: a.asset_tag ?? null, name: a.name ?? null, category: a.category ?? null, model: models.get(String(a.model_id))?.name ?? null,
      serial_number: a.serial_number ?? null, branch: branch?.name ?? null, branch_code: branch?.code ?? null, state: a.state, in_service: start, end,
      method: rule?.method ?? "none", life_months: rule?.life_months ?? null, cost: String(a.purchase_cost), ...r,
    });
    totals.cost = totals.cost.plus(a.purchase_cost as string);
    totals.opening_cost = totals.opening_cost.plus(r.opening_cost);
    totals.additions = totals.additions.plus(r.additions);
    totals.disposals = totals.disposals.plus(r.disposals);
    totals.opening_accumulated = totals.opening_accumulated.plus(r.opening_accumulated);
    totals.charge = totals.charge.plus(r.charge);
    totals.closing_accumulated = totals.closing_accumulated.plus(r.closing_accumulated);
    totals.closing_book = totals.closing_book.plus(r.closing_book);
    const k = String(a.branch_id ?? "");
    const b = byBranch.get(k) ?? { branch: branch?.name ? String(branch.name) : "بدون شعبه", count: 0, cost: D(0), charge: D(0), book: D(0) };
    b.count++;
    b.cost = b.cost.plus(a.purchase_cost as string);
    b.charge = b.charge.plus(r.charge);
    b.book = b.book.plus(r.closing_book);
    byBranch.set(k, b);
  }
  const t: Record<string, string | null> = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toFixed(0)]));
  // reconciliation with finance: the year's depreciation the cost ledger holds per asset (when the caller reads it)
  const ledger = await ledgerDepreciation(ctx, range.start, range.end);
  let mismatches = 0;
  if (ledger) {
    let posted = D(0);
    for (const r of rows) {
      const l = ledger.get(String(r.id)) ?? "0";
      posted = posted.plus(l);
      r.ledger = D(l).toFixed(0);
      r.difference = D(String(r.charge)).minus(l).toFixed(0);
      if (r.difference !== "0") mismatches++;
    }
    t.ledger = posted.toFixed(0);
    t.difference = D(t.charge ?? "0").minus(posted).toFixed(0);
  }
  return {
    fiscal_year: fy, from: range.start, to: range.end, rows, totals: t, reconciled: !!ledger, mismatches,
    branches: [...byBranch.values()].map((b) => ({ branch: b.branch, count: b.count, cost: b.cost.toFixed(0), charge: b.charge.toFixed(0), book: b.book.toFixed(0) })).sort((x, y) => y.count - x.count),
  };
}

/** Depreciation the financial module posted per asset between two dates (null: no ledger or no read access). */
async function ledgerDepreciation(ctx: Ctx, from: string, to: string): Promise<Map<string, string> | null> {
  if (!tableDef("cost_entry") || !(await holds(ctx, "financial", "read"))) return null;
  try {
    const r = await aggregate(ctx, "cost_entry", {
      filter: { and: [{ f: "source", op: "eq", v: "depreciation" }, { f: "entry_date", op: "gte", v: from }, { f: "entry_date", op: "lte", v: to }, { f: "asset_id", op: "nempty" }] },
      groupBy: ["asset_id"], metrics: [{ fn: "sum", field: "amount" }], limit: 5000,
    });
    return new Map(r.rows.map((x) => [String(x.keys[0]), String(x.values["sum:amount"] ?? "0")]));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Branch inventory

/** Per branch the caller may read: asset counts by state, open transfers in and out, audits and attestations. */
export async function branchInventory(ctx: Ctx): Promise<Row> {
  const financial = await hasGroup(ctx, "financial");
  // counts through the engine's aggregate (the caller's access; one group per branch, so thousands of branches fit)
  const LIVE: Cond = { f: "state", op: "nin", v: ["disposed", "canceled"] };
  const byBranch = async (filter: Cond, sum = false) => {
    const r = await aggregate(ctx, "asset", { filter, groupBy: ["branch_id"], metrics: [{ fn: "count" }, ...(sum ? [{ fn: "sum" as const, field: "book_value" }] : [])], limit: 5000 });
    return new Map(r.rows.map((x) => [String(x.keys[0] ?? ""), { n: Number(x.values.count ?? 0), value: sum ? String(x.values["sum:book_value"] ?? "0") : null }]));
  };
  const totals = await byBranch(LIVE, financial);
  const states: Record<string, Map<string, { n: number }>> = {};
  for (const st of ["in_use", "in_stock", "in_transit", "in_repair", "missing", "retired"]) states[st] = await byBranch({ f: "state", op: "eq", v: st });
  const FLEET_LIVE: Cond = { and: [LIVE, { f: "category", op: "in", v: FLEET_CATEGORIES }] };
  const fleetAll = await byBranch(FLEET_LIVE);
  const fleetDown = await byBranch({ and: [FLEET_LIVE, { f: "device_status", op: "in", v: ["out_of_service", "out_of_cash", "maintenance", "offline"] }] });
  const sys = sysOf(ctx);
  const units = new Map((await liveRows(ctx.db, sys, "org_unit", null, { limit: 20000 })).map((u) => [String(u.id), u]));
  const transfers = await liveRows(ctx.db, ctx, "asset_transfer", { f: "state", op: "in", v: OPEN_TRANSFER }, { limit: 5000 });
  const audits = await liveRows(ctx.db, ctx, "inventory_audit", { f: "branch_id", op: "nempty" }, { limit: 5000, order: "t.updated_at desc" });
  const atts = await liveRows(ctx.db, ctx, "branch_attestation", null, { limit: 5000, order: "t.updated_at desc" });
  const out = new Map<string, Row>();
  const row = (id: string) => {
    let r = out.get(id);
    if (!r) {
      const u = units.get(id);
      const parent = u?.parent_id ? units.get(String(u.parent_id)) : null;
      r = { branch_id: id || null, name: u?.name ?? "بدون شعبه", code: u?.code ?? null, region: parent?.name ?? null, total: 0, by_state: {} as Record<string, number>, value: financial ? "0" : null, fleet: 0, fleet_down: 0, missing: 0, transfers_out: 0, transfers_in: 0, in_transit: 0, last_audit: null as Row | null, open_discrepancies: 0, attestation: null as Row | null };
      out.set(id, r);
    }
    return r;
  };
  let total = 0;
  for (const [id, t] of totals) {
    const r = row(id);
    r.total = t.n;
    total += t.n;
    if (financial) r.value = D(t.value ?? "0").toFixed(0);
    const by = r.by_state as Record<string, number>;
    for (const [st, m] of Object.entries(states)) by[st] = m.get(id)?.n ?? 0;
    r.missing = by.missing ?? 0;
    r.fleet = fleetAll.get(id)?.n ?? 0;
    r.fleet_down = fleetDown.get(id)?.n ?? 0;
  }
  for (const t of transfers) {
    if (out.has(String(t.from_branch_id)) || units.has(String(t.from_branch_id))) {
      const r = row(String(t.from_branch_id));
      r.transfers_out = Number(r.transfers_out) + 1;
    }
    const r = row(String(t.to_branch_id));
    r.transfers_in = Number(r.transfers_in) + 1;
    if (t.state === "in_transit") r.in_transit = Number(r.in_transit) + 1;
  }
  for (const a of audits) {
    const r = out.get(String(a.branch_id));
    if (!r) continue;
    if (!r.last_audit) r.last_audit = { id: a.id, number: a.number, state: a.state, completed_at: a.completed_at ?? null, missing: a.missing_count ?? 0 };
    r.open_discrepancies = Number(r.open_discrepancies) + Number(a.discrepancy_open ?? 0);
  }
  for (const a of atts) {
    const r = out.get(String(a.branch_id));
    if (!r || r.attestation) continue;
    r.attestation = { id: a.id, number: a.number, state: a.state, period: a.period_label, due_date: a.due_date ?? null, overdue: !!a.overdue, exceptions: a.exception_count ?? 0 };
  }
  const branches = [...out.values()].sort((x, y) => Number(y.total) - Number(x.total));
  return { branches, financial, can_transfer: await holds(ctx, "asset", "create", "own"), total };
}

/** Open transfers addressed to the caller's branches (the receipt inbox) and sent from them. */
export async function transferInbox(ctx: Ctx): Promise<Row> {
  const rows = await liveRows(ctx.db, ctx, "asset_transfer", { f: "state", op: "in", v: OPEN_TRANSFER }, { limit: 500, order: "t.updated_at desc" });
  const units = new Map((await liveRows(ctx.db, sysOf(ctx), "org_unit", null, { limit: 20000 })).map((u) => [String(u.id), u]));
  const view = (t: Row) => ({
    id: t.id, number: t.number, title: t.title, state: t.state, reason: labelIn(TRANSFER_REASONS, t.reason), from: units.get(String(t.from_branch_id))?.name ?? null, to: units.get(String(t.to_branch_id))?.name ?? null,
    items: t.item_count ?? 0, dispatched_at: t.dispatched_at ?? null, can_receive: t.state === "in_transit" && mayActFor(ctx, t.to_branch_id),
  });
  return { incoming: rows.filter((t) => t.state === "in_transit" && mayActFor(ctx, t.to_branch_id)).map(view), all: rows.map(view) };
}

/** The items of a transfer for its receipt screen (the caller reads the transfer). */
export async function transferItems(ctx: Ctx, id: string): Promise<Row> {
  const { row: t } = await get(ctx, "asset_transfer", id);
  const items = await itemsOf(ctx.db, ctx, id);
  return { transfer: { id: t.id, number: t.number, title: t.title, state: t.state, can_receive: t.state === "in_transit" && mayActFor(ctx, t.to_branch_id) }, items: items.map((i) => ({ id: i.id, label: i.label, asset_id: i.asset_id, condition_out: i.condition_out, result: i.result, condition_in: i.condition_in, note: i.note })) };
}

/** An asset's custody chain with its verification (the caller reads the asset). */
export async function custodyOf(ctx: Ctx, assetId: string): Promise<Row> {
  await get(ctx, "asset", assetId);
  const rows = await liveRows(ctx.db, ctx, "asset_custody", { f: "asset_id", op: "eq", v: assetId }, { order: "t.seq", limit: 5000 });
  const check = await verifyCustody(ctx.db, ctx, assetId);
  return { rows, verified: check };
}

// ---------------------------------------------------------------------------------------------------------------
// Installation

let installed = false;

export function installBankHooks(): (() => void)[] {
  if (installed) return [];
  installed = true;
  const off: (() => void)[] = [];
  off.push(registerHooks("asset", { beforeWrite: assetBefore, afterWrite: assetAfter, validatePush: assetPush }));
  off.push(registerHooks("asset_transfer", { beforeWrite: transferBefore, afterWrite: transferAfter, guards: transferGuards, validatePush: pushGuard(transferBefore) }));
  off.push(registerHooks("asset_transfer_item", { beforeWrite: transferItemBefore, afterWrite: transferItemAfter, validatePush: pushGuard(transferItemBefore) }));
  off.push(registerHooks("asset_custody", { beforeWrite: systemOnly("زنجیرهٔ نگهداری"), validatePush: ledgerOnPush("زنجیرهٔ نگهداری") }));
  off.push(registerHooks("device_status_event", { beforeWrite: systemOnly("تاریخچهٔ وضعیت دستگاه"), validatePush: ledgerOnPush("تاریخچهٔ وضعیت دستگاه") }));
  off.push(registerHooks("inventory_audit_item", { beforeWrite: auditItemBranch }));
  off.push(registerHooks("inventory_audit", { afterWrite: auditAfterBank, guards: auditGuards }));
  off.push(registerHooks("branch_attestation", { beforeWrite: attestationBefore, validatePush: pushGuard(attestationBefore) }));
  off.push(registerHooks("disposal_item", { beforeWrite: disposalItemBank }));
  // the receiving branch reads the notes addressed to it (and their items): the destination within the subtree of
  // the reader's own unit — rows only, never the area (a reader needs a read grant in «asset» at all)
  off.push(registerParticipantSource({
    name: "itam.transfer_receiver",
    reach: "scoped",
    sql(def, alias, params, userId) {
      if (def.key !== "asset_transfer" && def.key !== "asset_transfer_item") return null;
      params.push(userId);
      return `exists (select 1 from sm_member_profiles mp join sm_org_units u on u.org_id = mp.org_id and u.deleted_at is null
        where mp.org_id = ${alias}.org_id and mp.user_id = $${params.length}::uuid and mp.deleted_at is null and mp.org_unit_id is not null
          and u.id = ${alias}.to_branch_id and u.path like '%/' || mp.org_unit_id::text || '/%')`;
    },
  }));
  off.push(onApprovalSettled("asset_transfer", async (s) => {
    if (s.record.state !== "pending_approval") return;
    const verdict = settledVerdict(s);
    if (verdict === "approved") await transitionIn(s.tx, s.ctx, "asset_transfer", String(s.record.id), "approved", {});
    if (verdict === "rejected") await transitionIn(s.tx, s.ctx, "asset_transfer", String(s.record.id), "rejected", {});
  }));
  return off;
}
