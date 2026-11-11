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
import { createIn, transitionIn, updateIn, type RecordEvent } from "@server/engine";
import { consumePartIn, onRequestItem } from "@server/modules/itam/jobs";
import { scan } from "@server/modules/itam/stock";
import { capture } from "@server/modules/financial";
import { absenceTick } from "@server/modules/workforce/jobs";
import { seedRequestDefaults } from "@server/modules/request";
import { seedItamDefaults } from "@server/modules/itam";
import { realPgAvailable } from "./pg-real";
import { call, hold, message, queued, raceDatabases, whileHeld } from "./race-helpers";
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
});
