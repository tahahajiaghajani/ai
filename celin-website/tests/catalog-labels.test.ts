import { describe, expect, it } from "vitest";
import { slugify as clientSlugify, SLUG_RE, STONE_LABEL, METAL_LABEL } from "@/components/admin/catalog-labels";
import { slugify as serverSlugify } from "@/lib/admin-catalog";
import { METALS, STONES } from "@/lib/catalog-types";

describe("admin catalogue helpers", () => {
  it("builds the same slug in the editor as on the server", () => {
    for (const s of ["Darya Ring", "  Mehr — Sunray ring  ", "Café pavé", "انگشتر دریا", "A--B__c", "Ring 2026"]) {
      expect(clientSlugify(s)).toBe(serverSlugify(s));
    }
    expect(clientSlugify("Darya Cushion Ring")).toBe("darya-cushion-ring");
    expect(SLUG_RE.test(clientSlugify("Café pavé"))).toBe(true);
    expect(SLUG_RE.test("Darya")).toBe(false);
  });

  it("has a Persian label for every metal and stone", () => {
    for (const m of METALS) expect(METAL_LABEL[m]).toBeTruthy();
    for (const s of STONES) expect(STONE_LABEL[s]).toBeTruthy();
  });
});
