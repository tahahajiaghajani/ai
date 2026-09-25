"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, CheckCheck, Flag, MoreHorizontal, RotateCcw, Sparkles, Undo2, XCircle, Ban, Shuffle } from "lucide-react";
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
import type { Task, TaskStatus } from "@/lib/types";

type Result = { ok: true } | { ok: false; error: string };

export async function run(p: Promise<Result | { ok: boolean; error?: string }>, success: string, after?: () => void) {
  const r = await p;
  if (r.ok) {
    toast.success(success);
    after?.();
  } else toast.error((r as { error: string }).error);
  return r.ok;
}

/** Prompt + attachments dialog used for "send to pre-work" and "send to Claude" (single or bulk). */
export function PromptDialog({
  open,
  onOpenChange,
  mode,
  taskIds,
  userId,
  defaultPrompt,
  title,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "prework" | "main";
  taskIds: string[];
  userId: string;
  defaultPrompt: string;
  title?: string;
  onDone?: () => void;
}) {
  const [prompt, setPrompt] = React.useState(defaultPrompt);
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [busy, setBusy] = React.useState(false);
  const onFiles = React.useCallback((f: UploadedFile[]) => setFiles(f), []);

  React.useEffect(() => {
    if (open) setPrompt(defaultPrompt);
  }, [open, defaultPrompt]);

  const submit = async () => {
    setBusy(true);
    const action = mode === "prework" ? sendToPreworkAction : sendToMainAction;
    const ok = await run(action(taskIds, prompt, files), mode === "prework" ? "در صف پیش‌کار Gemini قرار گرفت" : "برای Claude ارسال شد");
    setBusy(false);
    if (ok) {
      onOpenChange(false);
      onDone?.();
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={title ?? (mode === "prework" ? "ارسال به پیش‌کار (Gemini)" : "ارسال به کار اصلی (Claude)")}
      description={
        mode === "prework"
          ? `${taskIds.length > 1 ? `${taskIds.length} تسک` : "این تسک"} پس از ثبت پرامپت وارد ورکفلوی چندعاملی پیش‌کار می‌شود: تحقیق ← WBS ← روش انجام ← اجرای کارهای ساده ← انتشار در GitHub`
          : "Claude Code با همه‌ی فایل‌های پیش‌کار در GitHub کار را تمام می‌کند و خروجی نهایی را با دیتا مپینگ در پوشه‌ی final ذخیره می‌کند."
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            انصراف
          </Button>
          <Button onClick={submit} loading={busy}>
            {mode === "prework" ? <Sparkles className="size-4" /> : <Bot className="size-4" />}
            {mode === "prework" ? "شروع پیش‌کار" : "ارسال به Claude"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="پرامپت" hint="هر توضیح، محدودیت یا خواسته‌ای که ایجنت‌ها باید رعایت کنند">
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-40" />
        </Field>
        <Field label="فایل‌های همراه پرامپت" hint={mode === "prework" ? "PDF، تصویر، صوت و ویدیو مستقیماً به Gemini داده می‌شوند؛ متن و Word استخراج می‌شود؛ همه‌چیز در GitHub هم ذخیره می‌شود." : "در پوشه‌ی inputs/main در GitHub قرار می‌گیرند."}>
          <FileDropzone userId={userId} onChange={onFiles} compact />
        </Field>
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
}: {
  task: Task;
  userId: string;
  defaults: { prework: string; main: string };
  activeJobId?: string | null;
  size?: "sm" | "md";
  onChanged?: () => void;
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
  if (["approved", "prework_done", "main_done", "closure_rejected"].includes(s)) {
    primary.push(
      <Button key="pw" size={btn} variant={s === "approved" ? "primary" : "secondary"} onClick={() => setDialog("prework")}>
        <Sparkles className="size-4" /> {s === "approved" ? "ارسال به پیش‌کار" : "پیش‌کار جدید"}
      </Button>,
    );
  }
  if (["prework_done", "main_done", "closure_rejected", "approved"].includes(s)) {
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

      <PromptDialog open={dialog === "prework"} onOpenChange={(o) => setDialog(o ? "prework" : null)} mode="prework" taskIds={[task.id]} userId={userId} defaultPrompt={defaults.prework} onDone={refresh} />
      <PromptDialog
        open={dialog === "main"}
        onOpenChange={(o) => setDialog(o ? "main" : null)}
        mode="main"
        taskIds={[task.id]}
        userId={userId}
        defaultPrompt={s === "main_done" ? "" : defaults.main}
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
