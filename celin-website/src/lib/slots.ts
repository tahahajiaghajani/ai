import "server-only";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { assertAdmin } from "@/lib/admin-auth";
import { db, isMissingTable, requireDb, UserError } from "@/lib/db";
import { loadMedia } from "@/lib/catalog";
import { SEED_MEDIA } from "@/content/seed-media";
import { SLOTS, slotDef } from "@/content/slots";

import type { ResolvedSlot, SlotMap } from "@/lib/slot-types";

export type { ResolvedSlot, SlotMap } from "@/lib/slot-types";
export { slotText } from "@/lib/slot-types";

interface SlotRow {
  key: string;
  media_id: string | null;
  media_mobile_id: string | null;
  texts: Record<string, { fa?: string; en?: string }> | null;
  updated_at: string;
}

function defaults(): SlotMap {
  const out: SlotMap = {};
  for (const s of SLOTS) {
    out[s.key] = { key: s.key, media: SEED_MEDIA[s.image], mobile: null, texts: Object.fromEntries(s.texts.map((t) => [t.key, { fa: t.fa, en: t.en }])), custom: false };
  }
  return out;
}

async function loadSlots(): Promise<SlotMap> {
  const base = defaults();
  const c = db();
  if (!c) return base;
  const { data, error } = await c.from("celin_slots").select("key, media_id, media_mobile_id, texts, updated_at");
  if (error) {
    if (isMissingTable(error)) return base;
    throw new Error(error.message);
  }
  const rows = (data ?? []) as SlotRow[];
  const media = await loadMedia(rows.flatMap((r) => [r.media_id ?? "", r.media_mobile_id ?? ""]));
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
      texts,
      custom: true,
    };
  }
  return base;
}

const cachedSlots = unstable_cache(loadSlots, ["celin-slots-v2"], { tags: ["slots"], revalidate: 900 });

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

/** Saves one slot: its picture (and phone picture) and texts. `media_id: null` restores the default picture. */
export async function saveSlot(key: string, input: { media_id?: unknown; media_mobile_id?: unknown; texts?: unknown }): Promise<void> {
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
  const { error } = await c.from("celin_slots").upsert({
    key,
    media_id: id(input.media_id),
    media_mobile_id: def.mobile ? id(input.media_mobile_id) : null,
    texts,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  revalidateTag("slots", { expire: 0 });
  revalidatePath("/", "layout");
}

/** Back to the built-in picture and texts. */
export async function resetSlot(key: string): Promise<void> {
  await assertAdmin();
  const { error } = await requireDb().from("celin_slots").delete().eq("key", key);
  if (error) throw new Error(error.message);
  revalidateTag("slots", { expire: 0 });
  revalidatePath("/", "layout");
}
