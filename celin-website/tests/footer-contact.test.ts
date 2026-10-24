import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Footer } from "@/components/site/footer";
import { DEFAULT_SETTINGS, type ContactSettings } from "@/lib/settings-types";

const render = (contact: Partial<ContactSettings>, lang: "fa" | "en" = "fa") =>
  renderToStaticMarkup(createElement(Footer, { lang, contact: { ...DEFAULT_SETTINGS.contact, phone: "", whatsapp: "", instagram: "", telegram: "", hours_fa: "", hours_en: "", ...contact } }));

describe("footer «get in touch» column", () => {
  it("is left out when the owner has filled in nothing (a fresh install): no lone heading, no empty list", () => {
    for (const lang of ["fa", "en"] as const) {
      const html = render({}, lang);
      expect(html).not.toContain(lang === "fa" ? "ارتباط با ما" : "Get in touch");
      expect(html).not.toMatch(/<ul[^>]*>\s*<\/ul>/);
    }
  });

  it("shows only the hours when only the hours are set", () => {
    const html = render({ hours_fa: "شنبه تا پنجشنبه، ۱۰ تا ۲۰" });
    expect(html).toContain("ارتباط با ما");
    expect(html).toContain("شنبه تا پنجشنبه، ۱۰ تا ۲۰");
    expect(html).not.toMatch(/<ul[^>]*>\s*<\/ul>/);
  });

  it("lists the channels that are set", () => {
    const html = render({ instagram: "celin.gallery" }, "en");
    expect(html).toContain("Get in touch");
    expect(html).toContain("https://instagram.com/celin.gallery");
  });
});
