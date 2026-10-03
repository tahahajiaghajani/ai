import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ChevronLeft, ClipboardList, Inbox, Send } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { peopleById } from "@/lib/people";
import { Avatar, Card, EmptyState, Progress } from "@/components/ui/primitives";
import { PriorityDot, StatusBadge } from "@/components/tasks/badges";
import { formatJalali, timeAgo } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import { PortalLive } from "./portal-live";
import type { PersonLite, Task } from "@/lib/types";

export const metadata = { title: "خانه" };

function TaskCard({ t, other, otherLabel, mine }: { t: Task; other?: PersonLite; otherLabel: string; mine: boolean }) {
  return (
    <Link href={`/portal/tasks/${t.id}`}>
      <Card className="group p-4 transition hover:-translate-y-0.5 hover:shadow-pop sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityDot priority={t.priority} />
          <span className="ltr text-xs font-bold text-muted">{t.code}</span>
          <StatusBadge status={t.status} requester={!mine} />
          <ChevronLeft className="ms-auto size-5 text-faint transition group-hover:-translate-x-1" />
        </div>
        <p className="mt-2 text-[15px] font-extrabold leading-7">{t.title}</p>
        {other ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
            <Avatar name={other.full_name ?? "?"} src={other.avatar_url} size={18} />
            {otherLabel}: <b className="text-fg">{other.full_name}</b>
          </p>
        ) : null}
        <div className="mt-3 flex items-center gap-3">
          <Progress value={t.progress} className="flex-1" tone={t.status === "closed" ? "success" : "brand"} />
          <span className="text-xs font-bold">{faNum(t.progress)}٪</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
          <span>{t.kind === "event" ? `رویداد: ${formatJalali(t.event_at, { withTime: true })}` : t.end_date ? `مهلت: ${formatJalali(t.end_date)}` : "بدون مهلت"}</span>
          <span>به‌روزرسانی {timeAgo(t.status_changed_at)}</span>
        </div>
      </Card>
    </Link>
  );
}

function Section({ title, tasks, people, mine, tone }: { title: React.ReactNode; tasks: Task[]; people: Map<string, PersonLite>; mine: boolean; tone?: string }) {
  if (!tasks.length) return null;
  return (
    <section>
      <h2 className={cn("mb-3 flex items-center gap-2 text-base font-extrabold", tone)}>{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            t={t}
            other={mine ? (t.requester_id !== t.assignee_id ? people.get(t.requester_id) : undefined) : people.get(t.assignee_id)}
            otherLabel={mine ? "از طرف" : "مسئول"}
            mine={mine}
          />
        ))}
      </div>
    </section>
  );
}

/** Simple app home: tasks given to me (update their status by hand) and tasks I gave others. */
export default async function PortalPage(props: PageProps<"/portal">) {
  const me = await requireUser();
  const sp = await props.searchParams;
  const tab = sp.tab === "given" ? "given" : "mine";
  // the full app has the same lists (with more tools) under «کارها»
  if (me.mode === "full") redirect(tab === "given" ? "/given" : "/inbox");
  const [assigned, given] = await Promise.all([
    db().from("tasks").select("*").eq("assignee_id", me.id).order("status_changed_at", { ascending: false }).limit(300),
    db().from("tasks").select("*").eq("requester_id", me.id).neq("assignee_id", me.id).order("status_changed_at", { ascending: false }).limit(300),
  ]);
  const mine = (assigned.data ?? []) as Task[];
  const gave = (given.data ?? []) as Task[];
  const people = await peopleById([...mine.map((t) => t.requester_id), ...gave.map((t) => t.assignee_id)]);
  const open = (t: Task) => !["closed", "cancelled"].includes(t.status);

  const mineAction = mine.filter((t) => t.status === "pending_approval" || t.status === "closure_rejected");
  const mineActive = mine.filter((t) => open(t) && !mineAction.includes(t));
  const gaveAction = gave.filter((t) => t.status === "returned" || t.status === "closure_pending");
  const gaveActive = gave.filter((t) => open(t) && !gaveAction.includes(t));
  const list = tab === "mine" ? mine : gave;

  return (
    <div className="space-y-6">
      <PortalLive userId={me.id} />
      <h1 className="text-[22px] font-black tracking-tight">سلام {me.profile.full_name?.split(" ")[0] ?? ""}</h1>

      <div className="flex gap-1 rounded-xl bg-surface-muted p-1">
        {[
          { key: "mine", label: "سپرده به من", icon: <Inbox className="size-4" />, count: mineAction.length + mineActive.length },
          { key: "given", label: "داده‌شده توسط من", icon: <Send className="size-4" />, count: gaveAction.length + gaveActive.length },
        ].map((t) => (
          <Link
            key={t.key}
            href={t.key === "mine" ? "/portal" : "/portal?tab=given"}
            className={cn("flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-bold transition", tab === t.key ? "bg-surface-strong text-fg shadow-[0_1px_3px_rgba(11,18,34,0.08)]" : "text-muted")}
          >
            {t.icon} {t.label} {t.count ? <span className="rounded-full bg-primary-soft px-1.5 text-[11px] text-primary">{faNum(t.count)}</span> : null}
          </Link>
        ))}
      </div>

      {tab === "mine" ? (
        <>
          <Section title={<><AlertCircle className="size-5" /> منتظر شما ({faNum(mineAction.length)})</>} tasks={mineAction} people={people} mine tone="text-rose-600 dark:text-rose-300" />
          <Section title={<>در جریان ({faNum(mineActive.length)})</>} tasks={mineActive} people={people} mine />
        </>
      ) : (
        <>
          <Section title={<><AlertCircle className="size-5" /> نیاز به اقدام شما ({faNum(gaveAction.length)})</>} tasks={gaveAction} people={people} mine={false} tone="text-rose-600 dark:text-rose-300" />
          <Section title={<>در جریان ({faNum(gaveActive.length)})</>} tasks={gaveActive} people={people} mine={false} />
        </>
      )}

      {!list.filter(open).length ? (
        <Card>
          <EmptyState icon={<ClipboardList className="size-6" />} title={tab === "mine" ? "تسک فعالی به شما سپرده نشده" : "تسک فعالی به کسی نداده‌اید"} />
        </Card>
      ) : null}

      <Section title={<span className="text-muted">خاتمه‌یافته</span>} tasks={list.filter((t) => !open(t)).slice(0, 30)} people={people} mine={tab === "mine"} />
    </div>
  );
}
