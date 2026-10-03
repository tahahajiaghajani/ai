"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bot, CheckCheck, Flag, FolderGit2, MoreHorizontal, Paperclip, PlayCircle, RotateCcw, Sparkles, Undo2, XCircle, Ban, Shuffle, Trash2, FileText } from "lucide-react";
import { DeleteTaskDialog } from "@/components/tasks/delete-project";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { Combobox } from "@/components/ui/combobox";
import { Menu, Modal } from "@/components/ui/overlays";
import { FileDropzone, type UploadStatus, type UploadedFile } from "@/components/ui/file-dropzone";
import {
  approveTasksAction,
  cancelJobAction,
  cancelTaskAction,
  forceStatusAction,
  requestClosureAction,
  returnTaskAction,
  sendToMainAction,
  sendToPreworkAction,
  startTaskAction,
} from "@/app/actions/tasks";
import { projectFilesAction } from "@/app/actions/projects";
import { CLOSABLE, STATUS_META } from "@/lib/status";
import { CLAUDE_EFFORTS, CLAUDE_MODELS, CLAUDE_THINKING, CLAUDE_THINKING_HINT } from "@/lib/claude/options";
import { faNum } from "@/lib/utils";
import type { Task, TaskFile, TaskStatus } from "@/lib/types";
import type { ClaudeRunOptions, DispatchDefaults, MainEngine } from "@/lib/settings";

type Result = { ok: true } | { ok: false; error: string };

export async function run(p: Promise<Result | { ok: boolean; error?: string }>, success: string, after?: () => void) {
  const r = await p;
  if (r.ok) {
    toast.success(success);
    after?.();
  } else toast.error((r as { error: string }).error);
  return r.ok;
}

export type DispatchTask = Pick<Task, "id" | "code" | "title" | "description" | "status" | "project_id">;

const NO_CLAUDE: ClaudeRunOptions = { model: "", effort: "", thinking: "auto" };

/** State + submit for sending tasks to pre-work or to the main work. */
export function useDispatch(mode: "prework" | "main", tasks: DispatchTask[], defaults: DispatchDefaults, onDone?: () => void) {
  const ids = tasks.map((t) => t.id);
  const workflows = defaults.workflows.filter((w) => w.stage === mode);
  const defaultWorkflow = workflows.find((w) => w.isDefault)?.id ?? workflows[0]?.id ?? "";
  const startProject = tasks.length === 1 ? (tasks[0].project_id ?? "") : "";
  const [workflowId, setWorkflowId] = React.useState(defaultWorkflow);
  const [prompt, setPrompt] = React.useState("");
  const [claude, setClaude] = React.useState<ClaudeRunOptions>(defaults.claude ?? NO_CLAUDE);
  const [engine, setEngine] = React.useState<MainEngine>(defaults.engine);
  const [projectId, setProjectId] = React.useState<string>(startProject);
  const [newProject, setNewProject] = React.useState<string>("");
  const [projectFiles, setProjectFiles] = React.useState<string[]>([]);
  const defaultsRef = React.useRef(defaults);
  React.useEffect(() => {
    defaultsRef.current = defaults;
  }, [defaults]);
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [upload, setUpload] = React.useState<UploadStatus>({ uploading: 0, failed: 0 });
  const [busy, setBusy] = React.useState(false);
  const [dropKey, setDropKey] = React.useState(0);
  const onFiles = React.useCallback((f: UploadedFile[], s: UploadStatus) => {
    setFiles(f);
    setUpload(s);
  }, []);
  const reset = React.useCallback(() => {
    setPrompt("");
    setClaude(defaultsRef.current.claude ?? NO_CLAUDE);
    setEngine(defaultsRef.current.engine);
    setProjectId(startProject);
    setNewProject("");
    setProjectFiles([]);
    setFiles([]);
    setUpload({ uploading: 0, failed: 0 });
    setDropKey((k) => k + 1);
  }, [startProject]);
  // never send while an attachment is still uploading or failed: the AI would silently miss it
  const blocker = upload.uploading ? "صبر کنید تا بارگذاری فایل‌ها تمام شود" : upload.failed ? "بارگذاری بعضی فایل‌ها ناموفق بود؛ آن‌ها را دوباره بارگذاری یا حذف کنید" : null;
  const submit = async () => {
    if (blocker) return false;
    setBusy(true);
    const dispatch = { workflowId: workflowId || null, projectId: newProject ? null : projectId || null, newProject: newProject ? { name: newProject } : null, files: projectFiles };
    const ok = await run(
      mode === "prework" ? sendToPreworkAction(ids, prompt, files, dispatch) : sendToMainAction(ids, prompt, files, claude, { ...dispatch, engine }),
      mode === "prework" ? "در صف پیش‌کار قرار گرفت" : "برای کار اصلی ارسال شد",
    );
    setBusy(false);
    if (ok) {
      reset();
      onDone?.();
    }
    return ok;
  };
  return { mode, tasks, prompt, setPrompt, files, onFiles, busy, submit, reset, dropKey, blocker, claude, setClaude, engine, setEngine, workflows, workflowId, setWorkflowId, projectId, setProjectId, newProject, setNewProject, projectFiles, setProjectFiles };
}

