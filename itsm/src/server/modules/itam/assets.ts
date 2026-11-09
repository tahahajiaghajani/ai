// Services of the asset record (catalogue ITAM-002/008/009/010/011/043/073): check-out and check-in (the hooks keep the
// assignment history, the ledger and the CI), the asset 360 view, «دارایی‌های من» for everyone (the module's
// participant grant lets the person holding an asset read it without a role in the area), reports of a lost, broken
// or wrong asset (an incident filed as the person), acknowledgements decided by the person, the CI made for an asset
// through the CMDB's reconciliation engine, assets made for discovered hardware, and the leaver's return.
import type { Cond } from "@shared/model/conditions";
import type { Asset360, CheckinInput, CheckoutInput, MyAssets, ReportKind, TimelineEvent } from "@shared/itam/api";
import { assetTco, contractShare, depreciation, warrantyStatus, type DepMethod } from "@shared/itam/logic";
import { ASSET_STATES, MOVEMENT_KINDS } from "@shared/tables/itam";
import { diffDays } from "@shared/jalali";
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../context";
import { bad, conflict, forbidden, notFound } from "../../http/errors";
import { access } from "../../access/provider";
import { create, createIn, defFor, get, list, listHistory, transitionIn, updateIn, addJournalIn, fromDb } from "../../engine";
import { createOrUpdate } from "../cmdb/ire";
import { notifyPeople } from "../notify";
import { accessSettings, buildSubject, loadOrgSnapshot } from "../../access";
import { grantIn } from "@shared/access/model";
import { hasGroup, holds, isUuid, itamConfig, liveRow, liveRows, orgToday, stateLabel, sysOf, type Row } from "./common";
import { setHandOver } from "./hooks";

const ASSET = "asset";

/** Hand an asset over to a person, a unit or a place (from stock, repair or transit; or from one holder to another). */
export async function checkout(ctx: Ctx, id: string, input: CheckoutInput): Promise<Row> {
  const { row } = await get(ctx, ASSET, id);
  if (!input.assigned_to && !input.location_id && !input.department_id) throw bad("تحویل‌گیرنده، واحد یا مکان را مشخص کنید");
  const data: Row = {
    assigned_to: input.assigned_to ?? null,
    location_id: input.location_id ?? row.location_id ?? null,
    department_id: input.department_id ?? null,
    usage_type: input.usage_type ?? "permanent",
    expected_return_at: input.usage_type === "loaner" ? input.expected_return_at ?? null : input.expected_return_at ?? null,
    substate: input.usage_type === "loaner" ? "loaner" : "assigned",
  };
  if (input.request_item_id) data.request_item_id = input.request_item_id;
  await ctx.write(async (tx) => {
    setHandOver(tx, id, { condition: input.condition ?? null, note: input.note ?? null, request_item_id: input.request_item_id ?? null });
    if (row.state === "in_use") await updateIn(tx, ctx, ASSET, id, data, {});
    else await transitionIn(tx, ctx, ASSET, id, "in_use", data);
  });
  return (await get(ctx, ASSET, id)).row;
}

/** Take an asset back into a stockroom (its condition goes into the assignment history). */
export async function checkin(ctx: Ctx, id: string, input: CheckinInput): Promise<Row> {
  const { row } = await get(ctx, ASSET, id);
  if (!isUuid(input.stockroom_id)) throw bad("انبار را مشخص کنید");
  if (!["in_use", "in_repair", "missing", "in_transit", "retired"].includes(String(row.state))) throw conflict("این دارایی در انبار است یا بازگشت‌پذیر نیست");
  const substate = input.substate ?? (input.condition === "damaged" || input.condition === "poor" ? "defective" : "available");
  await ctx.write(async (tx) => {
    setHandOver(tx, id, { condition_in: input.condition ?? null, note: input.note ?? null });
    await transitionIn(tx, ctx, ASSET, id, "in_stock", { stockroom_id: input.stockroom_id, substate });
    if (input.note) await addJournalIn(tx, ctx, (await defFor(ctx, ASSET, tx)).def, { ...row, id }, { kind: "work_note", body: `بازگشت به انبار: ${input.note}` }).catch(() => undefined);
  });
  return (await get(ctx, ASSET, id)).row;
}

// ---------------------------------------------------------------------------------------------------------------
// Asset 360 (ITAM-073/074)

