"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot, Download, Eye, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button, Field, Input, Spinner, Textarea } from "@/components/ui/primitives";
import { FileDropzone, type UploadStatus, type UploadedFile } from "@/components/ui/file-dropzone";
import { Markdown } from "@/components/ui/markdown";
import { DispatchFields, run, useDispatch } from "@/components/tasks/task-actions";
import { addTaskFilesAction, deleteTaskFileAction, updateTaskDetailsAction } from "@/app/actions/tasks";
import { timeAgo } from "@/lib/jalali";
import { cn, faNum, formatBytes } from "@/lib/utils";
import type { Task, TaskFile, TaskStatus } from "@/lib/types";
import type { ClaudeRunOptions } from "@/lib/settings";

const LOCKED: TaskStatus[] = ["closed", "cancelled"];
const RUNNING: TaskStatus[] = ["prework_running", "main_running"];

const CONTEXT_LABEL: Record<TaskFile["context"], string> = {
  request: "فایل تسک",
  prework: "همراه پرامپت پیش‌کار",
  main: "همراه دستور Claude",
  output: "خروجی",
  upgrade: "ارتقا",
};

function FileIcon({ mime, name, className }: { mime: string | null; name: string; className?: string }) {
  const m = mime ?? "";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const Icon = m.startsWith("image/")
    ? FileImage
    : m.startsWith("audio/")
      ? FileAudio
      : m.startsWith("video/")
        ? FileVideo
        : /sheet|excel|csv/.test(m) || ["xlsx", "xls", "csv"].includes(ext)
          ? FileSpreadsheet
          : /zip|rar|7z|tar|gzip/.test(m) || ["zip", "rar", "7z"].includes(ext)
            ? FileArchive
            : /pdf|word|text|document/.test(m) || ["pdf", "doc", "docx", "txt", "md"].includes(ext)
              ? FileText
              : File;
  return <Icon className={className} />;
}

/** Title + description, editable by the admin until the task is closed. */
export function TaskDetailsEditor({ task, defaultOpen = true }: { task: Task; defaultOpen?: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description);
  const [busy, setBusy] = React.useState(false);
  const editable = !LOCKED.includes(task.status);

  React.useEffect(() => {
    if (!editing) {
      setTitle(task.title);
      setDescription(task.description);
    }
  }, [task.title, task.description, editing]);

  const save = async () => {
    setBusy(true);
    const ok = await run(updateTaskDetailsAction(task.id, title, description), "عنوان و شرح تسک ذخیره شد");
    setBusy(false);
    if (ok) {
      setEditing(false);
      // realtime delivers the change too; refreshing shows it immediately
      router.refresh();
    }
  };

  if (editing) {
    return (
      <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary-soft/40 p-3">
        <Field label="عنوان تسک" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="شرح تسک" hint="Markdown پشتیبانی می‌شود؛ همین متن همراه پرامپت به پیش‌کار و Claude می‌رود.">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-44" />
        </Field>
        <div className="flex gap-2">
          <Button size="sm" onClick={save} loading={busy} disabled={!title.trim()}>
            ذخیره
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            انصراف
          </Button>
        </div>
      </div>
    );
  }

  return (
    <details className="group rounded-2xl border border-line bg-surface-strong/60 p-3" open={defaultOpen}>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold">
        <span className="flex-1">شرح تسک</span>
        {editable ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5" /> ویرایش عنوان و شرح
          </Button>
        ) : null}
      </summary>
      {task.description ? <Markdown className="mt-2">{task.description}</Markdown> : <p className="mt-2 text-xs text-faint">شرحی ثبت نشده است.</p>}
    </details>
  );
}

