// Library fields with the same label (the owner's click-through of 1.1.5: the form designer's palette showed the demo
// pack's «واحد مجری» and the owner's own «واحد مجری» as the same entry twice — «واحد مجری · واحد سازمانی» — and only
// typing the technical name told them apart; picking the pack's tied a real form to a field the purge removes). Where
// fields are picked, a field whose label another library field in use carries shows its technical name; «فیلد تازه»
// warns, and saves all the same, when its label is one a library field in use already carries
// (src/ui/modules/workflows/admin/fields/labels.ts; the palette in forms/ProcessDesigner.tsx, the warning in
// fields/FieldSheet.tsx).
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SameLabel } from "../src/ui/modules/workflows/admin/fields/FieldSheet";
import { labelKey, sameLabelFields, sharedLabels } from "../src/ui/modules/workflows/admin/fields/labels";
import { paletteFields } from "../src/ui/modules/workflows/admin/forms/model";
import type { LibraryEntry } from "../src/ui/modules/workflows/admin/fields/api";

const lib = (p: Partial<LibraryEntry> & { name: string; label: string }): LibraryEntry => ({
  id: p.name, type: "string", type_label: "متن کوتاه", storage: "string", group: "text", field_group: null, status: "active", help: null, placeholder: null,
  usage: { tables: [], forms: [], versions: [] }, ...p,
});
const empty = { tabs: [{ label: "فرم", sections: [{ label: null, items: [] }] }] };

describe("library fields with the same label", () => {
  // the e2e's library: the owner's fields and the pack's, two labels each twice
  const all = [
    lib({ name: "u_a_unit", label: "واحد مجری", type_label: "واحد سازمانی" }),
    lib({ name: "u_aftab_prj_unit", label: "واحد مجری", type_label: "واحد سازمانی" }),
    lib({ name: "u_a_note", label: "نظر مدیر گروه", type_label: "متن بلند" }),
    lib({ name: "u_aftab_prj_review", label: "نظر  مدير گروه", type_label: "متن بلند" }),
    lib({ name: "u_amount", label: "مبلغ" }),
    lib({ name: "u_old_unit", label: "واحد قدیمی", status: "retired" }),
    lib({ name: "u_old_amount", label: "مبلغ", status: "retired" }),
  ];

  it("the palette's twins show their technical names: the same label as people read it, retired fields aside", () => {
    const twins = sharedLabels(all);
    const offered = paletteFields(all, empty, "واحد مجری");
    expect(offered.map((e) => e.name).sort()).toEqual(["u_a_unit", "u_aftab_prj_unit"]);
    // both entries of «واحد مجری» carry their names; so do both of «نظر مدیر گروه» (ي and a double space are the same label)
    expect(offered.every((e) => twins.has(labelKey(e.label)))).toBe(true);
    expect(twins.has(labelKey("نظر مدیر گروه"))).toBe(true);
    // a label only one field in use carries shows none (a retired «مبلغ» is not offered anywhere)
    expect(twins.has(labelKey("مبلغ"))).toBe(false);
    expect(twins.has(labelKey("واحد قدیمی"))).toBe(false);
    expect(twins.size).toBe(2);
    // one twin already on the form: the other still says which it is
    const onForm = { tabs: [{ label: "فرم", sections: [{ label: null, items: [{ field: "u_a_unit" }] }] }] };
    expect(paletteFields(all, onForm, "").filter((e) => twins.has(labelKey(e.label))).map((e) => e.name).sort()).toEqual(["u_a_note", "u_aftab_prj_review", "u_aftab_prj_unit"]);
  });

  it("«فیلد تازه» with a label a library field already carries: the fields to warn about, never a refusal", () => {
    // a new field (no id yet) named like the pack's and the owner's
    expect(sameLabelFields(all, " واحد  مجری ").map((e) => e.name)).toEqual(["u_a_unit", "u_aftab_prj_unit"]);
    // the field's own label is no twin of itself
    expect(sameLabelFields(all, "واحد مجری", "u_a_unit").map((e) => e.name)).toEqual(["u_aftab_prj_unit"]);
    // nothing to say: a label of its own, a retired field's label, an empty label
    expect(sameLabelFields(all, "شمارهٔ قرارداد")).toEqual([]);
    expect(sameLabelFields(all, "واحد قدیمی")).toEqual([]);
    expect(sameLabelFields(all, "  ")).toEqual([]);
  });

  it("the warning names the other fields by their technical names, each a Latin isolate, as a status (not an error)", () => {
    const one = renderToStaticMarkup(createElement(SameLabel, { twins: sameLabelFields(all, "واحد مجری", "u_a_unit") }));
    expect(one).toContain('role="status"');
    expect(one).toContain('<bdi class="ds-id">u_aftab_prj_unit</bdi>');
    expect(one).toContain("همین برچسب را فیلد");
    expect(one).toContain("ذخیره می‌شود");
    expect(one).not.toContain("rk-err");
    const two = renderToStaticMarkup(createElement(SameLabel, { twins: sameLabelFields(all, "واحد مجری") }));
    expect(two).toContain("همین برچسب را فیلدهای");
    expect(two).toContain('<bdi class="ds-id">u_a_unit</bdi>');
    expect(two).toContain('<bdi class="ds-id">u_aftab_prj_unit</bdi>');
    // the separator stays outside the Latin isolates
    expect(two).toMatch(/،\s*<bdi class="ds-id">u_aftab_prj_unit<\/bdi>/);
  });
});
