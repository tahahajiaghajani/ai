"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-2d";
import { ArrowUpLeft, ExternalLink, Focus, Maximize2, Minimize2, Network, RefreshCw, Search, Sparkles, Tags, X } from "lucide-react";
import { forceX, forceY } from "d3-force";
import { Button, Card, Input, Select, Spinner } from "@/components/ui/primitives";
import { buildGraphifyAction, loadGraphifyGraphsAction, type GraphifyLoad } from "@/app/actions/graph";
import { KIND_META, mergeGraphs, projectSubgraph, relationLabel, taskNodeId, type GraphData, type GraphKind, type GraphLink, type GraphNode } from "@/lib/graph/model";
import { STATUS_META } from "@/lib/status";
import { cn, faNum, truncate } from "@/lib/utils";
import type { TaskStatus } from "@/lib/types";

type FGNode = NodeObject<GraphNode & { degree: number }>;
type FGLink = LinkObject<GraphNode, GraphLink>;
type ForceGraphComponent = typeof import("react-force-graph-2d").default;

const FILE_CONTEXT: Record<string, string> = { request: "فایل درخواست", prework: "فایل پیش‌کار", main: "فایل کار اصلی", output: "خروجی نهایی", upgrade: "فایل ارتقا" };
const BASE_RADIUS: Record<GraphKind, number> = {
  project: 9,
  task: 6.5,
  requester: 6,
  file: 4.2,
  knowledge: 4.2,
  tag: 3.6,
  code: 3.2,
  document: 3.6,
  paper: 3.6,
  image: 3.6,
  concept: 3.8,
  rationale: 3.2,
  entity: 3,
};

const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function endId(v: unknown): string {
  return typeof v === "object" && v ? String((v as { id: unknown }).id) : String(v);
}

function useElementSize<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  React.useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: Math.floor(e.contentRect.width), height: Math.floor(e.contentRect.height) }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Colors the canvas needs from the current theme (re-read when dark/light mode toggles). */
function useThemeColors() {
  const [c, setC] = React.useState({ text: "#0f172a", muted: "#5b6477", pill: "rgba(255,255,255,0.85)", link: "rgba(100,116,139,0.35)", font: "Vazirmatn, sans-serif" });
  React.useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const dark = document.documentElement.classList.contains("dark");
      setC({
        text: cs.getPropertyValue("--text").trim() || "#0f172a",
        muted: cs.getPropertyValue("--text-muted").trim() || "#5b6477",
        pill: dark ? "rgba(13,18,34,0.82)" : "rgba(255,255,255,0.86)",
        link: dark ? "rgba(148,163,255,0.28)" : "rgba(71,85,105,0.30)",
        font: getComputedStyle(document.body).fontFamily || "Vazirmatn, sans-serif",
      });
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return c;
}

