// Files for «خواندن از تصویر»: checks type and size, shrinks large photos (long side 2000 px, JPEG) so the request
// stays small and the model reads the same detail, and reads the result whichever wrapper the server used.
import type { AiCaptureResult } from "@shared/ai/types";

export const CAPTURE_MAX_BYTES = 10 * 1024 * 1024;
/** The web version: Vercel refuses a request over 4.5 MB, and base64 makes a file a third larger. */
export const CAPTURE_WEB_MAX_BYTES = 3 * 1024 * 1024;
const MAX_SIDE = 2000;
const SHRINK_OVER = 1.5 * 1024 * 1024;
export const CAPTURE_MIMES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export interface PreparedFile {
  name: string;
  mime: string;
  /** base64 without the data: prefix */
  data: string;
  /** object URL of the preview (images only) */
  url: string | null;
  pdf: boolean;
  /** «۱٫۲ مگابایت، ۱۶۰۰×۱۲۰۰» */
  note: string;
}

const mb = (n: number) =>
  n < 1024 * 1024
    ? `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 }).format(Math.max(1, n / 1024))} کیلوبایت`
    : `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(n / 1024 / 1024)} مگابایت`;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Whether a file can be sent at all: the Persian reason when it cannot. */
export function fileProblem(f: { type: string; size: number }, max = CAPTURE_MAX_BYTES): string | null {
  const mime = f.type === "image/jpg" ? "image/jpeg" : f.type;
  if (!CAPTURE_MIMES.includes(mime)) return "فقط تصویر JPG، PNG، WebP یا فایل PDF پذیرفته می‌شود.";
  // a photo is shrunk before sending; a PDF goes as it is
  if (f.size > (mime === "application/pdf" ? max : CAPTURE_MAX_BYTES)) return tooBig(f.size, max);
  return null;
}

const tooBig = (size: number, max: number) =>
  `حجم فایل ${mb(size)} است؛ حداکثر ${new Intl.NumberFormat("fa-IR").format(Math.round(max / 1024 / 1024))} مگابایت${max < CAPTURE_MAX_BYTES ? " در نسخهٔ وب" : ""}.`;

/** The size a photo is scaled to (long side at most `max`), or null when it is small enough already. */
export function shrinkSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } | null {
  const long = Math.max(w, h);
  if (long <= max) return null;
  const k = max / long;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

async function shrink(f: File): Promise<{ blob: Blob; w: number; h: number } | null> {
  const bmp = await createImageBitmap(f).catch(() => null);
  if (!bmp) return null;
  const size = shrinkSize(bmp.width, bmp.height) ?? (f.size > SHRINK_OVER ? { w: bmp.width, h: bmp.height } : null);
  if (!size) {
    const r = { w: bmp.width, h: bmp.height };
    bmp.close();
    return { blob: f, ...r };
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  canvas.getContext("2d")?.drawImage(bmp, 0, 0, size.w, size.h);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  return blob ? { blob, ...size } : null;
}

/** `max`: the largest file the server takes here (CAPTURE_WEB_MAX_BYTES on the web version). */
export async function prepareFile(f: File, max = CAPTURE_MAX_BYTES): Promise<PreparedFile> {
  const problem = fileProblem(f, max);
  if (problem) throw new Error(problem);
  const pdf = f.type === "application/pdf";
  if (pdf) return { name: f.name, mime: f.type, data: toBase64(await f.arrayBuffer()), url: null, pdf, note: `PDF، ${mb(f.size)}` };
  const s = await shrink(f);
  const blob = s?.blob ?? f;
  if (blob.size > max) throw new Error(tooBig(blob.size, max));
  const mime = blob === f ? (f.type === "image/jpg" ? "image/jpeg" : f.type) : "image/jpeg";
  const dims = s ? `${new Intl.NumberFormat("fa-IR").format(s.w)}×${new Intl.NumberFormat("fa-IR").format(s.h)}` : "";
  return { name: f.name || "تصویر", mime, data: toBase64(await blob.arrayBuffer()), url: URL.createObjectURL(blob), pdf, note: [mb(blob.size), dims].filter(Boolean).join("، ") };
}

type Field = { value: string | null; confidence: number; note_fa?: string };

const fieldOf = (v: unknown): Field | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return { value: String(v), confidence: 0.5 };
  const o = v as Record<string, unknown>;
  const value = o.value === null || o.value === undefined ? null : String(o.value);
  const c = Number(o.confidence);
  return { value, confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c > 1 ? c / 100 : c)) : 0.5, ...(typeof o.note_fa === "string" ? { note_fa: o.note_fa } : {}) };
};

/** POST /ai/capture → AiCaptureResult (bare or under `capture`/`result`), values as strings, confidence 0…1. */
export function captureOf(r: unknown, kind: AiCaptureResult["kind"]): AiCaptureResult {
  const root = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
  const o = (root.capture ?? root.result ?? root) as Record<string, unknown>;
  const fields: Record<string, Field> = {};
  for (const [k, v] of Object.entries((o.fields ?? {}) as Record<string, unknown>)) {
    const f = fieldOf(v);
    if (f) fields[k] = f;
  }
  const lines = Array.isArray(o.lines)
    ? (o.lines as unknown[]).map((l) => {
        const out: Record<string, Field> = {};
        for (const [k, v] of Object.entries((l ?? {}) as Record<string, unknown>)) {
          const f = fieldOf(v);
          if (f) out[k] = f;
        }
        return out;
      })
    : undefined;
  return {
    id: String(o.id ?? ""),
    kind: (o.kind as AiCaptureResult["kind"]) ?? kind,
    fields,
    lines,
    warnings: Array.isArray(o.warnings) ? (o.warnings as unknown[]).map(String).filter(Boolean) : [],
    model: typeof o.model === "string" ? o.model : null,
  };
}
