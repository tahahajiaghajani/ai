// TimelineView: records with a start and an end as bars on a Jalali timeline (two weeks, four weeks or three months),
// positioned to the minute (dates cover their days whole), packed into lanes so overlapping records never share a row,
// Fridays and holidays shaded, today marked, background bands (a module's windows, outages…) and a tone per record (an
// outline and an icon for what needs attention) — from the props or the table's registered calendar decoration. A bar
// that continues outside the window says so. Click a bar to open its record. The drawing is TimelineGrid.
import { useMemo, useState } from "react";
import { Button, Segmented } from "antd";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import { addDays, formatJalali, formatJalaliDateTime, todayISO, weekday } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { calendarDecorOf, getHolidaySource, type BandSource } from "../extensions";
import { useMe, useRecordList } from "../data/hooks";
import { andAll } from "../model/filter";
import { eventSpan, toEvents, windowFilter, type CalendarTone } from "../model/calendar";
import { displayText, fieldOf, stateOf, type Schema } from "../model/schema";
import { stateColor } from "../model/colors";
import type { RecordRow, TableMeta } from "../model/types";
import { TimelineGrid, type TimelineItem } from "./TimelineGrid";
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
  /** background bands of the window (default: the table's calendar decoration) */
  bands?: BandSource;
  /** what needs attention on a record (default: the table's calendar decoration) */
  tone?: (row: RecordRow) => CalendarTone | null;
  /** further fields the tone reads */
  fields?: string[];
}

export function TimelineView({ def, start, end, filter, q, onOpen, ...props }: TimelineViewProps) {
  const { api, orgId } = useOrg();
  const { tz } = useMe();
  const decor = calendarDecorOf(def.key);
  const bandSource = props.bands ?? decor.bands;
  const tone = props.tone ?? decor.tone;
  const extra = props.fields ?? decor.fields;
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
      fields: [...new Set(["number", def.display, start, end, ...(def.states ? [def.states.field] : []), ...(extra ?? [])])],
      total: false,
    }),
    [filter, startF, endF, from, to, q, start, end, def, extra],
  );
  const list = useRecordList(def.key, query, { enabled: !!startF });
  const holidaySource = getHolidaySource();
  const holidays = useQuery({ queryKey: ["records-holidays", orgId, from, to], queryFn: () => holidaySource!(api, from, to), enabled: !!holidaySource, staleTime: 24 * 3600_000 });
  const bands = useQuery({ queryKey: ["records-bands", orgId, bandSource?.key, from, to], queryFn: () => bandSource!.load(api, { from, to }), enabled: !!bandSource, staleTime: 5 * 60_000 });
  const rows = list.data?.rows;
  const items = useMemo<TimelineItem[]>(() => {
    if (!startF) return [];
    const at = (ms: number) => formatJalaliDateTime(new Date(ms).toISOString(), tz);
    return toEvents(rows ?? [], startF, endF, tz).map((e) => {
      const s = def.states ? stateOf(def, e.row[def.states.field]) : undefined;
      const label = displayText(def, e.row) || String(e.row.number ?? "");
      const sp = eventSpan(e, startF, endF, tz);
      const from = startF.type === "datetime" ? at(sp.start) : formatJalali(e.start, { style: "long" });
      const until = endF?.type === "datetime" ? at(sp.end) : formatJalali(e.end, { style: "long" });
      const title = `${e.row.number ? `${e.row.number} — ` : ""}${label}\n${from} تا ${until}`;
      return { id: e.id, start: sp.start, end: sp.end, label, number: e.row.number ? String(e.row.number) : null, color: stateColor(s?.color, s?.category), category: s?.category, tone: tone?.(e.row) ?? null, title };
    });
  }, [rows, startF, endF, tz, def, tone]);

  if (!startF) return <p className="rk-hint">فیلد شروع این خط زمانی («{start}») در این جدول نیست.</p>;
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
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
      <TimelineGrid
        from={from}
        days={days}
        tz={tz}
        today={today}
        holidays={holidays.data ?? []}
        bands={bands.data ?? []}
        items={items}
        busy={list.isLoading}
        onOpen={(id) => {
          const r = byId.get(id);
          if (r) onOpen(r);
        }}
      />
    </div>
  );
}
