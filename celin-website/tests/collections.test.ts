import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./stubs/fake-db";
import { coverFromPieces, withCovers, type Catalog, type Collection, type Product } from "@/lib/catalog-types";
import type { Media } from "@/lib/media";

/**
 * The sixth round's collections: «میرا» is gone from the starter catalogue and the copy, and every collection the
 * owner shows on the site has a picture where one exists — its own, else its first piece's — also while it has no
 * published pieces yet («به‌زودی» is only the line under its name then, never an empty arch).
 */

const h = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("next/cache", () => ({ unstable_cache: <T>(fn: T) => fn, revalidatePath: () => undefined, revalidateTag: () => undefined, refresh: () => undefined }));
vi.mock("@/lib/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db")>();
  return { ...real, db: () => h.db, requireDb: () => h.db };
});

const ROOT = path.resolve(__dirname, "..");
const media = (id: string): Media => ({ id, src: `/media/u/${id}`, ext: "webp", widths: [480], width: 900, height: 1200, placeholder: "", fx: 50, fy: 50, alt_fa: "", alt_en: "" }) as Media;
const piece = (slug: string, collection: string | null, images: Media[], sort = 0): Product =>
  ({ id: slug, slug, sku: "", name_fa: slug, name_en: slug, subtitle_fa: "", subtitle_en: "", description_fa: "", description_en: "", category: null, collection, metal: "", stone: "", specs: [], images, variants: [], featured: false, badge: "", sort, created_at: "" }) as Product;
const collection = (slug: string, own: Media | null, soon = false): Collection => ({ id: slug, slug, name_fa: slug, name_en: slug, tagline_fa: "", tagline_en: "", story_fa: "", story_en: "", media: own, sort: 0, visible: true, soon });

describe("the starter catalogue", async () => {
  const { SEED_COLLECTIONS, SEED_PRODUCTS } = await import("@/content/seed-catalog");

  it("no longer carries «میرا», and every collection in it has its own picture", () => {
    expect(SEED_COLLECTIONS.map((c) => c.slug)).not.toContain("mira");
    for (const c of SEED_COLLECTIONS) expect(c.image).toBeTruthy();
    // every starter piece still belongs to a starter collection
    const slugs = new Set(SEED_COLLECTIONS.map((c) => c.slug));
    for (const p of SEED_PRODUCTS) expect(slugs.has(p.collection)).toBe(true);
  });

  it("is not named anywhere in the site's copy or components", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name)) files.push(p);
      }
    };
    walk(path.join(ROOT, "src/content"));
    walk(path.join(ROOT, "src/components"));
    for (const f of files) expect(readFileSync(f, "utf8"), path.relative(ROOT, f)).not.toMatch(/\bmira\b|میرا/i);
  });
});

describe("collection pictures", () => {
  const m1 = media("m1");
  const m2 = media("m2");
  const m3 = media("m3");

  it("takes the first picture of the collection's pieces, in the catalogue's order", () => {
    const products = [piece("a", "kashi", []), piece("b", "negar", [m1]), piece("c", "kashi", [m2, m3]), piece("d", "kashi", [m1])];
    expect(coverFromPieces("kashi", products)?.id).toBe("m2");
    expect(coverFromPieces("negar", products)?.id).toBe("m1");
    expect(coverFromPieces("yas", products)).toBeNull();
  });

  it("keeps a collection's own picture, and gives one to a collection without its own", () => {
    const catalog: Catalog = {
      source: "db",
      categories: [],
      products: [piece("p", "kashi", [m3])],
      collections: [collection("firouzeh", m1, true), collection("kashi", null), collection("del", null, true)],
    };
    const out = withCovers(catalog);
    expect(out.collections.map((k) => k.media?.id ?? null)).toEqual(["m1", "m3", null]);
    // nothing else changes, and the input stays as it was
    expect(out.collections.map((k) => k.soon)).toEqual([true, false, true]);
    expect(catalog.collections[1].media).toBeNull();
  });
});

