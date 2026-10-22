import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };

// A fake Supabase client (one result per table) and an unstable_cache stand-in that, like the real one,
// stores only results that resolve: a loader that throws leaves nothing behind.
const h = vi.hoisted(() => ({
  results: {} as Record<string, Result>,
  connected: true,
  store: new Map<string, unknown>(),
}));

vi.mock("@/lib/db", () => ({
  db: () => {
    if (!h.connected) return null;
    return {
      from: (table: string) => {
        const q = {
          select: () => q,
          order: () => q,
          then: (ok: (r: Result) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(h.results[table]).then(ok, fail),
        };
        return q;
      },
    };
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = keyParts.join(",");
    if (h.store.has(key)) return h.store.get(key);
    const value = await fn();
    h.store.set(key, value);
    return value;
  },
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { getSettings, getSettingsFresh } from "@/lib/settings";
import { CONTACT_ENTRY_ID, getKnowledge, listKnowledgeRows } from "@/lib/knowledge";
import { DEFAULT_SETTINGS } from "@/lib/settings-types";
import { DEFAULT_KNOWLEDGE } from "@/lib/knowledge-default";

const blip: Result = { data: null, error: { message: "fetch failed" } };
const storedAi = { ...DEFAULT_SETTINGS.ai, enabled: false, apiKeyEnc: "enc", apiKeyHint: "…abcd" };
const row = { id: "k1", title: "t", body: "b", tags: null, pinned: false, enabled: true, sort: 1, updated_at: "2026-01-01" };

beforeEach(() => {
  h.store.clear();
  h.connected = true;
  h.results = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("settings", () => {
  it("merges stored rows over the defaults", async () => {
    h.results.pars_settings = { data: [{ key: "ai", value: storedAi }], error: null };
    const s = await getSettings();
    expect(s.ai.apiKeyEnc).toBe("enc");
    expect(s.ai.enabled).toBe(false);
    expect(s.chat).toEqual(DEFAULT_SETTINGS.chat);
  });

  it("falls back to the defaults on a read error without caching them", async () => {
    h.results.pars_settings = blip;
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    h.results.pars_settings = { data: [{ key: "ai", value: storedAi }], error: null };
    expect((await getSettings()).ai.apiKeyEnc).toBe("enc");
  });

  it("keeps the admin read strict so saves never write defaults over stored keys", async () => {
    h.results.pars_settings = blip;
    await expect(getSettingsFresh()).rejects.toThrow("fetch failed");
  });

  it("treats a missing table as nothing stored", async () => {
    h.results.pars_settings = { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
    expect(await getSettingsFresh()).toEqual(DEFAULT_SETTINGS);
  });

  it("uses the defaults when Supabase is not configured", async () => {
    h.connected = false;
    expect(await getSettingsFresh()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("knowledge", () => {
  it("falls back to the starter set on a read error without caching it", async () => {
    h.results.pars_knowledge = blip;
    // the live contact entry (from the site settings) is always appended
    const stored = (k: Awaited<ReturnType<typeof getKnowledge>>) => ({ ...k, entries: k.entries.filter((e) => e.id !== CONTACT_ENTRY_ID) });
    expect(stored(await getKnowledge())).toEqual({ entries: DEFAULT_KNOWLEDGE, source: "default" });
    h.results.pars_knowledge = { data: [row], error: null };
    const k = stored(await getKnowledge());
    expect(k.source).toBe("db");
    expect(k.entries.map((e) => e.id)).toEqual(["k1"]);
  });

  it("uses the starter set while the table is empty", async () => {
    h.results.pars_knowledge = { data: [], error: null };
    expect((await getKnowledge()).source).toBe("default");
  });

  it("keeps listKnowledgeRows returning null when the read fails or Supabase is missing", async () => {
    h.results.pars_knowledge = blip;
    expect(await listKnowledgeRows()).toBeNull();
    h.connected = false;
    expect(await listKnowledgeRows()).toBeNull();
  });
});
