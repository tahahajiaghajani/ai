// Files sent with a question: images (a photo of a document, an error on a screen, a screenshot) and PDFs. They travel inside the
// JSON body, so they are kept small: large photos are scaled down in the browser before sending, and the whole
// question stays under the size a serverless request accepts.
import type { AiAttachmentInput } from "@shared/ai/api";
import { fa } from "../../lib/fa";
import { fileSize } from "./format";

export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf";
export const MAX_FILES = 4;
/** a PDF as it is (it cannot be shrunk here) */
export const MAX_PDF = 3 * 1024 * 1024;
/** an image before scaling (larger photos are refused rather than decoded) */
export const MAX_IMAGE_IN = 20 * 1024 * 1024;
/** every file of one question together, after scaling (the base64 body stays under ≈4.5 MB) */
export const MAX_TOTAL = 3.2 * 1024 * 1024;
/** the longest side of an image sent to a model */
const MAX_SIDE = 1800;

const IMAGE = /^image\/(png|jpeg|webp|gif)$/;

export interface PendingFile {
  key: string;
  name: string;
  mime: string;
  /** bytes after scaling */
  size: number;
  data: string; // base64 without the data: prefix
  /** object URL of a small preview (images) */
  preview: string | null;
}

/** Why a file cannot be added (null: it can). Pure: unit-tested. */
export function refuseFile(f: { name: string; type: string; size: number }, have: { size: number }[]): string | null {
  if (have.length >= MAX_FILES) return `در هر پرسش ${fa(MAX_FILES)} فایل را می‌توان فرستاد.`;
  if (f.type === "application/pdf") {
    if (f.size > MAX_PDF) return `«${f.name}» بزرگ‌تر از ${fileSize(MAX_PDF)} است.`;
  } else if (IMAGE.test(f.type)) {
    if (f.size > MAX_IMAGE_IN) return `«${f.name}» بزرگ‌تر از ${fileSize(MAX_IMAGE_IN)} است.`;
  } else return `«${f.name}» پذیرفته نیست؛ فقط عکس (PNG، JPEG، WebP) و PDF.`;
  return null;
}

/** The files together are too large to send (after scaling). */
export function overTotal(files: { size: number }[]): boolean {
  return files.reduce((a, f) => a + f.size, 0) > MAX_TOTAL;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** An image scaled so its longest side is at most MAX_SIDE (JPEG), or the original when it is already small. */
async function scaled(file: File): Promise<{ blob: Blob; mime: string }> {
  if (file.type === "image/gif" || (file.size < 600 * 1024 && typeof createImageBitmap !== "function")) return { blob: file, mime: file.type };
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 900 * 1024) {
      bmp.close();
      return { blob: file, mime: file.type };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const g = canvas.getContext("2d");
    if (!g) return { blob: file, mime: file.type };
    g.fillStyle = "#fff"; // transparent PNGs become white paper, not black
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    return blob && blob.size < file.size ? { blob, mime: "image/jpeg" } : { blob: file, mime: file.type };
  } catch {
    return { blob: file, mime: file.type };
  }
}

let seq = 0;

/** Reads a file into what the question carries. */
export async function readFile(file: File): Promise<PendingFile> {
  const { blob, mime } = IMAGE.test(file.type) ? await scaled(file) : { blob: file as Blob, mime: file.type };
  const data = toBase64(await blob.arrayBuffer());
  const name = mime === "image/jpeg" && file.type !== "image/jpeg" ? file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg" : file.name;
  return { key: `f${Date.now().toString(36)}${(seq++).toString(36)}`, name: name || "file", mime, size: blob.size, data, preview: mime.startsWith("image/") ? URL.createObjectURL(blob) : null };
}

export const toInput = (f: PendingFile): AiAttachmentInput => ({ name: f.name, mime: f.mime, data: f.data });

export function release(files: PendingFile[]) {
  for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
}
