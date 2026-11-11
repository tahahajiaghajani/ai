// F1 — the shared validators of field types (design F §3.1): every named check (national code, IBAN, card, postal
// code, mobile) with Persian digits and separators in the input and its canonical stored form; patterns (Latin digits
// tried too, unsafe patterns refused); decimal places; date limits with tokens; attachments of the same record only.
import { describe, it, expect } from "vitest";
import type { FieldDef } from "@shared/model/types";
import {
  FIELD_CHECKS, acceptedExtensions, attachmentIds, attachmentsProblem, checkMessage, dateLimitProblem, dateRangeProblem,
  decimalPlaces, decimalsProblem, fieldValueProblem, groupChecked, matchesPattern, normalizeChecked, normalizeFieldValue,
  patternProblem, resolveDateLimit, validChecked,
} from "@shared/forms/validators";

const fa = (s: string) => s.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
const ar = (s: string) => s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

describe("national code", () => {
  it("accepts valid codes, in Latin, Persian and Arabic digits, with separators", () => {
    for (const v of ["0499370899", "0084575948", fa("0499370899"), ar("0084575948"), "049-937089-9", " 0499370899 "]) expect(validChecked("national_id", v), v).toBe(true);
  });
  it("refuses a wrong check digit, the wrong length and a repeated digit", () => {
    for (const v of ["0499370898", "049937089", "04993708990", "1111111111", "abcdefghij", ""]) expect(validChecked("national_id", v), v).toBe(false);
  });
  it("stores ten Latin digits", () => {
    expect(normalizeChecked("national_id", fa("049-937089-9"))).toBe("0499370899");
    expect(groupChecked("national_id", "0499370899")).toBe("049-937089-9");
  });
});

describe("IBAN (شبا)", () => {
  it("accepts IR and 24 digits under mod 97, with spaces, dashes, Persian digits and lower case", () => {
    for (const v of ["IR100170000000110212345678", "ir56 0550 0123 4567 8901 2345 67", `IR${fa("100170000000110212345678")}`, "IR10-0170-0000-0011-0212-3456-78", "100170000000110212345678"]) {
      expect(validChecked("iban", v), v).toBe(true);
    }
  });
  it("refuses a broken check, another length and another country", () => {
    for (const v of ["IR110170000000110212345678", "IR10017000000011021234567", "DE89370400440532013000", "IR"]) expect(validChecked("iban", v), v).toBe(false);
  });
  it("stores capitals with IR", () => {
    expect(normalizeChecked("iban", "ir56 0550 0123 4567 8901 2345 67")).toBe("IR560550012345678901234567");
    expect(normalizeChecked("iban", fa("100170000000110212345678"))).toBe("IR100170000000110212345678");
    expect(groupChecked("iban", "IR560550012345678901234567")).toBe("IR56 0550 0123 4567 8901 2345 67");
  });
});

describe("card number", () => {
  it("accepts 16 digits under Luhn, grouped or in Persian digits", () => {
    for (const v of ["6037991234567893", "6104 3300 1234 5677", fa("6037-9912-3456-7893")]) expect(validChecked("card", v), v).toBe(true);
  });
  it("refuses a broken Luhn sum, another length and a repeated digit", () => {
    for (const v of ["6037991234567894", "603799123456789", "0000000000000000"]) expect(validChecked("card", v), v).toBe(false);
  });
  it("stores 16 Latin digits", () => {
    expect(normalizeChecked("card", fa("6104 3300 1234 5677"))).toBe("6104330012345677");
    expect(groupChecked("card", "6104330012345677")).toBe("6104 3300 1234 5677");
  });
});

describe("postal code", () => {
  it("accepts ten digits in the Iranian shape, with a dash or Persian digits", () => {
    for (const v of ["1193653471", "11936-53471", fa("1193653471")]) expect(validChecked("postal_code", v), v).toBe(true);
  });
  it("refuses 0 or 2 in the first five digits, a fifth digit 5, the wrong length and a repeated digit", () => {
    for (const v of ["1234567890", "1193553471", "119365347", "3333333333"]) expect(validChecked("postal_code", v), v).toBe(false);
  });
});

describe("mobile", () => {
  it("accepts 09… in any common written form", () => {
    for (const v of ["09121234567", "+989121234567", "00989121234567", "9121234567", fa("0912 123 4567"), "0912-123-4567"]) expect(validChecked("mobile", v), v).toBe(true);
  });
  it("refuses a landline, short numbers and letters", () => {
    for (const v of ["02112345678", "0912123456", "0912abc4567"]) expect(validChecked("mobile", v), v).toBe(false);
  });
  it("stores 09 and nine digits", () => {
    expect(normalizeChecked("mobile", "+98 912 123 4567")).toBe("09121234567");
    expect(normalizeChecked("mobile", fa("9121234567"))).toBe("09121234567");
  });
});

