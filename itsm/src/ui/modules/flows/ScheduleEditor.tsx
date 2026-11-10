// «تکرار»: Jalali-friendly presets (every day, workdays, the first or last day of each Jalali month, each season,
// Nowruz…) or a custom schedule — daily, on days of the Persian week, on days of Jalali months, yearly, at an interval,
// once, or a cron expression — with the Persian sentence and the next occurrence under it.
import { useMemo } from "react";
import { Checkbox, Input, Select, Segmented } from "antd";
import { JALALI_MONTHS, WEEKDAYS } from "@shared/jalali";
import { SCHEDULE_PRESETS, describeSchedule, nextOccurrence, scheduleKey, scheduleProblem, type ScheduleSpec } from "@shared/flows";
import { formatJalaliDateTime } from "@shared/jalali";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { DateTimeInput } from "../../records";

const KINDS: { value: ScheduleSpec["kind"]; label: string }[] = [
  { value: "daily", label: "روزانه" },
  { value: "weekly", label: "هفتگی" },
  { value: "monthly", label: "ماهانه" },
  { value: "yearly", label: "سالانه" },
  { value: "interval", label: "هر چند" },
  { value: "once", label: "یک بار" },
  { value: "cron", label: "cron" },
];

function blank(kind: ScheduleSpec["kind"], prev: ScheduleSpec | null): ScheduleSpec {
  const time = prev && "time" in prev ? prev.time : "08:00";
  switch (kind) {
    case "daily":
      return { kind, time };
    case "weekly":
      return { kind, time, weekdays: [0, 1, 2, 3, 4] };
    case "monthly":
      return { kind, time, days: [1] };
    case "yearly":
      return { kind, time, month: 1, day: 1 };
    case "interval":
      return { kind, every: 1, unit: "hour" };
    case "once":
      return { kind, at: new Date(Date.now() + 86_400_000).toISOString() };
    case "cron":
      return { kind, expr: "0 8 * * 6" };
  }
}

const num = (s: string) => Number(s.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))));

export function ScheduleEditor({ value, onChange, disabled }: { value: unknown; onChange: (v: ScheduleSpec) => void; disabled?: boolean }) {
  const { timezone } = useOrg();
  const spec = (value && typeof value === "object" ? value : null) as ScheduleSpec | null;
  const preset = spec ? SCHEDULE_PRESETS.find((p) => scheduleKey(p.spec) === scheduleKey(spec))?.key ?? "custom" : undefined;
  const problem = spec ? scheduleProblem(spec) : null;
  const next = useMemo(() => (spec && !problem ? nextOccurrence(spec, Date.now(), timezone) : null), [spec, problem, timezone]);
  const time = (s: ScheduleSpec) => (
    <Input
      dir="ltr"
      style={{ width: 96 }}
      value={"time" in s ? faDigits(s.time) : ""}
      placeholder="۰۸:۳۰"
      onChange={(e) => onChange({ ...s, time: e.target.value.replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))) } as ScheduleSpec)}
      disabled={disabled}
      aria-label="ساعت"
    />
  );
  return (
    <div className="fl-rows">
      <Select
        value={preset}
        placeholder="یک زمان‌بندی آماده انتخاب کنید"
        options={[...SCHEDULE_PRESETS.map((p) => ({ value: p.key, label: p.label })), { value: "custom", label: "سفارشی" }]}
        onChange={(k) => onChange(k === "custom" ? blank(spec?.kind ?? "daily", spec) : SCHEDULE_PRESETS.find((p) => p.key === k)!.spec)}
        disabled={disabled}
      />
      {spec ? (
        <>
          <Segmented size="small" value={spec.kind} options={KINDS} onChange={(k) => onChange(blank(k as ScheduleSpec["kind"], spec))} disabled={disabled} />
          {spec.kind === "daily" ? <div>ساعت {time(spec)}</div> : null}
          {spec.kind === "weekly" ? (
            <>
              <Checkbox.Group
                value={spec.weekdays}
                options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))}
                onChange={(v) => onChange({ ...spec, weekdays: (v as number[]).sort() })}
                disabled={disabled}
              />
              <div>ساعت {time(spec)}</div>
            </>
          ) : null}
          {spec.kind === "monthly" ? (
            <>
              <Select
                mode="multiple"
                value={spec.days}
                placeholder="روزهای ماه"
                options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: faDigits(i + 1) }))}
                onChange={(days) => onChange({ ...spec, days: [...days].sort((a, b) => a - b) })}
                disabled={disabled}
              />
              <Checkbox checked={!!spec.last} onChange={(e) => onChange({ ...spec, last: e.target.checked })} disabled={disabled}>
                آخرین روز ماه
              </Checkbox>
              <Select
                mode="multiple"
                allowClear
                value={spec.months ?? []}
                placeholder="همهٔ ماه‌ها"
                options={JALALI_MONTHS.map((m, i) => ({ value: i + 1, label: m }))}
                onChange={(months) => onChange({ ...spec, months: months.length ? [...months].sort((a, b) => a - b) : undefined })}
                disabled={disabled}
              />
              <div>ساعت {time(spec)}</div>
            </>
          ) : null}
          {spec.kind === "yearly" ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <Select style={{ width: 80 }} value={spec.day} options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: faDigits(i + 1) }))} onChange={(day) => onChange({ ...spec, day })} disabled={disabled} />
              <Select style={{ width: 120 }} value={spec.month} options={JALALI_MONTHS.map((m, i) => ({ value: i + 1, label: m }))} onChange={(month) => onChange({ ...spec, month })} disabled={disabled} />
              ساعت {time(spec)}
            </div>
          ) : null}
          {spec.kind === "interval" ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              هر
              <Input style={{ width: 80 }} value={faDigits(spec.every)} onChange={(e) => onChange({ ...spec, every: num(e.target.value) || 0 })} disabled={disabled} aria-label="فاصله" />
              <Select
                style={{ width: 110 }}
                value={spec.unit}
                options={[{ value: "minute", label: "دقیقه" }, { value: "hour", label: "ساعت" }, { value: "day", label: "روز" }]}
                onChange={(unit) => onChange({ ...spec, unit })}
                disabled={disabled}
              />
            </div>
          ) : null}
          {spec.kind === "once" ? <DateTimeInput value={spec.at} tz={timezone} onChange={(at) => onChange({ ...spec, at: at ?? "" })} disabled={disabled} /> : null}
          {spec.kind === "cron" ? <Input dir="ltr" className="fl-mono" value={spec.expr} onChange={(e) => onChange({ ...spec, expr: e.target.value })} placeholder="0 8 * * 6" disabled={disabled} /> : null}
          <div className={problem ? "text-danger" : "fl-step-meta"}>
            {problem ?? describeSchedule(spec, timezone)}
            {next ? ` — نوبت بعد: ${formatJalaliDateTime(new Date(next).toISOString(), timezone)}` : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
