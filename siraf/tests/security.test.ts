import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { makeServer, Client, signupWithOrg } from "./helpers";
import type { Db } from "@server/db";
import type { DesktopBridge } from "@server/context";

type App = { fetch: (r: Request) => Response | Promise<Response> };

describe("cross-organisation access", () => {
  let app: App;
  let db: Db;
  let victim: Client;
  let attacker: Client;
  let victimOrg: string;
  let attackerOrg: string;
  beforeAll(async () => {
    const s = await makeServer();
    app = s.app;
    db = s.db;
    victim = new Client(app);
    victimOrg = await signupWithOrg(victim); // owner@example.com, the first account (platform admin)
    attacker = new Client(app);
    await attacker.post("/auth/signup", { email: "mallory@example.com", password: "mallory-pass-1", full_name: "مهاجم" });
    attackerOrg = (await attacker.post<{ id: string }>("/orgs", { name: "شرکت مهاجم", business_kind: "trading", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 })).id;
  });

  it("does not let an organisation reset the password of a user who belongs to other businesses", async () => {
    // any signed-up user can add an existing account to their own business by email…
    const { user_id } = await attacker.post(`/o/${attackerOrg}/members`, { email: "owner@example.com", full_name: "قربانی", role: "viewer" });
    const { members } = await attacker.get(`/o/${attackerOrg}/members`);
    const m = members.find((x: { user_id: string }) => x.user_id === user_id);
    // …but must not be able to take that account over
    await attacker.post(`/o/${attackerOrg}/members/${m.id}/password`, { password: "taken-over-1" }, 403);
    const fresh = new Client(app);
    await fresh.post("/auth/login", { email: "owner@example.com", password: "taken-over-1" }, 401);
    await fresh.post("/auth/login", { email: "owner@example.com", password: "s3cret-pass" });
    await victim.get("/auth/me");
  });

  it("still resets the password of a member who only works for this business", async () => {
    await victim.post(`/o/${victimOrg}/members`, { email: "clerk@example.com", full_name: "کارمند", role: "sales", password: "clerk-pass-1" });
    const { members } = await victim.get(`/o/${victimOrg}/members`);
    const m = members.find((x: { email: string }) => x.email === "clerk@example.com");
    const r = await victim.post(`/o/${victimOrg}/members/${m.id}/password`, {});
    expect(r.temp_password).toBeTruthy();
    await new Client(app).post("/auth/login", { email: "clerk@example.com", password: r.temp_password });
  });

  it("refuses references to rows of another business in master data", async () => {
    const unitB = await db.one<{ id: string }>(`select id from tz_units where org_id = $1 limit 1`, [attackerOrg]);
    const accB = await db.one<{ id: string }>(`select id from tz_accounts where org_id = $1 and is_postable limit 1`, [attackerOrg]);
    // creating with another business's unit / ledger account
    await victim.post(`/o/${victimOrg}/data/item`, { name: "کالای الف", unit_id: unitB!.id }, 400);
    await victim.post(`/o/${victimOrg}/data/item`, { name: "کالای ب", sales_account_id: accB!.id }, 400);
    // updating to another business's unit
    const { row } = await victim.post(`/o/${victimOrg}/data/item`, { name: "کالای ج" });
    await victim.patch(`/o/${victimOrg}/data/item/${row.id}`, { unit_id: unitB!.id }, 400);
    // importing with a raw id of another business
    const r = await victim.post(`/o/${victimOrg}/data/item/import`, { rows: [{ name: "کالای د", unit_id: unitB!.id }] });
    expect(r.failed).toBe(1);
    // own references still work
    const unitA = await db.one<{ id: string }>(`select id from tz_units where org_id = $1 limit 1`, [victimOrg]);
    const ok = await victim.post(`/o/${victimOrg}/data/item`, { name: "کالای ه", unit_id: unitA!.id });
    expect(ok.row.unit_id).toBe(unitA!.id);
    const items = await db.query<{ n: number }>(`select count(*)::int as n from tz_items where org_id = $1 and unit_id = $2`, [victimOrg, unitB!.id]);
    expect(items[0].n).toBe(0);
  });
});

