"use client";
import * as React from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { toast } from "sonner";
import { AlertTriangle, Bot, Copy, FileText, GitBranch, LayoutGrid, MessageSquareText, Plus, Save, ScrollText, Sparkles, Star, Trash2 } from "lucide-react";
import { Badge, Button, Field, Input, Select, Switch, Textarea } from "@/components/ui/primitives";
import { saveWorkflowAction } from "@/app/actions/workflows";
import { cn, faNum } from "@/lib/utils";
import { AGENT_TYPE_META, layers, newId, STAGE_LABEL, validateWorkflow, type AgentDef, type Branch, type WorkflowDef, type WorkflowNode } from "@/lib/workflow/types";

type StepData = Omit<WorkflowNode, "id" | "x" | "y"> & { agent?: AgentDef };
type StepNode = Node<StepData, "step">;
type StepEdge = Edge<{ when?: Branch }>;

const ICON = { gemini: Sparkles, router: GitBranch, claude: Bot };
const GAP_X = 300;
const GAP_Y = 150;

function edgeLook(when?: Branch): Partial<StepEdge> {
  const color = when === "yes" ? "var(--success)" : when === "no" ? "var(--danger)" : "var(--border-strong)";
  return {
    type: "smoothstep",
    label: when === "yes" ? "بله" : when === "no" ? "خیر" : undefined,
    labelStyle: { fill: color, fontWeight: 700, fontFamily: "var(--font-sans)" },
    labelBgStyle: { fill: "var(--surface-strong)" },
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
  };
}

function StepCard({ data, selected }: NodeProps<StepNode>) {
  const agent = data.agent;
  const type = agent?.type ?? "gemini";
  const Icon = ICON[type];
  const color = agent?.color ?? AGENT_TYPE_META[type].color;
  return (
    <div dir="rtl" className={cn("w-[230px] rounded-2xl border border-line bg-surface-strong shadow-card transition", selected && "ring-2 ring-primary")}>
      {/* the canvas reads right-to-left: inputs arrive on the right, outputs leave on the left */}
      <Handle type="target" position={Position.Right} />
      <div className="h-1.5 rounded-t-2xl" style={{ background: color }} />
      <div className="p-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg text-white" style={{ background: color }}>
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-extrabold">{data.label || agent?.name || "ایجنت ناشناخته"}</p>
            <p className="truncate text-[10.5px] text-muted">{data.label ? agent?.name : AGENT_TYPE_META[type].label}</p>
          </div>
        </div>
        {data.saveAs || data.reply || data.brief || data.instructions ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {data.brief ? <Badge tone="violet">دستور کار Claude</Badge> : null}
            {data.saveAs ? (
              <Badge tone="info">
                <span className="ltr">{data.saveAs}</span>
              </Badge>
            ) : null}
            {data.reply ? <Badge tone="success">پاسخ چت</Badge> : null}
            {data.instructions ? <Badge>دستور ویژه</Badge> : null}
          </div>
        ) : null}
      </div>
      {type === "router" ? (
        <>
          <Handle id="yes" type="source" position={Position.Left} className="handle-yes" style={{ top: "38%" }} />
          <Handle id="no" type="source" position={Position.Left} className="handle-no" style={{ top: "72%" }} />
          <span className="pointer-events-none absolute -left-9 top-[30%] text-[10px] font-bold text-success">بله</span>
          <span className="pointer-events-none absolute -left-9 top-[64%] text-[10px] font-bold text-danger">خیر</span>
        </>
      ) : (
        <Handle type="source" position={Position.Left} />
      )}
    </div>
  );
}

const nodeTypes = { step: StepCard };

function toNodes(wf: WorkflowDef, agents: Record<string, AgentDef>): StepNode[] {
  return wf.nodes.map((n) => {
    const { id, x, y, ...data } = n;
    return { id, type: "step", position: { x, y }, data: { ...data, agent: agents[n.agentId] } };
  });
}

function toEdges(wf: WorkflowDef): StepEdge[] {
  return wf.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.when ?? null, data: { when: e.when }, ...edgeLook(e.when) }));
}

export interface EditorProps {
  workflow: WorkflowDef;
  agents: AgentDef[];
  onSaved: (workflows: WorkflowDef[], id: string) => void;
  onDuplicate: (wf: WorkflowDef) => void;
  onDelete: (wf: WorkflowDef) => void;
  onEditAgent: (agentId: string) => void;
}

