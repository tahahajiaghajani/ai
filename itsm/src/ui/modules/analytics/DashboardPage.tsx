// A dashboard (catalogue ANA-010/011/049): widgets on a 12-column grid with tabs, dashboard-wide controls (the time
// window and field filters applied to every widget whose table has the field), each widget computed with the
// viewer's own access («در دسترس شما نیست» for a widget the viewer may not see, while the others draw), a click on
// an element opening its records, auto refresh, and TV mode (full screen, tabs cycling, refreshing). Its editors get
// the canvas: drag a widget by its handle, resize it from its corner, or — with the keyboard — arrows move and
// Shift+arrows resize the focused widget; the widget library adds saved reports, quick definitions, indicators,
// scorecards and notes; layouts never overlap (the shared layout model compacts them). The member's home dashboard
// (their workspace's, else one marked for everyone) is the same page without an id.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Dropdown, Input, InputNumber, Modal, Segmented, Select, Space, Switch, Tooltip } from "antd";
import { BadgeCheck, CalendarClock, Copy, FileJson, GripVertical, LayoutDashboard, MoreHorizontal, Pencil, Plus, Printer, RefreshCw, Save, Settings2, Trash2, Tv, X } from "lucide-react";
import { COLS, MAX_WIDGETS, ROW_PX, WIDGET_KINDS, addWidget, compact, layoutRows, moveWidget, nudge, removeWidget, resizeWidget } from "@shared/analytics/layout";
import { TIME_PRESETS, VIZ, VIZ_TYPES, starterSpec } from "@shared/analytics/model";
import type { DashboardFilter, DashboardLayout, FilterValues, ReportSpec, ScorecardItem, Widget, WidgetKind } from "@shared/analytics/types";
import type { DashboardView, WidgetRun } from "@shared/analytics/api";
import { PRACTICE_OPTIONS } from "@shared/tables/analytics";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader } from "../../components/layout";
import { EmptyState, Loader } from "../../components/display";
import { ICON14, Note, cx } from "../../components/blocks";
import { RecordMarkdown, RecordSelect, newRecordPath, recordsApi, useMe, useSchema } from "../../records";
import { optionsOf } from "../../records/model/schema";
import { analyticsApi, ANALYTICS_KEYS, saveJson } from "./api";
import { KpiTile, RestrictedNote, ResultCard, ShareEditor, statusText, useAnalyticsMeta } from "./parts";
import { DeltaBadge, Sparkline } from "./Chart";
import { exactValue } from "./model";
import "./analytics.css";

const GAP = 12;

/** The member's remembered control values of a dashboard (a per-viewer convenience; nothing depends on it). */
function useStoredValues(key: string): [FilterValues, (v: FilterValues) => void] {
  const storageKey = `itsm.analytics.filters.${key}`;
  const [v, setV] = useState<FilterValues>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as FilterValues;
    } catch {
      return {};
    }
  });
  const set = (next: FilterValues) => {
    setV(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      /* private window */
    }
  };
  return [v, set];
}

export default function DashboardPage({ home }: { home?: boolean }) {
  const { id: idParam } = useParams();
  const { api, orgId } = useOrg();
  const meta = useAnalyticsMeta();
  const homeQ = useQuery({ queryKey: ANALYTICS_KEYS.home(orgId), queryFn: () => analyticsApi.home(api), enabled: !!home });
  const id = home ? (homeQ.data?.dashboard?.id ?? null) : (idParam ?? null);
  const q = useQuery({ queryKey: ANALYTICS_KEYS.dashboard(orgId, id ?? ""), queryFn: () => analyticsApi.dashboard(api, id!), enabled: !!id });
  if (home && homeQ.isLoading) return <Loader />;
  if (home && !homeQ.data?.dashboard)
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="داشبورد خانه" />
        <EmptyState icon={LayoutDashboard} title="هنوز داشبوردی برای شما کنار گذاشته نشده است" description="داشبوردهایی که با شما به اشتراک گذاشته شده‌اند در «داشبوردها» هستند." />
      </div>
    );
  if (!id || q.isLoading || meta.isLoading) return <Loader />;
  if (q.error || !q.data) return <EmptyState title="داشبورد در دسترس نیست" description={errorText(q.error)} />;
  return <Board key={q.data.id + ":" + q.data.version} view={q.data} home={!!home} canAuthor={!!meta.data?.can_author} canAdmin={!!meta.data?.can_admin} />;
}

