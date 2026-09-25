"use client";
import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { JALALI_MONTHS, WEEKDAYS_SHORT, jWeekday, jalaliToIso, monthLength, toJDate, todayJalali, type JDate } from "@/lib/jalali";
import { cn, faNum } from "@/lib/utils";
import { Pop } from "./overlays";

function isoToJ(iso: string | null | undefined): JDate | null {
  if (!iso) return null;
  return toJDate(iso.slice(0, 10));
}

/** Persian (Jalali) date picker. Value/onChange use ISO "YYYY-MM-DD". */
export function JalaliDatePicker({
  value,
  onChange,
  placeholder = "انتخاب تاریخ",
  min,
}: {
  value: string | null | undefined;
  onChange: (iso: string | null) => void;
  placeholder?: string;
  min?: string | null;
}) {
  const selected = isoToJ(value);
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<{ jy: number; jm: number }>(() => {
    const base = selected ?? todayJalali();
    return { jy: base.jy, jm: base.jm };
  });
  const today = todayJalali();

  React.useEffect(() => {
    if (open && selected) setView({ jy: selected.jy, jm: selected.jm });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const days = monthLength(view.jy, view.jm);
  const offset = jWeekday({ jy: view.jy, jm: view.jm, jd: 1 });
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  const move = (delta: number) => {
    let jm = view.jm + delta;
    let jy = view.jy;
    if (jm < 1) {
      jm = 12;
      jy--;
    }
    if (jm > 12) {
      jm = 1;
      jy++;
    }
    setView({ jy, jm });
  };

  const label = selected ? `${faNum(selected.jd)} ${JALALI_MONTHS[selected.jm - 1]} ${faNum(selected.jy)}` : placeholder;

  return (
    <Pop
      open={open}
      onOpenChange={setOpen}
      className="w-[300px]"
      trigger={
        <button
          type="button"
          className={cn(
            "flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface-strong px-3.5 text-sm transition hover:border-line-strong focus:outline-none focus:ring-4 focus:ring-[var(--ring)]",
            !selected && "text-faint",
          )}
        >
          <CalendarDays className="size-4 text-muted" />
          <span className="flex-1 text-start">{label}</span>
          {selected ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="rounded-md p-0.5 text-muted hover:text-danger"
            >
              <X className="size-3.5" />
            </span>
          ) : null}
        </button>
      }
    >
      <div className="select-none">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" onClick={() => move(-1)} className="rounded-lg p-1.5 hover:bg-surface-muted" aria-label="ماه قبل">
            <ChevronRight className="size-4" />
          </button>
          <div className="text-sm font-bold">
            {JALALI_MONTHS[view.jm - 1]} {faNum(view.jy)}
          </div>
          <button type="button" onClick={() => move(1)} className="rounded-lg p-1.5 hover:bg-surface-muted" aria-label="ماه بعد">
            <ChevronLeft className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
          {WEEKDAYS_SHORT.map((d) => (
            <div key={d} className="py-1 font-semibold">
              {d}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const j = { jy: view.jy, jm: view.jm, jd: d };
            const iso = jalaliToIso(j);
            const isSel = selected && selected.jy === j.jy && selected.jm === j.jm && selected.jd === d;
            const isToday = today.jy === j.jy && today.jm === j.jm && today.jd === d;
            const disabled = !!min && iso < min;
            const weekend = (offset + d - 1) % 7 === 6;
            return (
              <button
                key={i}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onChange(iso);
                  setOpen(false);
                }}
                className={cn(
                  "aspect-square rounded-xl text-sm transition hover:bg-primary-soft disabled:opacity-30",
                  weekend && "text-danger/80",
                  isToday && "ring-1 ring-primary",
                  isSel && "bg-gradient-brand font-bold text-white hover:bg-none",
                )}
              >
                {faNum(d)}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex justify-between border-t border-line pt-2">
          <button
            type="button"
            className="text-xs font-semibold text-primary"
            onClick={() => {
              onChange(jalaliToIso(today));
              setOpen(false);
            }}
          >
            امروز
          </button>
          <button type="button" className="text-xs text-muted" onClick={() => setOpen(false)}>
            بستن
          </button>
        </div>
      </div>
    </Pop>
  );
}

/** Date + time (Tehran) for events; value is an ISO timestamp. */
export function JalaliDateTimePicker({ value, onChange }: { value: string | null | undefined; onChange: (iso: string | null) => void }) {
  const date = value ? new Date(value) : null;
  const tehran = date
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date)
    : null;
  const part = (t: string) => tehran?.find((p) => p.type === t)?.value ?? "";
  const isoDate = tehran ? `${part("year")}-${part("month")}-${part("day")}` : null;
  const time = tehran ? `${part("hour")}:${part("minute")}` : "09:00";

  const emit = (d: string | null, t: string) => {
    if (!d) return onChange(null);
    onChange(`${d}T${t || "09:00"}:00+03:30`);
  };

  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <JalaliDatePicker value={isoDate} onChange={(d) => emit(d, time)} placeholder="تاریخ رویداد" />
      </div>
      <input
        type="time"
        value={time}
        onChange={(e) => emit(isoDate, e.target.value)}
        className="ltr h-11 w-28 rounded-xl border border-line bg-surface-strong px-3 text-sm focus:border-primary focus:outline-none focus:ring-4 focus:ring-[var(--ring)]"
      />
    </div>
  );
}
