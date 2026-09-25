"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, ListTodo, Send } from "lucide-react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { JalaliDatePicker, JalaliDateTimePicker } from "@/components/ui/jalali-date-picker";
import { FileDropzone, type UploadedFile } from "@/components/ui/file-dropzone";
import { createTaskAction, updateTaskAction } from "@/app/actions/tasks";
import { PRIORITY_META, RELATION_META } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { Priority, RelationType, Task } from "@/lib/types";

export function TaskForm({
  userId,
  task,
  parent,
  backHref = "/portal",
}: {
  userId: string;
  task?: Task;
  parent?: { id: string; code: string; title: string; relation?: RelationType };
  backHref?: string;
}) {
  const router = useRouter();
  const [title, setTitle] = React.useState(task?.title ?? "");
  const [description, setDescription] = React.useState(task?.description ?? "");
  const [kind, setKind] = React.useState<"task" | "event">(task?.kind ?? "task");
  const [start, setStart] = React.useState<string | null>(task?.start_date ?? null);
  const [end, setEnd] = React.useState<string | null>(task?.end_date ?? null);
  const [eventAt, setEventAt] = React.useState<string | null>(task?.event_at ?? null);
  const [priority, setPriority] = React.useState<Priority>(task?.priority ?? "medium");
  const [relation, setRelation] = React.useState<RelationType>(parent?.relation ?? "continuation");
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [busy, setBusy] = React.useState(false);
  const onFiles = React.useCallback((f: UploadedFile[]) => setFiles(f), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const input = { title, description, kind, start_date: start, end_date: end, event_at: eventAt, priority };
    if (task) {
      const r = await updateTaskAction(task.id, input, files);
      setBusy(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success("تغییرات ذخیره شد");
      router.push(`/portal/tasks/${task.id}`);
      router.refresh();
      return;
    }
    const r = await createTaskAction(input, files, parent ? { id: parent.id, relation } : undefined);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`تسک ${r.data.code} ثبت و برای تایید ارسال شد`);
    router.push(`/portal/tasks/${r.data.id}`);
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {parent ? (
        <Card className="border-pink-500/30 p-4">
          <p className="text-sm">
            تسک مرتبط با <b className="ltr">{parent.code}</b> — {parent.title}
          </p>
          <p className="mt-1 text-xs text-muted">این تسک جدید حساب نمی‌شود؛ زیر همان تسک اصلی و در ادامه‌ی همان پروژه انجام می‌شود.</p>
          <Field label="نوع ارتباط" className="mt-3 max-w-xs">
            <Select value={relation} onChange={(e) => setRelation(e.target.value as RelationType)}>
              {(Object.keys(RELATION_META) as RelationType[])
                .filter((r) => r !== "rejection")
                .map((r) => (
                  <option key={r} value={r}>
                    {RELATION_META[r]}
                  </option>
                ))}
            </Select>
          </Field>
        </Card>
      ) : null}

      <Card className="space-y-5 p-5 sm:p-6">
        <Field label="عنوان" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="یک عنوان کوتاه و روشن" maxLength={200} required />
        </Field>
        <Field label="توضیحات" hint="هر چه دقیق‌تر بنویسید، نتیجه بهتر و سریع‌تر می‌شود (پشتیبانی از Markdown)">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-44" placeholder="شرح کامل کار، انتظارات، محدودیت‌ها، معیار انجام…" />
        </Field>

        <div>
          <p className="mb-2 text-[13px] font-semibold">نوع</p>
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            {[
              { k: "task" as const, label: "تسک (بازه‌ی زمانی)", icon: <ListTodo className="size-4" /> },
              { k: "event" as const, label: "رویداد (یک تاریخ)", icon: <CalendarClock className="size-4" /> },
            ].map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => setKind(o.k)}
                className={cn("flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition", kind === o.k ? "border-primary bg-primary-soft text-primary" : "border-line text-muted")}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {kind === "task" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="تاریخ شروع">
              <JalaliDatePicker value={start} onChange={setStart} placeholder="انتخاب تاریخ شروع" />
            </Field>
            <Field label="تاریخ پایان">
              <JalaliDatePicker value={end} onChange={setEnd} placeholder="انتخاب مهلت" min={start} />
            </Field>
          </div>
        ) : (
          <Field label="تاریخ و ساعت رویداد" required>
            <JalaliDateTimePicker value={eventAt} onChange={setEventAt} />
          </Field>
        )}

        <div>
          <p className="mb-2 text-[13px] font-semibold">اولویت</p>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(PRIORITY_META) as Priority[]).map((p) => {
              const colors: Record<Priority, string> = {
                low: "border-slate-400 text-slate-600 dark:text-slate-300 bg-slate-500/10",
                medium: "border-sky-500 text-sky-600 dark:text-sky-300 bg-sky-500/10",
                high: "border-amber-500 text-amber-700 dark:text-amber-300 bg-amber-500/10",
                critical: "border-rose-500 text-rose-600 dark:text-rose-300 bg-rose-500/10",
              };
              return (
                <button key={p} type="button" onClick={() => setPriority(p)} className={cn("rounded-xl border px-2 py-2.5 text-sm font-bold transition", priority === p ? colors[p] : "border-line text-muted")}>
                  {PRIORITY_META[p].label}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="فایل‌های پیوست" hint="هر نوع فایلی (سند، تصویر، اکسل، PDF، صوت…) — تا ۵۰ مگابایت">
          <FileDropzone userId={userId} onChange={onFiles} />
        </Field>
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.push(backHref)}>
          انصراف
        </Button>
        <Button type="submit" size="lg" loading={busy} disabled={!title.trim()}>
          <Send className="size-4" /> {task ? "ذخیره‌ی تغییرات" : "ثبت و ارسال برای تایید"}
        </Button>
      </div>
    </form>
  );
}
