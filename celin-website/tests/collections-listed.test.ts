import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./stubs/fake-db";
import { listed, type Catalog, type Collection } from "@/lib/catalog-types";
import type { Media } from "@/lib/media";

/**
 * The site lists a collection only when it has a picture (its own, else a published piece's): a collection with
 * neither — «میرا» before the sixth round's file runs, or one the owner has just made — leaves every public list
 * instead of standing as an empty night arch with «به‌زودی». The catalogue itself still carries it, so its page and
 * its pieces' collection name resolve.
 */

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined, refresh: () => undefined }));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return { ...real, db: () => h.db, requireDb: () => h.db };
});

const ROOT = path.resolve(__dirname, "..");
const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
const media = (id: string): Media => ({ id, src: `/media/u/${id}`, ext: "webp", widths: [480], width: 900, height: 1200, placeholder: "", fx: 50, fy: 50, alt_fa: "", alt_en: "" }) as Media;
const collection = (slug: string, own: Media | null, extra: Partial<Collection> = {}): Collection => ({
  id: slug,
  slug,
  name_fa: slug,
  name_en: slug,
  tagline_fa: "",
  tagline_en: "",
  story_fa: "",
  story_en: "",
  media: own,
  sort: 0,
  visible: true,
  soon: false,
  ...extra,
});

describe("listed", () => {
  it("lists a shown collection with a picture, also while it has no pieces yet («به‌زودی»)", () => {
    expect(listed(collection("aftab", media("m1"), { soon: true }))).toBe(true);
    expect(listed(collection("kashi", media("m2")))).toBe(true);
  });

  it("leaves out a collection with no picture at all, and a hidden one", () => {
    expect(listed(collection("yas", null, { soon: true }))).toBe(false);
    expect(listed(collection("del", null))).toBe(false);
    expect(listed(collection("pinhan", media("m1"), { visible: false }))).toBe(false);
  });
});

describe("the search chips", async () => {
  const { searchSuggestions } = await import("@/components/site/search-suggestions");

  it("offer only listed collections", () => {
    const catalog: Catalog = {
      source: "db",
      categories: [],
      products: [],
      collections: [collection("yas", null, { soon: true }), collection("celin", media("m1")), collection("aftab", media("m2"), { soon: true }), collection("negar", media("m3"))],
    };
    const paths = searchSuggestions(catalog, "fa").map((s) => s.path);
    expect(paths.filter((p) => p.startsWith("/collections/"))).toEqual(["/collections/celin", "/collections/aftab", "/collections/negar"]);
  });
});

describe("the lists built from the database", () => {
  let fake: FakeDb;
  const mediaRow = (id: string) => ({ id, path: `u/${id}.webp`, ext: "webp", widths: [480], width: 900, height: 1200, placeholder: "", focal_x: 50, focal_y: 50, alt_fa: "", alt_en: "" });
  const OWN = "11111111-1111-4111-8111-111111111111";
  const PIECE = "33333333-3333-4333-8333-333333333333";
  const row = (id: string, slug: string, media_id: string | null, sort: number) => ({ id, slug, name_fa: slug, name_en: slug, tagline_fa: "", tagline_en: "", story_fa: "", story_en: "", media_id, sort, visible: true });

  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SITE_URL = "https://celin.example";
    fake = new FakeDb();
    h.db = fake;
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
    fake.table("celin_media").push(mediaRow(OWN), mediaRow(PIECE));
    fake.table("celin_collections").push(
      // its own picture, no piece yet
      row("c-aftab", "aftab", OWN, 0),
      // a published piece lends its picture
      row("c-kashi", "kashi", null, 1),
      // no picture and no piece (the look of «میرا»)
      row("c-yas", "yas", null, 2),
      // a published piece, but without pictures
      row("c-del", "del", null, 3),
    );
    const product = { sku: "", name_en: "", subtitle_fa: "", subtitle_en: "", description_fa: "", description_en: "", category_id: null, metal: "", stone: "", specs: [], price: 1000, stock: 3, featured: false, badge: "", status: "published", created_at: "2026-11-01T00:00:00.000Z" };
    fake.table("celin_products").push(
      { ...product, id: "p-1", slug: "kashi-ring", name_fa: "انگشتر", collection_id: "c-kashi", images: [PIECE], sort: 0 },
      { ...product, id: "p-2", slug: "del-ring", name_fa: "انگشتر دل", collection_id: "c-del", images: [], sort: 1 },
    );
  });

  it("the catalogue keeps every shown collection, with or without a picture", async () => {
    const { getCatalog } = await import("@/lib/catalog");
    const cat = await getCatalog();
    expect(cat.collections.map((k) => k.slug)).toEqual(["aftab", "kashi", "yas", "del"]);
    expect(cat.collections.filter(listed).map((k) => k.slug)).toEqual(["aftab", "kashi"]);
  });

  it("search offers only listed collections, and a piece still names its collection", async () => {
    const { buildSearchIndex } = await import("@/lib/search-index");
    const items = await buildSearchIndex();
    expect(items.filter((i) => i.kind === "collection").map((i) => i.slug)).toEqual(["aftab", "kashi"]);
    expect(items.find((i) => i.slug === "del-ring")?.sub_fa).toBe("del");
  });

  it("the sitemap lists only listed collections, each with its picture", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();
    const cols = entries.filter((e) => e.url.includes("/collections/"));
    expect(cols.map((e) => e.url.replace("https://celin.example", ""))).toEqual(["/collections/aftab", "/en/collections/aftab", "/collections/kashi", "/en/collections/kashi"]);
    for (const e of cols) expect(e.images?.length).toBe(1);
    // the pieces of an unlisted collection are still in it
    expect(entries.some((e) => e.url.endsWith("/product/del-ring"))).toBe(true);
  });
});