function Editor({ workflow, agents, onSaved, onDuplicate, onDelete, onEditAgent }: EditorProps) {
  const byId = React.useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);
  const [meta, setMeta] = React.useState({ name: workflow.name, description: workflow.description ?? "", isDefault: !!workflow.isDefault });
  const [nodes, setNodes, onNodesChange] = useNodesState<StepNode>(toNodes(workflow, byId));
  const [edges, setEdges, onEdgesChange] = useEdgesState<StepEdge>(toEdges(workflow));
  const [selected, setSelected] = React.useState<{ kind: "node" | "edge"; id: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const { fitView } = useReactFlow();
  const palette = agents.filter((a) => workflow.stage === "main" || a.type !== "claude");

  // agent edits (name, color, type) show up on the canvas right away
  React.useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, agent: byId[n.data.agentId] } })));
  }, [byId, setNodes]);

  const current = React.useCallback(
    (): WorkflowDef => ({
      id: workflow.id,
      stage: workflow.stage,
      builtin: workflow.builtin,
      name: meta.name,
      description: meta.description,
      isDefault: meta.isDefault,
      nodes: nodes.map((n) => {
        const { agent: _agent, ...data } = n.data;
        void _agent;
        return { ...data, id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) };
      }),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, when: e.data?.when })),
    }),
    [workflow, meta, nodes, edges],
  );
  const problems = React.useMemo(() => validateWorkflow(current(), byId), [current, byId]);

  const touch = () => setDirty(true);
  const patchNode = (id: string, patch: Partial<StepData>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch, agent: byId[patch.agentId ?? n.data.agentId] } } : n)));
    touch();
  };

  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const when = c.sourceHandle === "yes" || c.sourceHandle === "no" ? (c.sourceHandle as Branch) : undefined;
    if (edges.some((e) => e.source === c.source && e.target === c.target && e.data?.when === when)) return;
    setEdges((es) => [...es, { id: newId("e"), source: c.source!, target: c.target!, sourceHandle: when ?? null, data: { when }, ...edgeLook(when) }]);
    touch();
  };

  const addAgent = (agent: AgentDef) => {
    const after = selected?.kind === "node" ? nodes.find((n) => n.id === selected.id) : null;
    const leftmost = nodes.reduce((m, n) => Math.min(m, n.position.x), Infinity);
    const position = after
      ? { x: after.position.x - GAP_X, y: after.position.y + nodes.filter((n) => Math.abs(n.position.x - (after.position.x - GAP_X)) < 40).length * GAP_Y }
      : { x: Number.isFinite(leftmost) ? leftmost - GAP_X : 0, y: 100 };
    const id = newId("n");
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: "step", position, selected: true, data: { agentId: agent.id, agent } }]);
    if (after) {
      // new steps are chained after the selected one (a condition continues on its «yes» branch)
      const when: Branch | undefined = after.data.agent?.type === "router" ? "yes" : undefined;
      setEdges((es) => [...es, { id: newId("e"), source: after.id, target: id, sourceHandle: when ?? null, data: { when }, ...edgeLook(when) }]);
    }
    setSelected({ kind: "node", id });
    touch();
  };

  const removeSelected = () => {
    if (!selected) return;
    if (selected.kind === "node") {
      setNodes((ns) => ns.filter((n) => n.id !== selected.id));
      setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
    } else setEdges((es) => es.filter((e) => e.id !== selected.id));
    setSelected(null);
    touch();
  };

  const autoLayout = () => {
    const ls = layers(current());
    const pos = new Map<string, { x: number; y: number }>();
    ls.forEach((ids, i) => ids.forEach((id, j) => pos.set(id, { x: (ls.length - 1 - i) * GAP_X, y: (j - (ids.length - 1) / 2) * GAP_Y + 150 })));
    setNodes((ns) => ns.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    requestAnimationFrame(() => void fitView({ padding: 0.2, duration: 300 }));
    touch();
  };

  const save = async () => {
    setBusy(true);
    const r = await saveWorkflowAction(current());
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setDirty(false);
    toast.success("ورکفلو ذخیره شد");
    onSaved(r.data.workflows, r.data.id);
  };

  const node = selected?.kind === "node" ? nodes.find((n) => n.id === selected.id) : null;
  const edge = selected?.kind === "edge" ? edges.find((e) => e.id === selected.id) : null;
  const label = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n?.data.label || n?.data.agent?.name || id;
  };

  const panel = node ? (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-extrabold">تنظیمات این مرحله</p>
        <Button size="sm" variant="ghost" className="text-danger" onClick={removeSelected}>
          <Trash2 className="size-4" /> حذف
        </Button>
      </div>
      <Field label="ایجنت">
        <Select value={node.data.agentId} onChange={(e) => patchNode(node.id, { agentId: e.target.value })}>
          {palette.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {AGENT_TYPE_META[a.type].label}
            </option>
          ))}
        </Select>
      </Field>
      {node.data.agent ? (
        <p className="text-xs leading-6 text-muted">
          {node.data.agent.description}{" "}
          <button type="button" className="font-bold text-primary" onClick={() => onEditAgent(node.data.agentId)}>
            ویرایش ایجنت و پرامپت
          </button>
        </p>
      ) : null}
      <Field label="عنوان در این ورکفلو (اختیاری)">
        <Input value={node.data.label ?? ""} placeholder={node.data.agent?.name} onChange={(e) => patchNode(node.id, { label: e.target.value || undefined })} />
      </Field>
      <Field label="دستور ویژه‌ی این مرحله (اختیاری)" hint="به پرامپت ایجنت اضافه می‌شود؛ فقط در همین ورکفلو">
        <Textarea className="min-h-24" value={node.data.instructions ?? ""} onChange={(e) => patchNode(node.id, { instructions: e.target.value || undefined })} />
      </Field>
      {node.data.agent?.type === "gemini" ? (
        <>
          <Field label="ذخیره‌ی خروجی متنی به‌عنوان فایل" hint={workflow.stage === "prework" ? "در پوشه‌ی prework در GitHub و قابل دانلود در گفت‌وگو" : "در پوشه‌ی final کنار خروجی‌های Claude"}>
            <Input dir="ltr" value={node.data.saveAs ?? ""} placeholder="BRIEF.md" onChange={(e) => patchNode(node.id, { saveAs: e.target.value || undefined })} />
          </Field>
          {node.data.saveAs ? (
            <Switch checked={!!node.data.appendInputs} onChange={(v) => patchNode(node.id, { appendInputs: v || undefined })} label="ورودی‌های این مرحله هم به انتهای فایل پیوست شود" />
          ) : null}
        </>
      ) : null}
      {node.data.agent?.type !== "router" ? (
        <Switch checked={!!node.data.reply} onChange={(v) => patchNode(node.id, { reply: v || undefined })} label="خروجی این مرحله پاسخ چت باشد" />
      ) : null}
      {workflow.stage === "prework" && node.data.agent?.type === "gemini" ? (
        <Switch checked={!!node.data.brief} onChange={(v) => patchNode(node.id, { brief: v || undefined })} label="دستور کار اصلی برای Claude (اول خوانده می‌شود)" />
      ) : null}
    </div>
  ) : edge ? (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-extrabold">اتصال</p>
        <Button size="sm" variant="ghost" className="text-danger" onClick={removeSelected}>
          <Trash2 className="size-4" /> حذف
        </Button>
      </div>
      <p className="text-sm">
        از «{label(edge.source)}» به «{label(edge.target)}»
      </p>
      {nodes.find((n) => n.id === edge.source)?.data.agent?.type === "router" ? (
        <Field label="این مسیر وقتی دنبال می‌شود که شرط">
          <Select
            value={edge.data?.when ?? "yes"}
            onChange={(e) => {
              const when = e.target.value as Branch;
              setEdges((es) => es.map((x) => (x.id === edge.id ? { ...x, sourceHandle: when, data: { when }, ...edgeLook(when) } : x)));
              touch();
            }}
          >
            <option value="yes">بله بدهد</option>
            <option value="no">خیر بدهد</option>
          </Select>
        </Field>
      ) : (
        <p className="text-xs text-muted">خروجی مرحله‌ی اول ورودی مرحله‌ی دوم است. مرحله‌هایی که ورودی مشترک دارند هم‌زمان اجرا می‌شوند.</p>
      )}
    </div>
  ) : (
    <div className="space-y-3">
      <Field label="نام ورکفلو">
        <Input
          value={meta.name}
          onChange={(e) => {
            setMeta({ ...meta, name: e.target.value });
            touch();
          }}
        />
      </Field>
      <Field label="توضیح">
        <Textarea
          className="min-h-16"
          value={meta.description}
          onChange={(e) => {
            setMeta({ ...meta, description: e.target.value });
            touch();
          }}
        />
      </Field>
      <Switch
        checked={meta.isDefault}
        onChange={(v) => {
          setMeta({ ...meta, isDefault: v });
          touch();
        }}
        label={`ورکفلوی پیش‌فرض ${STAGE_LABEL[workflow.stage]}`}
      />
      <p className="text-xs leading-6 text-muted">
        روی یک مرحله بزنید تا تنظیماتش را ببینید. برای وصل کردن، از نقطه‌ی سمت چپ یک مرحله به نقطه‌ی سمت راست مرحله‌ی بعد بکشید. مرحله‌هایی که به یک ورودی وصل‌اند هم‌زمان اجرا می‌شوند.
      </p>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={workflow.stage === "prework" ? "violet" : "orange"}>{STAGE_LABEL[workflow.stage]}</Badge>
          {meta.isDefault ? (
            <Badge tone="warning">
              <Star className="size-3" /> پیش‌فرض
            </Badge>
          ) : null}
          {dirty ? <span className="text-xs font-semibold text-warning">تغییرات ذخیره نشده</span> : null}
          <div className="ms-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={autoLayout}>
              <LayoutGrid className="size-4" /> چیدمان خودکار
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onDuplicate(current())}>
              <Copy className="size-4" /> کپی
            </Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => onDelete(current())}>
              <Trash2 className="size-4" /> حذف
            </Button>
            <Button size="sm" loading={busy} disabled={!!problems.length} onClick={() => void save()}>
              <Save className="size-4" /> ذخیره
            </Button>
          </div>
        </div>
        <div dir="ltr" className="wf-builder h-[58vh] min-h-[420px] overflow-hidden rounded-3xl border border-line bg-surface">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(ch) => {
              onNodesChange(ch);
              if (ch.some((c) => c.type === "position" || c.type === "remove")) touch();
            }}
            onEdgesChange={(ch) => {
              onEdgesChange(ch);
              if (ch.some((c) => c.type === "remove")) touch();
            }}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected({ kind: "node", id: n.id })}
            onEdgeClick={(_, e) => setSelected({ kind: "edge", id: e.id })}
            onPaneClick={() => setSelected(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
            fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
            minZoom={0.3}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} size={1.2} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {problems.length ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-6">
            <p className="flex items-center gap-1.5 font-bold text-warning">
              <AlertTriangle className="size-4" /> برای ذخیره این موارد را اصلاح کنید:
            </p>
            <ul className="mt-1 list-disc ps-5">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border border-line bg-surface p-4">{panel}</div>
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="mb-1 text-sm font-extrabold">افزودن ایجنت</p>
          <p className="mb-3 text-xs text-muted">{node ? "بعد از مرحله‌ی انتخاب‌شده اضافه و به آن وصل می‌شود." : "یک مرحله را انتخاب کنید تا ایجنت جدید بعد از آن وصل شود."}</p>
          <div className="max-h-[42vh] space-y-1.5 overflow-y-auto">
            {palette.map((a) => {
              const Icon = ICON[a.type];
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => addAgent(a)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-start transition hover:border-primary hover:bg-primary-soft"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg text-white" style={{ background: a.color ?? AGENT_TYPE_META[a.type].color }}>
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{a.name}</span>
                    <span className="block truncate text-[11px] text-muted">{AGENT_TYPE_META[a.type].label}</span>
                  </span>
                  <Plus className="size-4 text-muted" />
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-dashed border-line p-3 text-[11px] leading-6 text-muted">
          <p className="flex items-center gap-1.5 font-bold text-fg">
            <ScrollText className="size-3.5" /> هر مرحله چه می‌گیرد؟
          </p>
          درخواست و شرح تسک، دستور مدیر، خروجی مرحله‌های وصل‌شده به آن، و در صورت فعال بودن در ایجنت: فایل‌های پیوست و دانش مرتبط.
          <p className="mt-1 flex items-center gap-1.5">
            <FileText className="size-3.5" /> <MessageSquareText className="size-3.5" /> خروجی‌ها با «ذخیره به‌عنوان فایل» و «پاسخ چت» در گفت‌وگوی تسک نمایش داده می‌شوند.
          </p>
          <p className="mt-1">{faNum(nodes.length)} مرحله · {faNum(edges.length)} اتصال</p>
        </div>
      </div>
    </div>
  );
}

/** Visual editor for one workflow (React Flow canvas + step settings + agent palette). */
export function WorkflowEditor(props: EditorProps) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}