const optionLabel = (list: { value: string; label: string }[], v: string) => list.find((o) => o.value === v)?.label.split(" — ")[0] ?? v;

/** Model, effort and thinking for one Claude Code run (pre-filled from Settings). */
function ClaudeRunFields({ value, onChange }: { value: ClaudeRunOptions; onChange: (v: ClaudeRunOptions) => void }) {
  const custom = !CLAUDE_MODELS.some((m) => m.value === value.model);
  return (
    <details className="rounded-xl border border-line px-3 py-2 text-xs">
      <summary className="cursor-pointer font-semibold text-muted">
        Claude Code: <span className="text-fg">{custom ? <span className="ltr">{value.model}</span> : optionLabel(CLAUDE_MODELS, value.model)}</span> · Effort: <span className="text-fg">{optionLabel(CLAUDE_EFFORTS, value.effort)}</span> · Thinking:{" "}
        <span className="text-fg">{optionLabel(CLAUDE_THINKING, value.thinking)}</span>
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="مدل">
          <Select value={custom ? "custom" : value.model} onChange={(e) => onChange({ ...value, model: e.target.value === "custom" ? value.model || "claude-" : e.target.value })}>
            {CLAUDE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
            <option value="custom">نام کامل مدل…</option>
          </Select>
          {custom ? <Input dir="ltr" className="mt-2" value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value })} placeholder="claude-opus-5-5" /> : null}
        </Field>
        <Field label="Effort">
          <Select value={value.effort} onChange={(e) => onChange({ ...value, effort: e.target.value as ClaudeRunOptions["effort"] })}>
            {CLAUDE_EFFORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Thinking">
          <Select value={value.thinking} onChange={(e) => onChange({ ...value, thinking: e.target.value as ClaudeRunOptions["thinking"] })}>
            {CLAUDE_THINKING.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="mt-2 leading-6 text-muted">{CLAUDE_THINKING_HINT}</p>
    </details>
  );
}

/**
 * The project the work belongs to. By default none (no knowledge is searched). Picking a project
 * gives the AI its description, knowledge file and file map; typing a new name creates a project so
 * knowledge starts being built. Files of the project can be pointed at with the searchable picker.
 */
