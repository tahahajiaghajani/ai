import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb, FakeJar } from "./stubs/fake-db";
import { LEATHERS, METALS, STONES, type Product, type Variant } from "@/lib/catalog-types";
import {
  axesOf,
  cleanPalette,
  comboSku,
  combos,
  DEFAULT_OPTIONS,
  findVariant,
  legacyToOptions,
  MATERIAL_RE,
  missingAxes,
  OPTION_AXES,
  optionLabel,
  optionsKey,
  optionSwatch,
  paletteOf,
  pickFromQuery,
  pickValue,
  startPick,
  syncCombos,
  valueState,
  valueWord,
  type OptionPalette,
  type VariantOptions,
} from "@/lib/options";
import { LEATHER_LABEL, METAL_LABEL, STONE_LABEL } from "@/components/admin/catalog-labels";
import { applyFilters, readFilters } from "@/components/shop/shop-grid";
import { productCopy } from "@/content/copy/product";

/**
 * Colour options (round six, owner request 9): plating, stone and leather colours come from lists the admin keeps in
 * Settings; a product's variant is one combination with its own price, stock, SKU and picture; the site composes the
 * combination's name («طلایی · نگین سفید · چرم مشکی»), so orders keep reading variant names; old plain lists keep
 * working and can be converted; a rename reaches every stored combination; a colour in use cannot be deleted.
 */

const h = vi.hoisted(() => ({ db: null as unknown, jar: null as unknown }));

vi.mock("next/headers", () => ({ cookies: async () => h.jar, headers: async () => new Headers({ "x-forwarded-for": "198.51.100.9" }) }));
vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  usePathname: () => "/shop",
  useRouter: () => ({ replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return { ...real, db: () => h.db, requireDb: () => h.db };
});

const P = DEFAULT_OPTIONS;
const v = (id: string, options: VariantOptions): Variant => ({ id, name_fa: optionLabel(options, P, "fa"), name_en: optionLabel(options, P, "en"), swatch: optionSwatch(options, P), sku: "", image: null, sort: 0, options });

