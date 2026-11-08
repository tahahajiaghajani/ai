// The dependency and service map (catalogue CMDB-010/012/076, SPF-009): CIs as cards on a layered layout — what depends
// on something sits above it, services on top and hardware below when a relationship has no side — with the
// relationship type on every edge (dashed when it does not carry impact, faint when it ended before the map's date),
// the class family's colour on the card's edge, health and open work as badges, and, on impact maps, the severity a
// failure reaches each CI with. CIs the person may not read stay as locked placeholders that keep the path visible.
// React Flow's coordinates run left to right; cards read right to left. Used by the map page, the impact page, the
// CI's and the service's «نقشه» tabs.
import { memo, useEffect, useMemo } from "react";
import {
  Background, BackgroundVariant, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AppWindow, Bot, Boxes, Building2, Cloud, ConciergeBell, FileLock, Lock, Server, AlertTriangle, Wrench, GitPullRequestArrow, SearchCheck } from "lucide-react";
import type { MapNode, MapResult } from "@shared/cmdb/api";
import type { ClassFamily } from "@shared/cmdb/classes";
import { faDigits } from "@shared/format";
import { cx } from "../../components/blocks";
import { familyColor, layoutMap, orientEdge, severityStyle, type MapDirection } from "./model";
import "./cmdb.css";

const FAMILY_ICON: Record<ClassFamily, typeof Server> = {
  service: ConciergeBell, information: FileLock, ai: Bot, logical: Boxes, software: AppWindow, cloud: Cloud, hardware: Server, facility: Building2,
};

export const familyIcon = (f: ClassFamily | undefined | null) => FAMILY_ICON[f ?? "logical"] ?? Boxes;

interface CardData extends Record<string, unknown> {
  n: MapNode;
  direction: MapDirection;
  severities: boolean;
  dim: boolean;
  onPath: boolean;
}

const CiCard = memo(function CiCard({ data, selected }: NodeProps<Node<CardData, "ci">>) {
  const { n, direction } = data;
  const tb = direction === "TB";
  const handles = (
    <>
      <Handle type="target" position={tb ? Position.Top : Position.Right} isConnectable={false} className="cm-handle" />
      <Handle type="source" position={tb ? Position.Bottom : Position.Left} isConnectable={false} className="cm-handle" />
    </>
  );
  if (n.restricted) {
    return (
      <div className={cx("cm-node is-ghost", selected && "is-sel")} dir="rtl" title="پیکربندی‌ای که اجازهٔ دیدنش را ندارید">
        {handles}
        <Lock size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
        <span>محدود</span>
      </div>
    );
  }
  const Icon = familyIcon(n.family);
  const sev = data.severities && n.severity !== undefined ? severityStyle(n.severity, n.absorbed) : null;
  const ov = n.overlay ?? {};
  const down = n.operational_status === "non_operational" || n.operational_status === "repair";
  return (
    <div
      className={cx("cm-node", selected && "is-sel", n.root && "is-root", data.dim && "is-dim", data.onPath && "is-path", down && "is-down")}
      dir="rtl"
      style={{ ["--cm-fam" as string]: familyColor(n.family), ...(sev ? { ["--cm-sev" as string]: sev.color } : {}) }}
      data-sev={sev ? sev.tone : undefined}
    >
      {handles}
      <span className="cm-node-icon" aria-hidden>
        <Icon size={16} strokeWidth={1.4} absoluteStrokeWidth />
      </span>
      <span className="cm-node-body">
        <span className="cm-node-name" title={n.name}>{n.name}</span>
        <span className="cm-node-meta">
          <span className="truncate">{n.class_label}</span>
          {n.number ? <span className="ds-ltr ds-num cm-node-no">{faDigits(n.number)}</span> : null}
        </span>
      </span>
      <span className="cm-node-badges">
        {sev && sev.label ? <span className="cm-badge is-sev" title={sev.label}>{faDigits(Math.round((n.severity ?? 0) * 100))}٪</span> : null}
        {down ? <span className="cm-badge is-bad" title={n.state_label ?? "از کار افتاده"}><AlertTriangle size={11} strokeWidth={1.6} absoluteStrokeWidth aria-hidden /></span> : null}
        {ov.incidents ? <span className="cm-badge is-bad" title={`${faDigits(ov.incidents)} رخداد باز`}>{faDigits(ov.incidents)}</span> : null}
        {ov.changes ? <span className="cm-badge" title={`${faDigits(ov.changes)} تغییر باز`}><GitPullRequestArrow size={11} strokeWidth={1.6} absoluteStrokeWidth aria-hidden />{faDigits(ov.changes)}</span> : null}
        {ov.problems ? <span className="cm-badge" title={`${faDigits(ov.problems)} مشکل باز`}><Wrench size={11} strokeWidth={1.6} absoluteStrokeWidth aria-hidden />{faDigits(ov.problems)}</span> : null}
        {ov.findings ? <span className="cm-badge is-warn" title={`${faDigits(ov.findings)} یافتهٔ کیفیت داده`}><SearchCheck size={11} strokeWidth={1.6} absoluteStrokeWidth aria-hidden />{faDigits(ov.findings)}</span> : null}
        {n.more ? <span className="cm-badge is-more" title={`${faDigits(n.more)} همسایهٔ دیگر روی نقشه نیامده`}>+{faDigits(n.more)}</span> : null}
      </span>
    </div>
  );
});

