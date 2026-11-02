// End-to-end synchronisation: a cloud server (web) and a Windows installation (desktop) end up
// with the same data — download, upload, edits on both sides, number clashes, conflicts.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { serve } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeServer, Client, accountId } from "./helpers";
import { startLocal, type LocalServer } from "@local/server";
import type { Db } from "@server/db";

const EMAIL = "sync-owner@example.com";
const PASSWORD = "sync-pass-1405";

async function httpClient(base: string) {
  // a cookie-keeping client over real HTTP (the desktop server is a real server)
  const c = new Client({ fetch: (r: Request) => fetch(r) }, base);
  return c;
}

describe("desktop ↔ cloud synchronisation", () => {
  let cloudDb: Db;
  let cloudUrl = "";
  let cloudServer: ReturnType<typeof serve>;
  let cloud: Client;
  let orgId = "";
  let desktop: LocalServer;
  let desk: Client;
  let dataDir = "";

  beforeAll(async () => {
    const s = await makeServer({ mode: "cloud" });
    cloudDb = s.db;
    await new Promise<void>((ok) => {
      cloudServer = serve({ fetch: s.app.fetch, port: 0, hostname: "127.0.0.1" }, (info: AddressInfo) => {
        cloudUrl = `http://127.0.0.1:${info.port}`;
        ok();
      });
    });
    cloud = await httpClient(cloudUrl);
    await cloud.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
    orgId = (await cloud.post<{ id: string }>("/orgs", { name: "صرافی و طلای نمونه", business_kind: "mixed", modules: ["goods", "gold", "fx"], base_currency: "IRR", fiscal_year: 1405 })).id;
    // some data in the cloud before the desktop exists
    await cloud.post(`/o/${orgId}/data/party`, { name: "مشتری ابری", mobile: "09120000001" });
    const cash = await accountId(cloudDb, orgId, "cash");
    const capital = await accountId(cloudDb, orgId, "capital");
    const box = await cloudDb.one<{ detail_id: string }>(`select detail_id from tz_cash_boxes where org_id = $1`, [orgId]);
    await cloud.post(`/o/${orgId}/accounting/vouchers`, { date: "2026-04-01", description: "سرمایه", lines: [{ account_id: cash, detail_id: box!.detail_id, debit: "1000000" }, { account_id: capital, credit: "1000000" }] });

    dataDir = mkdtempSync(join(tmpdir(), "taraz-sync-"));
    desktop = await startLocal({ dataDir, staticDir: join(__dirname, "..", "public"), port: 0, memory: true, log: { info() {}, warn() {}, error: console.error } });
    desk = await httpClient(desktop.url);
  });

  afterAll(async () => {
    await desktop?.close();
    await new Promise<void>((r) => cloudServer?.close(() => r()));
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("first start: links to the cloud account and downloads the business", async () => {
    const meta = await desk.get("/meta");
    expect(meta.first_run).toBe(true);
    const orgs = await desk.post("/local/cloud/orgs", { url: cloudUrl, email: EMAIL, password: PASSWORD });
    expect(orgs.orgs.map((o: { id: string }) => o.id)).toContain(orgId);
    const linked = await desk.post("/local/cloud/link", { url: cloudUrl, email: EMAIL, password: PASSWORD, org_id: orgId, direction: "download" });
    expect(linked.ok).toBe(true);
    // the cloud password works on the desktop now (password hash came with the members)
    await desk.post("/auth/login", { email: EMAIL, password: PASSWORD });
    const info = await desk.get(`/o/${orgId}`);
    expect(info.org.name).toBe("صرافی و طلای نمونه");
    const parties = await desk.get(`/o/${orgId}/data/party?q=ابری`);
    expect(parties.total).toBe(1);
    const vouchers = await desk.get(`/o/${orgId}/accounting/vouchers`);
    expect(vouchers.total).toBe(1);
  });

  it("desktop changes reach the cloud and cloud changes reach the desktop", async () => {
    const p = await desk.post(`/o/${orgId}/data/party`, { name: "مشتری ویندوز", mobile: "09120000002" });
    await desk.post("/local/sync");
    const inCloud = await cloud.get(`/o/${orgId}/data/party?q=ویندوز`);
    expect(inCloud.total).toBe(1);
    expect(inCloud.rows[0].id).toBe(p.row.id);

    await cloud.patch(`/o/${orgId}/data/party/${p.row.id}`, { name: "مشتری ویندوز (ویرایش در وب)" });
    await desk.post("/local/sync");
    const back = await desk.get(`/o/${orgId}/data/party/${p.row.id}`);
    expect(back.row.name).toBe("مشتری ویندوز (ویرایش در وب)");
  });

  it("documents created on both sides while apart get unique numbers on both sides", async () => {
    const cash = await accountId(cloudDb, orgId, "cash");
    const capital = await accountId(cloudDb, orgId, "capital");
    const box = await cloudDb.one<{ detail_id: string }>(`select detail_id from tz_cash_boxes where org_id = $1`, [orgId]);
    const lines = (amt: string) => [{ account_id: cash, detail_id: box!.detail_id, debit: amt }, { account_id: capital, credit: amt }];
    const a = await cloud.post(`/o/${orgId}/accounting/vouchers`, { date: "2026-05-01", description: "از وب", lines: lines("200") });
    const b = await desk.post(`/o/${orgId}/accounting/vouchers`, { date: "2026-05-02", description: "از ویندوز", lines: lines("300") });
    expect(a.voucher.no).toBe(b.voucher.no); // both took the same next number while apart
    await desk.post("/local/sync");
    const cloudList = await cloud.get(`/o/${orgId}/accounting/vouchers`);
    const deskList = await desk.get(`/o/${orgId}/accounting/vouchers`);
    const nos = (l: { rows: { no: number }[] }) => l.rows.map((r) => r.no).sort();
    expect(cloudList.total).toBe(3);
    expect(new Set(nos(cloudList)).size).toBe(3);
    expect(nos(deskList)).toEqual(nos(cloudList));
  });

  it("both sides report the same balances", async () => {
    const tbCloud = await cloud.get(`/o/${orgId}/accounting/reports/trial-balance?level=3`);
    const tbDesk = await desk.get(`/o/${orgId}/accounting/reports/trial-balance?level=3`);
    expect(tbDesk.totals).toEqual(tbCloud.totals);
    expect(tbCloud.totals.debit).toBe("1000500");
  });

  it("a later edit wins a conflict; the outbox empties", async () => {
    const p = (await desk.get(`/o/${orgId}/data/party?q=ابری`)).rows[0];
    await cloud.patch(`/o/${orgId}/data/party/${p.id}`, { notes: "یادداشت وب" });
    await new Promise((r) => setTimeout(r, 30));
    await desk.patch(`/o/${orgId}/data/party/${p.id}`, { notes: "یادداشت ویندوز (جدیدتر)" });
    await desk.post("/local/sync");
    await desk.post("/local/sync");
    const c = await cloud.get(`/o/${orgId}/data/party/${p.id}`);
    const d = await desk.get(`/o/${orgId}/data/party/${p.id}`);
    expect(c.row.notes).toBe("یادداشت ویندوز (جدیدتر)");
    expect(d.row.notes).toBe(c.row.notes);
    const status = await desk.get("/local/sync");
    expect(status.pending).toBe(0);
  });

  it("a back-dated purchase made offline re-costs a later sale on the web, and the new cost comes back", async () => {
    const item = (await cloud.post(`/o/${orgId}/data/item`, { name: "کالای هم‌گام", kind: "goods", vat_pct: "0" })).row;
    const supplier = (await cloud.post(`/o/${orgId}/data/party`, { name: "تأمین‌کننده‌ی هم‌گام", roles: ["supplier"] })).row;
    const customer = (await cloud.post(`/o/${orgId}/data/party`, { name: "خریدار هم‌گام", roles: ["customer"] })).row;
    const doc = (kind: string, date: string, party: string, qty: string, price: string) =>
      ({ kind, date, party_id: party, lines: [{ item_id: item.id, qty, unit_price: price, vat_pct: "0" }] });
    await cloud.post(`/o/${orgId}/goods/invoices`, doc("purchase", "2026-05-10", supplier.id, "10", "100"));
    const sale = (await cloud.post(`/o/${orgId}/goods/invoices`, doc("sale", "2026-05-20", customer.id, "5", "300"))).invoice;
    const cogs = async () => (await cloudDb.one<{ v: string }>(`select (-sum(value))::text as v from tz_stock_moves where source_id = $1`, [sale.id]))!.v;
    expect(Number(await cogs())).toBe(500);
    await desk.post("/local/sync");
    // made on the Windows app while offline, dated before the web purchase
    await desk.post(`/o/${orgId}/goods/invoices`, doc("purchase", "2026-05-01", supplier.id, "10", "200"));
    await desk.post("/local/sync");
    // average cost at the sale: (2000 + 1000) / 20 = 150 → 5 × 150
    expect(Number(await cogs())).toBe(750);
    await desk.post("/local/sync");
    const tbCloud = await cloud.get(`/o/${orgId}/accounting/reports/trial-balance?level=3`);
    const tbDesk = await desk.get(`/o/${orgId}/accounting/reports/trial-balance?level=3`);
    expect(tbDesk.rows).toEqual(tbCloud.rows);
  });
});
