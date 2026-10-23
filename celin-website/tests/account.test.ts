import { describe, expect, it } from "vitest";
import { contactLinks } from "@/components/account/contact";
import { stepTimes } from "@/components/account/order-stepper";
import { safeNextPath } from "@/lib/member";

describe("return path after signing in", () => {
  it("keeps same-site paths and the hash", () => {
    expect(safeNextPath("/pro#request", "fa")).toBe("/pro#request");
    expect(safeNextPath("/en/account/orders/CL-123456", "en")).toBe("/en/account/orders/CL-123456");
  });
  it("falls back to the account for anything else", () => {
    for (const bad of ["", "https://evil.example", "//evil.example", "/\\evil", "/admin/users", "/account/login", "/account/login?next=/x", undefined, 42]) {
      expect(safeNextPath(bad, "fa")).toBe("/account");
    }
    expect(safeNextPath("/en/account/login", "en")).toBe("/en/account");
  });
});

describe("order steps", () => {
  it("uses the latest event of each status and the order date for the first step", () => {
    const t = stepTimes({
      created_at: "2026-10-01T08:00:00Z",
      events: [
        { status: "packing", note: "", actor: "admin", created_at: "2026-10-02T08:00:00Z" },
        { status: "ready", note: "", actor: "admin", created_at: "2026-10-03T08:00:00Z" },
        { status: "packing", note: "", actor: "admin", created_at: "2026-10-04T08:00:00Z" },
      ],
    });
    expect(t).toEqual({ pending: "2026-10-01T08:00:00Z", packing: "2026-10-04T08:00:00Z", ready: "2026-10-03T08:00:00Z" });
  });
});

describe("store contact links", () => {
  it("builds tel: and WhatsApp links from Persian digits", () => {
    const l = contactLinks({ phone: "۰۲۱-۸۸۷۷۶۶۵۵", whatsapp: "۰۹۱۲ ۳۴۵ ۶۷۸۹" }, "fa");
    expect(l.tel).toBe("tel:02188776655");
    expect(l.wa).toBe("https://wa.me/989123456789");
    expect(contactLinks({ phone: "", whatsapp: "" }, "en")).toEqual({ tel: "", phoneText: "", wa: "" });
  });
});