describe("desktop installation administration", () => {
  it("does not make a member a desktop administrator by creating a business of their own", async () => {
    const calls: string[] = [];
    const bridge = {
      info: async () => ({}),
      listBackups: async () => {
        calls.push("list");
        return [];
      },
      backupNow: async () => ({ file: "x" }),
      restoreBackup: async () => {
        calls.push("restore");
      },
      getSettings: async () => ({}),
      setSettings: async () => ({}),
      syncStatus: async () => ({}),
      syncNow: async () => ({}),
      link: async () => ({}),
      unlink: async () => {},
      cloudOrgs: async () => [],
      notifyLocalWrite: () => {},
    } as unknown as DesktopBridge;
    const s = await makeServer({ mode: "desktop", config: { desktop: bridge } });
    const owner = new Client(s.app);
    const org = await signupWithOrg(owner, ["goods"], "trading");
    await owner.post(`/o/${org}/members`, { email: "seller@example.com", full_name: "فروشنده", role: "sales", password: "seller-pass-1" });
    const seller = new Client(s.app);
    await seller.post("/auth/login", { email: "seller@example.com", password: "seller-pass-1" });
    await seller.get("/local/backups", 403);
    await seller.post("/orgs", { name: "کسب‌وکار دوم", business_kind: "trading", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 }, 403);
    await seller.get("/local/backups", 403);
    await seller.post("/local/backups/restore", { file: "x" }, 403);
    expect(calls).toEqual([]);
    // the installation's administrator still creates businesses
    await owner.post("/orgs", { name: "کسب‌وکار سوم", business_kind: "trading", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 });
  });
});

describe("request parsing and online shops", () => {
  let app: App;
  let c: Client;
  let org: string;
  beforeAll(async () => {
    const s = await makeServer();
    app = s.app;
    c = new Client(app);
    org = await signupWithOrg(c, ["goods"], "trading");
  });

  it("answers a bad page or size with a normal page instead of a server error", async () => {
    const a = await c.get(`/o/${org}/data/item?page=abc&size=xyz`);
    expect(a).toMatchObject({ page: 1, size: 50 });
    const b = await c.get(`/o/${org}/data/item?page=1e300`);
    expect(b.rows).toEqual([]);
    const { key } = await c.post(`/o/${org}/integrations/api-keys`, { name: "کلید خواندن", scopes: ["read"] });
    for (const page of ["abc", "1e300", "-5"]) {
      const res = await app.fetch(new Request(`http://local.test/api/v1/items?page=${page}`, { headers: { authorization: `Bearer ${key}` } }));
      expect(res.status).toBe(200);
    }
  });

  it("keeps orders of two shops with the same order number apart", async () => {
    const shopA = (await c.post(`/o/${org}/integrations`, { kind: "woocommerce", name: "فروشگاه یک", config: { post: false } })).integration;
    const shopB = (await c.post(`/o/${org}/integrations`, { kind: "woocommerce", name: "فروشگاه دو", config: { post: false } })).integration;
    const order = (name: string) => ({
      id: 77, status: "processing", date_created: "2026-10-30T10:00:00",
      billing: { first_name: name, last_name: "", email: `${name}@example.com` },
      line_items: [{ name: "کالای اینترنتی", sku: "WEB-1", quantity: 1, subtotal: "1000", total: "1000" }],
    });
    const send = async (hook: { webhook_path: string; secret: string }, payload: unknown) => {
      const raw = JSON.stringify(payload);
      const sig = createHmac("sha256", hook.secret).update(raw, "utf8").digest("base64");
      const res = await app.fetch(new Request(`http://shop.test${hook.webhook_path}`, {
        method: "POST", headers: { "content-type": "application/json", "x-wc-webhook-signature": sig, "x-wc-webhook-topic": "order.created" }, body: raw,
      }));
      return res.json();
    };
    const a = await send(shopA, order("ali"));
    const b = await send(shopB, order("reza"));
    expect(a).toMatchObject({ ok: true, duplicate: false });
    expect(b).toMatchObject({ ok: true, duplicate: false });
    expect(b.invoice_id).not.toBe(a.invoice_id);
    // the same shop sending its order again is still a duplicate
    const again = await send(shopB, order("reza"));
    expect(again).toMatchObject({ ok: true, duplicate: true });
  });
});

