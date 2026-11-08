// The dashboard canvas (catalogue ANA-010): widgets on a 12-column grid, positions in logical columns (x = 0 is the
// start side: the right in Persian), rows of a fixed height. Moving or resizing a widget pushes the widgets it lands
// on downwards and then everything floats up (vertical compaction), so a layout never overlaps and never has holes.
// Pure: the canvas, the keyboard alternative of dragging (arrows move, Shift+arrows resize) and the server's
// validation of a stored layout all use these functions.
import type { DashboardLayout, Widget, WidgetKind } from "./types";

export const COLS = 12;
export const ROW_PX = 44;
export const MIN_W = 2;
export const MIN_H = 2;
export const MAX_H = 18;
export const MAX_WIDGETS = 40;

export const WIDGET_KINDS: Record<WidgetKind, { label: string; w: number; h: number }> = {
  report: { label: "گزارش", w: 6, h: 6 },
  indicator: { label: "شاخص", w: 3, h: 3 },
  scorecard: { label: "کارت امتیاز", w: 12, h: 6 },
  text: { label: "یادداشت", w: 4, h: 3 },
};

type Box = Pick<Widget, "x" | "y" | "w" | "h">;

const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/** Clamp one widget into the grid. */
export function clampBox<T extends Box>(b: T): T {
  const w = int(b.w, MIN_W, COLS, 6);
  return { ...b, w, h: int(b.h, MIN_H, MAX_H, 4), x: int(b.x, 0, COLS - w, 0), y: int(b.y, 0, 10_000, 0) };
}

export const collides = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const sameTab = (a: Widget, b: Widget) => (a.tab ?? null) === (b.tab ?? null);

const byPosition = (a: Widget, b: Widget) => a.y - b.y || a.x - b.x;

/** Float every widget up as far as it goes (per tab), keeping the order. */
export function compact(widgets: Widget[]): Widget[] {
  const out: Widget[] = [];
  for (const w of [...widgets].sort(byPosition)) {
    let y = 0;
    const placed = out.filter((o) => sameTab(o, w));
    // the lowest y where it does not overlap anything already placed
    for (;;) {
      const at = { ...w, y };
      const hit = placed.find((o) => collides(o, at));
      if (!hit) break;
      y = hit.y + hit.h;
    }
    out.push({ ...w, y });
  }
  // keep the caller's order (ids stay stable for React keys)
  const pos = new Map(out.map((w) => [w.id, w]));
  return widgets.map((w) => pos.get(w.id)!);
}

/** Push the widgets `moved` lands on down below it, recursively. */
function pushDown(widgets: Widget[], moved: Widget, guard = 0): Widget[] {
  if (guard > 200) return widgets;
  let list = widgets;
  for (const other of [...list].sort(byPosition)) {
    if (other.id === moved.id || !sameTab(other, moved)) continue;
    const current = list.find((x) => x.id === other.id)!;
    if (!collides(current, moved)) continue;
    const down = { ...current, y: moved.y + moved.h };
    list = list.map((x) => (x.id === down.id ? down : x));
    list = pushDown(list, down, guard + 1);
  }
  return list;
}

/** Move a widget to (x, y): others make room, then the layout compacts. */
export function moveWidget(widgets: Widget[], id: string, x: number, y: number): Widget[] {
  const w = widgets.find((o) => o.id === id);
  if (!w) return widgets;
  const moved = clampBox({ ...w, x, y });
  const list = widgets.map((o) => (o.id === id ? moved : o));
  return compact(pushDown(list, moved));
}

/** Resize a widget to w × h: others make room, then the layout compacts. */
export function resizeWidget(widgets: Widget[], id: string, w: number, h: number): Widget[] {
  const cur = widgets.find((o) => o.id === id);
  if (!cur) return widgets;
  const sized = clampBox({ ...cur, w, h, x: Math.min(cur.x, COLS - Math.max(MIN_W, Math.min(COLS, Math.round(w)))) });
  const list = widgets.map((o) => (o.id === id ? sized : o));
  return compact(pushDown(list, sized));
}

/** The keyboard alternative of dragging: arrows move by one cell, with resize the size changes instead. */
export function nudge(widgets: Widget[], id: string, dx: number, dy: number, resize = false): Widget[] {
  const w = widgets.find((o) => o.id === id);
  if (!w) return widgets;
  return resize ? resizeWidget(widgets, id, w.w + dx, w.h + dy) : moveWidget(widgets, id, w.x + dx, Math.max(0, w.y + dy));
}

/** The first free place for a new w × h widget on a tab (rows from the top, the start side first). */
export function freeSpot(widgets: Widget[], w: number, h: number, tab: string | null = null): { x: number; y: number } {
  const ww = Math.max(MIN_W, Math.min(COLS, w));
  const on = widgets.filter((o) => (o.tab ?? null) === tab);
  const bottom = on.reduce((m, o) => Math.max(m, o.y + o.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + ww <= COLS; x++) {
      const box = { x, y, w: ww, h };
      if (!on.some((o) => collides(o, box))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** Add a widget of `kind` in the first free place. */
export function addWidget(widgets: Widget[], kind: WidgetKind, extra: Partial<Widget> = {}, id = newWidgetId()): Widget[] {
  const size = WIDGET_KINDS[kind];
  const w = extra.w ?? size.w;
  const h = extra.h ?? size.h;
  const spot = freeSpot(widgets, w, h, extra.tab ?? null);
  return [...widgets, clampBox({ ...extra, id, kind, x: spot.x, y: spot.y, w, h })];
}

export const removeWidget = (widgets: Widget[], id: string) => compact(widgets.filter((w) => w.id !== id));

/** Rows a tab occupies. */
export const layoutRows = (widgets: Widget[], tab: string | null = null) => widgets.filter((w) => (w.tab ?? null) === tab).reduce((m, w) => Math.max(m, w.y + w.h), 0);

let seq = 0;
export function newWidgetId(): string {
  seq = (seq + 1) % 1_000_000;
  return `w${Date.now().toString(36)}${seq.toString(36)}`;
}

/** A stored layout made safe: widgets clamped, unknown kinds and duplicates dropped, at most 40, compacted. */
export function cleanLayout(input: unknown): DashboardLayout {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<DashboardLayout>;
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs
        .filter((t) => t && typeof t.key === "string" && /^[a-z0-9_-]{1,40}$/i.test(t.key) && typeof t.label === "string")
        .slice(0, 12)
        .map((t) => ({ key: t.key, label: t.label.trim().slice(0, 60) || t.key }))
    : [];
  const tabKeys = new Set(tabs.map((t) => t.key));
  const seen = new Set<string>();
  const widgets: Widget[] = [];
  for (const w of Array.isArray(raw.widgets) ? raw.widgets : []) {
    if (!w || typeof w !== "object" || !(w.kind in WIDGET_KINDS)) continue;
    const id = typeof w.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(w.id) ? w.id : newWidgetId();
    if (seen.has(id)) continue;
    seen.add(id);
    const tab = typeof w.tab === "string" && tabKeys.has(w.tab) ? w.tab : null;
    widgets.push(clampBox({ ...w, id, tab, title: typeof w.title === "string" ? w.title.slice(0, 120) : null, text: typeof w.text === "string" ? w.text.slice(0, 5000) : null }));
    if (widgets.length >= MAX_WIDGETS) break;
  }
  return { tabs, widgets: compact(widgets) };
}
