import "server-only";
import { unstable_cache } from "next/cache";
import { db, isMissingTable } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings, getSettingsFresh } from "@/lib/settings";
import { MEDIA_COLUMNS, rowToMedia, type Media, type MediaRow } from "@/lib/media";
import type { Catalog, Category, Collection, Product, ProPrices, Spec, Variant } from "@/lib/catalog-types";
import { SEED_CATEGORIES, SEED_COLLECTIONS, SEED_PRODUCTS } from "@/content/seed-catalog";
import { SEED_MEDIA } from "@/content/seed-media";

/**
 * URL prefix of uploaded pictures: the site's own /media/u route (src/app/media/u), which streams them from
 * the storage bucket and lets the CDN keep them — browsers never need to reach *.supabase.co.
 */
export function storageBase(): string {
  return env.supabaseUrl ? "/media/u" : "";
}

// ------------------------------------------------------------------ the starter catalogue

export const seedId = (slug: string) => `seed-${slug}`;
export const seedVariantId = (slug: string, key: string) => `seed-${slug}-${key}`;

function seedCatalog(): Catalog {
  const categories: Category[] = SEED_CATEGORIES.map((c, i) => ({
    id: seedId(c.slug),
    slug: c.slug,
    name_fa: c.name_fa,
    name_en: c.name_en,
    description_fa: c.description_fa,
    description_en: c.description_en,
    media: SEED_MEDIA[c.image],
    sort: i,
    visible: true,
  }));
  const collections: Collection[] = SEED_COLLECTIONS.map((c, i) => ({
    id: seedId(c.slug),
    slug: c.slug,
    name_fa: c.name_fa,
    name_en: c.name_en,
    tagline_fa: c.tagline_fa,
    tagline_en: c.tagline_en,
    story_fa: c.story_fa,
    story_en: c.story_en,
    media: SEED_MEDIA[c.image],
    sort: i,
    visible: true,
  }));
  const products: Product[] = SEED_PRODUCTS.map((p, i) => ({
    id: seedId(p.slug),
    slug: p.slug,
    sku: p.sku,
    name_fa: p.name_fa,
    name_en: p.name_en,
    subtitle_fa: p.subtitle_fa,
    subtitle_en: p.subtitle_en,
    description_fa: p.description_fa,
    description_en: p.description_en,
    category: p.category,
    collection: p.collection,
    metal: p.metal,
    stone: p.stone,
    specs: p.specs,
    images: p.images.map((k) => SEED_MEDIA[k]),
    variants: p.variants.map((v, j) => ({ id: seedVariantId(p.slug, v.key), name_fa: v.name_fa, name_en: v.name_en, swatch: v.swatch, sku: v.sku, image: v.image ? SEED_MEDIA[v.image] : null, sort: j })),
    featured: p.featured,
    badge: p.badge,
    sort: i,
    created_at: "2026-10-23T00:00:00.000Z",
  }));
  return { categories, collections, products, source: "seed" };
}

function seedPrices(): ProPrices {
  const out: ProPrices = {};
  for (const p of SEED_PRODUCTS) {
    out[seedId(p.slug)] = {
      price: p.price,
      stock: p.stock,
      variants: Object.fromEntries(p.variants.map((v) => [seedVariantId(p.slug, v.key), { price: v.price, stock: v.stock }])),
    };
  }
  return out;
}

// ------------------------------------------------------------------ database rows

interface ProductRow {
  id: string;
  slug: string;
  sku: string;
  name_fa: string;
  name_en: string;
  subtitle_fa: string;
  subtitle_en: string;
  description_fa: string;
  description_en: string;
  category_id: string | null;
  collection_id: string | null;
  metal: string;
  stone: string;
  specs: Spec[] | null;
  images: string[] | null;
  price: number | null;
  stock: number;
  status: string;
  featured: boolean;
  badge: string;
  sort: number;
  created_at: string;
}
interface VariantRow {
  id: string;
  product_id: string;
  name_fa: string;
  name_en: string;
  swatch: string;
  sku: string;
  price: number | null;
  stock: number;
  image_id: string | null;
  sort: number;
}
interface TaxonRow {
  id: string;
  slug: string;
  name_fa: string;
  name_en: string;
  description_fa?: string;
  description_en?: string;
  tagline_fa?: string;
  tagline_en?: string;
  story_fa?: string;
  story_en?: string;
  media_id: string | null;
  sort: number;
  visible: boolean;
}

