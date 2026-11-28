import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { allRows, db, isMissingColumn, isMissingTable, requireDb, UserError } from "@/lib/db";
import { getSettingsFresh, saveSettings } from "@/lib/settings";
import { loadMedia, PRODUCT_COLUMNS, PRODUCT_R6_COLUMNS, VARIANT_COLUMNS, VARIANT_COLUMNS_V1, variantRows } from "@/lib/catalog";
import { METALS, STONES, SWATCH_RE, type Badge, type Metal, type ProductStatus, type Spec, type Stone, type VariantOptions } from "@/lib/catalog-types";
import { num } from "@/lib/format";
import type { Media } from "@/lib/media";
import { axesUsed, cleanOptions, cleanPalette, comboSku, DEFAULT_OPTIONS, hasOptions, MAX_VARIANTS, OPTION_AXES, optionLabel, optionsKey, optionSwatch, paletteOf, readOptions, valueOf, type OptionPalette } from "@/lib/options";
import { cleanPacks, packsOf, singleOnly } from "@/lib/packs";
import { SEED_CATEGORIES, SEED_COLLECTIONS, SEED_PRODUCTS, seedVariantFields } from "@/content/seed-catalog";
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
  /** the combination of the colour lists it is (src/lib/options.ts); {} = an option of the plain list */
  options: VariantOptions;
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
  /** how it is sold: 1 = single, 2–5 = packs of that many sizes (src/lib/packs.ts); never empty */
  packs: number[];
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
  const variants = new Map<string, { n: number; stock: number; min: number }>();
  // every option (page by page: a product may hold 100), so the sums and the lowest stock are whole
  for (const v of await variantRows<{ product_id: string; stock: number }>(c, rows.map((r) => r.id), "product_id, stock")) {
    const cur = variants.get(v.product_id) ?? { n: 0, stock: 0, min: Infinity };
    variants.set(v.product_id, { n: cur.n + 1, stock: cur.stock + v.stock, min: Math.min(cur.min, v.stock) });
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
  try {
    for (const v of await variantRows<{ product_id: string; stock: number }>(c, rows.map((r) => r.id), "product_id, stock")) min.set(v.product_id, Math.min(min.get(v.product_id) ?? Infinity, v.stock));
  } catch (e) {
    console.error("[admin] low stock", e);
    return 0;
  }
  return rows.filter((r) => (min.get(r.id) ?? r.stock) <= threshold).length;
}

export async function getAdminProduct(id: string): Promise<{ product: AdminProduct; media: Record<string, Media> } | null> {
  await assertAdmin();
  const c = requireDb();
  if (!UUID.test(id)) return null;
  const read = (columns: string) => c.from("celin_products").select(`${columns}, updated_at`).eq("id", id).maybeSingle();
  let { data, error } = await read(PRODUCT_R6_COLUMNS);
  // before round six's database file has run: sold single, as every product was
  if (error && isMissingColumn(error)) ({ data, error } = await read(PRODUCT_COLUMNS));
  if (error) throw new Error(error.message);
  if (!data) return null;
  const readVariants = (columns: string) => c.from("celin_variants").select(columns).eq("product_id", id).order("sort");
  let { data: vs, error: ve } = await readVariants(VARIANT_COLUMNS);
  // before round six's database file has run: every option is one of the plain list
  if (ve && isMissingColumn(ve)) ({ data: vs, error: ve } = await readVariants(VARIANT_COLUMNS_V1));
  if (ve) throw new Error(ve.message);
  const p = data as unknown as Omit<AdminProduct, "variants">;
  const variants = ((vs ?? []) as unknown as (Omit<AdminVariant, "options"> & { product_id: string; options?: unknown })[]).map(({ product_id: _, ...v }) => ({
    ...v,
    price: v.price === null ? null : Number(v.price),
    options: readOptions(v.options),
  }));
  const media = await loadMedia([...(p.images ?? []), ...variants.map((v) => v.image_id ?? "")]);
  return {
    product: { ...p, price: p.price === null ? null : Number(p.price), specs: Array.isArray(p.specs) ? p.specs : [], images: p.images ?? [], packs: packsOf(p.packs), variants },
    media: Object.fromEntries(media),
  };
}

