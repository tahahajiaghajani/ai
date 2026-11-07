// The access provider's hook points: a fake provider that hides some rows (priority 1) and a field (estimate) and
// refuses some operations proves that every read path of the engine — list, get, aggregate, display values of
// references, journal, history, attachments, links, export, meta and the sync pull — and every write path asks it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { access, defaultProvider, setAccessProvider, isSystem, type AccessProvider } from "@server/access/provider";
import { engineOrg, upload, raw, PNG, type EngineOrg } from "./engine-helpers";

const ALL_BUT_ESTIMATE = (names: string[]) => new Set(names.filter((n) => n !== "estimate"));

const fake: AccessProvider = {
  ...defaultProvider,
  name: "fake",
  readWhere(ctx, def, alias, params) {
    const base = defaultProvider.readWhere(ctx, def, alias, params);
    return def.key === "todo" && !isSystem(ctx) ? `(${base}) and ${alias}.priority is distinct from '1'` : base;
  },
  visibleFields: (ctx, def) => (def.key === "todo" && !isSystem(ctx) ? ALL_BUT_ESTIMATE(def.fields.map((f) => f.name)) : null),
  writableFields: (ctx, def) => (def.key === "todo" && !isSystem(ctx) ? new Set(def.fields.map((f) => f.name).filter((n) => n !== "estimate" && n !== "impact")) : null),
  canCreate: (ctx, def, row) => !(def.key === "todo" && row?.short_description === "ممنوع"),
  canWrite: (ctx, def, row) => !(def.key === "todo" && row.priority === "5"),
  canDelete: (ctx, def, row) => def.key !== "todo" || row.priority === "4",
  canTransition: (ctx, def, row, t) => t.to !== "on_hold",
};

