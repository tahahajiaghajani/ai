// IT asset management with field service and ESM (after the ESM merge), with real rows of every module:
//   · a part consumed on a work order leaves ITAM's stock — a serial-numbered asset is handed over to the work order's
//     requester, a quantity-tracked stock row is decremented — with the stock movement ledger and a note on the work
//     order; a part ITAM does not hold leaves a note instead;
//   · an onboarding journey's laptop order (the IT catalogue's new_laptop, bound to a model by ITAM's seed) reserves
//     stock for the new hire when fulfilment starts and hands the laptop over on delivery, finishing the activity.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createIn, transitionIn } from "@server/engine";
import { seedItamDefaults } from "@server/modules/itam";
import { dayFrom, esmWorld, type EsmWorld } from "./esm-helpers";

vi.setConfig({ testTimeout: 180_000 });

type Row = Record<string, any>;
let w: EsmWorld;
let room: string;
let laptop: string;
const q = async (table: string, filter: unknown) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 200 })).rows as Row[];
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;
const sysAsset = (data: Row) => w.sys.write((tx) => createIn(tx, w.sys, "asset", { state: "in_stock", stockroom_id: room, ...data }, { trusted: true }));

beforeAll(async () => {
  w = await esmWorld();
  await seedItamDefaults(w.e.cfg, w.e.org, { force: true });
  await w.o.post(`${w.P}/field_service/seed`, {});
  await w.drain();
  room = (await q("stockroom", { f: "code", op: "eq", v: "WH-01" }))[0].id;
  laptop = (await q("asset_model", { f: "name", op: "eq", v: "لنوو ThinkPad E14 Gen 5" }))[0].id;
}, 300_000);

describe("field service parts from ITAM's stockrooms", () => {
  let wo: Row;
  let task: Row;
  beforeAll(async () => {
    wo = (await w.o.post(`${w.P}/r/work_order`, { short_description: "تعویض لپ‌تاپ معیوب", requested_for: w.p.emp.userId, caller_id: w.p.emp.userId, site_address: "ساختمان مرکزی" })).row;
    task = (await w.o.post(`${w.P}/r/wo_task`, { work_order_id: wo.id, short_description: "نصب دستگاه جایگزین" })).row;
  });

  const consume = async (part: Row) => {
    const p = (await w.o.post(`${w.P}/r/parts_requirement`, { wo_task_id: task.id, ...part })).row;
    await w.o.post(`${w.P}/r/parts_requirement/${p.id}/transition`, { to: "consumed" });
    await w.drain();
    return p;
  };
  const notes = async () => ((await w.o.get(`${w.P}/r/work_order/${wo.id}/journal`)).entries as Row[]).map((e) => String(e.body));

  it("hands a serial-numbered asset over to the work order's requester, with the ledger", async () => {
    const asset = await sysAsset({ model_id: laptop, serial_number: "FS-SER-1" });
    await consume({ part_name: "لپ‌تاپ جایگزین", serial_no: "FS-SER-1", stockroom: "WH-01" });
    const after = await one("asset", asset.id);
    expect(after).toMatchObject({ state: "in_use", assigned_to: w.p.emp.userId });
    const moves = await q("stock_movement", { f: "asset_id", op: "eq", v: asset.id });
    expect(moves.some((m) => m.kind === "issue" && Number(m.quantity) === -1 && m.stockroom_id === room)).toBe(true);
    expect((await notes()).some((n) => n.includes("FS-SER-1") && n.includes(String(asset.number)))).toBe(true);
  });

  it("decrements quantity-tracked stock of the part's model", async () => {
    const model = (await w.o.post(`${w.P}/r/asset_model`, { name: "کابل شبکهٔ Cat6 آزمون", model_number: "CAB-FS-6", tracking: "quantity", category: "consumable" }).catch(async () => w.o.post(`${w.P}/r/asset_model`, { name: "کابل شبکهٔ Cat6 آزمون", model_number: "CAB-FS-6", tracking: "quantity" }))).row;
    const stock = await sysAsset({ model_id: model.id, name: "کابل Cat6", quantity: 10 });
    await consume({ part_name: "کابل شبکه", part_code: "CAB-FS-6", quantity: 3, stockroom: "WH-01" });
    expect(Number((await one("asset", stock.id)).quantity)).toBe(7);
    const moves = await q("stock_movement", { f: "asset_id", op: "eq", v: stock.id });
    expect(moves.some((m) => Number(m.quantity) === -3)).toBe(true);
  });

  it("notes a part ITAM does not hold, and moves nothing", async () => {
    const before = (await q("stock_movement", { f: "reference", op: "nempty" })).length;
    await consume({ part_name: "قطعهٔ ناشناخته", part_code: "NOPE-404" });
    expect((await notes()).some((n) => n.includes("NOPE-404") || n.includes("قطعهٔ ناشناخته"))).toBe(true);
    expect((await q("stock_movement", { f: "reference", op: "nempty" })).length).toBe(before);
  });
});

describe("ESM onboarding ↔ ITAM: the new hire's laptop", () => {
  it("reserves a laptop for the new hire and hands it over when the order is delivered, finishing the activity", async () => {
    // a free laptop in stock (and no other free one of the model)
    for (const a of await q("asset", { and: [{ f: "model_id", op: "eq", v: laptop }, { f: "state", op: "eq", v: "in_stock" }] })) {
      await w.sys.write((tx) => transitionIn(tx, w.sys, "asset", a.id, "retired", { retire_reason: "پاک‌سازی آزمون" }, { trusted: true })).catch(() => undefined);
    }
    const free = await sysAsset({ model_id: laptop, serial_number: "ONB-1" });
    const tpl = ((await w.p.hrdesk.client.get(`${w.P}/r/journey_template?size=10`)).rows as Row[]).find((t) => t.code === "onboarding_standard")!;
    const res = await w.p.hrdesk.client.post(`${w.P}/esm/journeys`, { template_id: tpl.id, anchor_date: dayFrom(5), subject_person_id: w.p.hire.userId, manager_id: w.p.mgr.userId });
    await w.drain();
    let t = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${res.journey.id}/tracker`);
    const act = (t.activities as Row[]).find((a) => a.code === "laptop")!;
    expect(act.record_table).toBe("request_item");
    const ritm = await one("request_item", act.record_id);
    expect(ritm.requested_for).toBe(w.p.hire.userId);
    // fulfilment starts (its approvals are the request module's): ITAM reserves the free laptop for the new hire
    if (ritm.state !== "in_fulfilment") await w.sys.write((tx) => transitionIn(tx, w.sys, "request_item", ritm.id, "in_fulfilment", {}, { trusted: true }));
    await w.drain();
    expect(await one("asset", free.id)).toMatchObject({ state: "in_stock", substate: "reserved", reserved_for: w.p.hire.userId, request_item_id: ritm.id });
    // delivered: the laptop is the new hire's, and the journey's activity is done
    await w.o.post(`${w.P}/r/request_item/${ritm.id}/transition`, { to: "delivered" });
    await w.drain();
    expect(await one("asset", free.id)).toMatchObject({ state: "in_use", assigned_to: w.p.hire.userId });
    expect((await w.p.hire.client.get(`${w.P}/itam/my-assets`)).assets.map((a: Row) => a.id)).toContain(free.id);
    t = await w.p.hrdesk.client.get(`${w.P}/esm/journeys/${res.journey.id}/tracker`);
    expect((t.activities as Row[]).find((a) => a.code === "laptop")!.state).toBe("done");
  });
});
