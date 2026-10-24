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

export const BADGE_LABEL: Record<Exclude<Badge, "">, string> = { new: "تازه", bestseller: "محبوب", limited: "تعداد محدود" };

/**
 * Stock level of a product in the admin list: "out" when nothing is left (every option empty), "low" when the
 * product — or any of its options — has `low` or fewer left (Settings → سفارش → «آستانه‌ی رو به اتمام», the
 * line members see too; the dashboard counts published products the same way), otherwise null.
 */
export function stockLevel(p: { stock: number; min_stock: number }, low: number): "out" | "low" | null {
  if (p.stock <= 0) return "out";
  return p.min_stock <= low ? "low" : null;
}

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
