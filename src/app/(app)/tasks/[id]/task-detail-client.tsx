"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowRight, CalendarRange, ExternalLink, FileText, FolderGit2, FolderOpen, GitBranch, Paperclip, Save } from "lucide-react";
import { useRealtimeRows } from "@/hooks/use-realtime";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Progress, Spinner, Textarea } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/overlays";
import { PriorityBadge, RelationBadge, StageChip, StatusBadge } from "@/components/tasks/badges";
import { LiveLog } from "@/components/tasks/live-log";
import { TaskActions } from "@/components/tasks/task-actions";
import { MiniPreworkFlow, TodoList } from "@/components/workflow/mini-flow";
import { TaskConversation } from "@/components/tasks/task-conversation";
import { InlineDispatch } from "@/components/tasks/task-prep";
import { Markdown } from "@/components/ui/markdown";
import { saveAdminNoteAction, taskRepoInfoAction, type RunManifest } from "@/app/actions/tasks";
import { formatDuration, formatJalali, formatRange, timeAgo } from "@/lib/jalali";
import { RELATION_META } from "@/lib/status";
import { cn, faNum, formatBytes } from "@/lib/utils";
import type { Job, PersonLite, Task, TaskEvent, TaskFile } from "@/lib/types";
import type { DispatchDefaults } from "@/lib/settings";

const FEEDBACK_AGENT: Record<string, string> = { plan: "پیش‌کار", brief: "پیش‌کار", coder: "کار اصلی", claude: "کار اصلی" };
const KIND_LABEL: Record<string, string> = { prework: "پیش‌کار", main: "کار اصلی", knowledge: "دانش پروژه", index: "خلاصه‌ی فایل‌ها", import: "ورود فایل‌ها", graphify: "graphify", upgrade: "ارتقا", optimize: "بهینه‌سازی" };
const JOB_STATUS: Record<string, { label: string; tone: "info" | "violet" | "success" | "danger" | "neutral" }> = {
  queued: { label: "در صف", tone: "info" },
  running: { label: "در حال اجرا", tone: "violet" },
  done: { label: "انجام شد", tone: "success" },
  failed: { label: "ناموفق", tone: "danger" },
  cancelled: { label: "لغو شد", tone: "neutral" },
};

