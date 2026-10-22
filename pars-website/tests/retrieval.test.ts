import { describe, expect, it } from "vitest";
import { normalize, rank, selectKnowledge, tokenize, type KnowledgeEntry } from "@/lib/retrieval";
import { DEFAULT_KNOWLEDGE } from "@/lib/knowledge-default";

const e = (id: string, title: string, body: string, extra: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({ id, title, body, tags: [], pinned: false, enabled: true, sort: 10, ...extra });

describe("normalize / tokenize", () => {
  it("unifies Arabic letters, digits and half-spaces", () => {
    expect(normalize("پروژه‌هاي بانك ۱۴۰۵")).toBe("پروژه های بانک 1405");
  });
  it("drops stop-words and strips plural suffixes", () => {
    expect(tokenize("سامانه‌های مدیریت پروژه در بانک‌ها")).toEqual(["سامانه", "مدیریت", "پروژه", "بانک"]);
  });
  it("keeps technical Latin terms", () => {
    expect(tokenize("Primavera P6 and .NET")).toEqual(expect.arrayContaining(["primavera", "p6", "net"]));
  });
});

describe("rank / selectKnowledge", () => {
  const kb = [e("a", "آموزش", "دوره‌های Primavera P6 و Jira"), e("b", "تماس", "تلفن و ایمیل", { pinned: true }), e("c", "EPM", "Project Server و سبد پروژه")];
  it("ranks the matching entry first", () => {
    expect(rank(kb, "دوره primavera دارید؟")[0].entry.id).toBe("a");
  });
  it("sends everything when it fits the budget", () => {
    expect(selectKnowledge(kb, "x").map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
  it("keeps pinned entries and the best matches under a small budget", () => {
    const ids = selectKnowledge(kb, "Project Server", 60).map((x) => x.id);
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(ids).not.toContain("a");
  });
  it("skips disabled entries", () => {
    expect(selectKnowledge([...kb, e("d", "x", "y", { enabled: false })], "x").map((x) => x.id)).not.toContain("d");
  });
  it("finds the migration entry in the starter knowledge", () => {
    expect(rank(DEFAULT_KNOWLEDGE, "پشتیبانی Project Server 2016 تمام شده")[0].entry.title).toMatch(/مهاجرت/);
  });
  it("finds the profile facts in the starter knowledge", () => {
    expect(rank(DEFAULT_KNOWLEDGE, "سماپ چیست؟")[0].entry.title).toMatch(/سماپ/);
    expect(rank(DEFAULT_KNOWLEDGE, "امیر محمودی چند کتاب نوشته و کجا تدریس کرده؟")[0].entry.title).toMatch(/مدیرعامل/);
    expect(rank(DEFAULT_KNOWLEDGE, "ارزش‌های سازمانی شما چیست؟")[0].entry.title).toMatch(/ارزش/);
  });
  it("sends the whole starter knowledge (it fits the default budget)", () => {
    expect(selectKnowledge(DEFAULT_KNOWLEDGE, "x")).toHaveLength(DEFAULT_KNOWLEDGE.length);
  });
});