describe("the colour lists", () => {
  it("start with the brand book's colours: stable slugs, one code each, a valid filter facet, no material", () => {
    for (const axis of OPTION_AXES) {
      const list = P[axis];
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map((x) => x.key)).size).toBe(list.length);
      expect(new Set(list.map((x) => x.code)).size).toBe(list.length);
      for (const x of list) {
        expect(x.key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(x.code).toMatch(/^[A-Z0-9]{1,4}$/);
        expect(MATERIAL_RE.test(x.fa) || MATERIAL_RE.test(x.en)).toBe(false);
      }
    }
    expect(P.plating.map((x) => x.fa)).toEqual(["نقره‌ای (رودیوم)", "طلایی", "شامپاین گلد", "رزگلد"]);
    expect(P.stone.map((x) => x.fa)).toEqual(["سفید", "آبی فیروزه‌ای", "سرمه‌ای", "سبز جنگلی", "قرمز اناری", "مرواریدی", "صورتی ملایم", "مشکی"]);
    expect(P.leather.map((x) => x.fa)).toEqual(["مشکی", "قهوه‌ای", "عسلی", "زرشکی", "سرمه‌ای", "کرم"]);
    for (const x of P.plating) expect(METALS as string[]).toContain(x.facet);
    for (const x of P.stone) expect(STONES as readonly string[]).toContain(x.facet);
    for (const x of P.leather) expect(LEATHERS as readonly string[]).toContain(x.facet);
    // the brand book's codes, as in CL-NEG-BG-001-GT-NB
    expect(comboSku("CL-NEG-BG-001", { stone: "navy", plating: "gold" }, P)).toBe("CL-NEG-BG-001-GT-NB");
    expect(comboSku("", { plating: "gold" }, P)).toBe("");
  });

  it("every filter facet has its labels in the admin and on the site", () => {
    for (const m of METALS) expect(METAL_LABEL[m]).toBeTruthy();
    for (const s of STONES) expect(STONE_LABEL[s]).toBeTruthy();
    for (const l of LEATHERS) expect(LEATHER_LABEL[l]).toBeTruthy();
  });

  it("save as given: the defaults round-trip, a new colour gets its key and code, the material is refused", () => {
    expect(cleanPalette(P)).toEqual({ palette: P, error: null });
    const added = cleanPalette({ ...P, leather: [...P.leather, { key: "", fa: "سبز زیتونی", en: "Olive green", swatch: "#556b2f", code: "", facet: "nope" }] });
    expect(added.error).toBeNull();
    expect(added.palette!.leather.at(-1)).toEqual({ key: "olive-green", fa: "سبز زیتونی", en: "Olive green", swatch: "#556b2f", code: "OG", facet: "" });
    // a Persian-only colour and a code already taken
    const fa = cleanPalette({ ...P, stone: [...P.stone, { fa: "عسلی", code: "", en: "" }, { fa: "یاسی", en: "Black lilac", code: "" }] });
    expect(fa.palette!.stone.slice(-2).map((x) => [x.key, x.code])).toEqual([
      ["stone", "ST"],
      ["black-lilac", "BL2"],
    ]);
    for (const bad of ["کیوبیک زیرکونیا", "زیرکونیا", "Cubic zirconia", "zircon white"]) {
      expect(cleanPalette({ ...P, stone: [{ key: "white", fa: bad.match(/[a-z]/i) ? "سفید" : bad, en: bad, swatch: "", code: "WH", facet: "white" }] }).error).toContain("نام جنس نگین");
    }
    // naming a colour is the owner's choice: only the material is refused
    expect(cleanPalette({ ...P, stone: [...P.stone, { fa: "قرمز یاقوتی", en: "Ruby red", code: "RR" }] }).error).toBeNull();
  });

  it("refuses what would make two colours the same", () => {
    expect(cleanPalette({ ...P, plating: [...P.plating, { key: "gold", fa: "طلایی مات", code: "GM" }] }).error).toContain("یک نشانی");
    expect(cleanPalette({ ...P, plating: [...P.plating, { fa: "طلایی مات", code: "GT" }] }).error).toContain("کد «GT» دو بار");
    expect(cleanPalette({ ...P, plating: [...P.plating, { fa: "طلایی", code: "G2" }] }).error).toContain("«طلایی» دو بار");
    expect(cleanPalette({ ...P, plating: [...P.plating, { fa: "مات", code: "g-1" }] }).error).toContain("حروف بزرگ");
    expect(cleanPalette({ ...P, plating: [{ fa: "", code: "X" }] }).error).toContain("نام فارسی");
    expect(cleanPalette({ ...P, stone: Array.from({ length: 41 }, (_, i) => ({ fa: `رنگ ${i}` })) }).error).toContain("حداکثر");
  });

  it("reads a list edited by hand without breaking a page", () => {
    expect(paletteOf(undefined)).toEqual(P);
    expect(paletteOf({ plating: [{ key: "gold", fa: "طلایی" }, { fa: "no key" }, 5] }).plating).toEqual([{ key: "gold", fa: "طلایی", en: "", swatch: "", code: "", facet: "" }]);
  });
});

describe("a combination's name", () => {
  it("is plating → stone → leather, whatever the object's order, in both languages", () => {
    const o = { leather: "black", stone: "white", plating: "gold" };
    expect(optionLabel(o, P, "fa")).toBe("طلایی · نگین سفید · چرم مشکی");
    expect(optionLabel(o, P, "en")).toBe("Gold-tone · White stones · Black leather");
    expect(optionsKey(o)).toBe("plating=gold|stone=white|leather=black");
    expect(optionLabel({ stone: "navy" }, P, "fa")).toBe("نگین سرمه‌ای");
    expect(optionSwatch({ stone: "navy", plating: "champagne" }, P)).toBe("champagne");
    expect(optionSwatch({ leather: "tan" }, P)).toBe("#b07a3f");
  });

  it("never doubles the axis word, and English falls back to the Persian name", () => {
    const own: OptionPalette = { plating: [], stone: [{ key: "w", fa: "نگین سفید", en: "White stones", swatch: "", code: "W", facet: "" }], leather: [{ key: "x", fa: "شتری", en: "", swatch: "", code: "X", facet: "" }] };
    expect(optionLabel({ stone: "w", leather: "x" }, own, "fa")).toBe("نگین سفید · چرم شتری");
    expect(optionLabel({ stone: "w", leather: "x" }, own, "en")).toBe("White stones · شتری leather");
    // a key the lists do not have reads as itself
    expect(valueWord("stone", undefined, "teal", "en")).toBe("teal stones");
  });
});

