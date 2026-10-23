/**
 * Client-safe video model for the design slots that may carry a looping background video (src/content/slots.ts,
 * `video: true`). The file goes from the admin's browser straight into the public storage bucket (a signed
 * upload URL: Vercel functions take ~4.5 MB bodies at most), is checked again on the server and is served
 * from the site's own address with byte ranges (src/app/media/u). The slot's picture stays the poster and the
 * fallback. Pure helpers here are shared by the admin form, the server and the tests.
 */

import { num } from "@/lib/format";

export interface Video {
  id: string;
  /** same-origin URL, e.g. /media/u/v/<uuid>.mp4 */
  src: string;
  type: VideoMime;
  width: number;
  height: number;
  /** seconds */
  duration: number;
  bytes: number;
}

export interface VideoRow {
  id: string;
  path: string;
  mime: string;
  width: number;
  height: number;
  duration: number;
  bytes: number;
}

export const VIDEO_COLUMNS = "id, path, mime, width, height, duration, bytes";

export type VideoExt = "mp4" | "webm";
export type VideoMime = "video/mp4" | "video/webm";
export const VIDEO_MIME: Record<VideoExt, VideoMime> = { mp4: "video/mp4", webm: "video/webm" };

/** 25 MB: a few seconds of 1080p H.264 loop at a good bitrate. The bucket allows a little more (26 MiB). */
export const VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const VIDEO_ACCEPT = "video/mp4,video/webm,.mp4,.webm";

/** Stored object path: v/<uuid>.<ext> (a new file always gets a new name, so it can be cached for a year). */
export const VIDEO_PATH = /^v\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm)$/;

export const extOfMime = (mime: string): VideoExt | null => (mime === "video/mp4" ? "mp4" : mime === "video/webm" ? "webm" : null);

export function rowToVideo(r: VideoRow, storageBase: string): Video | null {
  const m = VIDEO_PATH.exec(r.path);
  if (!m || !storageBase) return null;
  return {
    id: r.id,
    src: `${storageBase.replace(/\/$/, "")}/${r.path}`,
    type: VIDEO_MIME[m[1] as VideoExt],
    width: r.width ?? 0,
    height: r.height ?? 0,
    duration: Number(r.duration) || 0,
    bytes: r.bytes ?? 0,
  };
}

/** The type the browser reports, with the file name as a fallback (some systems leave `type` empty). */
export function videoMimeOf(file: { type?: string; name?: string }): VideoMime | null {
  const t = (file.type ?? "").toLowerCase();
  if (t === "video/mp4" || t === "video/webm") return t;
  if (t === "") {
    if (/\.mp4$/i.test(file.name ?? "")) return "video/mp4";
    if (/\.webm$/i.test(file.name ?? "")) return "video/webm";
  }
  return null;
}

/** Checks type and size before an upload is signed (browser and server). Returns a Persian message or null. */
export function checkVideoFile(file: { type?: string; name?: string; size: number }): string | null {
  const mime = videoMimeOf(file);
  if (!mime) return /\.(mov|qt)$/i.test(file.name ?? "") || file.type === "video/quicktime" ? "فایل MOV پذیرفته نمی‌شود؛ ویدئو را با خروجی MP4 و کدک H.264 ذخیره کنید." : "فقط ویدئوی MP4 با کدک H.264 یا WebM پذیرفته می‌شود.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "فایل ویدئو خالی است.";
  if (file.size > VIDEO_MAX_BYTES) return `حجم ویدئو زیاد است (${num((file.size / 1048576).toFixed(1), "fa").replace(".", "٫")} مگابایت)؛ حداکثر ۲۵ مگابایت.`;
  return null;
}

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));

/**
 * Magic bytes of the first bytes of a file: an ISO-BMFF `ftyp` box (MP4; QuickTime's `qt  ` brand is refused)
 * or an EBML header whose DocType is "webm" (Matroska files that are not WebM do not play in Safari).
 */
export function sniffVideo(b: Uint8Array): VideoExt | null {
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand === "qt  ") return null;
    return /^[\x20-\x7e]{4}$/.test(brand) ? "mp4" : null;
  }
  if (b.length >= 8 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    // DocType element (0x4282) followed by its size and the text
    for (let i = 4; i < Math.min(b.length - 6, 64); i++) {
      if (b[i] === 0x42 && b[i + 1] === 0x82) return ascii(b, i + 3, 4) === "webm" ? "webm" : null;
    }
  }
  return null;
}

/** Bytes of the file to read at the start for sniffing (also the ranged read on the server). */
export const SNIFF_BYTES = 64;

export interface Mp4Info {
  /** `moov` before `mdat`: playback starts before the whole file has arrived */
  faststart: boolean;
  /** first video sample entry found in `moov`, e.g. avc1 (H.264), hvc1/hev1 (HEVC), av01 */
  codec: string | null;
}

function indexOfAscii(b: Uint8Array, s: string): number {
  const c = [...s].map((x) => x.charCodeAt(0));
  outer: for (let i = 0; i + c.length <= b.length; i++) {
    for (let j = 0; j < c.length; j++) if (b[i + j] !== c[j]) continue outer;
    return i;
  }
  return -1;
}

const VIDEO_CODECS = ["avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "mp4v", "dvh1", "dvhe"];

/**
 * Walks the top-level boxes of an MP4 (reading only box headers, then the `moov` box) to find the video
 * codec and whether the file is "fast start". `read(offset, length)` returns bytes of the file.
 */
export async function mp4Info(read: (offset: number, length: number) => Promise<Uint8Array>, size: number): Promise<Mp4Info | null> {
  let pos = 0;
  let sawMdat = false;
  for (let guard = 0; pos + 8 <= size && guard < 64; guard++) {
    const h = await read(pos, 16);
    if (h.length < 8) return null;
    let len = ((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3];
    const type = ascii(h, 4, 4);
    let header = 8;
    if (len === 1) {
      if (h.length < 16) return null;
      len = Number((BigInt(h[8]) << 56n) | (BigInt(h[9]) << 48n) | (BigInt(h[10]) << 40n) | (BigInt(h[11]) << 32n) | (BigInt(h[12]) << 24n) | (BigInt(h[13]) << 16n) | (BigInt(h[14]) << 8n) | BigInt(h[15]));
      header = 16;
    } else if (len === 0) {
      len = size - pos;
    }
    if (len < header || !/^[\x20-\x7e]{4}$/.test(type)) return null;
    if (type === "mdat") sawMdat = true;
    if (type === "moov") {
      const moov = await read(pos + header, Math.min(len - header, 8 * 1024 * 1024));
      let codec: string | null = null;
      let best = Infinity;
      for (const c of VIDEO_CODECS) {
        const at = indexOfAscii(moov, c);
        if (at >= 0 && at < best) {
          best = at;
          codec = c;
        }
      }
      return { faststart: !sawMdat, codec };
    }
    pos += len;
  }
  return null;
}

/** Whether a codec found by mp4Info plays in every current browser (Safari, Chrome, Firefox). */
export const playsEverywhere = (codec: string | null) => codec === null || codec === "avc1" || codec === "avc3";
