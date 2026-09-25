"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Eye, GitMerge, GitPullRequest, Rocket, RotateCcw, Undo2, XCircle } from "lucide-react";
import { useRealtimeRows } from "@/hooks/use-realtime";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Spinner, Switch, Textarea } from "@/components/ui/primitives";
import { FileDropzone, type UploadedFile } from "@/components/ui/file-dropzone";
import { LiveLog } from "@/components/tasks/live-log";
import { Markdown } from "@/components/ui/markdown";
import { cancelUpgradeAction, createUpgradeAction, mergeUpgradeAction, refreshPreviewAction, rollbackUpgradeAction } from "@/app/actions/admin";
import { formatJalali } from "@/lib/jalali";
import type { TaskEvent, Upgrade } from "@/lib/types";

const STATUS: Record<Upgrade["status"], { label: string; tone: "info" | "violet" | "warning" | "success" | "danger" | "neutral" }> = {
  queued: { label: "در صف Claude", tone: "info" },
  running: { label: "Claude در حال پیاده‌سازی", tone: "violet" },
  review: { label: "آماده‌ی بازبینی", tone: "warning" },
  merging: { label: "در حال ادغام", tone: "violet" },
  merged: { label: "منتشر شد", tone: "success" },
  failed: { label: "ناموفق", tone: "danger" },
  cancelled: { label: "لغو شد", tone: "neutral" },
  rolled_back: { label: "برگردانده شد", tone: "neutral" },
};

function UpgradeLog({ id, live }: { id: string; live: boolean }) {
  const [events, setEvents] = React.useState<TaskEvent[] | null>(null);
  React.useEffect(() => {
    void supabaseBrowser()
      .from("task_events")
      .select("*")
      .eq("upgrade_id", id)
      .order("id", { ascending: false })
      .limit(300)
      .then(({ data }) => setEvents(((data ?? []) as TaskEvent[]).reverse()));
  }, [id]);
  return events ? <LiveLog initial={events} upgradeId={id} live={live} maxHeight="50vh" /> : <Spinner />;
}

