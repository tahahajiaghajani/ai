import { describe, expect, it, vi } from "vitest";

// Emulates postgrest-js: a HEAD request on a missing table comes back as status 204 with no error
// (the 404 has no body to parse); GET returns the PGRST205 error.
const MISSING = new Set(["pars_posts"]);
vi.mock("@/lib/db", () => ({
  db: () => ({
    from: (table: string) => {
      let head = false;
      const q: Record<string, unknown> = {};
      q.select = (_: string, o?: { head?: boolean }) => ((head = Boolean(o?.head)), q);
      q.limit = () => q;
      q.then = (ok: (r: unknown) => unknown) =>
        Promise.resolve(
          MISSING.has(table)
            ? head
              ? { data: null, error: null, status: 204 }
              : { data: null, error: { code: "PGRST205", message: "missing" }, status: 404 }
            : { data: [], error: null, status: 200 },
        ).then(ok);
      return q;
    },
    rpc: async () => ({ data: 1, error: null }),
  }),
}));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: async () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("@/lib/settings", async () => {
  const { DEFAULT_SETTINGS } = await import("@/lib/settings-types");
  return { getSettingsFresh: async () => DEFAULT_SETTINGS };
});
vi.mock("@/lib/env", () => ({ env: { supabaseUrl: "https://abc.supabase.co", supabaseKey: "k", geminiKey: "g", siteUrl: "http://localhost:3000", resendKey: "", mailFrom: "", cronSecret: "" } }));

import { connectionReport } from "@/lib/connections";

describe("connectionReport", () => {
  it("reports a missing table instead of trusting a bodiless HEAD response", async () => {
    const r = await connectionReport();
    expect(r.supabase.objects.find((o) => o.name === "pars_posts")?.ok).toBe(false);
    expect(r.supabase.objects.find((o) => o.name === "pars_settings")?.ok).toBe(true);
    expect(r.supabase.missingFiles).toEqual(["20261022140000_pars_posts.sql"]);
    expect(r.supabase.status).toBe("warn");
  });
  it("counts the env Gemini key for any provider (the runtime falls back to it)", async () => {
    const r = await connectionReport();
    expect(r.ai.keySource).toBe("env");
  });
});
