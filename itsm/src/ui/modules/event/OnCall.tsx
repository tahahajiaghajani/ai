// «کشیک» — who is on call now and the on-call calendar (catalogue EVT-033/034/040/042): a card per schedule with the
// person on call and until when (the gap in red when nobody is), and for the chosen schedule the final layer on a
// Jalali timeline (Saturday first, Fridays and the official holidays of the schedule's calendar shaded, «now»
// marked) of one, two or four weeks — each person in their own colour, coverage gaps in red — with each rotation
// layer under it, the overrides, the hours per person, «کشیک را برعهده می‌گیرم» (an hour, until tomorrow 8:00 or a
// custom window) and «شیفت‌های من» as iCalendar.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Popover, Segmented, Select, Space } from "antd";
import { ChevronLeft, ChevronRight, Download, UserRoundCheck } from "lucide-react";
import { addDays, formatJalaliDateTime, todayISO, weekday } from "@shared/jalali";
import { RESTRICTIONS } from "@shared/tables/event";
import { zonedTime } from "@shared/flows/schedule";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card, ICON14 } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { recordPath, newRecordPath } from "../../records/extensions";
import { TimelineGrid } from "../../records/board/TimelineGrid";
import { windowRange, dayMonthLabel } from "../../records/model/calendar";
import { EVENT_KEYS, eventApi } from "./api";
import { hoursPerPerson, layerItems, personColor, shiftItems } from "./model";
import "../../records/records.css";
import "./event.css";

const SPANS = [
  { value: 7, label: "یک هفته" },
  { value: 14, label: "دو هفته" },
  { value: 28, label: "چهار هفته" },
];
const restrictionLabel = (r: string) => RESTRICTIONS.find((o) => o.value === r)?.label ?? "";

