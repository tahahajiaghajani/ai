/**
 * Client-safe catalogue shapes. Public objects never carry price or stock: public pages are static and
 * shared by everyone, so those travel only in the Pro price layer (/api/pro/prices) after a session check.
 */
import type { Media } from "@/lib/media";

export type Metal = "" | "gold" | "silver" | "rose" | "two-tone";
export type Badge = "" | "new" | "bestseller" | "limited";
export type ProductStatus = "draft" | "published" | "archived";

export const METALS: Exclude<Metal, "">[] = ["gold", "silver", "rose", "two-tone"];
/** Stone colours by brand colour name — never gem names for simulants (white, Firouzeh blue, night blue, forest green, pomegranate red, pearl-look, mixed). */
export const STONES = ["white", "blue", "navy", "green", "red", "pearl", "mixed"] as const;
export type Stone = "" | (typeof STONES)[number];

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
  media: Media | null;
  sort: number;
  visible: boolean;
}

export interface Spec {
  label_fa: string;
  label_en: string;
  value_fa: string;
  value_en: string;
}

export interface Variant {
  id: string;
  name_fa: string;
  name_en: string;
  /** gold | silver | rose | black | two-tone | #rrggbb */
  swatch: string;
  sku: string;
  image: Media | null;
  sort: number;
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

/** What a Pro member sees for one product: price in Toman (null = on request) and stock. */
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
