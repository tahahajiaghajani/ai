import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { db, isMissingTable, requireDb, UserError } from "@/lib/db";
import { getSettingsFresh, saveSettings } from "@/lib/settings";
import { loadMedia, PRODUCT_COLUMNS, VARIANT_COLUMNS } from "@/lib/catalog";
import { METALS, STONES, type Badge, type Metal, type ProductStatus, type Spec, type Stone } from "@/lib/catalog-types";
import type { Media } from "@/lib/media";
import { SEED_CATEGORIES, SEED_COLLECTIONS, SEED_PRODUCTS } from "@/content/seed-catalog";
import { SEED_MEDIA, type SeedKey } from "@/content/seed-media";

/**
 * Admin side of the catalogue: full rows (prices, stock, drafts), create / update / delete, and the one-time
 * import of the starter catalogue. Every function checks the admin session itself, so a caller can never
 * reach the data without it. After a change the public pages are refreshed through the "catalog" tag.
 */

export interface AdminVariant {
  id: string | null;
  name_fa: string;
  name_en: string;
  swatch: string;
  sku: string;
  price: number | null;
  stock: number;
  /** the stock the editor showed when it opened (see applyStock) */
  stock_loaded?: number | null;
  image_id: string | null;
  sort: number;
}

export interface AdminProduct {
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
  metal: Metal;
  stone: Stone;
  specs: Spec[];
  images: string[];
  price: number | null;
  stock: number;
  status: ProductStatus;
  featured: boolean;
  badge: Badge;
  sort: number;
  created_at: string;
  updated_at?: string;
  variants: AdminVariant[];
}

export interface AdminProductListItem {
  id: string;
  slug: string;
  sku: string;
  name_fa: string;
  name_en: string;
  status: ProductStatus;
  featured: boolean;
  category_id: string | null;
  collection_id: string | null;
  price: number | null;
  /** total stock (all options together) */
  stock: number;
  /** the smallest option stock (the product's own stock when it has no options): what «رو به اتمام» looks at */
  min_stock: number;
  variants: number;
  cover: Media | null;
  sort: number;
  updated_at: string;
}

export interface Taxon {
  id: string;
  slug: string;
  name_fa: string;
  name_en: string;
  description_fa: string;
  description_en: string;
  tagline_fa: string;
  tagline_en: string;
  story_fa: string;
  story_en: string;
  media_id: string | null;
  sort: number;
  visible: boolean;
}

export type TaxonKind = "categories" | "collections";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Called after every catalogue change: public pages and caches pick it up at once. */
export async function catalogChanged(): Promise<void> {
  await assertAdmin();
  const s = await getSettingsFresh();
  if (!s.catalog.initialized) await saveSettings("catalog", { initialized: true });
  revalidateTag("catalog", { expire: 0 });
  revalidatePath("/", "layout");
}

function text(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(String(v).replace(/[,٬\s]/g, "")));
  if (!Number.isFinite(n) || n < 0 || n > 1e13) throw new UserError("قیمت باید عددی مثبت (به تومان) باشد.");
  return n;
}

function count(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new UserError("موجودی باید عددی صفر یا بیشتر باشد.");
  return n;
}

/** The stock the editor showed (null when the caller did not send it). */
function loadedCount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? n : null;
}

/**
 * Stock is saved as the admin's change to what the editor showed, never as a stale overwrite: orders lower
 * the stock while the editor is open. Unchanged → the stored stock is left alone; changed → stored + (wanted
 * − loaded), never below 0 — a compare-and-set, retried if an order lands in between.
 */
async function applyStock(table: "celin_products" | "celin_variants", id: string, loaded: number, wanted: number): Promise<void> {
  if (wanted === loaded) return;
  const c = requireDb();
  let current = loaded;
  for (let i = 0; i < 6; i++) {
    const next = Math.max(0, current + (wanted - loaded));
    const { data, error } = await c.from(table).update({ stock: next }).eq("id", id).eq("stock", current).select("id");
    if (error) throw dbError(error);
    if ((data ?? []).length) return;
    const { data: row, error: re } = await c.from(table).select("stock").eq("id", id).maybeSingle();
    if (re) throw new Error(re.message);
    if (!row) return; // deleted meanwhile
    current = (row as { stock: number }).stock;
  }
  throw new UserError("موجودی همین حالا در حال تغییر است؛ چند لحظه بعد دوباره ذخیره کنید.");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);

