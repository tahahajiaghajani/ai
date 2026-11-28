/** Client-safe slot shapes (see src/content/slots.ts and src/lib/slots.ts). */
import type { Media } from "@/lib/media";
import type { Video } from "@/lib/video";

export interface ResolvedSlot {
  key: string;
  media: Media;
  mobile: Media | null;
  /** optional looping background video (slots with `video: true`); `media` stays its poster and fallback */
  video?: Video | null;
  texts: Record<string, { fa: string; en: string }>;
  /** changed in the admin (vs. the built-in default) */
  custom: boolean;
  /** gallery slots only (SlotDef.gallery): the ordered pictures, the first being `media` */
  gallery?: Media[];
}

export type SlotMap = Record<string, ResolvedSlot>;

/** Text of a slot in the page language, falling back to Persian. */
export function slotText(slot: ResolvedSlot | undefined, key: string, lang: "fa" | "en"): string {
  const v = slot?.texts[key];
  if (!v) return "";
  return lang === "en" ? v.en || v.fa : v.fa;
}

/**
 * The pictures of a gallery slot: the stored list when there is one, otherwise the fallback pictures; padded from
 * the fallback up to `min` (a list thinned outside the panel never leaves the arcade short), without repeats.
 */
export function resolveGallery(stored: Media[], fallback: Media[], min: number): Media[] {
  const out: Media[] = [];
  const seen = new Set<string>();
  const add = (m: Media | null | undefined) => {
    if (!m || seen.has(m.src)) return;
    seen.add(m.src);
    out.push(m);
  };
  stored.forEach(add);
  for (const m of fallback) {
    if (out.length >= min) break;
    add(m);
  }
  return out;
}
