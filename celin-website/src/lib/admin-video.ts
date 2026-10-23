import "server-only";
import { randomUUID } from "node:crypto";
import { assertAdmin } from "@/lib/admin-auth";
import { isMissingTable, requireDb, UserError } from "@/lib/db";
import { env } from "@/lib/env";
import { storageBase } from "@/lib/catalog";
import { parseContentRange } from "@/lib/http-range";
import { checkVideoFile, extOfMime, rowToVideo, sniffVideo, SNIFF_BYTES, VIDEO_COLUMNS, VIDEO_MAX_BYTES, VIDEO_MIME, VIDEO_PATH, videoMimeOf, type Video, type VideoExt, type VideoRow } from "@/lib/video";

/**
 * Slot videos. A video is too large for a Vercel function body (~4.5 MB), so the admin's browser uploads it
 * straight into the public bucket with a one-time signed upload URL made here (after checking type and size);
 * then `finishVideoUpload` reads the first bytes of the stored object back (a ranged download), checks its
 * real size and kind and records it in celin_videos. Nothing is processed on the server.
 */

const SQL_HINT = "جدول ویدئوها ساخته نشده است؛ در «اتصالات» SQL تازه را کپی کنید و در Supabase اجرا کنید.";

async function videosReady(): Promise<void> {
  const c = requireDb();
  const { error } = await c.from("celin_videos").select("id", { head: true, count: "exact" }).limit(1);
  if (error) {
    if (isMissingTable(error)) throw new UserError(SQL_HINT);
    throw new Error(error.message);
  }
  const { data: bucket, error: be } = await c.storage.getBucket(env.bucket);
  if (be || !bucket) {
    if (/not found/i.test(be?.message ?? "")) throw new UserError(`فضای ذخیره («${env.bucket}») ساخته نشده است؛ SQL را در Supabase اجرا کنید.`);
    throw new Error(be?.message ?? "bucket");
  }
  const types = bucket.allowed_mime_types;
  const limit = Number(bucket.file_size_limit ?? 0);
  if ((types && types.length && !types.includes("video/mp4")) || (limit > 0 && limit < VIDEO_MAX_BYTES)) throw new UserError("فضای ذخیره هنوز ویدئو نمی‌پذیرد؛ SQL تازه را از «اتصالات» در Supabase اجرا کنید.");
}

/** Step 1: checks the file the admin picked and returns a one-time upload URL for a fresh object path. */
export async function createVideoUpload(input: { type?: unknown; name?: unknown; size?: unknown }): Promise<{ path: string; url: string }> {
  await assertAdmin();
  const file = { type: String(input.type ?? ""), name: String(input.name ?? "").slice(0, 200), size: Number(input.size) };
  const problem = checkVideoFile(file);
  if (problem) throw new UserError(problem);
  await videosReady();
  const ext = extOfMime(videoMimeOf(file)!)!;
  const path = `v/${randomUUID()}.${ext}`;
  const { data, error } = await requireDb().storage.from(env.bucket).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "signed upload url");
  return { path, url: data.signedUrl };
}

