// «زنده»: the pulse token that open screens poll moves when another device changes the business —
// on the web version (a browser, a phone, a Windows app's upload) and in the Windows app (a local
// write, a download from the web version).
import { describe, it, expect } from "vitest";
import { makeServer, Client, signupWithOrg } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { isLiveQuery, pulseDelay } from "../src/ui/lib/live";

const PASSWORD = "live-pass-1405";
let ip = 0;

async function linked(email: string) {
  const cloud = await makeServer({ mode: "cloud" });
  const desk = await makeServer({ mode: "desktop" });
  const addr = `10.31.${++ip}.1`;
  const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(String(u), init);
    req.headers.set("x-forwarded-for", addr);
    return cloud.app.fetch(req);
  }) as typeof fetch;
  const viaCloud = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", addr), cloud.app.fetch(r)) };
  const web = new Client(viaCloud, "http://cloud.test");
  await web.post("/auth/signup", { email, password: PASSWORD, full_name: "مالک زنده" });
  const org = (await web.post<{ id: string }>("/orgs", { name: "فروشگاه زنده", business_kind: "trading", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 })).id;
  const client = new SyncClient({ db: desk.db, config: defaultConfig(), save() {}, log: { info() {}, warn() {}, error() {} }, fetch: cloudFetch });
  await client.link({ url: "http://cloud.test", email, password: PASSWORD, orgId: org, direction: "download" });
  const local = new Client(desk.app, "http://desk.test");
  await local.post("/auth/login", { email, password: PASSWORD });
  const phone = new Client(viaCloud, "http://cloud.test");
  await phone.post("/auth/login", { email, password: PASSWORD });
  return { web, phone, local, client, org };
}

describe("the pulse of a business", () => {
  it("moves on the web version when any device changes data, and stays put otherwise", async () => {
    const p = await linked("live-web@example.com");
    const before = (await p.phone.get(`/o/${p.org}/pulse`)).pulse;
    expect(typeof before).toBe("string");
    expect((await p.phone.get(`/o/${p.org}/pulse`)).pulse).toBe(before);
    // a browser adds a customer: the phone's next look sees a new token
    await p.web.post(`/o/${p.org}/data/party`, { name: "مشتری وب" });
    const afterWeb = (await p.phone.get(`/o/${p.org}/pulse`)).pulse;
    expect(afterWeb).not.toBe(before);
    // the Windows app uploads a customer made offline: the token moves again
    await p.local.post(`/o/${p.org}/data/party`, { name: "مشتری ویندوز" });
    await p.client.syncNow();
    expect((await p.phone.get(`/o/${p.org}/pulse`)).pulse).not.toBe(afterWeb);
  });

  it("moves in the Windows app after a local write and after a download that changed something", async () => {
    const p = await linked("live-desk@example.com");
    const t0 = (await p.local.get(`/o/${p.org}/pulse`)).pulse;
    await p.local.post(`/o/${p.org}/data/party`, { name: "مشتری محلی" });
    const t1 = (await p.local.get(`/o/${p.org}/pulse`)).pulse;
    expect(t1).not.toBe(t0);
    await p.client.syncNow();
    // nothing new on the web: a download that changes nothing leaves the token as it is
    const t2 = (await p.local.get(`/o/${p.org}/pulse`)).pulse;
    await p.client.pullAll();
    expect((await p.local.get(`/o/${p.org}/pulse`)).pulse).toBe(t2);
    // a phone adds a customer on the web; the next download moves the Windows app's token
    await p.phone.post(`/o/${p.org}/data/party`, { name: "مشتری گوشی" });
    expect(await p.client.pullAll()).toBeGreaterThan(0);
    expect((await p.local.get(`/o/${p.org}/pulse`)).pulse).not.toBe(t2);
    const names = (await p.local.get(`/o/${p.org}/data/party?q=${encodeURIComponent("مشتری گوشی")}`)).rows.map((r: { name: string }) => r.name);
    expect(names).toContain("مشتری گوشی");
  });

  it("is closed to people outside the business", async () => {
    const s = await makeServer({ mode: "cloud" });
    const owner = new Client(s.app);
    const org = await signupWithOrg(owner, ["goods"]);
    const other = new Client(s.app);
    await other.post("/auth/signup", { email: "stranger@example.com", password: "stranger-pass-1", full_name: "غریبه" });
    await other.get(`/o/${org}/pulse`, 403);
  });
});

describe("what refreshes and how often", () => {
  it("refreshes read-only views, never editors or quotes", () => {
    for (const k of ["table", "tb", "ledger", "dash-pl", "gold-stock", "fx-wallets", "org"]) expect(isLiveQuery({ queryKey: [k] })).toBe(true);
    for (const k of ["goods-invoice", "gold-doc", "voucher", "treasury-doc", "fx-deal", "gold-catalogue", "fx-board", "options", "ai", "me"]) expect(isLiveQuery({ queryKey: [k] })).toBe(false);
  });

  it("looks often while someone works and rarely in the background", () => {
    expect(pulseDelay({ desktop: false, focused: true, idleMs: 0 })).toBe(12_000);
    expect(pulseDelay({ desktop: false, focused: true, idleMs: 10 * 60_000 })).toBe(30_000);
    expect(pulseDelay({ desktop: true, focused: true, idleMs: 0 })).toBe(5_000);
    expect(pulseDelay({ desktop: true, focused: false, idleMs: 0 })).toBe(60_000);
  });
});
