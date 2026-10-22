import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { isSlug, readingMinutes, slugify } from "@/lib/blog-shared";
import { ArticleBody, headings } from "@/components/blog/article-body";

describe("blog slugs", () => {
  it("keeps Persian letters and joins words with dashes", () => {
    expect(slugify("پایان پشتیبانی Project Server ۲۰۱۶")).toBe("پایان-پشتیبانی-project-server-۲۰۱۶");
    expect(slugify("  EPM: what's next?  ")).toBe("epm-what-s-next");
    expect(slugify("سامانه‌ی PTMS")).toBe("سامانه-ی-ptms");
  });
  it("unifies Arabic kaf/yeh", () => {
    expect(slugify("كيفيت")).toBe("کیفیت");
  });
  it("validates slugs", () => {
    expect(isSlug("moarefi-ptms")).toBe(true);
    expect(isSlug("پایان-پشتیبانی")).toBe(true);
    expect(isSlug("bad slug")).toBe(false);
    expect(isSlug("-x")).toBe(false);
    expect(isSlug("")).toBe(false);
  });
  it("estimates reading time", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes(Array(1000).fill("واژه").join(" "))).toBe(5);
  });
});

describe("article body", () => {
  const html = (md: string) => renderToStaticMarkup(createElement(ArticleBody, { text: md }));
  it("renders headings with anchors, lists, quotes and code", () => {
    const out = html("## بخش اول\n\nمتن **پررنگ** و [پیوند](https://example.com)\n\n- یک\n- دو\n\n> نقل‌قول\n\n```\ncode <b>\n```");
    expect(out).toContain(`<h2 id="h-بخش-اول"`);
    expect(out).toContain("<strong");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("<ul");
    expect(out).toContain("<blockquote");
    expect(out).toContain("code &lt;b&gt;");
  });
  it("never renders raw HTML or unsafe links", () => {
    const out = html('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![a](http://insecure.example/x.png)');
    expect(out).not.toContain("<script");
    expect(out).not.toContain('href="javascript');
    expect(out).not.toContain("<img");
  });
  it("lists only ## and ### headings outside code fences", () => {
    expect(headings("## الف\n```\n## نه\n```\n### ب\n#### ج").map((h) => h.text)).toEqual(["الف", "ب"]);
  });
  it("treats ```code``` on one line as inline code, not a fence", () => {
    const md = "```npm run build```\n\n## Next step\n\nSome text";
    const out = html(md);
    expect(out).not.toContain("<pre");
    expect(out).toContain(">npm run build</code>");
    expect(out).toContain("<h2");
    expect(headings(md).map((h) => h.text)).toEqual(["Next step"]);
  });
  it("reads lists numbered with Persian digits and keeps the first number", () => {
    const out = html("۱. ارزیابی\n۲. مهاجرت\n۳. آموزش\n\n۴. پشتیبانی");
    expect(out.match(/<li/g)).toHaveLength(4);
    expect(out).toContain("list-[persian]");
    expect(out).toContain('start="4"');
    expect(html("3. three\n4. four")).toContain('start="3"');
    expect(html("1. one\n2. two")).not.toContain("start=");
  });
  it("gives every heading a unique id that the table of contents links to", () => {
    const md = "## Intro\n\n## Intro\n\n## Main\n\n## !!!\n\n## See [docs](https://x.com)";
    const toc = headings(md);
    expect(toc.map((h) => h.id)).toEqual(["h-intro", "h-intro-2", "h-main", "h-section", "h-see-docs"]);
    expect(toc[4].text).toBe("See docs");
    const out = html(md);
    for (const h of toc) expect(out).toContain(`id="${h.id}"`);
  });
  it("counts #### headings for ids exactly as the body does", () => {
    const md = "#### A\n\n## A";
    expect(headings(md)).toEqual([{ id: "h-a-2", text: "A", level: 2 }]);
    expect(html(md)).toContain('<h2 id="h-a-2"');
  });
  it("ends a paragraph at a *** rule", () => {
    const out = html("para\n***\nnext");
    expect(out).toContain("<hr");
    expect(out).not.toContain("***");
  });
});
