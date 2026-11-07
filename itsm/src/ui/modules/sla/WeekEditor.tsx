// «ساعات کاری» of a working calendar: seven days (Saturday first), each with its working intervals — add, remove, copy
// a day to the working days or to every day, ready-made weeks — a 24-hour bar per day (an overnight shift runs into
// the next morning), the hours of each day and of the week, and the next two weeks as the calendar counts them with
// the organisation's holidays. Saves the calendar's `hours` (checked as the server checks them).
import { useEffect, useMemo, useState } from "react";
import { Button, Dropdown, Input } from "antd";
import { Plus, X, Copy, Save, RotateCcw, LayoutTemplate } from "lucide-react";
import { addDays, formatJalali, todayISO, toFa, WEEKDAYS } from "@shared/jalali";
import { formatTime, parseTime } from "@shared/sla/calendar";
import { Chip } from "../../components/display";
import { ICON14, cx } from "../../components/blocks";
import type { RecordContext } from "../../records";
import { useCalendarSpec } from "./api";
import { copyDayTo, dayBars, dayProblem, minutesText, nextInterval, normalizeTime, upcomingDays, WEEK_PRESETS, weekDraft, weekTotals, withDay, type Interval, type WeekDraft } from "./model";

const WORKDAYS = [0, 1, 2, 3, 4];
const TICKS = [0, 6, 12, 18, 24];

/** The week as stored: every time "HH:MM". */
const stored = (week: WeekDraft): [string, string][][] =>
  week.map((day) => day.map(([a, b]) => [formatTime(parseTime(a) ?? 0), formatTime(parseTime(b) ?? 0)] as [string, string]));

function DayBar({ week, d }: { week: WeekDraft; d: number }) {
  const bars = dayBars(week, d);
  return (
    <div className="relative h-2.5 w-full rounded-full bg-sunken" aria-hidden>
      {bars.map((b, i) => (
        <span
          key={i}
          className={cx("absolute inset-y-0 rounded-full", b.carry ? "bg-[var(--ds-text-3)] opacity-60" : "bg-accent")}
          style={{ insetInlineStart: `${b.from}%`, width: `${Math.max(0.6, b.to - b.from)}%` }}
        />
      ))}
    </div>
  );
}

function TimeBox({ value, onChange, label, disabled }: { value: string; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  const bad = parseTime(value) === null;
  return (
    <Input
      size="small"
      dir="ltr"
      className="ds-num w-[68px] text-center"
      value={value}
      placeholder="08:00"
      aria-label={label}
      status={bad ? "error" : undefined}
      disabled={disabled}
      maxLength={5}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onChange(normalizeTime(e.target.value))}
    />
  );
}

