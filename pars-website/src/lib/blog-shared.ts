/** Blog vocabulary shared by the server, the public pages and the admin editor (client-safe). */

export type PostLang = "fa" | "en";
export type PostStatus = "draft" | "published";

export interface Post {
  id: string;
  lang: PostLang;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  cover_url: string;
  tags: string[];
  status: PostStatus;
  published_at: string | null;
  updated_at: string;
}

/** URL slug: keeps Persian and Latin letters and digits, joins words with "-". */
export function slugify(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/‌/g, "-")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export function isSlug(v: string): boolean {
  return v.length > 0 && v.length <= 80 && /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(v);
}

/** Reading time at ~200 words a minute (Persian and English alike). */
export function readingMinutes(body: string): number {
  const words = body.replace(/[`*#>\-[\]()!]/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
