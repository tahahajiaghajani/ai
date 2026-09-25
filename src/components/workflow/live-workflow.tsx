"use client";
import * as React from "react";
import { ReactFlow, Controls, Handle, Position, type Edge, type Node, type NodeProps, ReactFlowProvider, MarkerType } from "@xyflow/react";
import { Bot, CheckCircle2, Flag, Inbox, Layers, ListOrdered, PauseCircle, Sparkles, ChevronDown } from "lucide-react";
import { STAGES, type StageDef, type StageKey } from "@/lib/status";
import { useRealtimeRows, useNow } from "@/hooks/use-realtime";
import { Avatar, Progress } from "@/components/ui/primitives";
import { PriorityDot } from "@/components/tasks/badges";
import { MiniPreworkFlow, TodoList } from "@/components/workflow/mini-flow";
import { cn, faNum, truncate } from "@/lib/utils";
import { timeAgo } from "@/lib/jalali";
import type { Job, Profile, ProviderState, Task } from "@/lib/types";

const ICONS: Record<string, React.ReactNode> = {
  inbox: <Inbox className="size-4" />,
  "list-ordered": <ListOrdered className="size-4" />,
  sparkles: <Sparkles className="size-4" />,
  layers: <Layers className="size-4" />,
  bot: <Bot className="size-4" />,
  flag: <Flag className="size-4" />,
  "check-circle": <CheckCircle2 className="size-4" />,
};

export interface WorkflowData {
  tasks: Task[];
  jobs: Job[];
  profiles: Pick<Profile, "id" | "full_name" | "email" | "org_unit">[];
  providers: ProviderState[];
}

interface StageNodeData extends Record<string, unknown> {
  stage: StageDef;
  tasks: Task[];
  jobs: Job[];
  names: Map<string, string>;
  paused: ProviderState | null;
  onOpen: (task: Task) => void;
}

function groupByRequester(tasks: Task[], names: Map<string, string>) {
  const groups = new Map<string, Task[]>();
  for (const t of tasks) groups.set(t.requester_id, [...(groups.get(t.requester_id) ?? []), t]);
  return [...groups.entries()]
    .map(([id, list]) => ({ id, name: names.get(id) ?? "ناشناس", list: list.sort((a, b) => a.code.localeCompare(b.code)) }))
    .sort((a, b) => b.list.length - a.list.length);
}

function TaskChip({ task, job, onOpen, stage }: { task: Task; job?: Job; onOpen: (t: Task) => void; stage: StageKey }) {
  const running = stage === "prework_running" || task.status === "main_running";
  const queued = task.status === "prework_queued" || task.status === "main_queued";
  return (
    <button
      onClick={() => onOpen(task)}
      className={cn(
        "nodrag group w-full rounded-xl border border-line bg-surface-strong/90 px-2.5 py-2 text-start transition hover:-translate-y-px hover:border-line-strong hover:shadow-card",
        running && "border-[color-mix(in_oklab,var(--glow)_45%,transparent)]",
      )}
    >
      <div className="flex items-center gap-1.5">
        <PriorityDot priority={task.priority} />
        <span className="ltr text-[10.5px] font-bold text-muted">{task.code}</span>
        {task.parent_id ? <span className="rounded bg-pink-500/12 px-1 text-[9.5px] font-bold text-pink-600 dark:text-pink-300">مرتبط</span> : null}
        {queued ? <span className="ms-auto rounded bg-sky-500/12 px-1.5 text-[9.5px] font-bold text-sky-600 dark:text-sky-300">در صف اجرا</span> : null}
        {task.status === "returned" ? <span className="ms-auto rounded bg-rose-500/12 px-1.5 text-[9.5px] font-bold text-rose-600">برگشتی</span> : null}
        {task.status === "closure_rejected" ? <span className="ms-auto rounded bg-rose-500/12 px-1.5 text-[9.5px] font-bold text-rose-600">رد شد</span> : null}
        {task.status === "main_done" ? <span className="ms-auto rounded bg-emerald-500/12 px-1.5 text-[9.5px] font-bold text-emerald-600">آماده‌ی بازبینی</span> : null}
        {running ? <span className="live-dot ms-auto" /> : null}
      </div>
      <p className="mt-0.5 line-clamp-2 text-[12px] font-semibold leading-5">{task.title}</p>
      {task.progress > 0 && task.status !== "closed" ? <Progress value={task.progress} className="mt-1.5 h-1" /> : null}
      {job && running && job.state?.live?.thought ? <p className="mt-1 line-clamp-1 text-[10px] italic text-muted">{job.state.live.thought}</p> : null}
    </button>
  );
}

