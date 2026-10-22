import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ state: { state: "error" } as unknown, deleted: [] as string[] }));
vi.mock("@/lib/auth", () => ({ USER_HINT: "pars_user_ui", sessionState: async () => h.state }));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: (n: string) => h.deleted.push(n) }) }));

import { GET } from "@/app/api/me/route";

describe("/api/me", () => {
  it("keeps the hint cookie when the account could not be checked", async () => {
    h.state = { state: "error" };
    h.deleted = [];
    const r = await GET();
    expect(r.status).toBe(503);
    expect(h.deleted).toEqual([]);
  });
  it("drops the hint for a revoked session and is never cached", async () => {
    h.state = { state: "revoked" };
    h.deleted = [];
    const r = await GET();
    expect(await r.json()).toEqual({ user: null });
    expect(h.deleted).toEqual(["pars_user_ui"]);
    expect(r.headers.get("cache-control")).toContain("no-store");
  });
  it("returns only display fields of the signed-in account", async () => {
    h.state = { state: "ok", user: { id: "x", email: "a@b.co", name: "A", phone: "1", organization: "O", role: "admin", disabled: false, session_version: 3 } };
    const j = await (await GET()).json();
    expect(j).toEqual({ user: { name: "A", email: "a@b.co", role: "admin", phone: "1", organization: "O" } });
  });
});
