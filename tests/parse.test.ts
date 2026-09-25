import { describe, expect, it } from "vitest";
import { parseExecOutput, pickExecutionItems, renderWbsMarkdown, safeRelPath, splitByItemHeadings, type WbsItem } from "@/lib/agents/parse";

describe("prework parsers", () => {
  it("extracts FILE blocks and the remaining report", () => {
    const text = `مقدمه\n<<<FILE path="2.1/schema.sql" desc="جدول‌ها">>>\ncreate table a(id int);\n<<<END FILE>>>\n### گزارش [2.1]\nانجام شد`;
    const out = parseExecOutput(text);
    expect(out.files).toHaveLength(1);
    expect(out.files[0]).toMatchObject({ path: "2.1/schema.sql", desc: "جدول‌ها", wbs_id: "2.1" });
    expect(out.files[0].content).toBe("create table a(id int);\n");
    expect(out.report).toContain("### گزارش [2.1]");
  });

  it("sanitizes dangerous paths", () => {
    expect(safeRelPath("../../etc/passwd")).toBe("etc/passwd");
    expect(safeRelPath("/abs\\win\\file.txt")).toBe("abs/win/file.txt");
  });

  it("splits methods by item headings", () => {
    const md = "### [1.1] الف\nمتن ۱\n### [1.2] ب\nمتن ۲";
    const map = splitByItemHeadings(md);
    expect(Object.keys(map)).toEqual(["1.1", "1.2"]);
    expect(map["1.2"]).toContain("متن ۲");
  });

  it("orders execution items by complexity and renders WBS", () => {
    const items: WbsItem[] = [
      { id: "1.1", title: "a", description: "", complexity: "complex", type: "build", deliverable: "x", phase: "1" },
      { id: "1.2", title: "b", description: "", complexity: "simple", type: "doc", deliverable: "y", phase: "1" },
    ];
    expect(pickExecutionItems(items, 5).map((i) => i.id)).toEqual(["1.2", "1.1"]);
    const md = renderWbsMarkdown("خلاصه", [{ id: "1", title: "فاز", goal: "هدف" }], items);
    expect(md).toContain("| 1.2 |");
    expect(md).toContain("تعداد فعالیت‌ها: 2");
  });
});