describe("platform administrators", () => {
  it("does not make the first stranger to sign up an administrator when the owner's email is configured", async () => {
    const s = await makeServer({ config: { platformAdmins: ["boss@example.com"] } });
    const stranger = new Client(s.app);
    await stranger.post("/auth/signup", { email: "early@example.com", password: "early-pass-1", full_name: "کاربر زودرس" });
    const me = await stranger.get("/auth/me");
    expect(me.user.is_platform_admin).toBe(false);
    await stranger.get("/admin/stats", 403);
    const boss = new Client(s.app);
    await boss.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک سامانه" });
    await boss.get("/admin/stats");
  });

  it("still makes the first account the administrator when no email is configured", async () => {
    const s = await makeServer();
    const first = new Client(s.app);
    await first.post("/auth/signup", { email: "first@example.com", password: "first-pass-1", full_name: "نخستین" });
    await first.get("/admin/stats");
  });
});

describe("what a desktop receives when it synchronises", () => {
  let app: App;
  let db: Db;
  let org: string;
  let owner: Client;
  let manager: Client;
  let seller: Client;
  type U = { email: string; password_hash: string | null; password_withheld: boolean; mobile: string | null };
  const pull = async (c: Client, extra = "") => (await c.get<{ users: U[] }>(`/sync/pull?org_id=${org}&cursor=0&user_cursor=0${extra}`)).users;
  const of = (users: U[], email: string) => users.find((u) => u.email === email)!;
  const hashed = /^scrypt\$/;

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    // a network address of its own, so that sign-ups here do not count against other tests
    app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.61.0.1"), s.app.fetch(r)) };
    await new Client(app).post("/auth/signup", { email: "operator@example.com", password: "operator-pass-1", full_name: "گرداننده‌ی سامانه" }); // the platform admin
    owner = new Client(app);
    await owner.post("/auth/signup", { email: "boss@example.com", password: "boss-pass-1", full_name: "مالک", mobile: "09120000010" });
    org = (await owner.post<{ id: string }>("/orgs", { name: "صرافی هم‌گام", business_kind: "mixed", modules: ["goods", "fx"], base_currency: "IRR", fiscal_year: 1405 })).id;
    await owner.post(`/o/${org}/members`, { email: "manager@example.com", full_name: "مدیر", role: "admin", password: "manager-pass-1" });
    await owner.post(`/o/${org}/members`, { email: "clerk2@example.com", full_name: "حسابدار", role: "accountant", password: "clerk2-pass-1" });
    await owner.post(`/o/${org}/members`, { email: "seller2@example.com", full_name: "فروشنده", role: "sales", password: "seller2-pass-1" });
    await db.query(`update tz_users set mobile = '09120000011' where email = 'clerk2@example.com'`);
    // an accountant who also keeps the books of a business of their own
    const freelance = new Client(app);
    await freelance.post("/auth/signup", { email: "freelance@example.com", password: "freelance-pass-1", full_name: "حسابدار آزاد" });
    await freelance.post("/orgs", { name: "دفتر حسابداری", business_kind: "services", modules: ["goods"], base_currency: "IRR", fiscal_year: 1405 });
    await owner.post(`/o/${org}/members`, { email: "freelance@example.com", full_name: "حسابدار آزاد", role: "accountant" });
    manager = new Client(app);
    await manager.post("/auth/login", { email: "manager@example.com", password: "manager-pass-1" });
    seller = new Client(app);
    await seller.post("/auth/login", { email: "seller2@example.com", password: "seller2-pass-1" });
  });

  it("gives an owner's desktop the password hashes of the accounts that work for this business alone", async () => {
    const users = await pull(owner);
    for (const e of ["boss@example.com", "manager@example.com", "clerk2@example.com", "seller2@example.com"]) {
      expect(of(users, e).password_hash).toMatch(hashed);
      expect(of(users, e).password_withheld).toBe(false);
    }
    // the owner could not set this one's password either: it works for another business too
    expect(of(users, "freelance@example.com").password_hash).toBeNull();
    expect(of(users, "freelance@example.com").password_withheld).toBe(true);
    expect(of(users, "clerk2@example.com").mobile).toBe("09120000011");
  });

  it("does not give an administrator's desktop the owner's password hash", async () => {
    const users = await pull(manager);
    expect(of(users, "boss@example.com").password_hash).toBeNull();
    expect(of(users, "boss@example.com").password_withheld).toBe(true);
    expect(of(users, "clerk2@example.com").password_hash).toMatch(hashed);
    expect(of(users, "manager@example.com").password_hash).toMatch(hashed);
  });

  it("gives a salesperson's desktop only its own password hash and no one else's phone number", async () => {
    const users = await pull(seller);
    expect(users.length).toBe(5);
    for (const u of users) {
      if (u.email === "seller2@example.com") {
        expect(u.password_hash).toMatch(hashed);
        expect(u.password_withheld).toBe(false);
      } else {
        expect(u.password_hash).toBeNull();
        expect(u.password_withheld).toBe(true);
        expect(u.mobile).toBeNull();
      }
    }
  });

  it("keeps a device record with the account and business that registered it", async () => {
    const mine = await owner.post<{ device_id: string }>("/sync/register", { org_id: org, name: "رایانه‌ی مالک" });
    // device ids are no secret: they ride along as the origin of synchronised rows
    const theirs = await seller.post<{ device_id: string }>("/sync/register", { org_id: org, device_id: mine.device_id, name: "دستکاری‌شده" });
    expect(theirs.device_id).not.toBe(mine.device_id);
    const row = await db.one<{ name: string; user_id: string }>(`select name, user_id from tz_devices where id = $1`, [mine.device_id]);
    expect(row!.name).toBe("رایانه‌ی مالک");
    await pull(seller, `&device_id=${mine.device_id}`);
    expect((await db.one<{ at: string | null }>(`select last_pull_at as at from tz_devices where id = $1`, [mine.device_id]))!.at).toBeNull();
    await pull(owner, `&device_id=${mine.device_id}`);
    expect((await db.one<{ at: string | null }>(`select last_pull_at as at from tz_devices where id = $1`, [mine.device_id]))!.at).not.toBeNull();
    const again = await owner.post<{ device_id: string }>("/sync/register", { org_id: org, device_id: mine.device_id, name: "رایانه‌ی مالک (نو)" });
    expect(again.device_id).toBe(mine.device_id);
  });
});

