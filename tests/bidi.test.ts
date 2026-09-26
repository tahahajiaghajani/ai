import { describe, expect, it } from "vitest";
import { textDir } from "@/lib/bidi";

describe("text direction for mixed Persian/English", () => {
  it("keeps Persian text right-to-left even when it starts with an English word", () => {
    expect(textDir("PWA مدیریت پروژه بانک تجارت: یک فایل html بساز")).toBe("rtl");
    expect(textDir("project_managers_report.html آماده است")).toBe("rtl");
    expect(textDir("فایل‌های تیم با TODO(FIELD) علامت خورده‌اند")).toBe("rtl");
  });

  it("lays out purely English lines left-to-right so punctuation stays in place", () => {
    expect(textDir("Done. All required fields are mapped except three.")).toBe("ltr");
    expect(textDir("Use the same safeFetch helper as the samples.")).toBe("ltr");
  });

  it("defaults to right-to-left for numbers and symbols", () => {
    expect(textDir("۱۲۳ — 456")).toBe("rtl");
    expect(textDir("")).toBe("rtl");
  });
});
