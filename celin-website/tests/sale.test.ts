import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeJar } from "./stubs/fake-db";
import { common } from "@/content/copy/common";
import { formatJalaliDay, parseJalali, tehranDayEnd, tehranDayStart, toJalali } from "@/lib/jalali";
import { contrast, INK_LUMINANCE, inkFor, liveSale, luminance, ON_NIGHT_LUMINANCE, OPEN_END, saleBar, saleState, TONE_CLASS } from "@/lib/sale";
import { DEFAULT_SETTINGS, type SaleSettings } from "@/lib/settings-types";

/**
 * The special-day discount: when it runs (from inclusive, until exclusive, the server's clock), who gets it, the
 * bar's colours and words, the Jalali days of the admin form, the admin action, and the order action sending the
 * sale and the confirmed total to celin_place_order (in memory, tests/stubs/fake-db.ts).
 */

const h = vi.hoisted(() => ({ db: null as unknown, jar: null as unknown, headers: {} as Record<string, string> }));

vi.mock("next/headers", () => ({ cookies: async () => h.jar, headers: async () => new Headers(h.headers) }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return { ...real, db: () => h.db };
});

const T0 = Date.parse("2026-12-20T20:30:00Z"); // 1405/09/30 00:00 in Tehran
const DAY = 86_400_000;
const sale = (over: Partial<SaleSettings> = {}): SaleSettings => ({ ...DEFAULT_SETTINGS.sale, enabled: true, pct: 10, title_fa: "جشن یلدا", title_en: "Yalda", ...over });

describe("when the special-day discount runs", () => {
  const s = sale({ from: new Date(T0).toISOString(), until: new Date(T0 + 3 * DAY).toISOString() });

  it("from the first moment of the first day until the first moment after the last", () => {
    expect(saleState(s, T0 - 1)).toBe("soon");
    expect(saleState(s, T0)).toBe("live");
    expect(saleState(s, T0 + 3 * DAY - 1)).toBe("live");
    expect(saleState(s, T0 + 3 * DAY)).toBe("over");
    expect(saleState(sale(), 0)).toBe("live"); // open ends: from now on, until switched off
  });

  it("is off when switched off or without a percentage the database accepts", () => {
    expect(saleState({ ...s, enabled: false }, T0)).toBe("off");
    expect(saleState({ ...s, pct: 0 }, T0)).toBe("off");
    expect(saleState({ ...s, pct: 91 }, T0)).toBe("off");
  });

  it("applies to members, and to Pro accounts only when the admin includes them", () => {
    expect(liveSale(s, "member", T0)).toEqual({ pct: 10, title_fa: "جشن یلدا", title_en: "Yalda", until: s.until });
    expect(liveSale(s, "pro", T0)).not.toBeNull();
    expect(liveSale({ ...s, pro: false }, "pro", T0)).toBeNull();
    expect(liveSale({ ...s, pro: false }, "member", T0)).not.toBeNull();
    expect(liveSale(s, "member", T0 + 3 * DAY)).toBeNull();
  });
});