// ------------------------------------------------------------------ products

export async function listAdminProducts(): Promise<AdminProductListItem[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from("celin_products").select("id, slug, sku, name_fa, name_en, status, featured, category_id, collection_id, price, stock, images, sort, updated_at").order("sort").order("created_at", { ascending: false }).limit(3000);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as (Omit<AdminProductListItem, "cover" | "variants"> & { images: string[] })[];
  const ids = rows.map((r) => r.id);
  const variants = new Map<string, { n: number; stock: number; min: number }>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data: vs } = await c.from("celin_variants").select("product_id, stock").in("product_id", ids.slice(i, i + 150));
    for (const v of (vs ?? []) as { product_id: string; stock: number }[]) {
      const cur = variants.get(v.product_id) ?? { n: 0, stock: 0, min: Infinity };
      variants.set(v.product_id, { n: cur.n + 1, stock: cur.stock + v.stock, min: Math.min(cur.min, v.stock) });
    }
  }
  const media = await loadMedia(rows.map((r) => r.images?.[0] ?? ""));
  return rows.map(({ images, ...r }) => {
    const v = variants.get(r.id);
    return { ...r, price: r.price === null ? null : Number(r.price), stock: v ? v.stock : r.stock, min_stock: v ? v.min : r.stock, variants: v?.n ?? 0, cover: images?.[0] ? media.get(images[0]) ?? null : null };
  });
}

/**
 * Published products with a piece running low: the product's own stock — or, with options, any option's — at or
 * below `threshold` (Settings → سفارش → «آستانه‌ی رو به اتمام», the same line members see). Same rule as the
 * «رو به اتمام» filter of the product list, so the dashboard number can be traced there.
 */
export async function lowStockCount(threshold: number): Promise<number> {
  await assertAdmin();
  const c = db();
  if (!c) return 0;
  const { data, error } = await c.from("celin_products").select("id, stock").eq("status", "published").limit(5000);
  if (error) {
    if (!isMissingTable(error)) console.error("[admin] low stock", error.message);
    return 0;
  }
  const rows = (data ?? []) as { id: string; stock: number }[];
  const min = new Map<string, number>();
  for (let i = 0; i < rows.length; i += 150) {
    const { data: vs } = await c.from("celin_variants").select("product_id, stock").in("product_id", rows.slice(i, i + 150).map((r) => r.id));
    for (const v of (vs ?? []) as { product_id: string; stock: number }[]) min.set(v.product_id, Math.min(min.get(v.product_id) ?? Infinity, v.stock));
  }
  return rows.filter((r) => (min.get(r.id) ?? r.stock) <= threshold).length;
}

export async function getAdminProduct(id: string): Promise<{ product: AdminProduct; media: Record<string, Media> } | null> {
  await assertAdmin();
  const c = requireDb();
  if (!UUID.test(id)) return null;
  const { data, error } = await c.from("celin_products").select(`${PRODUCT_COLUMNS}, updated_at`).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: vs, error: ve } = await c.from("celin_variants").select(VARIANT_COLUMNS).eq("product_id", id).order("sort");
  if (ve) throw new Error(ve.message);
  const p = data as Omit<AdminProduct, "variants">;
  const variants = ((vs ?? []) as (AdminVariant & { product_id: string })[]).map(({ product_id: _, ...v }) => ({ ...v, price: v.price === null ? null : Number(v.price) }));
  const media = await loadMedia([...(p.images ?? []), ...variants.map((v) => v.image_id ?? "")]);
  return {
    product: { ...p, price: p.price === null ? null : Number(p.price), specs: Array.isArray(p.specs) ? p.specs : [], images: p.images ?? [], variants },
    media: Object.fromEntries(media),
  };
}

