import { describe, expect, it } from "vitest";
import { siteKnowledge } from "@/lib/knowledge";
import { selectKnowledge } from "@/lib/retrieval";
import { PROJECTS } from "@/content/projects";
import { chatSystemPrompt } from "@/lib/assistant";

describe("assistant knowledge", () => {
  const k = siteKnowledge();
  it("covers every project and pins identity and contact", () => {
    for (const p of PROJECTS) expect(k.some((e) => e.id === `project-${p.slug}` && e.body.includes(`[[work:${p.slug}]]`))).toBe(true);
    expect(k.find((e) => e.id === "contact")?.pinned).toBe(true);
    expect(k.find((e) => e.id === "profile")?.pinned).toBe(true);
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
