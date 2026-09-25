"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, CheckCheck, Flag, MoreHorizontal, Paperclip, RotateCcw, Sparkles, Undo2, XCircle, Ban, Shuffle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Button, Field, Select, Textarea } from "@/components/ui/primitives";
import { Menu, Modal } from "@/components/ui/overlays";
import { FileDropzone, type UploadedFile } from "@/components/ui/file-dropzone";
import {
  approveTasksAction,
  cancelJobAction,
  cancelTaskAction,
  forceStatusAction,
  requestClosureAction,
  returnTaskAction,
  sendToMainAction,
  sendToPreworkAction,
} from "@/app/actions/tasks";
import { CLOSABLE, STATUS_META } from "@/lib/status";
import { faNum } from "@/lib/utils";
import type { Task, TaskFile, TaskStatus } from "@/lib/types";

type Result = { ok: true } | { ok: false; error: string };

export async function run(p: Promise<Result | { ok: boolean; error?: string }>, success: string, after?: () => void) {
  const r = await p;
  if (r.ok) {
    toast.success(success);
    after?.();
  } else toast.error((r as { error: string }).error);
  return r.ok;
}

export type DispatchTask = Pick<Task, "id" | "code" | "title" | "description" | "status">;

/** State + submit for sending tasks to pre-work (Gemini) or the main work (Claude). */
export function useDispatch(mode: "prework" | "main", ids: string[], onDone?: () => void) {
  const [prompt, setPrompt] = React.useState("");
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [dropKey, setDropKey] = React.useState(0);
  const onFiles = React.useCallback((f: UploadedFile[]) => setFiles(f), []);
  const reset = React.useCallback(() => {
    setPrompt("");
    setFiles([]);
    setDropKey((k) => k + 1);
  }, []);
  const submit = async () => {
    setBusy(true);
    const action = mode === "prework" ? sendToPreworkAction : sendToMainAction;
    const ok = await run(action(ids, prompt, files), mode === "prework" ? "در صف پیش‌کار Gemini قرار گرفت" : "برای Claude ارسال شد");
    setBusy(false);
    if (ok) {
      reset();
      onDone?.();
    }
    return ok;
  };
  return { prompt, setPrompt, files, onFiles, busy, submit, reset, dropKey };
}

/** Prompt textarea, default-prompt preview and attachment dropzone shared by the dialog and the task drawer. */
export function DispatchFields({ mode, userId, defaultPrompt, state }: { mode: "prework" | "main"; userId: string; defaultPrompt: string; state: ReturnType<typeof useDispatch> }) {
  const usingDefault = !state.prompt.trim();
  return (
    <div className="space-y-4">
      <Field
        label="پرامپت شما"
        hint={usingDefault ? "خالی است؛ پرامپت پیش‌فرض «تنظیمات و اتصال‌ها» ارسال می‌شود." : "این پرامپت به‌جای پرامپت پیش‌فرض همراه عنوان و شرح تسک ارسال می‌شود."}
      >
        <Textarea
          value={state.prompt}
          onChange={(e) => state.setPrompt(e.target.value)}
          className="min-h-36"
          placeholder={mode === "prework" ? "خواسته‌ها، محدودیت‌ها، منابع یا نکاتی که ایجنت‌های Gemini باید رعایت کنند…" : "دستور شما به Claude برای تکمیل کار…"}
        />
      </Field>
      {defaultPrompt ? (
        <details className="rounded-xl border border-dashed border-line px-3 py-2 text-xs">
          <summary className="cursor-pointer font-semibold text-muted">پرامپت پیش‌فرض (در صورت خالی بودن)</summary>
          <p className="mt-2 whitespace-pre-line leading-6 text-muted">{defaultPrompt}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => state.setPrompt(defaultPrompt)}>
            درج در کادر برای ویرایش
          </Button>
        </details>
      ) : null}
      <Field
        label="فایل‌های همراه پرامپت (هر نوع فایل)"
        hint={
          mode === "prework"
            ? "PDF، تصویر، صوت و ویدیو مستقیماً به Gemini داده می‌شوند؛ متن و Word استخراج می‌شود؛ همه‌چیز در GitHub هم ذخیره می‌شود."
            : "در پوشه‌ی inputs/main همان تسک در GitHub قرار می‌گیرند و Claude آن‌ها را می‌خواند."
        }
      >
        <FileDropzone key={state.dropKey} userId={userId} onChange={state.onFiles} compact />
      </Field>
    </div>
  );
}

