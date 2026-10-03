"use client";
import * as React from "react";
import Link from "next/link";
import { AlertTriangle, LayoutGrid, Network } from "lucide-react";
import {
  LiveWorkflowGraph,
  LiveWorkflowMobile,
  useWorkflowState,
  type WorkflowData,
} from "@/components/workflow/live-workflow";
import { TaskQuickView } from "@/components/tasks/task-quick-view";
import { QuickCommand } from "@/components/tasks/quick-command";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/types";
import type { DispatchDefaults } from "@/lib/settings";

const SEG = "flex rounded-xl bg-surface-muted p-1 text-xs font-bold";
const ON = "bg-surface-strong text-fg shadow-[0_1px_3px_rgba(11,18,34,0.08)]";

export function DashboardClient({
  data,
  userId,
  defaults,
  isOwner,
  all,
  firstName,
}: {
  data: WorkflowData;
  userId: string;
  defaults: DispatchDefaults;
  isOwner: boolean;
  all: boolean;
  firstName: string;
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

  const caps = defaults.caps;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h1 className="text-[22px] font-black tracking-tight">سلام {firstName}</h1>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {isOwner ? (
            <div className={SEG}>
              <Link href="/dashboard" className={cn("rounded-lg px-3 py-1.5 transition", !all ? ON : "text-muted")}>
                من
              </Link>
              <Link href="/dashboard?scope=all" className={cn("rounded-lg px-3 py-1.5 transition", all ? ON : "text-muted")}>
                همه
              </Link>
            </div>
          ) : null}
          <div className={SEG}>
            {[
              { k: "graph" as const, label: "جریان", icon: <Network className="size-4" /> },
              { k: "pipeline" as const, label: "فهرست", icon: <LayoutGrid className="size-4" /> },
            ].map((o) => (
              <button
                key={o.k}
                onClick={() => setView(o.k)}
                aria-pressed={view === o.k}
                className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition", view === o.k ? ON : "text-muted")}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!caps.prework || !caps.main ? (
        <Link href="/settings" className="flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold">
          <AlertTriangle className="size-[18px] shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="flex-1">{!caps.ai ? "کلید هوش مصنوعی وصل نشده" : !caps.prework ? "مدل پیش‌کار انتخاب نشده" : "موتور کار اصلی آماده نیست"}</span>
          <span className="text-primary">تنظیمات ←</span>
        </Link>
      ) : null}

      {!all && caps.ai ? <QuickCommand userId={userId} defaults={defaults} /> : null}

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
