// Writes side by side in the asset, service and operations modules (audit D4, slice A3), on a real PostgreSQL: IT
// asset management (bank branches, stock, procurement, audits, disposal), finance, customer service and workforce
// decide many writes from rows other than the one they hold locked (a stock's quantity, an entitlement's units, a
// ledger's keys, an order's wipe evidence, an audit's state, a note's assets, an absence before the profile…). Each test
// forces the interleaving that broke before the fix — a transaction held open while a racer reads — and checks the
// state a serial order gives. Skipped unless ITSM_PG_URL or ITSM_PG_BIN (tests/pg-real.ts). Locally as root:
//   ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody npx vitest run tests/races-ops-pg.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { uuidv7 } from "@shared/id";
import { periodKeyOf } from "@shared/financial/logic";
import { todayISO } from "@shared/jalali";
import type { Row, Tx } from "@server/db";
import { createIn, registerHooks, transitionIn, updateIn, type RecordEvent } from "@server/engine";
import { consumePartIn, itamSweep, onRequestItem } from "@server/modules/itam/jobs";
import { bookValueOf } from "@server/modules/itam/hooks";
import { checkStockRules, scan } from "@server/modules/itam/stock";
import { openAttestations, resolveAuditItem } from "@server/modules/itam/bank";
import { checkout } from "@server/modules/itam/assets";
import { capture } from "@server/modules/financial";
import { absenceTick } from "@server/modules/workforce/jobs";
import { setPresenceIn } from "@server/modules/workforce/presence";
import { generateMaintenanceIn } from "@server/modules/field_service/service";
import { createOrUpdate } from "@server/modules/cmdb/ire";
import { computeHealth } from "@server/modules/cmdb/health";
import { seedRequestDefaults } from "@server/modules/request";
import { seedItamDefaults } from "@server/modules/itam";
import { realPgAvailable } from "./pg-real";
import { call, hold, meeting, message, queued, raceDatabases, whileHeld } from "./race-helpers";
import { itamWorld, type ItamWorld } from "./itam-helpers";

const pid = process.pid;
const today = () => todayISO("Asia/Tehran");
const sum = (rows: { quantity: number | string }[]) => rows.reduce((n, r) => n + Number(r.quantity), 0);

