import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { isMissingTable, requireDb, UserError, db } from "@/lib/db";
import { env } from "@/lib/env";
import { storageBase } from "@/lib/catalog";
import { MEDIA_COLUMNS, rowToMedia, UPLOAD_WIDTHS, type Media, type MediaRow } from "@/lib/media";
import { slotDef } from "@/content/slots";

/**
 * The picture library. The browser resizes each picture into a few widths (WebP, or JPEG where the browser
 * cannot write WebP) and sends them in one request; the server checks every file and stores them in the
 * public bucket as m/<uuid>/<width>.<ext>. No server-side image processing, so uploads cost nothing extra.
 */

const MAX_FILE = 3 * 1024 * 1024;
const TYPES: Record<string, { ext: string; mime: string }> = {
  webp: { ext: "webp", mime: "image/webp" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
};

/** Magic bytes, so a renamed file of another kind is refused. */
export function sniff(buf: Uint8Array): "webp" | "jpg" | null {
  if (buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "webp";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return null;
}

export interface UploadInput {
  files: { width: number; data: Uint8Array }[];
  width: number;
  height: number;
  placeholder: string;
  alt_fa: string;
  alt_en: string;
  focal_x?: number;
  focal_y?: number;
}

export async function storeUpload(input: UploadInput): Promise<Media> {
  await assertAdmin();
  const c = requireDb();
  // the standard widths below the picture's own width, plus that width (an older open admin tab may still
  // send one width above 2048)
  if (!input.files.length || input.files.length > UPLOAD_WIDTHS.length + 1) throw new UserError("فایل تصویر دریافت نشد.");
  const kinds = new Set<string>();
  for (const f of input.files) {
    if (!UPLOAD_WIDTHS.includes(f.width) && f.width !== input.width) throw new UserError("اندازه‌ی تصویر معتبر نیست.");
    if (f.data.byteLength > MAX_FILE) throw new UserError("حجم تصویر زیاد است (حداکثر ۳ مگابایت برای هر اندازه).");
    const k = sniff(f.data);
    if (!k) throw new UserError("فقط تصویر WebP یا JPEG پذیرفته می‌شود.");
    kinds.add(k);
  }
  if (kinds.size !== 1) throw new UserError("همه‌ی اندازه‌های یک تصویر باید یک نوع باشند.");
  const ext = [...kinds][0];
  if (!(input.width > 0 && input.width <= 8000 && input.height > 0 && input.height <= 8000)) throw new UserError("ابعاد تصویر معتبر نیست.");
  const placeholder = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]{10,2000}$/.test(input.placeholder) ? input.placeholder : "";

  const folder = `m/${randomUUID()}`;
  const uploaded: string[] = [];
  try {
    for (const f of input.files) {
      const path = `${folder}/${f.width}.${ext}`;
      const { error } = await c.storage.from(env.bucket).upload(path, f.data, { contentType: TYPES[ext].mime, cacheControl: "31536000", upsert: false });
      if (error) {
        if (/bucket not found/i.test(error.message)) throw new UserError("فضای ذخیره‌ی تصاویر (bucket «celin-media») ساخته نشده است؛ فایل SQL را در Supabase اجرا کنید.");
        throw new Error(error.message);
      }
      uploaded.push(path);
    }
    const widths = [...new Set(input.files.map((f) => f.width))].sort((a, b) => a - b);
    const row = {
      path: folder,
      ext,
      widths,
      width: input.width,
      height: input.height,
      placeholder,
      focal_x: clampPct(input.focal_x),
      focal_y: clampPct(input.focal_y),
      alt_fa: input.alt_fa.slice(0, 300),
      alt_en: input.alt_en.slice(0, 300),
      bytes: input.files.reduce((s, f) => s + f.data.byteLength, 0),
    };
    const { data, error } = await c.from("celin_media").insert(row).select(MEDIA_COLUMNS).single();
    if (error) throw new Error(error.message);
    return rowToMedia(data as MediaRow, storageBase());
  } catch (e) {
    if (uploaded.length) await c.storage.from(env.bucket).remove(uploaded).catch(() => undefined);
    throw e;
  }
}

const clampPct = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 50;
};

export async function listLibrary(limit = 300): Promise<Media[] | null> {
  await assertAdmin();
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from("celin_media").select(MEDIA_COLUMNS).order("created_at", { ascending: false }).limit(limit);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  return ((data ?? []) as MediaRow[]).map((r) => rowToMedia(r, storageBase()));
}

export async function updateMedia(id: string, patch: { alt_fa?: unknown; alt_en?: unknown; focal_x?: unknown; focal_y?: unknown }): Promise<void> {
  await assertAdmin();
  const c = requireDb();
  const fields: Record<string, unknown> = {};
  if (typeof patch.alt_fa === "string") fields.alt_fa = patch.alt_fa.trim().slice(0, 300);
  if (typeof patch.alt_en === "string") fields.alt_en = patch.alt_en.trim().slice(0, 300);
  if (patch.focal_x !== undefined) fields.focal_x = clampPct(patch.focal_x);
  if (patch.focal_y !== undefined) fields.focal_y = clampPct(patch.focal_y);
  const { error } = await c.from("celin_media").update(fields).eq("id", id);
  if (error) throw new Error(error.message);
  revalidateTag("catalog", { expire: 0 });
  revalidateTag("slots", { expire: 0 });
  revalidatePath("/", "layout");
}

/** Where a picture is used (products, variants, categories, collections, slots). */
export async function mediaUsage(id: string): Promise<string[]> {
  await assertAdmin();
  const c = requireDb();
  const [p, v, cat, col, s1, s2] = await Promise.all([
    c.from("celin_products").select("name_fa").contains("images", [id]).limit(20),
    c.from("celin_variants").select("name_fa").eq("image_id", id).limit(20),
    c.from("celin_categories").select("name_fa").eq("media_id", id).limit(20),
    c.from("celin_collections").select("name_fa").eq("media_id", id).limit(20),
    c.from("celin_slots").select("key").eq("media_id", id).limit(20),
    c.from("celin_slots").select("key").eq("media_mobile_id", id).limit(20),
  ]);
  const names = (r: { data: unknown }, field: string, label: string) =>
    ((r.data ?? []) as Record<string, string>[]).map((x) => {
      // site pictures are stored by slot key; show the page and section the admin knows them by
      const def = field === "key" ? slotDef(x.key) : undefined;
      return `${label}: ${def ? `${def.page} — ${def.section}` : x[field]}`;
    });
  return [
    ...names(p, "name_fa", "محصول"),
    ...names(v, "name_fa", "گزینه‌ی محصول"),
    ...names(cat, "name_fa", "دسته"),
    ...names(col, "name_fa", "مجموعه"),
    ...names(s1, "key", "تصویر سایت"),
    ...names(s2, "key", "تصویر سایت (موبایل)"),
  ];
}

/** Deletes a picture that nothing uses any more (its stored files too; starter pictures stay on disk). */
export async function deleteMedia(id: string): Promise<void> {
  await assertAdmin();
  const c = requireDb();
  const used = await mediaUsage(id);
  if (used.length) throw new UserError(`این تصویر هنوز استفاده می‌شود: ${used.slice(0, 4).join("، ")}`);
  const { data, error } = await c.from("celin_media").select("path, ext, widths").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const r = data as { path: string; ext: string; widths: number[] };
  if (!r.path.startsWith("/")) await c.storage.from(env.bucket).remove(r.widths.map((w) => `${r.path}/${w}.${r.ext}`));
  const { error: de } = await c.from("celin_media").delete().eq("id", id);
  if (de) throw new Error(de.message);
}
