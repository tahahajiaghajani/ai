import { describe, expect, it } from "vitest";
import { claudeRunOptions, mainPrompt } from "@/lib/claude/spec";
import { pickClaudeOptions } from "@/lib/tasks/service";
import { pickFlashModels } from "@/lib/ai/gemini";
import type { AppSettings } from "@/lib/settings";
import type { Task } from "@/lib/types";

const settings = { claude: { model: "opus", effort: "high", thinking: "on" } } as unknown as AppSettings;

describe("Claude run options", () => {
  it("falls back to Settings, but an explicit per-send value (even empty) wins", () => {
    expect(claudeRunOptions(settings, undefined)).toEqual({ model: "opus", effort: "high", thinking: "on" });
    expect(claudeRunOptions(settings, { model: "", effort: "low", thinking: "auto" })).toEqual({ model: "", effort: "low", thinking: "auto" });
  });

  it("keeps only valid choices from the client", () => {
    expect(pickClaudeOptions({ model: "sonnet", effort: "max", thinking: "off" })).toEqual({ model: "sonnet", effort: "max", thinking: "off" });
    expect(pickClaudeOptions({ model: "opus; rm -rf /", effort: "extreme" as never, thinking: "maybe" as never })).toBeNull();
    expect(pickClaudeOptions({ model: "claude-opus-5-5[1m]" })).toEqual({ model: "claude-opus-5-5[1m]" });
    expect(pickClaudeOptions(undefined)).toBeNull();
  });
});

describe("Gemini auto model", () => {
  it("orders free Flash models newest first and ignores previews and other families", () => {
    const { flash, lite } = pickFlashModels([
      "models/gemini-3.5-flash",
      "models/gemini-3.8-flash",
      "models/gemini-3.6-flash",
      "models/gemini-3.8-flash-preview-09-2026",
      "models/gemini-3.8-pro",
      "models/gemini-flash-latest",
      "models/gemini-3.6-flash-lite",
      "models/gemini-3.5-flash-lite",
      "models/gemini-10.0-flash",
    ]);
    expect(flash).toEqual(["gemini-10.0-flash", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash"]);
    expect(lite).toEqual(["gemini-3.6-flash-lite", "gemini-3.5-flash-lite"]);
  });
});

describe("main prompt", () => {
  const task = {
    id: "t1",
    code: "T-0007",
    title: "داشبورد گزارش مدیران پروژه",
    description: "هشت شاخص",
    priority: "medium",
    kind: "task",
    start_date: null,
    end_date: null,
    parent_id: null,
    relation_type: null,
  } as unknown as Task;

  it("puts the admin's request first and lists the brief and exact attachment paths", () => {
    const text = mainPrompt({
      adminPrompt: "یک فایل HTML کامل از کل داشبورد بساز",
      task,
      root: task,
      requester: null,
      rootPath: "tasks/T-0007_x",
      iterPath: "tasks/T-0007_x/iterations/01_T-0007",
      followup: false,
      resumed: false,
      materials: {
        brief: "tasks/T-0007_x/iterations/01_T-0007/prework/BRIEF.md",
        helpers: [],
        inputs: [{ path: "tasks/T-0007_x/iterations/01_T-0007/inputs/request/امتیازات.html", name: "امتیازات.html", current: false }],
        hasContext: false,
      },
    });
    expect(text.startsWith("# درخواست\n\nیک فایل HTML کامل از کل داشبورد بساز")).toBe(true);
    expect(text).toContain("prework/BRIEF.md");
    expect(text).toContain("inputs/request/امتیازات.html");
    expect(text).toContain("tasks/T-0007_x/final/");
    expect(text).not.toMatch(/EXPLANATION|CHANGELOG|FILES\.md/);
  });
});
