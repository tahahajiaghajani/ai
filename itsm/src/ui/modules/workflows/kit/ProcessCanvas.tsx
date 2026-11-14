// The process canvas (design F §8.4, §8.6, package F5k) on @xyflow/react, laid out with dagre top to bottom: its own
// node renderers (icon, title, a summary line, validation badges, a case's step status as an icon and a word), port
// labels on the edges that leave a decision, «بازگشت برای اصلاح» drawn dashed, the path a case took, zoom, fit and
// auto-layout. Editable in the designer (F6), read-only on a process's and a case's diagram (F7).
// Keyboard (the whole canvas works without a mouse): Tab enters at one node (a roving tab stop); the arrow keys move
// to the nearest node in their direction; Enter or Space opens a node (`onSelect`); Home and End go to the first and
// the last step. Editable: Delete removes the node, Shift + an arrow moves it, Tab reaches the node's outputs — Enter
// on an output starts connecting, the arrows then move between the steps it may go to, Enter connects and Escape
// cancels; Delete on an output removes its connection. What happens is announced in a live region.
// React Flow's coordinates stay left-to-right (`dir="ltr"` on the canvas); every card reads right-to-left.
import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  Background, BackgroundVariant, ControlButton, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Network } from "lucide-react";
import type { FlowProblem } from "@shared/flows";
import { PROCESS_NODE_TYPES, isBackEdge, isProcessNodeType, processPorts, type NodeStatusView, type ProcessGraph, type ProcessNode, type ProcessNodeType, type ProcessPort } from "@shared/process";
import { faDigits } from "@shared/format";
import { useTheme } from "../../../lib/theme";
import { cx } from "../../../components/blocks";
import {
  ARROWS, NODE_H, NODE_W, STEP_STATUS, connect, connectProblem, connectTargets, disconnect, isPlaced, layoutProcess, neighbour, nodeSummary, nodeTitle,
  problemsByNode, readingOrder, removeSteps, statusLine, updateStep,
} from "./model";
import { ProcessNodeIcon, StepStatusIcon } from "./icons";
import "./kit.css";

/** The drag-and-drop type a palette item carries (`dataTransfer.setData(PROCESS_NODE_MIME, type)`). */
export const PROCESS_NODE_MIME = "application/x-process-node";

const ARIA = {
  "node.a11yDescription.default": "برای برگزیدن مرحله Enter یا فاصله را بزنید.",
  "node.a11yDescription.keyboardDisabled": "برای برگزیدن مرحله Enter یا فاصله را بزنید.",
  "node.a11yDescription.ariaLiveMessage": ({ direction }: { direction: string; x: number; y: number }) => `مرحله جابه‌جا شد (${direction})`,
  "edge.a11yDescription.default": "برای برگزیدن اتصال Enter یا فاصله را بزنید؛ Delete آن را برمی‌دارد.",
  "controls.ariaLabel": "بزرگ‌نمایی و چیدمان",
  "controls.zoomIn.ariaLabel": "بزرگ‌نمایی",
  "controls.zoomOut.ariaLabel": "کوچک‌نمایی",
  "controls.fitView.ariaLabel": "نمایش همهٔ نمودار",
  "controls.interactive.ariaLabel": "قفل ویرایش",
  "minimap.ariaLabel": "نمای کلی نمودار",
  "handle.ariaLabel": "نقطهٔ اتصال",
};

interface Linking {
  source: string;
  port: string;
  label: string;
  targets: Set<string>;
}

interface CardData extends Record<string, unknown> {
  node: ProcessNode;
  title: string;
  summary: string;
  note: string | null;
  ports: ProcessPort[];
  /** port → the titles of the steps its edges go to */
  wired: Record<string, string[]>;
  errors: number;
  warnings: number;
  problem: string;
  status: NodeStatusView | null;
  current: boolean;
  editable: boolean;
  /** connect mode: a step the output may go to / the output's own step / neither */
  target: boolean;
  linkSource: boolean;
  linking: boolean;
}

