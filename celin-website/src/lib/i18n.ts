import type { Lang } from "@/lib/format";

export type { Lang } from "@/lib/format";
export { num, formatDate, formatPrice, formatNumber, formatPhone } from "@/lib/format";

export const LANGS: Lang[] = ["fa", "en"];

/** Persian lives at the root, English under /en. */
export function href(lang: Lang, path = "/"): string {
  if (lang === "fa") return path;
  return path === "/" ? "/en" : `/en${path}`;
}

/** The same page in the other language (for the language switch). */
export function otherLangPath(lang: Lang, pathname: string): string {
  if (lang === "en") {
    const rest = pathname.replace(/^\/en(?=\/|$)/, "");
    return rest || "/";
  }
  return pathname === "/" ? "/en" : `/en${pathname}`;
}

/** Picks the field of the page language with a fallback to Persian (English fields may be empty). */
export function t<T extends object>(row: T, field: string, lang: Lang): string {
  const r = row as Record<string, unknown>;
  const v = r[`${field}_${lang}`];
  const fa = r[`${field}_fa`];
  return (typeof v === "string" && v.trim() ? v : typeof fa === "string" ? fa : "") as string;
}

export const dirOf = (lang: Lang) => (lang === "fa" ? "rtl" : "ltr");