export function UpgradeClient({ userId, initial }: { userId: string; initial: Upgrade[] }) {
  const router = useRouter();
  const [rows] = useRealtimeRows<Upgrade & Record<string, unknown>>("upgrades", initial as (Upgrade & Record<string, unknown>)[], {
    sort: (a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime(),
  });
  const [title, setTitle] = React.useState("");
  const [prompt, setPrompt] = React.useState("");
  const [autoMerge, setAutoMerge] = React.useState(false);
  const [files, setFiles] = React.useState<UploadedFile[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<string | null>(null);
  const onFiles = React.useCallback((f: UploadedFile[]) => setFiles(f), []);

  const submit = async () => {
    setBusy(true);
    const r = await createUpgradeAction({ title, prompt, autoMerge, files });
    setBusy(false);
    if (r.ok) {
      toast.success(`درخواست ${r.data.code} برای Claude ارسال شد`);
      setPrompt("");
      setTitle("");
      setOpen(r.data.id);
      router.refresh();
    } else toast.error(r.error);
  };

  const act = async (p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    const r = await p;
    if (r.ok) toast.success(msg);
    else toast.error(r.error ?? "خطا");
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black">
          ارتقای <span className="text-gradient">خودکار</span> اپلیکیشن
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          فقط پرامپت بنویسید: Claude Code روی مخزن همین اپ تغییر را پیاده می‌کند، typecheck و build را اجرا و خطاها را خودش رفع می‌کند، یک Pull Request می‌سازد و Vercel پیش‌نمایش آن را منتشر می‌کند. با «انتشار»، نسخه‌ی جدید روی Vercel می‌رود و migrationهای Supabase اعمال می‌شوند.
        </p>
      </div>

      <Card>
        <CardHeader title="درخواست ارتقای جدید" icon={<Rocket className="size-4" />} />
        <div className="space-y-4 p-5">
          <Field label="عنوان کوتاه (اختیاری)">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: گزارش هفتگی ایمیلی" />
          </Field>
          <Field label="پرامپت ارتقا" required hint="هر قدر دقیق‌تر بنویسید نتیجه بهتر است؛ Claude به کل کد و مستندات معماری دسترسی دارد.">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-44" placeholder="مثلاً: یک صفحه‌ی گزارش اضافه کن که تعداد تسک‌های بسته‌شده‌ی هر تسک‌دهنده را در ماه جاری با نمودار نشان دهد…" />
          </Field>
          <Field label="فایل‌های همراه (طرح، اسکرین‌شات، سند)">
            <FileDropzone userId={userId} onChange={onFiles} compact />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Switch checked={autoMerge} onChange={setAutoMerge} label={<span className="text-sm">انتشار خودکار پس از موفقیت build (بدون بازبینی)</span>} />
            <Button onClick={submit} loading={busy} disabled={!prompt.trim()}>
              <Rocket className="size-4" /> ارسال به Claude
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-3">
        {rows.length === 0 ? <EmptyState icon={<Rocket className="size-7" />} title="هنوز ارتقایی ثبت نشده" /> : null}
        {(rows as Upgrade[]).map((u) => {
          const st = STATUS[u.status];
          const live = u.status === "running" || u.status === "queued" || u.status === "merging";
          return (
            <Card key={u.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="ltr rounded-lg bg-surface-muted px-2 py-0.5 text-xs font-black">{u.code}</span>
                <Badge tone={st.tone} dot>
                  {st.label}
                </Badge>
                <span className="font-bold">{u.title ?? u.prompt.slice(0, 70)}</span>
                <span className="ms-auto text-xs text-muted">{formatJalali(u.created_at, { withTime: true })}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-muted">{u.prompt}</p>
              {u.summary ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-bold text-primary">خلاصه‌ی تغییرات Claude</summary>
                  <Markdown className="mt-2">{u.summary}</Markdown>
                </details>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setOpen(open === u.id ? null : u.id)}>
                  {live ? <span className="live-dot" /> : null} لاگ {live ? "زنده" : ""}
                </Button>
                {u.pr_url ? (
                  <a href={u.pr_url} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="ghost">
                      <GitPullRequest className="size-4" /> Pull Request <ExternalLink className="size-3.5" />
                    </Button>
                  </a>
                ) : null}
                {u.status === "review" ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      const r = await refreshPreviewAction(u.id);
                      if (r.ok && r.data.url) window.open(r.data.url, "_blank");
                      else toast.info(r.ok ? "پیش‌نمایش Vercel هنوز آماده نیست؛ چند دقیقه‌ی دیگر امتحان کنید" : r.error);
                      router.refresh();
                    }}>
                      <Eye className="size-4" /> پیش‌نمایش
                    </Button>
                    <Button size="sm" variant="success" onClick={() => act(mergeUpgradeAction(u.id), "ادغام شد؛ Vercel در حال انتشار نسخه‌ی جدید است")}>
                      <GitMerge className="size-4" /> انتشار
                    </Button>
                  </>
                ) : null}
                {u.preview_url ? (
                  <a href={u.preview_url} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="ghost">
                      باز کردن پیش‌نمایش <ExternalLink className="size-3.5" />
                    </Button>
                  </a>
                ) : null}
                {["queued", "running", "review"].includes(u.status) ? (
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => act(cancelUpgradeAction(u.id), "لغو شد")}>
                    <XCircle className="size-4" /> لغو
                  </Button>
                ) : null}
                {u.status === "merged" ? (
                  <Button size="sm" variant="ghost" onClick={() => act(rollbackUpgradeAction(u.id), "تغییرات برگردانده شد؛ Vercel نسخه‌ی قبلی را منتشر می‌کند")}>
                    <Undo2 className="size-4" /> بازگرداندن
                  </Button>
                ) : null}
                {u.status === "failed" ? (
                  <Button size="sm" variant="ghost" onClick={() => {
                    setPrompt(u.prompt);
                    setTitle(u.title ?? "");
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}>
                    <RotateCcw className="size-4" /> ویرایش و ارسال دوباره
                  </Button>
                ) : null}
              </div>
              {open === u.id ? (
                <div className="mt-4">
                  <UpgradeLog id={u.id} live={live} />
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
