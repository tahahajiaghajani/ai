// Service requests — review findings (need-to-know desk): tasks only from people who work the item; the revocation of
// time-bound access outlives the item; secret answers without a hint; the item's requester side followed by its
// facts, tasks and order; an agent's own order under the requester's rules; answers fixed once an approver decided;
// the generic API without the desk's fields; record producers without secrets; the quantity fixed after ordering; the
// cart's details cleared by checkout; the page's «بازخورد» and «سفارش دوباره» for whom the server allows them.
import { describe, it, expect, beforeAll } from "vitest";
import { systemCtx } from "@server/engine";
import { sweep } from "@server/modules/request";
import { producedValues } from "@server/modules/request/fulfil";
import type { FormSchema } from "@shared/request/form";
import { requestKit, type RequestKit, type Who } from "./request-helpers";

describe("service requests: review findings", () => {
  let k: RequestKit;
  let P = "";
  let manager: Who;
  let requester: Who;
  let stranger: Who;
  let colleague: Who;
  let desk: Who; // «پشتیبانی کاربران»
  let network: Who; // «شبکه و زیرساخت»
  let security: Who; // «هویت و دسترسی»
  let auditor: Who;
  let secretItem = "";

  const order = (who: Who, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) => who.client.post(`${P}/request/order`, { lines, ...extra });
  const approve = async (who: Who, recordId: string) => {
    const a = ((await who.client.get(`${P}/approvals/mine`)).approvals as { id: string; record_id: string }[]).find((x) => x.record_id === recordId);
    expect(a, "an approval waits for this person").toBeTruthy();
    await who.client.post(`${P}/approvals/${a!.id}/decide`, { decision: "approved" });
  };
  const tasksOf = (ritm: string) => k.rows("request_task", "request_item_id = $2", [ritm]);

  beforeAll(async () => {
    k = await requestKit();
    P = k.P;
    await k.o.owner.put(`${P}/access/settings`, { preset: "need_to_know" });
    manager = await k.person("g-manager@example.com", { roles: ["agent"] });
    requester = await k.person("g-req@example.com", { roles: ["requester"], manager: manager.userId });
    stranger = await k.person("g-stranger@example.com", { roles: ["requester"] });
    colleague = await k.person("g-colleague@example.com", { roles: ["requester"], manager: manager.userId });
    desk = await k.person("g-desk@example.com", { roles: ["agent"] });
    network = await k.person("g-net@example.com", { roles: ["agent"] });
    security = await k.person("g-sec@example.com", { roles: ["agent"] });
    auditor = await k.person("g-auditor@example.com", { roles: ["auditor"] });
    await k.addToGroup(await k.group("پشتیبانی کاربران"), [desk.userId]);
    await k.addToGroup(await k.group("شبکه و زیرساخت"), [network.userId]);
    await k.addToGroup(await k.group("هویت و دسترسی"), [security.userId]);
    const cat = (await k.rows("catalog", "name = $2", ["فناوری اطلاعات"]))[0];
    const it = await k.o.owner.post(`${P}/r/catalog_item`, { name: "حساب محرمانه", code: "secret_account", type: "standard", catalog_id: cat.id, requires_confirmation: false });
    await k.o.owner.post(`${P}/r/catalog_variable`, { item_id: it.row.id, name: "purpose", label: "کاربرد", type: "string" });
    await k.o.owner.post(`${P}/r/catalog_variable`, { item_id: it.row.id, name: "pin", label: "رمز اولیه", type: "secret" });
    await k.o.owner.post(`${P}/request/builder/${it.row.id}/publish`, {});
    secretItem = it.row.id;
  }, 120_000);

  it("only people who work an item add tasks to it; a task does not move to another item", async () => {
    const r = await order(requester, [{ item_id: secretItem, answers: { purpose: "پروژهٔ محرمانه", pin: "Hunter2024" } }]);
    const id = r.items[0].id;
    await stranger.client.get(`${P}/r/request_item/${id}`, 404);
    // someone who may order cannot attach a task to another's item — it answers like an unknown item
    const hidden = await stranger.client.post(`${P}/r/request_task`, { request_item_id: id, short_description: "x", assigned_to: stranger.userId }, 400);
    const unknown = await stranger.client.post(`${P}/r/request_task`, { request_item_id: "0aaaaaaa-0000-4000-8000-000000000000", short_description: "x" }, 400);
    expect(hidden.error.details.fields.request_item_id).toBe(unknown.error.details.fields.request_item_id);
    await stranger.client.get(`${P}/r/request_item/${id}`, 404);
    await stranger.client.post(`${P}/request/items/${id}/reveal`, { name: "pin" }, 404);
    // the requester on their own item: still a requester, not a fulfiller
    await requester.client.post(`${P}/r/request_task`, { request_item_id: id, short_description: "کار من", assigned_to: requester.userId }, 403);
    expect((await requester.client.get(`${P}/r/request_item/${id}`)).meta.request.can_work).toBe(false);
    await requester.client.patch(`${P}/r/request_item/${id}`, { priority: "1" }, 403);
    // the fulfilment group's agent may, and the task stays with its item
    const task = (await desk.client.post(`${P}/r/request_task`, { request_item_id: id, short_description: "ساخت حساب" })).row;
    const mine = (await order(requester, [{ item_id: secretItem, answers: { purpose: "دیگر", pin: "Zx81" } }])).items[0].id;
    const moved = await desk.client.patch(`${P}/r/request_task/${task.id}`, { request_item_id: mine, version: task.version }, 400);
    expect(moved.error.details.fields.request_item_id).toBeTruthy();
    expect(((await tasksOf(id)).length)).toBe(1);
    expect((await k.ritm(id)).fulfillers ?? []).not.toContain(stranger.userId);
  });

  it("a secret answer shows no hint of its value", async () => {
    const r = await order(requester, [{ item_id: secretItem, answers: { purpose: "پین کوتاه", pin: "Zx81" } }]);
    const id = r.items[0].id;
    for (const who of [requester, manager, desk]) {
      const row = (await who.client.get(`${P}/r/request_item/${id}`)).row;
      expect(row.secret_answers).toEqual({ secret: true, hint: "…" });
    }
    // revealed in full to a fulfiller, as before
    expect((await desk.client.post(`${P}/request/items/${id}/reveal`, { name: "pin" })).value).toBe("Zx81");
  });

  it("the revocation of time-bound access survives the item's close; items closed incomplete are revoked too", async () => {
    const vpn = await k.item("vpn_access");
    const r = await order(requester, [{ item_id: vpn.id, answers: { device: "company", os: "linux", end_date: "2030-02-01", reason: "سفر کاری" } }]);
    const id = r.items[0].id;
    await approve(manager, id);
    await approve(security, id);
    await k.drain();
    const [build] = await tasksOf(id);
    await network.client.post(`${P}/r/request_task/${build.id}/transition`, { to: "closed_complete" });
    await k.drain();
    expect((await k.ritm(id)).state).toBe("delivered");
    await k.o.db.query("update sm_request_items set access_until = '2020-01-01' where id = $1", [id]);
    const sys = await systemCtx(k.o.cfg, k.o.org);
    expect((await sweep(sys)).revoked).toBe(1);
    // the requester confirms the delivery: the item closes, the revocation stays to be done
    await requester.client.post(`${P}/r/request_item/${id}/transition`, { to: "closed_complete" });
    expect((await k.ritm(id)).state).toBe("closed_complete");
    const revocation = (await tasksOf(id)).find((t) => String(t.short_description).startsWith("لغو دسترسی"))!;
    expect(revocation.revocation).toBe(true);
    expect(revocation.state).toBe("open");
    // an item closed incomplete
    const r2 = await order(requester, [{ item_id: vpn.id, answers: { device: "company", os: "linux", end_date: "2030-02-01", reason: "سفر دوم" } }]);
    const id2 = r2.items[0].id;
    await approve(manager, id2);
    await approve(security, id2);
    await k.drain();
    await network.client.post(`${P}/r/request_item/${id2}/transition`, { to: "closed_incomplete", data: { close_notes: "بخشی انجام شد" } });
    await k.o.db.query("update sm_request_items set access_until = '2020-01-01' where id = $1", [id2]);
    expect((await sweep(sys)).revoked).toBe(1);
    expect((await tasksOf(id2)).some((t) => t.revocation === true && t.state === "open")).toBe(true);
  });

  it("correcting an item's requester moves its facts, tasks and single-item order to the new person", async () => {
    const other = await k.item("other_request");
    const r = await order(desk, [{ item_id: other.id, answers: { subject: "میز تازه", details: "private details" }, requested_for: stranger.userId }]);
    const id = r.items[0].id;
    expect((await stranger.client.post(`${P}/r/request_answer/query`, {})).rows.length).toBeGreaterThan(0);
    const row = (await desk.client.get(`${P}/r/request_item/${id}`)).row;
    await desk.client.patch(`${P}/r/request_item/${id}`, { requested_for: colleague.userId, version: row.version });
    await stranger.client.get(`${P}/r/request_item/${id}`, 404);
    expect((await stranger.client.post(`${P}/r/request_answer/query`, {})).rows.length).toBe(0);
    await stranger.client.get(`${P}/r/request/${r.request.id}`, 404);
    const facts = (await colleague.client.post(`${P}/r/request_answer/query`, {})).rows as any[];
    expect(facts.map((f) => f.value_text)).toContain("private details");
    expect((await colleague.client.get(`${P}/r/request/${r.request.id}`)).row.requested_for).toBe(colleague.userId);
  });

  it("an agent ordering for themselves follows the item's requester rules", async () => {
    const other = await k.item("other_request");
    const r = await order(network, [{ item_id: other.id, answers: { subject: "صندلی تازه", details: "طبقهٔ ۲" } }]);
    const id = r.items[0].id;
    const ritm = await k.ritm(id);
    expect(ritm.state).toBe("in_fulfilment");
    const got = await network.client.get(`${P}/r/request_item/${id}`);
    expect(got.meta.request.can_work).toBe(false);
    expect((await network.client.get(`${P}/request/answers/request_item/${id}`)).can_edit).toBe(false);
    await network.client.put(`${P}/request/items/${id}/answers`, { answers: { subject: "صندلی", details: "طبقهٔ ۳" } }, 403);
    await network.client.post(`${P}/request/items/${id}/info`, { message: "؟" }, 403);
    // «لغو پیش از شروع انجام»: their own item is in fulfilment
    const e = await network.client.post(`${P}/r/request_item/${id}/transition`, { to: "cancelled", data: { close_notes: "نیاز نیست" }, version: got.row.version }, 409);
    expect(e.error.message).toBeTruthy();
    expect((await k.ritm(id)).state).toBe("in_fulfilment");
    // the item's own fulfilment group works it
    expect((await desk.client.get(`${P}/r/request_item/${id}`)).meta.request.can_work).toBe(true);
  });

  it("answers stay as they were decided once an approver of the round decided", async () => {
    const laptop = await k.item("new_laptop");
    const r = await order(requester, [{ item_id: laptop.id, answers: { model: "standard", os: "windows", reason: "پروژه" } }]);
    const id = r.items[0].id;
    expect((await requester.client.get(`${P}/request/answers/request_item/${id}`)).can_edit).toBe(true);
    await approve(manager, id);
    expect((await k.ritm(id)).state).toBe("awaiting_approval");
    expect((await requester.client.get(`${P}/request/answers/request_item/${id}`)).can_edit).toBe(false);
    await requester.client.put(`${P}/request/items/${id}/answers`, { answers: { model: "design", ram: "32", os: "windows", reason: "پروژه" } }, 403);
    expect((await k.ritm(id)).total).toBe("650000000");
  });

  it("an order through the generic API leaves the desk's fields to the desk", async () => {
    const other = await k.item("other_request");
    const due = new Date(Date.now() + 3_600_000).toISOString();
    const row = (await requester.client.post(`${P}/r/request_item`, {
      cat_item_id: other.id, answers: { subject: "پرینتر", details: "طبقهٔ ۱" },
      assignment_group_id: await k.group("شبکه و زیرساخت"), assigned_to: network.userId, impact: "1", urgency: "1", due_at: due,
    })).row;
    const stored = await k.ritm(row.id);
    expect(stored.assignment_group_id).toBe(await k.group("پشتیبانی کاربران"));
    expect(stored.assigned_to).toBeNull();
    expect(stored.impact).toBe("3");
    expect(stored.priority).not.toBe("1");
    expect(stored.due_at === null || new Date(stored.due_at).toISOString() !== due).toBe(true);
  });

  it("a record producer never copies a secret or sensitive answer into the record it makes", async () => {
    const schema = {
      item: { field_map: { description: "{{pin}} {{national_id}} {{topic}}" } },
      variables: [
        { name: "pin", label: "رمز", type: "secret", field_class: "public", map_to: "short_description" },
        { name: "national_id", label: "کد ملی", type: "string", field_class: "sensitive", map_to: "tags" },
        { name: "topic", label: "موضوع", type: "string", field_class: "public" },
      ],
      grids: [],
    } as unknown as FormSchema;
    const values = producedValues(schema, { pin: "Topsecret99", national_id: "0012345678", topic: "شبکه" }, { requested_for: null }, "todo");
    expect(JSON.stringify(values)).not.toContain("Topsecret99");
    expect(JSON.stringify(values)).not.toContain("0012345678");
    expect(values.description).toContain("شبکه");
    // and the builder refuses to publish such a mapping
    const cat = (await k.rows("catalog", "name = $2", ["فناوری اطلاعات"]))[0];
    const it = await k.o.owner.post(`${P}/r/catalog_item`, { name: "فرم کار محرمانه", code: "secret_todo", type: "record_producer", target_table: "todo", catalog_id: cat.id });
    await k.o.owner.post(`${P}/r/catalog_variable`, { item_id: it.row.id, name: "pin", label: "رمز", type: "secret", map_to: "description" });
    const refused = await k.o.owner.post(`${P}/request/builder/${it.row.id}/publish`, {}, 400);
    expect(JSON.stringify(refused.error.details.problems)).toContain("نگاشته نمی‌شود");
  });

  it("the quantity of an ordered item does not change afterwards", async () => {
    const other = await k.item("other_request");
    const r = await order(requester, [{ item_id: other.id, answers: { subject: "کابل", details: "سه عدد" } }]);
    const id = r.items[0].id;
    const row = (await desk.client.get(`${P}/r/request_item/${id}`)).row;
    const e = await desk.client.patch(`${P}/r/request_item/${id}`, { quantity: 3, version: row.version }, 400);
    expect(e.error.details.fields.quantity).toBeTruthy();
    expect((await k.ritm(id)).quantity).toBe(1);
  });

  it("checkout clears the cart's details: the next order is the caller's own again", async () => {
    const mail = await k.item("mailbox");
    await requester.client.patch(`${P}/request/cart`, { requested_for: colleague.userId, instructions: "برای همکار" });
    await requester.client.post(`${P}/request/cart/lines`, { item_id: mail.id, answers: { mailbox_type: "personal" } });
    const first = await requester.client.post(`${P}/request/cart/checkout`, {});
    expect((await k.ritm(first.items[0].id)).requested_for).toBe(colleague.userId);
    const cart = await requester.client.get(`${P}/request/cart`);
    expect(cart.cart?.requested_for ?? null).toBeNull();
    expect(cart.cart?.instructions ?? null).toBeNull();
    await requester.client.post(`${P}/request/cart/lines`, { item_id: mail.id, answers: { mailbox_type: "personal" } });
    const second = await requester.client.post(`${P}/request/cart/checkout`, {});
    expect((await k.ritm(second.items[0].id)).requested_for).toBe(requester.userId);
  });

  it("the item page offers feedback to its requester side and ordering again to those who may order", async () => {
    const other = await k.item("other_request");
    const r = await order(requester, [{ item_id: other.id, answers: { subject: "ماوس", details: "بی‌سیم" } }]);
    const id = r.items[0].id;
    const forRequester = (await requester.client.get(`${P}/r/request_item/${id}`)).meta.request;
    expect(forRequester.requester).toBe(true);
    expect(forRequester.can_order).toBe(true);
    const forDesk = (await desk.client.get(`${P}/r/request_item/${id}`)).meta.request;
    expect(forDesk.requester).toBe(false);
    const forAuditor = (await auditor.client.get(`${P}/r/request_item/${id}`)).meta.request;
    expect(forAuditor.requester).toBe(false);
    expect(forAuditor.can_order).toBe(false);
  });
});
