// The flow canvas (@xyflow/react): nodes as cards with their output ports, edges labelled by port, validation badges,
// a run's step statuses as an overlay, zoom and fit. Top-to-bottom or right-to-left (handles move with the direction);
// React Flow's coordinates stay left-to-right while every card reads right-to-left. Editable in the designer,
// read-only on a run's page.
import { memo, useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeDef, nodeLabel, type FlowGraph, type FlowNode, type FlowProblem, type NodeType, type StepStatus, type TriggerConfig } from "@shared/flows";
import { faDigits } from "@shared/format";
import { useTheme } from "../../lib/theme";
import { cx } from "../../components/blocks";
import { NODE_H, NODE_W, connect, connectProblem, nodeSummary, removeNodes, type Direction } from "./model";
import { NodeIcon } from "./icons";
import "./flows.css";

interface CardData extends Record<string, unknown> {
  node: FlowNode;
  title: string;
  summary: string;
  direction: Direction;
  errors: number;
  warnings: number;
  status: StepStatus | null;
  current: boolean;
}

const FlowCard = memo(function FlowCard({ data, selected }: NodeProps<Node<CardData, "flow">>) {
  const { node, direction } = data;
  const def = nodeDef(node.type);
  const ports = def?.ports ?? [];
  const tb = direction === "TB";
  const spread = (i: number) => `${((i + 1) / (ports.length + 1)) * 100}%`;
  return (
    <div
      className={cx("fl-node", node.type === "trigger" && "is-trigger", selected && "is-sel", data.errors > 0 && "has-error", data.status && `is-${data.status}`, data.current && "is-current")}
      dir="rtl"
      title={data.title}
    >
      {node.type !== "trigger" ? <Handle type="target" position={tb ? Position.Top : Position.Right} /> : null}
      <div className="fl-node-h">
        <span className="fl-node-ic">
          <NodeIcon type={node.type} />
        </span>
        <span className="fl-node-t">{data.title}</span>
        {data.errors ? <span className="fl-badge" aria-label="ایراد">{faDigits(data.errors)}</span> : data.warnings ? <span className="fl-badge is-warning" aria-label="هشدار">{faDigits(data.warnings)}</span> : null}
      </div>
      <div className="fl-node-s">{data.summary || def?.hint}</div>
      {ports.map((p, i) => (
        <Handle
          key={p.key}
          id={p.key}
          type="source"
          position={tb ? Position.Bottom : Position.Left}
          className={cx(p.error && "is-error")}
          style={tb ? { left: spread(i) } : { top: spread(i) }}
        >
          {ports.length > 1 ? <span className={cx("fl-port", tb ? "is-tb" : "is-rl")}>{p.label}</span> : null}
        </Handle>
      ))}
    </div>
  );
});

const nodeTypes = { flow: FlowCard };

export interface FlowCanvasProps {
  graph: FlowGraph;
  direction: Direction;
  problems?: FlowProblem[];
  /** last status per node of a run */
  statuses?: Record<string, StepStatus>;
  current?: string[];
  selected?: string | null;
  readOnly?: boolean;
  trigger?: Partial<TriggerConfig> | null;
  triggerTitle?: string;
  tableLabel: (key: string) => string;
  onGraph?: (g: FlowGraph) => void;
  onSelect?: (id: string | null) => void;
  onDropType?: (type: NodeType, position: { x: number; y: number }) => void;
  onProblem?: (message: string) => void;
  /** changes → fit the view again (after an auto-layout) */
  fitKey?: string | number;
  className?: string;
}

