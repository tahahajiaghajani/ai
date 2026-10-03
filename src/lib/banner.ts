import "server-only";
import { db } from "@/lib/supabase/admin";

export type BannerTone = "brand" | "gold" | "success" | "warning";

/** The owner's message shown at the top of the app to every user (app_settings, key "banner"). */
export interface Banner {
  text: string;
  link: string | null;
  tone: BannerTone;
  active: boolean;
  updated_at: string;
}

export const BANNER_TONES: BannerTone[] = ["brand", "gold", "success", "warning"];

let memo: { at: number; value: Banner | null } | null = null;

export async function getBanner(fresh = false): Promise<Banner | null> {
  if (!fresh && memo && Date.now() - memo.at < 15_000) return memo.value;
  const { data } = await db().from("app_settings").select("value").eq("key", "banner").maybeSingle();
  const v = (data?.value ?? null) as Partial<Banner> | null;
  const value: Banner | null = v?.text
    ? {
        text: String(v.text),
        link: v.link ? String(v.link) : null,
        tone: BANNER_TONES.includes(v.tone as BannerTone) ? (v.tone as BannerTone) : "brand",
        active: v.active !== false,
        updated_at: String(v.updated_at ?? ""),
      }
    : null;
  memo = { at: Date.now(), value };
  return value;
}

/** What the shell shows: nothing when there is no active message. */
export async function activeBanner(): Promise<Banner | null> {
  const b = await getBanner();
  return b?.active ? b : null;
}

export async function saveBanner(input: { text: string; link?: string | null; tone?: BannerTone; active: boolean }): Promise<Banner> {
  const text = input.text.trim().slice(0, 280);
  if (input.active && !text) throw new Error("متن اطلاعیه را بنویسید");
  let link = input.link?.trim() || null;
  if (link && !/^(https?:\/\/|\/)/.test(link)) throw new Error("لینک باید با https:// یا / شروع شود");
  if (link) link = link.slice(0, 500);
  const value: Banner = {
    text,
    link,
    tone: BANNER_TONES.includes(input.tone as BannerTone) ? (input.tone as BannerTone) : "brand",
    active: input.active && !!text,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("app_settings").upsert({ key: "banner", value, updated_at: value.updated_at });
  if (error) throw new Error(`ذخیره‌ی اطلاعیه: ${error.message}`);
  memo = { at: Date.now(), value };
  return value;
}