describe("every public list of collections uses listed", () => {
  // the page components render as server components with the whole site around them; their lists are checked in the source
  const lists: [string, RegExp][] = [
    ["src/components/pages/home-page.tsx", /const collections = catalog\.collections\.filter\(listed\);/],
    ["src/components/pages/collection-page.tsx", /const others = catalog\.collections\.filter\(\(k\) => k\.slug !== col\.slug && listed\(k\)\);/],
    ["src/components/pages/collections-page.tsx", /const collections = catalog\.collections\.filter\(listed\);/],
    ["src/components/site/site-chrome.tsx", /collections: catalog\.collections\.filter\(listed\)\.map\(/],
    ["src/components/site/search-suggestions.ts", /catalog\.collections\.filter\(listed\)\.slice\(0, 3\)/],
    ["src/lib/search-index.ts", /const collections: SearchItem\[\] = cat\.collections\.filter\(listed\)\.map\(/],
    ["src/app/sitemap.ts", /collections\.filter\(listed\)\.flatMap\(/],
    ["src/components/pages/not-found-page.tsx", /\(catalog\?\.collections \?\? \[\]\)\.filter\(listed\)\.slice\(0, 3\)/],
    ["src/components/pages/craft-page.tsx", /catalog\.collections\.find\(listed\)/],
  ];

  it.each(lists)("%s", (file, re) => {
    const src = read(file);
    expect(src).toMatch(re);
    expect(src).toMatch(/import \{[^}]*\blisted\b[^}]*\} from "@\/lib\/catalog-types";/);
    // never the older filters that let a collection without a picture through
    expect(src).not.toMatch(/k\.media \|\| k\.soon/);
  });

  it("the shop's filter is plain text, not a showcase: it keeps every collection with pieces, whose cards it also names", () => {
    expect(read("src/components/pages/shop-page.tsx")).toContain("const collections = catalog.collections.filter((k) => !k.soon).map(");
    expect(read("src/components/shop/shop-grid.tsx")).toContain("collectionName={p.collection ? colName.get(p.collection) : undefined}");
  });

  it("no arch is drawn on the night ground for a missing picture any more", () => {
    for (const f of ["src/components/home/sections.tsx", "src/components/pages/collections-page.tsx"]) expect(read(f), f).not.toMatch(/!(c|k)\.media && <span/);
  });

  it("a pictureless collection's own page still resolves (the catalogue is unchanged)", () => {
    for (const f of ["src/app/(fa)/(site)/collections/[slug]/page.tsx", "src/app/(en)/en/(site)/collections/[slug]/page.tsx"]) {
      const src = read(f);
      expect(src).toContain('collections.filter((c) => c.visible !== false).map((c) => ({ slug: c.slug }))');
      expect(src).not.toMatch(/\blisted\b/);
    }
    expect(read("src/components/pages/collection-page.tsx")).toContain("const col = catalog.collections.find((k) => k.slug === slug && k.visible !== false);");
  });
});
