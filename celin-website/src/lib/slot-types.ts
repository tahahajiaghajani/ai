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
}

export type SlotMap = Record<string, ResolvedSlot>;

/** Text of a slot in the page language, falling back to Persian. */
export function slotText(slot: ResolvedSlot | undefined, key: string, lang: "fa" | "en"): string {
  const v = slot?.texts[key];
  if (!v) return "";
  return lang === "en" ? v.en || v.fa : v.fa;
}