export default function OnCall() {
  const { api, orgId, timezone } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const qc = useQueryClient();
  const today = todayISO(timezone);
  const [days, setDays] = useState(14);
  const [anchor, setAnchor] = useState(() => addDays(today, -weekday(today)));
  const [picked, setPicked] = useState<string | null>(null);
  const now = useQuery({ queryKey: EVENT_KEYS.oncallNow(orgId), queryFn: () => eventApi.oncallNow(api), refetchInterval: 60_000 });
  const schedule = picked ?? now.data?.items[0]?.schedule_id ?? null;
  const range = useMemo(() => windowRange(anchor, days, timezone), [anchor, days, timezone]);
  const from = new Date(range.start).toISOString();
  const to = new Date(range.end).toISOString();
  const shifts = useQuery({ queryKey: EVENT_KEYS.shifts(orgId, schedule ?? "", from, to), queryFn: () => eventApi.shifts(api, schedule!, from, to), enabled: !!schedule, placeholderData: (p) => p });
  const holidays = useQuery({
    queryKey: ["calendars", orgId, "holidays", anchor, days, shifts.data?.schedule.calendar_id ?? ""],
    queryFn: () => api.get<{ holidays: { date: string; title: string; half?: boolean }[] }>("/calendars/holidays", { from: anchor, to: addDays(anchor, days), ...(shifts.data?.schedule.calendar_id ? { calendar: shifts.data.schedule.calendar_id } : {}) }),
    enabled: !!shifts.data,
    staleTime: 600_000,
  });
  const view = shifts.data;
  const take = async (body: { minutes?: number; start_at?: string; end_at?: string }) => {
    if (!schedule) return;
    try {
      await eventApi.take(api, schedule, body);
      n.ok("کشیک را برعهده گرفتید");
      await qc.invalidateQueries({ queryKey: EVENT_KEYS.all(orgId) });
    } catch (e) {
      n.error(errorText(e));
    }
  };
  // 8:00 tomorrow in the organisation's zone (not the browser's)
  const tomorrow8 = () => new Date(zonedTime(addDays(today, 1), 8 * 60, timezone)).toISOString();
  const icsHref = `/api/o/${encodeURIComponent(orgId)}/event/oncall/mine.ics`;

  return (
    <div className="ev-page">
      <PageHeader
        title="کشیک"
        actions={
          <Space>
            <Button icon={<Download {...ICON14} />} href={icsHref} aria-label="شیفت‌های من برای Outlook یا Google (iCal)">
              شیفت‌های من
            </Button>
            <Button onClick={() => nav(`/${orgId}/${newRecordPath("oncall_schedule")}`)}>برنامهٔ تازه</Button>
          </Space>
        }
      />
      {now.isLoading ? (
        <Loader />
      ) : !now.data?.items.length ? (
        <EmptyState title="برنامهٔ کشیکی تعریف نشده است" description="برای هر تیم یک برنامهٔ کشیک با چرخش‌های آن بسازید." />
      ) : (
        <>
          <section aria-label="اکنون کشیک" className="ev-now">
            {now.data.items.map((s) => (
              <button key={s.schedule_id} type="button" className="ev-now-card" aria-pressed={s.schedule_id === schedule} data-gap={!s.user_id} onClick={() => setPicked(s.schedule_id)}>
                <span className="sub">{s.schedule}{s.group_id ? ` · ${now.data.display[s.group_id] ?? ""}` : ""}</span>
                <span className="who">{s.user_id ? now.data.display[s.user_id] ?? "عضو" : "کسی کشیک نیست"}{s.override ? " (جایگزین)" : ""}</span>
                <span className="sub">{s.until ? `تا ${formatJalaliDateTime(s.until, timezone)}` : ""}</span>
              </button>
            ))}
          </section>
          {schedule ? (
            <Card
              title={view?.schedule.name ?? "برنامه"}
              tools={
                <Space wrap>
                  <Button size="small" type="link" onClick={() => nav(`/${orgId}/${recordPath("oncall_schedule", schedule)}`)}>
                    ویرایش برنامه
                  </Button>
                  {view?.can_take ? (
                    <Dropdown
                      menu={{
                        items: [
                          { key: "1h", label: "یک ساعت", onClick: () => take({ minutes: 60 }) },
                          { key: "4h", label: "چهار ساعت", onClick: () => take({ minutes: 240 }) },
                          { key: "t8", label: "تا فردا ساعت ۸", onClick: () => take({ start_at: new Date().toISOString(), end_at: tomorrow8() }) },
                        ],
                      }}
                    >
                      <Button size="small" type="primary" icon={<UserRoundCheck {...ICON14} />}>
                        کشیک را برعهده می‌گیرم
                      </Button>
                    </Dropdown>
                  ) : null}
                </Space>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="ev-tb" role="toolbar" aria-label="بازهٔ تقویم">
                  <Segmented value={days} onChange={(v) => setDays(Number(v))} options={SPANS} />
                  <Button icon={<ChevronRight {...ICON14} />} aria-label="قبلی" onClick={() => setAnchor(addDays(anchor, -days))} />
                  <Button onClick={() => setAnchor(addDays(today, -weekday(today)))}>این هفته</Button>
                  <Button icon={<ChevronLeft {...ICON14} />} aria-label="بعدی" onClick={() => setAnchor(addDays(anchor, days))} />
                  <span className="ds-num text-[13px] text-ink-2">
                    {dayMonthLabel(anchor)} تا {dayMonthLabel(addDays(anchor, days - 1))}
                  </span>
                  <TakeWindow tz={timezone} today={today} disabled={!view?.can_take} onTake={(start_at, end_at) => void take({ start_at, end_at })} />
                </div>
                {!view ? (
                  <Loader />
                ) : (
                  <>
                    <div className="ev-layer">
                      <h3>کشیک نهایی (با جایگزینی‌ها)</h3>
                      <TimelineGrid from={anchor} days={days} tz={timezone} today={today} holidays={(holidays.data?.holidays ?? []).map((h) => ({ date: h.date, title: h.title, half: h.half }))} items={shiftItems(view)} onOpen={() => undefined} busy={shifts.isFetching} empty="در این بازه چرخشی تعریف نشده است" />
                    </div>
                    {view.gaps.length ? <p className="text-[13px] text-danger">{fa(view.gaps.length)} بازهٔ بی‌کشیک (خلأ پوشش) در این بازه هست؛ با جایگزینی یا چرخش تازه پوشش دهید.</p> : null}
                    {view.layers.map((l) => (
                      <div key={l.rotation_id} className="ev-layer">
                        <h3>
                          لایهٔ {fa(l.layer)}: {l.name} · {restrictionLabel(l.restriction)}
                        </h3>
                        <TimelineGrid from={anchor} days={days} tz={timezone} today={today} holidays={(holidays.data?.holidays ?? []).map((h) => ({ date: h.date, title: h.title, half: h.half }))} items={layerItems(view, l.rotation_id)} onOpen={() => nav(`/${orgId}/${recordPath("oncall_rotation", l.rotation_id)}`)} empty="در این بازه نوبتی ندارد" />
                      </div>
                    ))}
                    <div className="ev-fair" aria-label="ساعت کشیک هر نفر در این بازه">
                      {hoursPerPerson(view).map((h) => (
                        <span key={h.user_id}>
                          <i data-c={personColor(h.user_id)} aria-hidden />
                          {view.display[h.user_id] ?? "عضو"}: <span className="ds-num">{fa(h.hours, 1)}</span> ساعت
                        </span>
                      ))}
                    </div>
                    {view.overrides.length ? (
                      <ul className="flex flex-col gap-1 text-[13px]">
                        {view.overrides.map((o) => (
                          <li key={o.id}>
                            <button type="button" className="ds-link" onClick={() => nav(`/${orgId}/${recordPath("oncall_override", o.id)}`)}>
                              {view.display[o.user_id] ?? "عضو"}
                              {o.replaces_id ? ` به جای ${view.display[o.replaces_id] ?? "عضو"}` : ""}: {formatJalaliDateTime(o.start_at, timezone)} تا {formatJalaliDateTime(o.end_at, timezone)}
                              {o.reason ? ` — ${o.reason}` : ""}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${fa(h)}:۰۰` }));

/** «جایگزینی در بازهٔ دلخواه»: Jalali days and whole hours in the organisation's zone. */
function TakeWindow({ tz, today, disabled, onTake }: { tz: string; today: string; disabled: boolean; onTake: (start: string, end: string) => void }) {
  const [open, setOpen] = useState(false);
  const [fromDay, setFromDay] = useState<string | null>(today);
  const [fromHour, setFromHour] = useState(20);
  const [toDay, setToDay] = useState<string | null>(addDays(today, 1));
  const [toHour, setToHour] = useState(8);
  const start = fromDay ? zonedTime(fromDay, fromHour * 60, tz) : NaN;
  const end = toDay ? zonedTime(toDay, toHour * 60, tz) : NaN;
  const valid = Number.isFinite(start) && Number.isFinite(end) && end > start;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      title="جایگزینی در بازهٔ دلخواه"
      content={
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-6 text-[13px] text-ink-2">از</span>
            <DateInput value={fromDay} onChange={setFromDay} size="small" aria-label="روز شروع" />
            <Select size="small" value={fromHour} onChange={setFromHour} options={HOURS} aria-label="ساعت شروع" className="w-24" />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-6 text-[13px] text-ink-2">تا</span>
            <DateInput value={toDay} onChange={setToDay} size="small" aria-label="روز پایان" />
            <Select size="small" value={toHour} onChange={setToHour} options={HOURS} aria-label="ساعت پایان" className="w-24" />
          </div>
          <Button
            type="primary"
            size="small"
            disabled={!valid}
            onClick={() => {
              onTake(new Date(start).toISOString(), new Date(end).toISOString());
              setOpen(false);
            }}
          >
            ثبت جایگزینی
          </Button>
        </div>
      }
    >
      <Button size="small" disabled={disabled}>
        بازهٔ دلخواه…
      </Button>
    </Popover>
  );
}