/** Validated product fields from the editor form. Throws UserError with a Persian message. */
export function parseProduct(input: Record<string, unknown>) {
  const name_fa = text(input.name_fa, 160);
  if (name_fa.length < 2) throw new UserError("نام فارسی محصول را بنویسید.");
  const name_en = text(input.name_en, 160);
  const slug = text(input.slug, 80).toLowerCase() || slugify(name_en) || "";
  if (!SLUG_RE.test(slug)) throw new UserError("نشانی (slug) فقط حروف کوچک انگلیسی، عدد و خط تیره می‌پذیرد؛ مثلاً darya-ring.");
  const status = (["draft", "published", "archived"] as const).includes(input.status as ProductStatus) ? (input.status as ProductStatus) : "draft";
  const metal = (METALS as string[]).includes(String(input.metal)) ? (input.metal as Metal) : "";
  const stone = (STONES as readonly string[]).includes(String(input.stone)) ? (input.stone as Stone) : "";
  const badge = (["", "new", "bestseller", "limited"] as const).includes(input.badge as Badge) ? (input.badge as Badge) : "";
  const specs: Spec[] = (Array.isArray(input.specs) ? input.specs : [])
    .slice(0, 20)
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { label_fa: text(o.label_fa, 60), label_en: text(o.label_en, 60), value_fa: text(o.value_fa, 300), value_en: text(o.value_en, 300) };
    })
    .filter((s) => (s.label_fa || s.label_en) && (s.value_fa || s.value_en));
  const images = [...new Set((Array.isArray(input.images) ? input.images : []).map(uuidOrNull).filter((x): x is string => Boolean(x)))].slice(0, 24);
  const variants: AdminVariant[] = (Array.isArray(input.variants) ? input.variants : []).slice(0, 40).map((v, i) => {
    const o = (v ?? {}) as Record<string, unknown>;
    const nfa = text(o.name_fa, 80);
    if (!nfa) throw new UserError(`نام فارسی گزینه‌ی ${i + 1} را بنویسید (مثلاً «طلایی»).`);
    return {
      id: uuidOrNull(o.id),
      name_fa: nfa,
      name_en: text(o.name_en, 80),
      swatch: /^(gold|silver|rose|black|two-tone|#[0-9a-f]{6})$/i.test(String(o.swatch ?? "")) ? String(o.swatch).toLowerCase() : "",
      sku: text(o.sku, 60),
      price: money(o.price),
      stock: count(o.stock ?? 0),
      stock_loaded: loadedCount(o.stock_loaded),
      image_id: uuidOrNull(o.image_id),
      sort: i,
    };
  });
  return {
    row: {
      slug,
      sku: text(input.sku, 60),
      name_fa,
      name_en,
      subtitle_fa: text(input.subtitle_fa, 200),
      subtitle_en: text(input.subtitle_en, 200),
      description_fa: text(input.description_fa, 6000),
      description_en: text(input.description_en, 6000),
      category_id: uuidOrNull(input.category_id),
      collection_id: uuidOrNull(input.collection_id),
      metal,
      stone,
      specs,
      images,
      price: money(input.price),
      stock: count(input.stock ?? 0),
      status,
      featured: input.featured === true || input.featured === "on" || input.featured === "true",
      badge,
      sort: Math.max(-100000, Math.min(100000, Math.round(Number(input.sort) || 0))),
    },
    variants,
    stockLoaded: loadedCount(input.stock_loaded),
  };
}

