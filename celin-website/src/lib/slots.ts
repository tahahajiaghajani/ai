import "server-only";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { db, isMissingTable, requireDb, UserError } from "@/lib/db";
import { loadMedia, storageBase } from "@/lib/catalog";
import { removeVideoIfUnused } from "@/lib/admin-video";
import { num } from "@/lib/format";
import type { Media } from "@/lib/media";
import { rowToVideo, VIDEO_COLUMNS, type Video, type VideoRow } from "@/lib/video";
import { SEED_MEDIA, type SeedKey } from "@/content/seed-media";
import { SLOTS, slotDef, type SlotDef } from "@/content/slots";

import { resolveGallery, type ResolvedSlot, type SlotMap } from "@/lib/slot-types";

export type { ResolvedSlot, SlotMap } from "@/lib/slot-types";
export { slotText } from "@/lib/slot-types";

interface SlotRow {
  key: string;
  media_id: string | null;
  media_mobile_id: string | null;
  /** absent before the video migration (20261023180000_celin_slot_video.sql) has run */
  video_id?: string | null;
  /** gallery slots: ordered celin_media ids, null = never set (absent before 20261128100000_celin_round_six.sql) */
  gallery?: string[] | null;
  texts: Record<string, { fa?: string; en?: string }> | null;
  updated_at: string;
}

/** PostgREST: a selected column does not exist (an older database without the video or gallery migration). */
const missingColumn = (error: { code?: string } | null | undefined) => error?.code === "42703" || error?.code === "PGRST204";

/** the columns read, newest first: an older database lacks the gallery column, an older one still the video column */
const SLOT_SELECTS: string[] = ["key, media_id, media_mobile_id, video_id, gallery, texts, updated_at", "key, media_id, media_mobile_id, video_id, texts, updated_at", "key, media_id, media_mobile_id, texts, updated_at"];

const GALLERY_MISSING = "ستون تصاویر سرآغاز در پایگاه داده نیست؛ SQL تازه را از «اتصالات» در Supabase اجرا کنید.";

async function loadVideos(ids: string[]): Promise<Map<string, Video>> {
  const out = new Map<string, Video>();
  const c = db();
  const all = [...new Set(ids.filter(Boolean))];
  if (!c || !all.length) return out;
  const { data, error } = await c.from("celin_videos").select(VIDEO_COLUMNS).in("id", all);
  if (error) {
    if (isMissingTable(error)) return out;
    throw new Error(error.message);
  }
  for (const r of (data ?? []) as VideoRow[]) {
    const v = rowToVideo(r, storageBase());
    if (v) out.set(r.id, v);
  }
  return out;
}

/**
 * Gallery slots get their pictures once every row is applied: the stored list, else the fallback slots' pictures
 * (which may themselves be changed ones); the slot's picture is the list's first.
 */
function resolveGalleries(base: SlotMap, stored: Map<string, Media[]>) {
  for (const def of SLOTS) {
    if (!def.gallery) continue;
    const fallback = def.gallery.fallback.map((k) => base[k]?.media).filter((m): m is Media => Boolean(m));
    const list = resolveGallery(stored.get(def.key) ?? [], fallback, def.gallery.min);
    base[def.key] = { ...base[def.key], media: list[0] ?? base[def.key].media, gallery: list };
  }
}

function defaults(): SlotMap {
  const out: SlotMap = {};
  for (const s of SLOTS) {
    out[s.key] = { key: s.key, media: SEED_MEDIA[s.image], mobile: null, video: null, texts: Object.fromEntries(s.texts.map((t) => [t.key, { fa: t.fa, en: t.en }])), custom: false };
  }
  resolveGalleries(out, new Map());
  return out;
}

