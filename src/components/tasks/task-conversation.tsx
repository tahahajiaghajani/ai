"use client";
import * as React from "react";
import { toast } from "sonner";
import { Bot, Download, Eye, FileText, MessagesSquare, Paperclip, Sparkles, ThumbsDown, ThumbsUp, User } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Badge, Button, Spinner } from "@/components/ui/primitives";
import { Markdown } from "@/components/ui/markdown";
import { feedbackAction } from "@/app/actions/tasks";
import { PREWORK_NODES } from "@/lib/status";
import { formatJalali } from "@/lib/jalali";
import { cn, faNum, formatBytes } from "@/lib/utils";
import type { Job, TaskFile } from "@/lib/types";

type ConvJob = Pick<Job, "id" | "kind" | "status" | "state" | "payload" | "result" | "error" | "created_at" | "finished_at" | "external_url">;
type ConvMessage = { id: number; job_id: string | null; agent: string; content: string; created_at: string };

interface Turn {
  job: ConvJob;
  prompt: string;
  customPrompt: boolean;
  inputs: TaskFile[];
  reply: string | null;
  brief: string | null;
  outputs: TaskFile[];
}

/** Files a browser can show directly; everything else is download-only. */
const VIEWABLE = /\.(html?|md|txt|json|csv|css|js|ts|tsx|sql|xml|ya?ml|svg|png|jpe?g|gif|webp|pdf)$/i;

function buildTurns(jobs: ConvJob[], files: TaskFile[], messages: ConvMessage[]): Turn[] {
  const latest = (jobId: string, agents: string[]) => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.job_id === jobId && agents.includes(m.agent)) return m.content;
    }
    return null;
  };
  return jobs.map((job) => {
    const own = files.filter((f) => f.job_id === job.id);
    const userPrompt = typeof job.payload?.user_prompt === "string" ? job.payload.user_prompt : null;
    const sent = String(job.payload?.prompt ?? "");
    const summary = typeof job.result?.summary === "string" ? job.result.summary : null;
    return {
      job,
      prompt: userPrompt?.trim() ? userPrompt : sent,
      // Jobs from before `user_prompt` existed only carry the final prompt: treat it as the admin's own.
      customPrompt: userPrompt === null ? true : !!userPrompt.trim(),
      inputs: own.filter((f) => f.context !== "output"),
      reply: latest(job.id, ["reply"]) ?? (job.kind === "prework" ? latest(job.id, ["report"]) : summary),
      brief: job.kind === "prework" ? latest(job.id, ["brief"]) : null,
      // BRIEF first, then the rest by name
      outputs: own.filter((f) => f.context === "output").sort((a, b) => Number(/BRIEF\.md$/.test(b.github_path ?? "")) - Number(/BRIEF\.md$/.test(a.github_path ?? "")) || a.name.localeCompare(b.name)),
    };
  });
}

function FileChip({ file, output }: { file: TaskFile; output?: boolean }) {
  const viewable = VIEWABLE.test(file.github_path ?? file.name) || (file.mime ?? "").startsWith("image/") || file.mime === "application/pdf";
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs", output ? "border-line bg-surface-strong" : "border-line/70 bg-surface-muted/60")}>
      <FileText className={cn("size-4 shrink-0", output ? "text-primary" : "text-muted")} />
      <span className="min-w-0 flex-1 truncate font-semibold" dir="auto" title={file.name}>
        {file.name}
      </span>
      {file.size ? <span className="shrink-0 text-faint">{formatBytes(file.size)}</span> : null}
      {viewable ? (
        <a href={`/api/files/${file.id}?inline=1`} target="_blank" rel="noreferrer" title="مشاهده" className="rounded-lg p-1.5 text-muted transition hover:bg-surface-muted hover:text-fg">
          <Eye className="size-3.5" />
        </a>
      ) : null}
      <a href={`/api/files/${file.id}`} title="دانلود" className="rounded-lg p-1.5 text-muted transition hover:bg-surface-muted hover:text-fg">
        <Download className="size-3.5" />
      </a>
    </div>
  );
}

