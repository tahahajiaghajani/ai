import { describe, expect, it } from "vitest";
import { formatPhone, formatPrice, latinDigits, normalizePhone, num } from "@/lib/format";

describe("phone numbers", () => {
  it("normalises Iranian mobiles in every common shape", () => {
    for (const raw of ["09123456789", "۰۹۱۲۳۴۵۶۷۸۹", "+989123456789", "00989123456789", "989123456789", "9123456789", "0912 345 6789", "0912-345-6789"]) {
      expect(normalizePhone(raw)).toBe("09123456789");
    }
  });
  it("rejects anything else", () => {
    for (const raw of ["", "0212345678", "0912345678", "091234567890", "abc", "+4917612345678"]) expect(normalizePhone(raw)).toBe("");
  });
  it("formats for display", () => {
    expect(formatPhone("09123456789", "en")).toBe("0912 345 6789");
    expect(formatPhone("09123456789", "fa")).toBe("۰۹۱۲ ۳۴۵ ۶۷۸۹");
  });
});

describe("digits and prices", () => {
  it("converts digits both ways", () => {
    expect(num(2026, "fa")).toBe("۲۰۲۶");
    expect(num("50%", "fa")).toBe("۵۰٪");
    expect(latinDigits("۱۲٣٤")).toBe("1234");
  });
  it("formats Toman prices", () => {
    expect(formatPrice(12500000, "en")).toBe("12,500,000 Toman");
    expect(formatPrice(12500000, "fa")).toBe("۱۲٬۵۰۰٬۰۰۰ تومان");
  });
});
