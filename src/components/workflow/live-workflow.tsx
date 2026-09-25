"use client";
import * as React from "react";
import {
  ReactFlow,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlowProvider,
  getBezierPath,
  useInternalNode,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
  type XYPosition,
} from "@xyflow/react";
import { Bot, CheckCircle2, Flag, Inbox, Layers, ListOrdered, PauseCircle, Sparkles, ChevronDown, Move, RotateCcw } from "lucide-react";
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

/** CSS color with transparency; works with literals and CSS variables alike. */
function tint(color: string, percent: number) {
  return `color-mix(in oklab, ${color} ${percent}%, transparent)`;
}

function StageNode({ data }: NodeProps<Node<StageNodeData>>) {
  const { stage, tasks, jobs, names, paused, onOpen } = data;
  const groups = groupByRequester(tasks, names);
  const runningJobs = jobs.filter((j) => j.status === "running");
  const isRunningStage = stage.key === "prework_running" || stage.key === "main_running";
  const active = isRunningStage && tasks.length > 0;
  const pausedNow = paused && ((paused.paused_until && new Date(paused.paused_until).getTime() > Date.now()) || paused.manual_pause);

  return (
    <div
      dir="rtl"
      className="glass flex flex-col overflow-hidden rounded-3xl"
      style={{
        width: nodeWidth(stage.key),
        maxHeight: NODE_MAX_H,
        ["--glow" as string]: stage.hex,
        boxShadow: active ? `0 0 0 1.5px ${tint(stage.hex, 45)}, 0 20px 50px -25px ${stage.hex}` : undefined,
      }}
    >
      {/* Edges attach to the node border themselves (see FlowEdge); these handles only satisfy React Flow. */}
      <Handle type="target" position={Position.Right} isConnectable={false} />
      <Handle type="source" position={Position.Left} isConnectable={false} />
      <div
        className="relative flex shrink-0 cursor-grab items-center gap-2.5 px-4 py-3 active:cursor-grabbing"
        style={{ height: HEADER_H, background: `linear-gradient(135deg, ${tint(stage.hex, 16)}, transparent 70%)` }}
        title="برای جابه‌جایی بکشید"
      >
        <div className="grid size-8 shrink-0 place-items-center rounded-xl text-white" style={{ background: stage.hex }}>
          {ICONS[stage.icon]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-extrabold">{stage.label}</p>
          <p className="truncate text-[10.5px] text-muted">{stage.description}</p>
        </div>
        <span className="grid min-w-8 place-items-center rounded-full px-2 py-0.5 text-sm font-black" style={{ background: tint(stage.hex, 14), color: stage.hex }}>
          {faNum(tasks.length)}
        </span>
        {active ? <span className="live-dot absolute left-3 top-3" /> : null}
      </div>

      {pausedNow ? (
        <div className="mx-3 mb-1 flex shrink-0 items-center gap-2 rounded-xl bg-amber-500/12 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          <PauseCircle className="size-3.5" />
          {paused!.manual_pause ? "متوقف (دستی)" : `لیمیت — ادامه ${timeAgo(paused!.paused_until)}`}
        </div>
      ) : null}

      <div className="nowheel nodrag min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {stage.key === "prework_running"
          ? runningJobs.slice(0, 2).map((j) => {
              const t = tasks.find((x) => x.id === j.task_id);
              return (
                <div key={j.id} className="rounded-2xl border border-violet-500/25 bg-violet-500/5 p-2.5">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-violet-600 dark:text-violet-300">
                    <Sparkles className="size-3.5" /> ورکفلوی پیش‌کار {t ? `— ${t.code}` : ""}
                  </p>
                  <MiniPreworkFlow state={j.state} vertical compact />
                </div>
              );
            })
          : null}

        {stage.key === "main_running"
          ? runningJobs.slice(0, 1).map((j) => (
              <div key={j.id} className="rounded-2xl border border-orange-500/25 bg-orange-500/5 p-2.5">
                <TodoList todos={j.state?.todos} compact />
              </div>
            ))
          : null}

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

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
const NODE_W = 290;
const WIDE_W = 370;
const NODE_MAX_H = 500;
const HEADER_H = 60;
const COL_GAP = 90;
const ROW_GAP = 120;
const TOP_ROW = new Set<StageKey>(STAGES.slice(0, 4).map((s) => s.key));

function nodeWidth(key: StageKey) {
  return key === "prework_running" ? WIDE_W : NODE_W;
}

export type LayoutPreset = "rows" | "line";
type Positions = Record<string, XYPosition>;

/** RTL presets: the flow starts at the right. "rows" wraps into a U-turn on two rows, "line" keeps all 7 stages in one row. */
function presetPositions(preset: LayoutPreset): Positions {
  const pos: Positions = {};
  const row = (stages: StageDef[], y: number, rightToLeft: boolean) => {
    const ordered = rightToLeft ? [...stages].reverse() : stages;
    let x = 0;
    for (const s of ordered) {
      pos[s.key] = { x, y };
      x += nodeWidth(s.key) + COL_GAP;
    }
  };
  if (preset === "line") row(STAGES, 0, true);
  else {
    row(STAGES.slice(0, 4), 0, true);
    row(STAGES.slice(4), NODE_MAX_H + ROW_GAP, false);
  }
  return pos;
}

const LAYOUT_KEY = "taskflow.workflow.layout.v2";
type SavedLayout = { preset: LayoutPreset | "custom"; positions?: Positions };

function loadLayout(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? (JSON.parse(raw) as SavedLayout) : null;
  } catch {
    return null;
  }
}

function saveLayout(layout: SavedLayout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // private mode / storage disabled: layout just isn't remembered
  }
}

