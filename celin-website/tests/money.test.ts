import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeJar } from "./stubs/fake-db";

/**
 * Money paths after round six's review: every option of a long catalogue reaches the price book, the catalogue and
 * the admin (PostgREST returns at most 1000 rows per request — the fake db does the same).
 */

const h = vi.hoisted(() => ({ db: null as unknown, jar: null as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => h.jar, headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7" }) }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined, refresh: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return { ...real, db: () => h.db, requireDb: () => h.db };
});

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
});

async function admin() {
  const row = { id: crypto.randomUUID(), phone: "09121116666", email: "", name: "Admin", business: "", city: "", address: "", postal_code: "", role: "admin", disabled: false, session_version: 0, password_hash: "scrypt$x", password_from_code: false, created_by_admin: false, admin_note: "", pro_at: null, created_at: new Date().toISOString() };
  fake.table("celin_users").push(row);
  const { sessionValue } = await import("@/lib/auth");
  jar.set("celin_session", sessionValue(row.id, 0, Date.now(), "pw"));
}

const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");
const pid = (i: number) => `00000000-0000-4000-8000-${hex(i, 12)}`;
const vid = (i: number, j: number) => `${hex(i, 8)}-${hex(j, 4)}-4000-8000-000000000000`;
const product = (i: number) => ({ id: pid(i), slug: `p-${i}`, sku: "", name_fa: `p${i}`, name_en: `p${i}`, subtitle_fa: "", subtitle_en: "", description_fa: "", description_en: "", category_id: null, collection_id: null, metal: "", stone: "", specs: [], images: [], price: 1_000, stock: 0, status: "published", featured: false, badge: "", sort: i, created_at: "2026-11-28T00:00:00Z", updated_at: "2026-11-28T00:00:00Z", packs: [1] });
const variant = (i: number, j: number) => ({ id: vid(i, j), product_id: pid(i), name_fa: `v${j}`, name_en: `v${j}`, swatch: "gold", sku: "", price: 1_000 + j, stock: j % 7, image_id: null, sort: j, options: {} });

/** 12 published products × 100 combinations (the most a product may have): 1200 rows, more than one request returns */
function longCatalogue() {
  fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
  for (let i = 0; i < 12; i++) {
    fake.table("celin_products").push(product(i));
    for (let j = 0; j < 100; j++) fake.table("celin_variants").push(variant(i, j));
  }
}

describe("a catalogue with more options than one request returns", () => {
  it("the fake db caps a read like PostgREST, silently", async () => {
    longCatalogue();
    const { data, error } = await fake.from("celin_variants").select("id");
    expect(error).toBeNull();
    expect((data as unknown[]).length).toBe(1000);
  });

  it("the price book has every combination's price and stock", async () => {
    longCatalogue();
    const { proPrices } = await import("@/lib/catalog");
    const book = await proPrices();
    expect(Object.keys(book)).toHaveLength(12);
    expect(Object.values(book).reduce((n, p) => n + Object.keys(p.variants).length, 0)).toBe(1200);
    expect(book[pid(11)].variants[vid(11, 99)]).toEqual({ price: 1_099, stock: 99 % 7 });
    expect(fake.reads.celin_variants).toBeGreaterThan(1); // page by page
  });

  it("the public catalogue has every combination, each product's in its own order", async () => {
    longCatalogue();
    const { getCatalog } = await import("@/lib/catalog");
    const cat = await getCatalog();
    expect(cat.products).toHaveLength(12);
    for (const p of cat.products) expect(p.variants.map((v) => v.sort)).toEqual([...Array(100).keys()]);
  });

  it("keeps reading plain options before round six's database file", async () => {
    longCatalogue();
    fake.columns.celin_variants = ["id", "product_id", "name_fa", "name_en", "swatch", "sku", "price", "stock", "image_id", "sort"];
    const { getCatalog } = await import("@/lib/catalog");
    const cat = await getCatalog();
    expect(cat.products.reduce((n, p) => n + p.variants.length, 0)).toBe(1200);
    expect(cat.products[0].variants[0].options).toEqual({});
  });

  it("the admin's product list and the dashboard's low-stock count see every option", async () => {
    longCatalogue();
    // the last combination of the last product is the only one at 0; the rest at 5 or more
    for (const v of fake.table("celin_variants")) v.stock = 5;
    fake.table("celin_variants").find((v) => v.id === vid(11, 99))!.stock = 0;
    await admin();
    const { listAdminProducts, lowStockCount } = await import("@/lib/admin-catalog");
    const list = (await listAdminProducts())!;
    expect(list.every((p) => p.variants === 100)).toBe(true);
    expect(list.find((p) => p.id === pid(11))).toMatchObject({ stock: 495, min_stock: 0 });
    expect(await lowStockCount(3)).toBe(1);
  });
});