/** Attachments of a task: preview, download, delete and add (admin). */
export function TaskFilesManager({ task, userId }: { task: Task; userId: string }) {
  const [files, setFiles] = React.useState<TaskFile[] | null>(null);
  const [adding, setAdding] = React.useState<UploadedFile[]>([]);
  const [addingStatus, setAddingStatus] = React.useState<UploadStatus>({ uploading: 0, failed: 0 });
  const [dropKey, setDropKey] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const onAdding = React.useCallback((f: UploadedFile[], st: UploadStatus) => {
    setAdding(f);
    setAddingStatus(st);
  }, []);
  const locked = LOCKED.includes(task.status);
  const running = RUNNING.includes(task.status);

  const load = React.useCallback(async () => {
    const { data } = await supabaseBrowser().from("task_files").select("*").eq("task_id", task.id).order("created_at");
    setFiles((data ?? []) as TaskFile[]);
  }, [task.id]);

  React.useEffect(() => {
    setFiles(null);
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  const add = async () => {
    setBusy(true);
    const ok = await run(addTaskFilesAction(task.id, adding), `${faNum(adding.length)} فایل به تسک اضافه شد`);
    setBusy(false);
    if (ok) {
      setAdding([]);
      setDropKey((k) => k + 1);
      void load();
    }
  };

  const remove = async (f: TaskFile) => {
    if (confirming !== f.id) {
      setConfirming(f.id);
      return;
    }
    setConfirming(null);
    setDeleting(f.id);
    const ok = await run(deleteTaskFileAction(f.id), `«${f.name}» حذف شد`);
    setDeleting(null);
    if (ok) void load();
  };

  // AI outputs are listed in the conversation under the reply that produced them.
  const shown = files?.filter((f) => f.context !== "upgrade" && f.context !== "output") ?? [];

  return (
    <div className="rounded-2xl border border-line bg-surface-strong/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="flex-1 text-sm font-bold">فایل‌های تسک {files ? <span className="text-xs font-normal text-muted">({faNum(shown.length)})</span> : null}</p>
        {running ? <span className="text-[11px] text-amber-600">در حال اجرا — حذف غیرفعال است</span> : null}
      </div>
      {files === null ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <p className="py-2 text-xs text-faint">تسک‌دهنده فایلی بارگذاری نکرده است.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((f) => {
            const isImage = (f.mime ?? "").startsWith("image/");
            return (
              <li key={f.id} className="flex items-center gap-2.5 py-2">
                {isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${f.id}?inline=1`} alt="" className="size-10 shrink-0 rounded-lg border border-line object-cover" />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted">
                    <FileIcon mime={f.mime} name={f.name} className="size-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p dir="auto" className="truncate text-start text-[13px] font-semibold" title={f.name}>
                    {f.name}
                  </p>
                  <p className="text-[11px] text-faint">
                    {CONTEXT_LABEL[f.context]} · {f.size ? formatBytes(f.size) : "—"} · {timeAgo(f.created_at)}
                  </p>
                </div>
                <a href={`/api/files/${f.id}?inline=1`} target="_blank" rel="noreferrer" title="مشاهده" className="rounded-lg p-2 text-muted transition hover:bg-surface-muted hover:text-fg">
                  <Eye className="size-4" />
                </a>
                <a href={`/api/files/${f.id}`} title="دانلود" className="rounded-lg p-2 text-muted transition hover:bg-surface-muted hover:text-fg">
                  <Download className="size-4" />
                </a>
                {!locked && f.context !== "output" ? (
                  <button
                    onClick={() => void remove(f)}
                    disabled={running || deleting === f.id}
                    title={f.github_path ? "حذف (نسخه‌ی منتشرشده در GitHub باقی می‌ماند)" : "حذف"}
                    className={cn(
                      "flex items-center gap-1 rounded-lg p-2 text-xs font-bold transition disabled:opacity-40",
                      confirming === f.id ? "bg-rose-500/12 text-rose-600" : "text-muted hover:bg-rose-500/10 hover:text-rose-600",
                    )}
                  >
                    {deleting === f.id ? <Spinner className="size-4" /> : <Trash2 className="size-4" />}
                    {confirming === f.id ? "حذف شود؟" : null}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {!locked ? (
        <div className="mt-3 space-y-2">
          <FileDropzone key={dropKey} userId={userId} onChange={onAdding} compact label="بارگذاری فایل جدید برای تسک (هر نوع فایل)" />
          {adding.length ? (
            <Button size="sm" variant="secondary" onClick={add} loading={busy} disabled={addingStatus.uploading > 0}>
              <Plus className="size-4" /> افزودن {faNum(adding.length)} فایل به تسک
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "Send to pre-work / Claude" form rendered inside the task drawer, right before dispatch. */
export function InlineDispatch({
  task,
  userId,
  mode,
  defaultPrompt,
  claudeDefaults,
  onSent,
}: {
  task: Task;
  userId: string;
  mode: "prework" | "main";
  defaultPrompt: string;
  claudeDefaults?: ClaudeRunOptions;
  onSent?: () => void;
}) {
  const router = useRouter();
  const followup = mode === "main" && task.status === "main_done";
  const state = useDispatch(
    mode,
    [task.id],
    () => {
      router.refresh();
      onSent?.();
    },
    claudeDefaults,
  );
  const Icon = mode === "prework" ? Sparkles : Bot;
  return (
    <div className={cn("rounded-2xl border p-3", mode === "prework" ? "border-violet-500/30 bg-violet-500/5" : "border-orange-500/30 bg-orange-500/5")}>
      <p className={cn("mb-1 flex items-center gap-2 text-sm font-extrabold", mode === "prework" ? "text-violet-600 dark:text-violet-300" : "text-orange-600 dark:text-orange-300")}>
        <Icon className="size-4" /> {mode === "prework" ? "ارسال به پیش‌کار (Gemini)" : followup ? "پیام تکمیلی به Claude" : "ارسال به کار اصلی (Claude)"}
      </p>
      <p className="mb-3 text-xs leading-6 text-muted">
        {mode === "prework"
          ? "عنوان، شرح و فایل‌های بالا همراه پرامپت و فایل‌های شما به Gemini داده می‌شوند تا یک دستور کار کوتاه و کامل آماده کند."
          : followup
            ? "Claude همان جلسه و فایل‌های قبلی را ادامه می‌دهد؛ بنویسید چه چیزی را اصلاح یا اضافه کند."
            : "Claude پرامپت شما، عنوان و شرح، دستور کار پیش‌کار و فایل‌ها را می‌گیرد و دقیقاً خروجی خواسته‌شده را تحویل می‌دهد."}
      </p>
      <DispatchFields mode={mode} userId={userId} defaultPrompt={defaultPrompt} state={state} />
      <Button className="mt-4 w-full" onClick={() => void state.submit()} loading={state.busy} disabled={!!state.blocker}>
        <Icon className="size-4" /> {mode === "prework" ? "شروع پیش‌کار" : followup ? "ارسال پیام تکمیلی" : "ارسال به Claude"}
      </Button>
    </div>
  );
}

/** Shown for tasks already waiting in a provider queue: the prompt that was sent. */
export function QueuedNotice({ provider, prompt }: { provider: "gemini" | "claude"; prompt?: string | null }) {
  return (
    <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-3 text-xs leading-6">
      <p className="font-bold text-sky-700 dark:text-sky-300">در صف اجرای {provider === "gemini" ? "Gemini" : "Claude"}</p>
      <p className="text-muted">تا شروع اجرا می‌توانید عنوان، شرح و فایل‌های تسک را اصلاح کنید؛ تغییرات در همین اجرا لحاظ می‌شوند.</p>
      {prompt ? (
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold text-muted">پرامپت ارسال‌شده</summary>
          <p className="mt-1 whitespace-pre-line text-muted">{prompt}</p>
        </details>
      ) : null}
    </div>
  );
}
