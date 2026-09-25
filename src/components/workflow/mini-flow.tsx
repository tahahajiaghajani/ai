"use client";
import { Check, Loader2, Pause, X, Minus } from "lucide-react";
import { PREWORK_NODES } from "@/lib/status";
import { cn, faNum } from "@/lib/utils";
import type { JobState, NodeState, TodoItem } from "@/lib/types";

function NodeIcon({ s }: { s?: NodeState["status"] }) {
  if (s === "done") return <Check className="size-3.5" />;
  if (s === "running") return <Loader2 className="size-3.5 animate-spin" />;
  if (s === "paused") return <Pause className="size-3.5" />;
  if (s === "error") return <X className="size-3.5" />;
  if (s === "skipped") return <Minus className="size-3.5" />;
  return null;
}

const NODE_STYLE: Record<string, string> = {
  done: "bg-emerald-500 text-white border-emerald-500",
  running: "bg-violet-500 text-white border-violet-500 shadow-[0_0_0_4px_rgba(139,92,246,0.25)]",
  paused: "bg-amber-500 text-white border-amber-500",
  error: "bg-rose-500 text-white border-rose-500",
  skipped: "bg-surface-muted text-faint border-line",
  pending: "bg-surface-strong text-faint border-line-strong",
};

/**
 * The pre-work sub-workflow (8 agent steps) with live status.
 * `vertical` is used inside the React Flow node and on mobile.
 */
export function MiniPreworkFlow({ state, vertical, compact }: { state: JobState | null | undefined; vertical?: boolean; compact?: boolean }) {
  const nodes = state?.nodes ?? {};
  const live = state?.live;
  return (
    <div className={cn("relative", vertical ? "flex flex-col gap-0" : "flex items-start gap-0 overflow-x-auto pb-1")}>
      {PREWORK_NODES.map((n, i) => {
        const s = nodes[n.key]?.status ?? "pending";
        const node = nodes[n.key];
        const last = i === PREWORK_NODES.length - 1;
        return (
          <div key={n.key} className={cn("relative flex", vertical ? "items-start gap-2.5" : "min-w-[68px] flex-1 flex-col items-center text-center")}>
            <div className={cn("flex", vertical ? "flex-col items-center" : "w-full items-center")}>
              {!vertical ? <div className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : s === "pending" ? "bg-line-strong" : "bg-emerald-500/60")} /> : null}
              <div className={cn("grid shrink-0 place-items-center rounded-full border-2 transition-all", compact ? "size-5" : "size-7", NODE_STYLE[s])}>
                <NodeIcon s={s} />
              </div>
              {!vertical ? <div className={cn("h-0.5 flex-1", last ? "opacity-0" : nodes[PREWORK_NODES[i + 1]?.key]?.status && nodes[PREWORK_NODES[i + 1].key].status !== "pending" ? "bg-emerald-500/60" : "bg-line-strong")} /> : null}
              {vertical && !last ? <div className={cn("w-0.5", compact ? "h-3" : "h-5", s === "done" ? "bg-emerald-500/60" : "bg-line-strong")} /> : null}
            </div>
            <div className={cn(vertical ? "pb-1" : "mt-1.5 px-1")}>
              <p className={cn("font-semibold leading-5", compact ? "text-[10.5px]" : "text-[11.5px]", s === "running" ? "text-violet-600 dark:text-violet-300" : s === "pending" ? "text-faint" : "text-fg")}>
                {n.label}
              </p>
              {!compact ? (
                <p className="text-[10px] leading-4 text-faint">
                  {n.agent}
                  {node?.total ? ` · ${faNum(node.done ?? 0)}/${faNum(node.total)}` : ""}
                </p>
              ) : node?.total && s === "running" ? (
                <p className="text-[10px] text-faint">
                  {faNum(node.done ?? 0)}/{faNum(node.total)}
                </p>
              ) : null}
              {s === "running" && live?.node === n.key && live.thought ? (
                <p className="mt-0.5 line-clamp-2 max-w-[220px] text-[10px] italic leading-4 text-violet-500">{live.thought}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TodoList({ todos, compact }: { todos: TodoItem[] | undefined; compact?: boolean }) {
  if (!todos?.length) return <p className="text-xs text-muted">Claude هنوز فهرست کارها را نساخته است.</p>;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-bold">فهرست کارهای Claude</span>
        <span className="text-muted">
          {faNum(done)} از {faNum(todos.length)}
        </span>
      </div>
      <ul className={cn("space-y-1", compact && "max-h-40 overflow-y-auto")}>
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px] leading-6">
            <span
              className={cn(
                "mt-1 grid size-4 shrink-0 place-items-center rounded-md border",
                t.status === "completed" ? "border-emerald-500 bg-emerald-500 text-white" : t.status === "in_progress" ? "border-orange-500" : "border-line-strong",
              )}
            >
              {t.status === "completed" ? <Check className="size-3" /> : t.status === "in_progress" ? <Loader2 className="size-3 animate-spin text-orange-500" /> : null}
            </span>
            <span dir="auto" className={cn(t.status === "completed" && "text-muted line-through", t.status === "in_progress" && "font-semibold text-orange-600 dark:text-orange-300")}>
              {t.status === "in_progress" && t.activeForm ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
