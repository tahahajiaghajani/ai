// Small pieces shared by the analytics screens: the module's meta, the chart gallery's icons, a result with its
// toolbar (chart ↔ table, records, Excel, freshness), the KPI tile with its sparkline and target, the sharing editor
// and the restricted widget note.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Button, Select, Space, Tooltip } from "antd";
import {
  ChartArea, ChartBar, ChartColumn, ChartLine, ChartNoAxesCombined, ChartPie, CircleDot, Download, Filter, Gauge, Grid3x3, Hash, List, ListTree, Lock, Plus, Table, Table2, Trash2, Rows3,
  type LucideIcon,
} from "lucide-react";
import { builtinRoles } from "@shared/access";
import { SHARE_KINDS, SHARE_RIGHTS } from "@shared/analytics/share";
import { STATUS_LABELS } from "@shared/analytics/kpi";
import type { KeyValue, ReportResult, ReportSpec, ScorecardItem, Share, VizType } from "@shared/analytics/types";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { Chip, type ChipTone } from "../../components/display";
import { cx, ICON14 } from "../../components/blocks";
import { RecordSelect, tablePath, useSchema } from "../../records";
import { analyticsApi, ANALYTICS_KEYS, downloadXlsx } from "./api";
import { ResultView, DeltaBadge, Sparkline, freshness } from "./Chart";
import { elementCond, exactValue, recordsHref, STATUS_TONE } from "./model";

export const VIZ_ICONS: Record<VizType, LucideIcon> = {
  column: ChartColumn,
  bar: ChartBar,
  line: ChartLine,
  area: ChartArea,
  pie: ChartPie,
  donut: CircleDot,
  heatmap: Grid3x3,
  funnel: Filter,
  pareto: ChartNoAxesCombined,
  score: Hash,
  gauge: Gauge,
  table: Table,
  pivot: Table2,
  list: List,
  grouped: ListTree,
};

/** The module's meta (who may author, administer; the tables to report on). */
export function useAnalyticsMeta() {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: ANALYTICS_KEYS.meta(orgId), queryFn: () => analyticsApi.meta(api), staleTime: 60_000 });
}

/** «در دسترس شما نیست»: a widget the viewer may not see (the others still draw). */
export function RestrictedNote({ reason }: { reason: string }) {
  return (
    <div className="an-restricted" role="note">
      <Lock {...ICON14} aria-hidden />
      <span>{reason}</span>
    </div>
  );
}

