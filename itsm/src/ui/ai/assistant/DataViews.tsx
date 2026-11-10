// Charts and tables inside an answer. The rows come from the server (GET /ai/data/:ref, stored by the tool that
// computed them), never from the model's words, so a chart cannot show a number the books do not have.
// Charts use the --ds-chart-* series in their fixed order; every chart can switch to its table and export to Excel.
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartColumn, Table2, FileSpreadsheet, TriangleAlert } from "lucide-react";
import type { AiChartSpec } from "@shared/ai/types";
import { APP_NAME } from "@shared/constants";
import { useOrg } from "../../lib/org";
import { compact, fa } from "../../lib/fa";
import { exportExcel } from "../../lib/excel";
import { useNotify } from "../../lib/hooks";
import { Ic } from "../../components/shell/icons";
import { useAiClient } from "./useAi";
import { decimalParts, figureText, isNumeric, toNumber } from "./format";
import type { UiTable } from "./state";

const SERIES = ["var(--ds-chart-1)", "var(--ds-chart-3)", "var(--ds-chart-4)", "var(--ds-chart-5)", "var(--ds-chart-6)", "var(--ds-chart-2)"];
const MAX_SLICES = 6;
const MAX_BARS = 12;

type Row = Record<string, unknown>;

function useRows(dataRef: string) {
  const { orgId } = useOrg();
  const client = useAiClient();
  return useQuery({ queryKey: ["ai", orgId, "data", dataRef], queryFn: () => client.data(dataRef), staleTime: Infinity, gcTime: 30 * 60_000, retry: 1 });
}

/** One value of a row as the table shows it: exact figures, «—» for nothing. */
function Value({ v, numeric }: { v: unknown; numeric?: boolean }) {
  if (v === null || v === undefined || v === "") return <span className="sa-zero">—</span>;
  if (typeof v === "boolean") return <>{v ? "بله" : "خیر"}</>;
  if ((numeric || typeof v === "number") && isNumeric(v)) {
    const p = decimalParts(v as string | number);
    return p.neg ? (
      <bdi dir="ltr" className="ds-ltr">
        {"−"}
        {p.text}
      </bdi>
    ) : (
      <>{p.text}</>
    );
  }
  return <>{typeof v === "object" ? JSON.stringify(v) : String(v)}</>;
}

async function toExcel(title: string, columns: { key: string; title: string; numeric?: boolean }[], rows: Row[]) {
  await exportExcel(
    title || `دستیار ${APP_NAME}`,
    columns.map((c) => ({
      title: c.title,
      type: c.numeric ? ("number" as const) : ("text" as const),
      width: c.numeric ? 18 : 28,
      value: (r: Row) => {
        const v = r[c.key];
        return v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : (v as string | number);
      },
    })),
    rows,
  );
}

function CardHead({ title, unit, children }: { title: ReactNode; unit?: string | null; children?: ReactNode }) {
  return (
    <header className="sa-card-h">
      <div className="sa-card-tt">
        <span className="sa-card-t">{title}</span>
        {unit ? <span className="sa-card-u">{unit}</span> : null}
      </div>
      {children ? <div className="sa-card-x">{children}</div> : null}
    </header>
  );
}

function Failed({ text = "داده‌های این بخش خوانده نشد." }: { text?: string }) {
  return (
    <div className="sa-card-note">
      <Ic icon={TriangleAlert} />
      {text}
    </div>
  );
}

function Rows({ n }: { n: number }) {
  return (
    <div className="sa-card-skel" aria-busy="true" aria-label="در حال بارگذاری">
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className="ds-skel" style={{ inlineSize: `${[86, 62, 74, 55][i % 4]}%` }} />
      ))}
    </div>
  );
}

function ExcelButton({ onExport }: { onExport: () => Promise<void> }) {
  const n = useNotify();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="sa-mini"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onExport();
        } catch (e) {
          n.error(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Ic icon={FileSpreadsheet} size={14} />
      خروجی اکسل
    </button>
  );
}

// ---------------------------------------------------------------- tables