function Rate({ taskId, jobId, agent }: { taskId: string; jobId: string; agent: string }) {
  const [sent, setSent] = React.useState<number | null>(null);
  const send = async (rating: -1 | 1) => {
    const comment = rating < 0 ? window.prompt("چه چیزی ضعیف بود؟ (برای یادگیری سیستم؛ اختیاری)") ?? "" : "";
    const r = await feedbackAction({ task_id: taskId, job_id: jobId, agent, rating, comment });
    if (r.ok) {
      setSent(rating);
      toast.success("بازخورد ثبت شد");
    } else toast.error(r.error);
  };
  return (
    <span className="flex items-center gap-0.5">
      <button type="button" onClick={() => void send(1)} title="خوب بود" className={cn("rounded-lg p-1.5 text-muted transition hover:bg-surface-muted", sent === 1 && "text-success")}>
        <ThumbsUp className="size-3.5" />
      </button>
      <button type="button" onClick={() => void send(-1)} title="ضعیف بود" className={cn("rounded-lg p-1.5 text-muted transition hover:bg-surface-muted", sent === -1 && "text-danger")}>
        <ThumbsDown className="size-3.5" />
      </button>
    </span>
  );
}

function progressText(job: ConvJob): string {
  if (job.status === "queued") return "در صف اجرا…";
  if (job.kind === "prework") {
    const running = Object.entries(job.state?.nodes ?? {}).find(([, n]) => n.status === "running")?.[0];
    const label = PREWORK_NODES.find((n) => n.key === running)?.label;
    return label ? `${label}…` : "در حال کار…";
  }
  const todo = job.state?.todos?.find((t) => t.status === "in_progress");
  return todo ? `${todo.activeForm ?? todo.content}…` : "Claude در حال کار است…";
}

