// TimelineView: records with a start and an end as horizontal bars on a Jalali day scale (two weeks, four weeks or
// three months), packed into lanes so overlapping records never share a row, Fridays and holidays shaded, today
// marked; a bar that continues outside the window says so. Click a bar to open its record. The change and project
// modules build their schedules on it.
import { useMemo, useState } from "react";
import { Button, Segmented, Tooltip } from "antd";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import { JALALI_MONTHS, addDays, formatJalali, toFa, toJalali, todayISO, weekday } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { cx } from "../../components/blocks";
import { getHolidaySource } from "../extensions";
import { useMe, useRecordList } from "../data/hooks";
import { andAll } from "../model/filter";
import { daysBetween, timelineBars, toEvents, windowFilter } from "../model/calendar";
import { displayText, fieldOf, stateOf, type Schema } from "../model/schema";
import { stateColor } from "../model/colors";
import type { RecordRow, TableMeta } from "../model/types";
import { RecordNo } from "../fields/display";
import "../records.css";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const SPANS = { "2w": 14, "4w": 28, "3m": 91 } as const;
type Span = keyof typeof SPANS;

export interface TimelineViewProps {
  def: TableMeta;
  schema: Schema;
  start: string;
  end: string;
  filter: Cond | null;
  q?: string;
  onOpen: (row: RecordRow) => void;
}

export function TimelineView({ def, start, end, filter, q, onOpen }: TimelineViewProps) {
  const { api, orgId } = useOrg();
  const { tz } = useMe();
  const today = todayISO(tz);
  const [span, setSpan] = useState<Span>("4w");
  const [from, setFrom] = useState(() => addDays(today, -weekday(today) - 7));
  const days = SPANS[span];
  const to = addDays(from, days - 1);
  const startF = fieldOf(def, start);
  const endF = fieldOf(def, end) ?? null;
  const query = useMemo(
    () => ({
      filter: startF ? andAll(filter, windowFilter(startF, endF, from, to)) : filter,
      q: q || undefined,
      sort: start,
      size: 500,
      fields: [...new Set(["number", def.display, start, end, ...(def.states ? [def.states.field] : [])])],
      total: false,
    }),
    [filter, startF, endF, from, to, q, start, end, def],
  );
  const list = useRecordList(def.key, query, { enabled: !!startF });
  const holidaySource = getHolidaySource();
  const holidays = useQuery({ queryKey: ["records-holidays", orgId, from, to], queryFn: () => holidaySource!(api, from, to), enabled: !!holidaySource, staleTime: 24 * 3600_000 });
  const off = useMemo(() => new Set((holidays.data ?? []).map((h) => h.date)), [holidays.data]);
  const scale = useMemo(() => daysBetween(from, to), [from, to]);
  const { bars, lanes } = useMemo(() => (startF ? timelineBars(toEvents(list.data?.rows ?? [], startF, endF, tz), from, to) : { bars: [], lanes: 0 }), [list.data, startF, endF, tz, from, to]);

  if (!startF) return <p className="rk-hint">فیلد شروع این خط زمانی («{start}») در این جدول نیست.</p>;
  const months = groupMonths(scale);
  const wide = days > 40;
  return (
    <div className="rk-tl" aria-busy={list.isFetching || undefined}>
      <div className="rk-cal-tb">
        <Button type="text" icon={<ChevronRight {...I16} />} onClick={() => setFrom(addDays(from, -Math.round(days / 2)))} aria-label="عقب‌تر" />
        <h2 className="rk-cal-title">
          {formatJalali(from, { style: "long" })} تا {formatJalali(to, { style: "long" })}
        </h2>
        <Button type="text" icon={<ChevronLeft {...I16} />} onClick={() => setFrom(addDays(from, Math.round(days / 2)))} aria-label="جلوتر" />
        <Button size="small" onClick={() => setFrom(addDays(today, -weekday(today) - 7))}>
          امروز
        </Button>
        <span className="rk-grow" />
        <Segmented
          size="small"
          value={span}
          onChange={(v) => setSpan(v as Span)}
          options={[
            { value: "2w", label: "دو هفته" },
            { value: "4w", label: "چهار هفته" },
            { value: "3m", label: "سه ماه" },
          ]}
        />
      </div>
      <div className="rk-tl-scroll">
        <div className={cx("rk-tl-grid", wide && "is-wide")} style={{ ["--rk-days" as string]: String(days) }}>
          <div className="rk-tl-months" aria-hidden>
            {months.map((m) => (
              <span key={m.key} style={{ gridColumn: `${m.offset + 1} / span ${m.span}` }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="rk-tl-days" aria-hidden>
            {scale.map((d, i) => (
              <span key={d} className={cx(weekday(d) === 6 || off.has(d) ? "is-off" : undefined, d === today && "is-today")} style={{ gridColumn: i + 1 }}>
                {wide && toJalali(d).jd % 7 !== 1 ? "" : faDigits(toJalali(d).jd)}
              </span>
            ))}
          </div>
          <div className="rk-tl-body" style={{ gridTemplateRows: `repeat(${Math.max(lanes, 1)}, var(--rk-tl-row))` }}>
            {scale.map((d, i) => (weekday(d) === 6 || off.has(d) || d === today ? <i key={d} className={cx("rk-tl-shade", d === today && "is-today")} style={{ gridColumn: i + 1, gridRow: `1 / span ${Math.max(lanes, 1)}` }} aria-hidden /> : null))}
            {bars.map((b) => {
              const s = def.states ? stateOf(def, b.event.row[def.states.field]) : undefined;
              const label = displayText(def, b.event.row);
              return (
                <Tooltip key={b.event.id} title={`${b.event.row.number ?? ""} ${label} — ${formatJalali(b.event.start, { style: "long" })} تا ${formatJalali(b.event.end, { style: "long" })}`} mouseEnterDelay={0.4}>
                  <button
                    type="button"
                    className={cx("rk-bar", b.clippedStart && "is-cs", b.clippedEnd && "is-ce")}
                    data-c={stateColor(s?.color, s?.category)}
                    style={{ gridColumn: `${b.offset + 1} / span ${b.span}`, gridRow: b.lane + 1 }}
                    onClick={() => onOpen(b.event.row)}
                  >
                    <RecordNo no={b.event.row.number ? String(b.event.row.number) : null} />
                    <span className="rk-bar-t">{label}</span>
                  </button>
                </Tooltip>
              );
            })}
          </div>
          {!list.isLoading && !bars.length ? <p className="rk-tl-empty">در این بازه موردی نیست.</p> : null}
        </div>
      </div>
    </div>
  );
}

function groupMonths(days: string[]): { key: string; label: string; offset: number; span: number }[] {
  const out: { key: string; label: string; offset: number; span: number }[] = [];
  days.forEach((d, i) => {
    const j = toJalali(d);
    const key = `${j.jy}-${j.jm}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.span++;
    else out.push({ key, label: `${JALALI_MONTHS[j.jm - 1]} ${toFa(j.jy)}`, offset: i, span: 1 });
  });
  return out;
}
