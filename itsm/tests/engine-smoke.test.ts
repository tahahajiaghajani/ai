import { describe, it, expect } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";

describe("engine smoke", () => {
  it("creates, lists, updates and transitions a todo", async () => {
    const { app } = await makeServer();
    const c = new Client(app);
    const org = await signupWithOrg(c);
    const meta = await c.get(`/o/${org}/meta/tables`);
    expect(meta.tables.map((t: { key: string }) => t.key)).toContain("todo");
    const created = await c.post(`/o/${org}/r/todo`, { short_description: "چاپگر کار نمی‌کند", priority: "2", tags: ["چاپگر", "طبقه ۲"], estimate: "۱٫۵" });
    expect(created.row.number).toBe("TODO0000001");
    expect(created.row.state).toBe("new");
    expect(created.row.estimate).toBe("1.5");
    const list = await c.get(`/o/${org}/r/todo?q=${encodeURIComponent("چاپگر")}`);
    expect(list.total).toBe(1);
    const upd = await c.patch(`/o/${org}/r/todo/${created.row.id}`, { priority: "1", version: created.row.version });
    expect(upd.row.priority).toBe("1");
    await c.patch(`/o/${org}/r/todo/${created.row.id}`, { priority: "3", version: created.row.version }, 409);
    const t = await c.post(`/o/${org}/r/todo/${created.row.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "حل شد" } });
    expect(t.row.state).toBe("resolved");
    expect(t.row.resolved_at).toBeTruthy();
    expect(t.row.active).toBe(false);
    const h = await c.get(`/o/${org}/r/todo/${created.row.id}/history`);
    expect(h.entries.length).toBeGreaterThan(3);
    const agg = await c.post(`/o/${org}/r/todo/agg`, { groupBy: ["state", { field: "created_at", bucket: "month" }] });
    expect(agg.rows.length).toBe(1);
    const j = await c.post(`/o/${org}/r/todo/${created.row.id}/journal`, { body: "سلام" });
    expect(j.entry.kind).toBe("comment");
  });
});
