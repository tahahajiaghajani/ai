import "server-only";
import { unstable_cache } from "next/cache";
import { env } from "@/lib/env";
import { getFile, ghConfigured, GhError, putFile } from "@/lib/github";
import { CLOSED_SETTINGS, DEFAULT_SETTINGS, parseSettings, type Settings } from "@/lib/settings-types";

export const SETTINGS_FILE = "settings.json";

/**
 * Reads settings.json straight from the repository (no file yet = the defaults). Throws when GitHub is not
 * configured or not reachable, and when the file is not valid JSON (e.g. after a manual edit), so the panel says so.
 */
export async function loadSettings(): Promise<{ settings: Settings; sha: string | null }> {
  if (!ghConfigured()) throw new GhError("not configured", 0);
  const f = await getFile(SETTINGS_FILE);
  if (!f) return { settings: DEFAULT_SETTINGS, sha: null };
  let raw: unknown;
  try {
    raw = JSON.parse(f.text);
  } catch {
    throw new GhError(`${SETTINGS_FILE} is not valid JSON; fix or delete it on GitHub`, 422);
  }
  return { settings: parseSettings(raw), sha: f.sha };
}

// the repository is an argument so a different GITHUB_REPO never reads another repository's cached settings;
// failures throw, and unstable_cache never stores a thrown result
const cached = unstable_cache(async (_repo: string) => (await loadSettings()).settings, ["portfolio-settings-v1"], { tags: ["settings"], revalidate: 300 });

/**
 * The panel's settings (cached up to five minutes, refreshed at once after a save). A cached copy keeps being used
 * while GitHub is unreachable; with none (a fresh start, or right after a save) everything that sends visitor text
 * elsewhere stays off until the file can be read, so a just-saved "off" is never undone by an older copy.
 */
export async function getSettings(): Promise<Settings> {
  if (!ghConfigured()) return DEFAULT_SETTINGS;
  try {
    return await cached(env.githubRepo);
  } catch (e) {
    console.error("[settings] unreadable", e instanceof Error ? e.message : e);
    return CLOSED_SETTINGS;
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
