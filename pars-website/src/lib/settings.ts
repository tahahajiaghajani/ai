import "server-only";
import { unstable_cache, revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { DEFAULT_SETTINGS, type Settings, type SettingsKey } from "@/lib/settings-types";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merges stored values over defaults so new fields always have a value. */
export function mergeDeep<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over === undefined || over === null ? base : (over as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = isObject(b) && isObject(v) ? mergeDeep(b, v) : v === undefined || v === null ? b : v;
  }
  return out as T;
}

/** PostgREST "table not found" (PGRST205, or 42P01 on older versions): the migration has not run yet, so nothing is stored. */
function isMissingTable(error: { code?: string }): boolean {
  return error.code === "PGRST205" || error.code === "42P01";
}

/** Stored values merged over defaults. Throws on a read error, so a failure is never cached or saved back. */
async function loadSettings(): Promise<Settings> {
  const c = db();
  if (!c) return DEFAULT_SETTINGS;
  const { data, error } = await c.from("pars_settings").select("key, value");
  if (error && !isMissingTable(error)) throw new Error(`تنظیمات از پایگاه داده خوانده نشد (${error.message})`);
  let s: Settings = DEFAULT_SETTINGS;
  for (const row of (data ?? []) as { key: SettingsKey; value: unknown }[]) {
    if (row.key in DEFAULT_SETTINGS) s = { ...s, [row.key]: mergeDeep(DEFAULT_SETTINGS[row.key], row.value) };
  }
  return s;
}

const cachedSettings = unstable_cache(loadSettings, ["pars-settings-v1"], { tags: ["settings"], revalidate: 300 });

/**
 * Cached for 5 minutes; saving in the admin panel invalidates it immediately. A failed read is never
 * cached: a stale entry keeps being served, and with no entry this call alone falls back to the defaults.
 */
export async function getSettings(): Promise<Settings> {
  try {
    return await cachedSettings();
  } catch (e) {
    console.error("[settings]", e);
    return DEFAULT_SETTINGS;
  }
}

/** Uncached, strict read for the admin panel: throws on a read error, so saveAi/saveNotify never write defaults over stored keys. */
export const getSettingsFresh = loadSettings;

export async function saveSettings<K extends SettingsKey>(key: K, value: Settings[K]): Promise<void> {
  const c = db();
  if (!c) throw new Error("db_missing");
  const { error } = await c.from("pars_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  revalidateTag("settings", { expire: 0 });
  revalidatePath("/", "layout");
}