describe("the bar", () => {
  it("carries words, percentage, colour and window — the English falls back to the Persian", () => {
    const s = sale({ title_en: "", text_fa: "روی همه‌ی آثار", from: new Date(T0).toISOString() });
    const fa = saleBar(s, "fa", T0 - DAY, common.fa.sale)!;
    expect(fa).toMatchObject({ headline: "جشن یلدا · ۱۰٪ تخفیف", text: "روی همه‌ی آثار", from: T0, until: OPEN_END, live: false });
    expect(saleBar(s, "en", T0, common.en.sale)).toMatchObject({ headline: "جشن یلدا · 10% off", text: "روی همه‌ی آثار", live: true });
    expect(saleBar(sale({ title_fa: "", title_en: "" }), "fa", T0, common.fa.sale)?.headline).toBe("۱۰٪ تخفیف روزهای خاص");
    expect(saleBar(sale({ title_fa: "", title_en: "" }), "en", T0, common.en.sale)?.headline).toBe("10% special-day discount");
    expect(JSON.stringify(fa)).not.toMatch(/price|stock/i);
  });

  it("is left out once the sale is over or off", () => {
    expect(saleBar(sale({ until: new Date(T0).toISOString() }), "fa", T0, common.fa.sale)).toBeNull();
    expect(saleBar(sale({ enabled: false }), "fa", T0, common.fa.sale)).toBeNull();
  });

  it("offers only brand grounds on which the text reads at 7:1 or better (measured from globals.css)", () => {
    const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
    const token = (name: string) => /#[0-9a-f]{6}/i.exec(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1] ?? "")?.[0] ?? "";
    expect(luminance(token("ink"))).toBeCloseTo(INK_LUMINANCE, 4);
    expect(luminance(token("on-night"))).toBeCloseTo(ON_NIGHT_LUMINANCE, 4);
    for (const cls of Object.values(TONE_CLASS)) {
      const [bg, fg] = [/bg-([a-z-]+)/.exec(cls)![1], /text-([a-z-]+)/.exec(cls)![1]];
      expect(token(bg), bg).not.toBe("");
      expect(contrast(luminance(token(bg)), luminance(token(fg))), cls).toBeGreaterThanOrEqual(7);
    }
  });

  it("picks the better text colour on the admin's own colour and says how well it reads", () => {
    expect(inkFor("#f4e9db").ink).toBe("dark");
    expect(inkFor("#0b3a39").ink).toBe("light");
    expect(inkFor("#9c5e34").ratio).toBeLessThan(4.5); // the logo's copper: warned
    expect(inkFor("nonsense").ratio).toBe(0);
  });

  it("the stylesheet lets one bar show at a time and makes room for it", () => {
    const css = readFileSync(path.resolve(__dirname, "../src/app/globals.css"), "utf8");
    expect(css).toContain('html[data-sale="on"]:has([data-sale-bar]) [data-announcement]');
    expect(css).toContain('html:not([data-sale]) [data-sale-bar]:not([data-live])');
    expect(css).toMatch(/html\[data-sale="on"\]:has\(\[data-sale-bar\]\),[\s\S]*--announce-h: 2rem/);
  });
});

describe("Jalali days in Tehran", () => {
  it("starts a day at Tehran's midnight and knows the days that do not exist", () => {
    expect(tehranDayStart(1405, 9, 30)).toBe(T0);
    expect(tehranDayEnd(1405, 9, 30)).toBe(T0 + DAY);
    expect(tehranDayEnd(1405, 12, 29)).toBe(tehranDayStart(1406, 1, 1));
    expect(tehranDayStart(1403, 12, 30)).not.toBeNull(); // a leap year
    expect(tehranDayStart(1404, 12, 30)).toBeNull();
    expect(tehranDayStart(1405, 7, 31)).toBeNull();
    expect(tehranDayStart(1405, 13, 1)).toBeNull();
  });

  it("reads Persian or Latin digits and writes the form's day back", () => {
    expect(parseJalali("۱۴۰۵/۰۹/۳۰")).toEqual({ jy: 1405, jm: 9, jd: 30 });
    expect(parseJalali("1405-9-30")).toEqual({ jy: 1405, jm: 9, jd: 30 });
    expect(parseJalali("1404/12/30")).toBeNull();
    expect(parseJalali("30/09/1405")).toBeNull();
    expect(formatJalaliDay(toJalali(T0), "fa")).toBe("۱۴۰۵/۰۹/۳۰");
    expect(formatJalaliDay(toJalali(T0 - 1), "en")).toBe("1405/09/29");
  });

  it("round-trips every day of three years", () => {
    const start = tehranDayStart(1404, 1, 1)!;
    for (let t = start; t < start + 3 * 366 * DAY; t += DAY) {
      const d = toJalali(t + 12 * 3_600_000);
      expect(tehranDayStart(d.jy, d.jm, d.jd)).toBe(t);
    }
  });
});

// ------------------------------------------------------------------ the server side

let fake: FakeDb;
let jar: FakeJar;

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
});

