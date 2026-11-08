// «تقویم تغییرات» — the forward schedule of change (CHG-041): a timeline (a week, two or four) and a Jalali month,
// Saturday first, with Fridays and official holidays shaded, maintenance / blackout / freeze windows as bands, the
// changes the person may read as bars packed into lanes (conflicts, blackout and late changes highlighted), active
// lockdowns on top, filters (types, mine, only with conflicts) and the iCalendar feed (CHG-042). Clicking a change
// opens it; keyboard: every bar and chip is a button.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Segmented, Select, Space, Tooltip } from "antd";
import { ChevronRight, ChevronLeft, Plus, CalendarDays, Download, OctagonAlert, TriangleAlert } from "lucide-react";
import { CHANGE_STATES, CHANGE_TYPES } from "@shared/tables/change";
import { addDays, formatJalaliDateTime, fromJalali, toFa, toJalali, todayISO, JALALI_MONTHS, WEEKDAYS_SHORT } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { Loader, EmptyState } from "../../components/display";
import { ICON, ICON14, Note } from "../../components/blocks";
import { recordPath, newRecordPath } from "../../records";
import { monthGrid, shiftMonth, monthTitle } from "../../records/model/calendar";
import { CHANGE_KEYS, changeApi, type CalendarData } from "./api";
import { SPANS, changeTone, changesOn, daysOf, flags, placeBars, rangeMs, riskLabel, weekStart, windowBands, windowKindLabel, windowsOn, type Row, type Span, type WindowOcc } from "./model";
import "../../records/records.css";
import "./change.css";

const LANE = 32;
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
  const range = useMemo(() => rangeMs(from, count, timezone), [from, count, timezone]);
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
  const title = mode === "timeline" ? `${formatDay(from)} تا ${formatDay(addDays(from, count - 1))}` : monthTitle(j.jy, j.jm);

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
            <i className="chg-sw" data-k={k} /> {windowKindLabel(k)}
          </span>
        ))}
        <span>
          <i className="chg-sw" data-k="holiday" /> جمعه و تعطیل رسمی
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
        <Timeline data={data} changes={changes} from={from} days={count} range={range} today={today} timezone={timezone} onOpen={open} />
      ) : (
        <Month data={data} changes={changes} grid={grid} today={today} timezone={timezone} onOpen={open} />
      )}
    </div>
  );
}

const toJalaliIso = (jy: number, jm: number): string => fromJalali(jy, jm, 1);

function formatDay(iso: string): string {
  const j = toJalali(iso);
  return `${toFa(j.jd)} ${JALALI_MONTHS[j.jm - 1]}`;
}

function tooltip(c: Row, tz: string): string {
  return [
    `${c.number} — ${c.short_description}`,
    `${stateLabel(c.state)} · ریسک ${riskLabel(c.risk)}`,
    `${formatJalaliDateTime(c.planned_start, tz)} تا ${formatJalaliDateTime(c.planned_end, tz)}`,
    ...flags(c),
  ].join("\n");
}

function Timeline({ data, changes, from, days, range, today, timezone, onOpen }: { data: CalendarData; changes: Row[]; from: string; days: number; range: { start: number; end: number }; today: string; timezone: string; onOpen: (id: string) => void }) {
  const ds = daysOf(from, days, data.holidays, today);
  const bands = windowBands(data.windows as WindowOcc[], range);
  const { bars, lanes } = placeBars(changes, range, (c) => c.planned_start, (c) => c.planned_end);
  const now = Date.now();
  const nowLeft = now > range.start && now < range.end ? ((now - range.start) / (range.end - range.start)) * 100 : null;
  return (
    <div className="chg-tl" style={{ ["--chg-days" as string]: days }}>
      <div className="chg-tl-in">
        <div className="chg-tl-head">
          {ds.map((d) => (
            <span key={d.iso} className={[d.friday || d.holiday ? "is-off" : "", d.today ? "is-today" : ""].join(" ")} title={d.holiday ?? undefined}>
              {d.jd === 1 || d.iso === from ? <b>{JALALI_MONTHS[d.jm - 1]}</b> : null}
              <span>{WEEKDAYS_SHORT[d.weekday]}</span>
              <span className="ds-num">{toFa(d.jd)}</span>
            </span>
          ))}
        </div>
        <div className="chg-tl-body" style={{ minBlockSize: Math.max(96, 28 + lanes * LANE) }}>
          <div className="chg-tl-cols" aria-hidden>
            {ds.map((d) => (
              <i key={d.iso} className={d.friday || d.holiday ? "is-off" : undefined} />
            ))}
          </div>
          {bands.map((b, i) => (
            <Tooltip key={`${b.item.window_id}:${b.item.start}:${i}`} title={`${windowKindLabel(b.item.kind)}: ${b.item.name}${b.item.enforcement === "warn" ? " (فقط هشدار)" : ""}`}>
              <div className="chg-tl-band" data-k={b.item.kind} style={{ insetInlineStart: `${b.left}%`, inlineSize: `${b.width}%` }}>
                <span>{b.item.name}</span>
              </div>
            </Tooltip>
          ))}
          {nowLeft !== null ? <div className="chg-tl-now" style={{ insetInlineStart: `${nowLeft}%` }} aria-hidden /> : null}
          {bars.map((b) => {
            const c = b.item;
            const tone = changeTone(c);
            return (
              <Tooltip key={String(c.id)} title={<span style={{ whiteSpace: "pre-line" }}>{tooltip(c, timezone)}</span>}>
                <button
                  type="button"
                  className={`chg-tl-bar${b.clippedStart ? " is-clip-s" : ""}${b.clippedEnd ? " is-clip-e" : ""}`}
                  data-tone={tone ?? undefined}
                  data-cat={categoryOf(c.state)}
                  style={{ insetInlineStart: `${b.left}%`, inlineSize: `${b.width}%`, insetBlockStart: 22 + b.lane * LANE }}
                  onClick={() => onOpen(String(c.id))}
                  aria-label={tooltip(c, timezone).replace(/\n/g, "، ")}
                >
                  {tone === "danger" ? <OctagonAlert {...ICON14} className="shrink-0 text-danger" aria-hidden /> : tone === "warning" ? <TriangleAlert {...ICON14} className="shrink-0 text-warning" aria-hidden /> : null}
                  <span className="ds-ltr shrink-0 text-ink-2">{String(c.number ?? "")}</span>
                  <span className="t">{String(c.short_description ?? "")}</span>
                </button>
              </Tooltip>
            );
          })}
          {!bars.length ? (
            <p className="chg-tl-empty">
              <CalendarDays {...ICON} className="me-1 inline" aria-hidden /> در این بازه تغییری زمان‌بندی نشده است.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
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
            const dayChanges = changesOn(changes, d.iso, timezone);
            const wins = windowsOn(data.windows as WindowOcc[], d.iso, timezone).filter((w) => w.kind !== "information");
            return (
              <div key={d.iso} className={["rk-cal-d", d.inMonth ? "" : "is-out", d.weekday === 6 || h ? "is-off" : "", d.today || d.iso === today ? "is-today" : ""].join(" ")}>
                <div className="rk-cal-dh">
                  <span className="rk-cal-dn ds-num">{toFa(d.jd)}</span>
                  {h ? <span className="rk-cal-hol">{h.title}</span> : null}
                </div>
                {wins.slice(0, 2).map((w, i) => (
                  <span key={`${w.window_id}:${i}`} className="chg-wchip" data-k={w.kind} title={`${windowKindLabel(w.kind)}: ${w.name}`}>
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