export const PRODUCT_COLUMNS =
  "id, slug, sku, name_fa, name_en, subtitle_fa, subtitle_en, description_fa, description_en, category_id, collection_id, metal, stone, specs, images, price, stock, status, featured, badge, sort, created_at";
export const VARIANT_COLUMNS = "id, product_id, name_fa, name_en, swatch, sku, price, stock, image_id, sort";

/** Loads the media rows for a set of ids (in chunks: PostgREST URLs have a length limit). */
export async function loadMedia(ids: Iterable<string>): Promise<Map<string, Media>> {
  const c = db();
  const all = [...new Set([...ids].filter(Boolean))];
  const out = new Map<string, Media>();
  if (!c || !all.length) return out;
  const base = storageBase();
  for (let i = 0; i < all.length; i += 150) {
    const { data, error } = await c.from("celin_media").select(MEDIA_COLUMNS).in("id", all.slice(i, i + 150));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as MediaRow[]) out.set(r.id, rowToMedia(r, base));
  }
  return out;
}

const byOrder = <T extends { sort: number; created_at?: string }>(a: T, b: T) => a.sort - b.sort || String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));

async function dbCatalog(): Promise<Catalog | null> {
  const c = db();
  if (!c) return null;
  const [cats, cols, prods] = await Promise.all([
    c.from("celin_categories").select("id, slug, name_fa, name_en, description_fa, description_en, media_id, sort, visible").eq("visible", true).order("sort"),
    c.from("celin_collections").select("id, slug, name_fa, name_en, tagline_fa, tagline_en, story_fa, story_en, media_id, sort, visible").eq("visible", true).order("sort"),
    c.from("celin_products").select(PRODUCT_COLUMNS).eq("status", "published").order("sort").limit(2000),
  ]);
  for (const r of [cats, cols, prods]) {
    if (r.error) {
      if (isMissingTable(r.error)) return null;
      throw new Error(r.error.message);
    }
  }
  const products = (prods.data ?? []) as ProductRow[];
  const variants: VariantRow[] = [];
  const ids = products.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await c.from("celin_variants").select(VARIANT_COLUMNS).in("product_id", ids.slice(i, i + 150)).order("sort");
    if (error) throw new Error(error.message);
    variants.push(...((data ?? []) as VariantRow[]));
  }
  const taxa = [...((cats.data ?? []) as TaxonRow[]), ...((cols.data ?? []) as TaxonRow[])];
  const media = await loadMedia([...taxa.map((t) => t.media_id ?? ""), ...products.flatMap((p) => p.images ?? []), ...variants.map((v) => v.image_id ?? "")]);
  const catSlug = new Map(((cats.data ?? []) as TaxonRow[]).map((t) => [t.id, t.slug]));
  const colSlug = new Map(((cols.data ?? []) as TaxonRow[]).map((t) => [t.id, t.slug]));
  const varsOf = new Map<string, Variant[]>();
  for (const v of variants) {
    const list = varsOf.get(v.product_id) ?? [];
    list.push({ id: v.id, name_fa: v.name_fa, name_en: v.name_en, swatch: v.swatch, sku: v.sku, image: v.image_id ? media.get(v.image_id) ?? null : null, sort: v.sort });
    varsOf.set(v.product_id, list);
  }
  return {
    source: "db",
    categories: ((cats.data ?? []) as TaxonRow[]).map((t) => ({
      id: t.id,
      slug: t.slug,
      name_fa: t.name_fa,
      name_en: t.name_en,
      description_fa: t.description_fa ?? "",
      description_en: t.description_en ?? "",
      media: t.media_id ? media.get(t.media_id) ?? null : null,
      sort: t.sort,
      visible: t.visible,
    })),
    collections: ((cols.data ?? []) as TaxonRow[]).map((t) => ({
      id: t.id,
      slug: t.slug,
      name_fa: t.name_fa,
      name_en: t.name_en,
      tagline_fa: t.tagline_fa ?? "",
      tagline_en: t.tagline_en ?? "",
      story_fa: t.story_fa ?? "",
      story_en: t.story_en ?? "",
      media: t.media_id ? media.get(t.media_id) ?? null : null,
      sort: t.sort,
      visible: t.visible,
    })),
    products: products
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        sku: p.sku,
        name_fa: p.name_fa,
        name_en: p.name_en,
        subtitle_fa: p.subtitle_fa,
        subtitle_en: p.subtitle_en,
        description_fa: p.description_fa,
        description_en: p.description_en,
        category: p.category_id ? catSlug.get(p.category_id) ?? null : null,
        collection: p.collection_id ? colSlug.get(p.collection_id) ?? null : null,
        metal: (p.metal || "") as Product["metal"],
        stone: (p.stone || "") as Product["stone"],
        specs: Array.isArray(p.specs) ? p.specs : [],
        images: (p.images ?? []).map((id) => media.get(id)).filter((m): m is Media => Boolean(m)),
        variants: varsOf.get(p.id) ?? [],
        featured: p.featured,
        badge: (p.badge || "") as Product["badge"],
        sort: p.sort,
        created_at: p.created_at,
      }))
      .sort(byOrder),
  };
}

