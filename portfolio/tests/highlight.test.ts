import { describe, expect, it } from "vitest";
import { highlight } from "@/lib/highlight";

describe("highlight", () => {
  it("escapes HTML in code and strings", () => {
    const out = highlight('const a = "<script>alert(1)</script>"; // <b>', "ts");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain('class="t-k">const');
  });
  it("keeps one span per line for multi-line tokens", () => {
    const out = highlight('x = """a\nb"""', "python");
    for (const line of out.split("\n")) {
      expect((line.match(/<span/g) ?? []).length).toBe((line.match(/<\/span>/g) ?? []).length);
    }
  });
});
