// Link events and links inside a module's transaction (docs/spec/ENGINE.md § Journal, history, watchers, links):
// adding and removing a link emits `record.linked` / `record.unlinked` on both records (direction, kind, the other
// record), `addLinkIn` commits or rolls back with the caller's write, and a rolled-back link leaves no event.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, outbox, type EngineOrg } from "./engine-helpers";
import { addLinkIn, createIn } from "@server/engine";

describe("link events", () => {
  let e: EngineOrg;
  let base = "";
  const todo = async (title: string) => (await e.owner.post(base, { short_description: title })).row;
  const linkEvents = async (kind: string, id: string) => (await outbox(e.db, e.org, kind)).filter((j) => j.payload.id === id).map((j) => j.payload.data);

  beforeAll(async () => {
    e = await engineOrg();
    base = `/o/${e.org}/r/todo`;
  });

  it("adding and removing a link tells both records", async () => {
    const a = await todo("کار اصلی");
    const b = await todo("کار وابسته");
    const link = (await e.owner.post(`${base}/${a.id}/links`, { kind: "caused_by", table: "todo", id: b.id })).link;
    expect(await linkEvents("record.linked", a.id)).toEqual([{ link_id: link.id, kind: "caused_by", direction: "out", other_table: "todo", other_id: b.id }]);
    expect(await linkEvents("record.linked", b.id)).toEqual([{ link_id: link.id, kind: "caused_by", direction: "in", other_table: "todo", other_id: a.id }]);
    await e.owner.del(`${base}/${b.id}/links/${link.id}`);
    expect((await linkEvents("record.unlinked", a.id)).map((d) => d.direction)).toEqual(["out"]);
    expect((await linkEvents("record.unlinked", b.id)).map((d) => d.direction)).toEqual(["in"]);
  });

  it("addLinkIn links inside the caller's write: together with the record it creates, or not at all", async () => {
    const source = await todo("منبع");
    const ctx = await e.ctxOf(e.ownerId);
    const made = await ctx.write(async (tx) => {
      const row = await createIn(tx, ctx, "todo", { short_description: "ساخته از منبع" });
      await addLinkIn(tx, ctx, "todo", String(row.id), { kind: "initiated_by", table: "todo", id: source.id });
      return row;
    });
    const links = (await e.owner.get(`${base}/${made.id}/links`)).links as { kind: string; other: { id: string } }[];
    expect(links.map((l) => [l.kind, l.other.id])).toEqual([["initiated_by", source.id]]);
    // rolled back with the write: no link, no event
    let ghost = "";
    await expect(ctx.write(async (tx) => {
      const row = await createIn(tx, ctx, "todo", { short_description: "ناتمام" });
      ghost = String(row.id);
      await addLinkIn(tx, ctx, "todo", ghost, { kind: "related", table: "todo", id: source.id });
      throw new Error("rolled back");
    })).rejects.toThrow("rolled back");
    expect(await e.db.query(`select 1 from sm_links where from_id = $1`, [ghost])).toEqual([]);
    expect(await linkEvents("record.linked", ghost)).toEqual([]);
    // the same checks as the API: no duplicates
    await expect(ctx.write((tx) => addLinkIn(tx, ctx, "todo", String(made.id), { kind: "initiated_by", table: "todo", id: source.id }))).rejects.toThrow("از پیش وجود دارد");
  });
});
