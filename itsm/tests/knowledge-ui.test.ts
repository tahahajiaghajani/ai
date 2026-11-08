// The knowledge screens' pure logic (src/ui/modules/knowledge/model.ts): the editor's insertions, callouts and heading
// anchors in the reading view (through react-markdown, the anchors equal to the server's table of contents), the URL
// filter, reading time, highlighted excerpts, the search page's URL state, the category tree, the active heading,
// what autosave sends and which tables get the knowledge panel.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { headings } from "@shared/knowledge/logic";
import {
  activeHeading, calloutOf, categoryTree, draftChanges, helpfulLine, highlight, insertArticleLink, insertBlock, insertBlockRef, insertCallout, insertCode, insertImage, insertTable, readSearch, readingMinutes,
  remarkCallouts, remarkSlugs, takesKnowledge, toggleHeading, urlTransform, writeSearch,
} from "../src/ui/modules/knowledge/model";

const render = (md: string) => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkSlugs(md), remarkCallouts], skipHtml: true, urlTransform }, md));

describe("editor insertions", () => {
  it("inserts blocks on their own lines and selects the placeholder", () => {
    const r = insertBlock("الف\nب", 3, 3, "BLOCK", [0, 5]);
    expect(r.text).toBe("الف\n\nBLOCK\n\nب");
    expect(r.text.slice(r.start, r.end)).toBe("BLOCK");
    expect(insertBlock("", 0, 0, "X").text).toBe("X\n");
  });

  it("toggles headings of the caret's line", () => {
    const t = "مقدمه\nنصب برنامه\nپایان";
    const h2 = toggleHeading(t, 8, 2);
    expect(h2.text.split("\n")[1]).toBe("## نصب برنامه");
    expect(toggleHeading(h2.text, 9, 2).text).toBe(t); // the same level again: back to text
    expect(toggleHeading(h2.text, 9, 3).text.split("\n")[1]).toBe("### نصب برنامه");
  });

  it("callouts, code, tables, images, blocks and article links", () => {
    const c = insertCallout("پیش هشدار پس", 4, 9, "warning");
    expect(c.text).toContain("> [!WARNING]\n> هشدار");
    expect(c.text.slice(c.start, c.end)).toBe("هشدار");
    const code = insertCode("ipconfig /all", 0, 13, "powershell");
    expect(code.text).toBe("```powershell\nipconfig /all\n```\n");
    expect(code.text.slice(code.start, code.end)).toBe("ipconfig /all");
    const tbl = insertTable("", 0, 0, 2, 1).text.trim().split("\n");
    expect(tbl).toHaveLength(3);
    expect(tbl[1]).toBe("| --- | --- |");
    expect(insertImage("", 0, 0, "0190a8a2-1111-7000-8000-000000000001", "نمای [پنجره]").text).toBe("![نمای پنجره](attachment:0190a8a2-1111-7000-8000-000000000001)\n");
    expect(insertBlockRef("", 0, 0, "KBB000012").text).toBe("{{block:KBB000012}}\n");
    const l = insertArticleLink("ببینید این را", 7, 13, "KB000123", "عنوان");
    expect(l.text).toBe("ببینید [این را](kb:KB000123)");
    expect(insertArticleLink("", 0, 0, "KB000123", "نصب [VPN]").text).toBe("[نصب VPN](kb:KB000123)");
  });
});

