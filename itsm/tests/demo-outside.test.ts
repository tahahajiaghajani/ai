// What real people and programs get outside the system takes nothing of the demo pack (docs/DEMO_FA.md), even where
// the content is built from many records and the request is a real one: a context whose reads leave the system
// (`Ctx.withoutDemo`: the engine's read predicate leaves out the rows recorded in sm_demo_rows) serves
// · the record API of other programs (/api/v1/r/*): a demo row is listed, counted, read, changed or deleted by none;
// · a real schedule's e-mail (analytics deliveries): its summary is computed without the pack's records, while the copy
//   in the app (the bell and the delivery record) keeps what the recipient reads there;
// · the assistant's answers in a messenger (Telegram, Bale): no demo article is found, cited or listed.
import { describe, it, expect, beforeAll } from "vitest";
import { kbWorld, type KbWorld } from "./knowledge-helpers";
import { Client } from "./helpers";
import { tableDef } from "@shared/tables";
import { aiNet } from "@server/modules/ai/net";
import { resetRateLimits } from "@server/http/ratelimit";
import { systemCtx } from "@server/engine";
import { deliverTo } from "@server/modules/analytics/delivery";

let w: KbWorld;
let P: string;
const demoRow = (id: string, table: string) =>
  w.e.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, $3) on conflict do nothing`, [w.e.org, id, tableDef(table)!.table]);

beforeAll(async () => {
  w = await kbWorld();
  P = w.P;
}, 600_000);

describe("reads that leave the system take nothing of the demo pack", () => {
  it("the record API lists, counts, reads, changes and deletes no demo row", async () => {
    const iu = (await w.o.post(`${P}/r/integration_user`, { name: "انبار داده" })).row;
    await w.o.put(`${P}/integration/users/${iu.id}/roles`, { roles: ["agent"] });
    const k = await w.o.post(`${P}/integration/users/${iu.id}/keys`, { name: "کلید انبار داده", scopes: [{ table: "incident", ops: ["read", "update", "delete"] }] });
    const api = new Client(w.e.app);
    api.token = k.key;
    const real = (await w.o.post(`${P}/r/incident`, { short_description: "رخداد واقعی شعبهٔ مرکزی" })).row;
    const demo = (await w.o.post(`${P}/r/incident`, { short_description: "رخداد نمایشی شعبهٔ مرکزی" })).row;
    await demoRow(demo.id, "incident");
    const listed = (await api.get("/v1/r/incident?size=200")).rows.map((r: { id: string }) => r.id);
    expect(listed).toContain(real.id);
    expect(listed).not.toContain(demo.id);
    const found = (await api.post("/v1/r/incident/query", { filter: { f: "short_description", op: "contains", v: "شعبهٔ مرکزی" }, total: true })) as { rows: { id: string }[]; total: number };
    expect([found.total, found.rows.map((r) => r.id)]).toEqual([1, [real.id]]);
    const agg = await api.post("/v1/r/incident/agg", { filter: { f: "short_description", op: "contains", v: "شعبهٔ مرکزی" }, metrics: [{ fn: "count" }] });
    expect(agg.totals.count).toBe(1);
    await api.get(`/v1/r/incident/${demo.id}`, 404);
    await api.req("PATCH", `/v1/r/incident/${demo.id}`, { short_description: "تغییر از بیرون", version: demo.version }, 404);
    await api.req("DELETE", `/v1/r/incident/${demo.id}`, undefined, 404);
    expect((await api.get(`/v1/r/incident/${real.id}`)).row.short_description).toBe("رخداد واقعی شعبهٔ مرکزی");
    // inside the system the organisation's people still work with it
    const kept = (await w.o.get(`${P}/r/incident/${demo.id}`)).row;
    expect([kept.short_description, kept.deleted_at ?? null]).toEqual(["رخداد نمایشی شعبهٔ مرکزی", null]);
  });

  it("a real schedule's e-mail carries no demo record; the copy in the app keeps what the recipient reads there", async () => {
    const real = (await w.o.post(`${P}/r/incident`, { short_description: "قطعی واقعی خودپرداز ونک" })).row;
    const demo = (await w.o.post(`${P}/r/incident`, { short_description: "قطعی نمایشی خودپرداز تجریش" })).row;
    const report = (await w.o.post(`${P}/r/analytics_report`, {
      name: "قطعی‌های خودپرداز",
      spec: { v: 1, table: "incident", measures: [], dims: [], viz: "list", columns: ["number", "short_description"], filter: { f: "id", op: "in", v: [real.id, demo.id] } },
    })).row;
    const schedule = (await w.o.post(`${P}/r/analytics_schedule`, { name: "قطعی‌های روزانه", report_id: report.id, schedule: { kind: "daily", time: "08:00" }, include_owner: true, channels: ["in_app", "email"], formats: ["summary"], skip_if_empty: false })).row;
    const sys = await systemCtx(w.e.cfg, w.e.org);
    const s = (await w.o.get(`${P}/r/analytics_schedule/${schedule.id}`)).row;
    // the notifications a delivery queued: by their channels, their text
    const batches = async (deliveryId: string): Promise<Record<string, string>> =>
      Object.fromEntries(
        (await w.e.db.query<{ payload: { rule: { channels: string[]; inline: { body: string } | null } } }>(`select payload from sm_jobs where org_id = $1 and kind = 'notify.batch' and payload -> 'ev' ->> 'id' = $2`, [w.e.org, deliveryId]))
          .map((j) => [[...j.payload.rule.channels].sort().join("+"), j.payload.rule.inline?.body ?? ""]),
      );
    // no demo rows yet: one notification, in the app and by e-mail, with both incidents
    await w.e.db.query(`delete from sm_demo_rows where org_id = $1`, [w.e.org]);
    const before = await deliverTo(w.e.cfg, sys, s, w.e.ownerId);
    expect(before.status).toBe("sent");
    const one = await batches(before.delivery_id!);
    expect(Object.keys(one)).toEqual(["email+in_app"]);
    expect(one["email+in_app"]).toContain("قطعی نمایشی خودپرداز تجریش");
    // the demo pack holds one of them: the e-mail is computed without it, the bell keeps it
    await demoRow(demo.id, "incident");
    const after = await deliverTo(w.e.cfg, sys, s, w.e.ownerId);
    const two = await batches(after.delivery_id!);
    expect(Object.keys(two).sort()).toEqual(["email", "in_app"]);
    expect(two.in_app).toContain("قطعی نمایشی خودپرداز تجریش");
    expect(two.email).toContain("قطعی واقعی خودپرداز ونک");
    expect(two.email).not.toContain("قطعی نمایشی خودپرداز تجریش");
    expect(two.email).not.toContain(String(demo.number));
    // a schedule of a demo report sends no e-mail at all (nothing of it to compute outside the pack)
    await demoRow(report.id, "analytics_report");
    const quiet = await deliverTo(w.e.cfg, sys, s, w.e.ownerId);
    expect(Object.keys(await batches(quiet.delivery_id!))).toEqual(["in_app"]);
  });

  it("the assistant's answer in a messenger finds, cites and lists no demo article", async () => {
    const realLookup = aiNet.lookup;
    aiNet.lookup = async () => ["93.184.216.34"];
    const sent: { url: string; body: Record<string, any> }[] = [];
    const fetchBefore = w.e.cfg.fetch;
    w.e.cfg.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }) as typeof fetch;
    try {
      resetRateLimits();
      // without a model the assistant lists the guides it finds for the question (no model writes an answer)
      await w.o.put(`${P}/ai/settings`, { features: { virtual_agent: false } });
      const real = await w.published({ title: "ساخت امضای ایمیل سازمانی", body: "## گام‌ها\n\n1. امضای ایمیل سازمانی را از تنظیمات نامه‌نگار بسازید.\n2. نام، سمت و شمارهٔ داخلی را در امضا بنویسید.\n" });
      const demo = await w.published({ title: "ساخت امضای ایمیل در شعبهٔ آفتاب", body: "## گام‌ها\n\n1. امضای ایمیل کارکنان شعبه را از تنظیمات نامه‌نگار بسازید.\n2. نام شعبه و کد شعبه را در امضا بنویسید.\n" });
      await demoRow(demo.id, "kb_article");
      await w.drain();
      const question = "چگونه امضای ایمیل بسازم؟";
      // in the app (inside the system) the requester finds both
      const inApp = (await w.p.req.client.post(`${P}/ai/va/conversations`, { channel: "portal", text: question })).reply;
      const listedInApp = JSON.stringify(inApp.cards);
      expect(listedInApp).toContain(real.title);
      expect(listedInApp).toContain(demo.title);
      // a Telegram chat linked to the same requester
      const ch = (await w.o.post(`${P}/r/portal_channel`, { name: "ربات بانک", kind: "telegram", token: "123:abc", bot_username: "bank_help_bot", auth_mode: "header" })).row;
      const secret = await w.o.post(`${P}/portal/channels/${ch.id}/secret`, {});
      const key = String(secret.webhook_url).split("/").pop()!;
      let update = 7000;
      const deliver = async (text: string, from: number) => {
        const id = ++update;
        const payload = { update_id: id, message: { message_id: id, date: 1, text, chat: { id: from, type: "private" }, from: { id: from, first_name: "سارا", is_bot: false } } };
        const res = await w.e.app.fetch(new Request(`http://local.test/api/public/portal/hooks/${key}`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret.secret }, body: JSON.stringify(payload) }));
        expect(res.status).toBe(200);
        await w.drain();
        return [...sent].reverse().find((s) => String(s.body.chat_id) === String(from))?.body.text as string;
      };
      const code = (await w.p.req.client.post(`${P}/portal/link-code`, {})).code;
      expect(await deliver(`/link ${code}`, 901)).toContain("وصل شد");
      const answer = await deliver(question, 901);
      expect(answer).toContain(real.title);
      expect(answer).not.toContain(demo.title);
    } finally {
      w.e.cfg.fetch = fetchBefore;
      aiNet.lookup = realLookup;
      await w.o.put(`${P}/ai/settings`, { features: { virtual_agent: true } });
    }
  });
});