/** Creates (no id) or updates a product with its variants. Returns the id. */
export async function saveProduct(id: string | null, input: Record<string, unknown>): Promise<string> {
  await assertAdmin();
  const c = requireDb();
  const { row, variants, stockLoaded } = parseProduct(input);
  let productId = id && UUID.test(id) ? id : null;
  const now = new Date().toISOString();
  if (productId) {
    const { stock, ...rest } = row;
    const { error } = await c
      .from("celin_products")
      .update({ ...rest, ...(stockLoaded === null ? { stock } : {}), updated_at: now })
      .eq("id", productId);
    if (error) throw dbError(error);
    if (stockLoaded !== null) await applyStock("celin_products", productId, stockLoaded, stock);
  } else {
    const { data, error } = await c.from("celin_products").insert(row).select("id").single();
    if (error) throw dbError(error);
    productId = (data as { id: string }).id;
  }

  // variants: update the kept ones, insert new ones, delete the removed ones
  const { data: existing, error: ee } = await c.from("celin_variants").select("id").eq("product_id", productId);
  if (ee) throw new Error(ee.message);
  const keep = new Set(variants.map((v) => v.id).filter(Boolean) as string[]);
  const remove = ((existing ?? []) as { id: string }[]).map((v) => v.id).filter((vid) => !keep.has(vid));
  if (remove.length) {
    const { error } = await c.from("celin_variants").delete().in("id", remove);
    if (error) throw new Error(error.message);
  }
  for (const v of variants) {
    const fields = { name_fa: v.name_fa, name_en: v.name_en, swatch: v.swatch, sku: v.sku, price: v.price, image_id: v.image_id, sort: v.sort, updated_at: now };
    const stored = v.id ? ((existing ?? []) as { id: string }[]).some((e) => e.id === v.id) : false;
    if (v.id && stored && v.stock_loaded != null) {
      const { error } = await c.from("celin_variants").update(fields).eq("id", v.id).eq("product_id", productId);
      if (error) throw new Error(error.message);
      await applyStock("celin_variants", v.id, v.stock_loaded, v.stock);
      continue;
    }
    const { error } = v.id
      ? await c.from("celin_variants").update({ ...fields, stock: v.stock }).eq("id", v.id).eq("product_id", productId)
      : await c.from("celin_variants").insert({ ...fields, stock: v.stock, product_id: productId });
    if (error) throw new Error(error.message);
  }
  await catalogChanged();
  return productId;
}

/** Only stock and price, for quick edits in the list. */
export async function quickUpdate(id: string, patch: { price?: unknown; stock?: unknown; stock_loaded?: unknown; status?: unknown }): Promise<void> {
  await assertAdmin();
  const c = requireDb();
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const loaded = loadedCount(patch.stock_loaded);
  if ("price" in patch) fields.price = money(patch.price);
  if ("stock" in patch && loaded === null) fields.stock = count(patch.stock);
  const status = "status" in patch && ["draft", "published", "archived"].includes(String(patch.status));
  if (status) fields.status = patch.status;
  const { error } = await c.from("celin_products").update(fields).eq("id", id);
  if (error) throw dbError(error);
  if ("stock" in patch && loaded !== null) await applyStock("celin_products", id, loaded, count(patch.stock));
  // public pages carry no price or stock: only a status change needs them rebuilt
  if (status) await catalogChanged();
}

export async function deleteProduct(id: string): Promise<void> {
  await assertAdmin();
  const c = requireDb();
  const { error } = await c.from("celin_products").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await catalogChanged();
}

export async function duplicateProduct(id: string): Promise<string> {
  await assertAdmin();
  const got = await getAdminProduct(id);
  if (!got) throw new UserError("محصول پیدا نشد.");
  const p = got.product;
  const c = requireDb();
  let slug = `${p.slug}-copy`;
  for (let i = 2; i < 50; i++) {
    const { data } = await c.from("celin_products").select("id").eq("slug", slug).maybeSingle();
    if (!data) break;
    slug = `${p.slug}-copy-${i}`;
  }
  return saveProduct(null, { ...p, slug, status: "draft", name_fa: `${p.name_fa} (کپی)`, variants: p.variants.map((v) => ({ ...v, id: null })) });
}

function dbError(error: { code?: string; message: string }): Error {
  if (error.code === "23505") return new UserError("این نشانی (slug) قبلاً برای مورد دیگری استفاده شده است؛ نشانی دیگری بنویسید.");
  if (error.code === "23514") return new UserError("یکی از مقادیر معتبر نیست (مثلاً نشانی، قیمت یا موجودی).");
  return new Error(error.message);
}

// ------------------------------------------------------------------ categories & collections

