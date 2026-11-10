// «تقویم تغییرات» — the forward schedule of change (CHG-041): a timeline (a week, two or four) and a Jalali month,
// Saturday first, with Fridays and official holidays shaded, maintenance / blackout / freeze windows as bands, the
// changes the person may read as bars packed into lanes (conflicts, blackout and late changes highlighted), active
// lockdowns on top, filters (types, mine, only with conflicts) and the iCalendar feed (CHG-042). The drawing is the
// record kit's (TimelineGrid, the month grid's cells and band chips); the data is the change calendar's own endpoint.
// Clicking a change opens it; keyboard: every bar and chip is a button.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Segmented, Select, Space } from "antd";
import { ChevronRight, ChevronLeft, Plus, CalendarDays, Download, OctagonAlert, TriangleAlert } from "lucide-react";
import { CHANGE_STATES, CHANGE_TYPES } from "@shared/tables/change";
import { addDays, formatJalaliDateTime, fromJalali, toFa, toJalali, todayISO, WEEKDAYS_SHORT } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Loader, EmptyState } from "../../components/display";
import { ICON, ICON14, Note } from "../../components/blocks";
import { recordPath, newRecordPath } from "../../records";
import { TimelineGrid } from "../../records/board/TimelineGrid";
import { bandsOn, monthGrid, shiftMonth, monthTitle, spansOn, windowRange, dayMonthLabel } from "../../records/model/calendar";
import { CHANGE_KEYS, changeApi, type CalendarData } from "./api";
import { SPANS, changeTone, flags, riskLabel, weekStart, windowBandsOf, windowKindLabel, type Row, type Span, type WindowOcc } from "./model";
import "../../records/records.css";
import "./change.css";

const categoryOf = (state: unknown) => CHANGE_STATES.states.find((s) => s.value === state)?.category ?? "new";
const stateLabel = (state: unknown) => CHANGE_STATES.states.find((s) => s.value === state)?.label ?? String(state ?? "");

export default function ChangeCalendar() {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const today = todayISO(timezone);
  const [mode, setMode] = useState<"timeline" | "month">("timeline");
  const [span, setSpan] = useState<Span>("2w");
  const [anchor, setAnchor] = useState(today);
  const [types, setTypes] = useState<string[]>([]);
  const [mine, setMine] = useState(false);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  const days = SPANS.find((s) => s.value === span)!.days;
  const j = toJalali(anchor);
  const grid = useMemo(() => monthGrid(j.jy, j.jm, today), [j.jy, j.jm, today]);
  const from = mode === "timeline" ? weekStart(anchor) : grid[0][0].iso;
  const count = mode === "timeline" ? days : grid.length * 7;
  const range = useMemo(() => windowRange(from, count, timezone), [from, count, timezone]);
  const query = { from: new Date(range.start).toISOString(), to: new Date(range.end).toISOString(), types: types.join(",") || undefined, mine: mine ? "1" : undefined };
  const q = useQuery({ queryKey: CHANGE_KEYS.calendar(orgId, query), queryFn: () => changeApi.calendar(api, query), placeholderData: (prev) => prev });

  const open = (id: string) => nav(`/${orgId}/${recordPath("change_request", id)}`);
  const move = (dir: -1 | 1) => setAnchor(mode === "timeline" ? addDays(anchor, dir * days) : (() => {
    const m = shiftMonth(j.jy, j.jm, dir);
    return toJalaliIso(m.jy, m.jm);
  })());
  const icsHref = `/api/o/${encodeURIComponent(orgId)}/change/calendar.ics?from=${encodeURIComponent(query.from)}&to=${encodeURIComponent(new Date(range.start + 90 * 86_400_000).toISOString())}`;

  const data = q.data;
  const changes = ((data?.changes ?? []) as Row[]).filter((c) => !onlyFlagged || changeTone(c));
  const title = mode === "timeline" ? `${dayMonthLabel(from)} تا ${dayMonthLabel(addDays(from, count - 1))}` : monthTitle(j.jy, j.jm);

  return (
    <div className="chg-cal">
      <PageHeader
        title="تقویم تغییرات"
        actions={
          <Space>
            <Button icon={<Download {...ICON14} />} href={icsHref} aria-label="دریافت تقویم برای Outlook یا Google (iCal)">
              iCal
            </Button>
            <Button type="primary" icon={<Plus {...ICON14} />} onClick={() => nav(`/${orgId}/${newRecordPath("change_request")}`)}>
              تغییر تازه
            </Button>
          </Space>
        }
      />
      <div className="chg-tb" role="toolbar" aria-label="ابزار تقویم">
        <Segmented value={mode} onChange={(v) => setMode(v as "timeline" | "month")} options={[{ value: "timeline", label: "خط زمانی" }, { value: "month", label: "ماه" }]} />
        {mode === "timeline" ? <Segmented value={span} onChange={(v) => setSpan(v as Span)} options={SPANS.map((s) => ({ value: s.value, label: s.label }))} /> : null}
        <Button icon={<ChevronRight {...ICON14} />} aria-label="قبلی" onClick={() => move(-1)} />
        <Button onClick={() => setAnchor(today)}>امروز</Button>
        <Button icon={<ChevronLeft {...ICON14} />} aria-label="بعدی" onClick={() => move(1)} />
        <h2 className="chg-tb-title ds-num">{title}</h2>
        <Select mode="multiple" allowClear placeholder="همهٔ نوع‌ها" value={types} onChange={setTypes} style={{ minWidth: 180 }} options={CHANGE_TYPES.map((o) => ({ value: o.value, label: o.label }))} aria-label="نوع تغییر" />
        <Checkbox checked={mine} onChange={(e) => setMine(e.target.checked)}>
          فقط تغییرهای من و گروه‌هایم
        </Checkbox>
        <Checkbox checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)}>
          فقط تغییرهای نیازمند توجه
        </Checkbox>
      </div>
      <div className="chg-legend" aria-label="راهنمای رنگ‌ها">
        {["maintenance", "blackout", "freeze"].map((k) => (
          <span key={k}>
            <i className="rk-sw" data-k={k} /> {windowKindLabel(k)}
          </span>
        ))}
        <span>
          <i className="rk-sw" data-k="holiday" /> جمعه و تعطیل رسمی
        </span>
        <span className="text-danger">
          <OctagonAlert {...ICON14} /> تداخل یا ممنوعیت
        </span>
        <span className="text-warning">
          <TriangleAlert {...ICON14} /> بیرون از پنجره، دیرهنگام یا متوقف
        </span>
      </div>
      {(data?.lockdowns ?? []).map((l) => (
        <Note key={String(l.id)} tone="danger">
          قرنطینهٔ تغییرات «{String(l.title)}» برقرار است؛ فقط تغییرهای اضطراری اجرا می‌شوند.
        </Note>
      ))}
      {q.isLoading && !data ? (
        <Loader />
      ) : !data ? (
        <EmptyState title="تقویم بارگذاری نشد" />
      ) : mode === "timeline" ? (
        <TimelineGrid
          from={from}
          days={count}
          tz={timezone}
          today={today}
          holidays={data.holidays}
          bands={windowBandsOf(data.windows as WindowOcc[])}
          items={changes.map((c) => ({ id: String(c.id), start: c.planned_start, end: c.planned_end, label: String(c.short_description ?? ""), number: String(c.number ?? ""), category: categoryOf(c.state), tone: changeTone(c), title: tooltip(c, timezone) }))}
          onOpen={open}
          busy={q.isFetching}
          empty={
            <>
              <CalendarDays {...ICON} className="me-1 inline" aria-hidden /> در این بازه تغییری زمان‌بندی نشده است.
            </>
          }
        />
      ) : (
        <Month data={data} changes={changes} grid={grid} today={today} timezone={timezone} onOpen={open} />
      )}
    </div>
  );
}

