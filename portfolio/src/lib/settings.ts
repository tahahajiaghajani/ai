import "server-only";
import { unstable_cache } from "next/cache";
import { env } from "@/lib/env";
import { getFile, ghConfigured, GhError, putFile } from "@/lib/github";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "@/lib/settings-types";

export const SETTINGS_FILE = "settings.json";

/** Reads settings.json straight from the repository. Throws when GitHub is not configured or not reachable. */
export async function loadSettings(): Promise<{ settings: Settings; sha: string | null }> {
  if (!ghConfigured()) throw new GhError("not configured", 0);
  const f = await getFile(SETTINGS_FILE);
  if (!f) return { settings: DEFAULT_SETTINGS, sha: null };
  let raw: unknown = null;
  try {
    raw = JSON.parse(f.text);
  } catch {
    raw = null;
  }
  return { settings: parseSettings(raw), sha: f.sha };
}

// the repository is an argument so a different GITHUB_REPO never reads another repository's cached settings;
// failures throw, and unstable_cache never stores a thrown result
const cached = unstable_cache(async (_repo: string) => (await loadSettings()).settings, ["portfolio-settings-v1"], { tags: ["settings"], revalidate: 300 });

/** The panel's settings (cached up to five minutes, refreshed at once after a save); defaults when unreadable. */
export async function getSettings(): Promise<Settings> {
  if (!ghConfigured()) return DEFAULT_SETTINGS;
  try {
    return await cached(env.githubRepo);
  } catch (e) {
    console.error("[settings] unreadable", e instanceof Error ? e.message : e);
    return DEFAULT_SETTINGS;
  }
}

/** Read-modify-write of settings.json; one retry when the file changed in between. Call updateTag("settings") after. */
export async function saveSettings(change: (s: Settings) => Settings): Promise<Settings> {
  for (let attempt = 0; ; attempt++) {
    const { settings, sha } = await loadSettings();
    const next = { ...change(structuredClone(settings)), updatedAt: new Date().toISOString() };
    try {
      await putFile(SETTINGS_FILE, `${JSON.stringify(next, null, 2)}\n`, "Panel: update settings", sha ?? undefined);
      return next;
    } catch (e) {
      if (attempt === 0 && e instanceof GhError && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
}
