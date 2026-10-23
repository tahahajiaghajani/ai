/**
 * Client-safe picture model. Every picture exists in a few widths as files `<src>/<width>.<ext>`:
 * the starter pictures under /media/seed/…, uploads in the public Supabase bucket. Pages render a plain
 * <img srcset> (no image optimiser on the server, no extra cost), with a tiny blurred preview and a focal
 * point that keeps the jewel in view when a picture is cropped to another shape.
 */

export interface Media {
  /** celin_media id (absent for built-in starter pictures that were never imported) */
  id?: string;
  /** folder URL without trailing slash */
  src: string;
  ext: string;
  widths: number[];
  width: number;
  height: number;
  placeholder: string;
  /** focal point, percent */
  fx: number;
  fy: number;
  alt_fa?: string;
  alt_en?: string;
}

export interface MediaRow {
  id: string;
  path: string;
  ext: string;
  widths: number[];
  width: number;
  height: number;
  placeholder: string;
  focal_x: number;
  focal_y: number;
  alt_fa: string;
  alt_en: string;
}

export const MEDIA_COLUMNS = "id, path, ext, widths, width, height, placeholder, focal_x, focal_y, alt_fa, alt_en";

/** Public folder URL of a stored path ("/…" = a static folder of the site, otherwise the storage bucket). */
export function folderUrl(path: string, storageBase: string): string {
  if (path.startsWith("/")) return path.replace(/\/$/, "");
  return `${storageBase.replace(/\/$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function rowToMedia(r: MediaRow, storageBase: string): Media {
  return {
    id: r.id,
    src: folderUrl(r.path, storageBase),
    ext: r.ext || "webp",
    widths: [...(r.widths ?? [])].sort((a, b) => a - b),
    width: r.width,
    height: r.height,
    placeholder: r.placeholder ?? "",
    fx: r.focal_x ?? 50,
    fy: r.focal_y ?? 50,
    alt_fa: r.alt_fa ?? "",
    alt_en: r.alt_en ?? "",
  };
}

/** The file for a target width: the smallest stored width that is at least that wide (else the largest). */
export function mediaUrl(m: Pick<Media, "src" | "ext" | "widths">, target = 960): string {
  const ws = m.widths.length ? m.widths : [960];
  const w = ws.find((x) => x >= target) ?? ws[ws.length - 1];
  return `${m.src}/${w}.${m.ext}`;
}

export function srcSet(m: Pick<Media, "src" | "ext" | "widths">): string {
  return m.widths.map((w) => `${m.src}/${w}.${m.ext} ${w}w`).join(", ");
}

export function altOf(m: Pick<Media, "alt_fa" | "alt_en"> | null | undefined, lang: "fa" | "en"): string {
  if (!m) return "";
  return (lang === "en" ? m.alt_en || m.alt_fa : m.alt_fa || m.alt_en) ?? "";
}

/** Widths generated for uploads (only those not wider than the original are kept). */
export const UPLOAD_WIDTHS = [480, 720, 960, 1280, 1600, 2048];
