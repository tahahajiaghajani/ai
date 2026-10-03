"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpToLine, Bot, Cpu, ExternalLink, GitBranch, Pause, Play, RefreshCw, RotateCcw, XCircle, Zap } from "lucide-react";
import { useNow, useRealtimeRows } from "@/hooks/use-realtime";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { run } from "@/components/tasks/task-actions";
import { MiniPreworkFlow, TodoList } from "@/components/workflow/mini-flow";
import { bumpJobAction, cancelJobAction, clearModelBlocksAction, connectionPauseAction, kickWorkerAction, retryJobAction } from "@/app/actions/tasks";
import { providerPreset } from "@/lib/ai/providers";
import { formatDuration, formatJalali, timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { ConnectionStateRow, Job, Task } from "@/lib/types";

const KIND: Record<string, string> = {
  prework: "پیش‌کار",
  main: "کار اصلی",
  knowledge: "به‌روزرسانی دانش پروژه",
  index: "خلاصه‌ی فایل‌های پروژه",
  import: "ورود فایل‌های پروژه",
  graphify: "گراف graphify",
  upgrade: "ارتقای اپ",
  optimize: "بهینه‌سازی پرامپت",
};

export interface QueueConnection {
  id: string;
  label: string;
  provider: string;
  status: string;
}

function ConnectionCard({ c, state, jobs }: { c: QueueConnection; state?: ConnectionStateRow; jobs: Job[] }) {
  const paused = !!state && (state.manual_pause || (!!state.paused_until && new Date(state.paused_until).getTime() > Date.now()));
  const mine = jobs.filter((j) => j.connection_id === c.id);
  const running = mine.filter((j) => j.status === "running").length;
  const queued = mine.filter((j) => j.status === "queued").length;
  const blocked = Object.entries(state?.models ?? {}).filter(([, v]) => v.blocked_until && new Date(v.blocked_until).getTime() > Date.now());
  return (
    <Card className="relative overflow-hidden p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-2xl bg-violet-500 text-white">
          <Cpu className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-black">{c.label}</p>
          {(providerPreset(c.provider)?.label ?? c.provider) !== c.label ? <p className="text-xs text-muted">{providerPreset(c.provider)?.label ?? c.provider}</p> : null}
        </div>
        {paused ? (
          <Badge tone="warning" dot>
            متوقف
          </Badge>
        ) : running ? (
          <Badge tone="success" dot>
            در حال کار
          </Badge>
        ) : (
          <Badge tone="neutral">آماده</Badge>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-surface-muted p-3">
          <p className="text-xs text-muted">در صف / در حال اجرا</p>
          <p className="text-2xl font-black">
            {faNum(queued)} <span className="text-base text-muted">/ {faNum(running)}</span>
          </p>
        </div>
        <div className="rounded-xl bg-surface-muted p-3">
          <p className="text-xs text-muted">وضعیت</p>
          <p className="mt-1 text-xs font-semibold">
            {state?.manual_pause ? "توقف دستی" : paused ? `${state?.pause_reason ?? "لیمیت"} — ادامه ${timeAgo(state?.paused_until ?? null)} (${formatJalali(state?.paused_until ?? null, { withTime: true })})` : "فعال"}
          </p>
        </div>
      </div>
      {blocked.length ? (
        <div className="mt-3 space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          {blocked.map(([m, v]) => (
            <p key={m}>
              <span className="ltr font-mono">{m}</span>: {v.reason} — تا {formatJalali(v.blocked_until ?? null, { withTime: true })}
            </p>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {state?.manual_pause ? (
          <Button size="sm" variant="success" onClick={() => run(connectionPauseAction(c.id, false), "ادامه یافت")}>
            <Play className="size-4" /> ادامه
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => run(connectionPauseAction(c.id, true), "متوقف شد")}>
            <Pause className="size-4" /> توقف دستی
          </Button>
        )}
        {blocked.length || (paused && !state?.manual_pause) ? (
          <Button size="sm" variant="ghost" onClick={() => run(clearModelBlocksAction(c.id), "محدودیت‌ها پاک شد؛ تلاش دوباره")}>
            <RotateCcw className="size-4" /> تلاش دوباره الان
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function JobRow({ job, task, owner, position }: { job: Job; task?: Pick<Task, "id" | "code" | "title">; owner?: string; position?: number }) {
  const ms = job.started_at ? (job.finished_at ? new Date(job.finished_at).getTime() : Date.now()) - new Date(job.started_at).getTime() : 0;
  return (
    <div className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {position ? <span className="grid size-6 place-items-center rounded-full bg-surface-muted text-[11px] font-black">{faNum(position)}</span> : null}
        <Badge tone={job.status === "running" ? "violet" : job.status === "queued" ? "info" : job.status === "done" ? "success" : job.status === "failed" ? "danger" : "neutral"} dot>
          {job.status === "running" ? "در حال اجرا" : job.status === "queued" ? "در صف" : job.status === "done" ? "انجام شد" : job.status === "failed" ? "ناموفق" : "لغو شد"}
        </Badge>
        <span className="text-sm font-bold">{KIND[job.kind] ?? job.kind}</span>
        {owner ? <Badge tone="neutral">{owner}</Badge> : null}
        {task ? (
          <Link href={`/tasks/${task.id}`} className="min-w-0 truncate text-sm text-primary">
            {task.code} — {task.title}
          </Link>
        ) : job.project_id ? (
          <Link href={`/projects/${job.project_id}`} className="text-sm text-primary">
            پروژه
          </Link>
        ) : job.upgrade_id ? (
          <Link href="/upgrade" className="text-sm text-primary">
            ارتقای اپ
          </Link>
        ) : null}
        <span className="ms-auto text-xs text-muted" suppressHydrationWarning>
          {ms ? formatDuration(ms) : timeAgo(job.created_at)}
        </span>
      </div>
      {job.status === "running" && (job.kind === "prework" || job.kind === "main") && job.state?.nodes ? (
        <div className="mt-3">
          <MiniPreworkFlow state={job.state} compact />
        </div>
      ) : null}
      {job.status === "running" && job.state?.todos?.length ? (
        <div className="mt-3 max-w-lg">
          <TodoList todos={job.state.todos} compact />
        </div>
      ) : null}
      {job.state?.live?.thought && job.status === "running" ? <p className="mt-2 text-xs italic text-muted">{job.state.live.thought}</p> : null}
      {job.error && job.status !== "done" ? <p className="mt-2 text-xs text-danger">{job.error}</p> : null}
      {job.status === "queued" && new Date(job.run_after).getTime() > Date.now() ? <p className="mt-1 text-xs text-warning">اجرای بعدی: {timeAgo(job.run_after)}</p> : null}
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
        {(job.status === "failed" || job.status === "cancelled") && job.kind !== "upgrade" ? (
          <Button size="sm" variant="ghost" onClick={() => run(retryJobAction(job.id), "دوباره در صف قرار گرفت")}>
            <RefreshCw className="size-4" /> اجرای دوباره
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function QueueClient({
  userId,
  isOwner,
  all,
  initialJobs,
  connections,
  states: initialStates,
  claudeCode,
  tasks,
  owners,
  lastTick,
}: {
  userId: string;
  isOwner: boolean;
  all: boolean;
  initialJobs: Job[];
  connections: QueueConnection[];
  states: ConnectionStateRow[];
  claudeCode: boolean;
  tasks: Pick<Task, "id" | "code" | "title">[];
  owners: Record<string, string>;
  lastTick: string | null;
}) {
  useNow(15_000);
  const [jobs] = useRealtimeRows<Job & Record<string, unknown>>("jobs", initialJobs as (Job & Record<string, unknown>)[], { filter: all ? undefined : `owner_id=eq.${userId}` });
  const [states] = useRealtimeRows<ConnectionStateRow & Record<string, unknown>>("connection_state", initialStates as (ConnectionStateRow & Record<string, unknown>)[], {
    idKey: "connection_id",
    filter: `user_id=eq.${userId}`,
  });
  const list = jobs as Job[];
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const stateOf = new Map((states as ConnectionStateRow[]).map((s) => [s.connection_id, s]));
  const active = (external: boolean) =>
    list
      .filter((j) => (j.lane === "external") === external && (j.status === "running" || j.status === "queued"))
      .sort((a, b) => (a.status === "running" ? -1 : b.status === "running" ? 1 : b.priority - a.priority || new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
  const history = list
    .filter((j) => ["done", "failed", "cancelled"].includes(j.status))
    .sort((a, b) => new Date(b.finished_at ?? b.updated_at).getTime() - new Date(a.finished_at ?? a.updated_at).getTime());

  const rows = (items: Job[]) => {
    let pos = 0;
    return items.length ? (
      <div className="divide-y divide-line">
        {items.map((j) => (
          <JobRow key={j.id} job={j} task={j.task_id ? byTask.get(j.task_id) : undefined} owner={all && j.owner_id ? owners[j.owner_id] : undefined} position={j.status === "queued" ? ++pos : undefined} />
        ))}
      </div>
    ) : (
      <EmptyState title="صف خالی است" className="py-8" />
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="صف اجرا"
       
        actions={
          <>
            {isOwner ? (
              <div className="flex rounded-xl bg-surface-muted p-1 text-xs font-bold">
                <Link href="/queue" className={cn("rounded-lg px-3 py-1.5", !all ? "bg-surface-strong text-fg shadow-[0_1px_3px_rgba(11,18,34,0.08)]" : "text-muted")}>
                  من
                </Link>
                <Link href="/queue?scope=all" className={cn("rounded-lg px-3 py-1.5", all ? "bg-surface-strong text-fg shadow-[0_1px_3px_rgba(11,18,34,0.08)]" : "text-muted")}>
                  همه
                </Link>
              </div>
            ) : null}
            <span className="flex items-center gap-1.5 text-xs text-muted" suppressHydrationWarning title="آخرین اجرای ورکر">
              <span className="live-dot" style={{ ["--glow" as string]: lastTick && Date.now() - new Date(lastTick).getTime() < 120_000 ? "var(--success)" : "var(--danger)" }} />
              {lastTick ? timeAgo(lastTick) : "هنوز اجرا نشده"}
            </span>
            <Button size="sm" variant="secondary" onClick={() => run(kickWorkerAction(), "ورکر فراخوانی شد")}>
              <Zap className="size-4" /> اجرای فوری
            </Button>
          </>
        }
      />

      {connections.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((c) => (
            <ConnectionCard key={c.id} c={c} state={stateOf.get(c.id)} jobs={list} />
          ))}
        </div>
      ) : (
        <Card className="flex items-center gap-3 p-4 text-sm">
          <span className="flex-1 text-muted">کلید هوش مصنوعی وصل نشده</span>
          <Link href="/settings#connections" className="font-bold text-primary">
            اتصال کلید ←
          </Link>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="داخل اپ" icon={<Bot className="size-4" />} />
          {rows(active(false))}
        </Card>
        <Card>
          <CardHeader title="GitHub Actions" subtitle={claudeCode ? undefined : "Claude Code راه‌اندازی نشده"} icon={<GitBranch className="size-4" />} />
          {rows(active(true))}
        </Card>
      </div>

      <Card>
        <CardHeader title="تاریخچه" />
        {history.length ? (
          <div className="divide-y divide-line">
            {history.slice(0, 40).map((j) => (
              <JobRow key={j.id} job={j} task={j.task_id ? byTask.get(j.task_id) : undefined} owner={all && j.owner_id ? owners[j.owner_id] : undefined} />
            ))}
          </div>
        ) : (
          <EmptyState title="هنوز کاری انجام نشده" className="py-8" />
        )}
      </Card>
    </div>
  );
}
