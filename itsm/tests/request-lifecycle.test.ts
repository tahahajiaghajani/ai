// Service requests end to end on the seeded IT catalogue: the seed (idempotent), browsing, orders with approvals →
// fulfilment through flows → tasks with dependencies → delivery → confirmation and the order's roll-up; zero-touch
// items; waiting for the requester; cancel policies; the cart, order guides, multi-person orders, record producers;
// answer checks in every channel (the generic API too); sensitive and secret answers; publishing and versions.
import { describe, it, expect, beforeAll } from "vitest";
import { requestKit, type RequestKit, type Who } from "./request-helpers";
import { seedRequestDefaults } from "@server/modules/request";
import { systemCtx } from "@server/engine";
import { sweep, stats } from "@server/modules/request";

describe("service requests: lifecycle", () => {
  let k: RequestKit;
  let P = "";
  let manager: Who;
  let requester: Who;
  let other: Who;
  let agent: Who;
  let buyer: Who;
  let security: Who;

  const order = (who: Who, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) => who.client.post(`${P}/request/order`, { lines, ...extra });
  const approve = async (who: Who, recordId: string) => {
    const mine = (await who.client.get(`${P}/approvals/mine`)).approvals as { id: string; record_id: string }[];
    const a = mine.find((x) => x.record_id === recordId);
    expect(a, "an approval waits for this person").toBeTruthy();
    await who.client.post(`${P}/approvals/${a!.id}/decide`, { decision: "approved", comment: "تأیید" });
  };
  const tasksOf = (ritm: string) => k.rows("request_task", "request_item_id = $2", [ritm]);

  beforeAll(async () => {
    k = await requestKit();
    P = k.P;
    manager = await k.person("req-manager@example.com");
    requester = await k.person("req-user@example.com", { roles: ["requester"], manager: manager.userId });
    other = await k.person("req-other@example.com", { roles: ["requester"], manager: manager.userId });
    agent = await k.person("req-agent@example.com");
    buyer = await k.person("req-buyer@example.com");
    security = await k.person("req-security@example.com");
    await k.addToGroup(await k.group("تدارکات فناوری"), [buyer.userId]);
    await k.addToGroup(await k.group("هویت و دسترسی"), [security.userId]);
    await k.addToGroup(await k.group("پشتیبانی کاربران"), [agent.userId]);
    await k.addToGroup(await k.group("شبکه و زیرساخت"), [agent.userId]);
  }, 120_000);

  describe("seed", () => {
    it("adds the IT catalogue with published items, bound flows and approval rules", async () => {
      const items = await k.rows("catalog_item");
      const codes = items.map((i) => i.code).sort();
      expect(codes).toEqual(["access_request", "mailbox", "new_hire", "new_laptop", "other_request", "password_reset", "phone", "report_issue", "software_install", "vpn_access"]);
      expect(items.every((i) => i.state === "published" && i.version_no === 1 && i.dirty === false)).toBe(true);
      const flows = await k.rows("flow", "trigger = 'catalog'");
      expect(flows).toHaveLength(7);
      expect(flows.every((f) => f.active && f.version_id)).toBe(true);
      const laptop = await k.item("new_laptop");
      const rule = (await k.rows("approval", "false")).length; // the table exists
      expect(rule).toBe(0);
      const [r] = await k.o.db.query<Record<string, any>>(`select * from sm_approval_rules where id = $1`, [laptop.approval_rule_id]);
      expect(r.table_key).toBe("request_item");
      expect(r.condition).toEqual({ f: "approval_rule_id", op: "eq", v: r.id });
      const cfg = (await k.o.db.query<Record<string, any>>(`select * from sm_request_configs where org_id = $1`, [k.o.org]))[0];
      expect(cfg.seeded).toBe(true);
      expect(cfg.default_group_id).toBeTruthy();
    });

    it("is idempotent: a second run adds nothing, a forced run only what was deleted", async () => {
      expect((await seedRequestDefaults(k.o.cfg, k.o.org)).skipped).toBe(true);
      const forced = await seedRequestDefaults(k.o.cfg, k.o.org, { force: true });
      expect(forced.created).toEqual({});
    });
  });

  describe("browsing", () => {
    it("lists the catalogue, its categories and items for a requester (hidden items only when searched)", async () => {
      const b = await requester.client.get(`${P}/request/catalog`);
      expect(b.catalogs.map((c: any) => c.name)).toEqual(["فناوری اطلاعات"]);
      expect(b.categories.length).toBe(5);
      const names = b.items.map((i: any) => i.name);
      expect(names).toContain("لپ‌تاپ جدید");
      expect(b.items.find((i: any) => i.code === "new_laptop").price).toBe("650000000");
      expect(b.items.find((i: any) => i.code === "new_laptop").promise).toBe("حدود ۵ روز کاری");
      const search = await requester.client.get(`${P}/request/catalog?q=${encodeURIComponent("گذرواژه")}`);
      expect(search.items.map((i: any) => i.code)).toEqual(["password_reset"]);
    });

    it("serves an item's form without its fulfilment internals", async () => {
      const laptop = await k.item("new_laptop");
      const f = await requester.client.get(`${P}/request/catalog/items/${laptop.id}`);
      expect(f.schema.variables.map((v: any) => v.name)).toContain("model");
      expect(f.schema.item.flow_id).toBeNull();
      expect(f.schema.item.approval_rule_id).toBeNull();
      expect(f.schema.tasks).toEqual([]);
      expect(f.promise.text).toBe("حدود ۵ روز کاری");
      expect(f.promise.due_at).toBeTruthy();
    });

    it("checks answers on the server with policies, prices and the title", async () => {
      const laptop = await k.item("new_laptop");
      const bad = await requester.client.post(`${P}/request/catalog/items/${laptop.id}/check`, { answers: { model: "design", os: "windows", replace_old: true } });
      expect(bad.errors.reason).toBeTruthy();
      expect(bad.errors.old_asset).toBeTruthy(); // made mandatory by the policy
      expect(bad.price.unit).toBe("1050000000");
      const ok = await requester.client.post(`${P}/request/catalog/items/${laptop.id}/check`, { answers: { model: "performance", ram: "32", os: "windows", reason: "پروژهٔ تازه" } });
      expect(ok.errors).toEqual({});
      expect(ok.price.unit).toBe("860000000");
      expect(ok.title).toContain("لپ‌تاپ سبک و پرقدرت برای");
    });
  });

  describe("an order with approvals and a flow", () => {
    let ritm = "";
    let req = "";

    it("places the order: one request, one requested item waiting for the manager", async () => {
      const laptop = await k.item("new_laptop");
      const r = await order(requester, [{ item_id: laptop.id, answers: { model: "standard", os: "windows", reason: "کارمند جدید", replace_old: true, old_asset: "IT-1001" } }]);
      expect(r.request.number).toMatch(/^REQ/);
      expect(r.items).toHaveLength(1);
      ritm = r.items[0].id;
      req = r.request.id;
      const row = await k.ritm(ritm);
      expect(row.state).toBe("awaiting_approval");
      expect(row.stage).toBe("approval");
      expect(row.approval).toBe("requested");
      expect(row.approval_requested_at).toBeTruthy();
      expect(row.price).toBe("650000000");
      expect(row.requested_for).toBe(requester.userId);
      expect(row.due_at).toBeTruthy();
      expect(row.short_description).toContain("لپ‌تاپ اداری استاندارد");
      const [header] = await k.rows("request", "id = $2", [req]);
      expect(header.state).toBe("awaiting_approval");
      expect(header.items_count).toBe(1);
      expect(header.total_price).toBe("650000000");
      // typed answer facts for reports (public and personal answers)
      const facts = await k.rows("request_answer", "request_item_id = $2", [ritm]);
      expect(facts.find((f) => f.variable === "model")?.value_text).toBe("اداری استاندارد");
    });

    it("moves to fulfilment once both levels approved, and the flow plans the tasks", async () => {
      await approve(manager, ritm);
      expect((await k.ritm(ritm)).state).toBe("awaiting_approval");
      await approve(buyer, ritm);
      const row = await k.ritm(ritm);
      expect(row.state).toBe("in_fulfilment");
      expect(row.fulfilment).toBe("flow");
      expect(row.approved_at).toBeTruthy();
      expect(row.flow_runs.length).toBe(1);
      await k.drain();
      const tasks = await tasksOf(ritm);
      expect(tasks.map((t) => t.short_description)).toEqual(["تأمین و آماده‌سازی لپ‌تاپ", "نصب سیستم‌عامل و نرم‌افزارهای پایه", "تحویل لپ‌تاپ به کاربر", "جمع‌آوری دستگاه قبلی"]);
      expect(tasks.map((t) => t.state)).toEqual(["open", "pending", "pending", "pending"]);
      expect(tasks[2].requested_for).toBe(requester.userId); // shown to the requester
      expect(tasks[0].requested_for).toBeNull();
    });

    it("opens each task when the one before it is done and delivers the item after the last", async () => {
      for (let i = 0; i < 4; i++) {
        const open = (await tasksOf(ritm)).find((t) => t.state === "open");
        expect(open, `task ${i + 1} is open`).toBeTruthy();
        await k.o.owner.post(`${P}/r/request_task/${open!.id}/transition`, { to: "closed_complete" });
        await k.drain();
      }
      const row = await k.ritm(ritm);
      expect(row.state).toBe("delivered");
      expect(row.stage).toBe("delivery");
      const [header] = await k.rows("request", "id = $2", [req]);
      expect(header.state).toBe("delivered");
    });

    it("the requester confirms the delivery; the order closes complete", async () => {
      await requester.client.post(`${P}/r/request_item/${ritm}/transition`, { to: "closed_complete" });
      const row = await k.ritm(ritm);
      expect(row.state).toBe("closed_complete");
      expect(row.close_code).toBe("fulfilled");
      expect(row.stage).toBe("completed");
      const [header] = await k.rows("request", "id = $2", [req]);
      expect(header.state).toBe("closed_complete");
      // feedback after delivery (REQ-046)
      await requester.client.post(`${P}/request/items/${ritm}/feedback`, { rating: 5, feedback: "عالی" });
      await other.client.post(`${P}/request/items/${ritm}/feedback`, { rating: 1 }, 404);
      expect((await k.ritm(ritm)).rating).toBe(5);
    });
  });

  describe("zero-touch and approval-free items", () => {
    it("a password reset is fulfilled by its flow alone and closes without confirmation", async () => {
      const item = await k.item("password_reset");
      const r = await order(requester, [{ item_id: item.id, answers: { account: "domain", username: "ali.r", contact_phone: "09121234567" } }]);
      const id = r.items[0].id;
      expect((await k.ritm(id)).state).toBe("in_fulfilment");
      await k.drain();
      const row = await k.ritm(id);
      expect(row.state).toBe("closed_complete");
      expect(row.zero_touch).toBe(true);
      expect(row.fulfilment).toBe("flow");
      expect(await tasksOf(id)).toHaveLength(0);
    });

    it("an ad-hoc item without a flow is fulfilled by hand by the default group", async () => {
      const item = await k.item("other_request");
      const r = await order(requester, [{ item_id: item.id, answers: { subject: "جابه‌جایی میز", details: "میز من به طبقهٔ دوم برود" } }]);
      const row = await k.ritm(r.items[0].id);
      expect(row.state).toBe("in_fulfilment");
      expect(row.fulfilment).toBe("manual");
      expect(row.ad_hoc).toBe(true);
      expect(row.short_description).toBe("جابه‌جایی میز");
      expect(row.assignment_group_id).toBe(await k.group("پشتیبانی کاربران"));
    });
  });

  describe("waiting for the requester, cancelling", () => {
    let id = "";
    beforeAll(async () => {
      const item = await k.item("other_request");
      id = (await order(requester, [{ item_id: item.id, answers: { subject: "نصب پرده", details: "اتاق ۲۱۰" } }])).items[0].id;
    });

    it("«درخواست اطلاعات» pauses the item; the requester's reply resumes it", async () => {
      await agent.client.post(`${P}/request/items/${id}/info`, { message: "شمارهٔ اتاق را دقیق بنویسید" });
      let row = await k.ritm(id);
      expect(row.state).toBe("awaiting_info");
      expect(row.info_requested).toBe(true);
      await requester.client.post(`${P}/r/request_item/${id}/journal`, { kind: "comment", body: "اتاق ۲۱۰ طبقهٔ دوم" });
      await k.drain();
      row = await k.ritm(id);
      expect(row.state).toBe("in_fulfilment");
      expect(Number(row.info_wait)).toBeGreaterThanOrEqual(0);
      expect(row.info_since).toBeNull();
    });

    it("the requester may not cancel once fulfilment started (policy «تا پیش از شروع انجام»)", async () => {
      await requester.client.post(`${P}/r/request_item/${id}/transition`, { to: "cancelled", data: { close_notes: "دیگر لازم نیست" } }, 409);
      expect((await k.ritm(id)).state).toBe("in_fulfilment");
    });

    it("cancelling a whole order before approval cancels its items", async () => {
      const vpn = await k.item("vpn_access");
      const r = await order(requester, [{ item_id: vpn.id, answers: { device: "company", os: "windows", end_date: "2030-01-01", reason: "دورکاری" } }]);
      expect((await k.ritm(r.items[0].id)).state).toBe("awaiting_approval");
      await requester.client.post(`${P}/r/request/${r.request.id}/transition`, { to: "cancelled", data: { close_notes: "منصرف شدم" } });
      const row = await k.ritm(r.items[0].id);
      expect(row.state).toBe("cancelled");
      expect(row.close_code).toBe("cancelled");
      const open = (await k.approvals(r.items[0].id)).filter((a) => a.state === "requested");
      expect(open).toHaveLength(0);
    });
  });

  describe("checks in every channel", () => {
    it("refuses missing required answers and policy-mandatory ones", async () => {
      const item = await k.item("access_request");
      const e = (await requester.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: { system: "finance", access_level: "read", temporary: true } }] }, 400)).error;
      expect(Object.keys(e.details.fields).sort()).toEqual(["lines.0.answers.end_date", "lines.0.answers.reason"]);
    });

    it("drops answers to hidden questions (data minimisation) and applies patterns", async () => {
      const sw = await k.item("software_install");
      await requester.client.post(`${P}/request/order`, { lines: [{ item_id: sw.id, answers: { software: "office", computer_name: "رایانه من" } }] }, 400);
      const r = await order(requester, [{ item_id: sw.id, answers: { software: "office", computer_name: "PC-12", other_name: "پنهان" } }]);
      const row = await k.ritm(r.items[0].id);
      expect(row.answers.other_name).toBeUndefined();
      expect(row.answers.computer_name).toBe("PC-12");
    });

    it("checks a requested item created through the generic API like an order", async () => {
      const sw = await k.item("software_install");
      await requester.client.post(`${P}/r/request_item`, { cat_item_id: sw.id, answers: { software: "office" } }, 400);
      const ok = await requester.client.post(`${P}/r/request_item`, { cat_item_id: sw.id, answers: { software: "vscode", computer_name: "PC-7" } });
      const row = await k.ritm(ok.row.id);
      expect(row.request_id).toBeTruthy();
      expect(row.item_version_id).toBe(sw.version_id);
      expect(row.state).toBe("awaiting_approval");
      // answers never change through the generic API
      await k.o.owner.patch(`${P}/r/request_item/${ok.row.id}`, { answers: { software: "autocad" } }, 400);
    });

    it("refuses ordering for someone else beyond the item's policy", async () => {
      const item = await k.item("password_reset");
      await k.o.owner.patch(`${P}/r/catalog_item/${item.id}`, { on_behalf: "reportees" });
      await k.o.owner.post(`${P}/request/builder/${item.id}/publish`, { note: "فقط زیردستان" });
      const r = await requester.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, requested_for: other.userId, answers: { account: "domain", username: "x", contact_phone: "09120000000" } }] }, 400);
      expect(r.error.message).toContain("زیردستان");
      // the manager may order for their reportee
      const ok = await order(manager, [{ item_id: item.id, requested_for: other.userId, answers: { account: "email", username: "other", contact_phone: "09120000001" } }]);
      expect(ok.items[0].requested_for).toBe(other.userId);
      await k.o.owner.patch(`${P}/r/catalog_item/${item.id}`, { on_behalf: "anyone" });
      await k.o.owner.post(`${P}/request/builder/${item.id}/publish`, {});
    });
  });

  describe("cart, guides, many people, record producers", () => {
    it("checks out a cart: one request, one item per line; lines saved for later stay", async () => {
      const mail = await k.item("mailbox");
      const phone = await k.item("phone");
      const sw = await k.item("software_install");
      await requester.client.post(`${P}/request/cart/lines`, { item_id: mail.id, answers: { mailbox_type: "personal", quota: "20" } });
      await requester.client.post(`${P}/request/cart/lines`, { item_id: phone.id, answers: { phone_type: "desk", install_location: null } }).catch(() => undefined);
      await requester.client.post(`${P}/request/cart/lines`, { item_id: sw.id, answers: { software: "office", computer_name: "PC-1" }, saved: true });
      const cart = await requester.client.get(`${P}/request/cart`);
      expect(cart.lines.length).toBe(2);
      expect(cart.totals.count).toBe(1);
      expect(cart.totals.total).toBe("20000000");
      const r = await requester.client.post(`${P}/request/cart/checkout`, {});
      expect(r.items).toHaveLength(1);
      const after = await requester.client.get(`${P}/request/cart`);
      expect(after.lines.map((l: any) => l.saved)).toEqual([true]);
    });

    it("expands an order guide for its answers and refuses an order without its mandatory items", async () => {
      const guide = await k.item("new_hire");
      const g = await requester.client.post(`${P}/request/guides/${guide.id}/expand`, { answers: { start_date: "2030-01-05", job_title: "حسابدار", needs_laptop: true, reason: "حسابداری" } });
      expect(g.lines.map((l: any) => l.item.code)).toEqual(["mailbox", "new_laptop"]);
      const laptopLine = g.lines.find((l: any) => l.item.code === "new_laptop");
      expect(laptopLine.answers.reason).toBe("حسابداری"); // cascaded
      expect(g.lines[0].mandatory).toBe(true);
      const guides = [{ id: guide.id, answers: { start_date: "2030-01-05", job_title: "حسابدار", needs_laptop: true, reason: "حسابداری" } }];
      await requester.client.post(`${P}/request/order`, { guides, lines: [{ item_id: laptopLine.item.id, guide_id: guide.id, answers: { ...laptopLine.answers, model: "standard", os: "windows" } }] }, 400);
      const ok = await order(requester, [
        { item_id: g.lines[0].item.id, guide_id: guide.id, answers: { mailbox_type: "personal" } },
        { item_id: laptopLine.item.id, guide_id: guide.id, answers: { ...laptopLine.answers, model: "standard", os: "windows" } },
      ], { guides });
      expect(ok.items).toHaveLength(2);
    });

    it("orders one item for several people: one requested item each", async () => {
      const item = await k.item("access_request");
      const r = await order(manager, [{ item_id: item.id, requested_for_list: [requester.userId, other.userId], answers: { system: "shares", access_level: "read", reason: "پوشهٔ پروژه" } }]);
      expect(r.items.map((i: any) => i.requested_for).sort()).toEqual([requester.userId, other.userId].sort());
      const [header] = await k.rows("request", "id = $2", [r.request.id]);
      expect(header.items_count).toBe(2);
    });

    it("a record producer creates its record with the requester's own access", async () => {
      const item = await k.item("report_issue");
      const r = await order(requester, [{ item_id: item.id, answers: { subject: "چاپگر کار نمی‌کند", details: "طبقهٔ سوم", urgency: "2" } }]);
      expect(r.request).toBeNull();
      expect(r.produced.table).toBe("todo");
      const [todo] = await k.rows("todo", "id = $2", [r.produced.id]);
      expect(todo.short_description).toBe("چاپگر کار نمی‌کند");
      expect(todo.description).toBe("طبقهٔ سوم");
    });
  });

  describe("versions and data classes", () => {
    it("publishing a changed item makes a new version; earlier orders keep theirs", async () => {
      const item = await k.item("software_install");
      const before = (await k.rows("request_item", "cat_item_id = $2", [item.id]))[0];
      await k.o.owner.post(`${P}/r/catalog_variable`, { item_id: item.id, name: "urgent", label: "فوری است", type: "bool", sort_order: 100 });
      expect((await k.item("software_install")).dirty).toBe(true);
      const pub = await k.o.owner.post(`${P}/request/builder/${item.id}/publish`, { note: "پرسش فوریت" });
      expect(pub.version.version_no).toBeGreaterThan(Number(item.version_no));
      const after = await k.item("software_install");
      expect(after.dirty).toBe(false);
      expect(after.version_id).not.toBe(before.item_version_id);
      expect((await k.ritm(before.id)).item_version_id).toBe(before.item_version_id);
    });

    it("refuses to publish an item with problems", async () => {
      const item = await k.item("mailbox");
      const v = await k.o.owner.post(`${P}/r/catalog_variable`, { item_id: item.id, name: "kind2", label: "نوع دوم", type: "select", sort_order: 200 });
      const r = await k.o.owner.post(`${P}/request/builder/${item.id}/publish`, {}, 400);
      expect(JSON.stringify(r.error.details.problems)).toContain("گزینه‌ای تعریف نشده است");
      await k.o.owner.del(`${P}/r/catalog_variable/${v.row.id}`);
    });

    it("keeps sensitive answers behind the field group and secrets sealed; a fulfiller may reveal one", async () => {
      const cat = (await k.rows("catalog", "name = $2", ["فناوری اطلاعات"]))[0];
      const it = await k.o.owner.post(`${P}/r/catalog_item`, { name: "حساب آزمایشی", code: "test_account", type: "standard", catalog_id: cat.id, requires_confirmation: false });
      await k.o.owner.post(`${P}/r/catalog_variable`, { item_id: it.row.id, name: "national_id", label: "کد ملی", type: "string", field_class: "sensitive", required: true });
      await k.o.owner.post(`${P}/r/catalog_variable`, { item_id: it.row.id, name: "pin", label: "رمز اولیه", type: "secret" });
      await k.o.owner.post(`${P}/request/builder/${it.row.id}/publish`, {});
      const r = await order(requester, [{ item_id: it.row.id, answers: { national_id: "0012345678", pin: "1234" } }]);
      const id = r.items[0].id;
      const raw = await k.ritm(id);
      expect(raw.answers).toEqual({});
      expect(raw.private_answers).toEqual({ national_id: "0012345678" });
      expect(String(raw.secret_answers)).not.toContain("1234");
      const facts = await k.rows("request_answer", "request_item_id = $2", [id]);
      expect(facts).toHaveLength(0);
      // the requester sees their own sensitive answer; the secret only as a name
      const mine = await requester.client.get(`${P}/request/answers/request_item/${id}`);
      expect(mine.answers.national_id).toBe("0012345678");
      expect(mine.secrets).toEqual(["pin"]);
      expect(mine.can_reveal).toBe(false);
      const revealed = await agent.client.post(`${P}/request/items/${id}/reveal`, { name: "pin" });
      expect(revealed.value).toBe("1234");
      const notes = await k.o.db.query<Record<string, any>>(`select body from sm_journal where org_id = $1 and record_id = $2`, [k.o.org, id]);
      expect(notes.some((n) => String(n.body).includes("رمز اولیه"))).toBe(true);
      // closing masks the sensitive answer and drops the secret
      await agent.client.post(`${P}/r/request_item/${id}/transition`, { to: "closed_complete" });
      const closed = await k.ritm(id);
      expect(closed.private_answers).toEqual({ national_id: "••••" });
      expect(closed.secret_answers).toBeNull();
    });
  });

  describe("background work", () => {
    it("auto-confirms deliveries after the configured working days and revokes ended access", async () => {
      const vpn = await k.item("vpn_access");
      const r = await order(requester, [{ item_id: vpn.id, answers: { device: "company", os: "linux", end_date: "2030-02-01", reason: "سفر کاری" } }]);
      const id = r.items[0].id;
      await approve(manager, id);
      await approve(security, id);
      await k.drain();
      const t = (await tasksOf(id))[0];
      await agent.client.post(`${P}/r/request_task/${t.id}/transition`, { to: "closed_complete" });
      await k.drain();
      expect((await k.ritm(id)).state).toBe("delivered");
      expect((await k.ritm(id)).access_until).toBe("2030-02-01");
      const sys = await systemCtx(k.o.cfg, k.o.org);
      const later = Date.parse("2031-01-01T10:00:00Z");
      const res = await sweep(sys, later);
      expect(res.confirmed).toBeGreaterThanOrEqual(1);
      expect(res.revoked).toBeGreaterThanOrEqual(1);
      const row = await k.ritm(id);
      expect(row.state).toBe("closed_complete");
      expect(row.revoked_at).toBeTruthy();
      expect((await tasksOf(id)).some((x) => String(x.short_description).startsWith("لغو دسترسی"))).toBe(true);
    });

    it("computes the statistical expectation of items from completed orders", async () => {
      const sys = await systemCtx(k.o.cfg, k.o.org);
      await stats(sys);
      const pw = await k.item("password_reset");
      expect(Number(pw.sle_samples)).toBeGreaterThanOrEqual(1);
      expect(pw.sle_p85).not.toBeNull();
      expect(Number(pw.orders_90d)).toBeGreaterThanOrEqual(1);
    });

    it("reports the dashboard through the caller's access", async () => {
      const d = await agent.client.get(`${P}/request/dashboard?days=30`);
      expect(d.totals.ordered).toBeGreaterThan(3);
      expect(d.zero_touch).not.toBeNull();
      const mine = await requester.client.get(`${P}/request/dashboard?days=30`);
      expect(mine.totals.ordered).toBeLessThanOrEqual(d.totals.ordered);
    });
  });
});
