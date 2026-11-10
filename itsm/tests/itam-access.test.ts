// Access of IT asset management: the holder grant («دارایی‌های من» without a role in the area), requesters who may not
// list assets, agents who read without money and never write, auditors who read money without writing, ledgers the
// module alone writes, reports filed as the person, the line manager's team view, leavers and the dashboard.
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";

let w: ItamWorld;
let mine: Record<string, any>;
let theirs: Record<string, any>;

beforeAll(async () => {
  w = await itamWorld();
  mine = await w.asset({ serial_number: "ACC-1", purchase_cost: "650000000", purchase_date: "2026-01-10" });
  theirs = await w.asset({ serial_number: "ACC-2" });
  await w.p.am.client.post(`${w.P}/itam/assets/${mine.id}/checkout`, { assigned_to: w.p.req.userId });
  await w.p.am.client.post(`${w.P}/itam/assets/${theirs.id}/checkout`, { assigned_to: w.p.req2.userId });
  // the agent manages the requester (line manager view)
  await w.o.put(`${w.P}/access/members/${w.p.req.userId}`, { manager_id: w.p.am.userId });
}, 120_000);

describe("the holder", () => {
  it("reads and lists only their own asset (the participant grant), never another's", async () => {
    // a list or a count of the area gives the holder exactly the assets their grant opens
    const listed = await w.p.req.client.post(`${w.P}/r/asset/query`, {});
    expect(listed.rows.map((r: any) => r.id)).toEqual([mine.id]);
    expect(listed.rows[0].purchase_cost).toBeUndefined();
    expect((await w.p.req.client.post(`${w.P}/r/asset/query`, { filter: { f: "id", op: "eq", v: theirs.id } })).rows).toEqual([]);
    expect((await w.p.req.client.post(`${w.P}/r/asset/agg`, { metrics: [{ fn: "count" }] })).totals.count).toBe(1);
    await w.p.req.client.post(`${w.P}/r/asset/query`, { filter: { f: "purchase_cost", op: "gt", v: 0 } }, 400);
    await w.p.req.client.get(`${w.P}/r/asset/export`, 403);
    const own = await w.p.req.client.get(`${w.P}/r/asset/${mine.id}`);
    expect(own.row.serial_number).toBe("ACC-1");
    expect(own.row.purchase_cost).toBeUndefined();
    await w.p.req.client.get(`${w.P}/r/asset/${theirs.id}`, 404);
    await w.p.req.client.patch(`${w.P}/r/asset/${mine.id}`, { notes: "x" }, 403);
    const list = await w.p.req.client.get(`${w.P}/itam/my-assets`);
    expect(list.assets.map((a: any) => a.id)).toEqual([mine.id]);
    expect((await w.p.req2.client.get(`${w.P}/itam/my-assets`)).assets.map((a: any) => a.id)).toEqual([theirs.id]);
    const hist = await w.p.req.client.get(`${w.P}/itam/assets/${mine.id}/360`);
    expect(hist.assignments).toHaveLength(1);
    expect(hist.costs).toBeNull();
  });

  it("reports a broken asset as an incident filed as them", async () => {
    const r = await w.p.req.client.post(`${w.P}/itam/assets/${mine.id}/report`, { kind: "broken", note: "صفحه نمایش خاموش می‌شود" });
    expect(r.table).toBe("incident");
    const inc = await w.p.req.client.get(`${w.P}/r/incident/${r.id}`);
    expect(inc.row.caller_id).toBe(w.p.req.userId);
    expect(inc.row.short_description).toContain("خرابی");
    await w.p.req.client.post(`${w.P}/itam/assets/${theirs.id}/report`, { kind: "lost" }, 404);
  });
});

describe("roles", () => {
  it("lets agents read without money and never write", async () => {
    const r = await w.p.agent.client.get(`${w.P}/r/asset/${mine.id}`);
    expect(r.row.serial_number).toBe("ACC-1");
    expect(r.row.purchase_cost).toBeUndefined();
    await w.p.agent.client.patch(`${w.P}/r/asset/${mine.id}`, { notes: "x" }, 403);
    await w.p.agent.client.post(`${w.P}/itam/assets/${theirs.id}/checkin`, { stockroom_id: await w.idOf("stockroom", "code", "WH-01") }, 403);
    const d = await w.p.agent.client.get(`${w.P}/itam/dashboard`);
    expect(d.money).toBeNull();
    expect(d.total).toBeGreaterThanOrEqual(2);
  });

  it("lets auditors and IT finance read money without writing", async () => {
    for (const who of ["auditor", "fin"] as const) {
      const r = await w.p[who].client.get(`${w.P}/r/asset/${mine.id}`);
      expect(r.row.purchase_cost).toBe("650000000");
      // the book value is there from the first day (straight line from the purchase date, below the cost)
      expect(Number(r.row.book_value)).toBeGreaterThan(0);
      expect(Number(r.row.book_value)).toBeLessThanOrEqual(650000000);
      await w.p[who].client.patch(`${w.P}/r/asset/${mine.id}`, { notes: "x" }, 403);
    }
    const d = await w.p.am.client.get(`${w.P}/itam/dashboard`);
    expect(Number(d.money.purchase_cost)).toBeGreaterThanOrEqual(650000000);
  });

  it("keeps the ledgers to the module", async () => {
    const model = await w.idOf("asset_model", "name", "لنوو ThinkPad E14 Gen 5");
    const room = await w.idOf("stockroom", "code", "WH-01");
    await w.p.am.client.post(`${w.P}/r/stock_movement`, { kind: "adjustment", quantity: 5, model_id: model, stockroom_id: room }, 403);
    await w.p.am.client.post(`${w.P}/r/asset_assignment`, { asset_id: mine.id, from_at: new Date().toISOString() }, 403);
    const moves = await w.p.am.client.post(`${w.P}/r/stock_movement/query`, { filter: { f: "asset_id", op: "eq", v: mine.id } });
    await w.p.am.client.patch(`${w.P}/r/stock_movement/${moves.rows[0].id}`, { note: "x" }, 403);
  });

  it("shows the line manager their team's assets", async () => {
    const r = await w.p.am.client.get(`${w.P}/itam/my-assets`);
    expect(r.team.map((t: any) => t.user_id)).toContain(w.p.req.userId);
  });
});

describe("leavers", () => {
  it("marks a leaver's assets to be returned and releases licences", async () => {
    const ent = (await w.p.am.client.post(`${w.P}/r/license_entitlement`, { name: "Acrobat — آزمون", software_model_id: await w.idOf("software_model", "name", "Adobe Acrobat Pro"), metric: "per_user", quantity: 2 })).row;
    await w.p.am.client.post(`${w.P}/r/license_allocation`, { entitlement_id: ent.id, user_id: w.p.req2.userId });
    await w.p.agent.client.post(`${w.P}/itam/leaver/${w.p.req2.userId}`, { due_date: "2026-12-01" }, 403);
    const r = await w.p.am.client.post(`${w.P}/itam/leaver/${w.p.req2.userId}`, { due_date: "2026-12-01" });
    expect(r).toMatchObject({ assets: 1, allocations: 1 });
    const a = (await w.o.get(`${w.P}/r/asset/${theirs.id}`)).row;
    expect(a.substate).toBe("to_be_returned");
    expect(a.expected_return_at).toBe("2026-12-01");
  });
});
