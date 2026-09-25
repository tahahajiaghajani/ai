"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, ArrowUpLeft, CalendarRange, ExternalLink, FileText, FolderGit2, GitBranch, Network, Paperclip, Save, ThumbsDown, ThumbsUp } from "lucide-react";
import { useRealtimeRows } from "@/hooks/use-realtime";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Progress, Textarea } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/overlays";
import { PriorityBadge, RelationBadge, StageChip, StatusBadge } from "@/components/tasks/badges";
import { LiveLog } from "@/components/tasks/live-log";
import { TaskActions } from "@/components/tasks/task-actions";
import { MiniPreworkFlow, TodoList } from "@/components/workflow/mini-flow";
import { FileGraph } from "@/components/workflow/file-graph";
import { Markdown } from "@/components/ui/markdown";
import { feedbackAction, saveAdminNoteAction } from "@/app/actions/tasks";
import { formatDuration, formatJalali, formatRange, timeAgo } from "@/lib/jalali";
import { RELATION_META } from "@/lib/status";
import { cn, faNum, formatBytes } from "@/lib/utils";
import type { Job, Profile, Task, TaskEvent, TaskFile } from "@/lib/types";
import type { Manifest } from "@/lib/github/workspace";

const AGENT_TITLES: Record<string, string> = { research: "ایجنت ۱ — تحقیق و راهکار", wbs: "ایجنت ۲ — WBS", report: "گزارش پیش‌کار" };
const KIND_LABEL: Record<string, string> = { prework: "پیش‌کار", main: "کار اصلی", knowledge: "استخراج دانش", graphify: "graphify", upgrade: "ارتقا", optimize: "بهینه‌سازی" };
const JOB_STATUS: Record<string, { label: string; tone: "info" | "violet" | "success" | "danger" | "neutral" }> = {
  queued: { label: "در صف", tone: "info" },
  running: { label: "در حال اجرا", tone: "violet" },
  done: { label: "انجام شد", tone: "success" },
  failed: { label: "ناموفق", tone: "danger" },
  cancelled: { label: "لغو شد", tone: "neutral" },
};

function FeedbackBar({ taskId, agent, jobId }: { taskId: string; agent: string; jobId: string | null }) {
  const [comment, setComment] = React.useState("");
  const [sent, setSent] = React.useState<number | null>(null);
  const send = async (rating: -1 | 1) => {
    const r = await feedbackAction({ task_id: taskId, job_id: jobId, agent: agent === "wbs" ? "wbs_detail" : agent, rating, comment });
    if (r.ok) {
      setSent(rating);
      toast.success("بازخورد ثبت شد؛ در بهینه‌سازی پرامپت‌ها استفاده می‌شود");
    } else toast.error(r.error);
  };
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
      <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="نظر شما درباره‌ی کیفیت این خروجی (برای یادگیری سیستم)…" className="h-9 flex-1 rounded-xl border border-line bg-surface-strong px-3 text-xs" />
      <div className="flex gap-1.5">
        <Button size="sm" variant={sent === 1 ? "success" : "secondary"} onClick={() => send(1)}>
          <ThumbsUp className="size-4" /> خوب
        </Button>
        <Button size="sm" variant={sent === -1 ? "danger" : "secondary"} onClick={() => send(-1)}>
          <ThumbsDown className="size-4" /> ضعیف
        </Button>
      </div>
    </div>
  );
}

