import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarRange, FileText, GitBranchPlus, Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { Badge, Button, Card, CardHeader, Progress } from "@/components/ui/primitives";
import { PriorityBadge, RelationBadge, StatusBadge } from "@/components/tasks/badges";
import { Markdown } from "@/components/ui/markdown";
import { formatJalali, formatRange, timeAgo } from "@/lib/jalali";
import { REQUESTER_EDITABLE, RELATION_META, STAGES, stageOf } from "@/lib/status";
import { cn, faNum, formatBytes } from "@/lib/utils";
import { RequesterActions } from "./requester-actions";
import { PortalLive } from "../../portal-live";
import type { Task, TaskEvent, TaskFile } from "@/lib/types";

export const metadata = { title: "جزئیات تسک" };

export default async function PortalTaskPage(props: PageProps<"/portal/tasks/[id]">) {
  const me = await requireUser();
  const { id } = await props.params;
  const { data: task } = await db().from("tasks").select("*").eq("id", id).maybeSingle<Task>();
  if (!task || (task.requester_id !== me.id && !me.isAdmin)) notFound();
  const rootId = task.root_id ?? task.id;
  const [family, events, files] = await Promise.all([
    db().from("tasks").select("*").or(`id.eq.${rootId},root_id.eq.${rootId}`).order("seq_in_root"),
    db().from("task_events").select("*").eq("task_id", id).eq("visibility", "requester").order("id", { ascending: false }).limit(100),
    db().from("task_files").select("*").eq("task_id", id).eq("context", "request").order("created_at"),
  ]);
  const stage = stageOf(task.status);
  const stageIdx = STAGES.findIndex((s) => s.key === stage.key);
  const timeline = (events.data ?? []) as TaskEvent[];

  return (
    <div className="space-y-5">
      <PortalLive userId={task.requester_id} />
      <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowRight className="size-4" /> تسک‌های من
      </Link>

      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div className="absolute -left-16 -top-16 size-56 rounded-full bg-gradient-brand opacity-10 blur-3xl" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="ltr rounded-lg bg-surface-muted px-2 py-0.5 text-xs font-black">{task.code}</span>
          <StatusBadge status={task.status} requester />
          <PriorityBadge priority={task.priority} />
          <RelationBadge relation={task.relation_type} />
        </div>
        <h1 className="mt-3 text-xl font-black leading-9 sm:text-2xl">{task.title}</h1>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <CalendarRange className="size-4" />
          {task.kind === "event" ? `رویداد: ${formatJalali(task.event_at, { withTime: true })}` : formatRange(task.start_date, task.end_date)}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Progress value={task.progress} className="h-2.5 flex-1" tone={task.status === "closed" ? "success" : "brand"} />
          <span className="text-lg font-black">{faNum(task.progress)}٪</span>
        </div>

        {/* simplified stage tracker for requesters */}
        <div className="mt-5 grid grid-cols-7 gap-1">
          {STAGES.map((s, i) => (
            <div key={s.key} className="flex flex-col items-center gap-1.5 text-center">
              <div className={cn("h-1.5 w-full rounded-full", i <= stageIdx && task.status !== "cancelled" ? "" : "bg-line-strong")} style={i <= stageIdx && task.status !== "cancelled" ? { background: s.color } : undefined} />
              <span className={cn("hidden text-[10px] leading-4 sm:block", i === stageIdx ? "font-bold text-fg" : "text-faint")}>{s.short}</span>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <RequesterActions task={task} userId={me.id} />
          {REQUESTER_EDITABLE.includes(task.status) ? (
            <Link href={`/portal/tasks/${task.id}/edit`}>
              <Button variant="secondary">
                <Pencil className="size-4" /> ویرایش
              </Button>
            </Link>
          ) : null}
          <Link href={`/portal/new?parent=${task.root_id ?? task.id}&relation=continuation`}>
            <Button variant="ghost">
              <GitBranchPlus className="size-4" /> ثبت تسک مرتبط (ادامه/توضیح)
            </Button>
          </Link>
        </div>
      </Card>

      {task.status === "returned" && task.return_reason ? (
        <Card className="border-rose-500/40 p-5">
          <p className="text-sm font-bold text-rose-600">توضیحات مدیر برای اصلاح:</p>
          <p className="mt-2 text-sm leading-7">{task.return_reason}</p>
          <p className="mt-3 text-xs text-muted">تسک را ویرایش کنید و سپس «ارسال مجدد» را بزنید.</p>
        </Card>
      ) : null}
      {task.status === "closure_pending" ? (
        <Card className="border-amber-500/40 p-5">
          <p className="text-sm font-bold">مدیر این تسک را انجام‌شده اعلام کرده است.</p>
          {task.closure_note ? <p className="mt-2 text-sm leading-7">{task.closure_note}</p> : null}
          <p className="mt-2 text-xs text-muted">اگر کار مطابق انتظار است خاتمه را تایید کنید؛ در غیر این صورت با توضیحات رد کنید تا به‌عنوان تسک مرتبط پیگیری شود.</p>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-2 text-sm font-bold text-muted">توضیحات</h3>
            {task.description ? <Markdown>{task.description}</Markdown> : <p className="text-sm text-muted">—</p>}
          </Card>
          <Card>
            <CardHeader title="روند انجام" subtitle="تغییرات وضعیت تسک" />
            <ol className="relative space-y-4 px-6 py-5">
              <div className="absolute inset-y-6 right-[29px] w-0.5 bg-line" />
              {timeline.length === 0 ? <p className="text-sm text-muted">—</p> : null}
              {timeline.map((e) => (
                <li key={e.id} className="relative flex gap-3">
                  <span className="relative z-10 mt-1.5 size-3 shrink-0 rounded-full border-2 border-[var(--bg-elevated)] bg-primary" />
                  <div>
                    <p className="text-sm font-semibold">{e.title.replace(/^وضعیت: /, "")}</p>
                    {e.detail ? <p className="mt-0.5 text-xs text-muted">{e.detail}</p> : null}
                    <p className="mt-0.5 text-[11px] text-faint">
                      {formatJalali(e.created_at, { withTime: true })} · {timeAgo(e.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="mb-2 text-sm font-bold">پیوست‌ها</h3>
            {(files.data ?? []).length === 0 ? <p className="text-xs text-muted">بدون پیوست</p> : null}
            <ul className="space-y-1">
              {((files.data ?? []) as TaskFile[]).map((f) => (
                <li key={f.id}>
                  <a href={`/api/files/${f.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-muted">
                    <FileText className="size-3.5 text-muted" />
                    <span className="ltr flex-1 truncate text-start">{f.name}</span>
                    <span className="text-faint">{formatBytes(f.size)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <h3 className="mb-2 text-sm font-bold">تسک‌های این پروژه</h3>
            <ul className="space-y-1">
              {((family.data ?? []) as Task[]).map((f) => (
                <li key={f.id}>
                  <Link href={`/portal/tasks/${f.id}`} className={cn("flex items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-surface-muted", f.id === task.id && "bg-primary-soft")}>
                    <span className="ltr font-bold text-muted">{f.code}</span>
                    <span className="flex-1 truncate">{f.title}</span>
                    {f.parent_id ? <Badge tone="pink">{RELATION_META[f.relation_type ?? "other"]}</Badge> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
