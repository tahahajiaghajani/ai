import "server-only";
import type { Part } from "@google/genai";
import { db } from "@/lib/supabase/admin";
import { genai } from "@/lib/ai/gemini";
import { DeadlineError } from "@/lib/errors";
import { sleep } from "@/lib/utils";
import type { TaskFile } from "@/lib/types";

export interface FileRef {
  id: string;
  name: string;
  mime: string;
  uri?: string;
  text?: string;
  note?: string;
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|yaml|yml|sql|js|jsx|ts|tsx|py|java|cs|go|rb|php|html|htm|css|scss|sh|ps1|ini|env|log|conf|toml|kt|swift|c|cpp|h|hpp|rs|vue|svelte)$/i;
const GEMINI_NATIVE = /^(application\/pdf|image\/(png|jpeg|jpg|webp|heic|heif)|audio\/.+|video\/.+)$/i;
const MAX_INLINE_CHARS = 300_000;

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
    mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4",
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
  };
  return map[ext] ?? (TEXT_EXT.test(name) ? "text/plain" : "application/octet-stream");
}

/**
 * Make task attachments readable by Gemini: native types go through the Files API (cached 47h),
 * text/code is inlined, .docx is converted to text, everything else is described.
 */
export async function prepareFilesForGemini(files: TaskFile[], deadline: number, onFile?: (msg: string) => Promise<void>): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  for (const f of files) {
    if (deadline - Date.now() < 12_000) throw new DeadlineError();
    const mime = guessMime(f.name, f.mime);
    try {
      if (GEMINI_NATIVE.test(mime)) {
        if (f.gemini_uri && f.gemini_uri_expires_at && new Date(f.gemini_uri_expires_at).getTime() > Date.now() + 3600_000) {
          refs.push({ id: f.id, name: f.name, mime, uri: f.gemini_uri });
          continue;
        }
        const blob = await downloadStorage(f.storage_path);
        let uploaded = await genai().files.upload({ file: blob, config: { mimeType: mime, displayName: f.name } });
        for (let i = 0; i < 20 && uploaded.state === "PROCESSING" && uploaded.name; i++) {
          if (deadline - Date.now() < 10_000) break;
          await sleep(2_000);
          uploaded = await genai().files.get({ name: uploaded.name });
        }
        if (!uploaded.uri) throw new Error("آدرس فایل از Gemini دریافت نشد");
        await db()
          .from("task_files")
          .update({ gemini_uri: uploaded.uri, gemini_uri_expires_at: new Date(Date.now() + 47 * 3600_000).toISOString() })
          .eq("id", f.id);
        refs.push({ id: f.id, name: f.name, mime, uri: uploaded.uri });
        await onFile?.(`فایل «${f.name}» در Gemini بارگذاری شد`);
      } else if (mime.startsWith("text/") || TEXT_EXT.test(f.name) || mime === "application/json") {
        const text = await (await downloadStorage(f.storage_path)).text();
        refs.push({ id: f.id, name: f.name, mime, text: text.length > MAX_INLINE_CHARS ? `${text.slice(0, MAX_INLINE_CHARS)}\n…[ادامه‌ی فایل به دلیل حجم زیاد حذف شد]` : text });
        await onFile?.(`متن فایل «${f.name}» خوانده شد`);
      } else if (/\.docx$/i.test(f.name)) {
        const mammoth = await import("mammoth");
        const buf = Buffer.from(await (await downloadStorage(f.storage_path)).arrayBuffer());
        const { value } = await mammoth.extractRawText({ buffer: buf });
        refs.push({ id: f.id, name: f.name, mime, text: value.slice(0, MAX_INLINE_CHARS) });
        await onFile?.(`متن سند Word «${f.name}» استخراج شد`);
      } else {
        refs.push({ id: f.id, name: f.name, mime, note: "این نوع فایل برای Gemini قابل خواندن نیست ولی در GitHub برای Claude قرار می‌گیرد." });
      }
    } catch (err) {
      if (err instanceof DeadlineError) throw err;
      refs.push({ id: f.id, name: f.name, mime, note: `خطا در آماده‌سازی: ${(err as Error).message}` });
    }
  }
  return refs;
}

export function fileRefsToParts(refs: FileRef[]): Part[] {
  const parts: Part[] = [];
  for (const r of refs) {
    if (r.uri) {
      parts.push({ text: `\n[فایل پیوست: ${r.name}]` });
      parts.push({ fileData: { fileUri: r.uri, mimeType: r.mime } });
    } else if (r.text) {
      parts.push({ text: `\n--- شروع فایل پیوست: ${r.name} ---\n${r.text}\n--- پایان فایل ${r.name} ---` });
    } else if (r.note) {
      parts.push({ text: `\n[فایل پیوست: ${r.name} (${r.mime}) — ${r.note}]` });
    }
  }
  return parts;
}
