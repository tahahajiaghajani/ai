// CalendarView: records on the Jalali calendar by a date or date-time field (or a start/end pair) — a month grid and
// a week of day columns, Saturday first, Fridays and the organisation's holidays (when the calendar service
// provides them) shaded, today ringed. Drag a record to another day to reschedule it (a date-time keeps its time);
// the same move is in each record's popover («انتقال به») for keyboard and touch. An empty day starts a new record
// on that day. On a phone the month shows dots and the chosen day's records below.
import { useMemo, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { Button, Popover, Segmented, Tooltip } from "antd";
import { ChevronRight, ChevronLeft, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import { WEEKDAYS, WEEKDAYS_SHORT, addDays, formatJalali, formatJalaliDateTime, fromJalali, toFa, toJalali, todayISO } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useIsPhone, useNotify } from "../../lib/hooks";
import { DateInput } from "../../components/inputs";
import { cx } from "../../components/blocks";
import { getHolidaySource, newRecordPath, type Holiday } from "../extensions";
import { useMe, useRecordActions, useRecordList } from "../data/hooks";
import { andAll } from "../model/filter";
import { eventsOn, monthGrid, monthTitle, moveEvent, shiftMonth, startValueFor, toEvents, weekOf, weekTitle, windowFilter, type CalendarEvent, type DayCell } from "../model/calendar";
import { displayText, fieldOf, stateOf, type Schema } from "../model/schema";
import { stateColor } from "../model/colors";
import { isConflict, type RecordRow, type TableMeta } from "../model/types";
import { RecordNo } from "../fields/display";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const MAX_IN_CELL = 3;

export interface CalendarViewProps {
  def: TableMeta;
  schema: Schema;
  /** start field (date or date-time) and optional end field */
  start: string;
  end?: string;
  filter: Cond | null;
  q?: string;
  onOpen: (row: RecordRow) => void;
}

export function CalendarView({ def, schema, start, end, filter, q, onOpen }: CalendarViewProps) {
  const { api, orgId } = useOrg();
  const { tz } = useMe();
  const n = useNotify();
  const nav = useNavigate();
  const phone = useIsPhone();
  const actions = useRecordActions(def.key);
  const startF = fieldOf(def, start);
  const endF = end ? (fieldOf(def, end) ?? null) : null;
  const today = todayISO(tz);
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState<string>(today);
  const j = toJalali(anchor);
  const weeks = useMemo(() => (view === "month" ? monthGrid(j.jy, j.jm, today) : [weekOf(anchor, today)]), [view, j.jy, j.jm, anchor, today]);
  const from = weeks[0][0].iso;
  const to = weeks[weeks.length - 1][6].iso;

  const query = useMemo(
    () => ({
      filter: startF ? andAll(filter, windowFilter(startF, endF, from, to)) : filter,
      q: q || undefined,
      sort: start,
      size: 500,
      fields: [...new Set(["number", def.display, start, ...(end ? [end] : []), ...(def.states ? [def.states.field] : [])])],
      total: false,
    }),
    [filter, startF, endF, from, to, q, start, end, def],
  );
  const list = useRecordList(def.key, query, { enabled: !!startF });
  const holidaySource = getHolidaySource();
  const holidays = useQuery({
    queryKey: ["records-holidays", orgId, from, to],
    queryFn: () => holidaySource!(api, from, to),
    enabled: !!holidaySource,
    staleTime: 24 * 3600_000,
  });
  const holidayMap = useMemo(() => new Map<string, Holiday>((holidays.data ?? []).map((h) => [h.date, h])), [holidays.data]);

  // optimistic reschedules: a record shows on its new day until the list reloads
  const [moved, setMoved] = useState<Map<string, Record<string, string | null>>>(new Map());
  const events = useMemo(() => {
    if (!startF) return [];
    const rows = (list.data?.rows ?? []).map((r) => (moved.has(r.id) ? ({ ...r, ...moved.get(r.id) } as RecordRow) : r));
    return toEvents(rows, startF, endF, tz);
  }, [list.data, moved, startF, endF, tz]);

  if (!startF) return <p className="rk-hint">فیلد تاریخ این تقویم («{start}») در این جدول نیست.</p>;

  const reschedule = async (e: CalendarEvent, day: string) => {
    if (day === e.start) return;
    const data = moveEvent(e, day, startF, endF, tz);
    setMoved((m) => new Map(m).set(e.id, data));
    try {
      await actions.update(e.id, data, e.row.version);
      n.ok(`${e.row.number ?? displayText(def, e.row)} به ${formatJalali(day, { style: "long" })} رفت`);
    } catch (err) {
      if (isConflict(err)) n.warn("این رکورد را کس دیگری تغییر داده است؛ تقویم تازه شد");
      else n.error(err);
    } finally {
      setMoved((m) => {
        const next = new Map(m);
        next.delete(e.id);
        return next;
      });
    }
  };

  const go = (d: number) => {
    if (view === "month") {
      const m = shiftMonth(j.jy, j.jm, d);
      setAnchor(fromJalali(m.jy, m.jm, 1));
    } else setAnchor(addDays(anchor, d * 7));
  };
  const newOn = (day: string) => {
    const p = new URLSearchParams({ [start]: startValueFor(startF.type, day, tz) });
    nav(`/${orgId}/${newRecordPath(def.key)}?${p}`);
  };

  const dayCell = (d: DayCell) => {
    const list = eventsOn(events, d.iso);
    const hol = holidayMap.get(d.iso);
    const off = d.weekday === 6 || !!hol;
    return (
      <div
        key={d.iso}
        role="gridcell"
        className={cx("rk-cal-d", !d.inMonth && "is-out", d.today && "is-today", off && "is-off", d.iso === picked && phone && "is-picked")}
        aria-label={`${WEEKDAYS[d.weekday]} ${formatJalali(d.iso, { style: "long" })}${hol ? `، ${hol.title}` : ""}${list.length ? `، ${faDigits(list.length)} مورد` : ""}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("text/x-record");
          const ev = events.find((x) => x.id === id);
          if (ev) void reschedule(ev, d.iso);
        }}
        onClick={() => phone && setPicked(d.iso)}
      >
        <div className="rk-cal-dh">
          <span className="rk-cal-dn">{faDigits(d.jd)}</span>
          {hol ? <span className="rk-cal-hol" title={hol.title}>{hol.title}</span> : null}
          {def.can.create && !phone ? (
            <Tooltip title="تازه در این روز">
              <button type="button" className="rk-cal-add" aria-label={`تازه در ${formatJalali(d.iso, { style: "long" })}`} onClick={() => newOn(d.iso)}>
                <Plus size={14} strokeWidth={1.4} absoluteStrokeWidth aria-hidden />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {phone ? (
          list.length ? <span className="rk-cal-dots" aria-hidden>{list.slice(0, 3).map((e) => <i key={e.id} data-c={colorOf(def, e.row)} />)}</span> : null
        ) : (
          <div className="rk-cal-evs">
            {(view === "week" ? list : list.slice(0, MAX_IN_CELL)).map((e) => (
              <EventChip key={e.id} e={e} def={def} tz={tz} day={d.iso} onOpen={onOpen} onMove={reschedule} startF={startF.type} />
            ))}
            {view === "month" && list.length > MAX_IN_CELL ? (
              <Popover
                trigger="click"
                rootClassName="ds-glass"
                title={formatJalali(d.iso, { style: "full" })}
                content={
                  <div className="rk-cal-more">
                    {list.map((e) => (
                      <EventChip key={e.id} e={e} def={def} tz={tz} day={d.iso} onOpen={onOpen} onMove={reschedule} startF={startF.type} />
                    ))}
                  </div>
                }
              >
                <button type="button" className="rk-cal-plus">{`+${faDigits(list.length - MAX_IN_CELL)} مورد دیگر`}</button>
              </Popover>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rk-cal" aria-busy={list.isFetching || undefined}>
      <div className="rk-cal-tb">
        <Button type="text" icon={<ChevronRight {...I16} />} onClick={() => go(-1)} aria-label={view === "month" ? "ماه قبل" : "هفتهٔ قبل"} />
        <h2 className="rk-cal-title">{view === "month" ? monthTitle(j.jy, j.jm) : weekTitle(weeks[0])}</h2>
        <Button type="text" icon={<ChevronLeft {...I16} />} onClick={() => go(1)} aria-label={view === "month" ? "ماه بعد" : "هفتهٔ بعد"} />
        <Button size="small" onClick={() => (setAnchor(today), setPicked(today))}>
          امروز
        </Button>
        <span className="rk-grow" />
        <Segmented
          size="small"
          value={view}
          onChange={(v) => setView(v as "month" | "week")}
          options={[
            { value: "month", label: "ماه" },
            { value: "week", label: "هفته" },
          ]}
        />
      </div>
      <div className={cx("rk-cal-grid", view === "week" && "is-week")} role="grid" aria-label={view === "month" ? monthTitle(j.jy, j.jm) : weekTitle(weeks[0])}>
        <div className="rk-cal-wd" role="row">
          {(phone ? WEEKDAYS_SHORT : WEEKDAYS).map((w, i) => (
            <span key={w} role="columnheader" className={cx(i === 6 && "is-off")}>
              {w}
            </span>
          ))}
        </div>
        {weeks.map((w) => (
          <div key={w[0].iso} className="rk-cal-w" role="row">
            {w.map(dayCell)}
          </div>
        ))}
      </div>
      {phone ? (
        <div className="rk-cal-agenda">
          <h3 className="rk-cal-agenda-h">{formatJalali(picked, { style: "full" })}</h3>
          {eventsOn(events, picked).map((e) => (
            <button key={e.id} type="button" className="rk-cal-row" onClick={() => onOpen(e.row)}>
              <i data-c={colorOf(def, e.row)} aria-hidden />
              <RecordNo no={e.row.number ? String(e.row.number) : null} />
              <span>{displayText(def, e.row)}</span>
            </button>
          ))}
          {!eventsOn(events, picked).length ? <p className="rk-hint">در این روز موردی نیست.</p> : null}
          {def.can.create ? (
            <Button size="small" icon={<Plus {...I16} />} onClick={() => newOn(picked)}>
              {def.label} تازه در این روز
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const colorOf = (def: TableMeta, row: RecordRow) => {
  const s = def.states ? stateOf(def, row[def.states.field]) : undefined;
  return stateColor(s?.color, s?.category);
};

function EventChip({ e, def, tz, day, onOpen, onMove, startF }: { e: CalendarEvent; def: TableMeta; tz: string; day: string; onOpen: (r: RecordRow) => void; onMove: (e: CalendarEvent, day: string) => void; startF: string }) {
  const [open, setOpen] = useState(false);
  const time = startF === "datetime" && e.at !== null && e.start === day ? formatJalaliDateTime(new Date(e.at).toISOString(), tz).split(" ")[1] : null;
  const multi = e.start !== e.end;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      rootClassName="ds-glass"
      content={
        <div className="rk-ev-pop">
          <div className="rk-ev-pop-t">
            <RecordNo no={e.row.number ? String(e.row.number) : null} /> {displayText(def, e.row)}
          </div>
          <div className="rk-ev-pop-m">
            {formatJalali(e.start, { style: "long" })}
            {multi ? ` تا ${formatJalali(e.end, { style: "long" })}` : ""}
          </div>
          <label className="rk-lbl">انتقال به</label>
          <DateInput size="small" value={e.start} onChange={(d) => d && (setOpen(false), onMove(e, d))} aria-label="انتقال به تاریخ" />
          <Button size="small" type="primary" onClick={() => (setOpen(false), onOpen(e.row))}>
            باز کردن
          </Button>
        </div>
      }
    >
      <button
        type="button"
        className={cx("rk-ev", multi && "is-multi", e.start !== day && "is-cont")}
        data-c={colorOf(def, e.row)}
        draggable
        onDragStart={(ev) => {
          ev.dataTransfer.setData("text/x-record", e.id);
          ev.dataTransfer.effectAllowed = "move";
        }}
        title={displayText(def, e.row)}
      >
        <i aria-hidden />
        {time ? <span className="rk-ev-time ds-num">{toFa(time)}</span> : null}
        <span className="rk-ev-t">{displayText(def, e.row) || e.row.number}</span>
      </button>
    </Popover>
  );
}
