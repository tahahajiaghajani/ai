import "server-only";
import { db } from "@/lib/supabase/admin";

const BUCKET = "avatars";
const MAX_BYTES = 1_500_000;
const DATA_URL = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/;

export const AVATAR_SQL_HINT = "برای فعال شدن تصویر پروفایل، فایل supabase/migrations/20260926000000_avatars.sql را یک بار در SQL Editor سوپابیس اجرا کنید.";

function missingColumn(err: { code?: string; message?: string } | null) {
  return !!err && (err.code === "42703" || err.code === "PGRST204" || /avatar_url/.test(err.message ?? ""));
}

/** Storage path of an avatar from its public URL (…/object/public/avatars/<path>). */
function pathFromUrl(url: string | null | undefined) {
  const m = url?.match(/\/object\/public\/avatars\/(.+)$/);
  return m ? decodeURIComponent(m[1].split("?")[0]) : null;
}

async function currentAvatar(userId: string): Promise<string | null> {
  const { data, error } = await db().from("profiles").select("avatar_url").eq("id", userId).maybeSingle<{ avatar_url: string | null }>();
  if (missingColumn(error)) throw new Error(AVATAR_SQL_HINT);
  return data?.avatar_url ?? null;
}

async function upload(path: string, body: Buffer, contentType: string) {
  const put = () => db().storage.from(BUCKET).upload(path, body, { contentType, upsert: true, cacheControl: "31536000" });
  let { error } = await put();
  if (error && /bucket not found/i.test(error.message)) {
    // The migration creates the bucket; create it here too so a partially applied setup still works.
    await db().storage.createBucket(BUCKET, { public: true, fileSizeLimit: 2 * 1024 * 1024, allowedMimeTypes: ["image/webp", "image/jpeg", "image/png"] });
    ({ error } = await put());
  }
  if (error) throw new Error(`بارگذاری تصویر ناموفق بود: ${error.message}`);
}

/**
 * Stores a (client-side resized) profile picture sent as a data URL and points the profile at it.
 * Every upload gets a new file name, so browsers never show a stale cached picture.
 */
export async function saveAvatar(userId: string, dataUrl: string): Promise<string> {
  const m = DATA_URL.exec(dataUrl.trim());
  if (!m) throw new Error("فرمت تصویر پشتیبانی نمی‌شود (فقط JPG، PNG یا WebP)");
  const body = Buffer.from(m[2], "base64");
  if (!body.length) throw new Error("تصویر خالی است");
  if (body.length > MAX_BYTES) throw new Error("حجم تصویر زیاد است");
  const previous = await currentAvatar(userId);
  const ext = m[1] === "image/jpeg" ? "jpg" : m[1].split("/")[1];
  const path = `${userId}/${Date.now()}.${ext}`;
  await upload(path, body, m[1]);
  const url = db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const { error } = await db().from("profiles").update({ avatar_url: url }).eq("id", userId);
  if (error) {
    await db().storage.from(BUCKET).remove([path]);
    throw new Error(missingColumn(error) ? AVATAR_SQL_HINT : `ذخیره‌ی تصویر ناموفق بود: ${error.message}`);
  }
  const old = pathFromUrl(previous);
  if (old && old !== path) await db().storage.from(BUCKET).remove([old]);
  return url;
}

export async function removeAvatar(userId: string) {
  const previous = await currentAvatar(userId);
  const { error } = await db().from("profiles").update({ avatar_url: null }).eq("id", userId);
  if (error) throw new Error(`حذف تصویر ناموفق بود: ${error.message}`);
  const old = pathFromUrl(previous);
  if (old) await db().storage.from(BUCKET).remove([old]);
}
