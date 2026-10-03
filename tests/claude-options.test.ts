import { describe, expect, it } from "vitest";
import { claudeRunOptions, mainPrompt } from "@/lib/claude/spec";
import { pickClaudeOptions } from "@/lib/tasks/service";
import { pickFlashModels } from "@/lib/ai/llm/google";
import { DEFAULT_USER_CONFIG, type UserConfig } from "@/lib/settings";

const cfg = { ...DEFAULT_USER_CONFIG, claude: { ...DEFAULT_USER_CONFIG.claude, model: "opus", effort: "high", thinking: "on" } } as UserConfig;

describe("Claude run options", () => {
  it("falls back to Settings, but an explicit per-send value (even empty) wins", () => {
    expect(claudeRunOptions(cfg, undefined)).toEqual({ model: "opus", effort: "high", thinking: "on" });
    expect(claudeRunOptions(cfg, { model: "", effort: "low", thinking: "auto" })).toEqual({ model: "", effort: "low", thinking: "auto" });
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

describe("main prompt (Claude Code)", () => {
  it("starts with the user's prompt only (no task title or description) and points at the project", () => {
    const text = mainPrompt({
      prompt: "در فایل audit.cs متد Save باگ دارد؛ درستش کن",
      step: "",
      project: { name: "Renew", root: "projects/renew" },
      selected: ["src/Audit.cs"],
      finalDir: "tasks/T-0007_x/final",
      brief: "tasks/T-0007_x/runs/01-prework/BRIEF.md",
      helpers: [],
      inputs: ["tasks/T-0007_x/runs/02-main/inputs/log.txt"],
      resumed: false,
    });
    expect(text.startsWith("# درخواست\n\nدر فایل audit.cs متد Save باگ دارد؛ درستش کن")).toBe(true);
    expect(text).toContain("projects/renew/.taskflow/KNOWLEDGE.md");
    expect(text).toContain("`projects/renew/src/Audit.cs`");
    expect(text).toContain("runs/01-prework/BRIEF.md");
    expect(text).toContain("inputs/log.txt");
    expect(text).not.toContain("T-0007_x/final/");
  });

  it("without a project asks for complete files in the task's final folder", () => {
    const text = mainPrompt({ prompt: "یک گزارش بساز", step: "", project: null, selected: [], finalDir: "tasks/T-1_x/final", brief: null, helpers: [], inputs: [], resumed: false });
    expect(text).toContain("tasks/T-1_x/final/");
    expect(text).toContain("(موردی نیست)");
  });
});
