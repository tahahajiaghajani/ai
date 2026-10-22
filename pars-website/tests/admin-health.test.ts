import { describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { code?: string; message: string } | null };
const h = vi.hoisted(() => ({ result: null as unknown as Result }));

vi.mock("@/lib/db", () => ({
  db: () => ({
    from: () => {
      const q = { select: () => q, limit: () => q, then: (ok: (r: Result) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(h.result).then(ok, fail) };
      return q;
    },
  }),
}));
vi.mock("@/lib/admin-auth", () => ({ assertAdmin: async () => {} }));
vi.mock("@/lib/notify", () => ({ canEmail: () => false }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn, revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

import { health } from "@/lib/admin-data";

describe("health", () => {
  it("resolves with the DB check failed when the settings read errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.result = { data: null, error: { message: "Invalid API key" } };
    const r = await health();
    expect(r.db).toBe("no_tables");
    expect(r.notify).toBe(false);
  });
  it("reads stored settings when the DB is fine", async () => {
    h.result = { data: [{ key: "ai", value: { enabled: false } }], error: null };
    const r = await health();
    expect(r.db).toBe("ok");
    expect(r.ai).toBe("disabled");
  });
});
