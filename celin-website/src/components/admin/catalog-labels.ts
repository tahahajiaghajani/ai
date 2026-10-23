import type { Badge, Metal, ProductStatus, Stone } from "@/lib/catalog-types";

/** Persian labels of the catalogue facets for the admin (client-safe). */

export const STATUS_LABEL: Record<ProductStatus, string> = { draft: "پیش‌نویس", published: "منتشرشده", archived: "بایگانی" };
export const STATUS_TONE: Record<ProductStatus, "warning" | "success" | "neutral"> = { draft: "warning", published: "success", archived: "neutral" };

export const METAL_LABEL: Record<Exclude<Metal, "">, string> = { gold: "طلایی", silver: "نقره‌ای (رودیوم)", rose: "رزگلد", "two-tone": "دورنگ" };

export const STONE_LABEL: Record<Exclude<Stone, "">, string> = {
  white: "سفید",
  blue: "آبی فیروزه‌ای",
  navy: "سرمه‌ای",
  green: "سبز جنگلی",
  red: "قرمز اناری",
  pearl: "مرواریدی",
  mixed: "چندرنگ",
};

export const BADGE_LABEL: Record<Exclude<Badge, "">, string> = { new: "تازه", bestseller: "پرفروش", limited: "محدود" };

/** Stock at or below this reads «رو به اتمام» in the list. */
export const LOW_STOCK = 2;

/** Same rule as the server (admin-catalog.ts): lower-case Latin words joined by dashes. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