describe("ordering before round six's database file has run", async () => {
  const { placeOrder } = await import("@/app/actions/orders");
  const P1 = "33333333-3333-4333-8333-333333333333";
  const customer = { name: "QA", phone: "09121234567", city: "Tehran", address: "Street 1, No 2" };
  let calls: Record<string, unknown>[];

  async function member() {
    const u = { id: crypto.randomUUID(), phone: "09121115555", email: "", name: "QA", business: "", city: "", address: "", postal_code: "", role: "user", disabled: false, session_version: 0, password_hash: "scrypt$x", password_from_code: false, created_by_admin: false, admin_note: "", pro_at: null, created_at: new Date().toISOString() };
    fake.table("celin_users").push(u);
    const { codeHashes, normalizeCode } = await import("@/lib/pro");
    const { encrypt } = await import("@/lib/crypto");
    fake.table("celin_pro_codes").push({ id: crypto.randomUUID(), user_id: u.id, code_hash: codeHashes(normalizeCode("123456789012"))[0], code_enc: encrypt("123456789012"), hint: "9012", request_id: null, expires_at: null, redeemed_at: new Date().toISOString(), last_used_at: null, revoked_at: null, created_at: new Date().toISOString() });
    const { sessionValue } = await import("@/lib/auth");
    jar.set("celin_session", sessionValue(u.id, 0, Date.now(), "pw"));
  }

  /** the database as round five left it: only the five-argument function (no p_expect) */
  function roundFive(sale = false) {
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
    if (sale) fake.table("celin_settings").push({ key: "sale", value: { enabled: true, pct: 10, title_fa: "جشن یلدا", title_en: "Yalda", text_fa: "", text_en: "", tone: "pomegranate", color: "", from: "", until: "", pro: true, link: "" } });
    fake.table("celin_products").push({ id: P1, price: 1_000_000, stock: 50, status: "published" });
    calls = [];
    fake.rpcs.celin_place_order = (a) => {
      calls.push(a);
      if ("p_expect" in a) return { data: null, error: { message: "Could not find the function public.celin_place_order(p_customer, p_expect, p_items, p_note, p_pricing, p_user)", code: "PGRST202" } };
      return { data: [{ order_id: crypto.randomUUID(), order_code: "CL-555555" }], error: null };
    };
  }

  it("single pieces without a sale go to round five's function, as the site ordered before", async () => {
    roundFive();
    await member();
    const r = await placeOrder({ lines: [{ productId: P1, variantId: null, qty: 3 }], customer, lang: "fa" });
    expect(r).toMatchObject({ ok: true, code: "CL-555555" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toHaveProperty("p_expect");
    expect(calls[1]).not.toHaveProperty("p_expect");
    expect(calls[1]).toMatchObject({ p_items: [{ product_id: P1, variant_id: "", qty: 3 }], p_pricing: { level: "member", list: 200 } });
    expect((calls[1].p_items as object[])[0]).not.toHaveProperty("pack");
    expect(calls[1].p_pricing).not.toHaveProperty("sale");
  });

  it("the older function's own refusals read as usual", async () => {
    roundFive();
    await member();
    fake.rpcs.celin_place_order = (a) => ("p_expect" in a ? { data: null, error: { message: "missing", code: "PGRST202" } } : { data: null, error: { message: `out_of_stock:${P1}` } });
    expect(await placeOrder({ lines: [{ productId: P1, variantId: null, qty: 3 }], customer, lang: "fa" })).toMatchObject({ ok: false, reason: "out_of_stock", itemId: P1 });
  });

  it("packs need the new function: «not set up yet», and nothing goes to the older one", async () => {
    roundFive();
    await member();
    const r = await placeOrder({ lines: [{ productId: P1, variantId: null, qty: 2, pack: 4 }], customer, lang: "fa" });
    expect(r).toMatchObject({ ok: false, reason: "unavailable", error: expect.stringContaining("راه‌اندازی نشده") });
    expect(calls).toHaveLength(1);
  });

  it("so does a running special-day discount", async () => {
    roundFive(true);
    await member();
    const r = await placeOrder({ lines: [{ productId: P1, variantId: null, qty: 3 }], customer, lang: "en" });
    expect(r).toMatchObject({ ok: false, reason: "unavailable", error: expect.stringContaining("not set up yet") });
    expect(calls).toHaveLength(1);
  });

  it("with neither function there, ordering reads as «not set up yet»", async () => {
    roundFive();
    await member();
    fake.rpcs.celin_place_order = (a) => {
      calls.push(a);
      return { data: null, error: { message: "missing", code: "PGRST202" } };
    };
    expect(await placeOrder({ lines: [{ productId: P1, variantId: null, qty: 3 }], customer, lang: "fa" })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(calls).toHaveLength(2);
  });

  it("once the file has run, only the new function is called", async () => {
    roundFive();
    await member();
    fake.rpcs.celin_place_order = (a) => {
      calls.push(a);
      return { data: [{ order_id: crypto.randomUUID(), order_code: "CL-666666" }], error: null };
    };
    expect(await placeOrder({ lines: [{ productId: P1, variantId: null, qty: 3 }], customer, lang: "fa" })).toMatchObject({ ok: true, code: "CL-666666" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveProperty("p_expect");
  });
});

describe("the basket: a single line and pack lines of one option share its stock", async () => {
  const { lineRoom, realCount } = await import("@/lib/basket");
  const { maxPacks, packCap } = await import("@/lib/packs");
  const { accountCopy } = await import("@/content/copy/account");
  const exact = { showStock: true, stockDisplay: "exact" as const, lowStock: 3 };
  const level = { showStock: true, stockDisplay: "level" as const, lowStock: 150 };
  const member = { showStock: false, stockDisplay: "exact" as const, lowStock: 0 };
  const singles = { productId: "p", variantId: "v", qty: 99, pack: 1 };
  const packs = { productId: "p", variantId: "v", qty: 24, pack: 4 };
  const other = { productId: "p", variantId: "w", qty: 50, pack: 1 };

  it("a Pro account's count is real at any size; a member's «orderable» never is", () => {
    expect(realCount(120, exact)).toBe(true);
    expect(realCount(99, exact)).toBe(true);
    expect(realCount(120, level)).toBe(true); // at or below the low-stock line: a count
    expect(realCount(151, level)).toBe(false); // above it: «plenty», not a count
    expect(realCount(99, member)).toBe(false);
  });

  it("Pro, stock 120, 99 singles: the 4-size pack line has room for 21 pieces (5 packs), not 24 packs", () => {
    const lines = [singles, packs, other];
    const r = lineRoom(lines, packs, 120, exact);
    expect(r).toEqual({ others: 99, room: 21 });
    expect(maxPacks(4, r.room)).toBe(5);
    expect(Math.min(packCap(4), maxPacks(4, r.room))).toBe(5); // the stepper's ceiling
    expect(packs.qty * packs.pack > r.room).toBe(true); // marked «over», with «تغییر به ۵ بسته»
    expect(lineRoom(lines, singles, 120, exact)).toEqual({ others: 96, room: 24 });
    // another option keeps its own stock
    expect(lineRoom(lines, other, 120, exact)).toEqual({ others: 0, room: 120 });
  });

  it("members: «orderable» is not a count — the database checks the order", () => {
    expect(lineRoom([singles, packs], packs, 99, member)).toEqual({ others: 0, room: 99 });
  });

  it("the message says the stock and what the other lines already hold", () => {
    expect(accountCopy("fa").cart.overShared("۱۲۰", "۹۹")).toBe("فقط ۱۲۰ عدد موجود است؛ اقلام دیگر همین گزینه ۹۹ عدد دارند");
    expect(accountCopy("en").cart.overShared("120", "99")).toBe("Only 120 in stock; your other lines of this option hold 99");
    expect(accountCopy("en").cart.overShared("120", "1")).toBe("Only 120 in stock; your other lines of this option hold 1");
  });

  it("stock dropped below what the other lines hold: room 0, no fix button, and the message does not claim the others hold part of the stock", () => {
    // Pro, stock 50, 99 singles + 3 four-size packs (the stock was lowered after the lines were added)
    const few = { productId: "p", variantId: "v", qty: 3, pack: 4 };
    const lines = [singles, few];
    const r = lineRoom(lines, few, 50, exact);
    expect(r).toEqual({ others: 99, room: 0 });
    expect(maxPacks(4, r.room)).toBe(0); // no «تغییر به … بسته»: the other lines must come down
    expect(lineRoom(lines, singles, 50, exact)).toEqual({ others: 12, room: 38 }); // «تغییر به ۳۸» there
    for (const lang of ["fa", "en"] as const) {
      const text = accountCopy(lang).cart.overShared("50", "99");
      expect(text).not.toMatch(/of them|عدد آن/);
      expect(text).toContain("50");
      expect(text).toContain("99");
    }
  });
});

describe("a pack product's price says it is one piece's", async () => {
  const { packNotes } = await import("@/components/pro/price-slot");
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");

  it("«هر عدد» wherever the price of a piece bought in packs shows; the pack's price on the product page only", () => {
    expect(packNotes("pdp", 4, 1_000_000)).toEqual({ perPiece: true, perPack: true });
    expect(packNotes("card", 4, 1_000_000)).toEqual({ perPiece: true, perPack: false }); // the phone's action bar
    expect(packNotes("card", 1, 1_000_000)).toEqual({ perPiece: false, perPack: false }); // single, and the product cards
    expect(packNotes("pdp", 4, null)).toEqual({ perPiece: false, perPack: false }); // «استعلام قیمت»
  });

  it("the phone's action bar passes the pack being chosen", () => {
    const src = readFileSync(path.join(__dirname, "../src/components/product/product-client.tsx"), "utf8");
    const bar = src.slice(src.indexOf("phone: sticky action bar"));
    expect(bar).toMatch(/<PriceSlot [^>]*qty=\{qty \* pack\} pack=\{pack\}/);
  });
});