export function TaskDetailClient({
  userId,
  task: initialTask,
  family,
  requester,
  assignee,
  project,
  events,
  jobs: initialJobs,
  files,
  feedback,
  defaults,
}: {
  userId: string;
  task: Task;
  family: Task[];
  requester: PersonLite | null;
  assignee: PersonLite | null;
  project: { id: string; name: string; slug: string } | null;
  events: TaskEvent[];
  jobs: Job[];
  files: TaskFile[];
  feedback: { agent: string; rating: number; comment: string | null; created_at: string }[];
  defaults: DispatchDefaults;
}) {
  // GitHub folder link + data map need several GitHub API calls: fetched after the page is shown.
  const [repo, setRepo] = React.useState<{ manifest: RunManifest | null; github: { folder: string; repo: string; project: string | null; blob: string } | null } | null>(null);
  React.useEffect(() => {
    let alive = true;
    void taskRepoInfoAction(initialTask.id).then((r) => alive && setRepo(r.ok ? r.data : { manifest: null, github: null }));
    return () => {
      alive = false;
    };
  }, [initialTask.id]);
  const manifest = repo?.manifest ?? null;
  const github = repo?.github ?? null;
  // A stable array: a new one each render would make the realtime hook reset its rows in a loop.
  const initialRows = React.useMemo(() => [initialTask] as (Task & Record<string, unknown>)[], [initialTask]);
  const [tasks] = useRealtimeRows<Task & Record<string, unknown>>("tasks", initialRows, { filter: `id=eq.${initialTask.id}` });
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
  const self = task.requester_id === task.assignee_id;
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
          <CardHeader title="تسک‌های مرتبط" icon={<GitBranch className="size-4" />} />
          <div className="divide-y divide-line">
            {family.length <= 1 ? <p className="px-5 py-6 text-sm text-muted">—</p> : null}
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
              <p className="text-[11px] text-muted">تسک‌دهنده</p>
              <p className="font-bold">{self ? "خودتان" : requester?.full_name}</p>
              {requester?.org_unit ? <p className="text-xs text-muted">{requester.org_unit}</p> : null}
            </div>
          </div>
          {!self ? (
            <div className="flex items-center gap-2.5">
              <Avatar name={assignee?.full_name ?? "?"} src={assignee?.avatar_url} size={36} />
              <div>
                <p className="text-[11px] text-muted">مسئول</p>
                <p className="font-bold">{assignee?.id === userId ? "شما" : assignee?.full_name}</p>
              </div>
            </div>
          ) : null}
          {project ? (
            <Link href={`/projects/${project.id}`} className="flex items-center gap-2 font-semibold text-primary">
              <FolderOpen className="size-4" /> پروژه: {project.name}
            </Link>
          ) : null}
          <div className="flex items-center gap-2 text-muted">
            <CalendarRange className="size-4" />
            {task.kind === "event" ? `رویداد: ${formatJalali(task.event_at, { withTime: true })}` : formatRange(task.start_date, task.end_date)}
          </div>
          <div className="text-xs text-muted">ثبت: {formatJalali(task.created_at, { withTime: true })}</div>
          {github && manifest ? (
            <a href={github.folder} target="_blank" rel="noreferrer" className="flex items-center gap-2 font-semibold text-primary">
              <FolderGit2 className="size-4" /> سوابق تسک در GitHub <ExternalLink className="size-3.5" />
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
                  <Badge tone={f.context === "output" ? "success" : "neutral"}>{f.context === "request" ? "درخواست" : f.context === "prework" ? "پیش‌کار" : f.context === "output" ? "خروجی AI" : "کار اصلی"}</Badge>
                  <span className="text-faint">{formatBytes(f.size)}</span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-bold">یادداشت خصوصی شما</h3>
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
        <h3 className="mb-4 text-sm font-bold text-violet-600 dark:text-violet-300">ورکفلوی پیش‌کار{lastPrework?.state?.flow ? ` — ${lastPrework.state.flow.workflow}` : ""}</h3>
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
          <p className="text-sm text-muted">—</p>
        )}
      </Card>
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-bold text-orange-600 dark:text-orange-300">کار اصلی{lastMain?.state?.flow ? ` — ${lastMain.state.flow.workflow}` : ""}</h3>
        {lastMain ? (
          <>
            {(lastMain.state?.flow?.nodes.length ?? 0) > 1 ? (
              <div className="mb-4">
                <MiniPreworkFlow state={lastMain.state} vertical />
              </div>
            ) : null}
            <TodoList todos={lastMain.state?.todos} />
            {lastMain.external_url ? (
              <a href={lastMain.external_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                مشاهده‌ی اجرا در GitHub Actions <ExternalLink className="size-3" />
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">—</p>
        )}
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="تاریخچه‌ی اجراها" />
        <div className="divide-y divide-line">
          {allJobs.length === 0 ? <p className="px-5 py-6 text-sm text-muted">—</p> : null}
          {allJobs.map((j) => (
            <div key={j.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Badge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</Badge>
              <span className="font-semibold">{KIND_LABEL[j.kind] ?? j.kind}</span>
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

  const inlineMode =
    task.status === "approved" || task.status === "in_progress" ? (defaults.caps.prework ? "prework" : defaults.caps.main ? "main" : undefined) : task.status === "prework_done" || task.status === "main_done" ? "main" : undefined;
  const mine = task.assignee_id === userId;
  const chatTab = (
    <div className="mx-auto max-w-4xl space-y-4">
      <Card className="p-5">
        <TaskConversation taskId={task.id} />
      </Card>
      {inlineMode && mine ? <InlineDispatch key={`${task.id}-${inlineMode}-${task.status}`} task={task} userId={userId} mode={inlineMode} defaults={defaults} /> : null}
      {feedback.length ? (
        <Card className="p-5">
          <h3 className="mb-2 text-sm font-bold">بازخوردهای ثبت‌شده</h3>
          {feedback.map((f, i) => (
            <p key={i} className="text-xs text-muted">
              {f.rating > 0 ? "👍" : "👎"} {FEEDBACK_AGENT[f.agent] ?? f.agent}: {f.comment || "—"} · {timeAgo(f.created_at)}
            </p>
          ))}
        </Card>
      ) : null}
    </div>
  );

  const filesTab = manifest?.runs?.length ? (
    <div className="space-y-3">
      {[...manifest.runs].reverse().map((r) => (
        <Card key={`${r.stage}-${r.n}-${r.job_id}`} className="p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={r.stage === "prework" ? "violet" : "warning"}>{r.stage === "prework" ? "پیش‌کار" : "کار اصلی"}</Badge>
            <span className="font-bold">اجرای {faNum(r.n)}</span>
            <span className="text-xs text-muted">{r.workflow}</span>
            <span className="ms-auto text-xs text-muted">{formatJalali(r.at, { withTime: true })}</span>
          </div>
          {r.models.length ? <p className="ltr mt-1 text-start text-[11px] text-faint">{r.models.join(" · ")}</p> : null}
          <ul className="mt-3 space-y-1">
            {r.outputs.map((p) => (
              <li key={p}>
                <a href={github ? `${github.blob}${p.split("/").map(encodeURIComponent).join("/")}` : "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-surface-muted">
                  <FileText className="size-3.5 shrink-0 text-muted" />
                  <span className="ltr flex-1 truncate text-start font-mono">{p}</span>
                  {r.changed?.some((c) => p.endsWith(c)) ? <Badge tone="success">تغییر در پروژه</Badge> : null}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  ) : repo ? (
    <EmptyState
      icon={<FolderGit2 className="size-6" />}
      title="هنوز سابقه‌ای در GitHub نیست"
      description={github ? undefined : "GitHub وصل نیست؛ خروجی‌ها در «گفت‌وگو» هستند."}
    />
  ) : (
    <Spinner />
  );

  return (
    <div className="space-y-5">
      <Link href="/inbox" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowRight className="size-4" /> کارها
      </Link>
      <Card className="relative overflow-hidden p-5 sm:p-6">
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
          <TaskActions task={task} userId={userId} defaults={defaults} activeJobId={active?.id} />
        </div>
        {related.length ? <p className="mt-3 text-xs text-muted">{faNum(related.length)} تسک مرتبط در این پروژه</p> : null}
      </Card>

      <Tabs
        defaultValue={running ? "log" : allJobs.some((j) => j.kind === "prework" || j.kind === "main") ? "chat" : "overview"}
        items={[
          { value: "overview", label: "جزئیات", content: overview },
          { value: "log", label: running ? <span className="flex items-center gap-2"><span className="live-dot" /> لاگ زنده</span> : "لاگ", content: <LiveLog initial={events} taskId={task.id} live={running} maxHeight="70vh" /> },
          { value: "workflow", label: "اجراها", content: workflow },
          { value: "chat", label: "گفت‌وگو", content: chatTab },
          { value: "files", label: "فایل‌ها", content: filesTab },
        ]}
      />
    </div>
  );
}