describe.skipIf(!realPgAvailable())("assets, services and operations: writes side by side (real PostgreSQL)", () => {
  raceDatabases("ops");

  let w: ItamWorld;
  let central: string;
  let laptop: string;
  /** a row written as the system (trusted), committed */
  const made = (table: string, data: Record<string, unknown>) => w.sys.write((tx) => createIn(tx, w.sys, table, data, { trusted: true }));
  const rowOf = async (table: string, id: string) => (await w.e.db.one<Row>(`select * from ${table} where id = $1`, [id]))!;

  beforeAll(async () => {
    w = await itamWorld();
    central = await w.idOf("stockroom", "code", "WH-01");
    laptop = await w.idOf("asset_model", "name", "لنوو ThinkPad E14 Gen 5");
  }, 240_000);

  // ------------------------------------------------------------------------------------------------------- stock

  describe("stock and fulfilment", () => {
    /** a quantity-tracked model of its own (no other stock of it) */
    const consumable = async (tag: string) => made("asset_model", { name: `کابل شبکهٔ آزمون ${tag} ${pid}`, model_number: `CAB-${tag}-${pid}`, category: "consumable", asset_class: "consumable", tracking: "quantity" });
    const consumed = (model: Row, quantity: number) =>
      ({ kind: "record.part_consumed", table: "parts_requirement", id: uuidv7(), org_id: w.e.org, data: { part_name: model.name, part_code: model.model_number, quantity } }) as unknown as RecordEvent;

    it("A3-1: two parts taken at once from one quantity-tracked stock both leave it (quantity and ledger)", async () => {
      const model = await consumable("A");
      const stock = await made("asset", { model_id: model.id, state: "in_stock", substate: "available", stockroom_id: central, quantity: 10 });
      // the first consumption took one and has not committed when a second work order takes two
      const first = hold(w.e.db, (tx) => consumePartIn(tx, w.sys, consumed(model, 1)));
      const second = await whileHeld(first, () => w.sys.write((tx) => consumePartIn(tx, w.sys, consumed(model, 2))));
      expect(second.status, message(second)).toBe("fulfilled");
      expect(Number((await rowOf("sm_assets", stock.id)).quantity)).toBe(7);
      const moves = await w.e.db.query<{ kind: string; quantity: number }>(`select kind, quantity from sm_stock_movements where asset_id = $1 and deleted_at is null`, [stock.id]);
      expect(sum(moves.filter((m) => m.kind === "adjustment"))).toBe(-3);
      expect(sum(moves)).toBe(7);
    });

    it("A3-1: the last piece taken twice at once goes to one work order; the other is told it is not there", async () => {
      const model = await consumable("B");
      const stock = await made("asset", { model_id: model.id, state: "in_stock", substate: "available", stockroom_id: central, quantity: 1 });
      let firstOut: { asset_id: string | null; problem: string | null } | null = null;
      const first = hold(w.e.db, async (tx) => {
        firstOut = await consumePartIn(tx, w.sys, consumed(model, 1));
      });
      const second = await whileHeld(first, () => w.sys.write((tx) => consumePartIn(tx, w.sys, consumed(model, 1))));
      expect(second.status, message(second)).toBe("fulfilled");
      expect(firstOut!.asset_id).toBe(stock.id);
      const out = (second as PromiseFulfilledResult<{ asset_id: string | null; problem: string | null }>).value;
      expect(out.asset_id).toBeNull();
      expect(out.problem).toContain("پیدا نشد");
      expect(Number((await rowOf("sm_assets", stock.id)).quantity)).toBe(0);
    });

    it("A3-7: two requested items entering fulfilment at once never reserve the same asset", async () => {
      await seedRequestDefaults(w.e.cfg, w.e.org);
      await seedItamDefaults(w.e.cfg, w.e.org, { force: true });
      const item = await w.idOf("catalog_item", "code", "new_laptop");
      // the catalogue item is bound to a model of this test alone, with one asset of it free in stock
      const model = await made("asset_model", { name: `لپ‌تاپ رزرو آزمون ${pid}`, category: "laptop" });
      await w.e.db.query(`update sm_catalog_item_models set model_id = $2, consume_stock = true, raise_purchase = true where catalog_item_id = $1`, [item, model.id]);
      const free = await made("asset", { model_id: model.id, state: "in_stock", substate: "available", stockroom_id: central, serial_number: `RSV-${pid}` });
      const answers = { model: "standard", os: "windows", reason: "کار روزانه" };
      const r1 = await made("request_item", { cat_item_id: item, requested_for: w.p.req.userId, quantity: 1, answers, short_description: "لپ‌تاپ نخست" });
      const r2 = await made("request_item", { cat_item_id: item, requested_for: w.p.req2.userId, quantity: 1, answers, short_description: "لپ‌تاپ دوم" });
      const started = (id: string) => ({ kind: "record.state_changed", table: "request_item", id, org_id: w.e.org, to: "in_fulfilment" }) as unknown as RecordEvent;
      // the asset is held by a write of its own while both items' fulfilment starts
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_assets where id = $1 for update`, [free.id]));
      const both = await whileHeld(holder, () => Promise.all([r1, r2].map((r) => onRequestItem(started(r.id), w.sys))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const holderOf = String((await rowOf("sm_assets", free.id)).request_item_id);
      expect([r1.id, r2.id]).toContain(holderOf);
      const other = holderOf === r1.id ? r2.id : r1.id;
      // the other item got what an empty stock gives: a purchase requisition (none for the one that holds the asset)
      const prqs = async (id: string) => (await w.e.db.query(`select id from sm_purchase_requisitions where request_item_id = $1 and deleted_at is null`, [id])).length;
      expect(await prqs(other)).toBe(1);
      expect(await prqs(holderOf)).toBe(0);
    });
  });

  // ----------------------------------------------------------------------------------------------- bank branches

  describe("bank branches: disposal, audits, transfers", () => {
    it("A3-5: an order is not completed on wipe evidence that is being corrected", async () => {
      const a = await made("asset", { model_id: laptop, state: "in_stock", stockroom_id: central, serial_number: `DSP-${pid}` });
      const order = await made("disposal_order", { title: "اسقاط هم‌زمان", method: "recycle", state: "approved" });
      const item = await made("disposal_item", {
        order_id: order.id, asset_id: a.id, sanitization_method: "purge", sanitized_at: new Date().toISOString(), sanitized_by: w.p.agent.userId,
        witness_id: w.p.am.userId, certificate_no: `C1-${pid}`, verified: true,
      });
      expect((await rowOf("sm_disposal_items", item.id)).verified).toBe(true);
      // the wipe officer's correction (a new certificate: reviewed again) is in flight when the order is completed
      const correcting = hold(w.e.db, (tx) => updateIn(tx, w.sys, "disposal_item", item.id, { certificate_no: `C2-${pid}` }, { trusted: true }));
      const completing = await whileHeld(correcting, () => w.sys.write((tx) => transitionIn(tx, w.sys, "disposal_order", order.id, "completed", {})));
      expect(completing.status).toBe("rejected");
      expect(message(completing)).toContain("گواهی پاک‌سازی داده");
      expect((await rowOf("sm_disposal_orders", order.id)).state).toBe("approved");
      expect((await rowOf("sm_disposal_items", item.id)).verified).toBe(false);
      expect((await rowOf("sm_assets", a.id)).state).not.toBe("disposed");
    });

    it("A3-6: an asset scanned while the count is being completed is counted, not marked missing", async () => {
      const room = await made("stockroom", { name: `انبار شمارش ${pid}`, code: `AUD-${pid}` });
      const tag = `TAG-AUD-${pid}`;
      const a = await made("asset", { model_id: laptop, state: "in_stock", stockroom_id: room.id, asset_tag: tag });
      const audit = await made("inventory_audit", { name: "شمارش هم‌زمان", scope_kind: "stockroom", stockroom_id: room.id, mark_missing: true });
      await w.sys.write((tx) => transitionIn(tx, w.sys, "inventory_audit", audit.id, "in_progress", {}));
      const [item] = await w.e.db.query<{ id: string }>(`select id from sm_inventory_audit_items where audit_id = $1 and asset_id = $2 and deleted_at is null`, [audit.id, a.id]);
      expect(item).toBeTruthy();
      const counter = await w.e.ctxOf(w.p.am.userId);
      // the item is held by a write of its own: the scan waits there, then the manager completes the count
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_inventory_audit_items where id = $1 for update`, [item.id]));
      await holder.ready;
      const scanning = scan(counter, audit.id, tag);
      scanning.catch(() => undefined);
      await queued(w.e.db, 1, scanning);
      const completing = w.sys.write((tx) => transitionIn(tx, w.sys, "inventory_audit", audit.id, "completed", {}));
      completing.catch(() => undefined);
      await queued(w.e.db, 2, completing);
      holder.release();
      await holder.done;
      const [s, c] = await Promise.allSettled([scanning, completing]);
      expect(c.status, message(c)).toBe("fulfilled");
      const asset = await rowOf("sm_assets", a.id);
      const it = await rowOf("sm_inventory_audit_items", item.id);
      if (s.status === "fulfilled") {
        // counted: the asset and its item agree that it was seen
        expect(s.value.result).toBe("found");
        expect(it.result).toBe("found");
        expect(asset.state).toBe("in_stock");
        expect(asset.last_audit_result).toBe("found");
      } else {
        // or the scan came after the completion and was refused — then the asset is missing and its item says so
        expect(message(s)).toContain("پایان یافته");
        expect(it.result).toBe("missing");
        expect(asset.state).toBe("missing");
      }
    });

    it("A3-9: a note is not dispatched with an asset whose branch is being changed", async () => {
      const unit = (name: string) => made("org_unit", { name: `${name} ${pid}`, kind: "branch" });
      const [s, x, y] = [await unit("شعبهٔ مبدأ"), await unit("شعبهٔ مقصد"), await unit("شعبهٔ سوم")];
      const a = await made("asset", { model_id: laptop, state: "in_use", branch_id: s.id, department_id: s.id, serial_number: `TRF-${pid}` });
      const t = await made("asset_transfer", { title: "انتقال هم‌زمان", from_branch_id: s.id, to_branch_id: x.id, reason: "relocation", state: "approved" });
      await made("asset_transfer_item", { transfer_id: t.id, asset_id: a.id, condition_out: "good" });
      // an asset manager everywhere moves the asset to a third branch (not committed) when the note is dispatched
      const moving = hold(w.e.db, (tx) => updateIn(tx, w.sys, "asset", a.id, { branch_id: y.id }, { trusted: true }));
      const dispatch = await whileHeld(moving, () => w.sys.write((tx) => transitionIn(tx, w.sys, "asset_transfer", t.id, "in_transit", {})));
      expect(dispatch.status).toBe("rejected");
      expect(message(dispatch)).toContain("دیگر در شعبهٔ مبدأ ثبت نیست");
      const after = await rowOf("sm_assets", a.id);
      expect(after.state).toBe("in_use");
      expect(after.branch_id).toBe(y.id);
      expect((await rowOf("sm_asset_transfers", t.id)).state).toBe("approved");
    });
  });

  // ----------------------------------------------------------------------------------------------------- finance

  describe("finance", () => {
    let cc: string;
    let hw: string;
    beforeAll(async () => {
      cc = await w.idOf("org_unit", "code", "CC-IT-INF");
      hw = await w.idOf("cost_type", "code", "HW");
    });

    it("A3-3: the sweep and a capture asked for by hand at once post each cost of the period once", async () => {
      const period = periodKeyOf(today());
      // the period's automatic costs are still to post (the sweep may have run while the world was made)
      await w.e.db.query(`delete from sm_cost_entries where org_id = $1 and source_key is not null`, [w.e.org]);
      await made("cost_entry", { entry_date: today(), amount: "1000", description: "ثبت دستی", cost_center_id: cc, cost_type_id: hw });
      // the ledger's numbers are held by a write of its own: both captures read their keys and wait to insert
      const numbers = hold(w.e.db, (tx) => tx.query(`select 1 from sm_numbers where org_id = $1 and table_key = 'cost_entry' for update`, [w.e.org]));
      const both = await whileHeld(numbers, () => Promise.all([capture(w.sys, period), capture(w.sys, period)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const created = (both as PromiseFulfilledResult<{ created: number }[]>).value.reduce((n, r) => n + r.created, 0);
      expect(created).toBeGreaterThan(0);
      const twice = await w.e.db.query(`select source_key from sm_cost_entries where org_id = $1 and source_key is not null and deleted_at is null group by source_key having count(*) > 1`, [w.e.org]);
      expect(twice).toEqual([]);
      const keys = await w.e.db.one<{ n: number }>(`select count(*)::int as n from sm_cost_entries where org_id = $1 and source_key is not null and deleted_at is null`, [w.e.org]);
      expect(keys!.n).toBe(created);
    });

    it("A3-4: an entry reversed twice at once is reversed once; the second is refused", async () => {
      const e = await made("cost_entry", { entry_date: today(), amount: "7000", description: "ثبت برای برگشت", cost_center_id: cc, cost_type_id: hw });
      // the first reversal (its entry and the original's flag) has not committed when the second is asked for
      const first = hold(w.e.db, async (tx: Tx) => {
        await createIn(tx, w.sys, "cost_entry", { entry_date: today(), amount: "-7000", description: "برگشت نخست", cost_center_id: cc, cost_type_id: hw, reversal_of: e.id }, { trusted: true });
        await updateIn(tx, w.sys, "cost_entry", e.id, { reversed: true }, { trusted: true });
      });
      const second = await whileHeld(first, () => call(w.p.fin.client, "POST", `${w.P}/financial/entries/${e.id}/reverse`, { reason: "دوباره" }));
      expect(second.status, message(second)).toBe("fulfilled");
      expect((second as PromiseFulfilledResult<{ status: number }>).value.status).toBe(409);
      const reversals = await w.e.db.query(`select id from sm_cost_entries where reversal_of = $1 and deleted_at is null`, [e.id]);
      expect(reversals.length).toBe(1);
    });
  });

  // ------------------------------------------------------------------------------------------- customer service

  describe("customer service", () => {
    it("A3-2: two cases of one entitlement closing at once both consume their units", async () => {
      const acc = await made("customer_account", { name: `حساب پیش‌پرداخت ${pid}` });
      const from = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const to = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
      const ent = await made("entitlement", { name: "بستهٔ پیش‌پرداخت", account_id: acc.id, starts_on: from, ends_on: to, unit_type: "cases", units_total: "100", units_used: "10", state: "active" });
      const kase = (title: string) => made("customer_case", { short_description: title, account_id: acc.id, proactive: true, entitlement_id: ent.id, state: "resolved", close_notes: "حل شد" });
      const [c1, c2] = [await kase("پروندهٔ نخست"), await kase("پروندهٔ دوم")];
      const close = (tx: Tx, id: string) => transitionIn(tx, w.sys, "customer_case", id, "closed", {});
      const first = hold(w.e.db, (tx) => close(tx, c1.id));
      const second = await whileHeld(first, () => w.sys.write((tx) => close(tx, c2.id)));
      expect(second.status, message(second)).toBe("fulfilled");
      expect(Number((await rowOf("sm_entitlements", ent.id)).units_used)).toBe(12);
      const balances = (await w.e.db.query<{ balance_after: string }>(`select balance_after from sm_entitlement_ledger where entitlement_id = $1 and deleted_at is null order by created_at`, [ent.id])).map((r) => Number(r.balance_after));
      expect(balances.sort((x, y) => y - x)).toEqual([89, 88]);
    });
  });

  // --------------------------------------------------------------------------------------------------- workforce

  describe("workforce", () => {
    it("A3-8: time off canceled while its start is applied leaves the person in office", async () => {
      const user = w.p.agent.userId;
      const x = await made("wfm_absence", {
        user_id: user, type: "annual", state: "approved", delegate_id: w.p.am.userId,
        start_at: new Date(Date.now() + 3_600_000).toISOString(), end_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      });
      // its start has come (the start job is due)
      await w.e.db.query(`update sm_wfm_absences set start_at = now() - interval '1 hour' where id = $1`, [x.id]);
      const profile = (await w.e.db.one<{ id: string }>(`select id from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [w.e.org, user]))!.id;
      // the profile is held by a write of its own: the start job waits there while the person cancels the time off
      const holder = hold(w.e.db, (tx) => tx.query(`select 1 from sm_member_profiles where id = $1 for update`, [profile]));
      await holder.ready;
      const ticking = absenceTick(w.sys, x.id);
      ticking.catch(() => undefined);
      await queued(w.e.db, 1, ticking);
      const canceling = w.sys.write((tx) => transitionIn(tx, w.sys, "wfm_absence", x.id, "canceled", {}, { trusted: true }));
      canceling.catch(() => undefined);
      await queued(w.e.db, 2, canceling);
      holder.release();
      await holder.done;
      const [t, c] = await Promise.allSettled([ticking, canceling]);
      expect(t.status, message(t)).toBe("fulfilled");
      expect(c.status, message(c)).toBe("fulfilled");
      const p = await rowOf("sm_member_profiles", profile);
      expect(p.out_of_office).toBe(false);
      const a = await rowOf("sm_wfm_absences", x.id);
      expect(a.state).toBe("canceled");
      expect(a.applied).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------- medium findings

  describe("medium findings", () => {
    /** Hold the record counter of `table` (every create of the table waits there, after its hooks decided). */
    const holdNumbers = async (table: string) => {
      expect(await w.e.db.one(`select 1 from sm_numbers where org_id = $1 and table_key = $2`, [w.e.org, table]), `a ${table} exists`).toBeTruthy();
      return hold(w.e.db, (tx) => tx.query(`select 1 from sm_numbers where org_id = $1 and table_key = $2 for update`, [w.e.org, table]));
    };
    const holdRow = (table: string, id: string) => hold(w.e.db, (tx) => tx.query(`select 1 from ${table} where id = $1 for update`, [id]));
    const branch = (name: string) => made("org_unit", { name: `${name} ${pid}`, kind: "branch" });

    it("A3-10: an import matching a CI a person is correcting keeps the person's value", async () => {
      const host = `srv-ire-${pid}`;
      const ci = await made("ci", { name: host, hostname: host, class: "server", attrs: { cpu_model: "Xeon 4210", antivirus: "قدیمی" } });
      const owner = await w.e.ctxOf(w.e.ownerId);
      // the person's correction of the processor is in flight when a source reports the server with its antivirus
      const editing = hold(w.e.db, (tx) => updateIn(tx, owner, "ci", ci.id, { attrs: { cpu_model: "Xeon 6338", antivirus: "قدیمی" } }));
      const imported = await whileHeld(editing, () => createOrUpdate(w.sys, { items: [{ class: "server", values: { name: host, hostname: host }, attrs: { antivirus: "نسخهٔ تازه" } }] }));
      expect(imported.status, message(imported)).toBe("fulfilled");
      const attrs = (await rowOf("sm_cis", ci.id)).attrs as Record<string, unknown>;
      expect(attrs.cpu_model).toBe("Xeon 6338");
      expect(attrs.antivirus).toBe("نسخهٔ تازه");
    });

    it("A3-11: two sources reporting the same new device at once make one CI", async () => {
      await made("ci", { name: `counter-${pid}`, class: "server" });
      const host = `new-host-${pid}`;
      const numbers = await holdNumbers("ci");
      const both = await whileHeld(numbers, () => Promise.all([0, 1].map(() => createOrUpdate(w.sys, { items: [{ class: "server", values: { name: host, hostname: host } }] }))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const cis = await w.e.db.query(`select id from sm_cis where org_id = $1 and hostname = $2 and deleted_at is null`, [w.e.org, host]);
      expect(cis.length).toBe(1);
    });

    it("A3-12: one relationship made twice at once is made once", async () => {
      const a = await made("ci", { name: `app-host-a-${pid}`, class: "server" });
      const b = await made("ci", { name: `app-host-b-${pid}`, class: "server" });
      // both writers checked for the relationship and meet before they commit
      const meet = meeting(2);
      const unhook = registerHooks("ci_rel", { afterWrite: async (x) => void (x.op === "create" && x.row.parent_id === a.id && (await meet())) });
      try {
        const make = () => w.sys.write((tx) => createIn(tx, w.sys, "ci_rel", { parent_id: a.id, child_id: b.id, type: "depends_on" }, { trusted: true }));
        const both = await Promise.allSettled([make(), make()]);
        expect(both.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
        expect(message(both.find((x) => x.status === "rejected")!)).toContain("از پیش برقرار است");
      } finally {
        unhook();
      }
      const rels = await w.e.db.query(`select id from sm_ci_rels where parent_id = $1 and child_id = $2 and type = 'depends_on' and deleted_at is null and valid_to is null`, [a.id, b.id]);
      expect(rels.length).toBe(1);
    });

    it("A3-13: two health passes over one CI at once open one finding", async () => {
      // a finding of another CI first (the counter of findings exists)
      const other = await made("ci", { name: `srv-noowner-0-${pid}`, class: "server" });
      await w.sys.write((tx) => computeHealth(tx, w.sys, { ids: [other.id] }));
      const ci = await made("ci", { name: `srv-noowner-${pid}`, class: "server" });
      const numbers = await holdNumbers("cmdb_finding");
      const both = await whileHeld(numbers, () => Promise.all([0, 1].map(() => w.sys.write((tx) => computeHealth(tx, w.sys, { ids: [ci.id] })))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const open = await w.e.db.query(`select id from sm_cmdb_findings where org_id = $1 and dedupe_key = $2 and active and deleted_at is null`, [w.e.org, `missing_owner:${ci.id}`]);
      expect(open.length).toBe(1);
    });

    it("A3-15: two discrepancies of one audit settled at once leave none open", async () => {
      const room = await made("stockroom", { name: `انبار تسویه ${pid}`, code: `SET-${pid}` });
      const a1 = await made("asset", { model_id: laptop, state: "in_stock", stockroom_id: room.id, serial_number: `SET-1-${pid}` });
      const a2 = await made("asset", { model_id: laptop, state: "in_stock", stockroom_id: room.id, serial_number: `SET-2-${pid}` });
      const audit = await made("inventory_audit", { name: "شمارش تسویه", scope_kind: "stockroom", stockroom_id: room.id, mark_missing: false });
      await w.sys.write((tx) => transitionIn(tx, w.sys, "inventory_audit", audit.id, "in_progress", {}));
      await w.sys.write((tx) => transitionIn(tx, w.sys, "inventory_audit", audit.id, "completed", {}));
      expect(Number((await rowOf("sm_inventory_audits", audit.id)).discrepancy_open)).toBe(2);
      const items = await w.e.db.query<{ id: string; asset_id: string }>(`select id, asset_id from sm_inventory_audit_items where audit_id = $1 and deleted_at is null`, [audit.id]);
      const am = await w.e.ctxOf(w.p.am.userId);
      // the audit is held by a write of its own while two officers settle one item each
      const holder = holdRow("sm_inventory_audits", audit.id);
      const both = await whileHeld(holder, () => Promise.all([a1, a2].map((a) => resolveAuditItem(am, items.find((i) => i.asset_id === a.id)!.id, { resolution: "found" }))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      expect(Number((await rowOf("sm_inventory_audits", audit.id)).discrepancy_open)).toBe(0);
    });

    it("A3-16 and A3-19: items added to one note at once are both counted; one asset never rides two open notes", async () => {
      const [s1, x1] = [await branch("شعبهٔ اقلام"), await branch("شعبهٔ گیرندهٔ اقلام")];
      const asset = (n: number) => made("asset", { model_id: laptop, state: "in_use", branch_id: s1.id, department_id: s1.id, serial_number: `ITM-${n}-${pid}` });
      const [a1, a2, a3] = [await asset(1), await asset(2), await asset(3)];
      const note = (title: string) => made("asset_transfer", { title, from_branch_id: s1.id, to_branch_id: x1.id, reason: "relocation" });
      const t = await note("حوالهٔ دو قلمی");
      const item = (transfer: string, a: string) => w.sys.write((tx) => createIn(tx, w.sys, "asset_transfer_item", { transfer_id: transfer, asset_id: a, condition_out: "good" }, { trusted: true }));
      // the note is held by a write of its own while two items are added to it
      const holder = holdRow("sm_asset_transfers", t.id);
      const both = await whileHeld(holder, () => Promise.all([item(t.id, a1.id), item(t.id, a2.id)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      expect(Number((await rowOf("sm_asset_transfers", t.id)).item_count)).toBe(2);
      // the same asset put on two draft notes at once: one of them is refused
      const [n1, n2] = [await note("حوالهٔ نخست"), await note("حوالهٔ دوم")];
      const busy = holdRow("sm_assets", a3.id);
      const two = await whileHeld(busy, () => Promise.allSettled([item(n1.id, a3.id), item(n2.id, a3.id)]), 2);
      expect(two.status).toBe("fulfilled");
      const outcomes = (two as PromiseFulfilledResult<PromiseSettledResult<unknown>[]>).value;
      expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(message(outcomes.find((o) => o.status === "rejected")!)).toContain("در حوالهٔ باز");
    });

    it("A3-14: two certification tasks of one campaign done at once are both counted", async () => {
      const campaign = await made("ci_cert_campaign", { name: `دورهٔ تأیید ${pid}`, due_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), state: "active" });
      const task = (n: number) => made("ci_cert_task", { short_description: `تأیید ${n}`, campaign_id: campaign.id });
      const [t1, t2] = [await task(1), await task(2)];
      // the campaign is held by a write of its own while two owners confirm their tasks
      const holder = holdRow("sm_ci_cert_campaigns", campaign.id);
      const done = (id: string) => w.sys.write((tx) => transitionIn(tx, w.sys, "ci_cert_task", id, "done", {}, { trusted: true }));
      const both = await whileHeld(holder, () => Promise.all([done(t1.id), done(t2.id)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      expect(Number((await rowOf("sm_ci_cert_campaigns", campaign.id)).done_count)).toBe(2);
    });

    it("A3-17: two receipts of an order's last lines posted at once leave the order received", async () => {
      const po = await made("purchase_order", { title: `سفارش دو سطری ${pid}`, state: "partially_received" });
      const line = (n: number) => made("purchase_order_line", { po_id: po.id, description: `کالای ${n}`, quantity: 1 });
      const [l1, l2] = [await line(1), await line(2)];
      const receipt = async (l: Row) => {
        const g = await made("goods_receipt", { po_id: po.id, stockroom_id: central });
        await made("goods_receipt_line", { receipt_id: g.id, po_line_id: l.id, quantity: 1 });
        return g;
      };
      const [g1, g2] = [await receipt(l1), await receipt(l2)];
      // the order is held by a write of its own while both receipts are posted
      const holder = holdRow("sm_purchase_orders", po.id);
      const post = (id: string) => w.sys.write((tx) => transitionIn(tx, w.sys, "goods_receipt", id, "posted", {}, { trusted: true }));
      const both = await whileHeld(holder, () => Promise.all([post(g1.id), post(g2.id)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const after = await rowOf("sm_purchase_orders", po.id);
      expect(after.state).toBe("received");
      expect(after.received_at).toBeTruthy();
    });

    it("A3-41: the sweep's book value follows a cost changed while it ran", async () => {
      const a = await made("asset", { model_id: laptop, state: "in_use", purchase_cost: "600000000", purchase_date: "2025-03-21", serial_number: `BV-${pid}` });
      expect(a.depreciation_rule_id).toBeTruthy();
      // last valued in an earlier month: the sweep lists it as due
      await w.e.db.query(`update sm_assets set book_value_at = '2025-01-01' where id = $1`, [a.id]);
      // the cost correction is in flight when the sweep's batch reaches the asset
      const correcting = hold(w.e.db, (tx) => updateIn(tx, w.sys, "asset", a.id, { purchase_cost: "300000000" }, { trusted: true }));
      const swept = await whileHeld(correcting, () => itamSweep(w.sys));
      expect(swept.status, message(swept)).toBe("fulfilled");
      const after = await rowOf("sm_assets", a.id);
      const rule = await rowOf("sm_depreciation_rules", String(after.depreciation_rule_id));
      const want = bookValueOf({ ...rule, life_months: Number(rule.life_months), salvage_percent: rule.salvage_percent }, { ...after, purchase_cost: String(after.purchase_cost) }, String(after.book_value_at).slice(0, 10));
      expect(String(after.purchase_cost)).toBe("300000000");
      expect(String(after.book_value)).toBe(String(want?.book_value));
    });

    it("A3-18: two stock checks at once raise one requisition and one alert per shortage", async () => {
      const room = await made("stockroom", { name: `انبار قاعده ${pid}`, code: `RUL-${pid}` });
      const model = await made("asset_model", { name: `کارتریج قاعده ${pid}`, category: "consumable", asset_class: "consumable", tracking: "quantity" });
      const rule = await made("stock_rule", { model_id: model.id, stockroom_id: room.id, min_qty: 5, max_qty: 10, auto_requisition: true, active: true, status: "ok", available: 10 });
      // the rule is held by a write of its own while the job and «بررسی» by hand check it
      const holder = holdRow("sm_stock_rules", rule.id);
      const both = await whileHeld(holder, () => Promise.all([checkStockRules(w.sys), checkStockRules(w.sys)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const prqs = await w.e.db.query(`select id from sm_purchase_requisitions where stock_rule_id = $1 and deleted_at is null`, [rule.id]);
      expect(prqs.length).toBe(1);
    });

    it("A3-21: the sweep and «باز کردن» at once open one attestation per branch and period", async () => {
      const b = await branch("شعبهٔ تأیید");
      await made("asset", { model_id: laptop, state: "in_use", branch_id: b.id, department_id: b.id, serial_number: `ATT-${pid}` });
      await w.e.db.query(`update sm_itam_configs set attestation_months = 3 where org_id = $1`, [w.e.org]);
      await made("branch_attestation", { title: "تأیید پیشین", branch_id: b.id, period_label: `پیشین ${pid}`, due_date: today() });
      const numbers = await holdNumbers("branch_attestation");
      const both = await whileHeld(numbers, () => Promise.all([openAttestations(w.sys), openAttestations(w.sys)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const twice = await w.e.db.query(`select branch_id, period_label from sm_branch_attestations where org_id = $1 and deleted_at is null group by branch_id, period_label having count(*) > 1`, [w.e.org]);
      expect(twice).toEqual([]);
      expect((await w.e.db.query(`select id from sm_branch_attestations where branch_id = $1 and deleted_at is null`, [b.id])).length).toBe(2);
    });

    it("A3-25: a check-out of an asset someone else is handing over answers «changed» instead of overwriting", async () => {
      const a = await made("asset", { model_id: laptop, state: "in_use", assigned_to: w.p.req.userId, serial_number: `CHK-${pid}` });
      const am = await w.e.ctxOf(w.p.am.userId);
      const handing = hold(w.e.db, (tx) => updateIn(tx, w.sys, "asset", a.id, { assigned_to: w.p.req2.userId }, { trusted: true }));
      const out = await whileHeld(handing, () => checkout(am, a.id, { assigned_to: w.p.agent.userId }));
      expect(out.status).toBe("rejected");
      expect(message(out)).toMatch(/تغییر|نسخه/);
      expect((await rowOf("sm_assets", a.id)).assigned_to).toBe(w.p.req2.userId);
    });

    it("A3-29: two bookings of one room for one hour at once: one confirmed, the other waits", async () => {
      const loc = await made("location", { name: `ساختمان آزمون ${pid}` });
      const room = await made("space", { name: `اتاق جلسه ${pid}`, location_id: loc.id, bookable: true, requires_approval: false });
      const at = (h: number) => new Date(Date.UTC(2031, 0, 5, h, 0, 0)).toISOString();
      const book = (title: string, from: number, to: number) => w.sys.write((tx) => createIn(tx, w.sys, "reservation", { title, space_id: room.id, start_at: at(from), end_at: at(to), booked_for: w.p.req.userId }, { trusted: true }));
      await book("رزرو پیشین", 6, 7);
      const numbers = await holdNumbers("reservation");
      const both = await whileHeld(numbers, () => Promise.all([book("جلسهٔ نخست", 9, 10), book("جلسهٔ دوم", 9, 10)]), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const states = (await w.e.db.query<{ state: string }>(`select state from sm_reservations where space_id = $1 and start_at = $2 and deleted_at is null`, [room.id, at(9)])).map((r) => r.state).sort();
      expect(states).toEqual(["confirmed", "requested"]);
    });

    it("A3-33: two overlapping time-off requests for one person at once: one is refused", async () => {
      const user = w.p.req2.userId;
      const day = (d: number, h: number) => new Date(Date.UTC(2031, 1, d, h, 0, 0)).toISOString();
      const absence = (from: string, to: string) => w.sys.write((tx) => createIn(tx, w.sys, "wfm_absence", { user_id: user, type: "annual", start_at: from, end_at: to }, { trusted: true }));
      await absence(day(1, 6), day(1, 12));
      const numbers = await holdNumbers("wfm_absence");
      const both = await whileHeld(numbers, () => Promise.allSettled([absence(day(10, 6), day(12, 12)), absence(day(11, 6), day(13, 12))]), 2);
      expect(both.status).toBe("fulfilled");
      const outcomes = (both as PromiseFulfilledResult<PromiseSettledResult<unknown>[]>).value;
      expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
      const made2 = await w.e.db.query(`select id from sm_wfm_absences where user_id = $1 and start_at >= $2 and deleted_at is null`, [user, day(10, 0)]);
      expect(made2.length).toBe(1);
    });

    it("A3-34: two first heartbeats of one person at once open one presence interval", async () => {
      const user = w.p.auditor.userId;
      await w.sys.write((tx) => setPresenceIn(tx, w.sys, user, "offline"));
      const agent = (await w.e.db.one<{ id: string }>(`select id from sm_wfm_agents where org_id = $1 and user_id = $2 and deleted_at is null`, [w.e.org, user]))!.id;
      const holder = holdRow("sm_wfm_agents", agent);
      const both = await whileHeld(holder, () => Promise.all([0, 1].map(() => w.sys.write((tx) => setPresenceIn(tx, w.sys, user, "available")))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const open = await w.e.db.query(`select id from sm_wfm_presence_log where org_id = $1 and user_id = $2 and to_at is null and deleted_at is null`, [w.e.org, user]);
      expect(open.length).toBe(1);
    });

    it("A3-35: the sweep and «اجرای برنامه‌ها» at once generate one work order per plan and due date", async () => {
      const plan = await made("maintenance_plan", { name: `نگهداری آزمون ${pid}`, status: "active", generates: "work_order", every_n: 1, interval_unit: "month", lead_days: 7, horizon: 1, next_due: today(), priority: "4" });
      const holder = holdRow("sm_maintenance_plans", plan.id);
      const both = await whileHeld(holder, () => Promise.all([0, 1].map(() => w.sys.write((tx) => generateMaintenanceIn(tx, w.sys)))), 2);
      expect(both.status, message(both)).toBe("fulfilled");
      const orders = await w.e.db.query(`select id from sm_work_orders where maintenance_plan_id = $1 and deleted_at is null`, [plan.id]);
      expect(orders.length).toBe(1);
    });
  });
});