function Inner(p: FlowCanvasProps) {
  const rf = useReactFlow();
  const { dark } = useTheme();
  const [selEdges, setSelEdges] = useState<Set<string>>(new Set());
  const counts = useMemo(() => {
    const m = new Map<string, { e: number; w: number }>();
    for (const x of p.problems ?? []) {
      if (!x.node) continue;
      const c = m.get(x.node) ?? { e: 0, w: 0 };
      if (x.level === "error") c.e++;
      else c.w++;
      m.set(x.node, c);
    }
    return m;
  }, [p.problems]);
  const nodes = useMemo<Node<CardData, "flow">[]>(
    () =>
      p.graph.nodes.map((n, i) => ({
        id: n.id,
        type: "flow",
        position: n.position ?? { x: 0, y: i * (NODE_H + 40) },
        width: NODE_W,
        height: NODE_H,
        selected: p.selected === n.id,
        deletable: !p.readOnly && n.type !== "trigger",
        data: {
          node: n,
          title: n.type === "trigger" ? p.triggerTitle || "شروع" : nodeLabel(n),
          summary: n.type === "trigger" ? "" : nodeSummary(n, p.tableLabel, p.trigger),
          direction: p.direction,
          errors: counts.get(n.id)?.e ?? 0,
          warnings: counts.get(n.id)?.w ?? 0,
          status: p.statuses?.[n.id] ?? null,
          current: !!p.current?.includes(n.id),
        },
      })),
    [p.graph.nodes, p.selected, p.readOnly, p.direction, p.statuses, p.current, p.tableLabel, p.trigger, p.triggerTitle, counts],
  );
  const edges = useMemo<Edge[]>(
    () =>
      p.graph.edges.map((e) => {
        const src = p.graph.nodes.find((n) => n.id === e.source);
        const port = nodeDef(src?.type ?? "")?.ports.find((x) => x.key === (e.port ?? "out"));
        const many = (nodeDef(src?.type ?? "")?.ports.length ?? 0) > 1;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.port ?? "out",
          type: "smoothstep",
          label: many && port ? port.label : undefined,
          className: port?.error ? "is-error" : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          selected: selEdges.has(e.id),
          deletable: !p.readOnly,
        };
      }),
    [p.graph.edges, p.graph.nodes, selEdges, p.readOnly],
  );

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.2, maxZoom: 1.1, duration: 200 }), 30);
    return () => clearTimeout(t);
  }, [p.fitKey, rf]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (p.readOnly || !p.onGraph) return;
      let g = p.graph;
      const removed = changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id);
      if (removed.length) g = removeNodes(g, removed);
      const moved = new Map<string, { x: number; y: number }>();
      for (const c of changes) if (c.type === "position" && c.position) moved.set(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) });
      if (moved.size) g = { ...g, nodes: g.nodes.map((n) => (moved.has(n.id) ? { ...n, position: moved.get(n.id)! } : n)) };
      if (g !== p.graph) p.onGraph(g);
      if (removed.includes(p.selected ?? "")) p.onSelect?.(null);
    },
    [p],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const sel = new Set(selEdges);
      let touched = false;
      for (const c of changes) {
        if (c.type === "select") {
          touched = true;
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
        }
      }
      if (touched) setSelEdges(sel);
      if (p.readOnly || !p.onGraph) return;
      const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => (c as { id: string }).id));
      if (removed.size) p.onGraph({ ...p.graph, edges: p.graph.edges.filter((e) => !removed.has(e.id)) });
    },
    [p, selEdges],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (p.readOnly || !p.onGraph || !c.source || !c.target) return;
      const port = c.sourceHandle ?? "out";
      const problem = connectProblem(p.graph, c.source, port, c.target);
      if (problem) p.onProblem?.(problem);
      else p.onGraph(connect(p.graph, c.source, port, c.target));
    },
    [p],
  );
  const isValid = useCallback((c: Connection | Edge) => !!c.source && !!c.target && !connectProblem(p.graph, c.source, c.sourceHandle ?? "out", c.target), [p.graph]);
  const onDrop = useCallback(
    (e: DragEvent) => {
      const type = e.dataTransfer.getData("application/x-flow-node") as NodeType;
      if (!type || p.readOnly) return;
      e.preventDefault();
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      p.onDropType?.(type, { x: Math.round(pos.x - NODE_W / 2), y: Math.round(pos.y - NODE_H / 2) });
    },
    [p, rf],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValid}
      onNodeClick={(_, n) => p.onSelect?.(n.id)}
      onPaneClick={() => p.onSelect?.(null)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={onDrop}
      nodesDraggable={!p.readOnly}
      nodesConnectable={!p.readOnly}
      elementsSelectable
      deleteKeyCode={p.readOnly ? null : ["Backspace", "Delete"]}
      colorMode={dark ? "dark" : "light"}
      minZoom={0.2}
      maxZoom={1.6}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} />
      <Controls position="bottom-left" showInteractive={false} aria-label="بزرگ‌نمایی" />
      <MiniMap position="bottom-right" pannable zoomable ariaLabel="نمای کلی" style={{ width: 150, height: 100 }} />
    </ReactFlow>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <div className={cx("fl-canvas", props.className)} dir="ltr">
      <ReactFlowProvider>
        <Inner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
