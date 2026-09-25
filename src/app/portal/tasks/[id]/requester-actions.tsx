"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Send, ThumbsDown } from "lucide-react";
import { Button, Field, Textarea } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlays";
import { FileDropzone, useUploads } from "@/components/ui/file-dropzone";
import { confirmClosureAction, rejectClosureAction, resubmitTaskAction } from "@/app/actions/tasks";
import type { Task } from "@/lib/types";

export function RequesterActions({ task, userId }: { task: Task; userId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const { files, onChange: onFiles, blocker: uploadBlocker } = useUploads();
  if (task.requester_id !== userId) return null;

  const done = (ok: boolean, msg: string, err?: string) => {
    setBusy(false);
    if (ok) {
      toast.success(msg);
      router.refresh();
    } else toast.error(err ?? "خطا");
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