beforeEach(() => {
  fake = new FakeDb();
  fake.rpcs.celin_hit_rate_limit = () => ({ data: true, error: null });
  h.db = fake;
  jar = new FakeJar();
  h.jar = jar;
  h.headers = { "x-forwarded-for": "198.51.100.7" };
});

function account(over: Record<string, unknown> = {}) {
  const row = { id: crypto.randomUUID(), phone: "09121110000", email: "", name: "QA", business: "", city: "", address: "", postal_code: "", role: "user", disabled: false, session_version: 0, password_hash: "scrypt$x", password_from_code: false, created_by_admin: false, admin_note: "", pro_at: null, created_at: new Date().toISOString(), ...over };
  fake.table("celin_users").push(row);
  return row;
}

async function signIn(u: { id: string; session_version: number }) {
  const { sessionValue } = await import("@/lib/auth");
  jar.set("celin_session", sessionValue(u.id, u.session_version, Date.now(), "pw"));
}

describe("Admin → «نوار تخفیف روزهای خاص»", async () => {
  const { saveSale, resetSettingsGroup } = await import("@/app/actions/admin");
  const stored = () => fake.table("celin_settings").find((r) => r.key === "sale")?.value as SaleSettings | undefined;

  it("goes through guard(): no admin, nothing saved", async () => {
    expect(await saveSale({ enabled: true, pct: 10 })).toMatchObject({ ok: false });
    expect(stored()).toBeUndefined();
  });

  it("stores whole Tehran days, the colour and the words", async () => {
    await signIn(account({ role: "admin", phone: "09121119999" }));
    const r = await saveSale({ enabled: true, pct: "۱۵", title_fa: " جشن یلدا ", title_en: "Yalda", text_fa: "روی همه‌ی آثار", tone: "custom", color: "#0B3A39", from: "۱۴۰۵/۰۹/۳۰", until: "1405/10/02", pro: false, link: "/shop" });
    expect(r).toMatchObject({ ok: true });
    expect(stored()).toEqual({
      enabled: true,
      pct: 15,
      title_fa: "جشن یلدا",
      title_en: "Yalda",
      text_fa: "روی همه‌ی آثار",
      text_en: "",
      tone: "custom",
      color: "#0b3a39",
      from: new Date(T0).toISOString(),
      until: new Date(T0 + 3 * DAY).toISOString(),
      pro: false,
      link: "/shop",
    });
  });

  it("refuses what would not work, with a message", async () => {
    await signIn(account({ role: "admin", phone: "09121119998" }));
    expect(await saveSale({ enabled: true, pct: 0 })).toMatchObject({ ok: false, error: "درصد تخفیف را بین ۱ تا ۹۰ بنویسید." });
    expect(await saveSale({ enabled: true, pct: 95 })).toMatchObject({ ok: true }); // capped at 90
    expect(stored()?.pct).toBe(90);
    expect(await saveSale({ enabled: true, pct: 10, from: "1404/12/30" })).toMatchObject({ ok: false });
    expect(await saveSale({ enabled: true, pct: 10, from: "1405/10/02", until: "1405/09/30" })).toMatchObject({ ok: false, error: "روز پایان نباید پیش از روز شروع باشد." });
    expect(await saveSale({ enabled: true, pct: 10, tone: "custom", color: "red" })).toMatchObject({ ok: false });
    expect(await saveSale({ enabled: true, pct: 10, link: "//evil.example" })).toMatchObject({ ok: false });
    expect(await saveSale({ enabled: false, pct: "", tone: "nonsense" })).toMatchObject({ ok: true, message: expect.stringContaining("خاموش") });
    expect(stored()).toMatchObject({ enabled: false, pct: 10, tone: "pomegranate" });
    expect(await resetSettingsGroup({ key: "sale" })).toMatchObject({ ok: true });
    expect(stored()).toEqual(DEFAULT_SETTINGS.sale);
  });
});

