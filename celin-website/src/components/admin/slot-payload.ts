import type { Media } from "@/lib/media";

/** a gallery as the server takes it: library ids, `seed:<key>` for a built-in picture never copied into the library */
export const galleryIds = (items: Media[]) => items.map((m) => m.id ?? `seed:${m.src.replace(/^\/media\/seed\//, "")}`);

/**
 * What the slot sheet sends for the picture. A gallery slot sends its list only when the list changed since the sheet
 * opened (`opened` = galleryIds then); otherwise, as every other slot, the slot's picture as it is (an unchanged
 * stored list stays as it is). So the opening's texts, button, phone picture and video save before the round-six SQL
 * has added the list's column, and only a changed list asks for that file. The lists are compared as the server
 * stores them: a built-in picture copied into the library (to edit its alt text or focal point) is a change, since
 * only a saved list links that library row to the opening.
 */
export function slotPicture(media: Media | null, gallery: { items: Media[]; opened: string[] } | null): { gallery: string[] } | { media_id: string | null } {
  if (gallery) {
    const ids = galleryIds(gallery.items);
    if (ids.length !== gallery.opened.length || ids.some((id, i) => id !== gallery.opened[i])) return { gallery: ids };
  }
  return { media_id: media?.id ?? null };
}