export function TaskDetailClient({
  userId,
  task: initialTask,
  family,
  requester,
  events,
  jobs: initialJobs,
  files,
  outputs,
  feedback,
  manifest,
  github,
  defaults,
}: {
  userId: string;
  task: Task;
  family: Task[];
  requester: Profile | null;
  events: TaskEvent[];
  jobs: Job[];
  files: TaskFile[];
  outputs: { id: number; agent: string; content: string; job_id: string | null; created_at: string }[];
  feedback: { agent: string; rating: number; comment: string | null; created_at: string }[];
  manifest: Manifest | null;
  github: { folder: string; repo: string } | null;
  defaults: { prework: string; main: string };
}) {
  const router = useRouter();
  const [tasks] = useRealtimeRows<Task & Record<string, unknown>>("tasks", [initialTask] as (Task & Record<string, unknown>)[], { filter: `id=eq.${initialTask.id}` });
  const task = (tasks[0] as Task) ?? initialTask;
  const [jobs] = useRealtimeRows<Job & Record<string, unknown>>("jobs", initialJobs as (Job & Record<string, unknown>)[], {
    filter: `task_id=eq.${initialTask.id}`,
    sort: (a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime(),
  });
  const allJobs = jobs as Job[];
  const active = allJobs.find((j) => j.status === "running" || j.status === "queued") ?? null;
  const lastPrework = allJobs.find((j) => j.kind === "prework") ?? null;
  const lastMain = allJobs.find((j) => j.kind === "main") ?? null;
  const [note, setNote] = React.useState(task.admin_note ?? "");
  const running = ["prework_running", "main_running", "prework_queued", "main_queued"].includes(task.status);
  const root = family.find((f) => f.id === (task.root_id ?? task.id));
  const related = family.filter((f) => f.id !== task.id);

  const overview = (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-bold text-muted">شرح تسک</h3>
          {task.description ? <Markdown>{task.description}</Markdown> : <p className="text-sm text-muted">—</p>}
          {task.return_reason && task.status === "returned" ? <div className="mt-3 rounded-xl bg-rose-500/8 p-3 text-sm"><b>دلیل برگشت:</b> {task.return_reason}</div> : null}
          {task.closure_note ? <div className="mt-3 rounded-xl bg-surface-muted p-3 text-sm"><b>یادداشت خاتمه:</b> {task.closure_note}</div> : null}
          {task.closure_reject_reason ? <div className="mt-3 rounded-xl bg-rose-500/8 p-3 text-sm"><b>دلیل رد خاتمه:</b> {task.closure_reject_reason}</div> : null}
        </Card>

        <Card>
          <CardHeader title="تسک‌های مرتبط" subtitle="ادامه‌ها و توضیحات رد — در همان پروژه (همان چت Gemini و همان پروژه‌ی Claude) انجام می‌شوند" icon={<GitBranch className="size-4" />} />
          <div className="divide-y divide-line">
            {family.length <= 1 ? <p className="px-5 py-6 text-sm text-muted">تسک مرتبطی ثبت نشده است.</p> : null}
            {family.length > 1
              ? family.map((f) => (
                  <Link key={f.id} href={`/tasks/${f.id}`} className={cn("flex items-center gap-3 px-5 py-3 hover:bg-surface-muted", f.id === task.id && "bg-primary-soft")}>
                    <span className="ltr w-16 text-xs font-bold text-muted">{f.code}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{f.title}</span>
                    {f.parent_id ? <Badge tone="pink">{RELATION_META[f.relation_type ?? "other"]}</Badge> : <Badge tone="violet">تسک اصلی</Badge>}
                    <StatusBadge status={f.status} />
                  </Link>
                ))
              : null}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="space-y-3 p-5 text-sm">
          <div className="flex items-center gap-2.5">
            <Avatar name={requester?.full_name ?? "?"} src={requester?.avatar_url} size={36} />
            <div>
              <p className="font-bold">{requester?.full_name}</p>
              <p className="text-xs text-muted">{requester?.org_unit ?? requester?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-muted">
            <CalendarRange className="size-4" />
            {task.kind === "event" ? `رویداد: ${formatJalali(task.event_at, { withTime: true })}` : formatRange(task.start_date, task.end_date)}
          </div>
          <div className="text-xs text-muted">ثبت: {formatJalali(task.created_at, { withTime: true })}</div>
          {github ? (
            <a href={github.folder} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold text-primary">
              <FolderGit2 className="size-4" /> پوشه‌ی تسک در GitHub <ExternalLink className="size-3.5" />
            </a>
          ) : null}
        </Card>
        <Card className="p-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-bold">
            <Paperclip className="size-4" /> پیوست‌ها ({faNum(files.length)})
          </h3>
          {files.length === 0 ? <p className="text-xs text-muted">بدون پیوست</p> : null}
          <ul className="space-y-1.5">
            {files.map((f) => (
              <li key={f.id}>
                <a href={`/api/files/${f.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-surface-muted">
                  <FileText className="size-3.5 text-muted" />
                  <span className="ltr flex-1 truncate text-start">{f.name}</span>
                  <Badge>{f.context === "request" ? "درخواست" : f.context === "prework" ? "پیش‌کار" : "کار اصلی"}</Badge>
                  <span className="text-faint">{formatBytes(f.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-bold">یادداشت خصوصی مدیر</h3>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-24" placeholder="فقط شما می‌بینید" />
          <Button size="sm" variant="secondary" className="mt-2" onClick={async () => {
            const r = await saveAdminNoteAction(task.id, note);
            if (r.ok) toast.success("ذخیره شد");
            else toast.error(r.error);
          }}>
            <Save className="size-4" /> ذخیره
          </Button>
        </Card>
      </div>
    </div>
  );

  const workflow = (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-bold text-violet-600 dark:text-violet-300">ورکفلوی پیش‌کار (Gemini + LangGraph)</h3>
        {lastPrework ? (
          <>
            <MiniPreworkFlow state={lastPrework.state} vertical />
            {lastPrework.state?.usage ? (
              <p className="mt-4 text-xs text-muted">
                {faNum(lastPrework.state.usage.calls)} فراخوانی مدل · ورودی {faNum(lastPrework.state.usage.input.toLocaleString("en"))} · خروجی {faNum(lastPrework.state.usage.output.toLocaleString("en"))} توکن
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">هنوز پیش‌کاری اجرا نشده است.</p>
        )}
      </Card>
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-bold text-orange-600 dark:text-orange-300">کار اصلی (Claude Code)</h3>
        {lastMain ? (
          <>
            <TodoList todos={lastMain.state?.todos} />
            {lastMain.external_url ? (
              <a href={lastMain.external_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                مشاهده‌ی اجرا در GitHub Actions <ExternalLink className="size-3" />
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">هنوز به Claude ارسال نشده است.</p>
        )}
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="تاریخچه‌ی اجراها" subtitle="همه‌ی کارهای صف برای این تسک" />
        <div className="divide-y divide-line">
          {allJobs.length === 0 ? <p className="px-5 py-6 text-sm text-muted">اجرایی ثبت نشده است.</p> : null}
          {allJobs.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>
              <span className="font-semibold">{KIND_LABEL[j.kind]}</span>
              <span className="text-xs text-muted">{formatJalali(j.created_at, { withTime: true })}</span>
              {j.started_at && j.finished_at ? <span className="text-xs text-muted">مدت: {formatDuration(new Date(j.finished_at).getTime() - new Date(j.started_at).getTime())}</span> : null}
              {j.attempts ? <span className="text-xs text-warning">تلاش: {faNum(j.attempts)}</span> : null}
              {j.error && j.status === "failed" ? <span className="w-full text-xs text-danger">{j.error}</span> : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  const outputsTab = outputs.length ? (
    <div className="space-y-4">
      {github ? (
        <a href={github.folder} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <FolderGit2 className="size-4" /> همه‌ی فایل‌ها (روش‌ها، اجرای کارهای ساده، خروجی نهایی Claude) در GitHub <ExternalLink className="size-3.5" />
        </a>
      ) : null}
      {outputs.map((o) => (
        <Card key={o.id} className="p-5">
          <details open={o.agent !== "wbs"}>
            <summary className="cursor-pointer text-[15px] font-extrabold">
              {AGENT_TITLES[o.agent] ?? o.agent} <span className="text-xs font-normal text-muted">— {timeAgo(o.created_at)}</span>
            </summary>
            <Markdown className="mt-3">{o.content}</Markdown>
          </details>
          <FeedbackBar taskId={task.id} agent={o.agent} jobId={o.job_id} />
        </Card>
      ))}
      {feedback.length ? (
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-bold">بازخوردهای ثبت‌شده</h3>
          {feedback.map((f, i) => (
            <p key={i} className="text-xs text-muted">
              {f.rating > 0 ? "👍" : "👎"} {f.agent}: {f.comment || "—"} · {timeAgo(f.created_at)}
            </p>
          ))}
        </Card>
      ) : null}
    </div>
  ) : (
    <EmptyState icon={<FileText className="size-7" />} title="هنوز خروجی‌ای تولید نشده" description="پس از اجرای پیش‌کار، خروجی ایجنت‌ها اینجا نمایش داده می‌شود." />
  );

  const graphLink = (
    <Link href={`/graph?task=${task.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-primary/25 bg-primary-soft px-4 py-3 text-sm font-bold text-primary transition hover:-translate-y-px">
      <span className="flex items-center gap-2">
        <Network className="size-4" /> نمایش این پروژه در «گراف دانش» (graphify)
      </span>
      <ArrowUpLeft className="size-4" />
    </Link>
  );

  const filesTab = manifest ? (
    <div className="space-y-4">
      {graphLink}
      <FileGraph manifest={manifest} />
      <Card>
        <CardHeader title="دیتا مپینگ (manifest.json)" subtitle={`${faNum(manifest.files.length)} فایل در ${faNum(manifest.iterations.length)} تکرار`} />
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-strong text-muted">
              <tr>
                <th className="px-4 py-2 text-start">مسیر</th>
                <th className="px-2 py-2 text-start">نقش</th>
                <th className="px-2 py-2 text-start">تولیدکننده</th>
                <th className="px-2 py-2 text-start">توضیح</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {manifest.files.map((f) => (
                <tr key={f.path}>
                  <td className="ltr px-4 py-2 text-start font-mono">{f.path.replace(`${task.github_path}/`, "")}</td>
                  <td className="px-2 py-2">{f.role}</td>
                  <td className="px-2 py-2">{f.agent}</td>
                  <td className="px-2 py-2 text-muted">{f.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  ) : (
    <div className="space-y-4">
      {graphLink}
      <EmptyState icon={<FolderGit2 className="size-7" />} title="هنوز نقشه‌ی فایلی وجود ندارد" description="پس از انتشار پیش‌کار در GitHub، گراف و دیتا مپینگ فایل‌ها اینجا نمایش داده می‌شود." />
    </div>
  );

  return (
    <div className="space-y-5">
      <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowRight className="size-4" /> بازگشت به ورکفلو
      </Link>
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div className="absolute -left-20 -top-20 size-64 rounded-full bg-gradient-brand opacity-10 blur-3xl" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="ltr rounded-lg bg-surface-muted px-2 py-0.5 text-xs font-black">{task.code}</span>
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          <RelationBadge relation={task.relation_type} />
          {root && root.id !== task.id ? (
            <Link href={`/tasks/${root.id}`} className="text-xs font-semibold text-primary">
              ← تسک اصلی {root.code}
            </Link>
          ) : null}
          <span className="ms-auto">
            <StageChip status={task.status} />
          </span>
        </div>
        <h1 className="mt-3 text-xl font-black leading-9 sm:text-2xl">{task.title}</h1>
        <div className="mt-4 flex items-center gap-3">
          <Progress value={task.progress} className="h-2 flex-1" />
          <span className="text-sm font-black">{faNum(task.progress)}٪</span>
        </div>
        <div className="mt-5">
          <TaskActions task={task} userId={userId} defaults={defaults} activeJobId={active?.id} onChanged={() => router.refresh()} />
        </div>
        {related.length ? <p className="mt-3 text-xs text-muted">{faNum(related.length)} تسک مرتبط در این پروژه</p> : null}
      </Card>

      <Tabs
        defaultValue={running ? "log" : "overview"}
        items={[
          { value: "overview", label: "نمای کلی", content: overview },
          { value: "log", label: running ? <span className="flex items-center gap-2"><span className="live-dot" /> لاگ زنده</span> : "لاگ", content: <LiveLog initial={events} taskId={task.id} live={running} maxHeight="70vh" /> },
          { value: "workflow", label: "ورکفلو و اجراها", content: workflow },
          { value: "outputs", label: "خروجی ایجنت‌ها", content: outputsTab },
          { value: "files", label: "گراف فایل‌ها", content: filesTab },
        ]}
      />
    </div>
  );
}