describe("reading view markdown", () => {
  it("anchors headings exactly like the server's table of contents", () => {
    const md = "# نصب\n\n## گام‌ها\n\n```\n## نه این\n```\n\n## گام‌ها\n\n### **پرسش‌های** رایج\n\n##### ریز\n";
    const html = render(md);
    for (const h of headings(md)) expect(html).toContain(`id="${h.slug}"`);
    expect(html.match(/ id="/g)?.length).toBe(headings(md).length);
  });

  it("turns [!KIND] quotes into callouts and keeps plain quotes", () => {
    expect(calloutOf("[!TIP] متن")).toEqual({ kind: "tip", rest: "متن" });
    expect(calloutOf("متن عادی")).toBeNull();
    const html = render("> [!WARNING]\n> سرور را خاموش نکنید\n\n> نقل قول ساده\n");
    expect(html).toContain('<aside class="kb-callout is-warning" data-kind="warning" role="note">');
    expect(html).toContain("سرور را خاموش نکنید");
    expect(html).not.toContain("[!WARNING]");
    expect(html).toContain("<blockquote>");
  });

  it("keeps safe and app URLs only", () => {
    expect(urlTransform("https://a.example/x")).toBe("https://a.example/x");
    expect(urlTransform("attachment:0190a8a2-1111-7000-8000-000000000001")).toContain("attachment:");
    expect(urlTransform("kb:KB000012")).toBe("kb:KB000012");
    expect(urlTransform("#section")).toBe("#section");
    expect(urlTransform("javascript:alert(1)")).toBe("");
    expect(urlTransform("data:text/html;base64,xx")).toBe("");
    const html = render("[x](javascript:alert(1)) <b>raw</b>");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<b>");
  });
});

describe("reading helpers", () => {
  it("reading time, helpfulness and highlights", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(900)).toBe(5);
    expect(helpfulLine(0, 0)).toBeNull();
    expect(helpfulLine(8, 2)).toBe("۸ از ۱۰ نفر این مقاله را مفید دانستند");
    const parts = highlight("نصب چاپگر طبقهٔ سوم", ["چاپگر"]);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual(["چاپگر"]);
    expect(parts.map((p) => p.text).join("")).toBe("نصب چاپگر طبقهٔ سوم");
    expect(highlight("متن", [])).toEqual([{ text: "متن", hit: false }]);
  });

  it("the active heading is the last one above the reading line", () => {
    const tops = [{ slug: "a", top: -400 }, { slug: "b", top: 80 }, { slug: "c", top: 600 }];
    expect(activeHeading(tops, 120)).toBe("b");
    expect(activeHeading([{ slug: "a", top: 300 }], 120)).toBe("a");
    expect(activeHeading([], 120)).toBeNull();
  });
});

describe("search page state", () => {
  it("reads and writes the URL, dropping defaults and resetting the page on a new filter", () => {
    const st = readSearch(new URLSearchParams("q=vpn&base=b1&sort=popular&page=3&lang=en"));
    expect(st).toEqual({ q: "vpn", base: "b1", category: null, type: null, language: "en", sort: "popular", page: 3 });
    expect(readSearch(new URLSearchParams("sort=weird&page=-2")).sort).toBe("relevance");
    expect(readSearch(new URLSearchParams("page=abc")).page).toBe(1);
    expect(writeSearch(st, { type: "faq" }).toString()).toBe("q=vpn&base=b1&type=faq&lang=en&sort=popular");
    expect(writeSearch(st, { page: 4 }).get("page")).toBe("4");
    expect(writeSearch(st, { sort: "relevance", base: null, language: null }).toString()).toBe("q=vpn");
  });
});

describe("category tree", () => {
  it("nests a base's categories and sums counts down the tree", () => {
    const n = (id: string, parent: string | null, count: number, base = "b") => ({ id, name: id, parent_id: parent, base_id: base, icon: null, description: null, article_count: count, depth: 0, restricted: false });
    const t = categoryTree([n("root", null, 1), n("kid", "root", 2), n("grand", "kid", 3), n("other", null, 4), n("elsewhere", null, 9, "x"), n("orphan", "missing", 5)], "b");
    expect(t.map((x) => x.id)).toEqual(["root", "other", "orphan"]);
    expect(t[0].total).toBe(6);
    expect(t[0].children[0].children[0].id).toBe("grand");
  });
});

describe("drafts and panels", () => {
  it("autosave sends only what changed", () => {
    const saved = { title: "الف", body: "متن", keywords: ["a"], change_kind: "minor" };
    expect(draftChanges(saved, { ...saved })).toEqual({});
    expect(draftChanges(saved, { ...saved, body: "متن تازه", keywords: ["a", "b"] })).toEqual({ body: "متن تازه", keywords: ["a", "b"] });
    expect(draftChanges({ summary: null }, { summary: "" })).toEqual({});
  });

  it("the knowledge panel goes on task-like tables with links, never on knowledge's own", () => {
    const f = (names: string[]) => names.map((name) => ({ name }));
    expect(takesKnowledge({ key: "incident", module: "incident", features: { links: true }, fields: f(["short_description"]) })).toBe(true);
    expect(takesKnowledge({ key: "kb_task", module: "knowledge", features: { links: true }, fields: f(["short_description"]) })).toBe(false);
    expect(takesKnowledge({ key: "group", features: {}, fields: f(["name"]) })).toBe(false);
    expect(takesKnowledge({ key: "ci", features: { links: true }, fields: f(["name"]) })).toBe(false);
  });
});