/** A result with its toolbar: the chart or its table, «نمایش رکوردها» for the element clicked, Excel, freshness. */
export function ResultCard({
  spec,
  result,
  height,
  title,
  tools,
  onDrill,
  compact,
  excel = true,
}: {
  spec: ReportSpec;
  result: ReportResult;
  height?: number;
  title?: ReactNode;
  tools?: ReactNode;
  /** a click on an element with a next drill step (else the records open) */
  onDrill?: (keys: KeyValue[]) => boolean;
  compact?: boolean;
  excel?: boolean;
}) {
  const { orgId, timezone } = useOrg();
  const { schema } = useSchema();
  const n = useNotify();
  const navigate = useNavigate();
  const [table, setTable] = useState(false);
  const def = schema?.def(spec.table);
  const records = (keys: KeyValue[] | null) => {
    if (!def) return;
    const cond = keys ? elementCond(spec, result, keys, def, { tz: timezone, now: Date.parse(result.generated_at) || Date.now(), lookup: schema?.lookup }) : result.filter;
    if (keys && cond === null) return n.error(new Error("این بخش را نمی‌توان به رکوردها برگرداند (روز هفته یا ساعت روز)"));
    navigate(recordsHref(`/${orgId}/${tablePath(spec.table)}`, cond));
  };
  const onElement = (keys: KeyValue[]) => {
    if (onDrill?.(keys)) return;
    records(keys);
  };
  const chartable = result.kind === "agg" && !["table", "pivot"].includes(spec.viz);
  return (
    <div className="an-result">
      <div className="an-result-bar">
        {title ? <div className="an-result-title">{title}</div> : null}
        <Space size={2} className="an-result-tools">
          {tools}
          {chartable ? (
            <Tooltip title={table ? "نمودار" : "جدول داده‌ها"}>
              <Button size="small" type="text" icon={table ? <ChartColumn {...ICON14} /> : <Rows3 {...ICON14} />} aria-label={table ? "نمایش نمودار" : "نمایش جدول داده‌ها"} aria-pressed={table} onClick={() => setTable(!table)} />
            </Tooltip>
          ) : null}
          {def ? (
            <Tooltip title="نمایش رکوردها">
              <Button size="small" type="text" icon={<List {...ICON14} />} aria-label="نمایش رکوردهای این گزارش" onClick={() => records(null)} />
            </Tooltip>
          ) : null}
          {excel ? (
            <Tooltip title="پروندهٔ اکسل">
              <Button size="small" type="text" icon={<Download {...ICON14} />} aria-label="دریافت پروندهٔ اکسل" onClick={() => downloadXlsx(orgId, { spec, title: typeof title === "string" ? title : result.table_label }).catch((e) => n.error(e))} />
            </Tooltip>
          ) : null}
        </Space>
      </div>
      <div className="an-result-body" style={height ? { height } : undefined}>
        <ResultView spec={spec} result={result} asTable={table} onElement={def ? onElement : undefined} schema={schema} compact={compact} />
      </div>
      <div className="an-result-foot">
        <span>{result.kind === "list" ? `${faDigits(result.list?.total ?? result.list?.rows.length ?? 0)} رکورد` : `${faDigits(result.total_n)} رکورد`}</span>
        {result.suppressed ? <span>· {faDigits(result.suppressed)} گروه کوچک پنهان</span> : null}
        <span className="ms-auto">{freshness(result, timezone)}</span>
      </div>
    </div>
  );
}

/** «بی‌داده» when the period has no value yet; otherwise the status against the target. */
export const statusText = (item: Pick<ScorecardItem, "status" | "current">) => (item.current.value === null ? "بی‌داده" : STATUS_LABELS[item.status]);

/** Statuses as the kit's chip tones. */
export const CHIP_TONE: Record<string, ChipTone> = { ok: "in", warn: "warning", bad: "danger", neutral: "neutral" };

/** A KPI tile: value, status, change against the previous period, target, sparkline; opens the KPI hub. */
export function KpiTile({ item, onOpen, compact }: { item: ScorecardItem; onOpen?: () => void; compact?: boolean }) {
  const points = item.trend.length ? item.trend : (item.stored ?? []);
  return (
    <div
      className={cx("an-kpi", onOpen && "is-link", compact && "is-compact")}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`${item.name}: ${item.restricted ? "در دسترس نیست" : exactValue(item.current.value, item.unit, item.decimals)}`}
    >
      <div className="an-kpi-head">
        <span className="an-kpi-name">{item.name}</span>
        {item.restricted ? null : <Chip tone={CHIP_TONE[STATUS_TONE[item.status]]}>{statusText(item)}</Chip>}
      </div>
      {item.restricted ? (
        <RestrictedNote reason={item.restricted} />
      ) : (
        <>
          <div className="an-kpi-val ds-t-figure">{exactValue(item.current.value, item.unit, item.decimals)}</div>
          <div className="an-kpi-meta">
            <DeltaBadge delta={item.delta} direction={item.direction} />
            <span className="an-muted">{item.current.label}</span>
            {item.target !== null ? <span className="an-muted">هدف {exactValue(item.target, item.unit, item.decimals)}</span> : null}
          </div>
          {compact ? null : <Sparkline points={points} target={item.target} />}
        </>
      )}
    </div>
  );
}

// ----- sharing ---------------------------------------------------------------------------------------------------------

const ROLE_OPTIONS = builtinRoles().map((r) => ({ value: r.key, label: r.name }));