describe("the grid of combinations", () => {
  it("is every combination of the chosen colours, plating first, in the lists' order", () => {
    expect(combos({ stone: ["red", "white"], plating: ["gold", "silver"] }, P).map(optionsKey)).toEqual(["plating=silver|stone=white", "plating=silver|stone=red", "plating=gold|stone=white", "plating=gold|stone=red"]);
    expect(combos({ plating: [], stone: [] }, P)).toEqual([]);
    expect(combos({ plating: ["gold"], stone: ["white", "navy"], leather: ["black", "tan"] }, P)).toHaveLength(4);
  });

  it("keeps each stored option when the grid changes: same colours, or a whole axis added or dropped", () => {
    type Row = { id: string | null; options: VariantOptions; stock: number };
    const make = (o: VariantOptions): Row => ({ id: null, options: o, stock: 0 });
    const stored: Row[] = [
      { id: "g", options: { plating: "gold" }, stock: 9 },
      { id: "s", options: { plating: "silver" }, stock: 6 },
    ];
    // a stone colour added: «طلایی» becomes «طلایی · نگین سفید» with its id and stock
    const one = syncCombos(stored, combos({ plating: ["gold", "silver"], stone: ["white"] }, P), make);
    expect(one.map((r) => [r.id, optionsKey(r.options), r.stock])).toEqual([
      ["g", "plating=gold|stone=white", 9],
      ["s", "plating=silver|stone=white", 6],
    ]);
    // a second stone colour: new rows; nothing claimed twice
    const two = syncCombos(one, combos({ plating: ["gold", "silver"], stone: ["white", "red"] }, P), make);
    expect(two.map((r) => [r.id, optionsKey(r.options)])).toEqual([
      ["g", "plating=gold|stone=white"],
      ["s", "plating=silver|stone=white"],
      [null, "plating=silver|stone=red"],
      [null, "plating=gold|stone=red"],
    ]);
    // a colour taken off and chosen again: the same rows come back
    const off = syncCombos(two, combos({ plating: ["gold"], stone: ["white", "red"] }, P), make);
    expect(off).toHaveLength(4);
    expect(syncCombos(off, combos({ plating: ["gold", "silver"], stone: ["white", "red"] }, P), make)).toEqual(off);
  });

  it("names the axes a product's combinations use, in the lists' order (no price, no stock)", () => {
    const axes = axesOf([v("a", { stone: "red", plating: "gold" }), v("b", { plating: "silver", stone: "white" })], P);
    expect(axes.map((a) => [a.axis, a.values.map((x) => x.key)])).toEqual([
      ["plating", ["silver", "gold"]],
      ["stone", ["white", "red"]],
    ]);
    expect(axes[0].values[1]).toEqual({ key: "gold", name_fa: "طلایی", name_en: "Gold-tone", swatch: "gold", facet: "gold" });
    expect(JSON.stringify(axes)).not.toMatch(/price|stock/);
  });
});

describe("choosing on the product page", () => {
  // gold × white/navy, silver × white only; gold·navy cannot be ordered now
  const vs = [v("gw", { plating: "gold", stone: "white" }), v("gn", { plating: "gold", stone: "navy" }), v("sw", { plating: "silver", stone: "white" })];
  const axes = axesOf(vs, P);
  const orderable = (x: Variant) => x.id !== "gn";

  it("starts with what has a single choice, and finds the combination once every axis is chosen", () => {
    expect(startPick(vs, axes)).toEqual({});
    expect(startPick([vs[0], vs[1]], axesOf([vs[0], vs[1]], P))).toEqual({ plating: "gold" });
    expect(startPick([vs[2]], axesOf([vs[2]], P))).toEqual({ plating: "silver", stone: "white" });
    expect(findVariant(vs, axes, { plating: "gold" })).toBeNull();
    expect(findVariant(vs, axes, { plating: "gold", stone: "navy" })?.id).toBe("gn");
    expect(missingAxes(axes, { plating: "gold" })).toEqual(["stone"]);
    expect(productCopy.fa.choose(missingAxes(axes, {}).map((a) => productCopy.fa.axes[a]))).toBe("رنگ آبکاری و رنگ نگین را انتخاب کنید");
    expect(productCopy.en.choose(["Stone color", "Leather color"])).toBe("Please choose the stone color and leather color");
  });

  it("dims what is not made with the other choices; members see «ناموجود» for what cannot be ordered", () => {
    expect(valueState(vs, { plating: "silver" }, "stone", "navy")).toBe("none");
    expect(valueState(vs, { plating: "silver" }, "stone", "white")).toBe("ok");
    // a visitor (no price book) never learns about stock
    expect(valueState(vs, { plating: "gold" }, "stone", "navy")).toBe("ok");
    expect(valueState(vs, { plating: "gold" }, "stone", "navy", orderable)).toBe("out");
    // its own axis is not held against it
    expect(valueState(vs, { plating: "gold", stone: "white" }, "plating", "silver")).toBe("ok");
  });

  it("choosing a colour that is not made with the others drops them", () => {
    expect(pickValue(vs, axes, { plating: "silver", stone: "white" }, "stone", "navy")).toEqual({ stone: "navy" });
    expect(pickValue(vs, axes, { stone: "white" }, "plating", "gold")).toEqual({ plating: "gold", stone: "white" });
  });

  it("reads a choice from the address: the basket's ?v= or the colours", () => {
    expect(pickFromQuery(new URLSearchParams("v=gn"), vs, axes)).toEqual({ plating: "gold", stone: "navy" });
    expect(pickFromQuery(new URLSearchParams("plating=silver&stone=white"), vs, axes)).toEqual({ plating: "silver", stone: "white" });
    expect(pickFromQuery(new URLSearchParams("plating=rose"), vs, axes)).toBeNull();
    expect(pickFromQuery(new URLSearchParams(""), vs, axes)).toBeNull();
  });
});

