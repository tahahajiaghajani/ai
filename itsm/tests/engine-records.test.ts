// The record service through the HTTP API on the generic «کار» table (todo, extends task): creating with defaults,
// numbers and task stamps; validation with Persian messages per field; optimistic concurrency; gapless numbers under
// concurrent creates; the state model and its side effects; history; events in the outbox; lists (filters, search,
// sort, columns, dot-walks, saved views); aggregates with Jalali buckets; bulk changes; export and import; tenant
// custom fields and choice lists.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, outbox, type EngineOrg } from "./engine-helpers";
import { createIn } from "@server/engine/write";
import { tick } from "@server/jobs";
import { onRecordEvent, type RecordEvent } from "@server/engine/events";

describe("record service", () => {
  let e: EngineOrg;
  let base = "";

  beforeAll(async () => {
    e = await engineOrg();
    base = `/o/${e.org}/r/todo`;
  });

  it("creates a record with its number, defaults and task stamps", async () => {
    const r = await e.owner.post(base, { short_description: "  چاپگر طبقهٔ دوم کار نمی‌کند  ", estimate: "۱٫۵", tags: "چاپگر، طبقه ۲", due_at: "1405/02/01 10:30" });
    expect(r.row).toMatchObject({
      number: "TODO0000001",
      version: 1,
      short_description: "چاپگر طبقهٔ دوم کار نمی‌کند",
      state: "new",
      priority: "4",
      channel: "portal",
      caller_id: e.ownerId,
      opened_by: e.ownerId,
      created_by: e.ownerId,
      active: true,
      estimate: "1.5",
      tags: ["چاپگر", "طبقه ۲"],
      reassignment_count: 0,
      watch_list: [],
    });
    expect(r.row.opened_at).toBeTruthy();
    // 1405/02/01 10:30 in Tehran
    expect(r.row.due_at).toBe("2026-04-21T07:00:00.000Z");
    expect(r.display[e.ownerId]).toBe("مالک آزمایشی");
    expect(r.meta).toMatchObject({ canWrite: true, canDelete: true, locked: false });
    expect(r.meta.transitions.map((t: { to: string }) => t.to)).toEqual(["in_progress", "on_hold", "resolved", "canceled"]);
    expect(r.meta.readonly).toEqual(expect.arrayContaining(["number", "opened_at", "state", "approval", "created_by"]));
  });

  it("refuses invalid input with a Persian message per field", async () => {
    const bad = await e.owner.post(base, { priority: "9", estimate: "-1", due_at: "فردا صبح", caller_id: "00000000-0000-7000-8000-000000000000", nope: 1 }, 400);
    expect(bad.error.code).toBe("validation");
    expect(bad.error.details.fields).toEqual({
      priority: "«9» از گزینه‌های «اولویت» نیست",
      estimate: "«برآورد (ساعت)» نباید کمتر از ۰ باشد",
      due_at: "«موعد» زمان معتبر نیست",
      nope: "فیلد «nope» در «کار» وجود ندارد",
    });
    const missing = await e.owner.post(base, { priority: "2" }, 400);
    expect(missing.error.details.fields).toEqual({ short_description: "«عنوان» را وارد کنید" });
    const nobody = await e.owner.post(base, { short_description: "x", caller_id: "00000000-0000-7000-8000-000000000000" }, 400);
    expect(nobody.error.details.fields).toEqual({ caller_id: "«درخواست‌دهنده» پیدا نشد" });
    const long = await e.owner.post(base, { short_description: "ب".repeat(201) }, 400);
    expect(long.error.message).toBe("«عنوان» حداکثر ۲۰۰ نویسه است");
    // engine-maintained values are ignored, not refused (a whole row can be sent back)
    const ok = await e.owner.post(base, { short_description: "x", number: "TODO9999999", opened_at: "2020-01-01", resolved_at: "2020-01-01", version: 7 });
    expect(ok.row.number).not.toBe("TODO9999999");
    expect(ok.row.resolved_at).toBeNull();
    expect(ok.row.version).toBe(1);
  });

  it("keeps changes apart with optimistic concurrency (version)", async () => {
    const { row } = await e.owner.post(base, { short_description: "نسخه" });
    const a = await e.owner.patch(`${base}/${row.id}`, { priority: "2", version: 1 });
    expect(a.row.version).toBe(2);
    const stale = await e.owner.patch(`${base}/${row.id}`, { priority: "3", version: 1 }, 409);
    expect(stale.error).toMatchObject({ code: "version_conflict", details: { version: 2 } });
    expect(stale.error.message).toMatch(/کس دیگری/);
    // nothing changed: no new version
    const same = await e.owner.patch(`${base}/${row.id}`, { priority: "2" });
    expect(same.row.version).toBe(2);
    // without a version the last writer wins
    expect((await e.owner.patch(`${base}/${row.id}`, { priority: "1" })).row.version).toBe(3);
  });

  it("hands out numbers without gaps or duplicates under concurrent creates", async () => {
    const before = (await e.owner.get(`${base}?size=1&sort=-number`)).rows[0].number as string;
    const start = Number(before.slice(4));
    const made = await Promise.all(Array.from({ length: 12 }, (_, i) => e.owner.post(base, { short_description: `هم‌زمان ${i}` })));
    const numbers = made.map((m) => Number(m.row.number.slice(4))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 12 }, (_, i) => start + 1 + i));
    // directly inside one transaction too, and a rolled-back create gives its number back
    const ctx = await e.ctxOf(e.ownerId);
    await ctx.write(async (tx) => {
      await createIn(tx, ctx, "todo", { short_description: "در تراکنش" });
      throw new Error("rollback");
    }).catch(() => undefined);
    const next = await e.owner.post(base, { short_description: "پس از بازگشت" });
    expect(Number(next.row.number.slice(4))).toBe(start + 13);
  });

  it("enforces the state model and applies the category side effects", async () => {
    const { row } = await e.owner.post(base, { short_description: "گردش کار", assigned_to: e.ownerId });
    const url = `${base}/${row.id}`;
    const nope = await e.owner.post(`${url}/transition`, { to: "closed" }, 409);
    expect(nope.error.message).toBe("انتقال از «جدید» به «بسته» مجاز نیست");
    const req = await e.owner.post(`${url}/transition`, { to: "resolved" }, 400);
    expect(Object.keys(req.error.details.fields).sort()).toEqual(["close_code", "close_notes"]);
    expect(req.error.details.fields.close_code).toBe("برای «حل شد»، «نتیجهٔ بستن» را وارد کنید");
    const resolved = await e.owner.post(`${url}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "راه‌اندازی دوباره" } });
    expect(resolved.row).toMatchObject({ state: "resolved", active: false, resolved_by: e.ownerId, close_code: "solved" });
    expect(resolved.row.resolved_at).toBeTruthy();
    // a state change in an update is a transition too
    const reopened = await e.owner.patch(url, { state: "in_progress" });
    expect(reopened.row).toMatchObject({ state: "in_progress", active: true, reopen_count: 1, resolved_at: null, resolved_by: null });
    await e.owner.patch(url, { state: "closed" }, 409);
    await e.owner.post(`${url}/transition`, { to: "resolved", data: { close_code: "workaround", close_notes: "موقت" } });
    const closed = await e.owner.post(`${url}/transition`, { to: "closed" });
    expect(closed.row).toMatchObject({ state: "closed", active: false, closed_by: e.ownerId });
    expect(closed.meta).toMatchObject({ locked: true, canWrite: false, transitions: [] });
    const locked = await e.owner.patch(url, { priority: "1" }, 409);
    expect(locked.error.code).toBe("locked");
    // the activity: field history of every step
    const h = await e.owner.get(`${url}/history`);
    const states = h.entries.filter((x: { field: string }) => x.field === "state").map((x: { old: string; new: string }) => `${x.old ?? ""}→${x.new}`);
    expect(states).toEqual(["→new", "new→resolved", "resolved→in_progress", "in_progress→resolved", "resolved→closed"]);
    expect(h.entries.find((x: { field: string }) => x.field === "reopen_count")).toMatchObject({ old: 0, new: 1, label: "دفعات بازگشایی" });
    expect(h.display[e.ownerId]).toBe("مالک آزمایشی");
  });

  it("counts reassignments", async () => {
    const m = await e.member("member");
    const { row } = await e.owner.post(base, { short_description: "ارجاع" });
    const a = await e.owner.patch(`${base}/${row.id}`, { assigned_to: e.ownerId });
    expect(a.row.reassignment_count).toBe(0);
    const b = await e.owner.patch(`${base}/${row.id}`, { assigned_to: m.userId });
    expect(b.row.reassignment_count).toBe(1);
  });

  it("writes events into the outbox in the same transaction and delivers them to subscribers", async () => {
    const seen: RecordEvent[] = [];
    const off = onRecordEvent("test-collector", (ev) => {
      if (ev.table === "todo") seen.push(ev);
    });
    const { row } = await e.owner.post(base, { short_description: "رویداد", assigned_to: e.ownerId });
    await e.owner.patch(`${base}/${row.id}`, { priority: "2", short_description: "رویداد تازه" });
    await e.owner.post(`${base}/${row.id}/transition`, { to: "in_progress" });
    await e.owner.post(`${base}/${row.id}/journal`, { body: "پاسخ" });
    const kinds = (await outbox(e.db, e.org)).filter((j) => j.payload.id === row.id).map((j) => j.kind);
    expect(kinds).toEqual(["record.created", "record.assigned", "record.updated", "record.updated", "record.state_changed", "record.commented"]);
    const updated = (await outbox(e.db, e.org, "record.updated")).find((j) => j.payload.id === row.id)!;
    expect(updated.payload.changed.sort()).toEqual(["priority", "short_description"]);
    expect(updated.payload.changes.priority).toEqual({ from: "4", to: "2" });
    expect(updated.payload).toMatchObject({ table: "todo", number: row.number, actor: e.ownerId, via: "api" });
    const r = await tick(e.cfg, { budgetMs: 5000 });
    expect(r.failed).toBe(0);
    off();
    expect(seen.filter((x) => x.id === row.id).map((x) => x.kind)).toEqual(kinds);
    expect(seen.find((x) => x.kind === "record.state_changed" && x.id === row.id)).toMatchObject({ from: "new", to: "in_progress", from_category: "new", to_category: "active" });
    expect((await outbox(e.db, e.org)).filter((j) => j.payload.id === row.id).every((j) => j.status === "done")).toBe(true);
  });

  it("lists with filters, search, sort, columns, dot-walks, ids and paging", async () => {
    const m = await e.member("member", "lister@example.com");
    for (const [i, p] of ["1", "2", "3"].entries()) await e.owner.post(base, { short_description: `فهرست ${i} سرور`, priority: p, assigned_to: i === 0 ? m.userId : null });
    const filter = { and: [{ f: "short_description", op: "contains", v: "فهرست" }, { f: "priority", op: "in", v: ["1", "2"] }] };
    const r = await e.owner.post(`${base}/query`, { filter, sort: "priority", fields: ["number", "short_description", "priority", "assigned_to", "assigned_to.email"], size: 1 });
    expect(r.total).toBe(2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ priority: "1", assigned_to: m.userId, "assigned_to.email": "lister@example.com" });
    expect(Object.keys(r.rows[0]).sort()).toEqual(["assigned_to", "assigned_to.email", "id", "number", "priority", "short_description", "state", "version"]);
    expect(r.display[m.userId]).toMatch(/همکار/);
    const page2 = await e.owner.post(`${base}/query`, { filter, sort: "priority", size: 1, page: 2 });
    expect(page2.rows[0].priority).toBe("2");
    const q = await e.owner.get(`${base}?q=${encodeURIComponent("فهرست سرور")}&fields=number`);
    expect(q.total).toBe(3);
    const byNumber = await e.owner.get(`${base}?q=${q.rows[0].number}`);
    expect(byNumber.rows.map((x: { id: string }) => x.id)).toEqual([q.rows[0].id]);
    const ids = await e.owner.get(`${base}?ids=${q.rows[0].id}`);
    expect(ids.total).toBe(1);
    const urlFilter = await e.owner.get(`${base}?filter=${encodeURIComponent(JSON.stringify({ f: "assigned_to", op: "eq", v: m.userId }))}`);
    expect(urlFilter.total).toBe(1);
    expect((await e.owner.get(`${base}?filter=${encodeURIComponent('{"f":"secret_thing","op":"eq","v":1}')}`, 400)).error.message).toMatch(/وجود ندارد/);
    expect((await e.owner.get(`${base}?sort=description`, 400)).error.message).toMatch(/مرتب نمی‌شود/);
    // the members directory (virtual user table) for pickers
    const users = await e.owner.get(`/o/${e.org}/r/user?q=lister`);
    expect(users.rows).toEqual([expect.objectContaining({ id: m.userId, email: "lister@example.com", role: "member" })]);
  });

  it("applies saved views (personal unless shared)", async () => {
    const m = await e.member("member");
    const view = await e.owner.post(`/o/${e.org}/r/view`, { table_key: "todo", name: "فوری‌ها", filter: { f: "priority", op: "eq", v: "1" }, columns: ["number", "priority"], sort: "-number" });
    expect(view.row.owner_id).toBe(e.ownerId);
    const r = await e.owner.get(`${base}?view=${view.row.id}`);
    expect(r.rows.every((x: { priority: string }) => x.priority === "1")).toBe(true);
    expect(Object.keys(r.rows[0]).sort()).toEqual(["id", "number", "priority", "state", "version"]);
    // someone else's private view does not exist for them; a shared one does
    await m.client.get(`${base}?view=${view.row.id}`, 400);
    expect((await m.client.get(`/o/${e.org}/r/view`)).total).toBe(0);
    await m.client.patch(`/o/${e.org}/r/view/${view.row.id}`, { name: "x" }, 404);
    await e.owner.patch(`/o/${e.org}/r/view/${view.row.id}`, { shared: true });
    expect((await m.client.get(`/o/${e.org}/r/view`)).total).toBe(1);
    await m.client.patch(`/o/${e.org}/r/view/${view.row.id}`, { name: "x" }, 403);
    // a view's filter must be valid for its table
    const bad = await e.owner.post(`/o/${e.org}/r/view`, { table_key: "todo", name: "خراب", filter: { f: "nope", op: "eq", v: 1 } }, 400);
    expect(bad.error.details.fields.filter).toMatch(/وجود ندارد/);
  });

  it("aggregates in SQL with Jalali month buckets, array groups and metrics", async () => {
    const e2 = await engineOrg();
    const url = `/o/${e2.org}/r/todo`;
    const mk = (due: string, estimate: string, tags: string[], priority = "3") => e2.owner.post(url, { short_description: "آمار", due_at: due, estimate, tags, priority });
    await mk("1405/01/01 08:00", "1", ["a"]); // فروردین
    await mk("1405/01/31 23:00", "3", ["a", "b"]); // فروردین (late in the evening, Tehran)
    await mk("1405/02/01 00:30", "5", ["b"]); // اردیبهشت (just after midnight)
    await mk("1405/04/10", "7", [], "1"); // تیر
    const r = await e2.owner.post(`${url}/agg`, {
      groupBy: [{ field: "due_at", bucket: "month" }],
      metrics: [{ fn: "count" }, { fn: "sum", field: "estimate" }, { fn: "avg", field: "estimate" }, { fn: "max", field: "estimate" }, { fn: "median", field: "estimate" }],
    });
    expect(r.groups).toEqual([{ field: "due_at", label: "موعد", bucket: "month" }]);
    expect(r.rows.map((x: { keys: string[]; labels: string[]; values: Record<string, unknown> }) => [x.keys[0], x.labels[0], x.values.count, x.values["sum:estimate"]])).toEqual([
      ["1405-01", "فروردین ۱۴۰۵", 2, "4"],
      ["1405-02", "اردیبهشت ۱۴۰۵", 1, "5"],
      ["1405-04", "تیر ۱۴۰۵", 1, "7"],
    ]);
    expect(r.rows[0].values["avg:estimate"]).toBe("2.000000");
    expect(r.totals).toMatchObject({ count: 4, "sum:estimate": "16", "max:estimate": "7", "median:estimate": "4" });
    const quarter = await e2.owner.post(`${url}/agg`, { groupBy: [{ field: "due_at", bucket: "quarter" }] });
    expect(quarter.rows.map((x: { labels: string[] }) => x.labels[0])).toEqual(["بهار ۱۴۰۵", "تابستان ۱۴۰۵"]);
    const tags = await e2.owner.post(`${url}/agg`, { groupBy: ["tags"] });
    expect(tags.rows.map((x: { keys: unknown[]; values: { count: number } }) => [x.keys[0], x.values.count])).toEqual([["a", 2], ["b", 2], [null, 1]]);
    expect(tags.totals.count).toBe(4);
    const prio = await e2.owner.post(`${url}/agg`, { groupBy: ["priority", "caller_id"], filter: { f: "estimate", op: "gt", v: 1 } });
    expect(prio.rows[0]).toMatchObject({ keys: ["3", e2.ownerId], labels: ["۳ — متوسط", "مالک آزمایشی"], values: { count: 2 } });
    await e2.owner.post(`${url}/agg`, { groupBy: ["description"] }, 400);
    await e2.owner.post(`${url}/agg`, { metrics: [{ fn: "sum", field: "short_description" }] }, 400);
  });

  it("applies one change to many records, each on its own", async () => {
    const a = (await e.owner.post(base, { short_description: "گروهی ۱" })).row;
    const b = (await e.owner.post(base, { short_description: "گروهی ۲" })).row;
    const c = (await e.owner.post(base, { short_description: "گروهی ۳" })).row;
    await e.owner.post(`${base}/${c.id}/transition`, { to: "canceled", data: { close_notes: "لغو" } });
    const r = await e.owner.post(`${base}/bulk`, { ids: [a.id, b.id, c.id], data: { priority: "2" } });
    expect(r.updated).toBe(2);
    expect(r.failed).toEqual([{ id: c.id, message: expect.stringMatching(/بسته شده/) }]);
    const t = await e.owner.post(`${base}/bulk`, { filter: { f: "short_description", op: "starts", v: "گروهی" }, transition: "in_progress" });
    expect(t.updated).toBe(2);
    expect((await e.owner.get(`${base}/${a.id}`)).row.state).toBe("in_progress");
    const d = await e.owner.post(`${base}/bulk`, { ids: [a.id], delete: true });
    expect(d.updated).toBe(1);
    await e.owner.get(`${base}/${a.id}`, 404);
  });

  it("exports rows for a spreadsheet and imports them back (dry run, errors per row, update by number)", async () => {
    const e3 = await engineOrg();
    const url = `/o/${e3.org}/r/todo`;
    const m = await e3.member("member", "importer@example.com");
    await e3.owner.post(url, { short_description: "صادر ۱", priority: "2", assigned_to: m.userId, tags: ["x", "y"] });
    const ex = await e3.owner.get(`${url}/export?fields=short_description,priority,assigned_to,tags,estimate,active`);
    expect(ex.columns.map((c: { name: string }) => c.name)).toEqual(["number", "short_description", "priority", "assigned_to", "tags", "estimate", "active"]);
    expect(ex.rows).toEqual([["TODO0000001", "صادر ۱", "۲ — زیاد", expect.stringMatching(/^همکار/), "x، y", null, "بله"]]);
    const rows = [
      { "عنوان": "وارد ۱", "اولویت": "۱ — بحرانی", "کارشناس": "importer@example.com", "برچسب‌ها": "الف، ب", "موعد": "1405/03/01" },
      { "عنوان": "", "اولویت": "زیاد" },
      { "عنوان": "وارد ۳", "اولویت": "3", "برآورد (ساعت)": "abc" },
    ];
    const dry = await e3.owner.post(`${url}/import`, { rows, dry_run: true });
    expect(dry).toMatchObject({ created: 1, updated: 0, dryRun: true });
    expect(dry.errors).toEqual([
      { row: 1, field: "priority", message: "«زیاد» از گزینه‌های «اولویت» نیست" },
      { row: 2, field: "estimate", message: "«برآورد (ساعت)» باید عدد باشد" },
    ]);
    expect((await e3.owner.get(url)).total).toBe(1);
    const done = await e3.owner.post(`${url}/import`, { rows: [rows[0]] });
    expect(done.created).toBe(1);
    const imported = (await e3.owner.get(`${url}?q=${encodeURIComponent("وارد")}&fields=short_description,priority,assigned_to,tags,due_at`)).rows[0];
    expect(imported).toMatchObject({ priority: "1", assigned_to: m.userId, tags: ["الف", "ب"], due_at: "2026-05-21T20:30:00.000Z" });
    const upd = await e3.owner.post(`${url}/import`, { rows: [{ number: imported.number, "اولویت": "2" }], key: "number" });
    expect(upd).toMatchObject({ created: 0, updated: 1, errors: [] });
    expect((await e3.owner.get(`${url}/${imported.id}`)).row.priority).toBe("2");
  });

  it("serves tenant custom fields and choice lists everywhere", async () => {
    const e4 = await engineOrg();
    const url = `/o/${e4.org}/r/todo`;
    await e4.owner.post(`/o/${e4.org}/r/custom_field`, { table_key: "todo", name: "u_cost", label: "هزینه", type: "money", list: true });
    await e4.owner.post(`/o/${e4.org}/r/custom_field`, { table_key: "todo", name: "estimate", label: "تخمین ساعت", required: true });
    await e4.owner.post(`/o/${e4.org}/r/choice`, { list: "todo.category", value: "hardware", label: "سخت‌افزار", sort_order: 0 });
    await e4.owner.post(`/o/${e4.org}/r/choice`, { list: "todo.category", value: "meeting", label: "جلسه", active: false });
    const meta = await e4.owner.get(`/o/${e4.org}/meta/tables/todo`);
    expect(meta.table.fields.find((f: { name: string }) => f.name === "u_cost")).toMatchObject({ label: "هزینه", type: "money", custom: true });
    expect(meta.table.fields.find((f: { name: string }) => f.name === "estimate")).toMatchObject({ label: "تخمین ساعت", required: true });
    expect(meta.choices["todo.category"].map((o: { value: string }) => o.value)).toEqual(["hardware", "general", "followup", "meeting", "report"]);
    expect(meta.table.can).toEqual({ read: true, create: true });
    const miss = await e4.owner.post(url, { short_description: "سفارشی" }, 400);
    expect(miss.error.details.fields).toEqual({ estimate: "«تخمین ساعت» را وارد کنید" });
    const r = await e4.owner.post(url, { short_description: "سفارشی", estimate: 2, u_cost: "۱۲۰٬۰۰۰", category: "hardware" });
    expect(r.row).toMatchObject({ u_cost: "120000", category: "hardware" });
    await e4.owner.post(url, { short_description: "غیرفعال", estimate: 1, category: "meeting" }, 400);
    const stored = await e4.db.one<{ custom: Record<string, unknown> }>(`select custom from sm_todos where id = $1`, [r.row.id]);
    expect(stored!.custom).toEqual({ u_cost: "120000" });
    const filtered = await e4.owner.post(`${url}/query`, { filter: { f: "u_cost", op: "gt", v: 100000 }, sort: "-u_cost", fields: ["u_cost"] });
    expect(filtered.rows.map((x: { u_cost: string }) => x.u_cost)).toEqual(["120000"]);
    const changed = await e4.owner.patch(`${url}/${r.row.id}`, { u_cost: null });
    expect(changed.row.u_cost).toBeNull();
    const h = await e4.owner.get(`${url}/${r.row.id}/history`);
    expect(h.entries.filter((x: { field: string }) => x.field === "u_cost").map((x: { old: unknown; new: unknown }) => [x.old, x.new])).toEqual([[null, "120000"], ["120000", null]]);
    // only settings managers define fields
    const viewer = await e4.member("member");
    await viewer.client.post(`/o/${e4.org}/r/custom_field`, { table_key: "todo", name: "u_x", label: "x", type: "string" }, 403);
  });
});
