"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpToLine, Bot, ExternalLink, Pause, Play, RefreshCw, RotateCcw, Sparkles, XCircle, Zap } from "lucide-react";
import { useNow, useRealtimeRows } from "@/hooks/use-realtime";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { run } from "@/components/tasks/task-actions";
import { MiniPreworkFlow, TodoList } from "@/components/workflow/mini-flow";
import { bumpJobAction, cancelJobAction, clearModelBlocksAction, kickWorkerAction, providerPauseAction, retryJobAction } from "@/app/actions/tasks";
import { formatDuration, formatJalali, timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { Job, ProviderState, Task } from "@/lib/types";

const KIND: Record<string, string> = { prework: "پیش‌کار", main: "کار اصلی", knowledge: "استخراج دانش", graphify: "گراف graphify", upgrade: "ارتقای اپ", optimize: "بهینه‌سازی پرامپت" };

function ProviderCard({ p, jobs }: { p: ProviderState; jobs: Job[] }) {
  const paused = p.manual_pause || (p.paused_until && new Date(p.paused_until).getTime() > Date.now());
  const isGemini = p.provider === "gemini";
  const runningJob = jobs.find((j) => j.provider === p.provider && j.status === "running");
  const queued = jobs.filter((j) => j.provider === p.provider && j.status === "queued").length;
  const blocked = Object.entries(p.models ?? {}).filter(([, v]) => v.blocked_until && new Date(v.blocked_until).getTime() > Date.now());
  return (
    <Card className="relative overflow-hidden p-5">
      <div className={cn("absolute -left-10 -top-10 size-40 rounded-full opacity-20 blur-3xl", isGemini ? "bg-violet-500" : "bg-orange-500")} />
      <div className="flex items-start gap-3">
        <div className={cn("grid size-11 place-items-center rounded-2xl text-white", isGemini ? "bg-violet-500" : "bg-orange-500")}>{isGemini ? <Sparkles className="size-5" /> : <Bot className="size-5" />}</div>
        <div className="flex-1">
          <p className="text-lg font-black">{isGemini ? "Google AI Studio (Gemini)" : "Claude Code"}</p>
          <p className="text-xs text-muted">{isGemini ? "پیش‌کار، استخراج دانش، graphify — اجرای ترتیبی" : "کار اصلی و ارتقای اپ — روی GitHub Actions"}</p>
        </div>
        {paused ? <Badge tone="warning" dot>متوقف</Badge> : runningJob ? <Badge tone="success" dot>در حال کار</Badge> : <Badge tone="neutral">آماده</Badge>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-surface-muted p-3">
          <p className="text-xs text-muted">در صف</p>
          <p className="text-2xl font-black">{faNum(queued)}</p>
        </div>
        <div className="rounded-xl bg-surface-muted p-3">
          <p className="text-xs text-muted">وضعیت</p>
          <p className="mt-1 text-xs font-semibold">
            {p.manual_pause ? "توقف دستی" : paused ? `${p.pause_reason ?? "لیمیت"} — ادامه ${timeAgo(p.paused_until)} (${formatJalali(p.paused_until, { withTime: true })})` : "فعال"}
          </p>
        </div>
      </div>
      {blocked.length ? (
        <div className="mt-3 space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          {blocked.map(([m, v]) => (
            <p key={m}>
              <span className="ltr font-mono">{m}</span>: {v.reason} — تا {formatJalali(v.blocked_until, { withTime: true })}
            </p>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {p.manual_pause ? (
          <Button size="sm" variant="success" onClick={() => run(providerPauseAction(p.provider as "gemini" | "claude", false), "ادامه یافت")}>
            <Play className="size-4" /> ادامه
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => run(providerPauseAction(p.provider as "gemini" | "claude", true), "متوقف شد")}>
            <Pause className="size-4" /> توقف دستی
          </Button>
        )}
        {isGemini && (blocked.length || paused) ? (
          <Button size="sm" variant="ghost" onClick={() => run(clearModelBlocksAction(), "محدودیت‌ها پاک شد؛ تلاش دوباره")}>
            <RotateCcw className="size-4" /> تلاش دوباره الان
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function JobRow({ job, task, position }: { job: Job; task?: Pick<Task, "id" | "code" | "title">; position?: number }) {
  const ms = job.started_at ? (job.finished_at ? new Date(job.finished_at).getTime() : Date.now()) - new Date(job.started_at).getTime() : 0;
  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {position ? <span className="grid size-6 place-items-center rounded-full bg-surface-muted text-[11px] font-black">{faNum(position)}</span> : null}
        <Badge tone={job.status === "running" ? "violet" : job.status === "queued" ? "info" : job.status === "done" ? "success" : job.status === "failed" ? "danger" : "neutral"} dot>
          {job.status === "running" ? "در حال اجرا" : job.status === "queued" ? "در صف" : job.status === "done" ? "انجام شد" : job.status === "failed" ? "ناموفق" : "لغو شد"}
        </Badge>
        <span className="text-sm font-bold">{KIND[job.kind]}</span>
        {task ? (
          <Link href={`/tasks/${task.id}`} className="min-w-0 truncate text-sm text-primary">
            {task.code} — {task.title}
          </Link>
        ) : job.upgrade_id ? (
          <Link href="/upgrade" className="text-sm text-primary">
            ارتقای اپ
          </Link>
        ) : null}
        <span className="ms-auto text-xs text-muted">{ms ? formatDuration(ms) : timeAgo(job.created_at)}</span>
      </div>
      {job.status === "running" && job.kind === "prework" ? (
        <div className="mt-3">
          <MiniPreworkFlow state={job.state} compact />
        </div>
      ) : null}
      {job.status === "running" && job.kind === "main" ? (
        <div className="mt-3 max-w-lg">
          <TodoList todos={job.state?.todos} compact />
        </div>
      ) : null}
      {job.state?.live?.thought && job.status === "running" ? <p className="mt-2 text-xs italic text-muted">{job.state.live.thought}</p> : null}
      {job.error && job.status !== "done" ? <p className="mt-2 text-xs text-danger">{job.error}</p> : null}
      {new Date(job.run_after).getTime() > Date.now() ? <p className="mt-1 text-xs text-warning">اجرای بعدی: {timeAgo(job.run_after)}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {job.external_url ? (
          <a href={job.external_url} target="_blank" rel="noreferrer">
            <Button size="sm" variant="ghost">
              GitHub Actions <ExternalLink className="size-3.5" />
            </Button>
          </a>
        ) : null}
        {job.status === "queued" ? (
          <Button size="sm" variant="ghost" onClick={() => run(bumpJobAction(job.id), "به ابتدای صف رفت")}>
            <ArrowUpToLine className="size-4" /> اول صف
          </Button>
        ) : null}
        {job.status === "queued" || job.status === "running" ? (
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => run(cancelJobAction(job.id), "لغو شد")}>
            <XCircle className="size-4" /> لغو
          </Button>
        ) : null}
        {job.status === "failed" || job.status === "cancelled" ? (
          <Button size="sm" variant="ghost" onClick={() => run(retryJobAction(job.id), "دوباره در صف قرار گرفت")}>
            <RefreshCw className="size-4" /> اجرای دوباره
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function QueueClient({ initialJobs, providers: initialProviders, tasks }: { initialJobs: Job[]; providers: ProviderState[]; tasks: Pick<Task, "id" | "code" | "title">[] }) {
  useNow(15_000);
  const [jobs] = useRealtimeRows<Job & Record<string, unknown>>("jobs", initialJobs as (Job & Record<string, unknown>)[]);
  const [providers] = useRealtimeRows<ProviderState & Record<string, unknown>>("provider_state", initialProviders as (ProviderState & Record<string, unknown>)[], { idKey: "provider" });
  const all = jobs as Job[];
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const active = (p: string) =>
    all
      .filter((j) => j.provider === p && (j.status === "running" || j.status === "queued"))
      .sort((a, b) => (a.status === "running" ? -1 : b.status === "running" ? 1 : b.priority - a.priority || new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
  const history = all.filter((j) => ["done", "failed", "cancelled"].includes(j.status)).sort((a, b) => new Date(b.finished_at ?? b.updated_at).getTime() - new Date(a.finished_at ?? a.updated_at).getTime());
  const system = (providers as ProviderState[]).find((p) => p.provider === "system");
  const lastTick = system?.stats?.last_tick_at as string | undefined;

  const list = (p: string) => {
    const items = active(p);
    let pos = 0;
    return items.length ? (
      <div className="divide-y divide-line">{items.map((j) => <JobRow key={j.id} job={j} task={j.task_id ? byTask.get(j.task_id) : undefined} position={j.status === "queued" ? ++pos : undefined} />)}</div>
    ) : (
      <EmptyState title="صف خالی است" className="py-8" />
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">صف و اجرا</h1>
          <p className="mt-1 text-sm text-muted">
            هر ارائه‌دهنده کارها را یکی‌یکی و به ترتیب اولویت انجام می‌دهد؛ با رسیدن به لیمیت متوقف و پس از ریست خودکار ادامه می‌دهد.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="live-dot" style={{ ["--glow" as string]: lastTick && Date.now() - new Date(lastTick).getTime() < 120_000 ? "var(--success)" : "var(--danger)" }} />
            آخرین اجرای ورکر: {lastTick ? timeAgo(lastTick) : "هنوز"}
          </span>
          <Button size="sm" variant="secondary" onClick={() => run(kickWorkerAction(), "ورکر فراخوانی شد")}>
            <Zap className="size-4" /> اجرای فوری ورکر
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(providers as ProviderState[])
          .filter((p) => p.provider !== "system")
          .sort((a) => (a.provider === "gemini" ? -1 : 1))
          .map((p) => (
            <ProviderCard key={p.provider} p={p} jobs={all} />
          ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="صف Gemini" subtitle="پیش‌کار، دانش، گراف" icon={<Sparkles className="size-4" />} />
          {list("gemini")}
        </Card>
        <Card>
          <CardHeader title="صف Claude" subtitle="کار اصلی و ارتقا" icon={<Bot className="size-4" />} />
          {list("claude")}
        </Card>
      </div>

      <Card>
        <CardHeader title="تاریخچه‌ی اخیر" />
        {history.length ? <div className="divide-y divide-line">{history.slice(0, 40).map((j) => <JobRow key={j.id} job={j} task={j.task_id ? byTask.get(j.task_id) : undefined} />)}</div> : <EmptyState title="هنوز کاری انجام نشده" className="py-8" />}
      </Card>
    </div>
  );
}