describe("the older plain lists", () => {
  it("map onto the colours by their names: the four starter products", () => {
    expect(legacyToOptions([{ name_fa: "طلایی", name_en: "Gold-tone" }, { name_fa: "نقره‌ای (رودیوم)", name_en: "Silver-tone" }], P)).toEqual([{ plating: "gold" }, { plating: "silver" }]);
    const negar = [
      ["طلایی · سرمه‌ای", "Gold-tone · Night blue"],
      ["نقره‌ای · سرمه‌ای", "Silver-tone · Night blue"],
      ["طلایی · سبز جنگلی", "Gold-tone · Forest green"],
      ["نقره‌ای · سبز جنگلی", "Silver-tone · Forest green"],
      ["طلایی · قرمز اناری", "Gold-tone · Pomegranate red"],
      ["نقره‌ای · قرمز اناری", "Silver-tone · Pomegranate red"],
    ].map(([name_fa, name_en]) => ({ name_fa, name_en }));
    expect(legacyToOptions(negar, P)?.map(optionsKey)).toEqual(["plating=gold|stone=navy", "plating=silver|stone=navy", "plating=gold|stone=green", "plating=silver|stone=green", "plating=gold|stone=red", "plating=silver|stone=red"]);
    // a colour also in the leather list is a stone colour first; «چرم …» says otherwise
    expect(legacyToOptions([{ name_fa: "سرمه‌ای", name_en: "" }, { name_fa: "قرمز اناری", name_en: "" }], P)).toEqual([{ stone: "navy" }, { stone: "red" }]);
    expect(legacyToOptions([{ name_fa: "طلایی · چرم سرمه‌ای", name_en: "" }], P)).toEqual([{ plating: "gold", leather: "navy" }]);
    // the English name when the Persian one is not a colour of the lists
    expect(legacyToOptions([{ name_fa: "زرد", name_en: "Gold-tone" }], P)).toEqual([{ plating: "gold" }]);
  });

  it("stay as they are when they cannot be mapped", () => {
    expect(legacyToOptions([{ name_fa: "مدل بلند", name_en: "Long" }], P)).toBeNull();
    expect(legacyToOptions([{ name_fa: "طلایی", name_en: "" }, { name_fa: "طلایی", name_en: "" }], P)).toBeNull();
    expect(legacyToOptions([{ name_fa: "طلایی", name_en: "" }, { name_fa: "طلایی · سفید", name_en: "" }], P)).toBeNull();
    expect(legacyToOptions([], P)).toBeNull();
  });
});