/** Whether the public site reads the catalogue from the database (vs. the built-in starter catalogue). */
export async function catalogInDb(): Promise<boolean> {
  return Boolean(db()) && (await getSettings()).catalog.initialized;
}

/**
 * The same question, strictly: a failed settings read throws instead of reading as "not initialized" (the
 * cached getSettings falls back to the defaults), so a database hiccup never turns into the starter catalogue.
 */
async function catalogInDbStrict(): Promise<boolean> {
  return Boolean(db()) && (await getSettingsFresh()).catalog.initialized;
}

async function loadCatalog(): Promise<Catalog> {
  if (!(await catalogInDbStrict())) return seedCatalog();
  return (await dbCatalog()) ?? seedCatalog();
}

// every admin change invalidates the tag at once; the timer is only a safety net for edits made in SQL
const cachedCatalog = unstable_cache(loadCatalog, ["celin-catalog-v1"], { tags: ["catalog"], revalidate: 3600 });

/**
 * The public catalogue (published items only, no prices). Cached; every admin change invalidates the
 * "catalog" tag. A failed read is never cached and is not hidden either: with a database configured the
 * error goes up, so a page being regenerated keeps its last good version (ISR) instead of baking in the
 * starter catalogue (unknown products would turn into 404s). Only without a database the starter catalogue
 * is the catalogue.
 */
export async function getCatalog(): Promise<Catalog> {
  try {
    return await cachedCatalog();
  } catch (e) {
    console.error("[catalog]", e);
    if (db()) throw e;
    return seedCatalog();
  }
}

export async function getProduct(slug: string): Promise<Product | null> {
  return (await getCatalog()).products.find((p) => p.slug === slug) ?? null;
}

/** Up to `n` other products: same collection first, then same category. */
export function related(catalog: Catalog, p: Product, n = 4): Product[] {
  const others = catalog.products.filter((x) => x.id !== p.id);
  const score = (x: Product) => (x.collection && x.collection === p.collection ? 2 : 0) + (x.category && x.category === p.category ? 1 : 0);
  return others
    .map((x) => ({ x, s: score(x) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.x.sort - b.x.sort)
    .slice(0, n)
    .map((r) => r.x);
}

/**
 * Prices and stock of every published product, for a Pro member only (the caller checks). Not cached:
 * stock changes with every order.
 */
export async function proPrices(): Promise<ProPrices> {
  if (!(await catalogInDbStrict())) return seedPrices();
  const c = db()!;
  const { data, error } = await c.from("celin_products").select("id, price, stock").eq("status", "published").limit(2000);
  if (error) {
    if (isMissingTable(error)) return seedPrices();
    throw new Error(error.message);
  }
  const rows = (data ?? []) as { id: string; price: number | null; stock: number }[];
  const out: ProPrices = {};
  for (const r of rows) out[r.id] = { price: r.price === null ? null : Number(r.price), stock: r.stock, variants: {} };
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 150) {
    const { data: vs, error: ve } = await c.from("celin_variants").select("id, product_id, price, stock").in("product_id", ids.slice(i, i + 150));
    if (ve) throw new Error(ve.message);
    for (const v of (vs ?? []) as { id: string; product_id: string; price: number | null; stock: number }[]) {
      const p = out[v.product_id];
      if (p) p.variants[v.id] = { price: v.price === null ? null : Number(v.price), stock: v.stock };
    }
  }
  return out;
}
