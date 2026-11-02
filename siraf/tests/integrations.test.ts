import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { makeServer, Client, signupWithOrg } from "./helpers";
import type { Db } from "@server/db";

describe("online shops and the public API", () => {
  let c: Client;
  let db: Db;
  let org: string;
  let app: { fetch: (r: Request) => Response | Promise<Response> };
  let hook: { id: string; secret: string; webhook_path: string };
  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    app = s.app;
    c = new Client(s.app);
    org = await signupWithOrg(c, ["goods"], "trading");
    await c.post(`/o/${org}/data/item`, { name: "تی‌شرت نخی", sku: "TSHIRT-1", sale_price: "15000000", allow_negative: true });
    const r = await c.post(`/o/${org}/integrations`, { kind: "woocommerce", name: "فروشگاه وردپرسی", config: { post: true, price_factor: "10", prices_include_vat: false } });
    hook = r.integration;
  });

  const order = {
    id: 501,
    number: "501",
    status: "processing",
    date_created: "2026-10-30T10:00:00",
    billing: { first_name: "سارا", last_name: "کریمی", email: "sara@example.com", phone: "09121112233", city: "تهران" },
    line_items: [
      { name: "تی‌شرت نخی", sku: "TSHIRT-1", quantity: 2, subtotal: "3000000", total: "3000000" },
      { name: "جوراب", sku: "SOCK-9", quantity: 1, subtotal: "200000", total: "200000" },
    ],
    shipping_total: "50000",
    total: "3250000",
  };

  const send = (payload: unknown, secret = hook.secret) => {
    const raw = JSON.stringify(payload);
    const sig = createHmac("sha256", secret).update(raw, "utf8").digest("base64");
    return app.fetch(
      new Request(`http://shop.test${hook.webhook_path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wc-webhook-signature": sig, "x-wc-webhook-topic": "order.created" },
        body: raw,
      }),
    );
  };

  it("turns a signed WooCommerce order into a posted sale invoice", async () => {
    const res = await send(order);
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out).toMatchObject({ ok: true, duplicate: false });
    const inv = await db.one(`select kind, status, source, external_ref, voucher_id is not null as posted, party_id from tz_invoices where id = $1`, [out.invoice_id]);
    expect(inv).toMatchObject({ kind: "sale", status: "posted", source: "woocommerce", external_ref: "501", posted: true });
    const party = await db.one(`select name, mobile, email from tz_parties where id = $1`, [inv!.party_id]);
    expect(party).toMatchObject({ name: "سارا کریمی", mobile: "09121112233", email: "sara@example.com" });
    const lines = await db.query(
      `select i.name, i.kind, l.qty, l.unit_price from tz_invoice_lines l join tz_items i on i.id = l.item_id where l.invoice_id = $1 order by i.name`,
      [out.invoice_id],
    );
    // toman prices ×10 → rial; the unknown product became a service item
    expect(lines.map((l) => [l.name, l.kind, Number(l.qty), Number(l.unit_price)])).toEqual([
      ["تی‌شرت نخی", "goods", 2, 15000000],
      ["جوراب", "service", 1, 2000000],
    ]);
  });

  it("ignores the same order twice and refuses a wrong signature", async () => {
    const again = await (await send(order)).json();
    expect(again.duplicate).toBe(true);
    const n = await db.one<{ n: number }>(`select count(*)::int as n from tz_invoices where org_id = $1 and source = 'woocommerce'`, [org]);
    expect(n!.n).toBe(1);
    expect((await send({ ...order, id: 502 }, "wrong-secret")).status).toBe(401);
    const events = await c.get(`/o/${org}/integrations/events`);
    expect(events.events.length).toBeGreaterThanOrEqual(1);
  });

  it("lets another program read items and register orders with an API key", async () => {
    const { key } = await c.post(`/o/${org}/integrations/api-keys`, { name: "اپ موبایل", scopes: ["read", "write"] });
    const api = (path: string, init: RequestInit = {}) =>
      app.fetch(new Request(`http://api.test/api/v1${path}`, { ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" } }));
    const items = await (await api("/items?q=TSHIRT")).json();
    expect(items.items[0]).toMatchObject({ name: "تی‌شرت نخی", sku: "TSHIRT-1" });
    const r = await (await api("/orders", { method: "POST", body: JSON.stringify({ id: "A-77", customer: { name: "رضا", mobile: "09350000000" }, items: [{ sku: "TSHIRT-1", name: "تی‌شرت", qty: 1, price: 15000000 }], post: false }) })).json();
    expect(r).toMatchObject({ ok: true, duplicate: false });
    const inv = await (await api(`/invoices/${r.invoice_id}`)).json();
    expect(inv.invoice).toMatchObject({ kind: "sale", status: "draft" });
    expect((await app.fetch(new Request("http://api.test/api/v1/items", { headers: { authorization: "Bearer tz_bad_key" } }))).status).toBe(401);
  });
});
