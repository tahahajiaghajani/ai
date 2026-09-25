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

describe("robust model output handling", () => {
  it("strips a leading task-code folder from generated paths", async () => {
    const { parseExecOutput } = await import("@/lib/agents/parse");
    const out = parseExecOutput(`<<<FILE path="T-0001/1.2/a.json" desc="x">>>\n{}\n<<<END FILE>>>`);
    expect(out.files[0].path).toBe("1.2/a.json");
    expect(out.files[0].wbs_id).toBe("1.2");
  });

  it("repairs truncated JSON from the model", async () => {
    const { extractJson } = await import("@/lib/utils");
    const data = extractJson<{ items: { title: string }[] }>('```json\n{"items":[{"title":"a"},{"title":"b"');
    expect(data.items.map((i) => i.title)).toEqual(["a", "b"]);
  });
});

describe("extractJson with code fences inside strings", () => {
  it("does not confuse ``` inside JSON string values with a wrapping fence", async () => {
    const { extractJson } = await import("@/lib/utils");
    const raw = JSON.stringify({ items: [{ title: "q", content: "```sql\nselect 1;\n```\nمتن" }] }, null, 2);
    expect(extractJson<{ items: { content: string }[] }>(raw).items[0].content).toContain("select 1;");
    expect(extractJson<{ a: number }>("```json\n{\"a\": 1}\n```").a).toBe(1);
  });
});