/** What a node asks of the canvas (a context: callbacks never travel in node data). */
interface CanvasApi {
  keyDown: (id: string, e: KeyboardEvent<HTMLElement>) => void;
  focused: (id: string) => void;
  open: (id: string) => void;
  startLink: (id: string, port: string) => void;
  dropLink: (id: string, port: string) => void;
}
const Api = createContext<CanvasApi | null>(null);

const typeLabel = (t: string) => (isProcessNodeType(t) ? PROCESS_NODE_TYPES[t].label : t);

const Card = memo(function Card({ data, selected }: NodeProps<Node<CardData, "step">>) {
  const api = useContext(Api)!;
  const { node, ports, status } = data;
  const meta = status ? STEP_STATUS[status.status] : null;
  const spread = (i: number) => `${((i + 1) / (ports.length + 1)) * 100}%`;
  const line = status ? statusLine(status, node.type) : data.note;
  const label = [
    `${typeLabel(node.type)}: ${data.title}`,
    data.summary,
    status ? statusLine(status, node.type) : data.note,
    data.errors ? `${faDigits(data.errors)} ایراد: ${data.problem}` : data.warnings ? `${faDigits(data.warnings)} هشدار: ${data.problem}` : "",
    data.linking ? (data.target ? "مقصد ممکن" : data.linkSource ? "مبدأ اتصال" : "مقصد ممکن نیست") : "",
  ]
    .filter(Boolean)
    .join("، ");
  return (
    <div
      className={cx(
        "wfk-node",
        node.type === "trigger" && "is-trigger",
        node.type === "end" && "is-end",
        selected && "is-sel",
        data.errors > 0 && "has-error",
        meta && `is-${meta.tone}`,
        data.linking && (data.target ? "is-target" : data.linkSource ? "is-source" : "is-dim"),
      )}
      dir="rtl"
    >
      {node.type !== "trigger" ? <Handle type="target" position={Position.Top} isConnectable={data.editable} /> : null}
      <button
        type="button"
        className="wfk-node-main"
        data-wfk-node={node.id}
        tabIndex={data.current ? 0 : -1}
        aria-label={label}
        aria-pressed={selected}
        title={data.problem || undefined}
        onClick={() => api.open(node.id)}
        onFocus={() => api.focused(node.id)}
        onKeyDown={(e) => api.keyDown(node.id, e)}
      >
        <span className="wfk-node-h">
          <span className="wfk-node-ic">
            <ProcessNodeIcon type={node.type} />
          </span>
          <span className="wfk-node-t">{data.title}</span>
          {data.errors ? (
            <span className="wfk-badge" aria-hidden>
              {faDigits(data.errors)}
            </span>
          ) : data.warnings ? (
            <span className="wfk-badge is-warning" aria-hidden>
              {faDigits(data.warnings)}
            </span>
          ) : null}
        </span>
        <span className="wfk-node-s">{data.summary}</span>
        {line ? (
          <span className={cx("wfk-node-st", meta && `is-${meta.tone}`)}>
            {status ? <StepStatusIcon status={status.status} size={13} /> : null}
            <span>{line}</span>
          </span>
        ) : null}
      </button>
      {data.editable && ports.length ? (
        <div className="wfk-ports nodrag" role="group" aria-label={`خروجی‌های «${data.title}»`}>
          {ports.map((p) => {
            const to = data.wired[p.key] ?? [];
            return (
              <button
                key={p.key}
                type="button"
                className={cx("wfk-port", to.length ? "is-wired" : p.optional ? "is-optional" : "is-open", p.back && "is-back")}
                tabIndex={data.current ? 0 : -1}
                aria-label={`خروجی «${p.label}»${to.length ? ` به ${to.map((t) => `«${t}»`).join("، ")}` : "، وصل نشده"}؛ Enter برای وصل کردن${to.length ? "، Delete برای برداشتن" : ""}`}
                onClick={() => api.startLink(node.id, p.key)}
                onKeyDown={(e) => {
                  if (e.key === "Delete" || e.key === "Backspace") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (to.length) api.dropLink(node.id, p.key);
                  } else if (e.key === "Escape") {
                    e.stopPropagation();
                    (e.currentTarget.closest(".wfk-node")?.querySelector(".wfk-node-main") as HTMLElement | null)?.focus();
                  }
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {ports.map((p, i) => (
        <Handle key={p.key} id={p.key} type="source" position={Position.Bottom} isConnectable={data.editable} className={cx(p.back && "is-back")} style={{ left: spread(i) }} />
      ))}
    </div>
  );
});

const nodeTypes = { step: Card };

export interface ProcessCanvasProps {
  graph: ProcessGraph;
  /** a diagram (no editing): a process's map, a case's progress */
  readOnly?: boolean;
  /** the validator's problems (`validateProcess`): badges on the nodes */
  problems?: FlowProblem[];
  /** a case's statuses (`stepStatuses`): icon and word on every node */
  statuses?: Record<string, NodeStatusView> | null;
  /** edges the case went along (`takenEdges`): drawn strong, the others quiet */
  taken?: Set<string> | null;
  /** a line under a node instead of its status (the preview's people: «علی احمدی — رئیس شعبه») */
  notes?: Record<string, string>;
  selected?: string | null;
  /** a node opened by click, Enter or Space; null: the pane was clicked or Escape pressed */
  onSelect?: (id: string | null) => void;
  /** the graph after an edit (editable only) */
  onGraph?: (g: ProcessGraph) => void;
  /** a palette item dropped on the canvas (PROCESS_NODE_MIME) */
  onDropType?: (type: ProcessNodeType, position: { x: number; y: number }) => void;
  /** a connection refused, with the reason (it is also announced) */
  onProblem?: (message: string) => void;
  /** changes → fit the view again */
  fitKey?: string | number;
  /** the canvas's accessible name */
  label?: string;
  className?: string;
}

function Inner(p: ProcessCanvasProps & { announce: (text: string) => void; wrap: React.RefObject<HTMLDivElement | null>; linking: Linking | null; setLinking: (l: Linking | null) => void }) {
  const rf = useReactFlow();
  const { dark } = useTheme();
  const editable = !p.readOnly && !!p.onGraph;
  // a graph saved without positions is laid out before it is drawn
  const graph = useMemo(() => (isPlaced(p.graph) ? p.graph : layoutProcess(p.graph)), [p.graph]);
  const order = useMemo(() => readingOrder(graph), [graph]);
  const [current, setCurrent] = useState<string | null>(null);
  const cur = current && graph.nodes.some((n) => n.id === current) ? current : (p.selected ?? order[0] ?? null);
  const [selEdges, setSelEdges] = useState<Set<string>>(new Set());
  const pendingFocus = useRef<string | null>(null);
  const problems = useMemo(() => problemsByNode(p.problems), [p.problems]);
  const titles = useMemo(() => new Map(graph.nodes.map((n) => [n.id, nodeTitle(n)])), [graph.nodes]);
  const { linking, setLinking, announce } = p;

  const nodes = useMemo<Node<CardData, "step">[]>(
    () =>
      graph.nodes.map((n) => {
        const ports = processPorts(n);
        const wired: Record<string, string[]> = {};
        for (const e of graph.edges) if (e.source === n.id) (wired[e.port ?? "out"] ??= []).push(titles.get(e.target) ?? e.target);
        const pr = problems.get(n.id);
        return {
          id: n.id,
          type: "step",
          position: n.position ?? { x: 0, y: 0 },
          width: NODE_W,
          height: NODE_H,
          selected: p.selected === n.id,
          deletable: editable && n.type !== "trigger",
          draggable: editable,
          data: {
            node: n,
            title: titles.get(n.id) ?? n.id,
            summary: nodeSummary(n),
            note: p.notes?.[n.id] ?? null,
            ports,
            wired,
            errors: pr?.errors ?? 0,
            warnings: pr?.warnings ?? 0,
            problem: pr?.first ?? "",
            status: p.statuses?.[n.id] ?? null,
            current: cur === n.id,
            editable,
            target: !!linking?.targets.has(n.id),
            linkSource: linking?.source === n.id,
            linking: !!linking,
          },
        };
      }),
    [graph, titles, problems, p.selected, p.notes, p.statuses, cur, editable, linking],
  );

  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => {
        const src = graph.nodes.find((n) => n.id === e.source);
        const ports = src ? processPorts(src) : [];
        const port = ports.find((x) => x.key === (e.port ?? "out"));
        const back = isBackEdge(graph, e);
        const shown = !!p.taken;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.port ?? "out",
          type: "smoothstep",
          // a decision's ways are labelled; a step's only way on («بعدی») is not
          label: port && (port.key !== "out" || ports.filter((x) => !x.optional).length > 1) ? port.label : undefined,
          className: cx(back && "is-back", shown && (p.taken!.has(e.id) ? "is-taken" : "is-quiet")),
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          selected: selEdges.has(e.id),
          deletable: editable,
          focusable: false,
        };
      }),
    [graph, p.taken, selEdges, editable],
  );

  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: 0.15, maxZoom: 1.05, duration: 200 }), 30);
    return () => clearTimeout(t);
  }, [p.fitKey, rf]);

  // focus follows the keyboard: after a move, the new node's card takes the focus and comes into view
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = p.wrap.current?.querySelector<HTMLElement>(`[data-wfk-node="${CSS.escape(id)}"]`);
    el?.focus({ preventScroll: true });
    const n = graph.nodes.find((x) => x.id === id);
    const box = p.wrap.current?.getBoundingClientRect();
    if (!n?.position || !box) return;
    const { x, y, zoom } = rf.getViewport();
    const left = n.position.x * zoom + x;
    const top = n.position.y * zoom + y;
    if (left < 0 || top < 0 || left + NODE_W * zoom > box.width || top + NODE_H * zoom > box.height) void rf.setCenter(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, { zoom, duration: 150 });
  });

  const moveTo = useCallback((id: string | null) => {
    if (!id) return;
    pendingFocus.current = id;
    setCurrent(id);
  }, []);

  const finishLink = useCallback(
    (target: string) => {
      if (!linking || !p.onGraph) return;
      const base = disconnect(graph, linking.source, linking.port);
      const keep = processPorts(graph.nodes.find((n) => n.id === linking.source)!).find((x) => x.key === linking.port)?.multi ? graph : base;
      const problem = connectProblem(keep, linking.source, linking.port, target);
      if (problem) {
        announce(`وصل نشد: ${problem}`);
        p.onProblem?.(problem);
        return;
      }
      p.onGraph(connect(graph, linking.source, linking.port, target));
      announce(`«${titles.get(linking.source)}» (${linking.label}) به «${titles.get(target)}» وصل شد`);
      setLinking(null);
      moveTo(linking.source);
    },
    [linking, graph, p, titles, announce, setLinking, moveTo],
  );

  const remove = useCallback(
    (id: string) => {
      if (!editable || !p.onGraph) return;
      const n = graph.nodes.find((x) => x.id === id);
      if (!n || n.type === "trigger") return;
      const next = neighbour(graph.nodes, id, "up") ?? neighbour(graph.nodes, id, "down") ?? order.find((x) => x !== id) ?? null;
      p.onGraph(removeSteps(graph, [id]));
      announce(`«${titles.get(id)}» حذف شد`);
      if (p.selected === id) p.onSelect?.(null);
      moveTo(next);
    },
    [editable, graph, order, p, titles, announce, moveTo],
  );

  const api = useMemo<CanvasApi>(
    () => ({
      focused: (id) => setCurrent(id),
      open: (id) => {
        if (linking) {
          if (linking.targets.has(id)) finishLink(id);
          else if (id !== linking.source) announce("این مرحله مقصد ممکن این خروجی نیست");
          return;
        }
        p.onSelect?.(id);
      },
      startLink: (id, port) => {
        if (!editable) return;
        const n = graph.nodes.find((x) => x.id === id);
        const pp = n ? processPorts(n).find((x) => x.key === port) : undefined;
        if (!n || !pp) return;
        const targets = new Set(connectTargets(graph, id, port));
        if (!targets.size) {
          announce(`برای خروجی «${pp.label}» مقصد ممکنی نیست`);
          return;
        }
        setLinking({ source: id, port, label: pp.label, targets });
        announce(`وصل کردن خروجی «${pp.label}» از «${titles.get(id)}»: با کلیدهای جهت مقصد را برگزینید و Enter بزنید؛ Esc لغو می‌کند. ${faDigits(targets.size)} مقصد ممکن.`);
        // the nearest possible target below, else the first in reading order
        const first = neighbour(graph.nodes.filter((x) => x.id === id || targets.has(x.id)), id, "down") ?? order.find((x) => targets.has(x)) ?? null;
        moveTo(first);
      },
      dropLink: (id, port) => {
        if (!editable || !p.onGraph) return;
        const label = processPorts(graph.nodes.find((x) => x.id === id)!).find((x) => x.key === port)?.label ?? port;
        p.onGraph(disconnect(graph, id, port));
        announce(`اتصال خروجی «${label}» از «${titles.get(id)}» برداشته شد`);
      },
      keyDown: (id, e) => {
        const dir = ARROWS[e.key];
        if (dir && e.shiftKey && editable && p.onGraph && !linking) {
          e.preventDefault();
          e.stopPropagation();
          const n = graph.nodes.find((x) => x.id === id);
          const pos = n?.position ?? { x: 0, y: 0 };
          const step = 24;
          const next = { x: pos.x + (dir === "right" ? step : dir === "left" ? -step : 0), y: pos.y + (dir === "down" ? step : dir === "up" ? -step : 0) };
          p.onGraph(updateStep(graph, id, { position: next }));
          pendingFocus.current = id;
          return;
        }
        if (dir) {
          e.preventDefault();
          e.stopPropagation();
          // in connect mode the arrows visit the possible targets only
          const pool = linking ? graph.nodes.filter((x) => x.id === id || linking.targets.has(x.id)) : graph.nodes;
          const to = neighbour(pool, id, dir);
          if (to) moveTo(to);
          return;
        }
        switch (e.key) {
          case "Enter":
          case " ":
            e.preventDefault();
            e.stopPropagation();
            api.open(id);
            return;
          case "Home":
          case "End": {
            e.preventDefault();
            e.stopPropagation();
            const pool = linking ? order.filter((x) => linking.targets.has(x)) : order;
            moveTo(e.key === "Home" ? (pool[0] ?? null) : (pool[pool.length - 1] ?? null));
            return;
          }
          case "Escape":
            e.stopPropagation();
            if (linking) {
              const src = linking.source;
              setLinking(null);
              announce("وصل کردن لغو شد");
              moveTo(src);
            } else p.onSelect?.(null);
            return;
          case "Delete":
          case "Backspace":
            if (!editable || linking) return;
            e.preventDefault();
            e.stopPropagation();
            remove(id);
            return;
        }
      },
    }),
    // `api.open` refers to the object itself through the closure; it is rebuilt with its inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, order, linking, editable, p.onGraph, p.onSelect, titles, finishLink, remove, announce, setLinking, moveTo],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (!editable || !p.onGraph) return;
      let g = graph;
      const removed = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
      if (removed.length) g = removeSteps(g, removed);
      const moved = new Map<string, { x: number; y: number }>();
      for (const c of changes) if (c.type === "position" && c.position) moved.set(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) });
      if (moved.size) g = { ...g, nodes: g.nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)) };
      if (g !== graph) p.onGraph(g);
      if (removed.includes(p.selected ?? "")) p.onSelect?.(null);
    },
    [editable, graph, p],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const sel = new Set(selEdges);
      let touched = false;
      for (const c of changes) {
        if (c.type !== "select") continue;
        touched = true;
        if (c.selected) sel.add(c.id);
        else sel.delete(c.id);
      }
      if (touched) setSelEdges(sel);
      if (!editable || !p.onGraph) return;
      const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id));
      if (removed.size) p.onGraph({ ...graph, edges: graph.edges.filter((e) => !removed.has(e.id)) });
    },
    [editable, graph, p, selEdges],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (!editable || !p.onGraph || !c.source || !c.target) return;
      const port = c.sourceHandle ?? "out";
      const n = graph.nodes.find((x) => x.id === c.source);
      const multi = n ? processPorts(n).find((x) => x.key === port)?.multi : false;
      const problem = connectProblem(multi ? graph : disconnect(graph, c.source, port), c.source, port, c.target);
      if (problem) {
        announce(`وصل نشد: ${problem}`);
        p.onProblem?.(problem);
      } else p.onGraph(connect(graph, c.source, port, c.target));
    },
    [editable, graph, p, announce],
  );
  const isValid = useCallback(
    (c: Connection | Edge) => {
      if (!c.source || !c.target) return false;
      const port = c.sourceHandle ?? "out";
      const n = graph.nodes.find((x) => x.id === c.source);
      const multi = n ? processPorts(n).find((x) => x.key === port)?.multi : false;
      return !connectProblem(multi ? graph : disconnect(graph, c.source, port), c.source, port, c.target);
    },
    [graph],
  );
  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = e.dataTransfer.getData(PROCESS_NODE_MIME);
      if (!editable || !type || !isProcessNodeType(type) || type === "trigger") return;
      e.preventDefault();
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      p.onDropType?.(type, { x: Math.round(pos.x - NODE_W / 2), y: Math.round(pos.y - NODE_H / 2) });
    },
    [editable, p, rf],
  );

  return (
    <Api.Provider value={api}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValid}
        onPaneClick={() => {
          if (linking) {
            setLinking(null);
            announce("وصل کردن لغو شد");
          }
          p.onSelect?.(null);
        }}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={onDrop}
        nodesDraggable={editable}
        nodesConnectable={editable}
        nodesFocusable={false}
        edgesFocusable={false}
        disableKeyboardA11y
        elementsSelectable
        deleteKeyCode={editable ? ["Delete", "Backspace"] : null}
        colorMode={dark ? "dark" : "light"}
        minZoom={0.2}
        maxZoom={1.6}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.05 }}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={ARIA}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
        <Controls position="bottom-left" showInteractive={false}>
          {editable ? (
            <ControlButton
              onClick={() => {
                p.onGraph!(layoutProcess(graph));
                setTimeout(() => void rf.fitView({ padding: 0.15, maxZoom: 1.05, duration: 200 }), 30);
                announce("نمودار دوباره چیده شد");
              }}
              aria-label="چیدمان خودکار"
              title="چیدمان خودکار"
            >
              <Network size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden />
            </ControlButton>
          ) : null}
        </Controls>
        <MiniMap position="bottom-right" pannable zoomable className="wfk-minimap" style={{ width: 140, height: 92 }} />
      </ReactFlow>
    </Api.Provider>
  );
}

