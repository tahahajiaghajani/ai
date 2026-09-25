"use client";
import * as React from "react";
import { ReactFlow, Controls, MarkerType, type Edge, type Node, ReactFlowProvider } from "@xyflow/react";
import type { Manifest } from "@/lib/github/workspace";

const COLUMNS = ["request", "input", "prompt", "context", "brief", "helper", "research", "wbs", "methods", "execution", "execution-log", "report", "knowledge", "final", "data-map", "explanation", "changelog"];
const COLORS: Record<string, string> = {
  request: "#f59e0b",
  input: "#f59e0b",
  prompt: "#64748b",
  context: "#0ea5e9",
  brief: "#8b5cf6",
  helper: "#a855f7",
  research: "#8b5cf6",
  wbs: "#8b5cf6",
  methods: "#8b5cf6",
  execution: "#a855f7",
  "execution-log": "#a855f7",
  report: "#6366f1",
  final: "#f97316",
  "data-map": "#f97316",
  explanation: "#f97316",
  changelog: "#f97316",
};

/** Data-map graph of a task folder, built from manifest.json (roles + depends_on). */
export function FileGraph({ manifest, height = 560 }: { manifest: Manifest; height?: number }) {
  const { nodes, edges } = React.useMemo(() => {
    const cols = new Map<string, number>();
    const nodes: Node[] = [];
    const files = manifest.files.slice(0, 220);
    for (const f of files) {
      const col = Math.max(0, COLUMNS.indexOf(f.role));
      const row = cols.get(String(col)) ?? 0;
      cols.set(String(col), row + 1);
      const name = f.path.split("/").slice(-2).join("/");
      nodes.push({
        id: f.path,
        position: { x: -(col * 250), y: row * 74 + (f.iteration - 1) * 12 },
        data: { label: name },
        style: {
          width: 220,
          fontSize: 11,
          direction: "ltr",
          borderRadius: 12,
          border: `1.5px solid ${COLORS[f.role] ?? "#94a3b8"}`,
          background: "var(--surface-strong)",
          color: "var(--text)",
          padding: 8,
        },
      });
    }
    const ids = new Set(nodes.map((n) => n.id));
    const edges: Edge[] = [];
    for (const f of files) {
      for (const dep of f.depends_on ?? []) {
        if (ids.has(dep)) edges.push({ id: `${dep}->${f.path}`, source: dep, target: f.path, type: "smoothstep", markerEnd: { type: MarkerType.ArrowClosed }, style: { opacity: 0.6 } });
      }
    }
    return { nodes, edges };
  }, [manifest]);

  return (
    <div dir="ltr" className="w-full overflow-hidden rounded-2xl border border-line" style={{ height }}>
      <ReactFlowProvider>
        <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.15} proOptions={{ hideAttribution: true }} nodesConnectable={false}>
          <Controls showInteractive={false} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