export function GraphClient({
  overview,
  projects,
  graphifyReady,
  focus,
  graphifyEnabled,
  githubReady,
}: {
  overview: GraphData;
  projects: { id: string; code: string; title: string; hasFolder: boolean }[];
  graphifyReady: string[];
  focus: { project: string; task: string } | null;
  graphifyEnabled: boolean;
  githubReady: boolean;
}) {
  const router = useRouter();
  const [FG, setFG] = React.useState<ForceGraphComponent | null>(null);
  const fgRef = React.useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);
  const [boxRef, size] = useElementSize<HTMLDivElement>();
  const theme = useThemeColors();

  const [loaded, setLoaded] = React.useState<Record<string, GraphifyLoad>>({});
  const [loading, setLoading] = React.useState(false);
  const [scope, setScope] = React.useState<string>(focus?.project ?? "all");
  const [hidden, setHidden] = React.useState<Set<GraphKind>>(new Set());
  const [showGraphify, setShowGraphify] = React.useState(true);
  const [labels, setLabels] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<string | null>(focus ? taskNodeId(focus.task) : null);
  const [hover, setHover] = React.useState<string | null>(null);
  const [full, setFull] = React.useState(false);
  const [building, setBuilding] = React.useState(false);

  React.useEffect(() => {
    void import("react-force-graph-2d").then((m) => setFG(() => m.default));
  }, []);

  const load = React.useCallback(async (ids: string[]) => {
    if (!ids.length) return;
    setLoading(true);
    const r = await loadGraphifyGraphsAction(ids);
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    setLoaded((prev) => ({ ...prev, ...Object.fromEntries(r.data.map((x) => [x.taskId, x])) }));
  }, []);

  React.useEffect(() => {
    void load(graphifyReady);
  }, [graphifyReady, load]);

  React.useEffect(() => {
    if (scope !== "all" && githubReady && !loaded[scope]) void load([scope]);
  }, [scope, githubReady, loaded, load]);

  // ------------------------------------------------------------ data pipeline
  const merged = React.useMemo(() => {
    const extra = showGraphify ? Object.values(loaded).flatMap((l) => (l.graph ? [l.graph] : [])) : [];
    return mergeGraphs(overview, ...extra);
  }, [overview, loaded, showGraphify]);

  const scoped = React.useMemo(() => (scope === "all" ? merged : projectSubgraph(merged, taskNodeId(scope))), [merged, scope]);

  const visible = React.useMemo(() => {
    const nodes = scoped.nodes.filter((n) => !hidden.has(n.kind));
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, links: scoped.links.filter((l) => ids.has(l.source) && ids.has(l.target)) };
  }, [scoped, hidden]);

  const neighbors = React.useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of visible.links) {
      if (!m.has(l.source)) m.set(l.source, new Set());
      if (!m.has(l.target)) m.set(l.target, new Set());
      m.get(l.source)!.add(l.target);
      m.get(l.target)!.add(l.source);
    }
    return m;
  }, [visible]);

  // Node objects are reused across filter changes so the layout does not jump.
  const cache = React.useRef(new Map<string, FGNode>());
  const fgData = React.useMemo(() => {
    const nodes = visible.nodes.map((n) => {
      const prev = cache.current.get(n.id);
      const obj = Object.assign(prev ?? {}, n, { degree: neighbors.get(n.id)?.size ?? 0 }) as FGNode;
      cache.current.set(n.id, obj);
      return obj;
    });
    return { nodes, links: visible.links.map((l) => ({ ...l })) as FGLink[] };
  }, [visible, neighbors]);

  const counts = React.useMemo(() => {
    const c = new Map<GraphKind, number>();
    for (const n of scoped.nodes) c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [scoped]);

  const byId = React.useMemo(() => new Map(merged.nodes.map((n) => [n.id, n])), [merged]);
  const visibleIds = React.useMemo(() => new Set(visible.nodes.map((n) => n.id)), [visible]);
  const focusId = [hover, selected].find((x) => x && visibleIds.has(x)) ?? null;
  const highlight = React.useMemo(() => {
    if (!focusId) return null;
    return new Set([focusId, ...(neighbors.get(focusId) ?? [])]);
  }, [focusId, neighbors]);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const rank = (n: GraphNode) => {
      const l = n.label.toLowerCase();
      if (l === q || n.taskCode?.toLowerCase() === q) return 0;
      if (l.startsWith(q)) return 1;
      if (l.includes(q)) return 2;
      if (n.taskCode?.toLowerCase().includes(q)) return 3;
      if (n.path?.toLowerCase().includes(q)) return 4;
      return 9;
    };
    return visible.nodes
      .map((n) => ({ n, r: rank(n) }))
      .filter((x) => x.r < 9)
      .sort((a, b) => a.r - b.r || a.n.label.length - b.n.label.length)
      .slice(0, 8)
      .map((x) => x.n);
  }, [query, visible]);

  // ------------------------------------------------------------ interactions
  const focusNode = React.useCallback((id: string) => {
    setSelected(id);
    const n = cache.current.get(id);
    if (n?.x !== undefined && n.y !== undefined) {
      fgRef.current?.centerAt(n.x, n.y, 600);
      fgRef.current?.zoom(Math.max(fgRef.current.zoom(), 2.2), 600);
    }
  }, []);

  React.useEffect(() => {
    // tighter layout for large graphs, looser for small ones
    const fg = fgRef.current;
    if (!fg) return;
    const charge = fg.d3Force("charge");
    const base = visible.nodes.length > 600 ? -28 : -60;
    charge?.strength?.((n: FGNode) => (n.kind === "project" ? base * 6 : n.kind === "requester" || n.kind === "task" ? base * 3 : base));
    fg.d3Force("x", forceX(0).strength(0.04) as never);
    fg.d3Force("y", forceY(0).strength(0.04) as never);
    const link = fg.d3Force("link");
    link?.distance?.((l: FGLink) => (l.relation === "has_file" || l.relation === "contains" ? 26 : l.relation === "tagged" ? 40 : 55));
    fg.d3ReheatSimulation();
  }, [FG, visible.nodes.length]);

  const fitted = React.useRef(false);
  React.useEffect(() => {
    fitted.current = false;
  }, [scope]);
  React.useEffect(() => {
    if (selected && !visibleIds.has(selected)) setSelected(null);
  }, [selected, visibleIds]);

  const toggleKind = (k: GraphKind) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const build = async (projectId: string) => {
    setBuilding(true);
    const r = await buildGraphifyAction(projectId);
    setBuilding(false);
    if (r.ok) toast.success("ساخت گراف graphify در صف قرار گرفت؛ پس از پایان اجرا در GitHub Actions «به‌روزرسانی» را بزنید.");
    else toast.error(r.error);
  };

  const refresh = () => {
    router.refresh();
    void load([...new Set([...graphifyReady, ...Object.keys(loaded)])]);
  };

  // ------------------------------------------------------------ canvas drawing
  const radius = (n: FGNode) => BASE_RADIUS[n.kind] + Math.min(5, Math.sqrt(n.degree) * 0.8);

  const drawNode = (n: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
    if (n.x === undefined || n.y === undefined) return;
    const r = radius(n);
    const color = KIND_META[n.kind].color;
    const isSel = n.id === selected;
    const isHover = n.id === hover;
    const faded = !!highlight && !highlight.has(n.id);
    ctx.globalAlpha = faded ? 0.12 : 1;

    if (isSel || isHover) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 5 / scale, 0, 2 * Math.PI);
      ctx.fillStyle = `${color}33`;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    if (n.kind === "project" || n.kind === "task") {
      ctx.lineWidth = 1.6 / scale;
      ctx.strokeStyle = theme.pill;
      ctx.stroke();
    }
    if (isSel) {
      ctx.lineWidth = 2.2 / scale;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 3 / scale, 0, 2 * Math.PI);
      ctx.stroke();
    }

    const important = n.kind === "project" || n.kind === "requester";
    const show = isSel || isHover || (labels && (important || (n.kind === "task" ? scale > 0.7 : scale > 1.6 || (!!highlight && highlight.has(n.id) && scale > 0.6))));
    if (show && !faded) {
      const fontSize = (important ? 12.5 : 11) / scale;
      ctx.font = `${important || isSel ? 700 : 500} ${fontSize}px ${theme.font}`;
      ctx.direction = RTL_CHARS.test(n.label) ? "rtl" : "ltr";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const text = truncate(n.label, important ? 42 : 34);
      const w = ctx.measureText(text).width;
      const pad = 2.5 / scale;
      const top = n.y + r + 2.5 / scale;
      ctx.fillStyle = theme.pill;
      ctx.beginPath();
      ctx.roundRect(n.x - w / 2 - pad * 1.6, top - pad * 0.4, w + pad * 3.2, fontSize + pad * 1.6, 4 / scale);
      ctx.fill();
      ctx.fillStyle = theme.text;
      ctx.fillText(text, n.x, top + pad * 0.3);
    }
    ctx.globalAlpha = 1;
  };

  const linkActive = (l: FGLink) => !!highlight && highlight.has(endId(l.source)) && highlight.has(endId(l.target)) && (endId(l.source) === focusId || endId(l.target) === focusId);

  const selectedNode = selected ? byId.get(selected) : undefined;
  const selectedNeighbors = React.useMemo(() => {
    if (!selected) return [];
    const out: { id: string; relation: string; dir: "out" | "in" }[] = [];
    for (const l of merged.links) {
      if (l.source === selected) out.push({ id: l.target, relation: l.relation, dir: "out" });
      else if (l.target === selected) out.push({ id: l.source, relation: l.relation, dir: "in" });
    }
    return out;
  }, [selected, merged]);

  const scopeProject = scope !== "all" ? projects.find((p) => p.id === scope) : undefined;
  const scopeLoad = scope !== "all" ? loaded[scope] : undefined;
  const graphifyCount = Object.values(loaded).filter((l) => l.status === "ok").length;

  // ------------------------------------------------------------ render
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
            <Network className="size-6 text-primary" /> گراف <span className="text-gradient">دانش</span>
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-7 text-muted">
            نقشه‌ی تعاملی همه‌ی پروژه‌ها، تسک‌های مرتبط، فایل‌ها، دانش استخراج‌شده و گراف‌های graphify با ارتباط‌هایشان. روی هر گره بزنید تا جزئیات و ارتباط‌هایش را ببینید؛ گره‌ها را می‌توانید بکشید.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {loading ? <Spinner className="size-4" /> : null}
          <span>
            {faNum(visible.nodes.length)} گره · {faNum(visible.links.length)} ارتباط · graphify: {faNum(graphifyCount)} پروژه
          </span>
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCw className="size-4" /> به‌روزرسانی
          </Button>
        </div>
      </div>

      <Card className="relative z-20 flex flex-wrap items-center gap-2 p-3">
        <Select value={scope} onChange={(e) => setScope(e.target.value)} className="h-10 w-full sm:w-72">
          <option value="all">همه‌ی پروژه‌ها</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {truncate(p.title, 40)}
            </option>
          ))}
        </Select>
        <div className="relative w-full sm:w-64">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) {
                focusNode(matches[0].id);
                setQuery("");
              }
            }}
            placeholder="جستجوی گره، فایل یا کد تسک…"
            className="h-10 pr-9"
          />
          {matches.length ? (
            <div className="glass absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl p-1 shadow-pop">
              {matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    focusNode(m.id);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-xs hover:bg-surface-muted"
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: KIND_META[m.kind].color }} />
                  <span dir="auto" className="min-w-0 flex-1 truncate text-start font-semibold">{m.label}</span>
                  <span className="text-faint">{KIND_META[m.kind].label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setLabels((v) => !v)} className={cn("flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition", labels ? "border-primary/40 bg-primary-soft text-primary" : "border-line text-muted")}>
            <Tags className="size-3.5" /> برچسب‌ها
          </button>
          <button onClick={() => setShowGraphify((v) => !v)} className={cn("flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition", showGraphify ? "border-primary/40 bg-primary-soft text-primary" : "border-line text-muted")}>
            <Sparkles className="size-3.5" /> graphify
          </button>
          <button onClick={() => fgRef.current?.zoomToFit(500, 40)} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-muted transition hover:text-fg">
            <Focus className="size-3.5" /> نمای کامل
          </button>
          <button onClick={() => setFull((v) => !v)} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-muted transition hover:text-fg">
            {full ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />} {full ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
          </button>
        </div>
        <div className="flex w-full flex-wrap gap-1.5">
          {(Object.keys(KIND_META) as GraphKind[])
            .filter((k) => counts.get(k))
            .map((k) => (
              <button
                key={k}
                onClick={() => toggleKind(k)}
                className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition", hidden.has(k) ? "border-line text-faint line-through opacity-60" : "border-line bg-surface-strong")}
                title={hidden.has(k) ? "نمایش" : "پنهان کردن"}
              >
                <span className="size-2.5 rounded-full" style={{ background: KIND_META[k].color }} />
                {KIND_META[k].label}
                <span className="text-faint">{faNum(counts.get(k) ?? 0)}</span>
              </button>
            ))}
        </div>
      </Card>

      {scopeProject && githubReady && graphifyEnabled && scopeLoad && scopeLoad.status !== "ok" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm">
          <Sparkles className="size-4 text-amber-600" />
          <span className="flex-1">
            {scopeLoad.status === "missing"
              ? scopeProject.hasFolder
                ? "graphify هنوز برای این پروژه اجرا نشده است؛ فعلاً ارتباط‌های ثبت‌شده در اپ نمایش داده می‌شود."
                : "این پروژه هنوز پوشه‌ای در GitHub ندارد؛ پس از اولین پیش‌کار، گراف graphify ساخته می‌شود."
              : `خواندن گراف graphify ناموفق بود: ${scopeLoad.error ?? ""}`}
          </span>
          {scopeProject.hasFolder ? (
            <Button size="sm" variant="outline" loading={building} onClick={() => build(scopeProject.id)}>
              <Sparkles className="size-4" /> ساخت گراف graphify
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className={cn(full ? "safe-y fixed inset-0 z-50 grid bg-[var(--bg)] p-3 lg:grid-cols-[1fr_340px] lg:gap-3" : "grid gap-4 lg:grid-cols-[1fr_340px]")}>
        <div ref={boxRef} dir="ltr" className={cn("glass relative overflow-hidden rounded-3xl", full ? "h-full min-h-[60vh]" : "h-[72vh] min-h-[520px]")}>
          {full ? (
            <button onClick={() => setFull(false)} className="glass absolute right-3 top-3 z-10 rounded-xl p-2" aria-label="بستن تمام‌صفحه">
              <X className="size-4" />
            </button>
          ) : null}
          {!FG || !size.width ? (
            <div className="grid h-full place-items-center">
              <Spinner />
            </div>
          ) : visible.nodes.length === 0 ? (
            <div dir="rtl" className="grid h-full place-items-center p-6 text-center text-sm text-muted">
              هنوز چیزی برای نمایش نیست. با ثبت تسک، پیش‌کار و اجرای graphify، پروژه‌ها و فایل‌ها اینجا به هم وصل می‌شوند.
            </div>
          ) : (
            <FG
              ref={fgRef}
              graphData={fgData}
              width={size.width}
              height={size.height}
              backgroundColor="rgba(0,0,0,0)"
              nodeId="id"
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={(n, color, ctx) => {
                if (n.x === undefined || n.y === undefined) return;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(n.x, n.y, radius(n) + 3, 0, 2 * Math.PI);
                ctx.fill();
              }}
              nodeLabel={(n) => `<div dir="rtl" style="font-family:${escapeHtml(theme.font)};font-size:12px;line-height:1.7"><b dir="auto">${escapeHtml(n.label)}</b><br/><span style="opacity:.75">${escapeHtml(KIND_META[n.kind].label)}${n.taskCode ? ` · ${escapeHtml(n.taskCode)}` : ""}</span></div>`}
              linkLabel={(l) => `<div dir="rtl" style="font-family:${escapeHtml(theme.font)};font-size:11.5px">${escapeHtml(relationLabel(String(l.relation)))}</div>`}
              linkColor={(l) => (linkActive(l) ? KIND_META[(cache.current.get(endId(l.source))?.kind ?? "entity") as GraphKind].color : highlight ? "rgba(148,163,184,0.07)" : theme.link)}
              linkWidth={(l) => (linkActive(l) ? 1.8 : 0.7)}
              linkDirectionalArrowLength={(l) => (linkActive(l) ? 4 : 2.6)}
              linkDirectionalArrowRelPos={1}
              linkDirectionalParticles={(l) => (linkActive(l) ? 2 : 0)}
              linkDirectionalParticleWidth={2.2}
              linkCurvature={(l) => (l.relation === "has_file" || l.relation === "contains" ? 0 : 0.12)}
              onNodeClick={(n) => focusNode(String(n.id))}
              onNodeHover={(n) => setHover(n ? String(n.id) : null)}
              onBackgroundClick={() => setSelected(null)}
              onNodeDragEnd={(n) => {
                n.fx = n.x;
                n.fy = n.y;
              }}
              cooldownTicks={180}
              onEngineStop={() => {
                if (fitted.current) return;
                fitted.current = true;
                if (selected && visibleIds.has(selected)) focusNode(selected);
                else fgRef.current?.zoomToFit(600, 40);
              }}
              minZoom={0.15}
              maxZoom={8}
            />
          )}
          <div dir="rtl" className="pointer-events-none absolute bottom-3 right-3 rounded-lg bg-surface/70 px-2 py-1 text-[10.5px] text-faint backdrop-blur">
            اسکرول: بزرگ‌نمایی · کشیدن پس‌زمینه: جابه‌جایی · کشیدن گره: ثابت کردن
          </div>
        </div>

        <aside className={cn("glass flex min-h-0 flex-col overflow-hidden rounded-3xl", full ? "mt-3 max-h-[40vh] lg:mt-0 lg:max-h-none" : "lg:max-h-[72vh]")}>
          {selectedNode ? (
            <NodePanel
              node={selectedNode}
              neighbors={selectedNeighbors}
              byId={byId}
              onPick={focusNode}
              onClose={() => setSelected(null)}
              onScope={(id) => setScope(id)}
              onBuild={graphifyEnabled && githubReady ? build : undefined}
              building={building}
              projects={projects}
            />
          ) : (
            <Legend counts={counts} />
          )}
        </aside>
      </div>
    </div>
  );
}

function Legend({ counts }: { counts: Map<GraphKind, number> }) {
  return (
    <div className="space-y-4 overflow-y-auto p-5 text-sm">
      <div>
        <p className="font-extrabold">راهنمای گراف</p>
        <p className="mt-1 text-xs leading-6 text-muted">هر دایره یک گره است؛ اندازه‌اش با تعداد ارتباط‌ها بزرگ‌تر می‌شود. روی یک گره بزنید تا مسیرهای ورودی و خروجی آن روشن شوند.</p>
      </div>
      <div className="space-y-1.5">
        {(Object.keys(KIND_META) as GraphKind[]).map((k) => (
          <div key={k} className={cn("flex items-center gap-2 text-xs", !counts.get(k) && "opacity-40")}>
            <span className="size-3 rounded-full" style={{ background: KIND_META[k].color }} />
            <span className="flex-1">{KIND_META[k].label}</span>
            <span className="text-faint">{faNum(counts.get(k) ?? 0)}</span>
          </div>
        ))}
      </div>
      <div className="rounded-2xl bg-surface-muted/60 p-3 text-xs leading-6 text-muted">
        <b className="text-fg">graphify</b> بعد از هر پیش‌کار و کار اصلی، فایل‌های پوشه‌ی پروژه در GitHub را تحلیل می‌کند و گراف فایل‌ها، کدها، اسناد و مفاهیم را در <span className="ltr">graphify-out/graph.json</span> می‌سازد؛ این صفحه همان گراف را همراه ارتباط‌های ثبت‌شده در اپ نمایش می‌دهد.
      </div>
    </div>
  );
}

function NodePanel({
  node,
  neighbors,
  byId,
  onPick,
  onClose,
  onScope,
  onBuild,
  building,
  projects,
}: {
  node: GraphNode;
  neighbors: { id: string; relation: string; dir: "out" | "in" }[];
  byId: Map<string, GraphNode>;
  onPick: (id: string) => void;
  onClose: () => void;
  onScope: (id: string) => void;
  onBuild?: (projectId: string) => void;
  building: boolean;
  projects: { id: string; hasFolder: boolean }[];
}) {
  const meta = KIND_META[node.kind];
  const groups = new Map<string, { id: string; dir: "out" | "in" }[]>();
  for (const n of neighbors) {
    const key = `${n.dir}:${n.relation}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const status = node.detail && node.detail in STATUS_META ? STATUS_META[node.detail as TaskStatus].label : undefined;
  const isProject = node.kind === "project" && node.taskId;
  const project = isProject ? projects.find((p) => p.id === node.taskId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line p-4">
        <div className="flex items-start gap-2">
          <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: meta.color }} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold" style={{ color: meta.color }}>
              {meta.label}
              {node.graphify ? " · graphify" : ""}
            </p>
            <p dir="auto" className="break-words text-start text-sm font-extrabold leading-6">{node.label}</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface-muted" aria-label="بستن">
            <X className="size-4" />
          </button>
        </div>
        <dl className="mt-3 space-y-1.5 text-xs">
          {node.taskCode ? <Row k="تسک" v={<span className="ltr font-bold">{node.taskCode}</span>} /> : null}
          {status ? <Row k="وضعیت" v={status} /> : null}
          {node.kind === "file" && node.detail && FILE_CONTEXT[node.detail] ? <Row k="نوع" v={FILE_CONTEXT[node.detail]} /> : null}
          {node.path ? <Row k="مسیر" v={<span className="ltr break-all text-[11px]">{node.path}</span>} /> : null}
          {node.group ? <Row k="خوشه" v={node.group} /> : null}
          {node.detail && !status && !(node.kind === "file" && FILE_CONTEXT[node.detail]) ? <Row k="توضیح" v={<span className="break-words">{node.detail}</span>} /> : null}
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {node.taskId ? (
            <Link href={`/tasks/${node.taskId}`}>
              <Button size="sm" variant="outline">
                صفحه‌ی تسک <ArrowUpLeft className="size-4" />
              </Button>
            </Link>
          ) : null}
          {node.url ? (
            <a href={node.url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                GitHub <ExternalLink className="size-4" />
              </Button>
            </a>
          ) : null}
          {isProject ? (
            <Button size="sm" variant="secondary" onClick={() => onScope(node.taskId!)}>
              <Focus className="size-4" /> فقط این پروژه
            </Button>
          ) : null}
          {isProject && onBuild && project?.hasFolder ? (
            <Button size="sm" variant="ghost" loading={building} onClick={() => onBuild(node.taskId!)}>
              <Sparkles className="size-4" /> graphify
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p className="text-xs font-bold text-muted">ارتباط‌ها ({faNum(neighbors.length)})</p>
        {[...groups.entries()].map(([key, list]) => {
          const [dir, relation] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
          return (
            <div key={key}>
              <p className="mb-1 text-[11px] font-semibold text-faint">
                {dir === "out" ? "←" : "→"} {relationLabel(relation)} ({faNum(list.length)})
              </p>
              <div className="space-y-1">
                {list.slice(0, 40).map((n) => {
                  const other = byId.get(n.id);
                  if (!other) return null;
                  return (
                    <button key={`${key}:${n.id}`} onClick={() => onPick(n.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs hover:bg-surface-muted">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: KIND_META[other.kind].color }} />
                      <span dir="auto" className="min-w-0 flex-1 truncate text-start">{other.label}</span>
                    </button>
                  );
                })}
                {list.length > 40 ? <p className="text-center text-[11px] text-faint">+{faNum(list.length - 40)}</p> : null}
              </div>
            </div>
          );
        })}
        {neighbors.length === 0 ? <p className="text-xs text-faint">ارتباطی ثبت نشده است.</p> : null}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-12 shrink-0 text-faint">{k}</dt>
      <dd className="min-w-0 flex-1">{v}</dd>
    </div>
  );
}