// ---------------------------------------------------------------------------
// Floating edge: always leaves the side of the source that faces the target and
// enters the facing side of the target, wherever the nodes are dragged.
// ---------------------------------------------------------------------------
type Box = { x: number; y: number; w: number; h: number };

function box(n: InternalNode): Box {
  return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? 0, h: n.measured.height ?? 0 };
}

export function edgeSides(s: Box, t: Box): [Position, Position] {
  const gapX = Math.max(t.x - (s.x + s.w), s.x - (t.x + t.w));
  const gapY = Math.max(t.y - (s.y + s.h), s.y - (t.y + t.h));
  if (gapX >= gapY) return t.x + t.w / 2 >= s.x + s.w / 2 ? [Position.Right, Position.Left] : [Position.Left, Position.Right];
  return t.y + t.h / 2 >= s.y + s.h / 2 ? [Position.Bottom, Position.Top] : [Position.Top, Position.Bottom];
}

/** Side anchors sit at header height so nodes side by side are joined by a straight line even when their heights differ. */
export function anchorPoint(b: Box, side: Position): XYPosition {
  const midY = b.y + Math.min(HEADER_H / 2, b.h / 2);
  switch (side) {
    case Position.Left:
      return { x: b.x, y: midY };
    case Position.Right:
      return { x: b.x + b.w, y: midY };
    case Position.Top:
      return { x: b.x + b.w / 2, y: b.y };
    default:
      return { x: b.x + b.w / 2, y: b.y + b.h };
  }
}

type FlowEdgeData = { flowing: boolean; color: string };

function FlowEdge({ id, source, target, markerEnd, style, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  if (!s?.measured.width || !t?.measured.width) return null;
  const sb = box(s);
  const tb = box(t);
  const [sp, tp] = edgeSides(sb, tb);
  const a = anchorPoint(sb, sp);
  const b = anchorPoint(tb, tp);
  const [path] = getBezierPath({ sourceX: a.x, sourceY: a.y, sourcePosition: sp, targetX: b.x, targetY: b.y, targetPosition: tp, curvature: 0.35 });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {data?.flowing ? (
        <circle r={4.5} fill={data.color} style={{ filter: `drop-shadow(0 0 4px ${data.color})` }}>
          <animateMotion dur="2.2s" repeatCount="indefinite" path={path} />
        </circle>
      ) : null}
    </>
  );
}

const nodeTypes = { stage: StageNode };
const edgeTypes = { flow: FlowEdge };

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

