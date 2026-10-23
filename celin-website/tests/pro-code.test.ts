import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.APP_SECRET = "test-secret-test-secret-test-secret";
});

describe("Pro codes", async () => {
  const { codeHashes, codeState, formatCode, generateCode, normalizeCode } = await import("@/lib/pro");

  it("generates 12 digits in groups of four, never starting with 0", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const c = generateCode();
      expect(c).toMatch(/^[1-9]\d{3} \d{4} \d{4}$/);
      seen.add(c);
    }
    expect(seen.size).toBe(300);
  });

  it("accepts what people type or paste: Persian digits, spaces, dashes, surrounding text", () => {
    const c = generateCode();
    const norm = c.replace(/ /g, "");
    expect(normalizeCode(c)).toBe(norm);
    expect(normalizeCode(c.replace(/ /g, "-"))).toBe(norm);
    expect(normalizeCode("۴۸۲۷ ۱۹۳۰ ۵۵۶۱")).toBe("482719305561");
    expect(normalizeCode("٤٨٢٧١٩٣٠٥٥٦١")).toBe("482719305561");
    expect(normalizeCode("سلین | کد اشتراک Pro شما: 4827 1930 5561")).toBe("482719305561");
    expect(formatCode(norm)).toBe(c);
  });

  it("refuses anything that is not exactly 12 digits", () => {
    for (const bad of ["", "1234", "4827 1930 556", "4827 1930 55611", "ABCD-EFGH-JKLM"]) expect(normalizeCode(bad)).toBe("");
  });

  it("hashes stably with the secret", () => {
    const [a] = codeHashes("482719305561");
    const [b] = codeHashes("482719305561");
    const [other] = codeHashes("482719305562");
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });

  it("knows the state of a code", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    expect(codeState({ revoked_at: null, expires_at: null, redeemed_at: null }, now)).toBe("issued");
    expect(codeState({ revoked_at: null, expires_at: null, redeemed_at: "2026-10-01T00:00:00Z" }, now)).toBe("active");
    expect(codeState({ revoked_at: null, expires_at: "2026-10-22T00:00:00Z", redeemed_at: "2026-10-01T00:00:00Z" }, now)).toBe("expired");
    expect(codeState({ revoked_at: "2026-10-20T00:00:00Z", expires_at: null, redeemed_at: "2026-10-01T00:00:00Z" }, now)).toBe("revoked");
  });
});