describe("messages and field values", () => {
  const nid: FieldDef = { name: "u_nid", label: "کد ملی متقاضی", type: "string", check: "national_id" };
  it("names the field, the check and what to look at", () => {
    expect(checkMessage("کد ملی متقاضی", "national_id")).toBe("«کد ملی متقاضی» کد ملی معتبر نیست؛ ۱۰ رقم آن را بررسی کنید");
    expect(fieldValueProblem(nid, "0499370898", { today: "2026-11-11" })).toContain("کد ملی معتبر نیست");
    expect(fieldValueProblem(nid, "0499370899", { today: "2026-11-11" })).toBeNull();
    expect(Object.keys(FIELD_CHECKS).sort()).toEqual(["attachments", "card", "iban", "mobile", "national_id", "postal_code"]);
  });
  it("lets empty values through (requirements are judged elsewhere)", () => {
    for (const v of [null, undefined, ""]) expect(fieldValueProblem(nid, v, { today: "2026-11-11" })).toBeNull();
  });
  it("normalises the stored value of checked fields only", () => {
    expect(normalizeFieldValue(nid, fa("049-937089-9"))).toBe("0499370899");
    expect(normalizeFieldValue({ check: undefined }, fa("123"))).toBe(fa("123"));
    expect(normalizeFieldValue({ check: "attachments" }, ["x"])).toEqual(["x"]);
  });
});

describe("patterns", () => {
  it("match as written and with Latin digits", () => {
    expect(matchesPattern("^\\d{6}$", "123456")).toBe(true);
    expect(matchesPattern("^\\d{6}$", fa("123456"))).toBe(true);
    expect(matchesPattern("^\\d{6}$", "12345")).toBe(false);
    expect(matchesPattern("^[آ-ی ]+$", "کاریز")).toBe(true);
  });
  it("refuse unusable or slow patterns", () => {
    expect(patternProblem("^\\d{6}$")).toBeNull();
    expect(patternProblem("(")).toContain("درستی نیست");
    expect(patternProblem("(a+)+$")).toContain("تکرار");
    expect(patternProblem("^(\\d*)*$")).toContain("تکرار");
    expect(patternProblem("(a)\\1")).toContain("ارجاع");
    expect(patternProblem("x".repeat(301))).toContain("حداکثر");
    expect(patternProblem("")).toBe("الگو خالی است");
    // an unusable pattern never matches (the write is refused, not let through)
    expect(matchesPattern("(a+)+$", "aaa")).toBe(false);
  });
  it("speak with the field's own message when it has one", () => {
    const f: FieldDef = { name: "u_code", label: "کد پرسنلی", type: "string", pattern: "^\\d{6}$" };
    expect(fieldValueProblem(f, "12", { today: "2026-11-11" })).toBe("«کد پرسنلی» با قالب خواسته‌شده جور نیست");
    expect(fieldValueProblem({ ...f, patternMessage: "شش رقم وارد کنید" }, "12", { today: "2026-11-11" })).toBe("«کد پرسنلی»: شش رقم وارد کنید");
    expect(fieldValueProblem(f, fa("654321"), { today: "2026-11-11" })).toBeNull();
  });
});

describe("decimal places", () => {
  it("count what is written, Persian separators included, trailing zeros not", () => {
    expect(decimalPlaces("12.345")).toBe(3);
    expect(decimalPlaces(fa("12٫50"))).toBe(1);
    expect(decimalPlaces("1,250")).toBe(0);
    expect(decimalPlaces(7)).toBe(0);
  });
  it("refuse more places than the field allows", () => {
    const f = { label: "نرخ", decimals: 2 };
    expect(decimalsProblem(f, "1.25")).toBeNull();
    expect(decimalsProblem(f, "1.255")).toBe("«نرخ» حداکثر ۲ رقم اعشار دارد");
    expect(decimalsProblem({ label: "مبلغ", decimals: 0 }, "1500.5")).toBe("«مبلغ» باید عدد صحیح باشد");
    expect(decimalsProblem({ label: "مبلغ" }, "1500.5")).toBeNull();
  });
});

