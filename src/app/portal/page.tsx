import Link from "next/link";
import { AlertCircle, ChevronLeft, ClipboardList, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { Button, Card, EmptyState, Progress } from "@/components/ui/primitives";
import { PriorityDot, StatusBadge } from "@/components/tasks/badges";
import { formatJalali, timeAgo } from "@/lib/jalali";
import { faNum } from "@/lib/utils";
import { PortalLive } from "./portal-live";
import type { Task } from "@/lib/types";

export const metadata = { title: "تسک‌های من" };

function TaskCard({ t, related }: { t: Task; related: Task[] }) {
  return (
    <Link href={`/portal/tasks/${t.id}`}>
      <Card className="group p-4 transition hover:-translate-y-0.5 hover:shadow-pop sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityDot priority={t.priority} />
          <span className="ltr text-xs font-bold text-muted">{t.code}</span>
          <StatusBadge status={t.status} requester />
          <ChevronLeft className="ms-auto size-5 text-faint transition group-hover:-translate-x-1" />
        </div>
        <p className="mt-2 text-[15px] font-extrabold leading-7">{t.title}</p>
        <div className="mt-3 flex items-center gap-3">
          <Progress value={t.progress} className="flex-1" tone={t.status === "closed" ? "success" : "brand"} />
          <span className="text-xs font-bold">{faNum(t.progress)}٪</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
          <span>{t.kind === "event" ? `رویداد: ${formatJalali(t.event_at, { withTime: true })}` : t.end_date ? `مهلت: ${formatJalali(t.end_date)}` : "بدون مهلت"}</span>
          <span>به‌روزرسانی {timeAgo(t.status_changed_at)}</span>
          {related.length ? <span>{faNum(related.length)} تسک مرتبط</span> : null}
        </div>
      </Card>
    </Link>
  );
}

export default async function PortalPage() {
  const me = await requireUser();
  const { data } = await db().from("tasks").select("*").eq("requester_id", me.id).order("created_at", { ascending: false });
  const tasks = (data ?? []) as Task[];
  const roots = tasks.filter((t) => !t.parent_id);
  const relatedOf = (id: string) => tasks.filter((t) => t.root_id === id && t.id !== id);
  const needAction = tasks.filter((t) => t.status === "returned" || t.status === "closure_pending");
  const active = roots.filter((t) => !["closed", "cancelled"].includes(t.status));
  const done = roots.filter((t) => ["closed", "cancelled"].includes(t.status));

  return (
    <div className="space-y-8">
      <PortalLive userId={me.id} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">سلام {me.profile.full_name?.split(" ")[0] ?? ""} 👋</h1>
          <p className="mt-1 text-sm text-muted">تسک‌هایتان را ثبت کنید و وضعیت و پیشرفت آن‌ها را زنده دنبال کنید.</p>
        </div>
        <Link href="/portal/new">
          <Button size="lg">
            <Plus className="size-5" /> ثبت تسک جدید
          </Button>
        </Link>
      </div>

      {needAction.length ? (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-rose-600 dark:text-rose-300">
            <AlertCircle className="size-5" /> نیاز به اقدام شما ({faNum(needAction.length)})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {needAction.map((t) => (
              <TaskCard key={t.id} t={t} related={relatedOf(t.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-base font-extrabold">در جریان ({faNum(active.length)})</h2>
        {active.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {active.map((t) => (
              <TaskCard key={t.id} t={t} related={relatedOf(t.id)} />
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState icon={<ClipboardList className="size-7" />} title="تسک فعالی ندارید" description="با دکمه‌ی «ثبت تسک جدید» اولین تسک را ثبت کنید." />
          </Card>
        )}
      </section>

      {done.length ? (
        <section>
          <h2 className="mb-3 text-base font-extrabold text-muted">خاتمه‌یافته ({faNum(done.length)})</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {done.slice(0, 30).map((t) => (
              <TaskCard key={t.id} t={t} related={relatedOf(t.id)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