function Board({ view, home, canAuthor, canAdmin }: { view: DashboardView; home: boolean; canAuthor: boolean; canAdmin: boolean }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useStoredValues(view.id);
  const tabs = view.layout.tabs ?? [];
  const [tab, setTab] = useState<string | null>(tabs[0]?.key ?? null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<DashboardLayout>(view.layout);
  const [filters, setFilters] = useState<DashboardFilter[]>(view.filters);
  const [tv, setTv] = useState(false);
  const [library, setLibrary] = useState(false);
  const [settingsOf, setSettingsOf] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState(false);
  const layout = edit ? draft : view.layout;
  const shown = layout.widgets.filter((w) => (w.tab ?? null) === tab);

  // TV mode: tabs cycle, Esc leaves
  useEffect(() => {
    if (!tv) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTv(false);
    window.addEventListener("keydown", onKey);
    const timer = tabs.length > 1 ? setInterval(() => setTab((t) => tabs[(tabs.findIndex((x) => x.key === t) + 1) % tabs.length].key), Math.max(5, view.tv_cycle) * 1000) : null;
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearInterval(timer);
    };
  }, [tv, tabs, view.tv_cycle]);

  const save = async () => {
    setSaving(true);
    try {
      await recordsApi.update(api, "analytics_dashboard", view.id, { layout: { ...draft, widgets: compact(draft.widgets) }, filters }, view.version);
      n.ok("داشبورد ذخیره شد");
      setEdit(false);
      await qc.invalidateQueries({ queryKey: ANALYTICS_KEYS.dashboard(orgId, view.id) });
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };

  const more = [
    { key: "print", icon: <Printer {...ICON14} />, label: "نسخهٔ چاپی", onClick: () => navigate(`/${orgId}/analytics/print/dashboard/${view.id}`) },
    { key: "schedule", icon: <CalendarClock {...ICON14} />, label: "ارسال زمان‌بندی‌شده", onClick: () => navigate(`/${orgId}/${newRecordPath("analytics_schedule")}?dashboard_id=${view.id}&name=${encodeURIComponent(view.name)}`) },
    { key: "json", icon: <FileJson {...ICON14} />, label: "خروجی JSON", onClick: () => analyticsApi.exportBundle(api, { dashboards: [view.id] }).then((b) => saveJson(view.name, b)).catch((e) => n.error(e)) },
    ...(canAuthor ? [{ key: "copy", icon: <Copy {...ICON14} />, label: "رونوشت برای خودم", onClick: () => analyticsApi.copy(api, "analytics_dashboard", view.id).then((r) => navigate(`/${orgId}/analytics/dashboards/${r.row.id}`)).catch((e) => n.error(e)) }] : []),
    ...(view.can_edit ? [{ key: "record", icon: <Settings2 {...ICON14} />, label: "نام، اشتراک و تنظیمات", onClick: () => setSettings(true) }] : []),
    ...(canAdmin ? [{ key: "certify", icon: <BadgeCheck {...ICON14} />, label: view.certified ? "برداشتن تأیید" : "تأیید داشبورد", onClick: () => analyticsApi.certify(api, "analytics_dashboard", view.id, !view.certified).then(() => qc.invalidateQueries({ queryKey: ANALYTICS_KEYS.dashboard(orgId, view.id) })).catch((e) => n.error(e)) }] : []),
  ];

  const header = (
    <PageHeader
      title={
        <span className="an-title">
          {view.name}
          {view.certified ? <BadgeCheck size={16} strokeWidth={1.6} className="an-certified" aria-label="تأییدشده" /> : null}
        </span>
      }
      back={home ? undefined : "analytics/dashboards"}
      actions={
        edit ? (
          <Space size={8} wrap>
            <Button icon={<Plus {...ICON14} />} onClick={() => setLibrary(true)} disabled={draft.widgets.length >= MAX_WIDGETS}>
              افزودن ابزارک
            </Button>
            <Button icon={<Settings2 {...ICON14} />} onClick={() => setFiltersOpen(true)}>
              پالایه‌ها و زبانه‌ها
            </Button>
            <Button onClick={() => { setDraft(view.layout); setFilters(view.filters); setEdit(false); }}>انصراف</Button>
            <Button type="primary" icon={<Save {...ICON14} />} loading={saving} onClick={save}>
              ذخیره
            </Button>
          </Space>
        ) : (
          <Space size={8} wrap>
            <Dropdown menu={{ items: more.map(({ onClick, ...m }) => ({ ...m, onClick: () => onClick() })) }} trigger={["click"]}>
              <Button icon={<MoreHorizontal {...ICON14} />} aria-label="کارهای بیشتر" />
            </Dropdown>
            <Tooltip title="حالت نمایشگر (Esc برای خروج)">
              <Button icon={<Tv {...ICON14} />} onClick={() => { setTv(true); document.documentElement.requestFullscreen?.().catch(() => undefined); }} aria-label="حالت نمایشگر" />
            </Tooltip>
            <Tooltip title="تازه‌سازی همهٔ ابزارک‌ها">
              <Button icon={<RefreshCw {...ICON14} />} aria-label="تازه‌سازی" onClick={() => qc.invalidateQueries({ queryKey: ["analytics", orgId, "widget", view.id] })} />
            </Tooltip>
            {view.can_edit ? (
              <Button type="primary" icon={<Pencil {...ICON14} />} onClick={() => { setDraft(view.layout); setFilters(view.filters); setEdit(true); }}>
                ویرایش
              </Button>
            ) : null}
          </Space>
        )
      }
    />
  );

  const body = (
    <>
      <FilterBar filters={edit ? filters : view.filters} layout={layout} values={values} onChange={setValues} />
      {(edit ? draft.tabs ?? [] : tabs).length ? (
        <Segmented value={tab ?? ""} onChange={(v) => setTab(String(v) || null)} options={[...(edit ? draft.tabs ?? [] : tabs).map((t) => ({ value: t.key, label: t.label })), ...(layout.widgets.some((w) => !w.tab) ? [{ value: "", label: "بی‌زبانه" }] : [])]} aria-label="زبانه‌ها" />
      ) : null}
      {shown.length ? (
        <Canvas
          widgets={shown}
          edit={edit}
          onChange={(ws) => setDraft((d) => ({ ...d, widgets: [...d.widgets.filter((w) => (w.tab ?? null) !== tab), ...ws] }))}
          render={(w) => <WidgetCard view={view} widget={w} values={values} edit={edit} tv={tv} onSettings={() => setSettingsOf(w.id)} onRemove={() => setDraft((d) => ({ ...d, widgets: removeWidget(d.widgets, w.id) }))} />}
        />
      ) : (
        <EmptyState icon={LayoutDashboard} title="این داشبورد هنوز ابزارکی ندارد" action={view.can_edit && !edit ? <Button onClick={() => setEdit(true)}>افزودن ابزارک</Button> : undefined} />
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {header}
      {view.description && !edit ? <p className="an-desc">{view.description}</p> : null}
      {body}
      {tv ? (
        <div className="an-tv" role="dialog" aria-label={`${view.name} — حالت نمایشگر`}>
          <div className="an-tv-bar">
            <strong>{view.name}</strong>
            {tabs.length ? <span className="an-muted">{tabs.find((t) => t.key === tab)?.label}</span> : null}
            <Button size="small" icon={<X {...ICON14} />} onClick={() => { setTv(false); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined); }} aria-label="خروج از حالت نمایشگر" className="ms-auto" />
          </div>
          <div className="an-tv-body">
            <Canvas widgets={shown} edit={false} onChange={() => undefined} render={(w) => <WidgetCard view={view} widget={w} values={values} edit={false} tv onSettings={() => undefined} onRemove={() => undefined} />} />
          </div>
        </div>
      ) : null}
      <WidgetLibrary
        open={library}
        onClose={() => setLibrary(false)}
        onAdd={(kind, extra) => {
          setDraft((d) => ({ ...d, widgets: addWidget(d.widgets, kind, { ...extra, tab }) }));
          setLibrary(false);
        }}
      />
      <WidgetSettings
        widget={draft.widgets.find((w) => w.id === settingsOf) ?? null}
        tabs={draft.tabs ?? []}
        onClose={() => setSettingsOf(null)}
        onChange={(w) => setDraft((d) => ({ ...d, widgets: d.widgets.map((x) => (x.id === w.id ? w : x)) }))}
      />
      <DashboardSettings open={settings} onClose={() => setSettings(false)} id={view.id} canAdmin={canAdmin} />
      <FiltersEditor open={filtersOpen} onClose={() => setFiltersOpen(false)} filters={filters} tabs={draft.tabs ?? []} onChange={(f, t) => { setFilters(f); setDraft((d) => ({ ...d, tabs: t, widgets: d.widgets.map((w) => (w.tab && !t.some((x) => x.key === w.tab) ? { ...w, tab: null } : w)) })); }} />
    </div>
  );
}

// ----- the controls ----------------------------------------------------------------------------------------------------

function FilterBar({ filters, layout, values, onChange }: { filters: DashboardFilter[]; layout: DashboardLayout; values: FilterValues; onChange: (v: FilterValues) => void }) {
  const { schema } = useSchema();
  if (!filters.length) return null;
  // the options of a field filter come from the first widget table that has the field
  const tables = [...new Set(layout.widgets.map((w) => w.spec?.table).filter((t): t is string => !!t))];
  return (
    <div className="an-filters" role="group" aria-label="پالایه‌های داشبورد">
      {filters.map((f) => {
        if (f.kind === "time") {
          const v = values[f.key] as { window?: unknown } | string | undefined;
          const key = typeof v === "string" ? v : TIME_PRESETS.find((p) => JSON.stringify(p.window) === JSON.stringify((v as { window?: unknown } | undefined)?.window ?? v))?.key;
          return (
            <Select key={f.key} allowClear value={key} placeholder={f.label} onChange={(k) => onChange({ ...values, [f.key]: k ? TIME_PRESETS.find((p) => p.key === k)?.window : null })} options={TIME_PRESETS.map((p) => ({ value: p.key, label: p.label }))} aria-label={f.label} style={{ minWidth: 150 }} />
          );
        }
        const def = tables.map((t) => schema?.def(t)).find((d) => d?.fields.some((x) => x.name === f.field));
        const field = def?.fields.find((x) => x.name === f.field);
        const val = values[f.key] as string[] | undefined;
        if (field && FIELD_TYPES[field.type]?.family === "ref") {
          const target = refTarget(field, def!.key);
          return target ? (
            <div key={f.key} style={{ minWidth: 200 }}>
              <RecordSelect table={target} multiple value={val ?? []} onChange={(v) => onChange({ ...values, [f.key]: v })} placeholder={f.label} aria-label={f.label} allowClear />
            </div>
          ) : null;
        }
        const options = field && schema ? optionsOf(field, schema.choices) : [];
        return <Select key={f.key} mode="multiple" allowClear value={val ?? []} placeholder={f.label} onChange={(v) => onChange({ ...values, [f.key]: v })} options={options.map((o) => ({ value: o.value, label: o.label }))} aria-label={f.label} style={{ minWidth: 170 }} maxTagCount="responsive" />;
      })}
      {Object.values(values).some((v) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) ? (
        <Button size="small" type="text" onClick={() => onChange({})}>
          پاک کردن پالایه‌ها
        </Button>
      ) : null}
    </div>
  );
}

// ----- the canvas ------------------------------------------------------------------------------------------------------

interface DragState {
  id: string;
  mode: "move" | "resize";
  x0: number;
  y0: number;
  box: { x: number; y: number; w: number; h: number };
  col: number;
}

/** The grid: positions in logical columns (x = 0 on the start side), drag and resize by pointer or keyboard. */
function Canvas({ widgets, edit, onChange, render }: { widgets: Widget[]; edit: boolean; onChange: (ws: Widget[]) => void; render: (w: Widget) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const rows = Math.max(layoutRows(widgets, widgets[0]?.tab ?? null), ghost ? ghost.y + ghost.h : 0);
  const rtl = typeof document !== "undefined" ? getComputedStyle(document.documentElement).direction !== "ltr" : true;

  const start = (e: RPointerEvent, w: Widget, mode: DragState["mode"]) => {
    if (!edit || !ref.current) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const col = (ref.current.clientWidth - GAP * (COLS - 1)) / COLS + GAP;
    setDrag({ id: w.id, mode, x0: e.clientX, y0: e.clientY, box: { x: w.x, y: w.y, w: w.w, h: w.h }, col });
    setGhost({ x: w.x, y: w.y, w: w.w, h: w.h });
  };
  const move = (e: RPointerEvent) => {
    if (!drag) return;
    const dxPx = e.clientX - drag.x0;
    const dx = Math.round((rtl ? -dxPx : dxPx) / drag.col);
    const dy = Math.round((e.clientY - drag.y0) / (ROW_PX + GAP));
    const b = drag.box;
    setGhost(drag.mode === "move" ? { ...b, x: Math.max(0, Math.min(COLS - b.w, b.x + dx)), y: Math.max(0, b.y + dy) } : { ...b, w: Math.max(2, Math.min(COLS - b.x, b.w + dx)), h: Math.max(2, Math.min(18, b.h + dy)) });
  };
  const end = () => {
    if (drag && ghost) onChange(drag.mode === "move" ? moveWidget(widgets, drag.id, ghost.x, ghost.y) : resizeWidget(widgets, drag.id, ghost.w, ghost.h));
    setDrag(null);
    setGhost(null);
  };
  const onKey = (e: React.KeyboardEvent, w: Widget) => {
    if (!edit || e.target !== e.currentTarget) return;
    const map: Record<string, [number, number]> = { ArrowLeft: [rtl ? 1 : -1, 0], ArrowRight: [rtl ? -1 : 1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    onChange(nudge(widgets, w.id, d[0], d[1], e.shiftKey));
  };
  const place = (b: { x: number; y: number; w: number; h: number }): CSSProperties => ({ gridColumn: `${b.x + 1} / span ${b.w}`, gridRow: `${b.y + 1} / span ${b.h}` });
  return (
    <div
      ref={ref}
      className={cx("an-canvas", edit && "is-edit")}
      style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridAutoRows: `${ROW_PX}px`, gap: GAP, gridTemplateRows: `repeat(${Math.max(rows, 1)}, ${ROW_PX}px)` }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {widgets.map((w) => (
        <div
          key={w.id}
          className={cx("an-widget", drag?.id === w.id && "is-dragging")}
          style={place(w)}
          tabIndex={edit ? 0 : undefined}
          onKeyDown={(e) => onKey(e, w)}
          aria-label={edit ? `${w.title || WIDGET_KINDS[w.kind].label} — جابه‌جایی با کلیدهای جهت، تغییر اندازه با Shift و کلیدهای جهت` : undefined}
        >
          {edit ? (
            <button type="button" className="an-handle" onPointerDown={(e) => start(e, w, "move")} aria-label="جابه‌جایی" tabIndex={-1}>
              <GripVertical {...ICON14} aria-hidden />
            </button>
          ) : null}
          {render(w)}
          {edit ? <span className="an-resize" onPointerDown={(e) => start(e, w, "resize")} aria-hidden title="تغییر اندازه" /> : null}
        </div>
      ))}
      {ghost ? <div className="an-ghost" style={place(ghost)} aria-hidden /> : null}
    </div>
  );
}

// ----- one widget ------------------------------------------------------------------------------------------------------

function WidgetCard({ view, widget: w, values, edit, tv, onSettings, onRemove }: { view: DashboardView; widget: Widget; values: FilterValues; edit: boolean; tv: boolean; onSettings: () => void; onRemove: () => void }) {
  const { api, orgId } = useOrg();
  const navigate = useNavigate();
  const stored = useMemo(() => view.layout.widgets.find((x) => x.id === w.id), [view.layout.widgets, w.id]);
  // a widget as stored runs through the dashboard (the viewer's access to the dashboard is checked); a new or changed
  // one being designed runs through the preview (the same engine, the same access)
  const changed = !stored || JSON.stringify({ ...stored, x: 0, y: 0, w: 0, h: 0 }) !== JSON.stringify({ ...w, x: 0, y: 0, w: 0, h: 0 });
  const q = useQuery({
    queryKey: changed ? ANALYTICS_KEYS.preview(orgId, w, values) : ANALYTICS_KEYS.widget(orgId, view.id, w.id, values),
    queryFn: (): Promise<WidgetRun> => (changed ? analyticsApi.preview(api, w, view.filters, values) : analyticsApi.widget(api, view.id, w.id, values)),
    refetchInterval: edit ? false : Math.max(1, view.refresh_minutes) * 60_000,
    retry: false,
    staleTime: 30_000,
  });
  const title = w.title || (w.report_id ? view.reports[w.report_id] : null) || (w.indicator_id ? view.indicators[w.indicator_id] : null) || (q.data?.kind === "report" ? q.data.result.table_label : WIDGET_KINDS[w.kind].label);
  const tools = edit ? (
    <>
      <Button size="small" type="text" icon={<Settings2 {...ICON14} />} onClick={onSettings} aria-label="تنظیم ابزارک" />
      <Button size="small" type="text" icon={<Trash2 {...ICON14} />} onClick={onRemove} aria-label="برداشتن ابزارک" />
    </>
  ) : null;
  let body: React.ReactNode;
  if (q.isLoading) body = <Loader />;
  else if (q.error) body = <Note tone="danger">{errorText(q.error)}</Note>;
  else if (!q.data) body = null;
  else if (q.data.kind === "restricted") body = <RestrictedNote reason={q.data.reason} />;
  else if (q.data.kind === "text") body = <RecordMarkdown text={q.data.text} />;
  else if (q.data.kind === "indicator") {
    const item = q.data.item;
    body = <KpiTile item={item} compact={w.h <= 3} onOpen={edit ? undefined : () => navigate(`/${orgId}/analytics/indicators/${item.id}`)} />;
  } else if (q.data.kind === "scorecard") body = <ScorecardTable items={q.data.items} onOpen={edit ? undefined : (id) => navigate(`/${orgId}/analytics/indicators/${id}`)} />;
  else if (q.data.kind === "report") {
    const run = q.data;
    return (
      <div className="an-wcard">
        <ResultCard spec={run.spec} result={run.result} title={title} compact excel={!tv} tools={tools} />
        {run.ignored.length ? <div className="an-wnote">پالایهٔ {run.ignored.map((k) => view.filters.find((f) => f.key === k)?.label ?? k).join("، ")} به این ابزارک نمی‌خورد</div> : null}
      </div>
    );
  }
  return (
    <div className="an-wcard">
      <div className="an-result-bar">
        <div className="an-result-title">{w.kind === "indicator" ? null : title}</div>
        <Space size={2}>{tools}</Space>
      </div>
      <div className="an-wbody">{body}</div>
    </div>
  );
}

/** Indicators as rows: value, change, target, status and the trend. */
export function ScorecardTable({ items, onOpen }: { items: ScorecardItem[]; onOpen?: (id: string) => void }) {
  if (!items.length) return <EmptyState compact title="شاخصی برای نمایش نیست" />;
  return (
    <div className="an-table-wrap">
      <table className="an-table an-scorecard">
        <thead>
          <tr>
            <th scope="col">شاخص</th>
            <th scope="col" className="an-num">مقدار</th>
            <th scope="col">تغییر</th>
            <th scope="col" className="an-num">هدف</th>
            <th scope="col">وضعیت</th>
            <th scope="col">روند</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <th scope="row">{onOpen ? <button type="button" className="ds-link" onClick={() => onOpen(i.id)}>{i.name}</button> : i.name}</th>
              <td className="an-num">{i.restricted ? "—" : exactValue(i.current.value, i.unit, i.decimals)}</td>
              <td>{i.restricted ? null : <DeltaBadge delta={i.delta} direction={i.direction} />}</td>
              <td className="an-num">{i.target === null ? "—" : exactValue(i.target, i.unit, i.decimals)}</td>
              <td>{i.restricted ? <span className="an-muted">در دسترس نیست</span> : <span className={cx("an-status", `is-${i.status}`)}>{statusText(i)}</span>}</td>
              <td style={{ width: 120 }}>{i.restricted ? null : <Sparkline points={i.trend.length ? i.trend : (i.stored ?? [])} target={i.target} height={28} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----- the widget library ----------------------------------------------------------------------------------------------

function WidgetLibrary({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (kind: WidgetKind, extra: Partial<Widget>) => void }) {
  const { api, orgId } = useOrg();
  const meta = useAnalyticsMeta();
  const { schema } = useSchema();
  const [kind, setKind] = useState<WidgetKind | "quick">("report");
  const reports = useQuery({ queryKey: ["analytics", orgId, "picker", "reports"], queryFn: () => recordsApi.list(api, "analytics_report", { filter: { f: "trashed", op: "eq", v: false }, size: 100, fields: ["name", "folder", "viz", "table_key"], sort: "name", total: false }), enabled: open });
  const indicators = useQuery({ queryKey: ["analytics", orgId, "picker", "indicators"], queryFn: () => recordsApi.list(api, "analytics_indicator", { filter: { f: "active", op: "eq", v: true }, size: 200, fields: ["name", "practice", "key"], sort: "practice,name", total: false }), enabled: open });
  const [pick, setPick] = useState<string | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [quick, setQuick] = useState<{ table: string | null; viz: ReportSpec["viz"] }>({ table: null, viz: "column" });
  const add = () => {
    if (kind === "report" && pick) onAdd("report", { report_id: pick });
    else if (kind === "indicator" && pick) onAdd("indicator", { indicator_id: pick });
    else if (kind === "scorecard" && picks.length) onAdd("scorecard", { indicator_ids: picks, title: "کارت امتیاز" });
    else if (kind === "text") onAdd("text", { text });
    else if (kind === "quick" && quick.table && schema?.def(quick.table)) {
      const s = starterSpec(schema.def(quick.table)!);
      const viz = VIZ[quick.viz].dims[0] > s.dims.length ? s.viz : quick.viz;
      onAdd("report", { spec: { ...s, viz }, title: `${schema.def(quick.table)!.plural}` });
    } else return;
    setPick(null);
    setPicks([]);
    setText("");
  };
  return (
    <Drawer open={open} onClose={onClose} title="کتابخانهٔ ابزارک‌ها" size="default" destroyOnHidden footer={<Button type="primary" onClick={add}>افزودن به داشبورد</Button>}>
      <div className="flex flex-col gap-3">
        <Segmented
          value={kind}
          onChange={(v) => { setKind(v as WidgetKind | "quick"); setPick(null); }}
          options={[
            { value: "report", label: "گزارش ذخیره‌شده" },
            { value: "quick", label: "گزارش سریع" },
            { value: "indicator", label: "شاخص" },
            { value: "scorecard", label: "کارت امتیاز" },
            { value: "text", label: "یادداشت" },
          ]}
          block
          aria-label="نوع ابزارک"
        />
        {kind === "report" ? (
          <Select showSearch optionFilterProp="label" value={pick ?? undefined} onChange={setPick} placeholder="گزارش" options={(reports.data?.rows ?? []).map((r) => ({ value: r.id, label: `${r.name}${r.folder ? ` — ${r.folder}` : ""}` }))} loading={reports.isLoading} aria-label="گزارش" />
        ) : kind === "quick" ? (
          <>
            <Select showSearch optionFilterProp="label" value={quick.table ?? undefined} onChange={(t) => setQuick({ ...quick, table: t })} placeholder="جدول" options={(meta.data?.tables ?? []).map((t) => ({ value: t.key, label: t.plural }))} aria-label="جدول" />
            <Select value={quick.viz} onChange={(v) => setQuick({ ...quick, viz: v })} options={VIZ_TYPES.filter((v) => VIZ[v].kind !== "records").map((v) => ({ value: v, label: VIZ[v].label }))} aria-label="نمایش" />
            <div className="an-muted">تعداد رکوردها به تفکیک وضعیت در ۳۰ روز گذشته؛ برای تعریف کامل، گزارشی در «طراح گزارش» بسازید و آن را بیفزایید.</div>
          </>
        ) : kind === "indicator" ? (
          <Select showSearch optionFilterProp="label" value={pick ?? undefined} onChange={setPick} placeholder="شاخص" options={(indicators.data?.rows ?? []).map((r) => ({ value: r.id, label: `${r.name} (${PRACTICE_OPTIONS.find((p) => p.value === r.practice)?.label ?? r.practice})` }))} loading={indicators.isLoading} aria-label="شاخص" />
        ) : kind === "scorecard" ? (
          <Select mode="multiple" showSearch optionFilterProp="label" value={picks} onChange={setPicks} placeholder="شاخص‌ها" options={(indicators.data?.rows ?? []).map((r) => ({ value: r.id, label: String(r.name) }))} maxCount={30} aria-label="شاخص‌ها" />
        ) : (
          <Input.TextArea value={text} onChange={(e) => setText(e.target.value)} autoSize={{ minRows: 4, maxRows: 12 }} maxLength={5000} placeholder="متن (Markdown): توضیح داشبورد، تعریف‌ها، پیوندها" aria-label="متن یادداشت" />
        )}
        <div className="an-kinds">
          {(Object.keys(WIDGET_KINDS) as WidgetKind[]).map((k) => (
            <span key={k} className="an-muted">{WIDGET_KINDS[k].label}: {WIDGET_KINDS[k].w}×{WIDGET_KINDS[k].h}</span>
          ))}
        </div>
      </div>
    </Drawer>
  );
}

function WidgetSettings({ widget, tabs, onClose, onChange }: { widget: Widget | null; tabs: { key: string; label: string }[]; onClose: () => void; onChange: (w: Widget) => void }) {
  return (
    <Modal open={!!widget} onCancel={onClose} onOk={onClose} title="تنظیم ابزارک" destroyOnHidden okText="بستن" cancelButtonProps={{ style: { display: "none" } }}>
      {widget ? (
        <div className="flex flex-col gap-3">
          <Input value={widget.title ?? ""} onChange={(e) => onChange({ ...widget, title: e.target.value || null })} placeholder="عنوان" maxLength={120} aria-label="عنوان" />
          {tabs.length ? <Select allowClear value={widget.tab ?? undefined} placeholder="بی‌زبانه" onChange={(t) => onChange({ ...widget, tab: t ?? null })} options={tabs.map((t) => ({ value: t.key, label: t.label }))} aria-label="زبانه" /> : null}
          {widget.kind === "text" ? <Input.TextArea value={widget.text ?? ""} onChange={(e) => onChange({ ...widget, text: e.target.value })} autoSize={{ minRows: 4, maxRows: 14 }} maxLength={5000} aria-label="متن" /> : null}
          {widget.kind === "report" && widget.spec ? (
            <Select value={widget.spec.viz} onChange={(viz) => onChange({ ...widget, spec: { ...widget.spec!, viz } })} options={VIZ_TYPES.filter((v) => VIZ[v].kind !== "records" || v === "list").map((v) => ({ value: v, label: VIZ[v].label }))} aria-label="نوع نمایش" />
          ) : null}
          <div className="an-muted">جابه‌جایی: کشیدن دستگیره یا کلیدهای جهت · اندازه: گوشهٔ ابزارک یا Shift و کلیدهای جهت</div>
        </div>
      ) : null}
    </Modal>
  );
}

function FiltersEditor({ open, onClose, filters, tabs, onChange }: { open: boolean; onClose: () => void; filters: DashboardFilter[]; tabs: { key: string; label: string }[]; onChange: (f: DashboardFilter[], t: { key: string; label: string }[]) => void }) {
  const [f, setF] = useState(filters);
  const [t, setT] = useState(tabs);
  useEffect(() => {
    if (open) {
      setF(filters);
      setT(tabs);
    }
  }, [open, filters, tabs]);
  const nextKey = useCallback((prefix: string, used: string[]) => {
    let i = 1;
    while (used.includes(`${prefix}${i}`)) i++;
    return `${prefix}${i}`;
  }, []);
  return (
    <Modal open={open} onCancel={onClose} onOk={() => { onChange(f, t); onClose(); }} title="پالایه‌ها و زبانه‌ها" okText="به‌کار بستن" cancelText="انصراف" destroyOnHidden width={620}>
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="an-h3">پالایه‌های سراسری</h3>
          {f.map((x, i) => (
            <div key={x.key} className="an-row">
              <Input value={x.label} onChange={(e) => setF(f.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} aria-label="برچسب پالایه" />
              {x.kind === "field" ? <Input value={x.field ?? ""} onChange={(e) => setF(f.map((y, j) => (j === i ? { ...y, field: e.target.value.trim() } : y)))} placeholder="نام فیلد، مانند priority" dir="ltr" aria-label="فیلد" /> : <span className="an-muted">بازهٔ زمانی همهٔ ابزارک‌ها</span>}
              <Button type="text" icon={<X {...ICON14} />} onClick={() => setF(f.filter((_, j) => j !== i))} aria-label="برداشتن پالایه" />
            </div>
          ))}
          <Space>
            <Button size="small" icon={<Plus {...ICON14} />} disabled={f.some((x) => x.kind === "time") || f.length >= 8} onClick={() => setF([...f, { key: nextKey("time", f.map((x) => x.key)), kind: "time", label: "بازهٔ زمانی" }])}>
              بازهٔ زمانی
            </Button>
            <Button size="small" icon={<Plus {...ICON14} />} disabled={f.length >= 8} onClick={() => setF([...f, { key: nextKey("f", f.map((x) => x.key)), kind: "field", field: "priority", label: "اولویت" }])}>
              پالایهٔ فیلد
            </Button>
          </Space>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="an-h3">زبانه‌ها</h3>
          {t.map((x, i) => (
            <div key={x.key} className="an-row">
              <Input value={x.label} onChange={(e) => setT(t.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} aria-label="نام زبانه" />
              <Button type="text" icon={<X {...ICON14} />} onClick={() => setT(t.filter((_, j) => j !== i))} aria-label="برداشتن زبانه" />
            </div>
          ))}
          <Button size="small" icon={<Plus {...ICON14} />} disabled={t.length >= 12} onClick={() => setT([...t, { key: nextKey("tab", t.map((x) => x.key)), label: `زبانهٔ ${t.length + 1}` }])}>
            زبانه
          </Button>
        </section>
      </div>
    </Modal>
  );
}


/** The dashboard's name, description, folder, home flags (everyone / workspaces), TV and refresh timing and sharing. */
function DashboardSettings({ open, onClose, id, canAdmin }: { open: boolean; onClose: () => void; id: string; canAdmin: boolean }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const { userId } = useMe();
  const rec = useQuery({ queryKey: ["records", orgId, "analytics_dashboard", id], queryFn: () => recordsApi.get(api, "analytics_dashboard", id), enabled: open });
  const [v, setV] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open && rec.data) setV({ ...rec.data.row });
    if (!open) setV(null);
  }, [open, rec.data]);
  const set = (patch: Record<string, unknown>) => setV((x) => (x ? { ...x, ...patch } : x));
  const owner = rec.data?.row.owner_id === userId;
  const save = async () => {
    if (!v || !rec.data) return;
    setSaving(true);
    try {
      const data: Record<string, unknown> = { name: v.name, description: v.description ?? null, folder: v.folder ?? null, is_home: !!v.is_home, home_workspaces: v.home_workspaces ?? [], tv_cycle: v.tv_cycle, refresh_minutes: v.refresh_minutes };
      if (owner || canAdmin) data.shares = v.shares ?? [];
      await recordsApi.update(api, "analytics_dashboard", id, data, rec.data.row.version);
      n.ok("تنظیمات داشبورد ذخیره شد");
      await qc.invalidateQueries({ queryKey: ANALYTICS_KEYS.dashboard(orgId, id) });
      await qc.invalidateQueries({ queryKey: ["records", orgId, "analytics_dashboard", id] });
      onClose();
    } catch (e) {
      n.error(e);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onCancel={onClose} onOk={save} confirmLoading={saving} okText="ذخیره" cancelText="انصراف" title="نام، اشتراک و تنظیمات" destroyOnHidden width={640}>
      {!v ? (
        <Loader />
      ) : (
        <div className="flex flex-col gap-3">
          <Input value={String(v.name ?? "")} onChange={(e) => set({ name: e.target.value })} placeholder="نام" maxLength={150} aria-label="نام" />
          <Input value={String(v.folder ?? "")} onChange={(e) => set({ folder: e.target.value || null })} placeholder="پوشه" maxLength={80} aria-label="پوشه" />
          <Input.TextArea value={String(v.description ?? "")} onChange={(e) => set({ description: e.target.value || null })} placeholder="شرح" autoSize={{ minRows: 1, maxRows: 4 }} maxLength={2000} aria-label="شرح" />
          <label className="an-switch">
            <Switch size="small" checked={!!v.is_home} onChange={(c) => set({ is_home: c })} />
            صفحهٔ خانهٔ همهٔ خوانندگان
          </label>
          <RecordSelect table="workspace" multiple value={(v.home_workspaces as string[]) ?? []} onChange={(x) => set({ home_workspaces: x })} placeholder="داشبورد خانهٔ این فضاهای کاری" aria-label="فضاهای کاری" allowClear />
          <div className="an-row">
            <InputNumber min={5} max={600} value={Number(v.tv_cycle ?? 20)} onChange={(x) => set({ tv_cycle: Number(x) || 20 })} addonBefore="گردش نمایشگر (ثانیه)" aria-label="گردش زبانه‌ها در حالت نمایشگر" />
            <InputNumber min={1} max={120} value={Number(v.refresh_minutes ?? 5)} onChange={(x) => set({ refresh_minutes: Number(x) || 5 })} addonBefore="تازه‌سازی (دقیقه)" aria-label="تازه‌سازی داده" />
          </div>
          <h3 className="an-h3">اشتراک</h3>
          <ShareEditor value={(v.shares as never) ?? []} onChange={(shares) => set({ shares })} disabled={!owner && !canAdmin} />
        </div>
      )}
    </Modal>
  );
}