describe("custom price-source URLs: who reads them, and what writes them", () => {
  // keys written straight into a source's URL, from before {key} and key headers (Navasan's ?api_key=, a gold feed's token)
  const FX_KEY = "nav-Legacy3Month-7Q2wX9";
  const GOLD_KEY = "gold-feed-token-55aa1c";
  const FX_URL = `https://api.navasan.tech/latest/?api_key=${FX_KEY}`;
  const GOLD_URL = `https://prices.example.com/v1/gold.json?token=${GOLD_KEY}`;
  let app: App;
  let db: Db;
  let org: string;
  let owner: Client;
  let viewer: Client;
  let cashier: Client;
  let accountant: Client;
  let editor: Client;
  const stored = async () => (await db.one<{ settings: Record<string, any> }>(`select settings from tz_orgs where id = $1`, [org]))!.settings;
  const urls = (custom: { url: string }[]) => custom.map((x) => x.url);

  beforeAll(async () => {
    const s = await makeServer();
    db = s.db;
    // a network address of its own, so that sign-ups and logins here do not count against other tests
    app = { fetch: (r: Request) => (r.headers.set("x-forwarded-for", "10.61.0.2"), s.app.fetch(r)) };
    owner = new Client(app);
    org = await signupWithOrg(owner);
    await owner.put(`/o/${org}/fx/settings`, {
      providers: ["custom", "tgju"],
      custom: [
        { code: "USD", url: FX_URL, path: "usd_sell.value", unit: "base", factor: "10" },
        { code: "EUR", url: FX_URL, path: "eur.value", unit: "base", factor: "10", label: "Navasan", link: "https://navasan.tech" },
      ],
    });
    await owner.put(`/o/${org}/gold/settings`, { price_source: { url: GOLD_URL, unit: "rial", label: "طلای نمونه", paths: { gram18: "data.g18" } } });
    const member = async (email: string, full_name: string, role: string) => {
      await owner.post(`/o/${org}/members`, { email, full_name, role, password: "member-pass-1" });
      const c = new Client(app);
      await c.post("/auth/login", { email, password: "member-pass-1" });
      return c;
    };
    viewer = await member("price-viewer@example.com", "ناظر", "viewer");
    cashier = await member("price-cashier@example.com", "صندوقدار", "cashier");
    accountant = await member("price-acc@example.com", "حسابدار", "accountant");
    // a viewer who may also edit the business's settings: enough for the gold source, not for the exchange's sources
    editor = await member("price-editor@example.com", "ویرایشگر تنظیمات", "viewer");
    const { members } = await owner.get(`/o/${org}/members`);
    const id = members.find((m: { email: string }) => m.email === "price-editor@example.com").id;
    await owner.patch(`/o/${org}/members/${id}`, { overrides: { settings: "edit" } });
  });

  it("keeps the sources' URLs from members who may not change them: the business payload and the boards' settings", async () => {
    for (const c of [viewer, cashier]) {
      const info = await c.get(`/o/${org}`);
      const gold = await c.get(`/o/${org}/gold/settings`);
      const fx = await c.get(`/o/${org}/fx/settings`);
      for (const answer of [info, gold, fx]) {
        expect(JSON.stringify(answer)).not.toContain(FX_KEY);
        expect(JSON.stringify(answer)).not.toContain(GOLD_KEY);
      }
      // the sources are still there without their URLs: the boards name them and «منبع دلخواه» stays on
      expect(info.org.settings.fx.custom.map((x: { code: string; url: string }) => [x.code, x.url])).toEqual([["USD", ""], ["EUR", ""]]);
      expect(info.org.settings.fx.custom[1]).toMatchObject({ label: "Navasan", link: "https://navasan.tech" });
      expect(info.org.settings.fx).toMatchObject({ providers: ["custom", "tgju"], refresh_seconds: 60 });
      expect(info.org.settings.gold.price_source).toMatchObject({ url: "", label: "طلای نمونه", paths: { gram18: "data.g18" } });
      expect(gold.settings.price_source).toMatchObject({ url: "", label: "طلای نمونه" });
      expect(gold.price_key).toBeNull();
    }
  });

  it("still shows them to the members who manage the sources", async () => {
    for (const c of [owner, accountant]) {
      const info = await c.get(`/o/${org}`);
      expect(urls(info.org.settings.fx.custom)).toEqual([FX_URL, FX_URL]);
      expect(info.org.settings.gold.price_source.url).toBe(GOLD_URL);
      expect((await c.get(`/o/${org}/gold/settings`)).settings.price_source.url).toBe(GOLD_URL);
      expect(urls((await c.get(`/o/${org}/fx/settings`)).settings.custom)).toEqual([FX_URL, FX_URL]);
    }
    // settings:edit manages the gold source («تنظیمات قیمت و محاسبه»), the exchange's sources take fx:full
    const info = await editor.get(`/o/${org}`);
    expect(info.org.settings.gold.price_source.url).toBe(GOLD_URL);
    expect(urls(info.org.settings.fx.custom)).toEqual(["", ""]);
    expect((await editor.get(`/o/${org}/gold/settings`)).settings.price_source.url).toBe(GOLD_URL);
    // PATCH /o/:org answers with the business as the member may read it
    const patched = await editor.patch(`/o/${org}`, { phone: "02100000002" });
    expect(patched.org.phone).toBe("02100000002");
    expect(patched.org.settings.gold.price_source.url).toBe(GOLD_URL);
    expect(JSON.stringify(patched)).not.toContain(FX_KEY);
  });

  it("keeps the sync pull whole: a cashier's Windows app asks the sources itself", async () => {
    const { rev } = (await db.one<{ rev: number }>(`select rev from tz_orgs where id = $1`, [org]))!;
    const pull = await cashier.get(`/sync/pull?org_id=${org}&cursor=${Number(rev) - 1}&user_cursor=0`);
    const row = pull.aggregates.find((a: { entity: string }) => a.entity === "org").row;
    expect(urls(row.settings.fx.custom)).toEqual([FX_URL, FX_URL]);
    expect(row.settings.gold.price_source.url).toBe(GOLD_URL);
  });

  it("refuses settings.fx and settings.gold through PATCH /o/:org: only the boards' own routes write them, with their checks", async () => {
    const before = await stored();
    const fx = await owner.patch(`/o/${org}`, { settings: { fx: { custom: [{ code: "USD", url: "https://collector.example.com/usd", path: "usd" }] } } }, 400);
    expect(fx.error.message).toContain("/fx/settings");
    const gold = await owner.patch(`/o/${org}`, { settings: { gold: { price_source: { url: "https://collector.example.com/gold", paths: { gram18: "g18" } } } } }, 400);
    expect(gold.error.message).toContain("/gold/settings");
    // nor a default kept next to the sources, nor a null that would replace a whole group
    await owner.patch(`/o/${org}`, { settings: { fx: { refresh_seconds: 5 } } }, 400);
    await accountant.patch(`/o/${org}`, { settings: { gold: null, vat_pct: "10" } }, 400);
    expect(await stored()).toEqual(before);
    // the business's own settings still save, and leave the boards' settings as they were
    await owner.patch(`/o/${org}`, { settings: { vat_pct: "10", timezone: "Asia/Tehran" } });
    const after = await stored();
    expect(after).toMatchObject({ vat_pct: "10", timezone: "Asia/Tehran" });
    expect(after.fx).toEqual(before.fx);
    expect(after.gold).toEqual(before.gold);
    // the business settings page saves the boards' defaults through their own routes: checked, and the sources kept
    await owner.put(`/o/${org}/fx/settings`, { refresh_seconds: 5 }, 400);
    await owner.put(`/o/${org}/fx/settings`, { margin_pct: "1", refresh_seconds: 30 });
    await owner.put(`/o/${org}/gold/settings`, { profit_pct: "8" });
    const saved = await stored();
    expect(saved.fx).toMatchObject({ margin_pct: "1", refresh_seconds: 30 });
    expect(urls(saved.fx.custom)).toEqual([FX_URL, FX_URL]);
    expect(saved.gold).toMatchObject({ profit_pct: "8", price_source: { url: GOLD_URL } });
    // without «صرافی: کامل» the exchange's defaults stay closed (the page shows them disabled), the gold ones do not
    await editor.put(`/o/${org}/fx/settings`, { margin_pct: "2" }, 403);
    await editor.put(`/o/${org}/gold/settings`, { profit_pct: "9" });
  });
});
