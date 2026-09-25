import { describe, expect, it } from "vitest";
import { mapClaudeEvent } from "@/lib/claude/events";

describe("mapClaudeEvent", () => {
  it("maps tool calls to Persian activity lines with repo-relative paths", () => {
    const m = mapClaudeEvent({
      type: "assistant",
      session_id: "s1",
      message: {
        content: [
          { type: "tool_use", name: "Bash", input: { command: "npm test", description: "run tests" } },
          { type: "tool_use", name: "Write", input: { file_path: "/home/runner/work/ws/ws/tasks/T-1/final/a.md", content: "x" } },
        ],
      },
    });
    expect(m.sessionId).toBe("s1");
    expect(m.logs[0].title).toBe("اجرای دستور: npm test");
    expect(m.logs[1].title).toBe("ایجاد فایل tasks/T-1/final/a.md");
    expect(m.logs[1].kind).toBe("file");
  });

  it("extracts the live todo list", () => {
    const m = mapClaudeEvent({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "TodoWrite", input: { todos: [{ content: "a", status: "completed" }, { content: "b", status: "in_progress", activeForm: "doing b" }] } }] },
    });
    expect(m.todos).toHaveLength(2);
    expect(m.logs[0].title).toContain("1 از 2");
  });

  it("maps the final result", () => {
    const m = mapClaudeEvent({ type: "result", subtype: "success", is_error: false, result: "done", num_turns: 3 });
    expect(m.result?.isError).toBe(false);
    expect(m.logs[0].kind).toBe("result");
  });
});
