// ITAM ↔ request fulfilment end to end (ITAM-020/021), with the request module's catalogue and ITAM's bindings
// seeded in the same organisation: a requested item of a catalogue item bound to a model reserves free stock when
// its fulfilment starts, raises a purchase requisition for what stock cannot cover, shows the hand-over panel
// (reserved assets and free candidates), hands the reserved assets over when it is delivered (assignment history
// naming the item), and releases reservations when it is cancelled.
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";
import { seedRequestDefaults } from "@server/modules/request";
import { seedItamDefaults } from "@server/modules/itam";
import { transitionIn } from "@server/engine";

let w: ItamWorld;
let laptopItem = "";
let laptopModel = "";
let central = "";
type Row = Record<string, any>;
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 200 })).rows as Row[];
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;

/** The requester's client of a member id. */
const clientOf = (userId: string) => Object.values(w.p).find((p) => p.userId === userId)!.client;

/**
 * A requested item of the laptop ordered from the catalogue by `who` (quantity `qty`); its approvals (the request
 * module's, tested there) are taken as the system, which moves it into fulfilment.
 */
async function requested(who: string, qty = 1, start = true): Promise<Row> {
  const r = await clientOf(who).post(`${w.P}/request/order`, { lines: [{ item_id: laptopItem, quantity: qty, answers: { model: "standard", os: "windows", reason: "کار روزانه" } }] });
  const id = String(r.items[0].id);
  await w.drain();
  if (start) {
    const item = await one("request_item", id);
    if (item.state !== "in_fulfilment") await w.sys.write((tx) => transitionIn(tx, w.sys, "request_item", id, "in_fulfilment", {}, { trusted: true }));
    await w.drain();
  }
  return one("request_item", id);
}

const freeStock = async () => q("asset", { and: [{ f: "model_id", op: "eq", v: laptopModel }, { f: "state", op: "eq", v: "in_stock" }, { f: "substate", op: "eq", v: "available" }] });

beforeAll(async () => {
  w = await itamWorld();
  // the request module's starter catalogue, then ITAM's bindings of its hardware items to models
  await seedRequestDefaults(w.e.cfg, w.e.org);
  await seedItamDefaults(w.e.cfg, w.e.org, { force: true });
  await w.drain();
  laptopItem = await w.idOf("catalog_item", "code", "new_laptop");
  laptopModel = await w.idOf("asset_model", "name", "لنوو ThinkPad E14 Gen 5");
  central = await w.idOf("stockroom", "code", "WH-01");
  // two laptops in stock, nothing else of the model
  for (const a of await freeStock()) await w.o.post(`${w.P}/r/asset/${a.id}/transition`, { to: "retired", data: { retire_reason: "پاک‌سازی آزمون" } }).catch(() => undefined);
  await w.asset({ serial_number: "RQ-1" });
  await w.asset({ serial_number: "RQ-2" });
}, 180_000);

