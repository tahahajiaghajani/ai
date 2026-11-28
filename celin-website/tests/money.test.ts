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
