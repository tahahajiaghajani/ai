import type { EventKind, TodoItem } from "@/lib/types";

/** Minimal shapes of Claude Code `--output-format stream-json` events. */
interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
  tool_use_id?: string;
}

export interface ClaudeStreamEvent {
  type: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  message?: { content?: ContentBlock[] | string; model?: string };
  result?: string;
  is_error?: boolean;
  num_turns?: number;
  duration_ms?: number;
  total_cost_usd?: number;
  [k: string]: unknown;
}

export interface MappedLog {
  kind: EventKind;
  title: string;
  detail?: string | null;
  data?: Record<string, unknown>;
}

export interface Mapped {
  logs: MappedLog[];
  todos?: TodoItem[];
  sessionId?: string;
  model?: string;
  result?: { isError: boolean; text: string; subtype?: string; turns?: number; durationMs?: number; costUsd?: number };
}

const REPO_ROOT_RE = /\/home\/runner\/work\/[^/\s]+\/[^/\s]+\//g;

export function relPath(p: unknown): string {
  return String(p ?? "").replace(REPO_ROOT_RE, "");
}

function clip(s: unknown, n: number): string {
  const str = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return str.length > n ? `${str.slice(0, n)}…` : str;
}

function firstLine(s: string, n = 140) {
  const line = s.trim().split("\n").find((l) => l.trim()) ?? "";
  return clip(line.replace(/^#+\s*/, ""), n);
}

/** Persian log line for a tool call, mirroring Claude Code's own activity log. */
export function describeTool(name: string, input: Record<string, unknown> = {}): { title: string; detail?: string } {
  const path = relPath(input.file_path ?? input.path ?? input.notebook_path);
  switch (name) {
    case "Bash":
      return { title: `اجرای دستور: ${firstLine(String(input.command ?? ""), 110)}`, detail: [input.description, input.command].filter(Boolean).map(String).join("\n") };
    case "Write":
      return { title: `ایجاد فایل ${path}`, detail: clip(input.content, 1500) };
    case "Edit":
    case "MultiEdit":
      return { title: `ویرایش فایل ${path}`, detail: input.new_string ? clip(input.new_string, 1200) : undefined };
    case "Read":
      return { title: `خواندن فایل ${path}` };
    case "Glob":
      return { title: `جستجوی فایل‌ها: ${clip(input.pattern, 80)}` };
    case "Grep":
      return { title: `جستجو در محتوا: ${clip(input.pattern, 80)}`, detail: input.path ? relPath(input.path) : undefined };
    case "LS":
      return { title: `فهرست پوشه ${path || relPath(input.path)}` };
    case "WebSearch":
      return { title: `جستجوی وب: ${clip(input.query, 100)}` };
    case "WebFetch":
      return { title: `دریافت صفحه: ${clip(input.url, 100)}` };
    case "TodoWrite":
      return { title: "به‌روزرسانی فهرست کارها" };
    case "Task":
    case "Agent":
      return { title: `اجرای زیرعامل: ${clip(input.description ?? input.subagent_type, 90)}`, detail: clip(input.prompt, 800) };
    case "NotebookEdit":
      return { title: `ویرایش نوت‌بوک ${path}` };
    case "Skill":
      return { title: `استفاده از مهارت ${clip(input.skill ?? input.name, 60)}` };
    default:
      return { title: `ابزار ${name}`, detail: clip(input, 600) };
  }
}

export function mapClaudeEvent(ev: ClaudeStreamEvent): Mapped {
  const out: Mapped = { logs: [] };
  if (ev.session_id) out.sessionId = ev.session_id;

  if (ev.type === "system") {
    if (ev.subtype === "init") {
      out.model = String(ev.model ?? "");
      out.logs.push({ kind: "log", title: `Claude Code شروع به کار کرد${ev.model ? ` (مدل ${ev.model})` : ""}`, data: { session_id: ev.session_id } });
    } else if (ev.subtype === "compact_boundary") {
      out.logs.push({ kind: "log", title: "فشرده‌سازی خودکار کانتکست" });
    } else if (ev.subtype && /retry|error|limit/i.test(ev.subtype)) {
      out.logs.push({ kind: "warning", title: `رویداد سیستمی: ${ev.subtype}`, detail: clip(ev, 800) });
    }
    return out;
  }

  if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
    for (const block of ev.message!.content as ContentBlock[]) {
      if (block.type === "text" && block.text?.trim()) {
        out.logs.push({ kind: "message", title: firstLine(block.text), detail: clip(block.text, 4000) });
      } else if (block.type === "thinking" && block.thinking?.trim()) {
        out.logs.push({ kind: "thought", title: firstLine(block.thinking, 120), detail: clip(block.thinking, 1500) });
      } else if (block.type === "tool_use" && block.name) {
        if (block.name === "TodoWrite" && Array.isArray(block.input?.todos)) {
          out.todos = (block.input!.todos as TodoItem[]).map((t) => ({ content: String(t.content), status: t.status, activeForm: t.activeForm }));
          const done = out.todos.filter((t) => t.status === "completed").length;
          const active = out.todos.find((t) => t.status === "in_progress");
          out.logs.push({
            kind: "todo",
            title: `فهرست کارها: ${done} از ${out.todos.length} انجام شد${active ? ` — ${clip(active.activeForm ?? active.content, 80)}` : ""}`,
            data: { todos: out.todos },
          });
        } else {
          const d = describeTool(block.name, block.input ?? {});
          out.logs.push({ kind: block.name === "Write" || block.name === "Edit" || block.name === "MultiEdit" ? "file" : "tool", title: d.title, detail: d.detail ?? null, data: { tool: block.name } });
        }
      }
    }
    return out;
  }

  if (ev.type === "user" && Array.isArray(ev.message?.content)) {
    for (const block of ev.message!.content as ContentBlock[]) {
      if (block.type === "tool_result" && block.is_error) {
        out.logs.push({ kind: "error", title: "خطا در اجرای ابزار", detail: clip(block.content, 1500) });
      }
    }
    return out;
  }

  if (ev.type === "result") {
    const text = String(ev.result ?? "");
    out.result = {
      isError: !!ev.is_error || (ev.subtype !== undefined && ev.subtype !== "success"),
      text,
      subtype: ev.subtype,
      turns: ev.num_turns,
      durationMs: ev.duration_ms,
      costUsd: ev.total_cost_usd,
    };
    out.logs.push({
      kind: out.result.isError ? "error" : "result",
      title: out.result.isError ? `Claude با خطا متوقف شد: ${firstLine(text, 120)}` : "Claude کار را تمام کرد",
      detail: clip(text, 6000),
      data: { turns: ev.num_turns, duration_ms: ev.duration_ms },
    });
  }
  return out;
}
