import { afterEach, describe, expect, it } from "vitest";
import { adminPhones, isAdminPhone, parseAdminPhones } from "@/lib/admin-phones";

describe("ADMIN_PHONES", () => {
  afterEach(() => {
    delete process.env.ADMIN_PHONES;
  });

  it("reads one number in any common spelling", () => {
    for (const raw of ["09121234567", " 0912 123 4567 ", "+98 912 123 4567", "0098-912-123-4567", "989121234567", "9121234567", "۰۹۱۲۱۲۳۴۵۶۷", "٠٩١٢١٢٣٤٥٦٧"]) {
      expect(parseAdminPhones(raw)).toEqual(["09121234567"]);
    }
  });

  it("reads several numbers separated by commas, «،», semicolons, line breaks or spaces", () => {
    const want = ["09121234567", "09351112222"];
    for (const raw of [
      "09121234567,09351112222",
      "09121234567, 09351112222",
      "۰۹۱۲۱۲۳۴۵۶۷،۰۹۳۵۱۱۱۲۲۲۲",
      "09121234567;09351112222",
      "09121234567\n09351112222",
      "09121234567 09351112222",
      "0912 123 4567 0935 111 2222",
      "+98 912 123 4567 +98 935 111 2222",
    ]) {
      expect(parseAdminPhones(raw)).toEqual(want);
    }
  });

  it("ignores what is not an Iranian mobile number, and duplicates", () => {
    expect(parseAdminPhones("")).toEqual([]);
    expect(parseAdminPhones("admin, 12345, 021 8877 6655")).toEqual([]);
    expect(parseAdminPhones("09121234567, 0912 123 4567, +989121234567")).toEqual(["09121234567"]);
    expect(parseAdminPhones("junk 09121234567 more")).toEqual(["09121234567"]);
  });

  it("matches account phones however they are written", () => {
    const list = ["09121234567"];
    expect(isAdminPhone("09121234567", list)).toBe(true);
    expect(isAdminPhone("+989121234567", list)).toBe(true);
    expect(isAdminPhone("09121234568", list)).toBe(false);
    expect(isAdminPhone("", list)).toBe(false);
    expect(isAdminPhone(null, list)).toBe(false);
    expect(isAdminPhone("09121234567", [])).toBe(false);
  });

  it("follows the environment variable", () => {
    expect(adminPhones()).toEqual([]);
    process.env.ADMIN_PHONES = "0912 123 4567";
    expect(adminPhones()).toEqual(["09121234567"]);
    expect(isAdminPhone("09121234567")).toBe(true);
    process.env.ADMIN_PHONES = "09351112222";
    expect(isAdminPhone("09121234567")).toBe(false);
    expect(isAdminPhone("09351112222")).toBe(true);
  });
});