/** The first bytes and the real size of a stored object (one ranged request; null when it is not there). */
async function readHead(path: string): Promise<{ bytes: Uint8Array; size: number } | null> {
  const key = env.supabaseKey;
  const res = await fetch(`${env.supabaseUrl}/storage/v1/object/authenticated/${env.bucket}/${path}`, {
    headers: { authorization: `Bearer ${key}`, apikey: key, range: `bytes=0-${SNIFF_BYTES - 1}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok || !res.body) throw new Error(`storage ${res.status}`);
  let size = NaN;
  if (res.status === 206) size = parseContentRange(res.headers.get("content-range"))?.size ?? NaN;
  else size = Number(res.headers.get("content-length") ?? NaN);
  // read at most SNIFF_BYTES, even when the store ignored the range
  const reader = res.body.getReader();
  const out = new Uint8Array(SNIFF_BYTES);
  let n = 0;
  while (n < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const take = Math.min(value.byteLength, SNIFF_BYTES - n);
    out.set(value.subarray(0, take), n);
    n += take;
  }
  await reader.cancel().catch(() => undefined);
  return { bytes: out.subarray(0, n), size };
}

const clampInt = (v: unknown, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};

/** Step 2: after the browser's upload — verifies the stored object and records it. */
export async function finishVideoUpload(input: { path?: unknown; width?: unknown; height?: unknown; duration?: unknown }): Promise<Video> {
  await assertAdmin();
  const path = String(input.path ?? "");
  const m = VIDEO_PATH.exec(path);
  if (!m) throw new UserError("نشانی فایل ویدئو معتبر نیست.");
  const ext = m[1] as VideoExt;
  const c = requireDb();
  const head = await readHead(path);
  if (!head) throw new UserError("فایل ویدئو در فضای ذخیره پیدا نشد؛ دوباره بارگذاری کنید.");
  try {
    if (!(head.size > 0)) throw new UserError("اندازه‌ی فایل ویدئو خوانده نشد؛ دوباره بارگذاری کنید.");
    if (head.size > VIDEO_MAX_BYTES) throw new UserError("حجم ویدئو بیشتر از ۲۵ مگابایت است.");
    if (sniffVideo(head.bytes) !== ext) throw new UserError(ext === "mp4" ? "این فایل ویدئوی MP4 معتبر نیست." : "این فایل ویدئوی WebM معتبر نیست.");
    const row = {
      path,
      mime: VIDEO_MIME[ext],
      bytes: head.size,
      width: clampInt(input.width, 8192),
      height: clampInt(input.height, 8192),
      duration: Math.max(0, Math.min(3600, Number(input.duration) || 0)),
    };
    const { data, error } = await c.from("celin_videos").insert(row).select(VIDEO_COLUMNS).single();
    if (error) {
      if (isMissingTable(error)) throw new UserError(SQL_HINT);
      throw new Error(error.message);
    }
    const video = rowToVideo(data as VideoRow, storageBase());
    if (!video) throw new Error("video row");
    return video;
  } catch (e) {
    await c.storage.from(env.bucket).remove([path]).catch(() => undefined);
    throw e;
  }
}

/** Deletes a video (row and file) once no slot uses it any more. */
export async function removeVideoIfUnused(id: string): Promise<boolean> {
  await assertAdmin();
  const c = requireDb();
  const { count, error } = await c.from("celin_slots").select("key", { head: true, count: "exact" }).eq("video_id", id);
  if (error) throw new Error(error.message);
  if (count) return false;
  const { data, error: re } = await c.from("celin_videos").select("path").eq("id", id).maybeSingle();
  if (re) throw new Error(re.message);
  if (!data) return false;
  const { error: de } = await c.from("celin_videos").delete().eq("id", id);
  if (de) throw new Error(de.message);
  await c.storage.from(env.bucket).remove([(data as { path: string }).path]);
  return true;
}

const DAY = 86400_000;

/**
 * Housekeeping after an upload: videos uploaded more than a day ago that no slot uses (the sheet was closed
 * without saving), and files left in v/ without a row (an upload that never finished). Best effort.
 */
export async function pruneVideos(): Promise<number> {
  await assertAdmin();
  const c = requireDb();
  const before = new Date(Date.now() - DAY).toISOString();
  const [{ data: rows, error }, { data: used, error: ue }] = await Promise.all([
    c.from("celin_videos").select("id, path, created_at").limit(1000),
    c.from("celin_slots").select("video_id").not("video_id", "is", null),
  ]);
  if (error || ue) throw new Error((error ?? ue)!.message);
  const inUse = new Set(((used ?? []) as { video_id: string }[]).map((r) => r.video_id));
  const all = (rows ?? []) as { id: string; path: string; created_at: string }[];
  const stale = all.filter((r) => !inUse.has(r.id) && r.created_at < before);
  const known = new Set(all.map((r) => r.path));
  const { data: files } = await c.storage.from(env.bucket).list("v", { limit: 1000 });
  const strays = (files ?? []).filter((f) => f.name && !known.has(`v/${f.name}`) && (f.created_at ?? "") < before).map((f) => `v/${f.name}`);
  if (stale.length) {
    const { error: de } = await c.from("celin_videos").delete().in("id", stale.map((r) => r.id));
    if (de) throw new Error(de.message);
  }
  const paths = [...stale.map((r) => r.path), ...strays];
  if (paths.length) await c.storage.from(env.bucket).remove(paths);
  return paths.length;
}