describe("a requested item of a catalogue item bound to a model", () => {
  it("is bound by the ITAM seed (stock first, then purchase)", async () => {
    const [b] = await q("catalog_item_model", { f: "catalog_item_id", op: "eq", v: laptopItem });
    expect(b).toMatchObject({ model_id: laptopModel, consume_stock: true, raise_purchase: true });
    expect(await freeStock()).toHaveLength(2);
  });

  it("reserves free stock when fulfilment starts, and shows it on the hand-over panel", async () => {
    const item = await requested(w.p.req.userId);
    const reserved = await q("asset", { f: "request_item_id", op: "eq", v: item.id });
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toMatchObject({ state: "in_stock", substate: "reserved", reserved_for: w.p.req.userId });
    expect(await freeStock()).toHaveLength(1);
    // no requisition: the stock covered it
    expect(await q("purchase_requisition", { f: "request_item_id", op: "eq", v: item.id })).toHaveLength(0);
    const panel = await w.p.am.client.get(`${w.P}/itam/request-items/${item.id}/assets`);
    expect(panel.item).toMatchObject({ id: item.id, requested_for: w.p.req.userId });
    expect(panel.models.map((m: Row) => m.id)).toEqual([laptopModel]);
    expect(panel.assets.map((a: Row) => a.id)).toEqual([reserved[0].id]);
    expect(panel.candidates).toHaveLength(1);
    // a work note on the item names the reservation
    const journal = (await w.o.get(`${w.P}/r/request_item/${item.id}/journal`)).entries as Row[];
    expect(journal.some((j) => String(j.body).includes("رزرو"))).toBe(true);
  });

  it("hands the reserved asset over when the item is delivered, the assignment naming the item", async () => {
    const [item] = await q("request_item", { and: [{ f: "requested_for", op: "eq", v: w.p.req.userId }, { f: "state", op: "eq", v: "in_fulfilment" }] });
    const [asset] = await q("asset", { f: "request_item_id", op: "eq", v: item.id });
    await w.o.post(`${w.P}/r/request_item/${item.id}/transition`, { to: "delivered" });
    await w.drain();
    const after = await one("asset", asset.id);
    expect(after).toMatchObject({ state: "in_use", assigned_to: w.p.req.userId });
    const [asg] = await q("asset_assignment", { f: "asset_id", op: "eq", v: asset.id });
    expect(asg).toMatchObject({ assigned_to: w.p.req.userId, request_item_id: item.id });
    // the holder sees it among their assets
    expect((await w.p.req.client.get(`${w.P}/itam/my-assets`)).assets.map((a: Row) => a.id)).toContain(asset.id);
  });

  it("raises a purchase requisition for what stock cannot cover", async () => {
    // the last free laptop goes to a first item; a second one finds no stock and is bought
    const first = await requested(w.p.req2.userId);
    expect(await q("asset", { f: "request_item_id", op: "eq", v: first.id })).toHaveLength(1);
    expect(await freeStock()).toHaveLength(0);
    const item = await requested(w.p.req2.userId);
    expect(await q("asset", { f: "request_item_id", op: "eq", v: item.id })).toHaveLength(0);
    const [prq] = await q("purchase_requisition", { f: "request_item_id", op: "eq", v: item.id });
    expect(prq).toMatchObject({ source: "request", requested_for: w.p.req2.userId });
    const lines = await q("purchase_requisition_line", { f: "requisition_id", op: "eq", v: prq.id });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ model_id: laptopModel, quantity: 1 });
    const journal = (await w.o.get(`${w.P}/r/request_item/${item.id}/journal`)).entries as Row[];
    expect(journal.some((j) => String(j.body).includes(String(prq.number)))).toBe(true);
    // starting fulfilment again (back from «در انتظار اطلاعات») buys nothing more
    await w.sys.write((tx) => transitionIn(tx, w.sys, "request_item", item.id, "awaiting_info", {}, { trusted: true }));
    await w.drain();
    await w.sys.write((tx) => transitionIn(tx, w.sys, "request_item", item.id, "in_fulfilment", {}, { trusted: true }));
    await w.drain();
    expect(await q("purchase_requisition", { f: "request_item_id", op: "eq", v: item.id })).toHaveLength(1);
  });

  it("releases its reservations when it is cancelled", async () => {
    const reserved = await q("asset", { and: [{ f: "reserved_for", op: "eq", v: w.p.req2.userId }, { f: "substate", op: "eq", v: "reserved" }] });
    expect(reserved).toHaveLength(1);
    const asset = reserved[0];
    const item = await one("request_item", asset.request_item_id);
    await w.o.post(`${w.P}/r/request_item/${item.id}/transition`, { to: "closed_incomplete", data: { close_notes: "لغو شد" } });
    await w.drain();
    const after = await one("asset", asset.id);
    expect(after).toMatchObject({ state: "in_stock", substate: "available", reserved_for: null, request_item_id: null });
    expect(await freeStock()).toHaveLength(1);
  });

  it("hands over from the panel: a free candidate to the item's requester, by an asset manager only", async () => {
    const item = await requested(w.p.req2.userId, 1, false);
    const spare = await w.asset({ serial_number: "RQ-3" });
    const panel = await w.p.am.client.get(`${w.P}/itam/request-items/${item.id}/assets`);
    expect(panel.candidates.length).toBeGreaterThan(0);
    const pick = panel.candidates[0].id as string;
    // the requester cannot hand an asset over to themselves
    await w.p.req2.client.post(`${w.P}/itam/request-items/${item.id}/assign`, { asset_id: pick }, 403).catch(async () => {
      await w.p.req2.client.post(`${w.P}/itam/request-items/${item.id}/assign`, { asset_id: pick }, 404);
    });
    const r = await w.p.am.client.post(`${w.P}/itam/request-items/${item.id}/assign`, { asset_id: pick });
    expect(r.asset).toMatchObject({ id: pick, state: "in_use", assigned_to: w.p.req2.userId });
    const [asg] = await q("asset_assignment", { and: [{ f: "asset_id", op: "eq", v: pick }, { f: "to_at", op: "empty" }] });
    expect(asg.request_item_id).toBe(item.id);
    expect(panel.candidates.map((c: Row) => c.id)).toContain(spare.id);
    expect(central).toBeTruthy();
  });
});
