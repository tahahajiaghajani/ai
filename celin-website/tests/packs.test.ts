import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeJar } from "./stubs/fake-db";
import { basketPieces, invoiceLines, linePieces } from "@/lib/basket";
import type { ProPrices } from "@/lib/catalog-types";
import { cleanLines, parsePlaceError } from "@/lib/orders";
import { cleanPack, cleanPacks, maxPacks, packCap, packsOf, packTerms, singleOnly } from "@/lib/packs";
import { DEFAULT_STEPS, invoice, pricingFor } from "@/lib/pricing";
import { commonCopy } from "@/content/copy/common";

/**
 * Ring packs (round six): a product is sold single and/or in packs of 2–5 sizes (N pieces of the model in N sizes,
 * N × the piece's price). A basket line holds packs; everything that counts — the quantity step, stock, the invoice
 * and celin_place_order — counts pieces. Old baskets (no pack) stay single. The admin's choice is checked and saved,
 * and a database before round six reads as single and refuses only a real pack.
 */

const h = vi.hoisted(() => ({ db: null as unknown, jar: null as unknown, headers: {} as Record<string, string>, later: [] as (() => unknown)[], team: [] as string[] }));

vi.mock("next/headers", () => ({ cookies: async () => h.jar, headers: async () => new Headers(h.headers) }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void h.later.push(fn) }));
vi.mock("@/lib/notify", () => ({ notifyTeam: async (text: string) => void h.team.push(text) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return { ...real, db: () => h.db, requireDb: () => h.db };
});

const P1 = "33333333-3333-4333-8333-333333333333";
const P2 = "44444444-4444-4444-8444-444444444444";
const V1 = "66666666-6666-4666-8666-666666666666";
const member = pricingFor("member", { memberPct: 200, steps: DEFAULT_STEPS });

describe("how a piece is sold", () => {
  it("keeps the packs the database accepts", () => {
    expect(cleanPack(4)).toBe(4);
    expect(cleanPack("3")).toBe(3);
    for (const bad of [0, 6, 2.5, "x", null, undefined, -1]) expect(cleanPack(bad)).toBe(1);
    expect(cleanPacks([4, 1, 4, 0, 6, "x", 2.5, "2", 5])).toEqual([1, 2, 4, 5]);
    expect(cleanPacks([])).toEqual([]);
    expect(cleanPacks("1,2")).toEqual([]);
    expect(packsOf(null)).toEqual([1]);
    expect(packsOf([9])).toEqual([1]);
    expect(packsOf([4])).toEqual([4]);
  });

  it("single only needs nothing shown", () => {
    expect(singleOnly([1])).toBe(true);
    expect(singleOnly(undefined)).toBe(true);
    expect(singleOnly([4])).toBe(false);
    expect(singleOnly([1, 3])).toBe(false);
  });

  it("a line holds at most 99 pieces: 19 five-size packs", () => {
    expect(packCap(1)).toBe(99);
    expect(packCap(4)).toBe(24);
    expect(packCap(5)).toBe(19);
    expect(maxPacks(4, 13)).toBe(3);
    expect(maxPacks(4, 3)).toBe(0);
    expect(maxPacks(1, 7)).toBe(7);
    expect(maxPacks(5, 500)).toBe(19);
    expect(maxPacks(2, -4)).toBe(0);
  });

  it("says how it is sold in a few words, in both languages", () => {
    expect(packTerms([4], "fa")).toBe("فقط بسته‌ی ۴ سایزی");
    expect(packTerms([1, 3], "fa")).toBe("تک یا بسته‌ی ۳ سایزی");
    expect(packTerms([1, 2, 5], "fa")).toBe("تک، بسته‌ی ۲ سایزی یا بسته‌ی ۵ سایزی");
    expect(packTerms([1], "fa")).toBe("فقط تک");
    expect(packTerms([4], "en")).toBe("4-size pack only");
    expect(packTerms([1, 3], "en")).toBe("Single or 3-size pack");
    expect(commonCopy("fa").pack.line("۳", "۴", "۱۲")).toBe("۳ بسته‌ی ۴ سایزی · ۱۲ عدد");
    expect(commonCopy("en").pack.line("3", "4", "12")).toBe("3 × 4-size pack · 12 pieces");
  });
});

describe("packs count as pieces", () => {
  const prices: ProPrices = {
    [P1]: { price: 1_000_000, stock: 50, variants: {} },
    [P2]: { price: 700_000, stock: 50, variants: { [V1]: { price: null, stock: 20 } } },
  };

  it("a line of packs holds packs × sizes pieces; an old line (no pack) is single", () => {
    expect(linePieces({ qty: 3, pack: 4 })).toBe(12);
    expect(linePieces({ qty: 3 })).toBe(3);
    expect(basketPieces([{ qty: 3, pack: 4 }, { qty: 2, pack: 1 }, { qty: 1 }])).toBe(15);
  });

  it("3 four-size packs (12 pieces) take the whole order to the 11-piece step, rounded per piece", () => {
    const lines = [{ productId: P1, variantId: null, qty: 3, pack: 4 }];
    const items = invoiceLines(lines, prices);
    expect(items).toEqual([{ price: 1_000_000, qty: 12 }]);
    const bill = invoice(items, member);
    expect(bill).toMatchObject({ pieces: 12, pct: 130, off: 35, list: 24_000_000, total: 15_600_000 });
    // one pack and singles of another design count together
    const mixed = invoice(invoiceLines([{ productId: P1, variantId: null, qty: 1, pack: 5 }, { productId: P2, variantId: V1, qty: 1, pack: 1 }], prices), member);
    expect(mixed).toMatchObject({ pieces: 6, pct: 150 });
  });
});

describe("basket lines from the browser", () => {
  it("merges only lines of the same pack, caps each at 99 pieces, and reads a missing or odd pack as single", () => {
    const lines = cleanLines([
      { productId: P1, variantId: null, qty: 2, pack: 4 },
      { productId: P1, variantId: null, qty: 3, pack: 4 },
      { productId: P1, variantId: null, qty: 2 },
      { productId: P1, variantId: null, qty: 1, pack: 9 },
      { productId: P2, variantId: V1, qty: 50, pack: 5 },
    ]);
    expect(lines).toEqual([
      { productId: P1, variantId: null, qty: 3, pack: 1 },
      { productId: P1, variantId: null, qty: 5, pack: 4 },
      { productId: P2, variantId: V1, qty: 19, pack: 5 },
    ]);
  });

  it("explains what the database refuses", () => {
    expect(parsePlaceError(`pack_unavailable:${P1}`)).toEqual({ reason: "pack_unavailable", id: P1 });
    expect(parsePlaceError("bad_pack")).toEqual({ reason: "failed" });
  });
});

describe("the browser's basket", () => {
  const store = new Map<string, string>();
  beforeAll(() => {
    Object.assign(globalThis, {
      window: { addEventListener: () => undefined },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
    });
    // a basket saved before round six: lines without a pack
    store.set("celin-cart-v1", JSON.stringify([{ productId: P1, variantId: null, qty: 2 }, { productId: P1, variantId: null, qty: 1, pack: 1 }]));
  });

  it("keeps an old basket (single), and keeps a pack and a single of the same option apart", async () => {
    const { cart } = await import("@/components/cart/cart-store");
    cart.add(P2, V1, 1, 4); // reads the stored basket first
    const saved = () => JSON.parse(store.get("celin-cart-v1")!) as unknown[];
    expect(saved()).toEqual([
      { productId: P1, variantId: null, qty: 3, pack: 1 },
      { productId: P2, variantId: V1, qty: 1, pack: 4 },
    ]);
    cart.add(P2, V1, 30, 4);
    cart.add(P2, V1, 2);
    expect(saved()).toEqual([
      { productId: P1, variantId: null, qty: 3, pack: 1 },
      { productId: P2, variantId: V1, qty: 24, pack: 4 },
      { productId: P2, variantId: V1, qty: 2, pack: 1 },
    ]);
    cart.setQty(P2, V1, 2, 4);
    cart.remove(P2, V1);
    expect(saved()).toEqual([
      { productId: P1, variantId: null, qty: 3, pack: 1 },
      { productId: P2, variantId: V1, qty: 2, pack: 4 },
    ]);
    cart.setQty(P2, V1, 0, 4);
    expect(saved()).toEqual([{ productId: P1, variantId: null, qty: 3, pack: 1 }]);
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
  h.later = [];
  h.team = [];
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

const PRODUCT_COLS = "id, slug, sku, name_fa, name_en, subtitle_fa, subtitle_en, description_fa, description_en, category_id, collection_id, metal, stone, specs, images, price, stock, status, featured, badge, sort, created_at, updated_at".split(", ");

describe("the admin's «نوع فروش»", async () => {
  const { getAdminProduct, parseProduct, saveProduct } = await import("@/lib/admin-catalog");
  const base = { name_fa: "انگشتر دریا", name_en: "Darya ring", slug: "darya-ring", price: 1_000_000, stock: 40 };

  it("needs at least one way to sell; any set of single and 2–5 sizes", () => {
    expect(() => parseProduct({ ...base, packs: [] })).toThrow("دست‌کم یکی");
    expect(() => parseProduct({ ...base, packs: [0, 7] })).toThrow("دست‌کم یکی");
    expect(parseProduct({ ...base, packs: [4, 2, 4] }).packs).toEqual([2, 4]);
    // not sent: left as stored
    expect(parseProduct(base).packs).toBeNull();
  });

  it("is saved with the product, behind the admin session", async () => {
    await expect(saveProduct(null, { ...base, packs: [4] })).rejects.toThrow("unauthorized");
    await signIn(account({ role: "admin", phone: "09121119999" }));
    const id = await saveProduct(null, { ...base, packs: [1, 3] });
    expect(fake.table("celin_products").find((r) => r.id === id)).toMatchObject({ slug: "darya-ring", packs: [1, 3] });
    await saveProduct(id, { ...base, packs: [4] });
    expect(fake.table("celin_products").find((r) => r.id === id)).toMatchObject({ packs: [4] });
    expect((await getAdminProduct(id))?.product.packs).toEqual([4]);
  });

  it("before round six's database file: single saves, a pack asks for the file, and products read as single", async () => {
    fake.columns.celin_products = PRODUCT_COLS;
    await signIn(account({ role: "admin", phone: "09121119998" }));
    const id = await saveProduct(null, { ...base, packs: [1] });
    expect(fake.table("celin_products").find((r) => r.id === id)).not.toHaveProperty("packs");
    await expect(saveProduct(id, { ...base, packs: [4] })).rejects.toThrow("فایل SQL تازه");
    expect((await getAdminProduct(id))?.product.packs).toEqual([1]);
  });
});

describe("the public catalogue", async () => {
  const { getCatalog } = await import("@/lib/catalog");
  const row = (over: Record<string, unknown>) => ({ slug: "x", sku: "", name_fa: "x", name_en: "x", subtitle_fa: "", subtitle_en: "", description_fa: "", description_en: "", category_id: null, collection_id: null, metal: "", stone: "", specs: [], images: [], price: 5, stock: 5, status: "published", featured: false, badge: "", sort: 0, created_at: "2026-11-28T00:00:00Z", updated_at: "2026-11-28T00:00:00Z", ...over });

  it("carries how each piece is sold (never price or stock), and reads as single before round six", async () => {
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
    fake.table("celin_products").push(row({ id: P1, slug: "a", packs: [1, 3] }), row({ id: P2, slug: "b", packs: [4] }));
    const cat = await getCatalog();
    expect(cat.products.map((p) => p.packs)).toEqual([[1, 3], [4]]);
    expect(cat.products[0]).not.toHaveProperty("price");
    expect(cat.products[0]).not.toHaveProperty("stock");
    fake.columns.celin_products = PRODUCT_COLS;
    expect((await getCatalog()).products.map((p) => p.packs)).toEqual([[1], [1]]);
  });
});

describe("placing an order of packs", async () => {
  const { placeOrder } = await import("@/app/actions/orders");
  const customer = { name: "QA", phone: "09121234567", city: "Tehran", address: "Street 1, No 2" };
  let sent: Record<string, unknown> | null;

  async function member() {
    const u = account();
    const { codeHashes, encrypt, normalizeCode } = { ...(await import("@/lib/pro")), ...(await import("@/lib/crypto")) };
    const norm = normalizeCode("123456789012");
    fake.table("celin_pro_codes").push({ id: crypto.randomUUID(), user_id: u.id, code_hash: codeHashes(norm)[0], code_enc: encrypt("123456789012"), hint: "9012", request_id: null, expires_at: null, redeemed_at: new Date().toISOString(), last_used_at: null, revoked_at: null, created_at: new Date().toISOString() });
    await signIn(u);
    return u;
  }

  beforeEach(() => {
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
    fake.table("celin_products").push({ id: P1, price: 1_000_000, stock: 50, status: "published" }, { id: P2, price: 700_000, stock: 50, status: "published" });
    sent = null;
    fake.rpcs.celin_place_order = (a) => {
      sent = a;
      return { data: [{ order_id: crypto.randomUUID(), order_code: "CL-123456" }], error: null };
    };
  });

  it("counts the pieces of the packs for the step, and sends pieces with the pack", async () => {
    await member();
    // 3 four-size packs + 1 single of another design = 13 pieces → the 11-piece step (130%) for the whole order
    const lines = [
      { productId: P1, variantId: null, qty: 3, pack: 4 },
      { productId: P2, variantId: null, qty: 1 },
    ];
    const total = 1_300_000 * 12 + 910_000;
    expect(await placeOrder({ lines, customer, seen: total, lang: "fa" })).toMatchObject({ ok: true, code: "CL-123456" });
    expect(sent).toMatchObject({
      p_expect: total,
      p_items: [
        { product_id: P1, variant_id: "", qty: 12, pack: 4 },
        { product_id: P2, variant_id: "", qty: 1, pack: 1 },
      ],
    });
  });

  it("tells the team each line of packs as packs and pieces", async () => {
    const u = await member();
    fake.rpcs.celin_place_order = () => {
      const id = crypto.randomUUID();
      fake.table("celin_orders").push({ id, code: "CL-654321", user_id: u.id, status: "pending", subtotal: 1, total: 1, items_count: 13, customer: {} });
      fake.table("celin_order_items").push(
        { id: crypto.randomUUID(), order_id: id, name_fa: "انگشتر دریا", variant_fa: "طلایی", qty: 12, pack: 4, unit_price: 1, line_total: 12 },
        { id: crypto.randomUUID(), order_id: id, name_fa: "انگشتر برگ", variant_fa: "", qty: 1, pack: 1, unit_price: 1, line_total: 1 },
      );
      return { data: [{ order_id: id, order_code: "CL-654321" }], error: null };
    };
    const lines = [
      { productId: P1, variantId: null, qty: 3, pack: 4 },
      { productId: P2, variantId: null, qty: 1 },
    ];
    expect(await placeOrder({ lines, customer, seen: 1_300_000 * 12 + 910_000, lang: "fa" })).toMatchObject({ ok: true });
    for (const fn of h.later) await fn();
    expect(h.team.join("\n")).toContain("• انگشتر دریا (طلایی) — ۳ بسته‌ی ۴ سایزی · ۱۲ عدد\n• انگشتر برگ × 1");
  });

  it("a total worked out as if packs were pieces is refused before anything is placed", async () => {
    await member();
    const wrong = 2_000_000 * 3 + 1_400_000; // as if 3 packs were 3 pieces: 4 pieces, no step
    expect(await placeOrder({ lines: [{ productId: P1, variantId: null, qty: 3, pack: 4 }, { productId: P2, variantId: null, qty: 1 }], customer, seen: wrong, lang: "fa" })).toMatchObject({ ok: false, reason: "price_changed" });
    expect(sent).toBeNull();
  });

  it("a pack the product is no longer sold in reads clearly and names the item", async () => {
    await member();
    fake.rpcs.celin_place_order = () => ({ data: null, error: { message: `pack_unavailable:${P1}` } });
    const r = await placeOrder({ lines: [{ productId: P1, variantId: null, qty: 1, pack: 4 }], customer, seen: 2_000_000 * 4, lang: "fa" });
    expect(r).toMatchObject({ ok: false, reason: "pack_unavailable", itemId: P1, error: expect.stringContaining("نوع فروش") });
  });
});
