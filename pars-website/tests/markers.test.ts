import { describe, expect, it } from "vitest";
import { parseMarkers } from "@/lib/markers";
import { normalizeCode, ticketCode } from "@/lib/ticket-meta";
import { num } from "@/lib/i18n";

describe("parseMarkers", () => {
  it("extracts actions and the unknown flag", () => {
    const r = parseMarkers("نمی‌دانم.\n[[unknown]] [[action:ticket]] [[action:demos]]");
    expect(r.text).toBe("نمی‌دانم.");
    expect(r.actions).toEqual(["ticket", "demos"]);
    expect(r.unknown).toBe(true);
  });
  it("hides a marker that is still streaming", () => {
    expect(parseMarkers("سلام [[act").text).toBe("سلام");
  });
  it("ignores unknown action names", () => {
    expect(parseMarkers("x [[action:hack]]").actions).toEqual([]);
  });
});

describe("ticket codes", () => {
  it("are PP- plus 6 unambiguous characters", () => {
    const code = ticketCode((n) => new Uint8Array(n).map((_, i) => i * 37));
    expect(code).toMatch(/^PP-[2-9A-HJ-NP-Z]{6}$/);
  });
  it("normalizes user input", () => {
    expect(normalizeCode(" pp-7k3qx9 ")).toBe("PP-7K3QX9");
    expect(normalizeCode("7k3qx9")).toBe("PP-7K3QX9");
  });
});

describe("num", () => {
  it("keeps leading zeros and converts percent", () => {
    expect(num("021-88731601", "fa")).toBe("۰۲۱-۸۸۷۳۱۶۰۱");
    expect(num("90%", "fa")).toBe("۹۰٪");
    expect(num("90%", "en")).toBe("90%");
  });
});