export function ProjectPicker({ state, defaults }: { state: ReturnType<typeof useDispatch>; defaults: DispatchDefaults }) {
  const [files, setFiles] = React.useState<{ path: string; kind: string; summary: string | null; symbols: string[] }[] | null>(null);
  const pid = state.projectId;
  React.useEffect(() => {
    if (!pid) {
      setFiles(null);
      return;
    }
    let live = true;
    setFiles(null);
    void projectFilesAction(pid).then((r) => {
      if (live) setFiles(r.ok ? r.data : []);
    });
    return () => {
      live = false;
    };
  }, [pid]);

  if (!defaults.caps.github) {
    return (
      <p className="rounded-xl border border-dashed border-line px-3 py-2 text-xs leading-6 text-muted">
        <FolderGit2 className="me-1 inline size-3.5" />
        پروژه‌ها و دانش پروژه در GitHub شما ذخیره می‌شوند. برای انتخاب پروژه یا ساخت پروژه‌ی جدید{" "}
        <Link href="/settings#connections" className="font-bold text-primary">
          GitHub را وصل کنید
        </Link>
        ؛ بدون آن کار فقط با پرامپت و فایل‌های همین ارسال انجام می‌شود.
      </p>
    );
  }
  const options = [
    ...(state.newProject ? [{ value: "__new", label: `${state.newProject} (پروژه‌ی جدید)` }] : []),
    ...defaults.projects.map((p) => ({ value: p.id, label: p.name, hint: `${p.slug} · ${faNum(p.files)} فایل`, keywords: p.slug })),
  ];
  return (
    <div className="space-y-3 rounded-2xl border border-line p-3">
      <Field label="پروژه‌ی مرتبط (اختیاری)" hint="پیش‌فرض: بدون پروژه — دنبال دانش نمی‌گردد. با انتخاب پروژه، توضیحات، دانش و نقشه‌ی فایل‌های آن به مدل داده می‌شود و تغییرات در همان پروژه ذخیره می‌شود؛ نام جدید بنویسید تا پروژه ساخته شود.">
        <Combobox
          options={options}
          value={state.newProject ? ["__new"] : pid ? [pid] : []}
          onChange={(v) => {
            if (v[0] === "__new") return;
            state.setNewProject("");
            state.setProjectId(v[0] ?? "");
            state.setProjectFiles([]);
          }}
          placeholder="بدون پروژه"
          searchPlaceholder="نام پروژه را جستجو کنید یا نام جدید بنویسید…"
          create={{ label: (q) => `+ ساخت پروژه‌ی جدید «${q}»`, onCreate: (q) => {
            state.setNewProject(q);
            state.setProjectId("");
            state.setProjectFiles([]);
          } }}
        />
      </Field>
      {pid ? (
        <Field label="فایل‌های مرتبط در پروژه (اختیاری)" hint="فایل‌هایی که می‌دانید به کار مربوط‌اند؛ کامل به مدل داده می‌شوند. مجری بقیه‌ی فایل‌ها را خودش پیدا می‌کند.">
          <Combobox
            multiple
            options={(files ?? []).map((f) => ({ value: f.path, label: f.path, ltr: true, hint: f.summary ?? undefined, keywords: f.symbols.join(" "), icon: <FileText className="size-3.5" /> }))}
            value={state.projectFiles}
            onChange={state.setProjectFiles}
            placeholder={files === null ? "در حال خواندن فایل‌های پروژه…" : files.length ? "جستجو در فایل‌ها (نام، خلاصه یا نام تابع)…" : "این پروژه هنوز فایلی ندارد"}
            disabled={!files?.length}
            searchPlaceholder="مثلاً audit.cs یا wbs"
          />
        </Field>
      ) : null}
    </div>
  );
}