describe("the public catalogue from the database", () => {
  let fake: FakeDb;
  const mediaRow = (id: string) => ({ id, path: `u/${id}.webp`, ext: "webp", widths: [480], width: 900, height: 1200, placeholder: "", focal_x: 50, focal_y: 50, alt_fa: "", alt_en: "" });

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    fake = new FakeDb();
    h.db = fake;
    fake.table("celin_settings").push({ key: "catalog", value: { initialized: true } });
    fake.table("celin_media").push(mediaRow("11111111-1111-4111-8111-111111111111"), mediaRow("33333333-3333-4333-8333-333333333333"));
    fake.table("celin_collections").push(
      // shown again by the owner: its own picture, no published piece yet
      { id: "c-firouzeh", slug: "firouzeh", name_fa: "فیروزه", name_en: "Firouzeh", tagline_fa: "", tagline_en: "", story_fa: "", story_en: "", media_id: "11111111-1111-4111-8111-111111111111", sort: 0, visible: true },
      // pieces, but no picture of its own
      { id: "c-kashi", slug: "kashi", name_fa: "کاشی", name_en: "Kashi", tagline_fa: "", tagline_en: "", story_fa: "", story_en: "", media_id: null, sort: 1, visible: true },
      // neither: it stays on the night ground, «به‌زودی»
      { id: "c-del", slug: "del", name_fa: "دل", name_en: "Del", tagline_fa: "", tagline_en: "", story_fa: "", story_en: "", media_id: null, sort: 2, visible: true },
      { id: "c-hidden", slug: "hidden", name_fa: "پنهان", name_en: "Hidden", tagline_fa: "", tagline_en: "", story_fa: "", story_en: "", media_id: null, sort: 3, visible: false },
    );
    const product = { sku: "", name_en: "", subtitle_fa: "", subtitle_en: "", description_fa: "", description_en: "", category_id: null, metal: "", stone: "", specs: [], price: 1000, stock: 3, featured: false, badge: "", created_at: "2026-11-01T00:00:00.000Z" };
    fake.table("celin_products").push(
      { ...product, id: "p-1", slug: "kashi-ring", name_fa: "انگشتر", collection_id: "c-kashi", images: ["33333333-3333-4333-8333-333333333333"], status: "published", sort: 0 },
      // a draft never lends its picture (nor counts as a piece)
      { ...product, id: "p-2", slug: "del-draft", name_fa: "پیش‌نویس", collection_id: "c-del", images: ["11111111-1111-4111-8111-111111111111"], status: "draft", sort: 1 },
    );
  });

  it("shows every visible collection with its own picture, else its first piece's", async () => {
    const { getCatalog } = await import("@/lib/catalog");
    const cat = await getCatalog();
    expect(cat.source).toBe("db");
    const by = Object.fromEntries(cat.collections.map((k) => [k.slug, k]));
    expect(Object.keys(by)).toEqual(["firouzeh", "kashi", "del"]);
    expect(by.firouzeh.media?.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(by.firouzeh.soon).toBe(true);
    expect(by.kashi.media?.id).toBe("33333333-3333-4333-8333-333333333333");
    expect(by.kashi.soon).toBe(false);
    expect(by.del.media).toBeNull();
    expect(by.del.soon).toBe(true);
    // the public catalogue carries no price or stock
    expect(JSON.stringify(cat)).not.toMatch(/"price"|"stock"/);
  });
});

describe("the names under the arches while the row is pinned", () => {
  const sections = readFileSync(path.join(ROOT, "src/components/home/sections.tsx"), "utf8");
  const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

  it("sizes a card from the viewport's height on large screens, so arch and names fit the stage", () => {
    expect(sections).toContain("lg:w-[clamp(13rem,min(23vw,calc((100svh_-_var(--reel-chrome))*0.75_+_1.5rem)),22.5rem)]");
    expect(sections).toContain("lg:py-[var(--reel-pad)]");
    expect(sections).toContain("lg:mt-[var(--reel-gap)]");
    // the same arithmetic as the CSS, with the constants read from the source
    const rem = (re: RegExp) => Number(re.exec(sections)![1]) * 16;
    const clampOf = (name: string) => {
      const m = new RegExp(`\\[--${name}:clamp\\(([\\d.]+)rem,([\\d.]+)svh,([\\d.]+)rem\\)\\]`).exec(sections)!;
      return (h: number) => Math.min(Number(m[3]) * 16, Math.max(Number(m[1]) * 16, (Number(m[2]) * h) / 100));
    };
    const pad = clampOf("reel-pad");
    const gap = clampOf("reel-gap");
    const base = rem(/\[--reel-chrome:calc\(([\d.]+)rem_\+_2\*var\(--reel-pad\)_\+_var\(--reel-gap\)\)\]" :/);
    // everything but the arch and the paddings, measured on the home page (1366×650, a two-line tagline): 301px
    const fixed = 301;
    for (const [w, h] of [[1366, 650], [1280, 700], [1536, 740], [1440, 790], [1920, 950], [1920, 1080]]) {
      const chrome = base + 2 * pad(h) + gap(h);
      const card = Math.min(360, Math.max(208, Math.min(0.23 * w, (h - chrome) * 0.75 + 24)));
      const stage = fixed + 2 * pad(h) + gap(h) + ((card - 24) * 4) / 3;
      // the stage fits, or what hangs over is less than its top padding (Reel sticks it that much higher)
      expect(stage - h, `${w}×${h}`).toBeLessThan(h < 700 ? pad(h) : 0);
    }
    // a large screen keeps the full-size arches
    expect(Math.min(360, (1080 - (base + 2 * pad(1080) + gap(1080))) * 0.75 + 24)).toBe(360);
  });

  it("lets a stage still taller than the viewport stick with its lower part in view", () => {
    expect(css).toMatch(/\.fx-pin-stage \{\s*position: sticky;[\s\S]{0,200}top: var\(--pin-top, 0px\);/);
  });
});
