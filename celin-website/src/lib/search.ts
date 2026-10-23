/** Client-safe search index (no prices). Built on the server from the public catalogue. */
import type { Media } from "@/lib/media";

export interface SearchItem {
  kind: "product" | "collection" | "category" | "page";
  slug: string;
  /** path without the language prefix */
  path: string;
  name_fa: string;
  name_en: string;
  sub_fa: string;
  sub_en: string;
  sku?: string;
  media?: Pick<Media, "src" | "ext" | "widths" | "placeholder" | "fx" | "fy"> | null;
  /** extra words that should find this item (fa + en) */
  terms: string;
}

const AR_FA: Record<string, string> = { "ي": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه", "أ": "ا", "إ": "ا", "آ": "ا" };

/** Lower-case, Persian letter variants unified, ZWNJ/diacritics removed, digits Latin. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْٰ]/g, "")
    .replace(/[‌‍]/g, " ")
    .replace(/[يكةۀأإآ]/g, (ch) => AR_FA[ch] ?? ch)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, " ")
    .trim();
}

/** Every query word must appear somewhere in the item; names weigh more than the rest. */
export function searchItems(items: SearchItem[], query: string, limit = 24): SearchItem[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const scored: { it: SearchItem; s: number }[] = [];
  for (const it of items) {
    const name = fold(`${it.name_fa} ${it.name_en}`);
    const all = fold(`${name} ${it.sub_fa} ${it.sub_en} ${it.sku ?? ""} ${it.terms}`);
    if (!words.every((w) => all.includes(w))) continue;
    let s = words.reduce((n, w) => n + (name.includes(w) ? 3 : 1), 0);
    if (name.startsWith(words[0])) s += 2;
    if (it.kind !== "product") s += 1;
    scored.push({ it, s });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.it);
}