/** Prompt, project, files and run options shared by the dialog and the task drawer. */
export function DispatchFields({ mode, userId, defaults, state }: { mode: "prework" | "main"; userId: string; defaults: DispatchDefaults; state: ReturnType<typeof useDispatch> }) {
  const defaultPrompt = mode === "prework" ? defaults.prework : defaults.main;
  const usingDefault = !state.prompt.trim();
  const single = state.tasks.length === 1 ? state.tasks[0] : null;
  return (
    <div className="space-y-4">
      {state.workflows.length > 1 ? (
        <Field label="ورکفلو" hint={<>ترتیب ایجنت‌ها را در <a href="/agents" className="font-bold text-primary">ایجنت‌ها و ورکفلوها</a> می‌سازید.</>}>
          <Select value={state.workflowId} onChange={(e) => state.setWorkflowId(e.target.value)}>
            {state.workflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.isDefault ? " (پیش‌فرض)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="پرامپت شما" hint={usingDefault ? "خالی است؛ پرامپت پیش‌فرض تنظیمات ارسال می‌شود. عنوان و شرح تسک به مدل فرستاده نمی‌شوند." : "فقط همین پرامپت و فایل‌های پیوست به مدل داده می‌شود (نه عنوان و شرح تسک)."}>
        <Textarea
          value={state.prompt}
          onChange={(e) => state.setPrompt(e.target.value)}
          className="min-h-36"
          placeholder={mode === "prework" ? "چه چیزی باید بررسی و آماده شود؟ مثلاً: «در پروژه renew فایل audit.cs باگ دارد؛ علت را پیدا کن»" : "دستور شما به مجری، مثلاً: «در پروژه renew یک ماژول جدید به نام مرکز فناوری اطلاعات بساز»"}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        {single?.description ? (
          <Button type="button" size="sm" variant="outline" onClick={() => state.setPrompt(single.description)}>
            درج شرح تسک در پرامپت
          </Button>
        ) : null}
        {defaultPrompt ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => state.setPrompt(defaultPrompt)}>
            درج پرامپت پیش‌فرض
          </Button>
        ) : null}
      </div>
      <ProjectPicker state={state} defaults={defaults} />
      <Field label="فایل‌های جدید همراه پرامپت (هر نوع فایل)" hint="کامل به مدل داده می‌شوند (PDF و تصویر مستقیم؛ Word و متن به صورت متن) و در سابقه‌ی همین تسک در GitHub هم ذخیره می‌شوند.">
        <FileDropzone key={state.dropKey} userId={userId} onChange={state.onFiles} compact />
      </Field>
      {mode === "main" ? (
        <Field label="مجری" hint={defaults.caps.claudeCode ? undefined : "برای Claude Code در GitHub Actions، آن را در «تنظیمات ← اتصال‌ها» فعال کنید."}>
          <Select value={state.engine} onChange={(e) => state.setEngine(e.target.value as MainEngine)}>
            <option value="agent">ایجنت مجری داخل اپ (مدل اتصالِ کار اصلی)</option>
            <option value="claude_code" disabled={!defaults.caps.claudeCode}>
              Claude Code در GitHub Actions{defaults.caps.claudeCode ? "" : " (راه‌اندازی نشده)"}
            </option>
          </Select>
        </Field>
      ) : null}
      {mode === "main" && state.engine === "claude_code" ? <ClaudeRunFields value={state.claude} onChange={state.setClaude} /> : null}
      {state.blocker ? <p className="text-xs font-semibold text-amber-700">{state.blocker}</p> : null}
    </div>
  );
}

/** Code, title and attachment names of the tasks about to be sent (for the user, not the model). */
function DispatchSummary({ tasks, open }: { tasks: DispatchTask[]; open: boolean }) {
  const [attached, setAttached] = React.useState<Pick<TaskFile, "task_id" | "name">[] | null>(null);
  const idsKey = tasks.map((t) => t.id).join(",");
  React.useEffect(() => {
    if (!open || !idsKey) return;
    setAttached(null);
    void supabaseBrowser()
      .from("task_files")
      .select("task_id, name")
      .in("task_id", idsKey.split(","))
      .eq("context", "request")
      .order("created_at")
      .then(({ data }) => setAttached((data ?? []) as Pick<TaskFile, "task_id" | "name">[]));
  }, [open, idsKey]);
  return (
    <div className="rounded-2xl border border-line bg-surface-muted/50 p-3">
      <p className="mb-2 text-xs font-bold text-muted">{tasks.length === 1 ? "تسک" : `${faNum(tasks.length)} تسک`}</p>
      <div className="max-h-36 space-y-1.5 overflow-y-auto">
        {tasks.map((t) => {
          const own = attached?.filter((f) => f.task_id === t.id) ?? [];
          return (
            <div key={t.id} className="rounded-xl bg-surface-strong px-3 py-2 text-sm">
              <span className="ltr me-1.5 inline-block text-xs text-muted">{t.code}</span>
              <b>{t.title}</b>
              {own.length ? (
                <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                  <Paperclip className="size-3" />
                  {own.slice(0, 6).map((f, i) => (
                    <span key={i} className="ltr rounded bg-surface-muted px-1.5">
                      {f.name}
                    </span>
                  ))}
                  <span>(همراه ارسال می‌شوند)</span>
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Prompt + project + attachments dialog for "send to pre-work" and "send to main work" (single or bulk). */
export function PromptDialog({
  open,
  onOpenChange,
  mode,
  tasks,
  userId,
  defaults,
  title,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "prework" | "main";
  tasks: DispatchTask[];
  userId: string;
  defaults: DispatchDefaults;
  title?: string;
  onDone?: () => void;
}) {
  const state = useDispatch(mode, tasks, defaults, () => {
    onOpenChange(false);
    onDone?.();
  });
  const { reset } = state;
  React.useEffect(() => {
    if (open) reset();
  }, [open, reset]);
  const ready = mode === "prework" ? defaults.caps.prework : state.engine === "claude_code" ? defaults.caps.claudeCode : defaults.caps.main;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={title ?? (mode === "prework" ? "ارسال به پیش‌کار" : "ارسال به کار اصلی")}
      description={
        mode === "prework"
          ? "ایجنت‌های پیش‌کار پرامپت و فایل‌های شما (و در صورت انتخاب، پروژه) را تحلیل می‌کنند و یک دستور کار کوتاه و کامل می‌سازند."
          : "مجری فایل‌های مرتبط را پیدا می‌کند، می‌خواند، ویرایش یا ایجاد می‌کند؛ در پروژه، فایل‌ها در جای خودشان به‌روز می‌شوند."
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button onClick={() => void state.submit()} loading={state.busy} disabled={!tasks.length || !!state.blocker || !ready}>
            {mode === "prework" ? <Sparkles className="size-4" /> : <Bot className="size-4" />}
            {mode === "prework" ? "شروع پیش‌کار" : "شروع کار اصلی"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!ready ? (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold leading-6 text-amber-700 dark:text-amber-300">
            هنوز هیچ اتصال هوش مصنوعی برای این مرحله انتخاب نکرده‌اید.{" "}
            <Link href="/settings#connections" className="underline">
              تنظیمات ← اتصال‌ها و مدل‌ها
            </Link>
          </p>
        ) : null}
        <DispatchSummary tasks={tasks} open={open} />
        <DispatchFields mode={mode} userId={userId} defaults={defaults} state={state} />
      </div>
    </Modal>
  );
}

export function TextDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  required,
  confirm,
  danger,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  label: string;
  required?: boolean;
  confirm: string;
  danger?: boolean;
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            disabled={required && !text.trim()}
            onClick={async () => {
              setBusy(true);
              const ok = await onSubmit(text);
              setBusy(false);
              if (ok) {
                setText("");
                onOpenChange(false);
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <Field label={label} required={required}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

/** Actions of the assignee in the full app (AI work, statuses) — the app owner may step in too. */
export function TaskActions({
  task,
  userId,
  defaults,
  activeJobId,
  size = "md",
  onChanged,
  inlineMode,
}: {
  task: Task;
  userId: string;
  defaults: DispatchDefaults;
  activeJobId?: string | null;
  size?: "sm" | "md";
  onChanged?: () => void;
  /** send form already shown inline (task drawer): skip the button that would open the same dialog */
  inlineMode?: "prework" | "main";
}) {
  const [dialog, setDialog] = React.useState<null | "prework" | "main" | "return" | "close" | "cancel" | "force" | "delete">(null);
  const [forceTo, setForceTo] = React.useState<TaskStatus>("approved");
  const [busy, setBusy] = React.useState(false);
  // mutating actions return the refreshed page themselves (see `mutate`)
  const refresh = () => onChanged?.();
  const s = task.status;
  const btn = size === "sm" ? "sm" : "md";
  const self = task.requester_id === task.assignee_id;

  const primary: React.ReactNode[] = [];
  if (s === "pending_approval" || s === "returned") {
    primary.push(
      <Button
        key="approve"
        size={btn}
        variant="success"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          await run(approveTasksAction([task.id]), "تسک پذیرفته شد", refresh);
          setBusy(false);
        }}
      >
        <CheckCheck className="size-4" /> پذیرش
      </Button>,
    );
    if (!self)
      primary.push(
        <Button key="return" size={btn} variant="outline" onClick={() => setDialog("return")}>
          <Undo2 className="size-4" /> برگشت
        </Button>,
      );
  }
  if (["approved", "in_progress", "prework_done", "main_done", "closure_rejected"].includes(s) && inlineMode !== "prework") {
    primary.push(
      <Button key="pw" size={btn} variant={s === "approved" ? "primary" : "secondary"} onClick={() => setDialog("prework")}>
        <Sparkles className="size-4" /> {s === "approved" || s === "in_progress" ? "ارسال به پیش‌کار" : "پیش‌کار جدید"}
      </Button>,
    );
  }
  if (["approved", "in_progress", "prework_done", "main_done", "closure_rejected"].includes(s) && inlineMode !== "main") {
    primary.push(
      <Button key="main" size={btn} variant={s === "prework_done" ? "primary" : "secondary"} onClick={() => setDialog("main")}>
        <Bot className="size-4" /> {s === "main_done" ? "دستور تکمیلی" : "ارسال به کار اصلی"}
      </Button>,
    );
  }
  if (s === "approved" || s === "closure_rejected") {
    primary.push(
      <Button key="start" size={btn} variant="ghost" onClick={() => void run(startTaskAction(task.id), "وضعیت: در حال انجام", refresh)}>
        <PlayCircle className="size-4" /> شروع دستی
      </Button>,
    );
  }
  if (["prework_queued", "prework_running", "main_queued", "main_running"].includes(s) && activeJobId) {
    primary.push(
      <Button key="stop" size={btn} variant="outline" onClick={() => void run(cancelJobAction(activeJobId), "اجرا لغو شد", refresh)}>
        <XCircle className="size-4" /> توقف اجرا
      </Button>,
    );
  }
  if (CLOSABLE.includes(s)) {
    primary.push(
      <Button key="close" size={btn} variant={s === "main_done" ? "primary" : "ghost"} onClick={() => setDialog("close")}>
        <Flag className="size-4" /> {self ? "خاتمه" : "اعلام انجام"}
      </Button>,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary}
      <Menu
        trigger={
          <Button size="icon" variant="ghost" aria-label="بیشتر">
            <MoreHorizontal className="size-5" />
          </Button>
        }
        items={[
          { label: "تغییر دستی وضعیت", icon: <Shuffle className="size-4" />, onSelect: () => setDialog("force") },
          ...(s === "closure_pending" ? [{ label: "بازگشت به کار اصلی", icon: <RotateCcw className="size-4" />, onSelect: () => void run(forceStatusAction(task.id, "main_done"), "تسک به مرحله‌ی کار اصلی برگشت", refresh) }] : []),
          "sep",
          { label: "لغو تسک", icon: <Ban className="size-4" />, danger: true, disabled: s === "cancelled" || s === "closed", onSelect: () => setDialog("cancel") },
          { label: "حذف کامل تسک", icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setDialog("delete") },
        ]}
      />

      <DeleteTaskDialog task={task} open={dialog === "delete"} onOpenChange={(o) => setDialog(o ? "delete" : null)} onDeleted={onChanged} />
      <PromptDialog open={dialog === "prework"} onOpenChange={(o) => setDialog(o ? "prework" : null)} mode="prework" tasks={[task]} userId={userId} defaults={defaults} onDone={refresh} />
      <PromptDialog
        open={dialog === "main"}
        onOpenChange={(o) => setDialog(o ? "main" : null)}
        mode="main"
        tasks={[task]}
        userId={userId}
        defaults={defaults}
        title={s === "main_done" ? "دستور تکمیلی (ادامه‌ی همین کار)" : undefined}
        onDone={refresh}
      />
      <TextDialog
        open={dialog === "return"}
        onOpenChange={(o) => setDialog(o ? "return" : null)}
        title="برگشت تسک به تسک‌دهنده"
        description="تسک‌دهنده این توضیح را می‌بیند و پس از اصلاح دوباره ارسال می‌کند."
        label="توضیحات برگشت"
        required
        confirm="برگشت بزن"
        onSubmit={(t) => run(returnTaskAction(task.id, t), "تسک برگشت خورد", refresh)}
      />
      <TextDialog
        open={dialog === "close"}
        onOpenChange={(o) => setDialog(o ? "close" : null)}
        title={self ? "خاتمه‌ی تسک" : "اعلام انجام کار"}
        description={self ? "تسک بسته می‌شود و اجراهای فعال متوقف می‌شوند." : "تسک‌دهنده باید خاتمه را تایید یا با توضیحات رد کند. اجراهای فعال متوقف می‌شوند."}
        label={self ? "یادداشت (اختیاری)" : "یادداشت برای تسک‌دهنده (اختیاری)"}
        confirm={self ? "خاتمه" : "اعلام انجام"}
        onSubmit={(t) => run(requestClosureAction(task.id, t), self ? "تسک بسته شد" : "انجام کار اعلام شد", refresh)}
      />
      <TextDialog open={dialog === "cancel"} onOpenChange={(o) => setDialog(o ? "cancel" : null)} title="لغو تسک" label="دلیل لغو" confirm="لغو تسک" danger onSubmit={(t) => run(cancelTaskAction(task.id, t), "تسک لغو شد", refresh)} />
      <Modal
        open={dialog === "force"}
        onOpenChange={(o) => setDialog(o ? "force" : null)}
        title="تغییر دستی وضعیت"
        description="برای بازگرداندن تسک به یک مرحله‌ی قبلی. اجراهای فعال متوقف می‌شوند."
        footer={
          <Button
            onClick={() =>
              run(forceStatusAction(task.id, forceTo), "وضعیت تغییر کرد", () => {
                setDialog(null);
                refresh();
              })
            }
          >
            اعمال
          </Button>
        }
      >
        <Field label="وضعیت جدید">
          <Select value={forceTo} onChange={(e) => setForceTo(e.target.value as TaskStatus)}>
            {(Object.keys(STATUS_META) as TaskStatus[])
              .filter((x) => !["prework_queued", "prework_running", "main_queued", "main_running"].includes(x))
              .map((x) => (
                <option key={x} value={x}>
                  {STATUS_META[x].label}
                </option>
              ))}
          </Select>
        </Field>
      </Modal>
    </div>
  );
}
