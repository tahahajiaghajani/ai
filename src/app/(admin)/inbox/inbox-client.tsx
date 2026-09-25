"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, CheckCheck, ChevronLeft, Inbox, Search, Sparkles } from "lucide-react";
import { useRealtimeRows, useNow } from "@/hooks/use-realtime";
import { Avatar, Badge, Button, Card, EmptyState, Input, Progress } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/overlays";
import { PriorityDot, RelationBadge, StatusBadge } from "@/components/tasks/badges";
import { PromptDialog, run } from "@/components/tasks/task-actions";
import { approveTasksAction } from "@/app/actions/tasks";
import { formatJalali, formatRange, timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { Job, Profile, Task, TaskStatus } from "@/lib/types";

const TABS: { key: string; label: string; statuses: TaskStatus[]; bulk?: "approve" | "prework" | "main" }[] = [
  { key: "approval", label: "در انتظار تایید", statuses: ["pending_approval", "returned"], bulk: "approve" },
  { key: "prework", label: "صف پیش‌کار", statuses: ["approved", "prework_queued"], bulk: "prework" },
  { key: "running", label: "در حال انجام", statuses: ["prework_running", "main_running"] },
  { key: "main", label: "صف کار اصلی", statuses: ["prework_done", "main_queued", "main_done"], bulk: "main" },
  { key: "closure", label: "خاتمه", statuses: ["closure_pending", "closure_rejected"] },
  { key: "closed", label: "بسته‌شده", statuses: ["closed", "cancelled"] },
];

export function InboxClient({
  initial,
  jobs,
  profiles,
  userId,
  defaults,
}: {
  initial: Task[];
  jobs: Job[];
  profiles: Pick<Profile, "id" | "full_name" | "email" | "org_unit">[];
  userId: string;
  defaults: { prework: string; main: string };
}) {
  useNow();
  const router = useRouter();
  const [tasks] = useRealtimeRows<Task & Record<string, unknown>>("tasks", initial as (Task & Record<string, unknown>)[]);
  const [tab, setTab] = React.useState("approval");
  const [q, setQ] = React.useState("");
  const [requester, setRequester] = React.useState("all");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<null | "prework" | "main">(null);
  const [busy, setBusy] = React.useState(false);
  const names = React.useMemo(() => new Map(profiles.map((p) => [p.id, p.full_name || p.email || "—"])), [profiles]);

  React.useEffect(() => setSelected(new Set()), [tab]);

  const filtered = (statuses: TaskStatus[]) =>
    (tasks as Task[])
      .filter((t) => statuses.includes(t.status))
      .filter((t) => requester === "all" || t.requester_id === requester)
      .filter((t) => !q.trim() || `${t.code} ${t.title} ${t.description}`.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => {
        const pw = { critical: 0, high: 1, medium: 2, low: 3 };
        return pw[a.priority] - pw[b.priority] || new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

  const current = TABS.find((t) => t.key === tab)!;
  const list = filtered(current.statuses);
  const selectable = (t: Task) =>
    current.bulk === "approve" ? t.status === "pending_approval" : current.bulk === "prework" ? t.status === "approved" : current.bulk === "main" ? t.status === "prework_done" || t.status === "main_done" : false;
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const ids = [...selected];
  const requesterIds = [...new Set((tasks as Task[]).map((t) => t.requester_id))];

  const renderList = (items: Task[]) =>
    items.length === 0 ? (
      <EmptyState icon={<Inbox className="size-7" />} title="موردی نیست" description="تسکی در این بخش وجود ندارد." />
    ) : (
      <div className="space-y-2">
        {items.map((t) => {
          const job = jobs.find((j) => j.task_id === t.id);
          const can = selectable(t);
          return (
            <Card key={t.id} className={cn("flex items-stretch gap-3 p-3 transition hover:shadow-pop", selected.has(t.id) && "ring-2 ring-primary")}>
              {current.bulk ? (
                <label className={cn("flex items-center px-1", !can && "invisible")}>
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="size-4.5 accent-[var(--primary)]" />
                </label>
              ) : null}
              <Link href={`/tasks/${t.id}`} className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <PriorityDot priority={t.priority} />
                  <span className="ltr text-xs font-bold text-muted">{t.code}</span>
                  <StatusBadge status={t.status} />
                  <RelationBadge relation={t.relation_type} />
                  {job?.status === "queued" ? <Badge tone="info">در صف {job.provider === "gemini" ? "Gemini" : "Claude"}</Badge> : null}
                </div>
                <p className="line-clamp-1 font-bold">{t.title}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="flex items-center gap-1.5">
                    <Avatar name={names.get(t.requester_id) ?? "?"} size={18} />
                    {names.get(t.requester_id)}
                  </span>
                  <span>{t.kind === "event" ? `رویداد: ${formatJalali(t.event_at, { withTime: true })}` : formatRange(t.start_date, t.end_date)}</span>
                  <span>{timeAgo(t.status_changed_at)}</span>
                </div>
                {t.status === "returned" && t.return_reason ? <p className="text-xs text-rose-600">برگشت: {t.return_reason}</p> : null}
                {t.status === "closure_rejected" && t.closure_reject_reason ? <p className="text-xs text-rose-600">رد خاتمه: {t.closure_reject_reason}</p> : null}
                {t.progress > 0 && t.status !== "closed" ? <Progress value={t.progress} className="mt-1 max-w-sm" /> : null}
              </Link>
              {t.status === "pending_approval" ? (
                <Button
                  size="sm"
                  variant="success"
                  className="self-center"
                  onClick={() => run(approveTasksAction([t.id]), `${t.code} تایید شد`, () => router.refresh())}
                >
                  <CheckCheck className="size-4" /> <span className="hidden sm:inline">تایید</span>
                </Button>
              ) : null}
              <ChevronLeft className="size-5 shrink-0 self-center text-faint" />
            </Card>
          );
        })}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">کارتابل</h1>
          <p className="mt-1 text-sm text-muted">تایید، برگشت و ارسال گروهی تسک‌ها به پیش‌کار و کار اصلی</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در عنوان، کد…" className="pr-9" />
          </div>
          <select value={requester} onChange={(e) => setRequester(e.target.value)} className="h-11 rounded-xl border border-line bg-surface-strong px-3 text-sm">
            <option value="all">همه‌ی تسک‌دهنده‌ها</option>
            {requesterIds.map((id) => (
              <option key={id} value={id}>
                {names.get(id)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selected.size ? (
        <div className="glass sticky top-18 z-20 flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3">
          <span className="text-sm font-bold">{faNum(selected.size)} تسک انتخاب شد</span>
          <div className="ms-auto flex gap-2">
            {current.bulk === "approve" ? (
              <Button size="sm" variant="success" loading={busy} onClick={async () => {
                setBusy(true);
                await run(approveTasksAction(ids), "تسک‌ها تایید شدند", () => {
                  setSelected(new Set());
                  router.refresh();
                });
                setBusy(false);
              }}>
                <CheckCheck className="size-4" /> تایید همه
              </Button>
            ) : null}
            {current.bulk === "prework" ? (
              <Button size="sm" onClick={() => setDialog("prework")}>
                <Sparkles className="size-4" /> ارسال به پیش‌کار
              </Button>
            ) : null}
            {current.bulk === "main" ? (
              <Button size="sm" onClick={() => setDialog("main")}>
                <Bot className="size-4" /> ارسال به Claude
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              لغو انتخاب
            </Button>
          </div>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={setTab}
        items={TABS.map((t) => ({
          value: t.key,
          label: t.label,
          badge: <span className="rounded-full bg-surface-muted px-1.5 text-[10.5px]">{faNum(filtered(t.statuses).length)}</span>,
          content: t.key === tab ? renderList(list) : null,
        }))}
      />

      <PromptDialog
        open={dialog === "prework"}
        onOpenChange={(o) => setDialog(o ? "prework" : null)}
        mode="prework"
        taskIds={ids}
        userId={userId}
        defaultPrompt={defaults.prework}
        onDone={() => {
          setSelected(new Set());
          router.refresh();
        }}
      />
      <PromptDialog
        open={dialog === "main"}
        onOpenChange={(o) => setDialog(o ? "main" : null)}
        mode="main"
        taskIds={ids}
        userId={userId}
        defaultPrompt={defaults.main}
        onDone={() => {
          setSelected(new Set());
          router.refresh();
        }}
      />
    </div>
  );
}
