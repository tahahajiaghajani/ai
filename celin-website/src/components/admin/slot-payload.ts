import type { Media } from "@/lib/media";

/** a gallery as the server takes it: library ids, `seed:<key>` for a built-in picture never copied into the library */
export const galleryIds = (items: Media[]) => items.map((m) => m.id ?? `seed:${m.src.replace(/^\/media\/seed\//, "")}`);

/**
 * A gallery's pictures in order, by file: a built-in picture copied into the library (to edit its alt text or focal
 * point) keeps its file, so it is still the same picture.
 */
export const galleryFiles = (items: Media[]) => items.map((m) => m.src);

/**
 * What the slot sheet sends for the picture. A gallery slot sends its list only when the list changed since the sheet
 * opened; otherwise, as every other slot, the slot's picture as it is (an unchanged stored list stays as it is). So
 * the opening's texts, button, phone picture and video save before the round-six SQL has added the list's column, and
 * only a changed list asks for that file.
 */
export function slotPicture(media: Media | null, gallery: { items: Media[]; opened: string[] } | null): { gallery: string[] } | { media_id: string | null } {
  if (gallery) {
    const files = galleryFiles(gallery.items);
    if (files.length !== gallery.opened.length || files.some((f, i) => f !== gallery.opened[i])) return { gallery: galleryIds(gallery.items) };
  }
  return { media_id: media?.id ?? null };
}