/** Title, description and attachment names of the tasks about to be sent. */
function DispatchSummary({ tasks, mode, open }: { tasks: DispatchTask[]; mode: "prework" | "main"; open: boolean }) {
  const [attached, setAttached] = React.useState<Pick<TaskFile, "task_id" | "name" | "context">[] | null>(null);
  const idsKey = tasks.map((t) => t.id).join(",");
  React.useEffect(() => {
    if (!open || !idsKey) return;
    setAttached(null);
    void supabaseBrowser()
      .from("task_files")
      .select("task_id, name, context")
      .in("task_id", idsKey.split(","))
      .in("context", mode === "prework" ? ["request"] : ["request", "prework", "output"])
      .order("created_at")
      .then(({ data }) => setAttached((data ?? []) as Pick<TaskFile, "task_id" | "name" | "context">[]));
  }, [open, idsKey, mode]);
  const single = tasks.length === 1;
  return (
    <div className="rounded-2xl border border-line bg-surface-muted/50 p-3">
      <p className="mb-2 text-xs font-bold text-muted">{single ? "تسک ارسالی" : `${faNum(tasks.length)} تسک ارسالی`}</p>
      <div className="max-h-44 space-y-2 overflow-y-auto">
        {tasks.map((t) => {
          const own = attached?.filter((f) => f.task_id === t.id) ?? [];
          return (
            <details key={t.id} className="rounded-xl bg-surface-strong px-3 py-2" open={single}>
              <summary className="cursor-pointer text-sm font-bold">
                <span className="ltr mx-1.5 inline-block text-xs text-muted">{t.code}</span>
                {t.title}
              </summary>
              {t.description ? <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-xs leading-6 text-muted">{t.description}</p> : null}
              {own.length ? (
                <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                  <Paperclip className="size-3" />
                  {own.slice(0, 6).map((f, i) => (
                    <span key={i} className="ltr rounded bg-surface-muted px-1.5">
                      {f.name}
                    </span>
                  ))}
                  {own.length > 6 ? <span>+{faNum(own.length - 6)}</span> : null}
                </p>
              ) : null}
            </details>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Prompt + attachments dialog used for "send to pre-work" and "send to Claude" (single or bulk).
 * The task title and description always travel with the prompt; an empty prompt falls back to
 * the default prompt from Settings (resolved on the server).
 */
export function PromptDialog({
  open,
  onOpenChange,
  mode,
  tasks,
  userId,
  defaultPrompt,
  title,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "prework" | "main";
  tasks: DispatchTask[];
  userId: string;
  defaultPrompt: string;
  title?: string;
  onDone?: () => void;
}) {
  const ids = tasks.map((t) => t.id);
  const state = useDispatch(mode, ids, () => {
    onOpenChange(false);
    onDone?.();
  });
  const { reset } = state;
  React.useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={title ?? (mode === "prework" ? "ارسال به پیش‌کار (Gemini)" : "ارسال به کار اصلی (Claude)")}
      description={
        mode === "prework"
          ? "عنوان، شرح و فایل‌های تسک همراه پرامپت و فایل‌های شما به ورکفلوی چندعاملی پیش‌کار داده می‌شود: تحقیق ← WBS ← روش انجام ← اجرای کارهای ساده ← انتشار در GitHub"
          : "Claude Code عنوان و شرح تسک، همه‌ی فایل‌های پیش‌کار در GitHub و پرامپت و فایل‌های شما را می‌گیرد، کار را تمام می‌کند و خروجی نهایی را با دیتا مپینگ در پوشه‌ی final ذخیره می‌کند."
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button onClick={() => void state.submit()} loading={state.busy} disabled={!ids.length}>
            {mode === "prework" ? <Sparkles className="size-4" /> : <Bot className="size-4" />}
            {mode === "prework" ? "شروع پیش‌کار" : "ارسال به Claude"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <DispatchSummary tasks={tasks} mode={mode} open={open} />
        <DispatchFields mode={mode} userId={userId} defaultPrompt={defaultPrompt} state={state} />
      </div>
    </Modal>
  );
}

function TextDialog({
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
  defaults: { prework: string; main: string };
  activeJobId?: string | null;
  size?: "sm" | "md";
  onChanged?: () => void;
  /** send form already shown inline (task drawer): skip the button that would open the same dialog */
  inlineMode?: "prework" | "main";
}) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<null | "prework" | "main" | "return" | "close" | "cancel" | "force">(null);
  const [forceTo, setForceTo] = React.useState<TaskStatus>("approved");
  const [busy, setBusy] = React.useState(false);
  const refresh = () => {
    router.refresh();
    onChanged?.();
  };
  const s = task.status;
  const btn = size === "sm" ? "sm" : "md";

  const primary: React.ReactNode[] = [];
  if (s === "pending_approval" || s === "returned") {
    primary.push(
      <Button key="approve" size={btn} variant="success" loading={busy} onClick={async () => {
        setBusy(true);
        await run(approveTasksAction([task.id]), "تسک تایید شد و به صف پیش‌کار رفت", refresh);
        setBusy(false);
      }}>
        <CheckCheck className="size-4" /> تایید
      </Button>,
      <Button key="return" size={btn} variant="outline" onClick={() => setDialog("return")}>
        <Undo2 className="size-4" /> برگشت
      </Button>,
    );
  }
  if (["approved", "prework_done", "main_done", "closure_rejected"].includes(s) && inlineMode !== "prework") {
    primary.push(
      <Button key="pw" size={btn} variant={s === "approved" ? "primary" : "secondary"} onClick={() => setDialog("prework")}>
        <Sparkles className="size-4" /> {s === "approved" ? "ارسال به پیش‌کار" : "پیش‌کار جدید"}
      </Button>,
    );
  }
  if (["prework_done", "main_done", "closure_rejected", "approved"].includes(s) && inlineMode !== "main") {
    primary.push(
      <Button key="main" size={btn} variant={s === "prework_done" ? "primary" : "secondary"} onClick={() => setDialog("main")}>
        <Bot className="size-4" /> {s === "main_done" ? "دستور تکمیلی به Claude" : "ارسال به Claude"}
      </Button>,
    );
  }
  if (["prework_queued", "prework_running", "main_queued", "main_running"].includes(s) && activeJobId) {
    primary.push(
      <Button key="stop" size={btn} variant="outline" onClick={async () => {
        await run(cancelJobAction(activeJobId), "اجرا لغو شد", refresh);
      }}>
        <XCircle className="size-4" /> توقف اجرا
      </Button>,
    );
  }
  if (CLOSABLE.includes(s)) {
    primary.push(
      <Button key="close" size={btn} variant={s === "main_done" ? "primary" : "ghost"} onClick={() => setDialog("close")}>
        <Flag className="size-4" /> اعلام خاتمه
      </Button>,
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary}
      <Menu
        trigger={
          <Button size={size === "sm" ? "icon" : "icon"} variant="ghost" aria-label="بیشتر">
            <MoreHorizontal className="size-5" />
          </Button>
        }
        items={[
          { label: "تغییر دستی وضعیت", icon: <Shuffle className="size-4" />, onSelect: () => setDialog("force") },
          ...(s === "closure_pending"
            ? [{ label: "بازگشت به کار اصلی", icon: <RotateCcw className="size-4" />, onSelect: () => void run(forceStatusAction(task.id, "main_done"), "تسک به مرحله‌ی کار اصلی برگشت", refresh) }]
            : []),
          "sep",
          { label: "لغو تسک", icon: <Ban className="size-4" />, danger: true, disabled: s === "cancelled" || s === "closed", onSelect: () => setDialog("cancel") },
        ]}
      />

      <PromptDialog open={dialog === "prework"} onOpenChange={(o) => setDialog(o ? "prework" : null)} mode="prework" tasks={[task]} userId={userId} defaultPrompt={defaults.prework} onDone={refresh} />
      <PromptDialog
        open={dialog === "main"}
        onOpenChange={(o) => setDialog(o ? "main" : null)}
        mode="main"
        tasks={[task]}
        userId={userId}
        defaultPrompt={defaults.main}
        title={s === "main_done" ? "دستور تکمیلی به Claude (ادامه‌ی همان پروژه)" : undefined}
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
        title="اعلام خاتمه"
        description="تسک‌دهنده باید خاتمه را تایید یا با توضیحات رد کند. اجراهای فعال متوقف می‌شوند."
        label="یادداشت خاتمه برای تسک‌دهنده (اختیاری)"
        confirm="اعلام خاتمه"
        onSubmit={(t) => run(requestClosureAction(task.id, t), "خاتمه اعلام شد", refresh)}
      />
      <TextDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title="لغو تسک"
        label="دلیل لغو"
        confirm="لغو تسک"
        danger
        onSubmit={(t) => run(cancelTaskAction(task.id, t), "تسک لغو شد", refresh)}
      />
      <Modal
        open={dialog === "force"}
        onOpenChange={(o) => setDialog(o ? "force" : null)}
        title="تغییر دستی وضعیت"
        description="برای بازگرداندن تسک به یک مرحله‌ی قبلی. اجراهای فعال متوقف می‌شوند."
        footer={
          <Button onClick={() => run(forceStatusAction(task.id, forceTo), "وضعیت تغییر کرد", () => { setDialog(null); refresh(); })}>
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
