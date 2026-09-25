import { describe, expect, it } from "vitest";
import { helperFileName, isDeliverablePath, safeRelPath, stripCodeFence } from "@/lib/agents/parse";

describe("path helpers", () => {
  it("sanitizes dangerous paths", () => {
    expect(safeRelPath("../../etc/passwd")).toBe("etc/passwd");
    expect(safeRelPath("/abs\\win\\file.txt")).toBe("abs/win/file.txt");
  });

  it("keeps helper files flat with an extension", () => {
    expect(helperFileName("config/field map.json", 0)).toBe("field-map.json");
    expect(helperFileName("../نگاشت فیلدها", 1)).toBe("نگاشت-فیلدها.md");
    expect(helperFileName("", 2)).toBe("output.txt");
  });

  it("strips a fence wrapping the whole file only", () => {
    expect(stripCodeFence("```json\n{\"a\":1}\n```")).toBe('{"a":1}\n');
    expect(stripCodeFence("# عنوان\n```js\nx()\n```\nمتن")).toBe("# عنوان\n```js\nx()\n```\nمتن\n");
  });

  it("separates deliverables from bookkeeping files", () => {
    const t = "tasks/T-0001_گزارش";
    expect(isDeliverablePath(t, `${t}/final/report.html`)).toBe(true);
    expect(isDeliverablePath(t, `${t}/dashboard.html`)).toBe(true);
    for (const p of [
      `${t}/.claude-session/x.jsonl`,
      `${t}/graphify-out/graph.json`,
      `${t}/manifest.json`,
      `${t}/README.md`,
      `${t}/iterations/01_x/prework/BRIEF.md`,
      "knowledge/lesson/a.md",
      "tasks/T-0002_other/final/a.html",
    ]) {
      expect(isDeliverablePath(t, p)).toBe(false);
    }
  });
});

describe("robust model output handling", () => {
  it("repairs truncated JSON from the model", async () => {
    const { extractJson } = await import("@/lib/utils");
    const data = extractJson<{ items: { title: string }[] }>('```json\n{"items":[{"title":"a"},{"title":"b"');
    expect(data.items.map((i) => i.title)).toEqual(["a", "b"]);
  });

  it("does not confuse ``` inside JSON string values with a wrapping fence", async () => {
    const { extractJson } = await import("@/lib/utils");
    const raw = JSON.stringify({ items: [{ title: "q", content: "```sql\nselect 1;\n```\nمتن" }] }, null, 2);
    expect(extractJson<{ items: { content: string }[] }>(raw).items[0].content).toContain("select 1;");
    expect(extractJson<{ a: number }>("```json\n{\"a\": 1}\n```").a).toBe(1);
  });
});
