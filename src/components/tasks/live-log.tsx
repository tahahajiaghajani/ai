"use client";
import * as React from "react";
import {
  AlertTriangle,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ExternalLink,
  FileCode2,
  GitCommitHorizontal,
  ListChecks,
  MessageSquareText,
  PauseCircle,
  Search,
  Sparkles,
  SquareTerminal,
  UserRound,
  Workflow,
  XCircle,
} from "lucide-react";
import { useRealtimeRows, useNow } from "@/hooks/use-realtime";
import { formatTime, timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { TaskEvent } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = {
  system: "سیستم",
  user: "کاربر",
  gemini: "Gemini",
  claude: "Claude",
  github: "GitHub",
  graphify: "graphify",
  knowledge: "دانش",
};

function iconFor(e: TaskEvent) {
  const cls = "size-4";
  if (e.kind === "error") return <XCircle className={cn(cls, "text-danger")} />;
  if (e.kind === "warning") return e.title.startsWith("⏸") ? <PauseCircle className={cn(cls, "text-warning")} /> : <AlertTriangle className={cn(cls, "text-warning")} />;
  if (e.kind === "thought") return <Brain className={cn(cls, "text-violet-500")} />;
  if (e.kind === "search") return <Search className={cn(cls, "text-sky-500")} />;
  if (e.kind === "file") return <FileCode2 className={cn(cls, "text-emerald-500")} />;
  if (e.kind === "commit") return <GitCommitHorizontal className={cn(cls, "text-fg")} />;
  if (e.kind === "todo") return <ListChecks className={cn(cls, "text-orange-500")} />;
  if (e.kind === "result") return <CheckCircle2 className={cn(cls, "text-success")} />;
  if (e.kind === "message") return <MessageSquareText className={cn(cls, "text-orange-400")} />;
  if (e.kind === "node") return <Workflow className={cn(cls, "text-violet-500")} />;
  if (e.kind === "tool") return <SquareTerminal className={cn(cls, "text-orange-500")} />;
  if (e.kind === "status") return <CircleDot className={cn(cls, "text-primary")} />;
  if (e.source === "user") return <UserRound className={cn(cls, "text-muted")} />;
  if (e.source === "claude") return <Bot className={cn(cls, "text-orange-500")} />;
  if (e.source === "gemini") return <Sparkles className={cn(cls, "text-violet-500")} />;
  return <CircleDot className={cn(cls, "text-muted")} />;
}

const FILTERS = [
  { key: "all", label: "همه" },
  { key: "activity", label: "فعالیت‌ها" },
  { key: "thought", label: "افکار" },
  { key: "files", label: "فایل‌ها" },
  { key: "issues", label: "خطاها" },
] as const;

function matches(e: TaskEvent, f: (typeof FILTERS)[number]["key"]) {
  if (f === "all") return true;
  if (f === "activity") return ["tool", "node", "status", "result", "todo", "log", "search", "message"].includes(e.kind);
  if (f === "thought") return e.kind === "thought" || e.kind === "message";
  if (f === "files") return e.kind === "file" || e.kind === "commit";
  return e.kind === "error" || e.kind === "warning";
}

/**
 * Live activity log (like Claude Code's own "Ran a command / Created a file" stream).
 * Subscribes to new task_events rows via Supabase Realtime.
 */
export function LiveLog({
  initial,
  taskId,
  upgradeId,
  live,
  className,
  maxHeight = "60vh",
}: {
  initial: TaskEvent[];
  taskId?: string;
  upgradeId?: string;
  live?: boolean;
  className?: string;
  maxHeight?: string;
}) {
  useNow(20_000);
  const filter = taskId ? `task_id=eq.${taskId}` : upgradeId ? `upgrade_id=eq.${upgradeId}` : undefined;
  const [events] = useRealtimeRows<TaskEvent & Record<string, unknown>>("task_events", initial as (TaskEvent & Record<string, unknown>)[], {
    filter,
    insertOnly: true,
    sort: (a, b) => Number(a.id) - Number(b.id),
    limit: 600,
  });
  const [f, setF] = React.useState<(typeof FILTERS)[number]["key"]>("all");
  const [open, setOpen] = React.useState<Record<number, boolean>>({});
  const [follow, setFollow] = React.useState(true);
  const boxRef = React.useRef<HTMLDivElement>(null);

  const shown = events.filter((e) => matches(e, f));

  React.useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown.length, follow]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {live ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-300">
            <span className="live-dot" /> زنده
          </span>
        ) : null}
        <div className="flex gap-1 overflow-x-auto">
          {FILTERS.map((x) => (
            <button
              key={x.key}
              onClick={() => setF(x.key)}
              className={cn("rounded-full px-3 py-1 text-xs font-semibold transition", f === x.key ? "bg-primary text-white" : "bg-surface-muted text-muted hover:text-fg")}
            >
              {x.label}
            </button>
          ))}
        </div>
        <span className="ms-auto text-[11px] text-faint">{faNum(shown.length)} رویداد</span>
      </div>
      <div
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
        }}
        className="relative overflow-y-auto rounded-2xl border border-line bg-surface-strong/70 p-2"
        style={{ maxHeight }}
      >
        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">هنوز رویدادی ثبت نشده است</p>
        ) : (
          <ol className="relative space-y-0.5">
            {shown.map((e) => {
              const expandable = !!e.detail;
              const url = (e.data as { url?: string } | null)?.url;
              const isOpen = open[e.id];
              return (
                <li key={e.id} className="animate-float-in">
                  <div
                    className={cn(
                      "group flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition",
                      expandable && "cursor-pointer hover:bg-surface-muted",
                      e.kind === "error" && "bg-rose-500/5",
                      e.kind === "node" && "bg-violet-500/5",
                    )}
                    onClick={() => expandable && setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}
                  >
                    <span className="mt-0.5 shrink-0">{iconFor(e)}</span>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-[13px] leading-6", e.kind === "thought" ? "italic text-muted" : "text-fg", e.kind === "node" && "font-bold")} dir="auto">
                        {e.title}
                      </p>
                      <div className="flex items-center gap-2 text-[10.5px] text-faint">
                        <span>{SOURCE_LABEL[e.source] ?? e.source}</span>
                        <span>·</span>
                        <span title={timeAgo(e.created_at)}>{formatTime(e.created_at)}</span>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="inline-flex items-center gap-1 text-primary hover:underline">
                            مشاهده <ExternalLink className="size-3" />
                          </a>
                        ) : null}
                      </div>
                    </div>
                    {expandable ? <ChevronDown className={cn("mt-1 size-4 shrink-0 text-faint transition", isOpen && "rotate-180")} /> : null}
                  </div>
                  {expandable && isOpen ? (
                    <pre className="ltr mx-2 mb-2 mt-0.5 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-[color-mix(in_oklab,var(--bg)_75%,black_25%)] p-3 text-start font-mono text-[11.5px] leading-6 text-slate-200">
                      {e.detail}
                    </pre>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
