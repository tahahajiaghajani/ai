import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, textDir } from "@/components/chat/markdown";
import { endedEarly } from "@/components/chat/chat-context";

const md = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

describe("textDir", () => {
  it("follows the language of the block", () => {
    expect(textDir("Project Server 2016 support has ended.")).toBe("ltr");
    expect(textDir("پشتیبانی از Project Server 2016 تمام شده است.")).toBe("rtl");
  });
  it("keeps a Persian line RTL when it starts with English terms", () => {
    expect(textDir("**Project Online**: سرویس ابری مایکروسافت برای مدیریت پروژه")).toBe("rtl");
    expect(textDir("برای Microsoft Project Server 2019 و Project Online پشتیبانی داریم")).toBe("rtl");
  });
  it("keeps a line that starts in Persian RTL, however many English names follow", () => {
    expect(textDir("مقایسه Project Online و Project Server")).toBe("rtl");
    expect(textDir("معرفی Microsoft Project Server")).toBe("rtl");
    expect(textDir("نرم‌افزارها: Microsoft Project (MSP) و EPM / Project Server، Oracle Primavera P6 و Jira.")).toBe("rtl");
  });
  it("keeps an English line LTR when it quotes a Persian name", () => {
    expect(textDir("Pars (پارس) is a Microsoft partner for project management.")).toBe("ltr");
    expect(textDir("In Persian, «مدیریت پروژه» means project management.")).toBe("ltr");
  });
  it("ignores code, URLs and link targets", () => {
    expect(textDir("صفحه‌ی [دموها](https://pars.example.com/en/demos/project-online) را ببینید")).toBe("rtl");
    expect(textDir("دستور `npm run build --workspace pars-website` را اجرا کنید")).toBe("rtl");
    expect(textDir("ببینید: https://learn.microsoft.com/en-us/project/project-online-overview")).toBe("rtl");
  });
  it("leaves blocks without letters to the page direction", () => {
    expect(textDir("۱۴۰۳ — 2024")).toBeUndefined();
    expect(textDir("`x`")).toBeUndefined();
  });
});

describe("Markdown direction", () => {
  it("sets the direction on paragraphs, headings and lists", () => {
    const html = md("### Project Online\n\nIt runs in the cloud.\n\n- Project Server 2016 support has ended.\n- Upgrade to Project Online.");
    expect(html).toContain('<h4 dir="ltr">');
    expect(html).toContain('<p dir="ltr">');
    expect(html).toContain('<ul dir="ltr"><li>');
  });
  it("keeps Persian headings and paragraphs around English product names RTL", () => {
    const html = md("### مقایسه Project Online و Project Server\n\nارتقا به Project Server Subscription Edition");
    expect(html).toContain('<h4 dir="rtl">');
    expect(html).toContain('<p dir="rtl">');
  });
  it("puts the direction on the list, not on each item", () => {
    const html = md("1. **Project Online**: نسخه‌ی ابری\n2. Project Server: نسخه‌ی درون‌سازمانی");
    expect(html).toContain('<ol dir="rtl"><li>');
    expect(html).not.toContain("<li dir");
  });
  it("omits dir when a block has no letters", () => {
    expect(md("۱۲۳")).toBe("<div class=\"prose-chat\"><p>۱۲۳</p></div>");
  });
});

describe("endedEarly", () => {
  const error = "ارتباط برقرار نشد";
  it("keeps what arrived when the visitor stopped", () => {
    expect(endedEarly("نیمه", { stopped: true, error, lang: "fa" })).toEqual({ content: "نیمه", status: "done" });
  });
  it("keeps a cut-off answer with a note instead of the browser's error", () => {
    const r = endedEarly("Pars offers ", { stopped: false, error, lang: "en" });
    expect(r).toEqual({ content: "Pars offers\n\n…The answer was cut off. Please ask again.", status: "done" });
    expect(endedEarly("پارس ", { stopped: false, error, lang: "fa" }).content).toBe("پارس\n\n…پاسخ ناتمام ماند. لطفاً دوباره بپرسید.");
  });
  it("drops a marker that was still streaming in", () => {
    expect(endedEarly("بله. [[act", { stopped: false, error, lang: "fa" }).content).toBe("بله.\n\n…پاسخ ناتمام ماند. لطفاً دوباره بپرسید.");
  });
  it("shows the localized error when nothing arrived", () => {
    expect(endedEarly("", { stopped: false, error, lang: "fa" })).toEqual({ content: error, status: "error" });
    expect(endedEarly("  \n", { stopped: false, error, lang: "fa" })).toEqual({ content: error, status: "error" });
  });
});
