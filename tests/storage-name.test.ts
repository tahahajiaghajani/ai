import { describe, expect, it } from "vitest";
import { storageSafeName } from "@/lib/utils";

describe("storageSafeName", () => {
  it("keeps ASCII names", () => {
    expect(storageSafeName("IMG_0300.jpeg")).toBe("IMG_0300.jpeg");
    expect(storageSafeName("report v2.final.PDF")).toBe("report_v2.final.pdf");
  });

  it("makes Persian names ASCII while keeping the extension", () => {
    expect(storageSafeName("امتیازات پروژه.html")).toBe("file.html");
    expect(storageSafeName("لیگ پروژه‌ها (نسخه 2).html")).toBe("2.html");
    expect(storageSafeName("گزارش-Q3.xlsx")).toBe("Q3.xlsx");
  });

  it("only produces characters Supabase Storage accepts", () => {
    for (const n of ["سند.docx", "a/b\\\\c.txt", "..hidden", "", "نام بدون پسوند", "x.تست"]) {
      expect(storageSafeName(n)).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });
});