const toJalaliIso = (jy: number, jm: number): string => fromJalali(jy, jm, 1);

function tooltip(c: Row, tz: string): string {
  return [
    `${c.number} — ${c.short_description}`,
    `${stateLabel(c.state)} · ریسک ${riskLabel(c.risk)}`,
    `${formatJalaliDateTime(c.planned_start, tz)} تا ${formatJalaliDateTime(c.planned_end, tz)}`,
    ...flags(c),
  ].join("\n");
}

function Month({ data, changes, grid, today, timezone, onOpen }: { data: CalendarData; changes: Row[]; grid: ReturnType<typeof monthGrid>; today: string; timezone: string; onOpen: (id: string) => void }) {
  const holidays = new Map(data.holidays.map((h) => [h.date, h]));
  return (
    <div className="rk-cal-grid">
      <div className="rk-cal-wd">
        {WEEKDAYS_SHORT.map((d, i) => (
          <span key={d} className={i === 6 ? "is-off" : undefined}>
            {d}
          </span>
        ))}
      </div>
      {grid.map((week) => (
        <div key={week[0].iso} className="rk-cal-w">
          {week.map((d) => {
            const h = holidays.get(d.iso);
            const dayChanges = spansOn(changes, d.iso, timezone, (c) => c.planned_start, (c) => c.planned_end);
            const wins = bandsOn(data.windows as WindowOcc[], d.iso, timezone).filter((w) => w.kind !== "information");
            return (
              <div key={d.iso} className={["rk-cal-d", d.inMonth ? "" : "is-out", d.weekday === 6 || h ? "is-off" : "", d.today || d.iso === today ? "is-today" : ""].join(" ")}>
                <div className="rk-cal-dh">
                  <span className="rk-cal-dn ds-num">{toFa(d.jd)}</span>
                  {h ? <span className="rk-cal-hol">{h.title}</span> : null}
                </div>
                {wins.slice(0, 2).map((w, i) => (
                  <span key={`${w.window_id}:${i}`} className="rk-cal-band" data-k={w.kind} title={`${windowKindLabel(w.kind)}: ${w.name}`}>
                    {w.name}
                  </span>
                ))}
                <div className="rk-cal-evs">
                  {dayChanges.slice(0, 3).map((c) => (
                    <button key={String(c.id)} type="button" className="chg-cchip" data-tone={changeTone(c) ?? undefined} title={tooltip(c, timezone)} onClick={() => onOpen(String(c.id))}>
                      <span className="ds-ltr text-ink-2">{String(c.number ?? "").replace(/^CHG0*/, "")}</span>
                      <span className="t">{String(c.short_description ?? "")}</span>
                    </button>
                  ))}
                  {dayChanges.length > 3 ? <span className="ds-num text-[12px] text-ink-2">+{toFa(dayChanges.length - 3)} تغییر دیگر</span> : null}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