describe("the shop filters", () => {
  const prod = (slug: string, over: Partial<Product>): Product => ({ id: slug, slug, sku: "", name_fa: slug, name_en: slug, subtitle_fa: "", subtitle_en: "", description_fa: "", description_en: "", category: null, collection: null, metal: "", stone: "", specs: [], images: [], variants: [], axes: [], packs: [1], featured: false, badge: "", sort: 0, created_at: "", ...over });
  const withColours = (slug: string, os: VariantOptions[]) => {
    const variants = os.map((o, i) => v(`${slug}-${i}`, o));
    return prod(slug, { variants, axes: axesOf(variants, P) });
  };
  const list = [
    prod("plain-navy", { metal: "silver", stone: "navy" }),
    withColours("champagne-red", [{ plating: "champagne", stone: "red" }, { plating: "champagne", stone: "white" }]),
    withColours("cuff", [{ plating: "gold", leather: "tan" }, { plating: "rose", leather: "black" }]),
  ];
  const names = (q: string) => applyFilters(list, readFilters(new URLSearchParams(q))).map((p) => p.slug);

  it("find a piece by the colours of its options (champagne gold counts as gold)", () => {
    expect(names("stone=red")).toEqual(["champagne-red"]);
    expect(names("stone=navy")).toEqual(["plain-navy"]);
    expect(names("metal=gold")).toEqual(["champagne-red", "cuff"]);
    expect(names("metal=rose")).toEqual(["cuff"]);
    expect(names("leather=tan")).toEqual(["cuff"]);
    expect(names("leather=nope")).toEqual(["plain-navy", "champagne-red", "cuff"]);
  });
});

// ------------------------------------------------------------------ the admin and the database

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
  const row = { id: crypto.randomUUID(), phone: "09121117777", email: "", name: "Admin", business: "", city: "", address: "", postal_code: "", role: "admin", disabled: false, session_version: 0, password_hash: "scrypt$x", password_from_code: false, created_by_admin: false, admin_note: "", pro_at: null, created_at: new Date().toISOString() };
  fake.table("celin_users").push(row);
  const { sessionValue } = await import("@/lib/auth");
  jar.set("celin_session", sessionValue(row.id, 0, Date.now(), "pw"));
}

const VARIANT_COLS_V1 = "id, product_id, name_fa, name_en, swatch, sku, price, stock, image_id, sort, created_at, updated_at".split(", ");
const base = { name_fa: "النگوی نگار", name_en: "Negar bangle", slug: "negar-bangle", sku: "CL-NEG-BG-001", price: 3_300_000, stock: 0, metal: "two-tone", stone: "mixed" };
const grid = (os: VariantOptions[], over: Record<string, unknown> = {}) => os.map((options) => ({ options, sku: "", price: null, stock: 3, image_id: null, name_fa: "ignored", ...over }));