function StageNode({ data }: NodeProps<Node<StageNodeData>>) {
  const { stage, tasks, jobs, names, paused, onOpen } = data;
  const groups = groupByRequester(tasks, names);
  const runningJobs = jobs.filter((j) => j.status === "running");
  const isRunningStage = stage.key === "prework_running" || stage.key === "main_running";
  const active = isRunningStage && tasks.length > 0;
  const pausedNow = paused && ((paused.paused_until && new Date(paused.paused_until).getTime() > Date.now()) || paused.manual_pause);
  const wide = stage.key === "prework_running";

  return (
    <div
      className={cn("glass flex flex-col overflow-hidden rounded-3xl", wide ? "w-[380px]" : "w-[290px]")}
      style={{ ["--glow" as string]: stage.color, boxShadow: active ? `0 0 0 1px ${stage.color}55, 0 20px 50px -25px ${stage.color}` : undefined }}
    >
      <Handle type="target" position={Position.Right} />
      <Handle type="source" position={Position.Left} />
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <div className="relative flex items-center gap-2.5 px-4 py-3" style={{ background: `linear-gradient(135deg, ${stage.color}22, transparent 70%)` }}>
        <div className="grid size-8 place-items-center rounded-xl text-white" style={{ background: stage.color }}>
          {ICONS[stage.icon]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-extrabold">{stage.label}</p>
          <p className="truncate text-[10.5px] text-muted">{stage.description}</p>
        </div>
        <span className="grid min-w-8 place-items-center rounded-full px-2 py-0.5 text-sm font-black" style={{ background: `${stage.color}22`, color: stage.color }}>
          {faNum(tasks.length)}
        </span>
        {active ? <span className="live-dot absolute left-3 top-3" /> : null}
      </div>

      {pausedNow ? (
        <div className="mx-3 mb-1 flex items-center gap-2 rounded-xl bg-amber-500/12 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <PauseCircle className="size-3.5" />
          {paused!.manual_pause ? "متوقف (دستی)" : `لیمیت — ادامه ${timeAgo(paused!.paused_until)}`}
        </div>
      ) : null}

      {stage.key === "prework_running" && runningJobs.length ? (
        <div className="mx-3 mb-2 space-y-2">
          {runningJobs.slice(0, 2).map((j) => {
            const t = tasks.find((x) => x.id === j.task_id);
            return (
              <div key={j.id} className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-2.5">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-violet-600 dark:text-violet-300">
                  <Sparkles className="size-3.5" /> ورکفلوی پیش‌کار {t ? `— ${t.code}` : ""}
                </p>
                <MiniPreworkFlow state={j.state} vertical compact />
              </div>
            );
          })}
        </div>
      ) : null}

      {stage.key === "main_running" && runningJobs.length ? (
        <div className="mx-3 mb-2 space-y-2">
          {runningJobs.slice(0, 1).map((j) => (
            <div key={j.id} className="rounded-2xl border border-orange-500/25 bg-orange-500/5 p-2.5">
              <TodoList todos={j.state?.todos} compact />
            </div>
          ))}
        </div>
      ) : null}

      <div className="nowheel max-h-[360px] space-y-3 overflow-y-auto px-3 pb-3">
        {groups.length === 0 ? (
          <p className="py-6 text-center text-xs text-faint">خالی</p>
        ) : (
          groups.map((g) => (
            <div key={g.id}>
              <div className="mb-1.5 flex items-center gap-1.5">
                <Avatar name={g.name} size={20} />
                <span className="truncate text-[11.5px] font-bold text-muted">{g.name}</span>
                <span className="text-[10.5px] text-faint">({faNum(g.list.length)})</span>
              </div>
              <div className="space-y-1.5">
                {g.list.slice(0, 12).map((t) => (
                  <TaskChip key={t.id} task={t} onOpen={onOpen} stage={stage.key} job={jobs.find((j) => j.task_id === t.id && j.status === "running")} />
                ))}
                {g.list.length > 12 ? <p className="text-center text-[10.5px] text-faint">+{faNum(g.list.length - 12)} تسک دیگر</p> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const nodeTypes = { stage: StageNode };

// Snake layout (RTL): top row right→left, bottom row left→right.
const POSITIONS: Record<StageKey, { x: number; y: number }> = {
  approval: { x: 1290, y: 0 },
  prework_queue: { x: 950, y: 0 },
  prework_running: { x: 520, y: 0 },
  main_queue: { x: 180, y: 0 },
  main_running: { x: 180, y: 620 },
  closure: { x: 560, y: 620 },
  closed: { x: 920, y: 620 },
};

export function useWorkflowState(initial: WorkflowData) {
  const [tasks] = useRealtimeRows<Task & Record<string, unknown>>("tasks", initial.tasks as (Task & Record<string, unknown>)[]);
  const [jobs] = useRealtimeRows<Job & Record<string, unknown>>("jobs", initial.jobs as (Job & Record<string, unknown>)[], {
    accept: (j) => j.status === "running" || j.status === "queued",
  });
  const [providers] = useRealtimeRows<ProviderState & Record<string, unknown>>("provider_state", initial.providers as (ProviderState & Record<string, unknown>)[], {
    idKey: "provider",
  });
  const names = React.useMemo(() => new Map(initial.profiles.map((p) => [p.id, p.full_name || p.email || "—"])), [initial.profiles]);
  return { tasks: tasks as Task[], jobs: jobs as Job[], providers: providers as ProviderState[], names };
}

function byStage(tasks: Task[]) {
  const map = new Map<StageKey, Task[]>();
  for (const s of STAGES) map.set(s.key, []);
  for (const t of tasks) {
    const s = STAGES.find((x) => x.statuses.includes(t.status));
    if (s) map.get(s.key)!.push(t);
  }
  return map;
}

export function LiveWorkflowGraph({ data, onOpen }: { data: ReturnType<typeof useWorkflowState>; onOpen: (t: Task) => void }) {
  useNow(30_000);
  const grouped = byStage(data.tasks);
  const gemini = data.providers.find((p) => p.provider === "gemini") ?? null;
  const claude = data.providers.find((p) => p.provider === "claude") ?? null;

  const nodes: Node<StageNodeData>[] = STAGES.map((s) => ({
    id: s.key,
    type: "stage",
    position: POSITIONS[s.key],
    data: {
      stage: s,
      tasks: grouped.get(s.key) ?? [],
      jobs: data.jobs.filter((j) => (s.key === "prework_running" ? j.kind === "prework" : s.key === "main_running" ? j.kind === "main" : false)),
      names: data.names,
      paused: s.key === "prework_running" ? gemini : s.key === "main_running" ? claude : null,
      onOpen,
    },
    draggable: true,
  }));

  const edges: Edge[] = STAGES.slice(0, -1).map((s, i) => {
    const next = STAGES[i + 1];
    const flowing = (grouped.get(next.key)?.length ?? 0) > 0 && ["prework_running", "main_running"].includes(next.key);
    const vertical = s.key === "main_queue";
    return {
      id: `${s.key}-${next.key}`,
      source: s.key,
      target: next.key,
      sourceHandle: vertical ? "bottom" : undefined,
      targetHandle: vertical ? "top" : undefined,
      type: "smoothstep",
      className: flowing ? "flowing" : undefined,
      style: { stroke: flowing ? next.color : undefined, strokeWidth: flowing ? 2.5 : 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: flowing ? next.color : "var(--border-strong)" },
    };
  });

  return (
    <div dir="ltr" className="h-[78vh] min-h-[640px] w-full overflow-hidden rounded-3xl border border-line">
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.08 }} minZoom={0.3} maxZoom={1.6} proOptions={{ hideAttribution: true }} nodesConnectable={false} panOnScroll>
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/** Mobile: the same 7 stages as a vertical, collapsible pipeline. */
export function LiveWorkflowMobile({ data, onOpen }: { data: ReturnType<typeof useWorkflowState>; onOpen: (t: Task) => void }) {
  useNow(30_000);
  const grouped = byStage(data.tasks);
  const [open, setOpen] = React.useState<Record<string, boolean>>({ prework_running: true, main_running: true, approval: true });
  return (
    <div className="relative space-y-3">
      <div className="absolute inset-y-4 right-[22px] w-0.5 bg-gradient-to-b from-[var(--stage-approval)] via-[var(--stage-prework)] to-[var(--stage-closed)] opacity-40" />
      {STAGES.map((s) => {
        const list = grouped.get(s.key) ?? [];
        const jobs = data.jobs.filter((j) => j.status === "running" && ((s.key === "prework_running" && j.kind === "prework") || (s.key === "main_running" && j.kind === "main")));
        const isOpen = open[s.key] ?? list.length > 0;
        const names = data.names;
        return (
          <div key={s.key} className="relative ps-12">
            <div className="absolute right-2.5 top-3 grid size-6 place-items-center rounded-full text-white ring-4 ring-[var(--bg)]" style={{ background: s.color }}>
              <span className="scale-75">{ICONS[s.icon]}</span>
            </div>
            <div className="glass overflow-hidden rounded-2xl" style={{ ["--glow" as string]: s.color }}>
              <button className="flex w-full items-center gap-2 px-4 py-3 text-start" onClick={() => setOpen((o) => ({ ...o, [s.key]: !isOpen }))}>
                <span className="flex-1 text-sm font-extrabold">{s.label}</span>
                {jobs.length ? <span className="live-dot" /> : null}
                <span className="rounded-full px-2 text-sm font-black" style={{ background: `${s.color}22`, color: s.color }}>
                  {faNum(list.length)}
                </span>
                <ChevronDown className={cn("size-4 text-muted transition", isOpen && "rotate-180")} />
              </button>
              {isOpen ? (
                <div className="space-y-3 border-t border-line px-3 pb-3 pt-3">
                  {jobs.map((j) =>
                    j.kind === "prework" ? (
                      <div key={j.id} className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-3">
                        <MiniPreworkFlow state={j.state} vertical compact />
                      </div>
                    ) : (
                      <div key={j.id} className="rounded-2xl border border-orange-500/25 bg-orange-500/5 p-3">
                        <TodoList todos={j.state?.todos} compact />
                      </div>
                    ),
                  )}
                  {groupByRequester(list, names).map((g) => (
                    <div key={g.id}>
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <Avatar name={g.name} size={20} />
                        <span className="text-xs font-bold text-muted">{truncate(g.name, 30)}</span>
                      </div>
                      <div className="grid gap-1.5">
                        {g.list.map((t) => (
                          <TaskChip key={t.id} task={t} onOpen={onOpen} stage={s.key} job={jobs.find((j) => j.task_id === t.id)} />
                        ))}
                      </div>
                    </div>
                  ))}
                  {list.length === 0 && !jobs.length ? <p className="py-2 text-center text-xs text-faint">خالی</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
