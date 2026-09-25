"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowUpLeft, CalendarRange, Clock3, ExternalLink, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Drawer, DrawerClose } from "@/components/ui/overlays";
import { Avatar, Button, Progress, Spinner } from "@/components/ui/primitives";
import { PriorityBadge, RelationBadge, StatusBadge } from "@/components/tasks/badges";
import { LiveLog } from "@/components/tasks/live-log";
import { TaskActions } from "@/components/tasks/task-actions";
import { MiniPreworkFlow, TodoList } from "@/components/workflow/mini-flow";
import { Markdown } from "@/components/ui/markdown";
import { formatJalali, formatRange, timeAgo } from "@/lib/jalali";
import { faNum } from "@/lib/utils";
import type { Job, Profile, Task, TaskEvent } from "@/lib/types";

export function TaskQuickView({
  task,
  onClose,
  userId,
  defaults,
  liveJob,
}: {
  task: Task | null;
  onClose: () => void;
  userId: string;
  defaults: { prework: string; main: string };
  liveJob?: Job | null;
}) {
  const [events, setEvents] = React.useState<TaskEvent[] | null>(null);
  const [requester, setRequester] = React.useState<Profile | null>(null);
  const [job, setJob] = React.useState<Job | null>(null);

  React.useEffect(() => {
    if (!task) return;
    setEvents(null);
    const sb = supabaseBrowser();
    void (async () => {
      const [ev, prof, jobs] = await Promise.all([
        sb.from("task_events").select("*").eq("task_id", task.id).order("id", { ascending: false }).limit(250),
        sb.from("profiles").select("*").eq("id", task.requester_id).maybeSingle(),
        sb.from("jobs").select("*").eq("task_id", task.id).in("status", ["running", "queued"]).order("created_at", { ascending: false }).limit(1),
      ]);
      setEvents(((ev.data ?? []) as TaskEvent[]).reverse());
      setRequester((prof.data as Profile) ?? null);
      setJob(((jobs.data ?? [])[0] as Job) ?? null);
    })();
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeJob = liveJob ?? job;
  const running = task && ["prework_running", "main_running", "prework_queued", "main_queued"].includes(task.status);

  return (
    <Drawer open={!!task} onOpenChange={(o) => !o && onClose()} title={task?.title ?? ""}>
      {task ? (
        <div className="flex h-full flex-col">
          <div className="border-b border-line px-5 pb-4 pt-5">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="ltr text-xs font-bold text-muted">{task.code}</span>
                  <StatusBadge status={task.status} />
                  <PriorityBadge priority={task.priority} />
                  <RelationBadge relation={task.relation_type} />
                </div>
                <h2 className="text-lg font-extrabold leading-8">{task.title}</h2>
              </div>
              <DrawerClose className="rounded-xl p-2 text-muted hover:bg-surface-muted" aria-label="بستن">
                <X className="size-5" />
              </DrawerClose>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
              {requester ? (
                <span className="flex items-center gap-1.5">
                  <Avatar name={requester.full_name ?? requester.email ?? "?"} src={requester.avatar_url} size={20} />
                  {requester.full_name} {requester.org_unit ? `· ${requester.org_unit}` : ""}
                </span>
              ) : null}
              <span className="flex items-center gap-1.5">
                <CalendarRange className="size-3.5" />
                {task.kind === "event" ? formatJalali(task.event_at, { withTime: true }) : formatRange(task.start_date, task.end_date)}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock3 className="size-3.5" /> {timeAgo(task.status_changed_at)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Progress value={task.progress} className="flex-1" />
              <span className="text-xs font-bold">{faNum(task.progress)}٪</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <TaskActions task={task} userId={userId} defaults={defaults} activeJobId={activeJob?.id} size="sm" onChanged={onClose} />
              <Link href={`/tasks/${task.id}`} className="ms-auto">
                <Button size="sm" variant="outline">
                  صفحه‌ی کامل <ArrowUpLeft className="size-4" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {task.description ? (
              <details className="rounded-2xl border border-line bg-surface-strong/60 p-3" open={!running}>
                <summary className="cursor-pointer text-sm font-bold">شرح تسک</summary>
                <Markdown className="mt-2">{task.description}</Markdown>
              </details>
            ) : null}
            {task.return_reason && task.status === "returned" ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
                <b>دلیل برگشت:</b> {task.return_reason}
              </div>
            ) : null}
            {task.closure_reject_reason && task.status === "closure_rejected" ? (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
                <b>دلیل رد خاتمه:</b> {task.closure_reject_reason}
              </div>
            ) : null}

            {activeJob && activeJob.kind === "prework" ? (
              <div className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
                <p className="mb-3 text-sm font-bold text-violet-600 dark:text-violet-300">ورکفلوی پیش‌کار (زنده)</p>
                <MiniPreworkFlow state={activeJob.state} />
              </div>
            ) : null}
            {activeJob && activeJob.kind === "main" ? (
              <div className="rounded-2xl border border-orange-500/25 bg-orange-500/5 p-4">
                <TodoList todos={activeJob.state?.todos} />
                {activeJob.external_url ? (
                  <a href={activeJob.external_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    اجرای GitHub Actions <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
            ) : null}

            <div>
              <p className="mb-2 text-sm font-bold">لاگ زنده</p>
              {events ? <LiveLog initial={events} taskId={task.id} live={!!running} maxHeight="46vh" /> : <Spinner />}
            </div>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
