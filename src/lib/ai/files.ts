import "server-only";
import { db } from "@/lib/supabase/admin";
import { DeadlineError } from "@/lib/errors";
import type { Block } from "@/lib/ai/llm/types";

export interface InputFile {
  id: string;
  name: string;
  storage_path: string;
  mime: string | null;
  size: number | null;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|sql|js|jsx|ts|tsx|py|java|cs|go|rb|php|html|htm|css|scss|sh|ps1|ini|env|log|conf|toml|kt|swift|c|cpp|h|hpp|rs|vue|svelte|xaml|razor|cshtml|config|svg)$/i;
const NATIVE = /^(application\/pdf|image\/(png|jpeg|jpg|webp|gif))$/i;
/** Text taken from one file (whole files; only absurdly large ones are cut, and that is stated). */
const MAX_TEXT = 400_000;
/** Binary files sent inline to the model (larger ones are described instead). */
const MAX_INLINE = 15 * 1024 * 1024;

export async function downloadStorage(path: string): Promise<Blob> {
  const { data, error } = await db().storage.from("task-files").download(path);
  if (error || !data) throw new Error(`دانلود فایل ${path} ناموفق بود: ${error?.message ?? ""}`);
  return data;
}

export function guessMime(name: string, mime: string | null): string {
  if (mime && mime !== "application/octet-stream") return mime;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
    zip: "application/zip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    html: "text/html",
    htm: "text/html",
    md: "text/markdown",
    json: "application/json",
    css: "text/css",
    js: "text/javascript",
    csv: "text/csv",
    txt: "text/plain",
    svg: "image/svg+xml",
  };
  return map[ext] ?? (TEXT_EXT.test(name) ? "text/plain" : "application/octet-stream");
}

function textBlock(name: string, text: string): Block {
  const body = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[ادامه‌ی این فایل بسیار بزرگ ارسال نشد؛ ${text.length} کاراکتر]` : text;
  return { type: "text", text: `\n--- شروع فایل پیوست: ${name} ---\n${body}\n--- پایان فایل ${name} ---` };
}

async function pdfText(buf: Uint8Array): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(buf);
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  } catch {
    return "";
  }
}

/**
 * Turns attachments into model input: text and code inline (whole), Word documents as text, PDFs and
 * images as files (with extracted text as the fallback for models that cannot read them).
 */
export async function inputBlocks(files: InputFile[], deadline: number, onFile?: (msg: string) => Promise<void>): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const f of files) {
    if (deadline - Date.now() < 12_000) throw new DeadlineError();
    const mime = guessMime(f.name, f.mime);
    try {
      if ((f.size ?? 0) > 60 * 1024 * 1024) {
        blocks.push({ type: "text", text: `\n[فایل پیوست ${f.name}: بزرگ‌تر از آن است که به مدل داده شود]` });
        continue;
      }
      const blob = await downloadStorage(f.storage_path);
      if (mime.startsWith("text/") || TEXT_EXT.test(f.name) || mime === "application/json") {
        blocks.push(textBlock(f.name, await blob.text()));
      } else if (/\.docx$/i.test(f.name)) {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await blob.arrayBuffer()) });
        blocks.push(textBlock(f.name, value));
      } else if (NATIVE.test(mime) && blob.size <= MAX_INLINE) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const extracted = mime === "application/pdf" ? await pdfText(buf) : "";
        const fallback =
          mime === "application/pdf"
            ? extracted.trim()
              ? (textBlock(f.name, extracted) as { text: string }).text
              : `\n[PDF پیوست ${f.name}: متنی قابل استخراج نداشت]`
            : `\n[تصویر پیوست ${f.name} — این مدل تصویر نمی‌خواند]`;
        blocks.push({ type: "file", name: f.name, mime, data: Buffer.from(buf).toString("base64"), fallback });
      } else {
        blocks.push({ type: "text", text: `\n[فایل پیوست ${f.name} (${mime}) — قالب آن برای مدل قابل خواندن نیست]` });
      }
      await onFile?.(`فایل «${f.name}» آماده شد`);
    } catch (err) {
      if (err instanceof DeadlineError) throw err;
      blocks.push({ type: "text", text: `\n[فایل پیوست ${f.name}: خطا در آماده‌سازی — ${(err as Error).message}]` });
    }
  }
  return blocks;
}
