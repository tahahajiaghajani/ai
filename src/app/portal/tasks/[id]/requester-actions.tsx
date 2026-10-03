"use client";
import * as React from "react";
import { toast } from "sonner";
import { Ban, CheckCheck, CheckCircle2, Flag, PlayCircle, Send, ThumbsDown, Undo2 } from "lucide-react";
import { Button, Field, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { FileDropzone, useUploads } from "@/components/ui/file-dropzone";
import { approveTasksAction, cancelTaskAction, confirmClosureAction, rejectClosureAction, requestClosureAction, resubmitTaskAction, returnTaskAction, startTaskAction } from "@/app/actions/tasks";
import { TextDialog } from "@/components/tasks/task-actions";
import { CLOSABLE } from "@/lib/status";
import type { Task } from "@/lib/types";

/** Simple mode: the assignee updates the status by hand (accept, start, done, return). */
export function AssigneeActions({ task }: { task: Task }) {
  const [busy, setBusy] = React.useState(false);
  const [dialog, setDialog] = React.useState<null | "return" | "done">(null);
  const s = task.status;
  const self = task.requester_id === task.assignee_id;
  const go = async (p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (r.ok) toast.success(msg);
    else toast.error(r.error ?? "خطا");
    return r.ok;
  };
  return (
    <>
      {s === "pending_approval" || s === "returned" ? (
        <Button variant="success" loading={busy} onClick={() => void go(approveTasksAction([task.id]), "تسک را پذیرفتید")}>
          <CheckCheck className="size-4" /> پذیرش
        </Button>
      ) : null}
      {s === "pending_approval" && !self ? (
        <Button variant="outline" onClick={() => setDialog("return")}>
          <Undo2 className="size-4" /> برگشت برای اصلاح
        </Button>
      ) : null}
      {s === "approved" || s === "closure_rejected" ? (
        <Button loading={busy} onClick={() => void go(startTaskAction(task.id), "وضعیت: در حال انجام")}>
          <PlayCircle className="size-4" /> شروع کار
        </Button>
      ) : null}
      {CLOSABLE.includes(s) && s !== "pending_approval" ? (
        <Button variant={s === "in_progress" ? "primary" : "secondary"} onClick={() => setDialog("done")}>
          <Flag className="size-4" /> {self ? "خاتمه" : "انجام شد"}
        </Button>
      ) : null}
      <TextDialog
        open={dialog === "return"}
        onOpenChange={(o) => setDialog(o ? "return" : null)}
        title="برگشت تسک به تسک‌دهنده"
        description="تسک‌دهنده این توضیح را می‌بیند و پس از اصلاح دوباره ارسال می‌کند."
        label="چه چیزی باید اصلاح یا اضافه شود؟"
        required
        confirm="برگشت بزن"
        onSubmit={(t) => go(returnTaskAction(task.id, t), "تسک برگشت خورد")}
      />
      <TextDialog
        open={dialog === "done"}
        onOpenChange={(o) => setDialog(o ? "done" : null)}
        title={self ? "خاتمه‌ی تسک" : "اعلام انجام کار"}
        description={self ? undefined : "تسک‌دهنده خاتمه را تایید یا با توضیحات رد می‌کند."}
        label="یادداشت (اختیاری)"
        confirm={self ? "خاتمه" : "اعلام انجام"}
        onSubmit={(t) => go(requestClosureAction(task.id, t), self ? "تسک بسته شد" : "انجام کار اعلام شد")}
      />
    </>
  );
}

export function RequesterActions({ task, userId }: { task: Task; userId: string }) {
  const [busy, setBusy] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { files, onChange: onFiles, blocker: uploadBlocker } = useUploads();
  if (task.requester_id !== userId || task.assignee_id === userId) return null;

  const done = (ok: boolean, msg: string, err?: string) => {
    setBusy(false);
    // these actions return the refreshed page themselves
    if (ok) toast.success(msg);
    else toast.error(err ?? "خطا");
  };

  return (
    <>
      {task.status === "returned" ? (
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const r = await resubmitTaskAction(task.id);
            done(r.ok, "دوباره برای تایید ارسال شد", r.ok ? undefined : r.error);
          }}
        >
          <Send className="size-4" /> ارسال مجدد
        </Button>
      ) : null}
      {task.status === "closure_pending" ? (
        <>
          <Button
            variant="success"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await confirmClosureAction(task.id);
              done(r.ok, "خاتمه‌ی تسک تایید شد. سپاس!", r.ok ? undefined : r.error);
            }}
          >
            <CheckCircle2 className="size-4" /> تایید خاتمه
          </Button>
          <Button variant="outline" onClick={() => setRejecting(true)}>
            <ThumbsDown className="size-4" /> رد خاتمه
          </Button>
        </>
      ) : null}

      {!["closed", "cancelled", "closure_pending"].includes(task.status) ? (
        <Button variant="ghost" onClick={() => setCancelling(true)}>
          <Ban className="size-4" /> لغو تسک
        </Button>
      ) : null}
      <TextDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="لغو تسک"
        label="دلیل لغو (برای مسئول)"
        confirm="لغو تسک"
        danger
        onSubmit={async (t) => {
          const r = await cancelTaskAction(task.id, t);
          done(r.ok, "تسک لغو شد", r.ok ? undefined : r.error);
          return r.ok;
        }}
      />

      <Modal
        open={rejecting}
        onOpenChange={setRejecting}
        title="رد خاتمه با توضیحات"
        description="توضیحات شما به‌صورت یک تسک مرتبط زیر همین تسک ثبت می‌شود و در ادامه‌ی همان پروژه انجام خواهد شد."
        footer={
          <Button
            variant="danger"
            loading={busy}
            disabled={!reason.trim() || !!uploadBlocker}
            title={uploadBlocker ?? undefined}
            onClick={async () => {
              setBusy(true);
              const r = await rejectClosureAction(task.id, reason, files);
              done(r.ok, r.ok ? `ثبت شد (${r.data.code})` : "", r.ok ? undefined : r.error);
              if (r.ok) setRejecting(false);
            }}
          >
            ثبت رد خاتمه
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="چه چیزی مطابق انتظار نیست؟" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-36" />
          </Field>
          <Field label="فایل‌های پیوست (اختیاری)">
            <FileDropzone userId={userId} onChange={onFiles} compact />
          </Field>
        </div>
      </Modal>
    </>
  );
}