export async function listTaxa(kind: TaxonKind): Promise<Taxon[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  const cols = kind === "categories" ? "id, slug, name_fa, name_en, description_fa, description_en, media_id, sort, visible" : "id, slug, name_fa, name_en, tagline_fa, tagline_en, story_fa, story_en, media_id, sort, visible";
  const { data, error } = await c.from(`celin_${kind}`).select(cols).order("sort");
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  return ((data ?? []) as Partial<Taxon>[]).map((t) => ({
    id: t.id!,
    slug: t.slug!,
    name_fa: t.name_fa ?? "",
    name_en: t.name_en ?? "",
    description_fa: t.description_fa ?? "",
    description_en: t.description_en ?? "",
    tagline_fa: t.tagline_fa ?? "",
    tagline_en: t.tagline_en ?? "",
    story_fa: t.story_fa ?? "",
    story_en: t.story_en ?? "",
    media_id: t.media_id ?? null,
    sort: t.sort ?? 0,
    visible: t.visible ?? true,
  }));
}

export async function saveTaxon(kind: TaxonKind, id: string | null, input: Record<string, unknown>): Promise<string> {
  await assertAdmin();
  const c = requireDb();
  const name_fa = text(input.name_fa, 120);
  if (name_fa.length < 1) throw new UserError("نام فارسی را بنویسید.");
  const name_en = text(input.name_en, 120);
  const slug = text(input.slug, 80).toLowerCase() || slugify(name_en);
  if (!SLUG_RE.test(slug)) throw new UserError("نشانی (slug) فقط حروف کوچک انگلیسی، عدد و خط تیره می‌پذیرد.");
  const row: Record<string, unknown> = {
    slug,
    name_fa,
    name_en,
    media_id: uuidOrNull(input.media_id),
    sort: Math.round(Number(input.sort) || 0),
    visible: input.visible !== false && input.visible !== "false",
    updated_at: new Date().toISOString(),
  };
  if (kind === "categories") {
    row.description_fa = text(input.description_fa, 600);
    row.description_en = text(input.description_en, 600);
  } else {
    row.tagline_fa = text(input.tagline_fa, 200);
    row.tagline_en = text(input.tagline_en, 200);
    row.story_fa = text(input.story_fa, 3000);
    row.story_en = text(input.story_en, 3000);
  }
  let out = id && UUID.test(id) ? id : null;
  if (out) {
    const { error } = await c.from(`celin_${kind}`).update(row).eq("id", out);
    if (error) throw dbError(error);
  } else {
    const { data, error } = await c.from(`celin_${kind}`).insert(row).select("id").single();
    if (error) throw dbError(error);
    out = (data as { id: string }).id;
  }
  await catalogChanged();
  return out;
}

export async function deleteTaxon(kind: TaxonKind, id: string): Promise<void> {
  await assertAdmin();
  const c = requireDb();
  const { error } = await c.from(`celin_${kind}`).delete().eq("id", id);
  if (error) throw new Error(error.message);
  await catalogChanged();
}

export async function reorderTaxa(kind: TaxonKind, ids: string[]): Promise<void> {
  await assertAdmin();
  const c = requireDb();
  for (const [i, id] of ids.filter((x) => UUID.test(x)).entries()) {
    const { error } = await c.from(`celin_${kind}`).update({ sort: i }).eq("id", id);
    if (error) throw new Error(error.message);
  }
  await catalogChanged();
}

// ------------------------------------------------------------------ starter catalogue

/** media rows for the starter pictures (static files of the site), created once and reused. */
async function seedMediaIds(keys: SeedKey[]): Promise<Map<SeedKey, string>> {
  const c = requireDb();
  const out = new Map<SeedKey, string>();
  const paths = keys.map((k) => SEED_MEDIA[k].src);
  const { data, error } = await c.from("celin_media").select("id, path").in("path", paths);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { id: string; path: string }[]) {
    const k = keys.find((x) => SEED_MEDIA[x].src === r.path);
    if (k) out.set(k, r.id);
  }
  const missing = keys.filter((k) => !out.has(k));
  if (missing.length) {
    const rows = missing.map((k) => {
      const m = SEED_MEDIA[k];
      return { path: m.src, ext: m.ext, widths: m.widths, width: m.width, height: m.height, placeholder: m.placeholder, focal_x: m.fx, focal_y: m.fy, alt_fa: m.alt_fa, alt_en: m.alt_en };
    });
    const { data: ins, error: ie } = await c.from("celin_media").insert(rows).select("id, path");
    if (ie) throw new Error(ie.message);
    for (const r of (ins ?? []) as { id: string; path: string }[]) {
      const k = missing.find((x) => SEED_MEDIA[x].src === r.path);
      if (k) out.set(k, r.id);
    }
  }
  return out;
}