function DataTable({ columns, rows }: { columns: { key: string; title: string; numeric?: boolean }[]; rows: Row[] }) {
  return (
    <div className="sa-tbl-wrap" tabIndex={0} role="region" aria-label="جدول داده‌ها">
      <table className="sa-tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "ds-num" : undefined}>
                  <Value v={r[c.key]} numeric={c.numeric} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableCard({ table }: { table: UiTable }) {
  const q = useRows(table.data_ref);
  const rows = q.data?.rows ?? [];
  const title = table.title || q.data?.title || "جدول";
  const shown = rows.length;
  return (
    <section className="sa-card" aria-label={title}>
      <CardHead title={title}>{shown ? <ExcelButton onExport={() => toExcel(title, table.columns, rows)} /> : null}</CardHead>
      {q.isLoading ? <Rows n={4} /> : q.isError ? <Failed /> : !shown ? <div className="sa-card-note">ردیفی برای نمایش نیست.</div> : <DataTable columns={table.columns} rows={rows} />}
      {shown ? (
        <footer className="sa-card-f">
          {table.total_rows > shown ? `${fa(shown)} ردیف از ${fa(table.total_rows)}` : `${fa(shown)} ردیف`}
        </footer>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- charts

/** Months, dates and weeks run along an axis; names (people, items) read better as a ranked list of bars. */
const TEMPORAL = /^(?:[\d۰-۹]{4}[-/][\d۰-۹]{1,2}(?:[-/][\d۰-۹]{1,2})?|.*(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند|هفته|فصل).*)$/;

function ChartTip({ active, payload, label, unit, x }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; dataKey?: string; payload?: Row }[]; label?: string; unit?: string; x: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  return (
    <div className="sa-tip">
      <div className="sa-tip-t">{String(row[x] ?? label ?? "")}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="sa-tip-r">
          <i className="sa-tip-k" style={{ background: p.color }} />
          <span>{p.name}</span>
          <b>{figureText(String(row[`__raw_${p.dataKey}`] ?? p.value ?? 0), 2)}</b>
        </div>
      ))}
      {unit ? <div className="sa-tip-u">{unit}</div> : null}
    </div>
  );
}

/** A ranked list of bars (one series over names): HTML, so long Persian names wrap and the bars grow from the start. */
function BarList({ rows, spec }: { rows: Row[]; spec: AiChartSpec }) {
  const s = spec.series[0];
  const values = rows.map((r) => toNumber(r[s.field]));
  const max = Math.max(...values.map(Math.abs), 0) || 1;
  const shown = rows.slice(0, MAX_BARS);
  return (
    <div className="sa-bars" role="list">
      {shown.map((r, i) => {
        const v = values[i];
        const p = decimalParts(String(r[s.field] ?? "0"), 2);
        return (
          <div key={i} className="sa-bar" role="listitem">
            <span className="sa-bar-l">{String(r[spec.x] ?? "—")}</span>
            <span className="sa-bar-track" aria-hidden>
              <i className={v < 0 ? "is-neg" : undefined} style={{ inlineSize: `${Math.max(1.5, (Math.abs(v) / max) * 100)}%` }} />
            </span>
            <span className="sa-bar-v ds-num">
              {p.neg ? (
                <bdi dir="ltr" className="ds-ltr">
                  {"−"}
                  {p.text}
                </bdi>
              ) : (
                p.text
              )}
            </span>
          </div>
        );
      })}
      {rows.length > MAX_BARS ? <div className="sa-bars-more">و {fa(rows.length - MAX_BARS)} ردیف دیگر در جدول</div> : null}
    </div>
  );
}

function Donut({ rows, spec }: { rows: Row[]; spec: AiChartSpec }) {
  const s = spec.series[0];
  const { slices, folded } = useMemo(() => {
    const all = rows.map((r) => ({ name: String(r[spec.x] ?? "—"), value: Math.max(0, toNumber(r[s.field])) })).filter((x) => x.value > 0);
    all.sort((a, b) => b.value - a.value);
    if (all.length <= MAX_SLICES) return { slices: all, folded: false };
    const rest = all.slice(MAX_SLICES - 1).reduce((a, x) => a + x.value, 0);
    return { slices: [...all.slice(0, MAX_SLICES - 1), { name: "سایر", value: rest }], folded: true };
  }, [rows, spec.x, s.field]);
  const total = slices.reduce((a, x) => a + x.value, 0) || 1;
  // past six slices the rest folds into «سایر», drawn in the neutral «other» colour
  const color = (i: number) => (folded && i === slices.length - 1 ? "var(--ds-chart-other)" : SERIES[i % SERIES.length]);
  return (
    <div className="sa-donut">
      <div className="sa-donut-c" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="96%" paddingAngle={1.5} stroke="none" isAnimationActive={false}>
              {slices.map((x, i) => (
                <Cell key={x.name} fill={color(i)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="sa-legend-l">
        {slices.map((x, i) => (
          <li key={x.name}>
            <i style={{ background: color(i) }} />
            <span className="sa-legend-n">{x.name}</span>
            <span className="sa-legend-v ds-num">{`؜${fa((x.value / total) * 100, 1)}٪`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AxisChart({ rows, spec }: { rows: Row[]; spec: AiChartSpec }) {
  const data = useMemo(
    () =>
      rows.map((r) => {
        const o: Row = { [spec.x]: r[spec.x] };
        for (const s of spec.series) {
          o[s.field] = toNumber(r[s.field]);
          o[`__raw_${s.field}`] = r[s.field];
        }
        return o;
      }),
    [rows, spec],
  );
  const tick = { fontSize: 12, fill: "var(--ds-text-3)" };
  const common = {
    data,
    margin: { top: 8, right: 0, left: 4, bottom: 0 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--ds-chart-grid)" />
      <XAxis dataKey={spec.x} reversed tickLine={false} axisLine={{ stroke: "var(--ds-chart-axis)" }} tick={tick} minTickGap={12} />
      <YAxis orientation="right" width={52} tickCount={4} axisLine={false} tickLine={false} tickMargin={8} tick={{ ...tick, textAnchor: "start" }} tickFormatter={(v: number) => (v === 0 ? fa(0) : compact(v))} />
      <Tooltip cursor={spec.kind === "bar" ? { fill: "var(--ds-hover)" } : { stroke: "var(--ds-chart-crosshair)" }} content={<ChartTip unit={spec.unit} x={spec.x} />} isAnimationActive={false} />
    </>
  );
  const color = (i: number) => (spec.series.length === 1 ? "var(--ds-accent-line)" : SERIES[i % SERIES.length]);
  return (
    <div className="sa-chart">
      <ResponsiveContainer width="100%" height="100%">
        {spec.kind === "bar" ? (
          <BarChart {...common} barGap={2} barCategoryGap="24%">
            {axes}
            {spec.series.map((s, i) => (
              <Bar key={s.field} dataKey={s.field} name={s.label} fill={color(i)} radius={[4, 4, 0, 0]} maxBarSize={28} animationDuration={500} animationEasing="ease-out" />
            ))}
          </BarChart>
        ) : spec.kind === "area" ? (
          <AreaChart {...common}>
            {axes}
            {spec.series.map((s, i) => (
              <Area key={s.field} type="monotone" dataKey={s.field} name={s.label} stroke={color(i)} strokeWidth={1.75} fill={color(i)} fillOpacity={0.12} dot={false} activeDot={{ r: 3 }} animationDuration={500} />
            ))}
          </AreaChart>
        ) : (
          <LineChart {...common}>
            {axes}
            {spec.series.map((s, i) => (
              <Line key={s.field} type="monotone" dataKey={s.field} name={s.label} stroke={color(i)} strokeWidth={1.75} dot={data.length <= 12 ? { r: 2.5, strokeWidth: 0, fill: color(i) } : false} activeDot={{ r: 3.5 }} animationDuration={500} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

export function ChartCard({ dataRef, spec }: { dataRef: string; spec: AiChartSpec }) {
  const q = useRows(dataRef);
  const [view, setView] = useState<"chart" | "table">("chart");
  const rows = q.data?.rows ?? [];
  const title = spec.title || q.data?.title || "نمودار";
  const temporal = rows.length > 0 && rows.every((r) => TEMPORAL.test(String(r[spec.x] ?? "")));
  const columns = [{ key: spec.x, title: temporal ? "دوره" : "مورد" }, ...spec.series.map((s) => ({ key: s.field, title: s.label, numeric: true }))];
  const ranked = spec.kind === "bar" && spec.series.length === 1 && rows.length > 0 && !temporal;
  const legend = spec.kind !== "pie" && !ranked && spec.series.length > 1;
  const label = `${title}: ${rows
    .slice(0, 12)
    .map((r) => `${String(r[spec.x] ?? "")} ${spec.series.map((s) => figureText(String(r[s.field] ?? 0), 2)).join("، ")}`)
    .join("؛ ")}`;
  return (
    <section className="sa-card" aria-label={title}>
      <CardHead title={title} unit={spec.unit}>
        {rows.length ? (
          <>
            <div className="sa-seg" role="group" aria-label="نمایش">
              <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")} aria-label="نمودار">
                <Ic icon={ChartColumn} size={14} />
              </button>
              <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")} aria-label="جدول">
                <Ic icon={Table2} size={14} />
              </button>
            </div>
            <ExcelButton onExport={() => toExcel(title, columns, rows)} />
          </>
        ) : null}
      </CardHead>
      {q.isLoading ? (
        <Rows n={4} />
      ) : q.isError ? (
        <Failed />
      ) : !rows.length ? (
        <div className="sa-card-note">داده‌ای برای نمودار نیست.</div>
      ) : view === "table" ? (
        <DataTable columns={columns} rows={rows} />
      ) : (
        <div className="sa-card-b" role="img" aria-label={label}>
          {spec.kind === "pie" ? <Donut rows={rows} spec={spec} /> : ranked ? <BarList rows={rows} spec={spec} /> : <AxisChart rows={rows} spec={spec} />}
          {legend ? (
            <div className="sa-legend">
              {spec.series.map((s, i) => (
                <span key={s.field}>
                  <i style={{ background: SERIES[i % SERIES.length] }} />
                  {s.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
