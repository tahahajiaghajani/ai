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
    expect(readSession(v, now + 1000)).toEqual({ id, ver: 3 });
    const parts = v.split(".");
    expect(readSession([parts[0], parts[1], "4", parts[3]].join("."), now)).toBeNull();
    expect(readSession(v, now + 31 * 86400_000)).toBeNull();
    expect(readSession("garbage", now)).toBeNull();
  });

  it("hashes passwords with scrypt", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await checkPassword("correct horse battery", h)).toBe(true);
    expect(await checkPassword("wrong", h)).toBe(false);
    expect(await checkPassword("x", null)).toBe(false);
  });
});