/** The canvas of a process: editable with `onGraph`, a read-only diagram with `readOnly`. */
export function ProcessCanvas(props: ProcessCanvasProps) {
  const help = useId();
  const wrap = useRef<HTMLDivElement | null>(null);
  const [said, setSaid] = useState("");
  const [linking, setLinking] = useState<Linking | null>(null);
  const editable = !props.readOnly && !!props.onGraph;
  const announce = useCallback((text: string) => setSaid(text), []);
  return (
    <section ref={wrap} className={cx("wfk-canvas", linking && "is-linking", props.className)} dir="ltr" aria-label={props.label ?? "نمودار گردش‌کار"} aria-describedby={help}>
      <p id={help} className="sr-only" dir="rtl">
        {editable
          ? "با کلیدهای جهت میان مرحله‌ها بروید؛ Enter مرحله را باز می‌کند، Delete آن را حذف می‌کند و Shift با کلیدهای جهت آن را جابه‌جا می‌کند. با Tab به خروجی‌های مرحله برسید و با Enter آن‌ها را به مرحلهٔ دیگری وصل کنید."
          : "با کلیدهای جهت میان مرحله‌ها بروید؛ Enter مرحله را باز می‌کند."}
      </p>
      {linking ? (
        <div className="wfk-linking" dir="rtl">
          <span>
            مقصد خروجی «{linking.label}» را برگزینید؛ Enter وصل می‌کند و Esc لغو.
          </span>
          <button
            type="button"
            className="wfk-linking-x"
            onClick={() => {
              setLinking(null);
              announce("وصل کردن لغو شد");
            }}
          >
            لغو
          </button>
        </div>
      ) : null}
      <ReactFlowProvider>
        <Inner {...props} announce={announce} wrap={wrap} linking={linking} setLinking={setLinking} />
      </ReactFlowProvider>
      <div className="sr-only" aria-live="polite" dir="rtl">
        {said}
      </div>
    </section>
  );
}