describe("saving a product with colours", async () => {
  const { getAdminProduct, parseProduct, saveProduct } = await import("@/lib/admin-catalog");

  it("names each combination from the lists, fills its SKU and leaves the filter to the colours", () => {
    const { row, variants } = parseProduct({ ...base, variants: grid([{ stone: "navy", plating: "gold" }, { plating: "silver", stone: "navy" }]) }, P);
    expect(variants.map((x) => [x.name_fa, x.name_en, x.swatch, x.sku])).toEqual([
      ["طلایی · نگین سرمه‌ای", "Gold-tone · Night blue stones", "gold", "CL-NEG-BG-001-GT-NB"],
      ["نقره‌ای (رودیوم) · نگین سرمه‌ای", "Silver-tone · Night blue stones", "silver", "CL-NEG-BG-001-RH-NB"],
    ]);
    expect(row).toMatchObject({ metal: "", stone: "" });
    // the admin's own SKU stays; a plain list keeps its own names and the piece's facets
    expect(parseProduct({ ...base, variants: grid([{ plating: "gold" }], { sku: "MY-1" }) }, P).variants[0].sku).toBe("MY-1");
    expect(parseProduct({ ...base, variants: [{ name_fa: "بلند", stock: 1 }] }, P)).toMatchObject({ row: { metal: "two-tone", stone: "mixed" }, variants: [{ name_fa: "بلند", options: {} }] });
  });

  it("refuses a colour the lists no longer have, mixed kinds, uneven axes and a combination twice", () => {
    expect(() => parseProduct({ ...base, variants: grid([{ plating: "platinum" }]) }, P)).toThrow("«platinum» دیگر در «رنگ‌های گزینه‌ها» نیست");
    expect(() => parseProduct({ ...base, variants: [...grid([{ plating: "gold" }]), { name_fa: "بلند" }] }, P)).toThrow("یک نوع");
    expect(() => parseProduct({ ...base, variants: grid([{ plating: "gold" }, { plating: "silver", stone: "white" }]) }, P)).toThrow("همان رنگ‌ها");
    expect(() => parseProduct({ ...base, variants: grid([{ plating: "gold" }, { plating: "gold" }]) }, P)).toThrow("دو بار");
  });

  it("keeps up to 100 options and refuses more instead of cutting them (no stock is lost)", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name_fa: `گزینه ${i}`, stock: 1 }));
    expect(parseProduct({ ...base, variants: many(100) }, P).variants).toHaveLength(100);
    expect(() => parseProduct({ ...base, variants: many(101) }, P)).toThrow("حداکثر ۱۰۰");
  });

  it("stores the combinations, keeps their ids when the grid changes, and deletes the ones taken off", async () => {
    await expect(saveProduct(null, { ...base, variants: grid([{ plating: "gold" }]) })).rejects.toThrow("unauthorized");
    await admin();
    const id = await saveProduct(null, { ...base, variants: grid([{ plating: "gold", stone: "navy" }, { plating: "silver", stone: "navy" }, { plating: "gold", stone: "red" }]) });
    const stored = fake.table("celin_variants").filter((r) => r.product_id === id);
    expect(stored.map((r) => [r.name_fa, r.options])).toEqual([
      ["طلایی · نگین سرمه‌ای", { plating: "gold", stone: "navy" }],
      ["نقره‌ای (رودیوم) · نگین سرمه‌ای", { plating: "silver", stone: "navy" }],
      ["طلایی · نگین قرمز اناری", { plating: "gold", stone: "red" }],
    ]);
    const got = (await getAdminProduct(id))!;
    expect(got.product.variants.map((x) => x.options)).toEqual(stored.map((r) => r.options));
    // gold·red taken off; the others kept by id with new stock
    const kept = got.product.variants.slice(0, 2).map((x) => ({ ...x, stock: 7, stock_loaded: x.stock }));
    await saveProduct(id, { ...base, variants: kept });
    const after = fake.table("celin_variants").filter((r) => r.product_id === id);
    expect(after.map((r) => r.id)).toEqual(stored.slice(0, 2).map((r) => r.id));
    expect(after.map((r) => r.stock)).toEqual([7, 7]);
  });

  it("before round six's database file: a plain list saves without colours, colours ask for the file before anything changes", async () => {
    fake.columns.celin_variants = VARIANT_COLS_V1;
    await admin();
    const id = await saveProduct(null, { ...base, variants: [{ name_fa: "بلند", stock: 2 }] });
    const plain = fake.table("celin_variants").filter((r) => r.product_id === id);
    expect(plain).toHaveLength(1);
    expect(plain[0]).not.toHaveProperty("options");
    expect((await getAdminProduct(id))!.product.variants[0]).toMatchObject({ name_fa: "بلند", options: {} });
    await expect(saveProduct(id, { ...base, variants: grid([{ plating: "gold" }]) })).rejects.toThrow("فایل SQL تازه");
    expect(fake.table("celin_variants").filter((r) => r.product_id === id).map((r) => r.name_fa)).toEqual(["بلند"]);
  });
});

describe("the admin's colour lists", async () => {
  const { optionUsage, saveOptionPalette, saveProduct } = await import("@/lib/admin-catalog");
  const { adminSaveOptions } = await import("@/app/actions/admin-catalog");

  it("are saved behind the admin session, and a colour in use is never deleted", async () => {
    expect(await adminSaveOptions({ palette: P })).toMatchObject({ ok: false });
    await admin();
    await saveProduct(null, { ...base, variants: grid([{ plating: "champagne", stone: "white" }, { plating: "gold", stone: "white" }]) });
    expect(await optionUsage()).toEqual({ "plating:champagne": 1, "plating:gold": 1, "stone:white": 1 });
    const without = { ...P, plating: P.plating.filter((x) => x.key !== "champagne") };
    await expect(saveOptionPalette(without)).rejects.toThrow("«شامپاین گلد» در ۱ محصول به کار رفته است");
    // an unused one may go
    expect(await adminSaveOptions({ palette: { ...P, plating: P.plating.filter((x) => x.key !== "rose") } })).toMatchObject({ ok: true });
    expect(fake.table("celin_settings").find((r) => r.key === "options")?.value).toMatchObject({ plating: [{ key: "silver" }, { key: "gold" }, { key: "champagne" }] });
  });

  it("write a renamed colour into every stored combination at once", async () => {
    await admin();
    const id = await saveProduct(null, { ...base, variants: grid([{ plating: "gold", stone: "white" }, { plating: "silver", stone: "white" }]) });
    const renamed = { ...P, plating: P.plating.map((x) => (x.key === "gold" ? { ...x, fa: "طلایی (آبکاری طلا)", en: "Gold-plated" } : x)) };
    const r = await adminSaveOptions({ palette: renamed });
    expect(r).toMatchObject({ ok: true, message: "رنگ‌های گزینه‌ها ذخیره شد؛ نام ۱ ترکیب در محصولات به‌روز شد." });
    expect(fake.table("celin_variants").filter((x) => x.product_id === id).map((x) => [x.name_fa, x.name_en])).toEqual([
      ["طلایی (آبکاری طلا) · نگین سفید", "Gold-plated · White stones"],
      ["نقره‌ای (رودیوم) · نگین سفید", "Silver-tone · White stones"],
    ]);
  });
});