export async function asset360(ctx: Ctx, id: string): Promise<Asset360> {
  const { row, display } = await get(ctx, ASSET, id);
  const sys = sysOf(ctx);
  const today = orgToday(ctx);
  const financial = await hasGroup(ctx, "financial");
  const timeline: TimelineEvent[] = [{ at: String(row.created_at), kind: "created", title: "ثبت دارایی", detail: null }];
  const hist = await listHistory(ctx, ASSET, id, { limit: 200 }).catch(() => ({ entries: [] as { field: string; old: unknown; new: unknown; at: string }[] }));
  for (const h of hist.entries) {
    if (h.field === "state") timeline.push({ at: h.at, kind: "state", title: `${stateLabel(ASSET_STATES, h.old) || "—"} ← ${stateLabel(ASSET_STATES, h.new)}`.replace(/^— ← /, ""), detail: null });
  }
  // assignments (the person holding it reads their own rows)
  const asg = await list(ctx, "asset_assignment", { filter: { f: "asset_id", op: "eq", v: id }, sort: "-from_at", size: 100, total: false }).catch(() => ({ rows: [] as Row[], display: {} as Record<string, string> }));
  const assignments = [...asg.rows].sort((a, b) => (String(a.from_at) < String(b.from_at) ? 1 : -1));
  const asgDisplay = asg.display;
  const people = { ...display, ...asgDisplay };
  for (const a of assignments) {
    timeline.push({ at: String(a.from_at), kind: "assignment", title: a.assigned_to ? `تحویل به ${people[String(a.assigned_to)] ?? "کاربر"}` : "تحویل", detail: a.to_at ? null : "در دست" });
    if (a.to_at) timeline.push({ at: String(a.to_at), kind: "assignment", title: "بازگشت", detail: a.condition_in ?? null });
  }
  const moves = (await list(ctx, "stock_movement", { filter: { f: "asset_id", op: "eq", v: id }, sort: "-moved_at", size: 50, total: false }).catch(() => null))?.rows ?? [];
  for (const m of moves) timeline.push({ at: String(m.moved_at), kind: "movement", title: MOVEMENT_KINDS.find((k) => k.value === m.kind)?.label ?? String(m.kind), detail: m.reference ?? null });
  const repairs = (await list(ctx, "repair_order", { filter: { f: "asset_id", op: "eq", v: id }, size: 50, total: false, fields: ["number", "title", "state", "cost", "created_at", "returned_at"] }).catch(() => null))?.rows ?? [];
  for (const r of repairs) timeline.push({ at: String(r.created_at), kind: "repair", title: `تعمیر ${r.number ?? ""}: ${r.title ?? ""}`, detail: null, link: { table: "repair_order", id: String(r.id) } });
  const acks = (await list(ctx, "asset_acknowledgement", { filter: { f: "asset_id", op: "eq", v: id }, size: 20, total: false }).catch(() => null))?.rows ?? [];
  for (const k of acks) if (k.decided_at) timeline.push({ at: String(k.decided_at), kind: "ack", title: k.state === "accepted" ? "تعهدنامه پذیرفته شد" : "تعهدنامه پذیرفته نشد", detail: k.signature_name ?? k.decision_note ?? null });
  if (row.last_audit_at) timeline.push({ at: String(row.last_audit_at), kind: "audit", title: "شمارش فیزیکی", detail: row.last_audit_result ?? null });
  timeline.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // contracts: coverage rows and the asset's own contract fields
  const contractIds = new Set<string>([row.warranty_contract_id, row.support_contract_id, row.lease_contract_id].filter(isUuid));
  const coverage = (await list(ctx, "contract_coverage", { filter: { f: "asset_id", op: "eq", v: id }, size: 50, total: false }).catch(() => null))?.rows ?? [];
  for (const c of coverage) if (isUuid(c.contract_id)) contractIds.add(c.contract_id);
  const contracts = contractIds.size ? ((await list(ctx, "contract", { ids: [...contractIds], size: 50, total: false }).catch(() => null)) ?? { rows: [], display: {} }) : { rows: [], display: {} as Record<string, string> };
  const cdef = tableDef("contract");
  const contractRows = contracts.rows.map((c) => ({
    id: String(c.id), number: (c.number as string) ?? null, name: String(c.name ?? ""), type: (c.contract_type as string) ?? null, state: (c.state as string) ?? null,
    end_date: (c.end_date as string) ?? null, coverage: (coverage.find((x) => x.contract_id === c.id)?.coverage_level as string) ?? (c.id === row.warranty_contract_id ? "warranty" : null),
    supplier: c.supplier_id ? contracts.display[String(c.supplier_id)] ?? null : null,
  }));
  void cdef;

  // costs (financial field group only)
  let costs: Asset360["costs"] = null;
  if (financial) {
    const model = isUuid(row.model_id) ? await liveRow(ctx.db, sys, "asset_model", row.model_id) : null;
    const rule = isUuid(row.depreciation_rule_id) ? await liveRow(ctx.db, sys, "depreciation_rule", row.depreciation_rule_id) : null;
    const start = String(row.in_service_date || row.purchase_date || "") || null;
    const dep = rule && start && row.purchase_cost
      ? depreciation({ cost: row.purchase_cost, salvage: row.salvage_value ?? (rule.salvage_percent ? (Number(row.purchase_cost) * Number(rule.salvage_percent)) / 100 : 0), lifeMonths: Number(rule.life_months ?? model?.useful_life_months ?? 36), method: rule.method as DepMethod, ratePercent: rule.rate_percent, start: rule.start_basis === "purchase" ? String(row.purchase_date || start) : start, asOf: today })
      : null;
    const entries = (await list(ctx, "cost_entry", { filter: { f: "asset_id", op: "eq", v: id }, sort: "-entry_date", size: 100, total: false }).catch(() => null))?.rows ?? [];
    const other = entries.filter((e) => !["asset_purchase", "depreciation", "repair"].includes(String(e.source))).map((e) => String(e.amount ?? 0));
    let share = "0";
    for (const c of contracts.rows) {
      if (!c.annual_value) continue;
      const covered = (await liveRows(ctx.db, sys, "contract_coverage", { and: [{ f: "contract_id", op: "eq", v: c.id }, { f: "asset_id", op: "nempty" }] } as Cond, { limit: 10000 })).length || 1;
      share = String(Number(share) + Number(contractShare(String(c.annual_value), covered)));
    }
    const months = start ? Math.max(0, Math.round(diffDays(today, start) / 30.44)) : 0;
    const tco = assetTco({ purchase: row.purchase_cost ?? 0, repairs: repairs.map((r) => String(r.cost ?? 0)), contracts: share, other, months, replacement: model?.unit_cost ?? null, usefulLifeMonths: model?.useful_life_months ?? null });
    costs = {
      ...tco,
      book_value: dep ? dep.bookValue : (row.book_value as string) ?? null,
      accumulated: dep ? dep.accumulated : (row.accumulated_depreciation as string) ?? null,
      entries: entries.slice(0, 30).map((e) => ({ id: String(e.id), number: (e.number as string) ?? null, date: String(e.entry_date), description: String(e.description ?? ""), amount: String(e.amount ?? "0"), source: String(e.source ?? "") })),
    };
  }

  // the linked CI (only when the caller reads it)
  let ci: Asset360["ci"] = null;
  if (isUuid(row.ci_id)) {
    const r = await get(ctx, "ci", row.ci_id).catch(() => null);
    if (r) ci = { id: String(r.row.id), number: (r.row.number as string) ?? null, name: String(r.row.name ?? ""), class: (r.row.class as string) ?? null, state: (r.row.state as string) ?? null, operational_status: (r.row.operational_status as string) ?? null, health_score: (r.row.health_score as number) ?? null };
  }
  const software = ci
    ? ((await list(ctx, "software_install", { filter: { and: [{ f: "ci_id", op: "eq", v: ci.id }, { f: "active", op: "eq", v: true }] }, size: 100, total: false }).catch(() => null)) ?? { rows: [], display: {} as Record<string, string> })
    : { rows: [], display: {} as Record<string, string> };
  const left = row.warranty_end ? diffDays(String(row.warranty_end), today) : null;
  return {
    asset: { id, number: (row.number as string) ?? null, name: String(row.name ?? ""), state: String(row.state), state_label: stateLabel(ASSET_STATES, row.state), substate: (row.substate as string) ?? null },
    timeline: timeline.slice(0, 200),
    assignments: assignments.map((a) => ({ id: String(a.id), assigned_to: (a.assigned_to as string) ?? null, name: a.assigned_to ? people[String(a.assigned_to)] ?? null : null, location: a.location_id ? asgDisplay[String(a.location_id)] ?? null : null, from_at: String(a.from_at), to_at: (a.to_at as string) ?? null, usage_type: (a.usage_type as string) ?? null, condition_in: (a.condition_in as string) ?? null })),
    contracts: contractRows,
    warranty: { status: warrantyStatus(row.warranty_end as string | null, today), end: (row.warranty_end as string) ?? null, days_left: left },
    costs,
    ci,
    software: software.rows.map((s) => ({ name: String(s.raw_name ?? ""), version: (s.raw_version as string) ?? null, model: s.software_model_id ? software.display[String(s.software_model_id)] ?? null : null })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// «دارایی‌های من» (ITAM-009) and acknowledgements (ITAM-010)

/** Ids of rows of `table` whose `field` is the caller, newest first — a list through the access rule, which gives a
 * holder without a role in the area the rows their participant grant opens. */
const mine = async (ctx: Ctx, table: string, field: string, extra: Cond | null, limit = 200): Promise<string[]> =>
  (await list(ctx, table, { filter: extra ? { and: [{ f: field, op: "is_me" }, extra] } : { f: field, op: "is_me" }, sort: "-updated_at", size: limit, total: false })).rows.map((r) => String(r.id));

export async function myAssets(ctx: Ctx): Promise<MyAssets> {
  const ids = await mine(ctx, ASSET, "assigned_to", { f: "state", op: "nin", v: ["disposed", "canceled"] });
  const assets: MyAssets["assets"] = [];
  for (const id of ids) {
    const r = await get(ctx, ASSET, id).catch(() => null);
    if (!r) continue;
    const a = r.row;
    assets.push({
      id, number: (a.number as string) ?? null, name: String(a.name ?? ""), asset_tag: (a.asset_tag as string) ?? null, serial_number: (a.serial_number as string) ?? null,
      model: a.model_id ? r.display[String(a.model_id)] ?? null : null, category: (a.category as string) ?? null, state: String(a.state), state_label: stateLabel(ASSET_STATES, a.state),
      substate: (a.substate as string) ?? null, usage_type: (a.usage_type as string) ?? null, expected_return_at: (a.expected_return_at as string) ?? null,
      assigned_at: (a.assigned_at as string) ?? null, warranty_end: (a.warranty_end as string) ?? null, ack_state: (a.ack_state as string) ?? null,
    });
  }
  const ackIds = await mine(ctx, "asset_acknowledgement", "user_id", { f: "state", op: "eq", v: "pending" }, 50);
  const acks: MyAssets["acks"] = [];
  for (const id of ackIds) {
    const r = await get(ctx, "asset_acknowledgement", id).catch(() => null);
    if (!r) continue;
    acks.push({ id, number: (r.row.number as string) ?? null, asset_id: String(r.row.asset_id), asset_label: r.display[String(r.row.asset_id)] ?? String(r.row.label ?? ""), terms: (r.row.terms as string) ?? null, requested_at: (r.row.requested_at as string) ?? null });
  }
  // the line manager's view: their reportees' assets, when their roles read the area (requester-side visibility)
  const team: MyAssets["team"] = [];
  if (await holds(ctx, "asset", "read")) {
    const profiles = await list(ctx, "member_profile", { filter: { f: "manager_id", op: "is_me" }, fields: ["user_id", "name"], size: 200, total: false }).catch(() => null);
    const reportees = (profiles?.rows ?? []).filter((p) => isUuid(p.user_id)).map((p) => ({ user_id: String(p.user_id), name: (p.name as string) ?? null }));
    if (reportees.length) {
      const r = await list(ctx, ASSET, { filter: { and: [{ f: "assigned_to", op: "in", v: reportees.map((p) => p.user_id) }, { f: "state", op: "eq", v: "in_use" }] }, size: 500, fields: ["assigned_to"], total: false }).catch(() => null);
      for (const p of reportees) {
        const count = (r?.rows ?? []).filter((x) => x.assigned_to === p.user_id).length;
        if (count) team.push({ user_id: p.user_id, name: p.name ?? r?.display[p.user_id] ?? "", count });
      }
    }
  }
  return { assets, acks, team };
}

/** The person holding an asset accepts or declines its acknowledgement (signed with their full name). */
export async function decideAck(ctx: Ctx, id: string, input: { decision: "accept" | "decline"; signature_name?: string | null; note?: string | null }): Promise<Row> {
  const { row } = await get(ctx, "asset_acknowledgement", id);
  if (row.user_id !== ctx.user.id) throw forbidden("فقط تحویل‌گیرنده این تعهدنامه را می‌پذیرد یا رد می‌کند");
  if (row.state !== "pending") throw conflict("این تعهدنامه پیش‌تر پاسخ داده شده است");
  const accept = input.decision === "accept";
  const signature = String(input.signature_name ?? "").trim();
  if (accept && signature.length < 3) throw bad("برای پذیرش، نام کامل خود را به‌عنوان امضا بنویسید");
  if (!accept && !String(input.note ?? "").trim()) throw bad("علت نپذیرفتن را بنویسید");
  const by = sysOf(ctx, ctx.user.id);
  await ctx.write((tx) => transitionIn(tx, by, "asset_acknowledgement", id, accept ? "accepted" : "declined", accept ? { signature_name: signature.slice(0, 160), decision_note: input.note ?? null } : { decision_note: String(input.note).slice(0, 2000) }));
  return (await get(ctx, "asset_acknowledgement", id)).row;
}

const REPORT_TITLES: Record<ReportKind, string> = { lost: "گزارش گم شدن یا سرقت دارایی", broken: "گزارش خرابی دارایی", not_mine: "این دارایی متعلق به من نیست" };

/** The person reports their asset lost, broken or not theirs: an incident filed as them (the desk takes it from there). */
export async function reportAsset(ctx: Ctx, id: string, kind: ReportKind, note: string | null): Promise<{ table: string; id: string; number: string | null }> {
  const { row } = await get(ctx, ASSET, id);
  if (row.assigned_to !== ctx.user.id && !(await holds(ctx, "asset", "write"))) throw forbidden("فقط تحویل‌گیرنده یا کارشناس دارایی گزارش می‌دهد");
  const table = tableDef("incident") ? "incident" : "todo";
  const title = `${REPORT_TITLES[kind]}: ${row.name ?? ""} (${row.asset_tag ?? row.number ?? ""})`.slice(0, 200);
  const description = [`دارایی: ${row.number ?? ""} — ${row.name ?? ""}`, row.serial_number ? `سریال: ${row.serial_number}` : null, note ? `\n${note}` : null].filter(Boolean).join("\n");
  const data: Row = table === "incident" ? { short_description: title, description, urgency: kind === "lost" ? "2" : "3", ...(isUuid(row.ci_id) ? { ci_id: row.ci_id } : {}) } : { short_description: title, description };
  const r = await create(ctx, table, data);
  // the asset record notes it (as the system: the person may not write the asset)
  const sys = sysOf(ctx, ctx.user.id);
  await ctx.write(async (tx) => {
    const fresh = await liveRow(tx, sys, ASSET, id);
    if (!fresh) return;
    await addJournalIn(tx, sys, tableDef(ASSET)!, fresh, { kind: "work_note", body: `${REPORT_TITLES[kind]} با ${r.row.number ?? ""}${note ? `: ${note}` : ""}` }, { trusted: true });
    if (kind === "lost" && ["in_use", "in_stock"].includes(String(fresh.state))) await updateIn(tx, sys, ASSET, id, { substate: fresh.state === "in_use" ? "to_be_returned" : fresh.substate }, { trusted: true });
  });
  return { table, id: String(r.row.id), number: (r.row.number as string) ?? null };
}

// ---------------------------------------------------------------------------------------------------------------
// The CI of an asset (ITAM-002) and assets for discovered hardware

/** Create (or identify) the CI of an asset through the CMDB's reconciliation engine and link it 1:1. */
export async function linkCi(sys: Ctx, assetId: string): Promise<{ ci_id: string | null; message: string | null }> {
  const asset = await liveRow(sys.db, sys, ASSET, assetId);
  if (!asset || isUuid(asset.ci_id)) return { ci_id: asset?.ci_id ?? null, message: null };
  const cfg = await itamConfig(sys.db, sys);
  const model = isUuid(asset.model_id) ? await liveRow(sys.db, sys, "asset_model", asset.model_id) : null;
  if (!model?.ci_class || !cfg.auto_ci) return { ci_id: null, message: "کلاس پیکربندی ندارد" };
  const maker = isUuid(model.manufacturer_id) ? await liveRow(sys.db, sys, "supplier", model.manufacturer_id) : null;
  const values: Row = {
    name: asset.name, serial_number: asset.serial_number ?? undefined, asset_tag: asset.asset_tag ?? undefined, manufacturer: maker?.name ?? undefined,
    model_name: model.name ?? undefined, location_id: asset.location_id ?? undefined, used_by: asset.state === "in_use" ? asset.assigned_to ?? undefined : undefined,
  };
  const r = await createOrUpdate(sys, { items: [{ class: String(model.ci_class), values }] });
  const ciId = r.results[0]?.ci_id ?? null;
  if (!ciId) return { ci_id: null, message: r.results[0]?.message ?? "پیکربندی ساخته نشد" };
  const other = await liveRows(sys.db, sys, ASSET, { and: [{ f: "ci_id", op: "eq", v: ciId }, { f: "id", op: "ne", v: assetId }] } as Cond, { limit: 1 });
  if (other.length) return { ci_id: null, message: `پیکربندی ${r.results[0]?.number ?? ""} پیش‌تر به دارایی ${other[0].number ?? ""} پیوسته است` };
  await sys.write((tx) => updateIn(tx, sys, ASSET, assetId, { ci_id: ciId }, { trusted: true, keepVersion: true }));
  return { ci_id: ciId, message: null };
}

const HW_CLASSES = ["laptop", "desktop", "server", "computer", "mobile_device", "printer", "network_device", "router", "switch", "firewall", "access_point", "storage", "ups"];
const CATEGORY_OF: Record<string, string> = { laptop: "laptop", desktop: "desktop", computer: "desktop", server: "server", mobile_device: "phone", printer: "printer", storage: "storage" };

/**
 * Assets for discovered hardware CIs that have none (ITAM-002 «in use, unverified»): the model by maker and model
 * name (a model «در بررسی» is created when unknown), the CI's user as the assignee.
 */
/** Hardware CIs of the CMDB that have no asset yet (live, not retired), oldest first. */
async function unlinkedHardware(sys: Ctx): Promise<Row[]> {
  const cis = await liveRows(sys.db, sys, "ci", { and: [{ f: "class", op: "in", v: HW_CLASSES }, { f: "state", op: "nin", v: ["retired", "disposed", "canceled"] }] } as Cond, { limit: 5000, order: "t.created_at, t.no" });
  const linked = new Set((await liveRows(sys.db, sys, ASSET, { f: "ci_id", op: "nempty" } as Cond, { limit: 100000 })).map((a) => String(a.ci_id)));
  return cis.filter((ci) => !linked.has(String(ci.id)));
}

/** Active members whose roles manage assets (write ≥ group in area `asset`) — who reviews discovered hardware. */
async function assetManagersOf(sys: Ctx): Promise<string[]> {
  const snap = await loadOrgSnapshot(sys.db, sys.org.id);
  const org = await sys.db.one<{ settings: Record<string, unknown> | null }>(`select settings from sm_orgs where id = $1`, [sys.org.id]);
  const settings = accessSettings({ settings: (org?.settings ?? {}) as never });
  const members = await sys.db.query<{ user_id: string; role: string; overrides: Record<string, unknown> | null }>(
    `select user_id, role, overrides from sm_org_members where org_id = $1 and deleted_at is null and is_active`,
    [sys.org.id],
  );
  const order = ["none", "own", "group", "unit", "unit_tree", "domain", "all"];
  return members
    .filter((m) => {
      const s = buildSubject(snap, settings, sys.org.id, m.user_id, m.role as never, m.overrides).subject;
      return s.kind === "user" && order.indexOf(grantIn(s.eff, "asset").write) >= order.indexOf("group");
    })
    .map((m) => m.user_id);
}

/**
 * The daily discovered-hardware step (ITAM-002, `itam_config.auto_assets`). Until an asset manager has made the first
 * batch (POST /itam/discovered — «دارایی برای سخت‌افزار کشف‌شده» on the dashboard, which stamps
 * `auto_assets_confirmed_at`), nothing is created: the step counts the hardware CIs without an asset and tells the
 * asset managers once per new count, so a large CMDB is never flooded with assets nobody reviewed. Afterwards it
 * creates up to `limit` a day and tells them what it made and what is left.
 */
export async function discoveredStep(sys: Ctx, limit = 200): Promise<{ proposed: number; created: number }> {
  const cfg = await liveRows(sys.db, sys, "itam_config", null, { order: "t.created_at", limit: 1 }).then((r) => r[0] ?? null);
  if (!cfg || cfg.auto_assets === false) return { proposed: 0, created: 0 };
  const open = await unlinkedHardware(sys);
  if (!cfg.auto_assets_confirmed_at) {
    if (Number(cfg.auto_assets_pending ?? 0) === open.length) return { proposed: 0, created: 0 };
    const managers = open.length ? await assetManagersOf(sys) : [];
    await sys.write(async (tx) => {
      await updateIn(tx, sys, "itam_config", String(cfg.id), { auto_assets_pending: open.length }, { trusted: true, keepVersion: true });
      if (open.length && managers.length) {
        await notifyPeople(tx, sys.org.id, {
          table: "ci", id: String(open[0].id), users: managers, event: "custom", label: "سخت‌افزار کشف‌شدهٔ بی‌دارایی",
          subject: `${open.length.toLocaleString("fa-IR")} دستگاه کشف‌شده هنوز دارایی ندارد`,
          body: `پایگاه پیکربندی ${open.length.toLocaleString("fa-IR")} رایانه، سرور، گوشی یا تجهیز شبکه دارد که دارایی ندارند. پس از بررسی، در «داشبورد دارایی‌ها» دکمهٔ «دارایی برای سخت‌افزار کشف‌شده» را بزنید؛ از آن پس دستگاه‌های تازه هر روز خودکار دارایی می‌گیرند. تا آن زمان دارایی‌ای ساخته نمی‌شود.`,
          channels: ["in_app"], source: "مدیریت دارایی",
        });
      }
    });
    return { proposed: open.length, created: 0 };
  }
  if (!open.length) return { proposed: 0, created: 0 };
  const r = await assetsForDiscovered(sys, limit, open);
  const left = Math.max(0, open.length - r.created);
  if (r.created) {
    const managers = await assetManagersOf(sys);
    if (managers.length) {
      await sys.write((tx) => notifyPeople(tx, sys.org.id, {
        table: "ci", id: String(open[0].id), users: managers, event: "custom", label: "دارایی برای سخت‌افزار کشف‌شده",
        subject: `${r.created.toLocaleString("fa-IR")} دارایی برای دستگاه‌های کشف‌شده ساخته شد`,
        body: `${r.created.toLocaleString("fa-IR")} دارایی با زیروضعیت «تأییدنشده» ساخته شد${left ? `؛ ${left.toLocaleString("fa-IR")} دستگاه دیگر در روزهای بعد` : ""}. آن‌ها را در فهرست دارایی‌ها بازبینی کنید.`,
        channels: ["in_app"], source: "مدیریت دارایی",
      }));
    }
  }
  return { proposed: 0, created: r.created };
}

/** An asset manager makes assets for the discovered hardware now — and so confirms the daily step. */
export async function confirmDiscovered(ctx: Ctx, limit = 500): Promise<{ created: number; models: number; remaining: number }> {
  if (!(await holds(ctx, "asset", "write", "group"))) throw forbidden("این کار با مدیر دارایی است");
  const sys = sysOf(ctx, ctx.user.id);
  const open = await unlinkedHardware(sys);
  const r = await assetsForDiscovered(sys, limit, open);
  const [cfg] = await liveRows(sys.db, sys, "itam_config", null, { order: "t.created_at", limit: 1 });
  if (cfg) await sys.write((tx) => updateIn(tx, sys, "itam_config", String(cfg.id), { auto_assets_confirmed_at: cfg.auto_assets_confirmed_at ?? new Date().toISOString(), auto_assets_pending: Math.max(0, open.length - r.created) }, { trusted: true, keepVersion: true }));
  return { ...r, remaining: Math.max(0, open.length - r.created) };
}

export async function assetsForDiscovered(sys: Ctx, limit = 200, open?: Row[]): Promise<{ created: number; models: number }> {
  const cis = open ?? (await unlinkedHardware(sys));
  let created = 0;
  let models = 0;
  for (const ci of cis) {
    if (created >= limit) break;
    await sys.write(async (tx) => {
      const name = String(ci.model_name || `${ci.class} نامشخص`).slice(0, 200);
      let [model] = await liveRows(tx, sys, "asset_model", { f: "name", op: "eq", v: name } as Cond, { limit: 1 });
      if (!model) {
        model = await createIn(tx, sys, "asset_model", { name, category: CATEGORY_OF[String(ci.class)] ?? (String(ci.class).includes("network") ? "network" : "other"), ci_class: ci.class, status: "under_review", data_bearing: ["laptop", "desktop", "server", "computer", "mobile_device", "storage"].includes(String(ci.class)) }, { trusted: true });
        models++;
      }
      await createIn(tx, sys, ASSET, {
        model_id: model.id, ci_id: ci.id, name: ci.name, serial_number: ci.serial_number ?? null, asset_tag: ci.asset_tag ?? null, location_id: ci.location_id ?? null,
        state: "in_use", substate: "unverified", assigned_to: ci.used_by ?? null, notes: `ساخته‌شده از پیکربندی کشف‌شدهٔ ${ci.number ?? ""}`,
      }, { trusted: true });
      created++;
    });
  }
  return { created, models };
}

/** CI changes that ITAM takes over (ITAM-002: serial from discovery; a retired CI's asset is flagged). */
export async function fromCi(sys: Ctx, ciId: string, changed: string[]): Promise<void> {
  const [asset] = await liveRows(sys.db, sys, ASSET, { f: "ci_id", op: "eq", v: ciId } as Cond, { limit: 1 });
  if (!asset) return;
  const ci = await liveRow(sys.db, sys, "ci", ciId);
  if (!ci) return;
  await sys.write(async (tx) => {
    if (changed.includes("serial_number") && ci.serial_number && ci.serial_number !== asset.serial_number) {
      if (!asset.serial_number) await updateIn(tx, sys, ASSET, asset.id, { serial_number: ci.serial_number }, { trusted: true });
      else await addJournalIn(tx, sys, tableDef(ASSET)!, asset, { kind: "system", body: `سریال پیکربندی ${ci.number ?? ""} (${ci.serial_number}) با سریال دارایی (${asset.serial_number}) یکی نیست؛ بررسی کنید` }, { trusted: true });
    }
    if (changed.includes("state") && ci.state === "retired" && ["in_use", "in_stock", "in_repair", "missing"].includes(String(asset.state))) {
      await addJournalIn(tx, sys, tableDef(ASSET)!, asset, { kind: "system", body: `پیکربندی ${ci.number ?? ""} بازنشسته شد؛ وضعیت دارایی را بررسی کنید` }, { trusted: true });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Leavers (ITAM-011)

/** A leaver's return: their assets to be returned by a date, their licence allocations released, people told. */
export async function leaverReturn(ctx: Ctx, userId: string, dueDate: string | null): Promise<{ assets: number; allocations: number; accounts: number }> {
  if (!(await holds(ctx, "asset", "write", "all"))) throw forbidden("بازپس‌گیری دارایی‌های کارمند خروجی با مدیر دارایی است");
  const sys = sysOf(ctx, ctx.user.id);
  const assets = await liveRows(ctx.db, sys, ASSET, { and: [{ f: "assigned_to", op: "eq", v: userId }, { f: "state", op: "eq", v: "in_use" }] } as Cond, { limit: 500 });
  const allocations = await liveRows(ctx.db, sys, "license_allocation", { and: [{ f: "user_id", op: "eq", v: userId }, { f: "active", op: "eq", v: true }] } as Cond, { limit: 500 });
  const accounts = await liveRows(ctx.db, sys, "saas_account", { and: [{ f: "user_id", op: "eq", v: userId }, { f: "active", op: "eq", v: true }] } as Cond, { limit: 500 });
  const at = new Date().toISOString();
  await ctx.write(async (tx) => {
    for (const a of assets) {
      await updateIn(tx, sys, ASSET, a.id, { substate: "to_be_returned", expected_return_at: dueDate ?? a.expected_return_at ?? null }, { trusted: true });
      await addJournalIn(tx, sys, tableDef(ASSET)!, a, { kind: "work_note", body: `بازپس‌گیری کارمند خروجی${dueDate ? ` تا ${dueDate}` : ""}` }, { trusted: true });
      const managers = [a.managed_by].filter(isUuid);
      if (managers.length) await notifyPeople(tx, ctx.org.id, { table: ASSET, id: a.id, users: managers, subject: `بازپس‌گیری ${a.name ?? ""}`, body: `دارایی ${a.number ?? ""} باید از کارمند خروجی تحویل گرفته شود.`, source: "دارایی‌ها" });
    }
    for (const l of allocations) await updateIn(tx, sys, "license_allocation", l.id, { released_at: at, active: false }, { trusted: true });
    for (const s of accounts) await updateIn(tx, sys, "saas_account", s.id, { active: false }, { trusted: true });
    if (assets.length) await notifyPeople(tx, ctx.org.id, { table: ASSET, id: assets[0].id, users: [userId], subject: "بازگرداندن دارایی‌ها", body: `${assets.length} دارایی شما باید${dueDate ? ` تا ${dueDate}` : ""} بازگردانده شود.`, source: "دارایی‌ها" });
  });
  return { assets: assets.length, allocations: allocations.length, accounts: accounts.length };
}

export { notFound, access, fromDb };
