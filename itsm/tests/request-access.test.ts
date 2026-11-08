// Who sees and changes what in service requests (docs/spec/ACCESS.md, need-to-know desk): the requester and their
// own orders, another requester, an agent of the fulfilment group, an agent of another group, a fulfiller of a task's
// group (the answers of the item their task belongs to), an approver while their approval is pending, an auditor
// (reads everything, changes nothing), carts that are personal, and the catalogue's definition kept to its managers.
import { describe, it, expect, beforeAll } from "vitest";
import { requestKit, type RequestKit, type Who } from "./request-helpers";

describe("service requests: access", () => {
  let k: RequestKit;
  let P = "";
  let manager: Who;
  let requester: Who;
  let stranger: Who;
  let desk: Who; // agent of «پشتیبانی کاربران»
  let network: Who; // agent of «شبکه و زیرساخت»
  let buyer: Who; // agent of «تدارکات فناوری»
  let auditor: Who;
  let adhoc = "";
  let laptop = "";

  beforeAll(async () => {
    k = await requestKit();
    P = k.P;
    await k.o.owner.put(`${P}/access/settings`, { preset: "need_to_know" });
    manager = await k.person("acc-manager@example.com", { roles: ["agent"] });
    requester = await k.person("acc-req@example.com", { roles: ["requester"], manager: manager.userId });
    stranger = await k.person("acc-stranger@example.com", { roles: ["requester"] });
    desk = await k.person("acc-desk@example.com", { roles: ["agent"] });
    network = await k.person("acc-net@example.com", { roles: ["agent"] });
    buyer = await k.person("acc-buyer@example.com", { roles: ["agent"] });
    auditor = await k.person("acc-auditor@example.com", { roles: ["auditor"] });
    await k.addToGroup(await k.group("پشتیبانی کاربران"), [desk.userId]);
    await k.addToGroup(await k.group("شبکه و زیرساخت"), [network.userId]);
    await k.addToGroup(await k.group("تدارکات فناوری"), [buyer.userId]);
    const other = await k.item("other_request");
    adhoc = (await requester.client.post(`${P}/request/order`, { lines: [{ item_id: other.id, answers: { subject: "میز تازه", details: "طبقهٔ ۴" } }] })).items[0].id;
  }, 120_000);

  it("the requester reads their own order, item and answers; another requester gets nothing", async () => {
    const own = await requester.client.get(`${P}/r/request_item/${adhoc}`);
    expect(own.row.short_description).toBe("میز تازه");
    const answers = await requester.client.get(`${P}/request/answers/request_item/${adhoc}`);
    expect(answers.answers.details).toBe("طبقهٔ ۴");
    await stranger.client.get(`${P}/r/request_item/${adhoc}`, 404);
    await stranger.client.get(`${P}/request/answers/request_item/${adhoc}`, 404);
    await stranger.client.get(`${P}/request/items/${adhoc}/progress`, 404);
    const list = await stranger.client.get(`${P}/r/request_item`);
    expect(list.rows.map((r: any) => r.id)).not.toContain(adhoc);
  });

  it("the requester may not change the work: only watchers, feedback and a cancellation", async () => {
    // the page offers the agents' actions («درخواست اطلاعات», «تغییر قلم», «تبدیل به رخداد») only to those who work items
    const own = await requester.client.get(`${P}/r/request_item/${adhoc}`);
    expect(own.meta.canWrite).toBe(true);
    expect(own.meta.request.can_work).toBe(false);
    await requester.client.patch(`${P}/r/request_item/${adhoc}`, { priority: "1" }, 403);
    await requester.client.post(`${P}/r/request_item/${adhoc}/transition`, { to: "delivered" }, 403);
    await requester.client.post(`${P}/request/items/${adhoc}/info`, { message: "?" }, 403);
  });

  it("an agent of the fulfilment group works the item; an agent of another group does not see it", async () => {
    const r = await desk.client.get(`${P}/r/request_item/${adhoc}`);
    expect(r.meta.canWrite).toBe(true);
    expect(r.meta.request.can_work).toBe(true);
    await desk.client.patch(`${P}/r/request_item/${adhoc}`, { assigned_to: desk.userId });
    await network.client.get(`${P}/r/request_item/${adhoc}`, 404);
    await network.client.get(`${P}/request/answers/request_item/${adhoc}`, 404);
    // the order header follows its items' people
    const req = (await k.ritm(adhoc)).request_id;
    expect((await desk.client.get(`${P}/r/request/${req}`)).row.id).toBe(req);
    await network.client.get(`${P}/r/request/${req}`, 404);
  });

  it("a fulfiller of a task's group reads the answers of the task's item but not the item itself", async () => {
    const item = await k.item("new_laptop");
    const r = await requester.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: { model: "standard", os: "windows", reason: "پروژه" } }] });
    laptop = r.items[0].id;
    for (const who of [manager, buyer]) {
      const mine = (await who.client.get(`${P}/approvals/mine`)).approvals as { id: string; record_id: string }[];
      const a = mine.find((x) => x.record_id === laptop);
      expect(a).toBeTruthy();
      // the approver reads the item and its answers while the approval waits for them
      expect((await who.client.get(`${P}/request/answers/request_item/${laptop}`)).answers.reason).toBe("پروژه");
      await who.client.post(`${P}/approvals/${a!.id}/decide`, { decision: "approved" });
    }
    await k.drain();
    const tasks = await k.rows("request_task", "request_item_id = $2", [laptop]);
    const sourcing = tasks.find((t) => t.short_description === "تأمین و آماده‌سازی لپ‌تاپ")!;
    expect(sourcing.assignment_group_id).toBe(await k.group("تدارکات فناوری"));
    // the buyer works the task and sees the item's answers through it
    expect((await buyer.client.get(`${P}/r/request_task/${sourcing.id}`)).meta.canWrite).toBe(true);
    const viaTask = await buyer.client.get(`${P}/request/answers/request_task/${sourcing.id}`);
    expect(viaTask.answers.model).toBe("standard");
    expect(viaTask.can_edit).toBe(false);
    // the network agent sees neither the task nor its answers
    await network.client.get(`${P}/r/request_task/${sourcing.id}`, 404);
    await network.client.get(`${P}/request/answers/request_task/${sourcing.id}`, 404);
  });

  it("an assigned fulfiller of a task reads the item and its order, read only (fulfillers are readers)", async () => {
    const tasks = await k.rows("request_task", "request_item_id = $2", [laptop]);
    const sourcing = tasks.find((t) => t.short_description === "تأمین و آماده‌سازی لپ‌تاپ")!;
    await buyer.client.patch(`${P}/r/request_task/${sourcing.id}`, { assigned_to: buyer.userId });
    expect((await k.ritm(laptop)).fulfillers).toContain(buyer.userId);
    const item = await buyer.client.get(`${P}/r/request_item/${laptop}`);
    expect(item.row.id).toBe(laptop);
    // the item is the fulfilment group's work: the task's assignee reads it, never changes it
    expect(item.meta.canWrite).toBe(false);
    await buyer.client.patch(`${P}/r/request_item/${laptop}`, { priority: "2" }, 403);
    await buyer.client.post(`${P}/request/items/${laptop}/info`, { message: "?" }, 403);
    const req = (await k.ritm(laptop)).request_id;
    const header = await buyer.client.get(`${P}/r/request/${req}`);
    expect(header.row.id).toBe(req);
    expect(header.meta.canWrite).toBe(false);
    // the assignee of one item of an order reads the order header but cannot cancel the order through it
    const other = await k.item("other_request");
    const mail = await k.item("mailbox");
    const order = await requester.client.post(`${P}/request/order`, { lines: [{ item_id: other.id, answers: { subject: "الف", details: "ب" } }, { item_id: mail.id, answers: { mailbox_type: "personal" } }] });
    const [first] = order.items;
    await k.o.owner.patch(`${P}/r/request_item/${first.id}`, { assigned_to: buyer.userId });
    expect((await buyer.client.get(`${P}/r/request_item/${first.id}`)).meta.canWrite).toBe(true);
    expect((await buyer.client.get(`${P}/r/request/${order.request.id}`)).meta.canWrite).toBe(false);
    await buyer.client.post(`${P}/r/request/${order.request.id}/transition`, { to: "cancelled", data: { close_notes: "x" } }, 403);
    expect((await k.ritm(order.items[1].id)).state).not.toBe("cancelled");
  });

  it("the requester sees only the tasks shown to them", async () => {
    const visible = await requester.client.post(`${P}/r/request_task/query`, { filter: { f: "request_item_id", op: "eq", v: laptop } });
    expect(visible.rows.map((t: any) => t.short_description)).toEqual(["تحویل لپ‌تاپ به کاربر"]);
    const p = await requester.client.get(`${P}/request/items/${laptop}/progress`);
    expect(p.tasks.map((t: any) => t.title)).toEqual(["تحویل لپ‌تاپ به کاربر"]);
  });

  it("an auditor reads everything and changes nothing, and does not order", async () => {
    expect((await auditor.client.get(`${P}/r/request_item/${adhoc}`)).meta.canWrite).toBe(false);
    expect((await auditor.client.get(`${P}/request/answers/request_item/${adhoc}`)).can_edit).toBe(false);
    await auditor.client.patch(`${P}/r/request_item/${adhoc}`, { priority: "2" }, 403);
    const item = await k.item("other_request");
    await auditor.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: { subject: "x", details: "y" } }] }, 403);
    const d = await auditor.client.get(`${P}/request/dashboard`);
    expect(d.totals.ordered).toBeGreaterThanOrEqual(2);
  });

  it("carts are personal", async () => {
    const item = await k.item("mailbox");
    const r = await requester.client.post(`${P}/request/cart/lines`, { item_id: item.id, answers: { mailbox_type: "personal" } });
    await stranger.client.get(`${P}/r/request_cart_line/${r.line.id}`, 404);
    await stranger.client.patch(`${P}/request/cart/lines/${r.line.id}`, { quantity: 2 }, 404);
    expect((await stranger.client.get(`${P}/request/cart`)).lines).toEqual([]);
    expect((await requester.client.get(`${P}/request/cart`)).lines).toHaveLength(1);
  });

  it("keeps the catalogue's definition to its managers; everyone with catalogue access reads it", async () => {
    const cat = (await k.rows("catalog"))[0];
    await requester.client.post(`${P}/r/catalog_item`, { name: "x", type: "standard", catalog_id: cat.id }, 403);
    await desk.client.post(`${P}/r/catalog_item`, { name: "x", type: "standard", catalog_id: cat.id }, 403);
    const item = await k.item("phone");
    await desk.client.patch(`${P}/r/catalog_item/${item.id}`, { price: "1" }, 403);
    await desk.client.post(`${P}/request/builder/${item.id}/publish`, {}, 403);
    expect((await desk.client.get(`${P}/request/builder/${item.id}`)).can_write).toBe(false);
    expect((await requester.client.get(`${P}/r/catalog_item/${item.id}`)).row.name).toBe("گوشی تلفن");
    await requester.client.post(`${P}/request/seed`, {}, 403);
  });

  it("hides items from people outside their audience, in listing and at ordering", async () => {
    const aud = await k.o.owner.post(`${P}/r/catalog_audience`, { name: "فقط شبکه", groups: [await k.group("شبکه و زیرساخت")] });
    const item = await k.item("vpn_access");
    await k.o.owner.patch(`${P}/r/catalog_item/${item.id}`, { available_for: [aud.row.id] });
    const forNetwork = await network.client.get(`${P}/request/catalog`);
    expect(forNetwork.items.map((i: any) => i.code)).toContain("vpn_access");
    const forRequester = await requester.client.get(`${P}/request/catalog`);
    expect(forRequester.items.map((i: any) => i.code)).not.toContain("vpn_access");
    await requester.client.get(`${P}/request/catalog/items/${item.id}`, 404);
    const e = await requester.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: { device: "company", os: "linux", end_date: "2030-01-01", reason: "x" } }] }, 400);
    expect(e.error.message).toContain("در دسترس نیست");
    // the builder explains why
    const check = await k.o.owner.get(`${P}/request/builder/${item.id}/audience?user=${requester.userId}`);
    expect(check.can_order).toBe(false);
    expect(check.reasons.join(" ")).toContain("مخاطبان خود قلم");
    await k.o.owner.patch(`${P}/r/catalog_item/${item.id}`, { available_for: [] });
  });
});