export function LiveWorkflowGraph(props: { data: ReturnType<typeof useWorkflowState>; onOpen: (t: Task) => void }) {
  return (
    <div dir="ltr" className="h-[78vh] min-h-[640px] w-full overflow-hidden rounded-3xl border border-line">
      <ReactFlowProvider>
        <WorkflowCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}

function WorkflowCanvas({ data, onOpen }: { data: ReturnType<typeof useWorkflowState>; onOpen: (t: Task) => void }) {
  const now = useNow(30_000);
  const { fitView, getNodes } = useReactFlow();
  const grouped = byStage(data.tasks);
  const gemini = data.providers.find((p) => p.provider === "gemini") ?? null;
  const claude = data.providers.find((p) => p.provider === "claude") ?? null;
  const [preset, setPreset] = React.useState<LayoutPreset | "custom">("rows");

  const stageData = (s: StageDef): StageNodeData => ({
    stage: s,
    tasks: grouped.get(s.key) ?? [],
    jobs: data.jobs.filter((j) => (s.key === "prework_running" ? j.kind === "prework" : s.key === "main_running" ? j.kind === "main" : false)),
    names: data.names,
    paused: s.key === "prework_running" ? gemini : s.key === "main_running" ? claude : null,
    onOpen,
  });

  const initialPositions = React.useMemo(() => presetPositions("rows"), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StageNodeData>>(
    STAGES.map((s) => ({ id: s.key, type: "stage", position: initialPositions[s.key], data: stageData(s) })),
  );

  // Live data flows into the existing nodes without touching their (possibly dragged) positions;
  // `now` re-renders relative times such as the pause countdown.
  React.useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: stageData(STAGES.find((s) => s.key === n.id)!) })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks, data.jobs, data.providers, data.names, onOpen, now]);

  const applyPositions = React.useCallback(
    (positions: Positions, animate = true) => {
      setNodes((ns) => ns.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)));
      requestAnimationFrame(() => void fitView({ padding: 0.08, duration: animate ? 400 : 0 }));
    },
    [setNodes, fitView],
  );

  // Restore the viewer's own arrangement after mount (localStorage is not available during SSR).
  React.useEffect(() => {
    const saved = loadLayout();
    if (!saved) return;
    if (saved.preset === "custom" && saved.positions) {
      setPreset("custom");
      applyPositions(saved.positions, false);
    } else if (saved.preset === "line") {
      setPreset("line");
      applyPositions(presetPositions("line"), false);
    }
  }, [applyPositions]);

  // In the two-row preset the second row sits just below the tallest node of the first row
  // (measured, so the gap stays tight whether the stages are empty or full).
  const topRowHeight = Math.max(0, ...nodes.filter((n) => TOP_ROW.has(n.id as StageKey)).map((n) => n.measured?.height ?? 0));
  const fittedRows = React.useRef(false);
  React.useEffect(() => {
    if (preset !== "rows" || !topRowHeight) return;
    const y = Math.ceil(topRowHeight) + ROW_GAP;
    setNodes((ns) => (ns.some((n) => !TOP_ROW.has(n.id as StageKey) && Math.abs(n.position.y - y) > 8) ? ns.map((n) => (TOP_ROW.has(n.id as StageKey) ? n : { ...n, position: { ...n.position, y } })) : ns));
    if (!fittedRows.current) {
      fittedRows.current = true;
      requestAnimationFrame(() => void fitView({ padding: 0.08 }));
    }
  }, [preset, topRowHeight, setNodes, fitView]);

  const choose = (p: LayoutPreset) => {
    setPreset(p);
    saveLayout({ preset: p });
    applyPositions(presetPositions(p));
  };

  const onNodeDragStop = React.useCallback(() => {
    setPreset("custom");
    saveLayout({ preset: "custom", positions: Object.fromEntries(getNodes().map((n) => [n.id, n.position])) });
  }, [getNodes]);

  const edges: Edge<FlowEdgeData>[] = STAGES.slice(0, -1).map((s, i) => {
    const next = STAGES[i + 1];
    const busy = (grouped.get(next.key)?.length ?? 0) > 0;
    const flowing = busy && (next.key === "prework_running" || next.key === "main_running");
    const color = busy ? next.hex : "#94a3b8";
    return {
      id: `${s.key}-${next.key}`,
      source: s.key,
      target: next.key,
      type: "flow",
      className: flowing ? "flowing" : undefined,
      data: { flowing, color: next.hex },
      style: { stroke: color, strokeWidth: busy ? 2.5 : 2, opacity: busy ? 1 : 0.75 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    };
  });

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.25}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      panOnScroll
    >
      <Panel position="top-right">
        <div dir="rtl" className="glass flex items-center gap-1 rounded-xl p-1 text-xs">
          <span className="hidden items-center gap-1 px-2 text-muted sm:flex">
            <Move className="size-3.5" /> گره‌ها را بکشید
          </span>
          {(
            [
              { k: "rows", label: "دو ردیف" },
              { k: "line", label: "یک خط" },
            ] as const
          ).map((o) => (
            <button
              key={o.k}
              onClick={() => choose(o.k)}
              className={cn("rounded-lg px-2.5 py-1.5 font-bold transition", preset === o.k ? "bg-surface-strong text-fg shadow-card" : "text-muted hover:text-fg")}
            >
              {o.label}
            </button>
          ))}
          {preset === "custom" ? (
            <button onClick={() => choose("rows")} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-bold text-muted hover:text-fg" title="بازگشت به چیدمان پیش‌فرض">
              <RotateCcw className="size-3.5" /> بازنشانی
            </button>
          ) : null}
        </div>
      </Panel>
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
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
                <span className="rounded-full px-2 text-sm font-black" style={{ background: tint(s.hex, 14), color: s.hex }}>
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