function AiTurn({ turn, taskId }: { turn: Turn; taskId: string }) {
  const { job } = turn;
  const gemini = job.kind === "prework";
  const Icon = gemini ? Sparkles : Bot;
  const models = Array.isArray(job.result?.models) ? (job.result.models as string[]).filter(Boolean) : [];
  const claude = (job.payload?.claude ?? {}) as { model?: string; effort?: string };
  const meta = gemini ? models.slice(0, 2).join("، ") : [claude.model, claude.effort && `effort ${claude.effort}`].filter(Boolean).join(" · ");
  const busy = job.status === "queued" || job.status === "running";
  return (
    <div className="flex gap-3">
      <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", gemini ? "bg-violet-500/12 text-violet-600 dark:text-violet-300" : "bg-orange-500/12 text-orange-600 dark:text-orange-300")}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <b className="text-fg">{gemini ? "Gemini · پیش‌کار" : "Claude · کار اصلی"}</b>
          {meta ? <span className="ltr">{meta}</span> : null}
          {job.finished_at ? <span>{formatJalali(job.finished_at, { withTime: true })}</span> : null}
        </p>

        {busy ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" /> {progressText(job)}
          </p>
        ) : null}
        {job.status === "failed" ? <p className="mt-2 rounded-xl bg-rose-500/8 px-3 py-2 text-sm text-danger">اجرا ناموفق بود{job.error ? `: ${job.error}` : ""}</p> : null}
        {job.status === "cancelled" ? <p className="mt-2 text-sm text-muted">این اجرا لغو شد.</p> : null}

        {turn.reply ? <Markdown className="mt-2 text-sm">{turn.reply}</Markdown> : job.status === "done" && !turn.outputs.length ? <p className="mt-2 text-sm text-muted">پاسخ متنی ثبت نشده است.</p> : null}

        {turn.outputs.length ? (
          <div className="mt-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-muted">
              <Paperclip className="size-3.5" /> فایل‌های خروجی ({faNum(turn.outputs.length)})
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {turn.outputs.map((f) => (
                <FileChip key={f.id} file={f} output />
              ))}
            </div>
          </div>
        ) : null}

        {turn.brief ? (
          <details className="mt-3 rounded-xl border border-line px-3 py-2">
            <summary className="cursor-pointer text-xs font-bold text-muted">نمایش کامل دستور کار</summary>
            <Markdown className="mt-2 text-sm">{turn.brief}</Markdown>
          </details>
        ) : null}

        {job.status === "done" ? (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            <Rate taskId={taskId} jobId={job.id} agent={gemini ? "plan" : "claude"} />
            {job.external_url ? (
              <a href={job.external_url} target="_blank" rel="noreferrer" className="font-semibold text-primary">
                اجرای GitHub
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UserTurn({ turn }: { turn: Turn }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[88%] rounded-2xl rounded-se-md bg-primary-soft px-4 py-3">
        <p className="mb-1 flex items-center gap-2 text-xs text-muted">
          <b className="text-fg">{turn.job.kind === "prework" ? "به Gemini" : turn.job.payload?.followup ? "پیام تکمیلی به Claude" : "به Claude"}</b>
          <span>{formatJalali(turn.job.created_at, { withTime: true })}</span>
          {!turn.customPrompt ? <Badge>پرامپت پیش‌فرض</Badge> : null}
        </p>
        {turn.prompt ? <p className="whitespace-pre-line text-sm leading-7" dir="auto">{turn.prompt}</p> : null}
        {turn.inputs.length ? (
          <div className="mt-2 grid gap-1.5">
            {turn.inputs.map((f) => (
              <FileChip key={f.id} file={f} />
            ))}
          </div>
        ) : null}
      </div>
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-muted">
        <User className="size-4" />
      </span>
    </div>
  );
}

/**
 * The task as a chat: every send to Gemini (pre-work) or Claude (main work) is a user turn with
 * its prompt and attachments, followed by the AI's text answer and the files it produced.
 * Bookkeeping files (manifest, sessions, graph) stay out; only deliverables are listed.
 */
export function TaskConversation({ taskId, className, empty }: { taskId: string; className?: string; empty?: React.ReactNode }) {
  const [turns, setTurns] = React.useState<Turn[] | null>(null);

  const load = React.useCallback(async () => {
    const sb = supabaseBrowser();
    const { data: jobs } = await sb
      .from("jobs")
      .select("id, kind, status, state, payload, result, error, created_at, finished_at, external_url")
      .eq("task_id", taskId)
      .in("kind", ["prework", "main"])
      .order("created_at");
    const list = (jobs ?? []) as ConvJob[];
    if (!list.length) {
      setTurns([]);
      return;
    }
    const ids = list.map((j) => j.id);
    const [files, messages] = await Promise.all([
      sb.from("task_files").select("*").eq("task_id", taskId).in("job_id", ids).order("created_at"),
      sb.from("ai_messages").select("id, job_id, agent, content, created_at").eq("task_id", taskId).in("job_id", ids).in("agent", ["reply", "brief", "report"]).order("id"),
    ]);
    setTurns(buildTurns(list, (files.data ?? []) as TaskFile[], (messages.data ?? []) as ConvMessage[]));
  }, [taskId]);

  React.useEffect(() => {
    setTurns(null);
    void load();
  }, [load]);

  // Replies and output files are written when a job changes state: reload on any job change of this task.
  React.useEffect(() => {
    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = sb
      .channel(`conv:${taskId}:${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `task_id=eq.${taskId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void load(), 1200);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [taskId, load]);

  // Fallback poll while something is running, in case a realtime event is missed.
  const active = turns?.some((t) => t.job.status === "queued" || t.job.status === "running");
  React.useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [active, load]);

  if (!turns) return <Spinner />;
  if (!turns.length)
    return (
      empty ?? (
        <div className={cn("flex items-center gap-3 rounded-2xl border border-dashed border-line p-4 text-sm text-muted", className)}>
          <MessagesSquare className="size-5" /> هنوز به Gemini یا Claude ارسال نشده است؛ پرامپت، پاسخ‌ها و فایل‌های خروجی اینجا نمایش داده می‌شوند.
        </div>
      )
    );
  return (
    <div className={cn("space-y-5", className)}>
      {turns.map((t) => (
        <div key={t.job.id} className="space-y-4">
          <UserTurn turn={t} />
          <AiTurn turn={t} taskId={taskId} />
        </div>
      ))}
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          به‌روزرسانی
        </Button>
      </div>
    </div>
  );
}