export default function WeekEditor({ ctx }: { ctx: RecordContext }) {
  const tz = String(ctx.row.timezone || "Asia/Tehran");
  const saved = useMemo(() => weekDraft(ctx.row.hours), [ctx.row.hours]);
  const [week, setWeek] = useState<WeekDraft>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setWeek(saved), [saved]);
  const canEdit = ctx.meta.canWrite && !ctx.meta.locked;
  const dirty = JSON.stringify(week) !== JSON.stringify(saved);
  const problems = week.map(dayProblem);
  const valid = problems.every((p) => !p);
  const totals = weekTotals(week);
  const today = todayISO(tz);
  const spec = useCalendarSpec(ctx.row.id, today, addDays(today, 14));
  const upcoming = useMemo(() => upcomingDays(week, tz, spec.data?.holidays ?? [], today, 14), [week, tz, spec.data, today]);

  const setInterval = (d: number, i: number, k: 0 | 1, v: string) => setWeek((w) => withDay(w, d, w[d].map((p, j) => (j === i ? ((k === 0 ? [v, p[1]] : [p[0], v]) as Interval) : p))));
  const save = async () => {
    setSaving(true);
    await ctx.save({ hours: stored(week) });
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-ink-2">
          جمع هفته: <span className="text-ink">{minutesText(totals.total)}</span>
        </span>
        {canEdit ? (
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Dropdown menu={{ items: WEEK_PRESETS.map((p) => ({ key: p.key, label: p.label, onClick: () => setWeek(weekDraft(p.hours)) })) }}>
              <Button size="small" icon={<LayoutTemplate {...ICON14} />}>
                الگوی آماده
              </Button>
            </Dropdown>
            <Button size="small" icon={<RotateCcw {...ICON14} />} disabled={!dirty} onClick={() => setWeek(saved)}>
              بازگردانی
            </Button>
            <Button size="small" type="primary" icon={<Save {...ICON14} />} disabled={!dirty || !valid} loading={saving} onClick={() => void save()}>
              ذخیرهٔ ساعات
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col divide-y divide-[var(--ds-line)] rounded-lg border border-line bg-surface">
        <div className="hidden items-center gap-3 px-3 py-1.5 sm:flex" aria-hidden>
          <span className="w-24 shrink-0" />
          <span className="flex-1" />
          <div className="relative w-40 shrink-0 text-[11px] text-ink-3 md:w-56">
            {TICKS.map((h) => (
              <span key={h} className="ds-num absolute -translate-x-1/2 rtl:translate-x-1/2" style={{ insetInlineStart: `${(h / 24) * 100}%` }}>
                {toFa(h)}
              </span>
            ))}
          </div>
          <span className="w-24 shrink-0" />
        </div>
        {week.map((day, d) => {
          const room = nextInterval(day);
          return (
            <div key={d} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3">
              <span className={cx("w-24 shrink-0 pt-0.5 text-[13px]", day.length ? "text-ink" : "text-ink-3")}>{WEEKDAYS[d]}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {day.length ? (
                  day.map((p, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-1.5">
                      <TimeBox value={p[0]} onChange={(v) => setInterval(d, i, 0, v)} label={`${WEEKDAYS[d]}، شروع بازهٔ ${toFa(i + 1)}`} disabled={!canEdit} />
                      <span className="text-ink-3">تا</span>
                      <TimeBox value={p[1]} onChange={(v) => setInterval(d, i, 1, v)} label={`${WEEKDAYS[d]}، پایان بازهٔ ${toFa(i + 1)}`} disabled={!canEdit} />
                      {(parseTime(p[1]) ?? 0) <= (parseTime(p[0]) ?? 0) && parseTime(p[1]) !== null && parseTime(p[1]) !== 0 ? (
                        <Chip dot={false}>تا بامداد روز بعد</Chip>
                      ) : null}
                      {canEdit ? (
                        <Button
                          size="small"
                          type="text"
                          aria-label="حذف بازه"
                          icon={<X {...ICON14} />}
                          onClick={() => setWeek((w) => withDay(w, d, w[d].filter((_, j) => j !== i)))}
                        />
                      ) : null}
                    </div>
                  ))
                ) : (
                  <span className="pt-0.5 text-[13px] text-ink-3">تعطیل</span>
                )}
                {problems[d] ? <span className="text-[12px] text-danger">{problems[d]}</span> : null}
                {canEdit ? (
                  <div className="flex flex-wrap gap-1">
                    <Button size="small" type="text" icon={<Plus {...ICON14} />} disabled={!room} onClick={() => room && setWeek((w) => withDay(w, d, [...w[d], room]))}>
                      بازه
                    </Button>
                    <Dropdown
                      menu={{
                        items: [
                          { key: "work", label: "کپی برای شنبه تا چهارشنبه", onClick: () => setWeek((w) => copyDayTo(w, d, WORKDAYS)) },
                          { key: "all", label: "کپی برای همهٔ روزها", onClick: () => setWeek((w) => copyDayTo(w, d, [0, 1, 2, 3, 4, 5, 6])) },
                        ],
                      }}
                    >
                      <Button size="small" type="text" icon={<Copy {...ICON14} />}>
                        کپی
                      </Button>
                    </Dropdown>
                  </div>
                ) : null}
              </div>
              <div className="w-full shrink-0 pt-1.5 sm:w-40 md:w-56">
                <DayBar week={week} d={d} />
              </div>
              <span className="w-24 shrink-0 pt-0.5 text-[13px] text-ink-2 sm:text-end">{minutesText(totals.perDay[d])}</span>
            </div>
          );
        })}
      </div>

      <section className="flex flex-col gap-2" aria-label="دو هفتهٔ پیش رو">
        <span className="ds-t-label text-ink-2">دو هفتهٔ پیش رو</span>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
          {upcoming.map((u) => (
            <div key={u.date} className={cx("flex flex-col gap-0.5 rounded-md border border-line px-2 py-1.5 text-[12px]", u.holiday && !u.holiday.half ? "bg-sunken" : "bg-surface")}>
              <span className="flex items-baseline justify-between gap-1">
                <span className="text-ink-2">{u.weekday}</span>
                <span className="ds-num text-ink-3">{formatJalali(u.date, { style: "short" })}</span>
              </span>
              {u.holiday ? <span className={cx("truncate", u.holiday.half ? "text-ink-2" : "text-holiday")} title={u.holiday.title}>{u.holiday.half ? "نیمه‌تعطیل" : u.holiday.title || "تعطیل"}</span> : null}
              <span className={u.minutes ? "text-ink" : "text-ink-3"}>{u.minutes ? minutesText(u.minutes) : "بدون ساعت کاری"}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