const NODE_TYPES = { ci: CiCard };

export interface ServiceMapProps {
  map: MapResult;
  direction?: MapDirection;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** double click / Enter on a selected card: grow the map around it */
  onExpand?: (id: string) => void;
  /** colour cards by impact severity (impact maps) */
  severities?: boolean;
  /** ids on a highlighted path (the others are dimmed) */
  path?: Set<string> | null;
  className?: string;
  height?: number | string;
  minimap?: boolean;
}

function Inner({ map, direction = "TB", selected, onSelect, onExpand, severities = false, path, minimap = true }: ServiceMapProps) {
  const flow = useReactFlow();
  const positions = useMemo(() => layoutMap(map, direction), [map, direction]);
  const nodes = useMemo<Node<CardData>[]>(
    () =>
      map.nodes.map((n) => {
        const p = positions.get(n.id) ?? { x: 0, y: 0 };
        return {
          id: n.id, type: "ci", position: { x: p.x, y: p.y }, selected: n.id === selected, draggable: true, connectable: false,
          ariaLabel: n.restricted ? "پیکربندی محدود" : `${n.name}، ${n.class_label ?? ""}`,
          data: { n, direction, severities, dim: !!path && path.size > 0 && !path.has(n.id), onPath: !!path && path.has(n.id) },
        };
      }),
    [map, positions, selected, direction, severities, path],
  );
  const edges = useMemo<Edge[]>(() => {
    const byId = new Map(map.nodes.map((n) => [n.id, n]));
    return map.edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => {
        const info = map.types[e.type];
        const { from, to } = orientEdge(e, byId);
        const onPath = !!path && path.has(e.source) && path.has(e.target);
        return {
          id: e.id,
          source: from,
          target: to,
          label: e.label,
          className: cx("cm-edge", !e.propagates && "is-soft", e.ended && "is-ended", onPath && "is-path", !!path && path.size > 0 && !onPath && "is-dim"),
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
          style: info?.color && e.propagates ? { ["--cm-edge" as string]: `var(--ds-chart-${chartIndex(info.color)})` } : undefined,
          focusable: false,
        };
      });
  }, [map, path]);
  useEffect(() => {
    const t = setTimeout(() => flow.fitView({ padding: 0.18, duration: 0, maxZoom: 1.1 }), 30);
    return () => clearTimeout(t);
  }, [map, direction, flow]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, n) => onSelect?.(n.id)}
      onNodeDoubleClick={(_, n) => onExpand?.(n.id)}
      onPaneClick={() => onSelect?.(null)}
      onSelectionChange={({ nodes: sel }) => {
        if (sel.length === 1 && sel[0].id !== selected) onSelect?.(sel[0].id);
      }}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      minZoom={0.15}
      maxZoom={1.8}
      proOptions={{ hideAttribution: true }}
      fitView
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls position="bottom-left" showInteractive={false} aria-label="بزرگ‌نمایی" />
      {minimap && map.nodes.length > 12 ? <MiniMap position="bottom-right" pannable zoomable ariaLabel="نمای کلی" style={{ width: 150, height: 100 }} nodeColor={(n) => familyColor((n.data as CardData).n.family)} /> : null}
    </ReactFlow>
  );
}

/** Choice colours of relationship types → the chart series of the design system. */
function chartIndex(color: string): number {
  return ({ purple: 1, gold: 2, teal: 3, magenta: 4, indigo: 5, green: 6, orange: 7, blue: 8 } as Record<string, number>)[color] ?? 5;
}

export function ServiceMap(props: ServiceMapProps) {
  return (
    <div className={cx("cm-canvas", props.className)} dir="ltr" style={{ height: props.height ?? 560 }}>
      <ReactFlowProvider>
        <Inner {...props} />
      </ReactFlowProvider>
    </div>
  );
}

export default ServiceMap;
