import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-0123456789";
});

describe("crypto", () => {
  it("round-trips encrypted secrets and rejects tampering", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto");
    const box = encrypt("AIza-secret-key");
    expect(box.startsWith("v1.")).toBe(true);
    expect(decrypt(box)).toBe("AIza-secret-key");
    const parts = box.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(decrypt(parts.join("."))).toBe("");
  });
  it("signs deterministically and compares safely", async () => {
    const { sign, safeEqual } = await import("@/lib/crypto");
    expect(sign("a")).toBe(sign("a"));
    expect(safeEqual(sign("a"), sign("b"))).toBe(false);
  });
});