/**
 * Validated product fields from the editor form. Throws UserError with a Persian message. A combination of the colour
 * lists (`palette`, Settings → «رنگ‌های گزینه‌ها») gets its name, dot and — when empty — SKU from the lists; the
 * editor's own words for it are not used.
 */
export function parseProduct(input: Record<string, unknown>, palette: OptionPalette = DEFAULT_OPTIONS) {
  const name_fa = text(input.name_fa, 160);
  if (name_fa.length < 2) throw new UserError("نام فارسی محصول را بنویسید.");
  const name_en = text(input.name_en, 160);
  const slug = text(input.slug, 80).toLowerCase() || slugify(name_en) || "";
  if (!SLUG_RE.test(slug)) throw new UserError("نشانی (slug) فقط حروف کوچک انگلیسی، عدد و خط تیره می‌پذیرد؛ مثلاً darya-ring.");
  const status = (["draft", "published", "archived"] as const).includes(input.status as ProductStatus) ? (input.status as ProductStatus) : "draft";
  let metal: Metal = (METALS as string[]).includes(String(input.metal)) ? (input.metal as Metal) : "";
  let stone: Stone = (STONES as readonly string[]).includes(String(input.stone)) ? (input.stone as Stone) : "";
  const badge = (["", "new", "bestseller", "limited"] as const).includes(input.badge as Badge) ? (input.badge as Badge) : "";
  const specs: Spec[] = (Array.isArray(input.specs) ? input.specs : [])
    .slice(0, 20)
    .map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      return { label_fa: text(o.label_fa, 60), label_en: text(o.label_en, 60), value_fa: text(o.value_fa, 300), value_en: text(o.value_en, 300) };
    })
    .filter((s) => (s.label_fa || s.label_en) && (s.value_fa || s.value_en));
  const images = [...new Set((Array.isArray(input.images) ? input.images : []).map(uuidOrNull).filter((x): x is string => Boolean(x)))].slice(0, 24);
  const sku = text(input.sku, 60);
  // never cut silently: the options left out would be deleted on save, with their stock
  const rawVariants = Array.isArray(input.variants) ? input.variants : [];
  if (rawVariants.length > MAX_VARIANTS) throw new UserError(`هر محصول حداکثر ${num(MAX_VARIANTS, "fa")} گزینه (ترکیب) دارد؛ چند رنگ را از گزینه‌ها بردارید.`);
  const variants: AdminVariant[] = rawVariants.map((v, i) => {
    const o = (v ?? {}) as Record<string, unknown>;
    const { options, unknown } = cleanOptions(o.options, palette);
    if (unknown) throw new UserError(`رنگ «${unknown}» دیگر در «رنگ‌های گزینه‌ها» نیست؛ صفحه را دوباره باز کنید.`);
    const combo = hasOptions(options);
    const nfa = combo ? optionLabel(options, palette, "fa") : text(o.name_fa, 80);
    if (!nfa) throw new UserError(`نام فارسی گزینه‌ی ${num(i + 1, "fa")} را بنویسید (مثلاً «طلایی»).`);
    return {
      id: uuidOrNull(o.id),
      name_fa: nfa,
      name_en: combo ? optionLabel(options, palette, "en") : text(o.name_en, 80),
      swatch: combo ? optionSwatch(options, palette) : SWATCH_RE.test(String(o.swatch ?? "")) ? String(o.swatch).toLowerCase() : "",
      sku: text(o.sku, 60) || (combo ? comboSku(sku, options, palette) : ""),
      price: money(o.price),
      stock: count(o.stock ?? 0),
      stock_loaded: loadedCount(o.stock_loaded),
      image_id: uuidOrNull(o.image_id),
      sort: i,
      options,
    };
  });
  // one kind of option per product, the same axes on every combination, no combination twice
  const combos = variants.filter((v) => hasOptions(v.options));
  if (combos.length && combos.length !== variants.length) throw new UserError("همه‌ی گزینه‌های یک محصول باید از یک نوع باشند: یا ترکیب رنگ‌ها، یا فهرست ساده.");
  if (combos.length) {
    const axes = axesUsed(combos[0].options).join();
    if (combos.some((v) => axesUsed(v.options).join() !== axes)) throw new UserError("همه‌ی ترکیب‌ها باید همان رنگ‌ها (آبکاری، نگین، چرم) را داشته باشند.");
    const seen = new Set<string>();
    for (const v of combos) {
      const k = optionsKey(v.options);
      if (seen.has(k)) throw new UserError(`ترکیب «${v.name_fa}» دو بار آمده است.`);
      seen.add(k);
    }
    // the shop filter reads an axis from its colours (their facets in the lists), so the piece keeps none of its own there
    if (combos[0].options.plating) metal = "";
    if (combos[0].options.stone) stone = "";
  }
  // how it is sold: any of single and packs of 2–5 sizes, at least one (null: the caller did not send it — left as stored)
  const packs = input.packs === undefined ? null : cleanPacks(input.packs);
  if (packs && !packs.length) throw new UserError("دست‌کم یکی از «تک» یا بسته‌ها را برای «نوع فروش» انتخاب کنید.");
  return {
    packs,
    row: {
      slug,
      sku,
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
  const palette = paletteOf((await getSettingsFresh()).options);
  const { row, packs, variants, stockLoaded } = parseProduct(input, palette);
  // colours need round six's database file: asked before anything is written (a plain list saves without it)
  if (variants.some((v) => hasOptions(v.options))) {
    const { error } = await c.from("celin_variants").select("options").limit(1);
    if (error && isMissingColumn(error)) throw new UserError("برای گزینه‌های رنگی (آبکاری، نگین، چرم) ابتدا فایل SQL تازه را در Supabase اجرا کنید؛ «اتصالات» را ببینید.");
  }
  let productId = id && UUID.test(id) ? id : null;
  const now = new Date().toISOString();
  // with packs when the editor sent them; the database before round six has no such column — single needs none,
  // anything else waits for that file (Admin → «اتصالات»)
  const write = async <T>(go: (extra: { packs?: number[] }) => PromiseLike<{ data: T; error: { code?: string; message: string } | null }>) => {
    const r = await go(packs ? { packs } : {});
    if (!r.error || !packs || !isMissingColumn(r.error)) return r;
    if (!singleOnly(packs)) throw new UserError("برای فروش بسته‌ای (۲ تا ۵ سایز) ابتدا فایل SQL تازه را در Supabase اجرا کنید؛ «اتصالات» را ببینید.");
    return go({});
  };
  if (productId) {
    const { stock, ...rest } = row;
    const pid = productId;
    const { error } = await write((extra) =>
      c
        .from("celin_products")
        .update({ ...rest, ...extra, ...(stockLoaded === null ? { stock } : {}), updated_at: now })
        .eq("id", pid),
    );
    if (error) throw dbError(error);
    if (stockLoaded !== null) await applyStock("celin_products", productId, stockLoaded, stock);
  } else {
    const { data, error } = await write((extra) => c.from("celin_products").insert({ ...row, ...extra }).select("id").single());
    if (error) throw dbError(error);
    productId = (data as { id: string }).id;
  }

  // variants: update the kept ones, insert new ones, delete the removed ones. The combination goes with them; a
  // database before round six's file has no such column — a plain list needs none, colours wait for that file
  const combos = variants.some((v) => hasOptions(v.options));
  let withOptions = true;
  const variantWrite = async (go: (extra: { options?: VariantOptions }) => PromiseLike<{ error: { code?: string; message: string } | null }>, v: AdminVariant) => {
    const r = await go(withOptions ? { options: v.options } : {});
    if (!r.error || !withOptions || !isMissingColumn(r.error)) return r;
    if (combos) throw new UserError("برای گزینه‌های رنگی (آبکاری، نگین، چرم) ابتدا فایل SQL تازه را در Supabase اجرا کنید؛ «اتصالات» را ببینید.");
    withOptions = false;
    return go({});
  };
  const { data: existing, error: ee } = await c.from("celin_variants").select("id").eq("product_id", productId);
  if (ee) throw new Error(ee.message);
  const keep = new Set(variants.map((v) => v.id).filter(Boolean) as string[]);
  const remove = ((existing ?? []) as { id: string }[]).map((v) => v.id).filter((vid) => !keep.has(vid));
  if (remove.length) {
    const { error } = await c.from("celin_variants").delete().in("id", remove);
    if (error) throw new Error(error.message);
  }
  const pid = productId;
  for (const v of variants) {
    const fields = { name_fa: v.name_fa, name_en: v.name_en, swatch: v.swatch, sku: v.sku, price: v.price, image_id: v.image_id, sort: v.sort, updated_at: now };
    const stored = v.id ? ((existing ?? []) as { id: string }[]).some((e) => e.id === v.id) : false;
    if (v.id && stored && v.stock_loaded != null) {
      const vid = v.id;
      const { error } = await variantWrite((extra) => c.from("celin_variants").update({ ...fields, ...extra }).eq("id", vid).eq("product_id", pid), v);
      if (error) throw new Error(error.message);
      await applyStock("celin_variants", v.id, v.stock_loaded, v.stock);
      continue;
    }
    const vid = v.id;
    const { error } = await variantWrite(
      (extra) =>
        vid
          ? c.from("celin_variants").update({ ...fields, ...extra, stock: v.stock }).eq("id", vid).eq("product_id", pid)
          : c.from("celin_variants").insert({ ...fields, ...extra, stock: v.stock, product_id: pid }),
      v,
    );
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

// ------------------------------------------------------------------ the colour lists (Settings → «رنگ‌های گزینه‌ها»)

/** Every stored combination's colours (none before round six's database file). */
async function storedCombos(): Promise<{ id: string; product_id: string; options: VariantOptions; name_fa: string; name_en: string; swatch: string }[]> {
  const c = requireDb();
  try {
    const rows = await allRows<{ id: string; product_id: string; options: unknown; name_fa: string; name_en: string; swatch: string }>((from, to) =>
      c.from("celin_variants").select("id, product_id, options, name_fa, name_en, swatch").order("id").range(from, to),
    );
    return rows.map((r) => ({ ...r, options: readOptions(r.options) })).filter((r) => hasOptions(r.options));
  } catch (e) {
    if (isMissingColumn(e as { code?: string })) return [];
    throw e;
  }
}

/** How many products use each colour ("plating:gold" → 3): a colour in use cannot be deleted from its list. */
export async function optionUsage(): Promise<Record<string, number>> {
  await assertAdmin();
  const products = new Map<string, Set<string>>();
  for (const r of await storedCombos()) {
    for (const axis of axesUsed(r.options)) {
      const k = `${axis}:${r.options[axis]}`;
      products.set(k, (products.get(k) ?? new Set()).add(r.product_id));
    }
  }
  return Object.fromEntries([...products].map(([k, set]) => [k, set.size]));
}

/**
 * Writes the lists' words and dots into every stored combination whose name changed (orders copy a variant's name
 * when they are placed, so the next order reads the new name; placed orders keep theirs). Returns how many changed.
 */
async function recomposeVariants(palette: OptionPalette): Promise<number> {
  const c = requireDb();
  const changed = (await storedCombos())
    .map((r) => ({ id: r.id, before: r, after: { name_fa: optionLabel(r.options, palette, "fa"), name_en: optionLabel(r.options, palette, "en"), swatch: optionSwatch(r.options, palette) } }))
    .filter((x) => x.before.name_fa !== x.after.name_fa || x.before.name_en !== x.after.name_en || x.before.swatch !== x.after.swatch);
  const now = new Date().toISOString();
  for (let i = 0; i < changed.length; i += 10) {
    await Promise.all(
      changed.slice(i, i + 10).map(async (x) => {
        const { error } = await c.from("celin_variants").update({ ...x.after, updated_at: now }).eq("id", x.id);
        if (error) throw new Error(error.message);
      }),
    );
  }
  return changed.length;
}

/**
 * Saves the colour lists: checked (src/lib/options.ts cleanPalette), a colour still used by a product is never
 * removed, and every stored combination takes the new words at once. Returns how many combinations were renamed.
 */
export async function saveOptionPalette(input: unknown): Promise<{ renamed: number }> {
  await assertAdmin();
  requireDb();
  const { palette, error } = cleanPalette(input);
  if (!palette) throw new UserError(error);
  const before = paletteOf((await getSettingsFresh()).options);
  const usage = await optionUsage();
  for (const axis of OPTION_AXES) {
    for (const v of before[axis]) {
      const n = usage[`${axis}:${v.key}`] ?? 0;
      if (n && !valueOf(palette, axis, v.key)) throw new UserError(`«${v.fa}» در ${num(n, "fa")} محصول به کار رفته است؛ اول آن را از گزینه‌های ${n === 1 ? "آن محصول" : "آن محصولات"} بردارید.`);
    }
  }
  // a colour in use that the stored lists never had (edited by hand) stays too, so no combination loses its words
  for (const [k, n] of Object.entries(usage)) {
    const [axis, key] = k.split(":") as [(typeof OPTION_AXES)[number], string];
    if (n && !valueOf(palette, axis, key) && !valueOf(before, axis, key)) throw new UserError(`رنگ «${key}» در ${num(n, "fa")} محصول به کار رفته و در فهرست نیست؛ آن را با همین نشانی به فهرست برگردانید یا از آن محصولات بردارید.`);
  }
  await saveSettings("options", palette);
  const renamed = await recomposeVariants(palette);
  await catalogChanged();
  return { renamed };
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

/**
 * Only the «نمایش» switch of a row: writes `visible` and nothing else, so a row drawn from an older copy of the list
 * never writes its other fields (picture, order, texts) back over fresher ones.
 */
export async function setTaxonVisible(kind: TaxonKind, id: string, visible: boolean): Promise<void> {
  await assertAdmin();
  const gone = () => new UserError("این مورد پیدا نشد؛ صفحه را دوباره باز کنید.");
  if (!UUID.test(id)) throw gone();
  const c = requireDb();
  const { data, error } = await c.from(`celin_${kind}`).update({ visible, updated_at: new Date().toISOString() }).eq("id", id).select("id");
  if (error) throw dbError(error);
  if (!((data ?? []) as unknown[]).length) throw gone();
  await catalogChanged();
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
 * The site still shows the built-in starter catalogue and the database has none of its own yet (no product,
 * category or collection, and the catalogue never changed): the panel copies the starter catalogue in on its first
 * visit (<StarterSync/>), so what the site shows is what the panel manages.
 */
export async function starterPending(): Promise<boolean> {
  await assertAdmin();
  const c = db();
  if (!c) return false;
  if ((await getSettingsFresh()).catalog.initialized) return false;
  const counts = await Promise.all(["celin_products", "celin_categories", "celin_collections"].map((t) => c.from(t).select("id", { count: "exact", head: true })));
  if (counts.some((r) => r.error)) return false;
  return counts.every((r) => (r.count ?? 0) === 0);
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
  const palette = paletteOf((await getSettingsFresh()).options);

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
      // combinations of the colour lists by their keys, named from today's lists; before round six's database file
      // they go in as plain options with the same names
      const rows = p.variants.map((v, j) => ({ product_id: pid, ...seedVariantFields(v, palette), sku: v.sku, price: v.price, stock: v.stock, image_id: v.image ? media.get(v.image) ?? null : null, sort: j }));
      let { error: ve } = await c.from("celin_variants").insert(rows);
      if (ve && isMissingColumn(ve)) ({ error: ve } = await c.from("celin_variants").insert(rows.map(({ options: _, ...r }) => r)));
      if (ve) throw new Error(ve.message);
    }
    added++;
  }
  await catalogChanged();
  return { products: added, categories: cats.added, collections: cols.added };
}