describe("the public catalogue", async () => {
  const { getCatalog } = await import("@/lib/catalog");
  const row = (over: Record<string, unknown>) => ({ slug: "x", sku: "", name_fa: "x", name_en: "x", subtitle_fa: "", subtitle_en: "", description_fa: "", description_en: "", category_id: null, collection_id: null, metal: "", stone: "", specs: [], images: [], price: 5, stock: 5, status: "published", featured: false, badge: "", sort: 0, created_at: "2026-11-28T00:00:00Z", updated_at: "2026-11-28T00:00:00Z", packs: [1], ...over });
  const P1 = "33333333-3333-4333-8333-333333333333";

  it("carries each product's axes and its combinations (never a price or stock), with the lists' current words", async () => {
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } }, { key: "options", value: { plating: [{ key: "gold", fa: "طلایی روشن", en: "Light gold", swatch: "gold", code: "GT", facet: "gold" }] } });
    fake.table("celin_products").push(row({ id: P1, slug: "a" }));
    fake.table("celin_variants").push(
      { id: "v1", product_id: P1, name_fa: "طلایی · نگین سفید", name_en: "", swatch: "gold", sku: "A-GT-WH", price: 9, stock: 4, image_id: null, sort: 0, options: { stone: "white", plating: "gold" } },
      { id: "v2", product_id: P1, name_fa: "طلایی · نگین قرمز اناری", name_en: "", swatch: "gold", sku: "A-GT-PR", price: null, stock: 0, image_id: null, sort: 1, options: { stone: "red", plating: "gold" } },
    );
    const p = (await getCatalog()).products[0];
    expect(p.axes.map((a) => [a.axis, a.values.map((x) => x.name_fa)])).toEqual([
      ["plating", ["طلایی روشن"]],
      ["stone", ["سفید", "قرمز اناری"]],
    ]);
    expect(p.variants.map((x) => x.options)).toEqual([
      { plating: "gold", stone: "white" },
      { plating: "gold", stone: "red" },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/"price"|"stock"/);
  });

  it("reads every option as a plain one before round six's database file", async () => {
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
    fake.columns.celin_variants = ["id", "product_id", "name_fa", "name_en", "swatch", "sku", "price", "stock", "image_id", "sort"];
    fake.table("celin_products").push(row({ id: P1, slug: "a" }));
    fake.table("celin_variants").push({ id: "v1", product_id: P1, name_fa: "طلایی", name_en: "", swatch: "gold", sku: "", price: null, stock: 1, image_id: null, sort: 0 });
    const p = (await getCatalog()).products[0];
    expect(p.axes).toEqual([]);
    expect(p.variants[0]).toMatchObject({ name_fa: "طلایی", options: {} });
  });

  it("without a database: the starter catalogue's options are combinations of the default lists", async () => {
    h.db = null;
    const cat = await getCatalog();
    const negar = cat.products.find((x) => x.slug === "negar-bangle")!;
    expect(negar.axes.map((a) => a.axis)).toEqual(["plating", "stone"]);
    expect(negar.variants[0]).toMatchObject({ name_fa: "طلایی · نگین سرمه‌ای", name_en: "Gold-tone · Night blue stones", swatch: "gold", sku: "CL-NEG-BG-001-GT-NB" });
    expect(cat.products.find((x) => x.slug === "gereh-bow-set")!.variants.map((x) => x.name_fa)).toEqual(["نگین سرمه‌ای", "نگین قرمز اناری"]);
    expect(cat.products.find((x) => x.slug === "del-signet-ring")!.variants.map((x) => x.name_fa)).toEqual(["طلایی", "نقره‌ای (رودیوم)"]);
  });
});