/** Public helper for slots: media id of a starter picture (created on first use). */
export async function seedMediaId(key: SeedKey): Promise<string> {
  await assertAdmin();
  return (await seedMediaIds([key])).get(key)!;
}

/**
 * Copies the starter catalogue into the database (categories, collections, products with variants and
 * pictures). Items whose slug already exists are left alone, so running it twice adds nothing.
 */
export async function importStarter(): Promise<{ products: number; categories: number; collections: number }> {
  await assertAdmin();
  const c = requireDb();
  const keys = new Set<SeedKey>();
  SEED_CATEGORIES.forEach((x) => keys.add(x.image));
  SEED_COLLECTIONS.forEach((x) => keys.add(x.image));
  SEED_PRODUCTS.forEach((p) => {
    p.images.forEach((k) => keys.add(k));
    p.variants.forEach((v) => v.image && keys.add(v.image));
  });
  const media = await seedMediaIds([...keys]);

  const upsertTaxa = async (kind: TaxonKind, rows: Record<string, unknown>[]) => {
    const { data: have, error } = await c.from(`celin_${kind}`).select("id, slug");
    if (error) throw new Error(error.message);
    const known = new Map(((have ?? []) as { id: string; slug: string }[]).map((r) => [r.slug, r.id]));
    const fresh = rows.filter((r) => !known.has(String(r.slug)));
    if (fresh.length) {
      const { data: ins, error: ie } = await c.from(`celin_${kind}`).insert(fresh).select("id, slug");
      if (ie) throw new Error(ie.message);
      for (const r of (ins ?? []) as { id: string; slug: string }[]) known.set(r.slug, r.id);
    }
    return { ids: known, added: fresh.length };
  };

  const cats = await upsertTaxa(
    "categories",
    SEED_CATEGORIES.map((x, i) => ({ slug: x.slug, name_fa: x.name_fa, name_en: x.name_en, description_fa: x.description_fa, description_en: x.description_en, media_id: media.get(x.image) ?? null, sort: i })),
  );
  const cols = await upsertTaxa(
    "collections",
    SEED_COLLECTIONS.map((x, i) => ({ slug: x.slug, name_fa: x.name_fa, name_en: x.name_en, tagline_fa: x.tagline_fa, tagline_en: x.tagline_en, story_fa: x.story_fa, story_en: x.story_en, media_id: media.get(x.image) ?? null, sort: i })),
  );

  const { data: haveP, error: pe } = await c.from("celin_products").select("slug");
  if (pe) throw new Error(pe.message);
  const knownP = new Set(((haveP ?? []) as { slug: string }[]).map((r) => r.slug));
  let added = 0;
  for (const [i, p] of SEED_PRODUCTS.entries()) {
    if (knownP.has(p.slug)) continue;
    const { data, error } = await c
      .from("celin_products")
      .insert({
        slug: p.slug,
        sku: p.sku,
        name_fa: p.name_fa,
        name_en: p.name_en,
        subtitle_fa: p.subtitle_fa,
        subtitle_en: p.subtitle_en,
        description_fa: p.description_fa,
        description_en: p.description_en,
        category_id: cats.ids.get(p.category) ?? null,
        collection_id: cols.ids.get(p.collection) ?? null,
        metal: p.metal,
        stone: p.stone,
        specs: p.specs,
        images: p.images.map((k) => media.get(k)).filter(Boolean),
        price: p.price,
        stock: p.stock,
        status: "published",
        featured: p.featured,
        badge: p.badge,
        sort: i,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const pid = (data as { id: string }).id;
    if (p.variants.length) {
      const { error: ve } = await c.from("celin_variants").insert(
        p.variants.map((v, j) => ({ product_id: pid, name_fa: v.name_fa, name_en: v.name_en, swatch: v.swatch, sku: v.sku, price: v.price, stock: v.stock, image_id: v.image ? media.get(v.image) ?? null : null, sort: j })),
      );
      if (ve) throw new Error(ve.message);
    }
    added++;
  }
  await catalogChanged();
  return { products: added, categories: cats.added, collections: cols.added };
}
