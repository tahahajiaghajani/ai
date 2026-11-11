import { describe, expect, it } from "vitest";
import { siteKnowledge } from "@/lib/knowledge";
import { selectKnowledge } from "@/lib/retrieval";
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
