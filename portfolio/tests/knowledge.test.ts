import { describe, expect, it } from "vitest";
import { siteKnowledge } from "@/lib/knowledge";
import { CHAT_KNOWLEDGE_BUDGET, TRIAGE_KNOWLEDGE_BUDGET, entryText, selectKnowledge } from "@/lib/retrieval";
import { PROJECTS } from "@/content/projects";
import { PRODUCTS } from "@/content/products";
import { POSTS } from "@/content/blog";
import { chatSystemPrompt } from "@/lib/assistant";

describe("assistant knowledge", () => {
  const k = siteKnowledge();
  it("covers every project and pins identity and contact", () => {
    for (const p of PROJECTS) expect(k.some((e) => e.id === `project-${p.slug}` && e.body.includes(`[[work:${p.slug}]]`))).toBe(true);
    expect(k.find((e) => e.id === "contact")?.pinned).toBe(true);
    expect(k.find((e) => e.id === "profile")?.pinned).toBe(true);
  });
  it("covers every product and post, and always knows the products", () => {
    for (const p of PRODUCTS) expect(k.some((e) => e.id === `product-${p.slug}` && e.body.includes(`[[product:${p.slug}]]`))).toBe(true);
    for (const p of POSTS) expect(k.some((e) => e.id === `post-${p.slug}` && e.body.includes(`[[post:${p.slug}]]`))).toBe(true);
    const overview = k.find((e) => e.id === "products");
    expect(overview?.pinned).toBe(true);
    expect(overview!.body.length).toBeLessThan(1500);
    // the locked editions are never handed out as downloads
    for (const e of k.filter((x) => x.id.startsWith("product"))) expect(e.body).not.toMatch(/releases|\.exe|\.msi/i);
  });
  it("finds the products and the congress post by their Persian names", () => {
    expect(selectKnowledge(k, "سیراف نسخه ویندوز", 12000).some((e) => e.id === "product-siraf")).toBe(true);
    expect(selectKnowledge(k, "کاریز نسخه سروری", 12000).some((e) => e.id === "product-kariz")).toBe(true);
    expect(selectKnowledge(k, "کنگره پروژه پایدار غرفه پارس", 12000).some((e) => e.id === "post-ispc-2026")).toBe(true);
  });
  it("finds the banks by name in both languages", () => {
    for (const q of ["بانک رفاه مدل‌های محلی", "بانک ملت سایمپ", "پست بانک ناظر", "بانک صنعت و معدن ITSM", "Which banks has Taha worked with?"]) {
      expect(selectKnowledge(k, q, 12000).some((e) => e.id === "banks"), q).toBe(true);
    }
  });
  it("tells current banks from earlier ones and leaves the bank's ITSM product unstated", () => {
    const banks = k.find((e) => e.id === "banks")!.body;
    expect(banks).toMatch(/Bank of Industry and Mine[^\n]*, current:/);
    expect(banks).toMatch(/Bank Tejarat[^\n]*, current:/);
    for (const name of ["Bank Mellat", "Refah Bank", "Post Bank of Iran"]) expect(banks, name).toMatch(new RegExp(`${name}[^\\n]*, earlier, finished:`));
    const journey = k.find((e) => e.id === "journey")!;
    expect(journey.pinned).toBe(true);
    for (const body of [banks, journey.body]) {
      expect(body).toContain("Never say or imply that it is Kariz");
      expect(body).toContain("never say they are ongoing");
    }
    // the system's Latin spelling is unconfirmed: only the owner's own Persian word is used
    expect(journey.body).toContain("سایمپ");
    expect(k.map((e) => e.body).join("\n")).not.toMatch(/saymp|saimp/i);
  });
  it("leaves room for the largest entry beside the pinned ones in request triage", () => {
    const size = (e: (typeof k)[number]) => entryText(e).length + 2;
    const pinned = k.filter((e) => e.pinned).reduce((s, e) => s + size(e), 0);
    const largest = Math.max(...k.filter((e) => !e.pinned).map(size));
    expect(pinned + largest).toBeLessThanOrEqual(TRIAGE_KNOWLEDGE_BUDGET);
    expect(TRIAGE_KNOWLEDGE_BUDGET).toBeLessThanOrEqual(CHAT_KNOWLEDGE_BUDGET);
  });
  it("keeps pinned entries when the budget is tight", () => {
    const picked = selectKnowledge(k, "turbine SAM vision", 12000);
    expect(picked.some((e) => e.id === "contact")).toBe(true);
    expect(picked.some((e) => e.id === "project-turbine-vision")).toBe(true);
  });
  it("builds a grounded prompt", () => {
    const p = chatSystemPrompt(k);
    expect(p).toContain("<knowledge>");
    expect(p).toContain("Answer ONLY from the facts");
  });
});
