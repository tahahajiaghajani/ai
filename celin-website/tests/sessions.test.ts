import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }) }));

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
});

describe("session cookies", async () => {
  const { readSession, sessionValue, hashPassword, checkPassword } = await import("@/lib/auth");
  const id = "11111111-1111-4111-8111-111111111111";

  it("round-trips and rejects tampering or expiry", () => {
    const now = Date.parse("2026-10-23T00:00:00Z");
    const v = sessionValue(id, 3, now);
    expect(readSession(v, now + 1000)).toEqual({ id, ver: 3, via: "pw" });
    const parts = v.split(".");
    expect(readSession([parts[0], parts[1], "4", parts[3], parts[4]].join("."), now)).toBeNull();
    expect(readSession(v, now + 31 * 86400_000)).toBeNull();
    expect(readSession("garbage", now)).toBeNull();
  });

  it("records how the session was opened, and that cannot be changed", async () => {
    const { sign } = await import("@/lib/crypto");
    const now = Date.parse("2026-10-23T00:00:00Z");
    const code = sessionValue(id, 1, now, "code");
    expect(readSession(code, now)).toEqual({ id, ver: 1, via: "code" });
    const p = code.split(".");
    // a code session cannot be turned into a password session (the kind is signed)
    expect(readSession([p[0], p[1], p[2], "pw", p[4]].join("."), now)).toBeNull();
    expect(readSession([p[0], p[1], p[2], "legacy", p[4]].join("."), now)).toBeNull();
    // a cookie from before this was recorded still works, as "legacy" (never enough for the admin panel)
    const exp = now + 86400_000;
    const legacy = `${id}.${exp}.2.${sign(`session:${id}:${exp}:2`)}`;
    expect(readSession(legacy, now)).toEqual({ id, ver: 2, via: "legacy" });
  });

  it("hashes passwords with scrypt", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await checkPassword("correct horse battery", h)).toBe(true);
    expect(await checkPassword("wrong", h)).toBe(false);
    expect(await checkPassword("x", null)).toBe(false);
  });
});
