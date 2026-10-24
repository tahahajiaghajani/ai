"use client";

import { UPLOAD_WIDTHS, type Media } from "@/lib/media";

/**
 * Prepares a picture in the browser: honours the camera orientation, makes the upload widths (never wider
 * than the original), encodes WebP (JPEG where the browser cannot write WebP, e.g. older Safari) and a tiny
 * blurred preview, then sends everything to /api/admin/upload in one request.
 */

const QUALITY = 0.86;
const MAX_SIDE = 2730; // a 3:4 portrait keeps 2048px of width
const MAX_WIDTH = UPLOAD_WIDTHS[UPLOAD_WIDTHS.length - 1]; // pages never ask for more; landscape photos stop here

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((ok) => c.toBlob((b) => ok(b), type, q));
}

async function encode(c: HTMLCanvasElement): Promise<{ blob: Blob; ext: "webp" | "jpg" }> {
  const webp = await toBlob(c, "image/webp", QUALITY);
  if (webp && webp.type === "image/webp") return { blob: webp, ext: "webp" };
  const jpg = await toBlob(c, "image/jpeg", QUALITY);
  if (!jpg) throw new Error("مرورگر نتوانست تصویر را آماده کند.");
  return { blob: jpg, ext: "jpg" };
}

function draw(src: ImageBitmap | HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = canvasOf(w, h);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, w, h);
  return c;
}

export async function prepareImage(file: File): Promise<{ form: FormData; width: number; height: number }> {
  if (!/^image\/(jpeg|png|webp|avif|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp|avif|heic)$/i.test(file.name)) {
    throw new Error("فقط فایل تصویر (JPG، PNG، WebP) پذیرفته می‌شود.");
  }
  if (file.size > 40 * 1024 * 1024) throw new Error("حجم فایل بیش از ۴۰ مگابایت است.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("این تصویر در مرورگر باز نشد؛ آن را با فرمت JPG یا PNG ذخیره کنید و دوباره امتحان کنید.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height), MAX_WIDTH / bitmap.width);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const base = draw(bitmap, width, height);
  bitmap.close();

  const widths = UPLOAD_WIDTHS.filter((w) => w < width);
  widths.push(width);
  const form = new FormData();
  let ext: "webp" | "jpg" | null = null;
  for (const w of widths) {
    const c = w === width ? base : draw(base, w, Math.round((height * w) / width));
    const out = await encode(c);
    // all widths of one picture must share one format
    if (ext && out.ext !== ext) throw new Error("مرورگر نتوانست تصویر را یکسان آماده کند؛ مرورگر دیگری امتحان کنید.");
    ext = out.ext;
    form.append(`w${w}`, out.blob, `${w}.${out.ext}`);
  }
  const tiny = draw(base, 12, Math.max(1, Math.round((12 * height) / width)));
  const placeholder = tiny.toDataURL("image/webp", 0.5).startsWith("data:image/webp") ? tiny.toDataURL("image/webp", 0.5) : tiny.toDataURL("image/jpeg", 0.5);
  form.set("width", String(width));
  form.set("height", String(height));
  form.set("placeholder", placeholder);
  return { form, width, height };
}

export async function uploadImage(file: File, alt: { fa?: string; en?: string } = {}): Promise<Media> {
  const { form } = await prepareImage(file);
  form.set("alt_fa", alt.fa ?? "");
  form.set("alt_en", alt.en ?? "");
  const res = await fetch("/api/admin/upload", { method: "POST", body: form, credentials: "same-origin" });
  const j = (await res.json().catch(() => null)) as { ok: boolean; media?: Media; error?: string } | null;
  if (!res.ok || !j?.ok || !j.media) throw new Error(j?.error ?? "بارگذاری انجام نشد.");
  return j.media;
}
