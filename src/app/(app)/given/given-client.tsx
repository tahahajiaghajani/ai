"use client";
import * as React from "react";
import Link from "next/link";
import { AlertCircle, ChevronLeft, Search, Send } from "lucide-react";
import { useNow, useRealtimeRows } from "@/hooks/use-realtime";
import { Avatar, Card, EmptyState, Input, Progress } from "@/components/ui/primitives";
import { PageHeader, SECTIONS } from "@/components/shell/page-header";
import { PriorityDot, StatusBadge } from "@/components/tasks/badges";
import { formatJalali, timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import type { PersonLite, Task } from "@/lib/types";

const GROUPS = [
  { key: "action", label: "نیاز به اقدام شما", test: (t: Task) => t.status === "returned" || t.status === "closure_pending" },
  { key: "open", label: "در جریان", test: (t: Task) => !["returned", "closure_pending", "closed", "cancelled"].includes(t.status) },
  { key: "done", label: "خاتمه‌یافته", test: (t: Task) => t.status === "closed" || t.status === "cancelled" },
];

export function GivenClient({ userId, initial, people }: { userId: string; initial: Task[]; people: PersonLite[] }) {
  useNow();
  const [rows] = useRealtimeRows<Task & Record<string, unknown>>("tasks", initial as (Task & Record<string, unknown>)[], {
    filter: `requester_id=eq.${userId}`,
    accept: (t) => t.assignee_id !== userId,
  });
  const [q, setQ] = React.useState("");
  const [who, setWho] = React.useState("all");
  const byId = React.useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const tasks = (rows as Task[])
    .filter((t) => who === "all" || t.assignee_id === who)
    .filter((t) => !q.trim() || `${t.code} ${t.title}`.toLowerCase().includes(q.trim().toLowerCase()));
  const assignees = [...new Set((rows as Task[]).map((t) => t.assignee_id))];

  return (
    <div className="space-y-5">
      <PageHeader title="کارها" tabs={SECTIONS.tasks} />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو" aria-label="جستجو" className="pr-9" />
        </div>
        {assignees.length > 1 ? (
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="مسئول" className="h-11 rounded-xl border border-line bg-surface-strong px-3 text-sm">
            <option value="all">همه‌ی مسئول‌ها</option>
            {assignees.map((id) => (
              <option key={id} value={id}>
                {byId.get(id)?.full_name ?? "—"}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {!tasks.length ? (
        <Card>
          <EmptyState icon={<Send className="size-6" />} title="تسکی به کسی نداده‌اید" />
        </Card>
      ) : null}

      {GROUPS.map((g) => {
        const list = tasks.filter(g.test).slice(0, g.key === "done" ? 40 : undefined);
        if (!list.length) return null;
        return (
          <section key={g.key}>
            <h2 className={cn("mb-3 flex items-center gap-2 text-base font-extrabold", g.key === "action" && "text-rose-600 dark:text-rose-300", g.key === "done" && "text-muted")}>
              {g.key === "action" ? <AlertCircle className="size-5" /> : null} {g.label} ({faNum(list.length)})
            </h2>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {list.map((t) => {
                const a = byId.get(t.assignee_id);
                return (
                  <Link key={t.id} href={`/portal/tasks/${t.id}`}>
                    <Card className="group p-4 transition hover:-translate-y-0.5 hover:shadow-pop">
                      <div className="flex flex-wrap items-center gap-2">
                        <PriorityDot priority={t.priority} />
                        <span className="ltr text-xs font-bold text-muted">{t.code}</span>
                        <StatusBadge status={t.status} requester />
                        <ChevronLeft className="ms-auto size-5 text-faint transition group-hover:-translate-x-1" />
                      </div>
                      <p className="mt-2 line-clamp-2 font-extrabold leading-7">{t.title}</p>
                      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                        <Avatar name={a?.full_name ?? "?"} src={a?.avatar_url} size={18} /> مسئول: <b className="text-fg">{a?.full_name ?? "—"}</b>
                      </p>
                      <div className="mt-3 flex items-center gap-3">
                        <Progress value={t.progress} className="flex-1" tone={t.status === "closed" ? "success" : "brand"} />
                        <span className="text-xs font-bold">{faNum(t.progress)}٪</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
                        <span>{t.end_date ? `مهلت: ${formatJalali(t.end_date)}` : "بدون مهلت"}</span>
                        <span>به‌روزرسانی {timeAgo(t.status_changed_at)}</span>
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
