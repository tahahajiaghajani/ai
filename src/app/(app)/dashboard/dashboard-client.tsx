"use client";
import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Inbox,
  LayoutGrid,
  ListOrdered,
  Network,
  Sparkles,
  Flag,
} from "lucide-react";
import {
  LiveWorkflowGraph,
  LiveWorkflowMobile,
  useWorkflowState,
  type WorkflowData,
} from "@/components/workflow/live-workflow";
import { TaskQuickView } from "@/components/tasks/task-quick-view";
import { QuickCommand } from "@/components/tasks/quick-command";
import { cn, faNum } from "@/lib/utils";
import { STAGES } from "@/lib/status";
import type { Task } from "@/lib/types";
import type { DispatchDefaults } from "@/lib/settings";

function Kpi({
  icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  sub?: string;
}) {
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-4">
      <div
        className="absolute -left-6 -top-6 size-24 rounded-full opacity-20 blur-2xl"
        style={{ background: color }}
      />
      <div className="flex items-center gap-2 text-xs font-semibold text-muted">
        <span
          className="grid size-7 place-items-center rounded-lg text-white"
          style={{ background: color }}
        >
          {icon}
        </span>
        {label}
      </div>
      <p className="mt-2 text-3xl font-black tracking-tight">{faNum(value)}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-faint">{sub}</p> : null}
    </div>
  );
}

export function DashboardClient({
  data,
  userId,
  defaults,
  isOwner,
  all,
}: {
  data: WorkflowData;
  userId: string;
  defaults: DispatchDefaults;
  isOwner: boolean;
  all: boolean;
}) {
  const state = useWorkflowState(data);
  const [selected, setSelected] = React.useState<Task | null>(null);
  const [view, setView] = React.useState<"graph" | "pipeline">("graph");

  React.useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setView("pipeline");
  }, []);

  // keep the drawer in sync with realtime updates of the selected task
  const live = selected
    ? (state.tasks.find((t) => t.id === selected.id) ?? selected)
    : null;
  const liveJob = live
    ? (state.jobs.find(
        (j) =>
          j.task_id === live.id &&
          (j.status === "running" || j.status === "queued"),
      ) ?? null)
    : null;

  const count = (keys: string[]) =>
    state.tasks.filter((t) => keys.includes(t.status)).length;
  const qPrework = state.jobs.filter(
    (j) => j.kind === "prework" && j.status === "queued",
  ).length;
  const qMain = state.jobs.filter(
    (j) => j.kind === "main" && j.status === "queued",
  ).length;
  const caps = defaults.caps;
  const weekAgo = Date.now() - 7 * 86400_000;
  const closedWeek = state.tasks.filter(
    (t) =>
      t.status === "closed" &&
      t.closed_at &&
      new Date(t.closed_at).getTime() > weekAgo,
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight">
            ورکفلو <span className="text-gradient">زنده</span>
          </h1>
          <p className="mt-1 text-sm text-muted">
            {all ? "تسک‌های همه‌ی کاربران" : "تسک‌هایی که به شما سپرده شده"} در
            مراحل ورکفلو، به تفکیک تسک‌دهنده — روی هر تسک بزنید تا جزئیات و لاگ
            زنده را ببینید.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner ? (
            <div className="flex rounded-xl border border-line bg-surface p-1 text-xs font-bold">
              <Link
                href="/dashboard"
                className={cn(
                  "rounded-lg px-3 py-1.5 transition",
                  !all ? "bg-surface-strong text-fg shadow-card" : "text-muted",
                )}
              >
                سپرده به من
              </Link>
              <Link
                href="/dashboard?scope=all"
                className={cn(
                  "rounded-lg px-3 py-1.5 transition",
                  all ? "bg-surface-strong text-fg shadow-card" : "text-muted",
                )}
              >
                همه‌ی کاربران
              </Link>
            </div>
          ) : null}
          <div className="flex rounded-xl border border-line bg-surface p-1">
            {[
              {
                k: "graph" as const,
                label: "گراف",
                icon: <Network className="size-4" />,
              },
              {
                k: "pipeline" as const,
                label: "خط لوله",
                icon: <LayoutGrid className="size-4" />,
              },
            ].map((o) => (
              <button
                key={o.k}
                onClick={() => setView(o.k)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition",
                  view === o.k
                    ? "bg-surface-strong text-fg shadow-card"
                    : "text-muted",
                )}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!caps.prework || !caps.main ? (
        <Link
          href="/settings"
          className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-300" />
          <span>
            <b>
              {!caps.ai
                ? "هنوز هیچ کلید هوش مصنوعی وصل نکرده‌اید."
                : !caps.prework
                  ? "مدل مرحله‌ی پیش‌کار انتخاب نشده."
                  : "موتور کار اصلی آماده نیست."}
            </b>{" "}
            <span className="text-muted">
              تا وقتی اتصال‌ها کامل نشوند، ارسال به پیش‌کار یا کار اصلی غیرفعال
              است. برای تنظیم به «تنظیمات و اتصال‌ها» بروید.
            </span>
          </span>
        </Link>
      ) : null}

      {!all && caps.ai ? <QuickCommand userId={userId} defaults={defaults} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          icon={<Inbox className="size-4" />}
          label="منتظر پذیرش"
          value={count(["pending_approval"])}
          color={STAGES[0].color}
          sub={`${faNum(count(["returned"]))} برگشتی`}
        />
        <Kpi
          icon={<ListOrdered className="size-4" />}
          label="صف پیش‌کار"
          value={count(["approved", "prework_queued"])}
          color={STAGES[1].color}
          sub={`${faNum(qPrework)} در صف اجرا`}
        />
        <Kpi
          icon={<Sparkles className="size-4" />}
          label="در حال پیش‌کار"
          value={count(["prework_running"])}
          color={STAGES[2].color}
        />
        <Kpi
          icon={<Bot className="size-4" />}
          label="کار اصلی"
          value={count([
            "prework_done",
            "main_queued",
            "main_running",
            "main_done",
          ])}
          color={STAGES[4].color}
          sub={`${faNum(qMain)} در صف اجرا`}
        />
        <Kpi
          icon={<Flag className="size-4" />}
          label="منتظر تایید خاتمه"
          value={count(["closure_pending", "closure_rejected"])}
          color={STAGES[5].color}
        />
        <Kpi
          icon={<CheckCircle2 className="size-4" />}
          label="خاتمه در ۷ روز"
          value={closedWeek}
          color={STAGES[6].color}
        />
      </div>

      {view === "graph" ? (
        <LiveWorkflowGraph data={state} onOpen={setSelected} />
      ) : (
        <LiveWorkflowMobile data={state} onOpen={setSelected} />
      )}

      <TaskQuickView
        task={live}
        liveJob={liveJob}
        onClose={() => setSelected(null)}
        userId={userId}
        defaults={defaults}
      />
    </div>
  );
}