describe("every read and write path goes through the access provider", () => {
  let e: EngineOrg;
  let base = "";
  let visible: Record<string, any>;
  let hidden: Record<string, any>;
  let restore: () => void;

  beforeAll(async () => {
    e = await engineOrg();
    base = `/o/${e.org}/r/todo`;
    hidden = (await e.owner.post(base, { short_description: "محرمانه", priority: "1", estimate: 3, tags: ["x"] })).row;
    visible = (await e.owner.post(base, { short_description: "عمومی", priority: "3", estimate: 2, parent_id: hidden.id, tags: ["x"] })).row;
    await e.owner.post(`${base}/${hidden.id}/journal`, { body: "یادداشت محرمانه" });
    await upload(e.app, e.owner, `${base}/${hidden.id}/attachments`, "secret.png", PNG);
    await e.owner.post(`${base}/${visible.id}/links`, { kind: "related", table: "todo", id: hidden.id });
    await e.owner.patch(`${base}/${visible.id}`, { estimate: 5 });
    restore = setAccessProvider(fake);
    expect(access().name).toBe("fake");
  });
  afterAll(() => restore());

  it("lists, counts, searches, sorts and filters only what may be read", async () => {
    const r = await e.owner.get(`${base}?fields=short_description,estimate,parent_id`);
    expect(r.rows.map((x: { id: string }) => x.id)).toEqual([visible.id]);
    expect(r.total).toBe(1);
    expect(r.rows[0]).not.toHaveProperty("estimate");
    // the reference to the hidden record carries no label
    expect(r.rows[0].parent_id).toBe(hidden.id);
    expect(r.display[hidden.id]).toBeUndefined();
    expect((await e.owner.get(`${base}?q=${encodeURIComponent("محرمانه")}`)).total).toBe(0);
    expect((await e.owner.get(`${base}?q=${hidden.number}`)).total).toBe(0);
    expect((await e.owner.get(`${base}?filter=${encodeURIComponent('{"f":"estimate","op":"gt","v":0}')}`, 400)).error.message).toMatch(/در دسترس شما نیست/);
    await e.owner.get(`${base}?sort=estimate`, 400);
    await e.owner.get(`${base}?fields=estimate`).then((x: { rows: Record<string, unknown>[] }) => expect(x.rows[0]).not.toHaveProperty("estimate"));
    // a dot-walk into the hidden record reads nothing
    const walk = await e.owner.get(`${base}?fields=parent_id.short_description`);
    expect(walk.rows[0]["parent_id.short_description"]).toBeNull();
  });

  it("gets, aggregates and exports only what may be read", async () => {
    await e.owner.get(`${base}/${hidden.id}`, 404);
    const got = await e.owner.get(`${base}/${visible.id}`);
    expect(got.row).not.toHaveProperty("estimate");
    expect(got.display[hidden.id]).toBeUndefined();
    const agg = await e.owner.post(`${base}/agg`, { groupBy: ["priority"] });
    expect(agg.rows.map((x: { keys: string[] }) => x.keys[0])).toEqual(["3"]);
    expect(agg.totals.count).toBe(1);
    await e.owner.post(`${base}/agg`, { groupBy: ["estimate"] }, 400);
    await e.owner.post(`${base}/agg`, { metrics: [{ fn: "sum", field: "estimate" }] }, 400);
    const ex = await e.owner.get(`${base}/export?fields=short_description,estimate`);
    expect(ex.columns.map((c: { name: string }) => c.name)).toEqual(["number", "short_description"]);
    expect(ex.rows).toEqual([[visible.number, "عمومی"]]);
    const meta = await e.owner.get(`/o/${e.org}/meta/tables/todo`);
    expect(meta.table.fields.map((f: { name: string }) => f.name)).not.toContain("estimate");
  });

  it("guards the journal, history, attachments and links of hidden records", async () => {
    await e.owner.get(`${base}/${hidden.id}/journal`, 404);
    await e.owner.post(`${base}/${hidden.id}/journal`, { body: "x" }, 404);
    await e.owner.get(`${base}/${hidden.id}/history`, 404);
    await e.owner.get(`${base}/${hidden.id}/attachments`, 404);
    await e.owner.get(`${base}/${hidden.id}/links`, 404);
    await e.owner.post(`${base}/${hidden.id}/watch`, {}, 404);
    const att = await e.db.one<{ id: string }>(`select id from sm_attachments where record_id = $1`, [hidden.id]);
    expect((await raw(e.app, e.owner, `/o/${e.org}/attachments/${att!.id}/content`)).status).toBe(404);
    // the visible record's history leaves out the hidden field; its links leave out the hidden record
    const h = await e.owner.get(`${base}/${visible.id}/history`);
    expect(h.entries.map((x: { field: string }) => x.field)).not.toContain("estimate");
    expect(h.entries.length).toBeGreaterThan(0);
    expect((await e.owner.get(`${base}/${visible.id}/links`)).links).toEqual([]);
    await e.owner.post(`${base}/${visible.id}/links`, { kind: "blocks", table: "todo", id: hidden.id }, 404);
  });

  it("sends the sync pull only readable rows and fields, tombstones for the rest", async () => {
    const pull = await e.owner.get(`/sync/pull?org_id=${e.org}&cursor=0&user_cursor=0`);
    const ids = (entity: string) => pull.aggregates.filter((a: { entity: string }) => a.entity === entity).map((a: { id: string }) => a.id);
    expect(ids("todo")).toEqual([visible.id]);
    const sent = pull.aggregates.find((a: { id: string }) => a.id === visible.id);
    expect(sent.row).not.toHaveProperty("estimate");
    const tomb = (entity: string) => pull.tombstones.filter((t: { entity: string }) => t.entity === entity).length;
    expect(pull.tombstones).toContainEqual({ entity: "todo", id: hidden.id });
    expect(tomb("journal")).toBe(1);
    expect(tomb("attachment")).toBe(1);
    expect(tomb("link")).toBe(1);
    expect(ids("history").length).toBeGreaterThan(0);
    // history rows of the hidden field are not sent either
    const fields = pull.aggregates.filter((a: { entity: string }) => a.entity === "history").map((a: { row: { field: string } }) => a.row.field);
    expect(fields).not.toContain("estimate");
    expect(typeof pull.epoch).toBe("number");
  });

  it("asks it before every write", async () => {
    await e.owner.post(base, { short_description: "ممنوع" }, 403);
    await e.owner.patch(`${base}/${hidden.id}`, { priority: "2" }, 404);
    // fields outside writableFields: refused when changed, accepted when sent back unchanged
    const f = await e.owner.patch(`${base}/${visible.id}`, { impact: "1" }, 403);
    expect(f.error).toMatchObject({ code: "forbidden_field", details: { fields: { impact: "اجازهٔ تغییر «اثر» را ندارید" } } });
    await e.owner.patch(`${base}/${visible.id}`, { impact: visible.impact, urgency: "2" });
    await e.owner.patch(`${base}/${visible.id}`, { estimate: 9 }, 403);
    // canTransition: on_hold is never offered nor taken
    const got = await e.owner.get(`${base}/${visible.id}`);
    expect(got.meta.transitions.map((t: { to: string }) => t.to)).toEqual(["in_progress", "resolved", "canceled"]);
    expect(got.meta.readonly).toEqual(expect.arrayContaining(["impact"]));
    await e.owner.post(`${base}/${visible.id}/transition`, { to: "on_hold" }, 403);
    // canWrite / canDelete
    await e.owner.patch(`${base}/${visible.id}`, { priority: "5" });
    await e.owner.patch(`${base}/${visible.id}`, { priority: "4" }, 403);
    expect((await e.owner.get(`${base}/${visible.id}`)).meta).toMatchObject({ canWrite: false, canDelete: false, transitions: [] });
    await e.owner.del(`${base}/${visible.id}`, 403);
  });
});