async function loadSlots(): Promise<SlotMap> {
  const base = defaults();
  const c = db();
  if (!c) return base;
  let res = await c.from("celin_slots").select(SLOT_SELECTS[0]);
  for (const cols of SLOT_SELECTS.slice(1)) {
    if (!missingColumn(res.error)) break;
    res = await c.from("celin_slots").select(cols);
  }
  const { data, error } = res;
  if (error) {
    if (isMissingTable(error)) return base;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as unknown as SlotRow[];
  const galleryOf = (r: SlotRow) => (slotDef(r.key)?.gallery && Array.isArray(r.gallery) ? r.gallery : []);
  const [media, videos] = await Promise.all([
    loadMedia(rows.flatMap((r) => [r.media_id ?? "", r.media_mobile_id ?? "", ...galleryOf(r)])),
    loadVideos(rows.filter((r) => slotDef(r.key)?.video).map((r) => r.video_id ?? "")),
  ]);
  const stored = new Map<string, Media[]>();
  for (const r of rows) {
    const cur = base[r.key];
    if (!cur) continue;
    const texts = { ...cur.texts };
    for (const [k, v] of Object.entries(r.texts ?? {})) {
      if (!(k in texts)) continue;
      texts[k] = { fa: typeof v?.fa === "string" ? v.fa : texts[k].fa, en: typeof v?.en === "string" ? v.en : texts[k].en };
    }
    base[r.key] = {
      key: r.key,
      media: (r.media_id && media.get(r.media_id)) || cur.media,
      mobile: (r.media_mobile_id && media.get(r.media_mobile_id)) || null,
      video: (slotDef(r.key)?.video && r.video_id && videos.get(r.video_id)) || null,
      texts,
      custom: true,
    };
    const list = galleryOf(r).flatMap((id) => media.get(id) ?? []);
    if (list.length) stored.set(r.key, list);
  }
  resolveGalleries(base, stored);
  return base;
}

// admin changes invalidate the tag at once; the timer is only a safety net for edits made in SQL
const cachedSlots = unstable_cache(loadSlots, ["celin-slots-v8"], { tags: ["slots"], revalidate: 3600 });

/** All design pictures with their texts; a failed read falls back to the built-in defaults (never cached). */
export async function getSlots(): Promise<SlotMap> {
  try {
    // slots added in a newer release may be missing from an older cached copy
    return { ...defaults(), ...(await cachedSlots()) };
  } catch (e) {
    console.error("[slots]", e);
    return defaults();
  }
}

/** Uncached, for the admin page. */
export async function getSlotsFresh(): Promise<SlotMap> {
  await assertAdmin();
  return loadSlots();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The slot's current video (null when none, or before the video migration). */
async function currentVideo(key: string): Promise<string | null> {
  const { data, error } = await requireDb().from("celin_slots").select("video_id").eq("key", key).maybeSingle();
  if (error) {
    if (missingColumn(error) || isMissingTable(error)) return null;
    throw new Error(error.message);
  }
  return (data as { video_id?: string | null } | null)?.video_id ?? null;
}

/** A replaced or removed video is deleted once nothing uses it (there is no video library to pick it again). */
async function dropVideo(id: string | null) {
  if (!id) return;
  await removeVideoIfUnused(id).catch((e) => console.error("[slots] video cleanup", e));
}

type GalleryEntry = { id: string } | { seed: SeedKey };

/**
 * A gallery list as the panel sends it — library ids, and `seed:<key>` for a built-in picture that was never copied
 * into the library — checked against the slot's limits: entries that are neither are dropped, repeats too.
 */
export function cleanGallery(raw: unknown, def: Pick<SlotDef, "gallery">): GalleryEntry[] {
  const g = def.gallery;
  if (!g) return [];
  if (!Array.isArray(raw)) throw new UserError("فهرست تصاویر درست فرستاده نشد؛ صفحه را دوباره باز کنید.");
  const out: GalleryEntry[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string" || seen.has(v)) continue;
    if (UUID.test(v)) out.push({ id: v.toLowerCase() });
    else if (v.startsWith("seed:") && Object.prototype.hasOwnProperty.call(SEED_MEDIA, v.slice(5))) out.push({ seed: v.slice(5) as SeedKey });
    else continue;
    seen.add(v);
  }
  if (out.length < g.min) throw new UserError(`حداقل ${num(g.min, "fa")} تصویر لازم است.`);
  if (out.length > g.max) throw new UserError(`حداکثر ${num(g.max, "fa")} تصویر می‌توان گذاشت.`);
  return out;
}

/** The checked list as library ids, in order (a built-in picture gets its library row here, once). */
async function galleryIds(entries: GalleryEntry[]): Promise<string[]> {
  // (loaded here only: the public pages read slots too and never need the catalogue admin)
  const { seedMediaId } = await import("@/lib/admin-catalog");
  const ids: string[] = [];
  for (const e of entries) {
    const id = "id" in e ? e.id : await seedMediaId(e.seed);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Saves one slot: its picture (and phone picture), video (video slots only) and texts. `media_id: null`
 * restores the default picture; `video_id: null` removes the video. A gallery slot takes `gallery` (its ordered
 * list) instead of `media_id`; its first picture becomes the slot's picture.
 */
export async function saveSlot(key: string, input: { media_id?: unknown; media_mobile_id?: unknown; video_id?: unknown; gallery?: unknown; texts?: unknown }): Promise<void> {
  await assertAdmin();
  const def = slotDef(key);
  if (!def) throw new UserError("این بخش وجود ندارد.");
  const c = requireDb();
  const texts: Record<string, { fa: string; en: string }> = {};
  const raw = (input.texts ?? {}) as Record<string, { fa?: unknown; en?: unknown }>;
  for (const t of def.texts) {
    const v = raw[t.key];
    if (!v) continue;
    texts[t.key] = { fa: String(v.fa ?? "").trim().slice(0, 600), en: String(v.en ?? "").trim().slice(0, 600) };
  }
  const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
  const row: Record<string, unknown> = {
    key,
    media_id: id(input.media_id),
    media_mobile_id: def.mobile ? id(input.media_mobile_id) : null,
    texts,
    updated_at: new Date().toISOString(),
  };
  const withGallery = Boolean(def.gallery) && "gallery" in input;
  if (withGallery) {
    const ids = await galleryIds(cleanGallery(input.gallery, def));
    row.gallery = ids;
    row.media_id = ids[0];
  }
  const withVideo = Boolean(def.video) && "video_id" in input;
  const before = withVideo ? await currentVideo(key) : null;
  if (withVideo) row.video_id = id(input.video_id);
  const galleryMissing = (e: { code?: string; message?: string } | null) => withGallery && missingColumn(e) && /gallery/.test(e?.message ?? "");
  let { error } = await c.from("celin_slots").upsert(row);
  if (galleryMissing(error)) throw new UserError(GALLERY_MISSING);
  if (error && missingColumn(error) && !row.video_id) {
    // a database without the video migration: save the rest
    delete row.video_id;
    ({ error } = await c.from("celin_slots").upsert(row));
  }
  if (error) {
    if (galleryMissing(error)) throw new UserError(GALLERY_MISSING);
    if (missingColumn(error)) throw new UserError("ستون ویدئو در پایگاه داده نیست؛ SQL تازه را از «اتصالات» در Supabase اجرا کنید.");
    throw new Error(error.message);
  }
  // the former pictures a gallery falls back on are part of its list now: their rows go (nothing else shows them)
  if (withGallery) await dropFallbackRows(def);
  if (withVideo && before !== row.video_id) await dropVideo(before);
  revalidateTag("slots", { expire: 0 });
  revalidatePath("/", "layout");
}

/** Rows of the slots a gallery falls back on (legacy slots: once a list exists, nothing shows them). */
async function dropFallbackRows(def: SlotDef) {
  const keys = (def.gallery?.fallback ?? []).filter((k) => k !== def.key);
  if (!keys.length) return;
  const { error } = await requireDb().from("celin_slots").delete().in("key", keys);
  if (error) throw new Error(error.message);
}

/** Back to the built-in picture and texts (a video of the slot is removed; a gallery goes back to its built-in pictures). */
export async function resetSlot(key: string): Promise<void> {
  await assertAdmin();
  const def = slotDef(key);
  const video = def?.video ? await currentVideo(key) : null;
  const { error } = await requireDb().from("celin_slots").delete().eq("key", key);
  if (error) throw new Error(error.message);
  if (def?.gallery) await dropFallbackRows(def);
  await dropVideo(video);
  revalidateTag("slots", { expire: 0 });
  revalidatePath("/", "layout");
}
