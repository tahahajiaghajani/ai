// Pure logic of the retrieval UI (src/ui/ai/ask/model.ts) and the docs module's registration: citation markers as safe
// links, citation labels, which paragraphs a cited passage covers in the viewer, accepted files, labels of the admin
// page, and the shell entries (nav, routes, the command palette's «پرسش از هوش مصنوعی» row).
import { describe, expect, it } from "vitest";
import type { AiCitation } from "@shared/ai/rag";
import { acceptedFile, backendLabel, citationHref, citationLabel, coveredParagraphs, linkCitations, qualityLabel, runLabel, runStats } from "../src/ui/ai/ask/model";
import { NAV, ROUTES, SEARCHES } from "../src/ui/modules/registry";

const cite = (n: number, path: string, extra: Partial<AiCitation> = {}): AiCitation => ({
  n, table: "doc_document", table_label: "سند", id: "x", number: null, title: "راهنما", field: "content", field_label: "متن سند", page: null, page_end: null, path, chunk_id: "c", ...extra,
});

describe("citations in answers", () => {
  it("turns known markers into cite links and leaves others as text", () => {
    const out = linkCitations("پورت ۴۴۳ را باز کنید [1]. نسخهٔ تازه لازم است [2][9].", [cite(1, "a"), cite(2, "b")]);
    expect(out).toBe("پورت ۴۴۳ را باز کنید [[۱]](cite:1). نسخهٔ تازه لازم است [[۲]](cite:2)[9].");
    // a link written by the model is not touched
    expect(linkCitations("[1](https://evil.example)", [cite(1, "a")])).toBe("[1](https://evil.example)");
  });

  it("opens only safe in-app paths of this answer's citations", () => {
    const cs = [cite(1, "docs/d/01a1b7e5-087d-7039-ad03-9e3c0c670cbf?page=2&hl=01a1b7e5-087d-7039-ad03-9e3c0c670cbe"), cite(2, "javascript:alert(1)")];
    expect(citationHref("cite:1", cs)).toBe(cs[0].path);
    expect(citationHref("cite:2", cs)).toBeNull();
    expect(citationHref("cite:3", cs)).toBeNull();
    expect(citationHref("https://x.example", cs)).toBeNull();
  });

  it("labels a citation by record number, page or field", () => {
    expect(citationLabel(cite(1, "a", { page: 3 }))).toBe("سند · ص ۳");
    expect(citationLabel(cite(1, "a", { page: 3, page_end: 4 }))).toBe("سند · ص ۳–۴");
    expect(citationLabel(cite(1, "a", { table_label: "رخداد", number: "INC0000012", field_label: "شرح", page: null }))).toBe("رخداد INC0000012 · شرح");
  });
});

describe("the document viewer", () => {
  it("marks the paragraphs a cited passage covers (Persian typing differences ignored)", () => {
    const page = "مقدمهٔ سند درباره شبکه\n\nبرای اتصال VPN برنامه را نصب كنيد و پورت 443 را باز کنید\n\nپایان";
    expect(coveredParagraphs(page, "برای اتصال VPN برنامه را نصب کنید و پورت ۴۴۳ را باز کنید")).toEqual([1]);
    expect(coveredParagraphs(page, "متنی دیگر")).toEqual([]);
  });

  it("accepts the file types the server reads", () => {
    expect(["a.pdf", "b.DOCX", "c.xlsx", "d.md", "e.png", "f.csv"].every(acceptedFile)).toBe(true);
    expect(["tool.exe", "noext", "archive.zip"].some(acceptedFile)).toBe(false);
  });
});

describe("the admin page's words", () => {
  it("names the backend, the quality and the runs", () => {
    expect(backendLabel({ backend: { kind: "pgvector", version: "0.8.0", reason: null } })).toBe("pgvector 0.8.0");
    expect(backendLabel({ backend: { kind: "portable", version: null, reason: "x" } })).toMatch(/بدون pgvector/);
    expect(qualityLabel({ embedder: { quality: "local", key: null, connection_id: null, connection_label: null, model: null, dims: null, problem: null } })).toMatch(/کیفیت پایه/);
    expect(runLabel("backfill:doc_document")).toBe("بازسازی یک جدول");
    expect(runStats({ indexed: 12, chunks: 40, removed: 0 })).toBe("نمایه‌شده: ۱۲، قطعه: ۴۰");
  });
});

describe("shell entries", () => {
  it("adds the library, «پرسش از اسناد» and «پرسش از هوش مصنوعی» with their routes", () => {
    const paths = NAV.flatMap((g) => g.items.map((i) => i.path));
    expect(paths).toEqual(expect.arrayContaining(["docs", "docs/ask", "ask"]));
    expect(ROUTES.map((r) => r.path)).toEqual(expect.arrayContaining(["docs", "docs/ask", "docs/d/:id", "docs/d/:id/edit", "ask", "docs/collections", "docs/collections/:id"]));
  });

  it("offers «پرسش از هوش مصنوعی» in the command palette for any question", async () => {
    const s = SEARCHES.find((x) => x.key === "ai:ask")!;
    const hits = await s.run({} as never, "چطور VPN را وصل کنم؟");
    expect(hits).toEqual([{ id: "ask", label: "پرسش از هوش مصنوعی: «چطور VPN را وصل کنم؟»", meta: "پاسخ با ارجاع به منابع شما", path: `ask?q=${encodeURIComponent("چطور VPN را وصل کنم؟")}` }]);
  });
});