describe("placing an order with the special-day discount", async () => {
  const { placeOrder } = await import("@/app/actions/orders");
  const P1 = "33333333-3333-4333-8333-333333333333";
  const P2 = "44444444-4444-4444-8444-444444444444";
  const customer = { name: "QA", phone: "09121234567", city: "Tehran", address: "Street 1, No 2" };
  let sent: Record<string, unknown> | null;

  async function member(over: Record<string, unknown> = {}) {
    const u = account(over);
    const { codeHashes, encrypt, normalizeCode } = { ...(await import("@/lib/pro")), ...(await import("@/lib/crypto")) };
    const norm = normalizeCode("123456789012");
    fake.table("celin_pro_codes").push({ id: crypto.randomUUID(), user_id: u.id, code_hash: codeHashes(norm)[0], code_enc: encrypt("123456789012"), hint: "9012", request_id: null, expires_at: null, redeemed_at: new Date().toISOString(), last_used_at: null, revoked_at: null, created_at: new Date().toISOString() });
    await signIn(u);
    return u;
  }

  function shop(s?: Partial<SaleSettings>) {
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
    if (s) fake.table("celin_settings").push({ key: "sale", value: sale(s) });
    fake.table("celin_products").push({ id: P1, price: 1_000_000, stock: 50, status: "published" }, { id: P2, price: 700_000, stock: 50, status: "published" });
    sent = null;
    fake.rpcs.celin_place_order = (a) => {
      sent = a;
      return { data: [{ order_id: crypto.randomUUID(), order_code: "CL-123456" }], error: null };
    };
  }

  const lines = [
    { productId: P1, variantId: null, qty: 4 },
    { productId: P2, variantId: null, qty: 3 },
  ];
  // 7 pieces of two designs → the 6-piece step (150%) for the whole order, then 10% off every piece
  const stepped = 1_500_000 * 4 + 1_050_000 * 3;
  const withSale = 1_350_000 * 4 + 945_000 * 3;

  it("sends the sale and the confirmed total; the database checks it", async () => {
    shop({});
    await member();
    const r = await placeOrder({ lines, customer, seen: withSale, lang: "fa" });
    expect(r).toMatchObject({ ok: true, code: "CL-123456" });
    expect(sent).toMatchObject({ p_expect: withSale, p_pricing: { level: "member", list: 200, sale: { pct: 10, fa: "جشن یلدا", en: "Yalda" } }, p_items: [{ qty: 4 }, { qty: 3 }] });
  });

  it("a sale that ended while the basket was open: the server's clock decides, with a clear message", async () => {
    shop({ until: new Date(Date.now() - 60_000).toISOString() });
    await member();
    const r = await placeOrder({ lines, customer, seen: withSale, lang: "fa" });
    expect(r).toMatchObject({ ok: false, reason: "price_changed", error: expect.stringContaining("تخفیف روزهای خاص همین حالا به پایان رسید") });
    expect(sent).toBeNull();
    // confirming the new total places it, without the sale
    expect(await placeOrder({ lines, customer, seen: stepped, lang: "fa" })).toMatchObject({ ok: true });
    expect(sent).toMatchObject({ p_expect: stepped });
    expect((sent as { p_pricing: object }).p_pricing).not.toHaveProperty("sale");
  });

  it("a sale that began while the basket was open says so too", async () => {
    shop({});
    await member();
    expect(await placeOrder({ lines, customer, seen: stepped, lang: "en" })).toMatchObject({ ok: false, reason: "price_changed", error: expect.stringContaining("has just begun") });
  });

  it("Pro accounts get it only when the admin includes them", async () => {
    shop({ pro: false });
    await member({ pro_at: new Date().toISOString() });
    expect(await placeOrder({ lines, customer, seen: 1_000_000 * 4 + 700_000 * 3, lang: "fa" })).toMatchObject({ ok: true });
    expect((sent as { p_pricing: object }).p_pricing).not.toHaveProperty("sale");
  });

  it("the database's own total wins: 'price_changed' reads as a price change", async () => {
    shop();
    await member();
    fake.rpcs.celin_place_order = () => ({ data: null, error: { message: "price_changed" } });
    expect(await placeOrder({ lines, customer, seen: stepped, lang: "fa" })).toMatchObject({ ok: false, reason: "price_changed", error: expect.stringContaining("قیمت یکی از اقلام") });
  });
});