/** Who a definition is shared with: people, groups, units (with or without their subtree), role holders, everyone. */
export function ShareEditor({ value, onChange, disabled }: { value: Share[]; onChange: (v: Share[]) => void; disabled?: boolean }) {
  const [kind, setKind] = useState<Share["kind"]>("group");
  const [target, setTarget] = useState<string | null>(null);
  const [right, setRight] = useState<"view" | "edit">("view");
  const add = () => {
    if (kind !== "everyone" && !target) return;
    const next = value.filter((s) => !(s.kind === kind && (s.id ?? null) === (kind === "everyone" ? null : target)));
    onChange([...next, { kind, id: kind === "everyone" ? null : target, right }]);
    setTarget(null);
  };
  const tableOf = (k: Share["kind"]) => (k === "user" ? "user" : k === "group" ? "group" : "org_unit");
  return (
    <div className="flex flex-col gap-2">
      {value.length ? (
        <ul className="an-shares">
          {value.map((s, i) => (
            <li key={`${s.kind}:${s.id ?? ""}`}>
              <span className="an-muted">{SHARE_KINDS[s.kind]}</span>
              <span className="min-w-0 flex-1 truncate">{s.kind === "everyone" ? "همهٔ خوانندگان گزارش‌ها" : s.kind === "role" ? ROLE_OPTIONS.find((r) => r.value === s.id)?.label ?? s.id : <ShareTarget kind={s.kind} id={s.id ?? ""} />}</span>
              <Select size="small" value={s.right ?? "view"} disabled={disabled} onChange={(r) => onChange(value.map((x, j) => (j === i ? { ...x, right: r } : x)))} options={Object.entries(SHARE_RIGHTS).map(([v, l]) => ({ value: v, label: l }))} aria-label="سطح" style={{ width: 96 }} />
              <Button size="small" type="text" disabled={disabled} icon={<Trash2 {...ICON14} />} aria-label="برداشتن" onClick={() => onChange(value.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="an-muted">خصوصی: فقط شما (و ویرایشگرانی که بیفزایید) آن را می‌بینید.</div>
      )}
      {disabled ? null : (
        <div className="an-share-add">
          <Select size="small" value={kind} onChange={(k) => { setKind(k); setTarget(null); }} options={Object.entries(SHARE_KINDS).map(([v, l]) => ({ value: v, label: l }))} aria-label="نوع" style={{ width: 150 }} />
          {kind === "everyone" ? null : kind === "role" ? (
            <Select size="small" value={target ?? undefined} onChange={setTarget} options={ROLE_OPTIONS} placeholder="نقش" showSearch optionFilterProp="label" style={{ minWidth: 170 }} aria-label="نقش" />
          ) : (
            <div style={{ minWidth: 200 }}>
              <RecordSelect table={tableOf(kind)} value={target} onChange={(v) => setTarget((v as string) ?? null)} size="small" placeholder="انتخاب کنید" aria-label={SHARE_KINDS[kind]} />
            </div>
          )}
          <Select size="small" value={right} onChange={setRight} options={Object.entries(SHARE_RIGHTS).map(([v, l]) => ({ value: v, label: l }))} aria-label="سطح" style={{ width: 96 }} />
          <Button size="small" icon={<Plus {...ICON14} />} onClick={add} disabled={kind !== "everyone" && !target}>
            افزودن
          </Button>
        </div>
      )}
      <div className="an-muted">اشتراک تعریف را می‌دهد، نه داده را: هر بیننده فقط رکوردهایی را می‌بیند که خودش اجازه دارد.</div>
    </div>
  );
}

function ShareTarget({ kind, id }: { kind: Share["kind"]; id: string }) {
  const table = kind === "user" ? "user" : kind === "group" ? "group" : "org_unit";
  return <RecordSelect table={table} value={id} onChange={() => undefined} size="small" variant="borderless" disabled />;
}

/** Re-run a query key family after a change. */
export const analyticsKeysAll = ANALYTICS_KEYS.all;

export { analyticsApi };
