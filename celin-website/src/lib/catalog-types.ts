/**
 * Client-safe catalogue shapes. Public objects never carry price or stock: public pages are static and
 * shared by everyone, so those travel only in the members' price layer (/api/pro/prices) after a session check.
 */
import type { Media } from "@/lib/media";

export type Metal = "" | "gold" | "silver" | "rose" | "two-tone";
export type Badge = "" | "new" | "bestseller" | "limited";
export type ProductStatus = "draft" | "published" | "archived";

export const METALS: Exclude<Metal, "">[] = ["gold", "silver", "rose", "two-tone"];
/**
 * Stone colours by brand colour name — never gem names for simulants (white, Firouzeh blue, night blue, forest green,
 * pomegranate red, pearl-look, blush, black, mixed). The shop's «رنگ نگین» filter offers these.
 */
export const STONES = ["white", "blue", "navy", "green", "red", "pearl", "blush", "black", "mixed"] as const;
export type Stone = "" | (typeof STONES)[number];
/** Leather colours of the shop's «رنگ چرم» filter (only shown once a piece offers a leather colour). */
export const LEATHERS = ["black", "brown", "tan", "burgundy", "navy", "cream"] as const;
export type Leather = (typeof LEATHERS)[number];

/** Colour dots the site draws from its own tokens (globals.css --color-swatch-*); anything else is a #rrggbb of the admin's. */
export const SWATCH_KEYS = ["gold", "silver", "rose", "champagne", "black", "two-tone"] as const;
export const SWATCH_RE = /^(gold|silver|rose|champagne|black|two-tone|#[0-9a-f]{6})$/i;

/**
 * The option axes a product can be chosen by, always in this order (src/lib/options.ts): plating colour, stone colour,
 * leather colour. A combination is one variant: {"plating":"gold","stone":"white"} by key of the admin's colour lists.
 */
export const OPTION_AXES = ["plating", "stone", "leather"] as const;
export type OptionAxis = (typeof OPTION_AXES)[number];
export type VariantOptions = Partial<Record<OptionAxis, string>>;

/** One value of an axis as the public catalogue carries it: words, colour dot and shop-filter facet — no price, no stock. */
export interface AxisValue {
  key: string;
  name_fa: string;
  name_en: string;
  swatch: string;
  /** the shop filter it falls under (METALS / STONES / LEATHERS), or "" */
  facet: string;
}

/** An axis of one product: the values its combinations use, in the order of the admin's list. */
export interface ProductAxis {
  axis: OptionAxis;
  values: AxisValue[];
}

export interface Category {
  id: string;
  slug: string;
  name_fa: string;
  name_en: string;
  description_fa: string;
  description_en: string;
  media: Media | null;
  sort: number;
  visible: boolean;
}

export interface Collection {
  id: string;
  slug: string;
  name_fa: string;
  name_en: string;
  tagline_fa: string;
  tagline_en: string;
  story_fa: string;
  story_en: string;
  /** the collection's own picture, else its first piece's (withCovers); null only when neither exists — then it is not listed (`listed`) */
  media: Media | null;
  sort: number;
  visible: boolean;
  /** no published pieces yet: «به‌زودی» stands under its name when it has no tagline (its picture still shows) */
  soon: boolean;
}

export interface Spec {
  label_fa: string;
  label_en: string;
  value_fa: string;
  value_en: string;
}

export interface Variant {
  id: string;
  /** a combination's name is composed from the colour lists («طلایی · نگین سفید · چرم مشکی»); a plain option's is the admin's own */
  name_fa: string;
  name_en: string;
  /** gold | silver | rose | champagne | black | two-tone | #rrggbb */
  swatch: string;
  sku: string;
  image: Media | null;
  sort: number;
  /** the combination of the product's axes; {} = an option of the older plain list */
  options: VariantOptions;
}

export interface Product {
  id: string;
  slug: string;
  sku: string;
  name_fa: string;
  name_en: string;
  subtitle_fa: string;
  subtitle_en: string;
  description_fa: string;
  description_en: string;
  /** category / collection slugs */
  category: string | null;
  collection: string | null;
  metal: Metal;
  stone: Stone;
  specs: Spec[];
  images: Media[];
  variants: Variant[];
  /** the option axes its combinations use (plating → stone → leather); [] = no colour options (a plain list, or none) */
  axes: ProductAxis[];
  /**
   * How it is sold (src/lib/packs.ts): ascending, never empty; [1] = single only. Public terms, not price or stock —
   * a pack's price is worked out in the browser from the members' price book.
   */
  packs: number[];
  featured: boolean;
  badge: Badge;
  sort: number;
  created_at: string;
}

export interface Catalog {
  categories: Category[];
  collections: Collection[];
  products: Product[];
  /** "seed" = the built-in starter catalogue (database not set up or not imported yet) */
  source: "db" | "seed";
}

/** The first picture of a collection's pieces, in the catalogue's order (`products` are sorted as the site shows them). */
export function coverFromPieces(slug: string, products: readonly Product[]): Media | null {
  return products.find((p) => p.collection === slug && p.images.length > 0)?.images[0] ?? null;
}

/**
 * Every collection gets a picture where one exists: its own (Admin → دسته‌ها و مجموعه‌ها), else its first piece's,
 * so a collection shown without a picture of its own never stands as an empty arch (one with neither is not `listed`).
 */
export function withCovers(catalog: Catalog): Catalog {
  return { ...catalog, collections: catalog.collections.map((k) => (k.media ? k : { ...k, media: coverFromPieces(k.slug, catalog.products) })) };
}

/**
 * Whether the site lists a collection: shown by the owner and with a picture after `withCovers` (its own, else a
 * published piece's). Every public list of collections uses it — the home arcade, /collections, the other collections
 * under a collection, the header menu and phone drawer, search, the sitemap, the 404 and /craft — so no arch ever
 * stands empty. The catalogue itself keeps such a collection: its page and its pieces' collection name still resolve.
 */
export function listed(k: Collection): k is Collection & { media: Media } {
  return k.visible !== false && k.media != null;
}

/** The admin's price of one product in Toman (null = on request) and its stock, as members receive them (src/lib/pricing.ts sets what they see). */
export interface ProPrice {
  price: number | null;
  stock: number;
  variants: Record<string, { price: number | null; stock: number }>;
}

export type ProPrices = Record<string, ProPrice>;

/** Total stock of a product: the sum of its variants when it has any. */
export function stockOf(p: ProPrice | undefined): number {
  if (!p) return 0;
  const vs = Object.values(p.variants);
  return vs.length ? vs.reduce((s, v) => s + v.stock, 0) : p.stock;
}

/** Lowest price of a product (its variants included), or null. */
export function fromPrice(p: ProPrice | undefined): number | null {
  if (!p) return null;
  const vs = Object.values(p.variants);
  const all = vs.length ? vs.map((v) => v.price ?? p.price) : [p.price];
  const known = all.filter((x): x is number => typeof x === "number");
  return known.length ? Math.min(...known) : null;
}