describe("date limits", () => {
  const today = "2026-11-11";
  it("resolve tokens from today and keep fixed dates", () => {
    expect(resolveDateLimit("$today", today)).toBe("2026-11-11");
    expect(resolveDateLimit("$today+30d", today)).toBe("2026-12-11");
    expect(resolveDateLimit("$today-11d", today)).toBe("2026-10-31");
    expect(resolveDateLimit(fa("$today+1d"), today)).toBe("2026-11-12");
    expect(resolveDateLimit("2026-03-21", today)).toBe("2026-03-21");
    expect(resolveDateLimit("2026-02-30", today)).toBeNull();
    expect(resolveDateLimit("$tomorrow", today)).toBeNull();
    expect(dateLimitProblem("$today+30d")).toBeNull();
    expect(dateLimitProblem("next week")).toContain("$today+30d");
  });
  it("hold a date inside its limits, inclusive, with a Jalali message", () => {
    const f = { label: "تاریخ شروع مرخصی", minDate: "$today", maxDate: "$today+30d" };
    expect(dateRangeProblem(f, "2026-11-11", today)).toBeNull();
    expect(dateRangeProblem(f, "2026-12-11", today)).toBeNull();
    expect(dateRangeProblem(f, "2026-11-10", today)).toBe("«تاریخ شروع مرخصی» نباید پیش از ۱۴۰۵/۰۸/۲۰ باشد");
    expect(dateRangeProblem(f, "2026-12-12", today)).toBe("«تاریخ شروع مرخصی» نباید پس از ۱۴۰۵/۰۹/۲۰ باشد");
  });
  it("judge an instant by its local day", () => {
    const f: FieldDef = { name: "u_at", label: "زمان", type: "datetime", maxDate: "$today" };
    // 22:00 UTC on the 11th is already the 12th in Tehran
    const dayOf = (iso: string) => new Date(Date.parse(iso) + 3.5 * 3_600_000).toISOString().slice(0, 10);
    expect(fieldValueProblem(f, "2026-11-11T22:00:00.000Z", { today, dayOf })).toContain("نباید پس از");
    expect(fieldValueProblem(f, "2026-11-11T08:00:00.000Z", { today, dayOf })).toBeNull();
  });
});

describe("attachments", () => {
  const f: FieldDef = { name: "u_docs", label: "مدارک", type: "json", check: "attachments", max: 2, accept: ["pdf", "image"] };
  const a = "0191e6a5-0000-7000-8000-000000000001";
  const b = "0191e6a5-0000-7000-8000-000000000002";
  const c = "0191e6a5-0000-7000-8000-000000000003";
  const mine = new Map([
    [a, { name: "نامه.pdf" }],
    [b, { name: "scan.JPG" }],
    [c, { name: "data.xlsx" }],
  ]);
  it("hold an array of attachment ids, at most N", () => {
    expect(attachmentIds(f, [a, { id: b }, a])).toEqual({ ids: [a, b], problem: null });
    expect(attachmentIds(f, null)).toEqual({ ids: [], problem: null });
    expect(attachmentIds(f, "x").problem).toBe("«مدارک» باید فهرستی از پیوست‌ها باشد");
    expect(attachmentIds(f, ["not-an-id"]).problem).toBe("«مدارک» پیوست نامعتبری دارد");
    expect(attachmentIds(f, [a, b, c]).problem).toBe("«مدارک» حداکثر ۲ پرونده می‌پذیرد");
    expect(attachmentIds({ label: "x" }, Array.from({ length: 6 }, (_, i) => `0191e6a5-0000-7000-8000-00000000001${i}`)).problem).toContain("۵");
  });
  it("refuse an attachment of another record, without saying anything about it", () => {
    const other = "0191e6a5-0000-7000-8000-0000000000ff";
    expect(attachmentsProblem(f, [a, other], mine)).toBe("پیوست‌های «مدارک» باید از پرونده‌های همین رکورد باشند");
    expect(fieldValueProblem(f, [other], { today: "2026-11-11", attachments: mine })).toBe("پیوست‌های «مدارک» باید از پرونده‌های همین رکورد باشند");
  });
  it("accept only the kinds the field names", () => {
    expect(attachmentsProblem(f, [a, b], mine)).toBeNull();
    expect(attachmentsProblem(f, [c], mine)).toBe("«مدارک» فقط این نوع پرونده‌ها را می‌پذیرد: PDF، تصویر");
    expect(attachmentsProblem({ label: "x" }, [c], mine)).toBeNull();
    expect([...acceptedExtensions(["pdf", ".DOCX", "image"])]).toEqual(expect.arrayContaining(["pdf", "docx", "png", "jpg"]));
  });
  it("check the shape alone where the record's attachments are not at hand", () => {
    expect(fieldValueProblem(f, [a, b], { today: "2026-11-11" })).toBeNull();
    expect(fieldValueProblem(f, [a, b, c], { today: "2026-11-11" })).toContain("حداکثر");
  });
});
