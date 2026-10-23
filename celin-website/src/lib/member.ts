import "server-only";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, type Account } from "@/lib/auth";
import type { Product } from "@/lib/catalog-types";
import { href, type Lang } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";

/** Helpers of the member pages (sign-in and the account area). */

/** Same-site path to return to after signing in (never the sign-in page itself or the admin). */
export function safeNextPath(v: unknown, lang: Lang): string {
  const s = typeof v === "string" ? v : "";
  const login = href(lang, "/account/login");
  if (!/^\/(?![/\\])[^\s]*$/.test(s) || s.startsWith("/admin") || s === login || s.startsWith(`${login}?`) || s.startsWith(`${login}#`)) return href(lang, "/account");
  return s;
}

export function loginPath(lang: Lang, next: string, tab?: "signin" | "signup" | "code"): string {
  return `${href(lang, "/account/login")}?${tab ? `tab=${tab}&` : ""}next=${encodeURIComponent(next)}`;
}

/** The signed-in account, or a redirect to the sign-in page that comes back to `path` (a path without /en). */
export async function requireMember(lang: Lang, path: string): Promise<Account> {
  const me = await currentUser();
  if (!me) redirect(loginPath(lang, href(lang, path)));
  return me;
}

/** Account pages are personal: never indexed. */
export function memberMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

/** The store's phone and WhatsApp for "contact the store" lines (only these two fields reach the browser). */
export async function storeContact(): Promise<{ phone: string; whatsapp: string }> {
  const s = await getSettings();
  return { phone: s.contact.phone, whatsapp: s.contact.whatsapp };
}

/** What the member pages need of a product (no descriptions or specs; prices never live here anyway). */
export function lightProduct(p: Product): Product {
  return { ...p, description_fa: "", description_en: "", specs: [], images: p.images.slice(0, 2) };
}
