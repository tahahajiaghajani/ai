// «اهداف و پیش‌نمایش» of an SLA definition: the target per priority (hours and minutes of working time — the fixed
// target stays in the form), the warning thresholds, and the timeline of a timer started at a chosen moment: where
// each warning fires and where the deadline falls, on the definition's working calendar (24 × 7 without one) with the
// organisation's holidays — the same arithmetic the server uses.
import { useEffect, useMemo, useState } from "react";
import { Button, Segmented, Select } from "antd";
import { Save, RotateCcw } from "lucide-react";
import type { Option } from "@shared/model/types";
import { calendarOf } from "@shared/sla/calendar";
import { PRIORITY_KEYS, warnLevels } from "@shared/sla/timer";
import { addDays, formatJalaliDateTime, todayISO, toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { Loader } from "../../components/display";
import { ICON14, cx } from "../../components/blocks";
import { ChoiceTag, DateTimeInput, DurationInput, type RecordContext } from "../../records";
import { optionsOf } from "../../records/model/schema";
import { spanText } from "../../records/model/sla";
import { useCalendarSpec } from "./api";
import { axisLabels, durationsDraft, durationsValue, slaPreview } from "./model";

const WARN_OPTIONS = Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((n) => ({ value: n, label: `${toFa(n)}٪` }));

export default function SlaPreview({ ctx }: { ctx: RecordContext }) {
  const { timezone } = useOrg();
  const row = ctx.row;
  const canEdit = ctx.meta.canWrite && !ctx.meta.locked;
  const fixed = row.duration_mode === "fixed";
  const target = ctx.schema.def(String(row.table_key ?? ""));
  const pField = target?.fields.find((f) => f.name === String(row.priority_field || "priority"));
  const priorities: Option[] = useMemo(
    () => (pField ? optionsOf(pField, ctx.schema.choices).filter((o) => o.active !== false) : PRIORITY_KEYS.map((k) => ({ value: k, label: toFa(k) }))),
    [pField, ctx.schema.choices],
  );
  const savedDurations = useMemo(() => durationsDraft(row.durations, priorities), [row.durations, priorities]);
  const savedWarn = useMemo(() => warnLevels(row.warn_percents), [row.warn_percents]);
  const [durations, setDurations] = useState(savedDurations);
  const [warn, setWarn] = useState<number[]>(savedWarn);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDurations(savedDurations), [savedDurations]);
  useEffect(() => setWarn(savedWarn), [savedWarn]);
  const dirty = JSON.stringify(durations) !== JSON.stringify(savedDurations) || JSON.stringify(warn) !== JSON.stringify(savedWarn);

  // the preview: a priority, a start, the calendar
  const [priority, setPriority] = useState<string | undefined>(undefined);
  const chosen = priority ?? priorities.find((p) => durations[p.value])?.value ?? priorities[0]?.value;
  const [start, setStart] = useState<string>(() => new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString());
  const calId = typeof row.calendar_id === "string" && row.calendar_id ? row.calendar_id : null;
  const today = todayISO(timezone);
  const spec = useCalendarSpec(calId, addDays(today, -1), addDays(today, 400));
  const cal = useMemo(
    () => (calId && spec.data ? calendarOf({ timezone: spec.data.timezone, hours: spec.data.hours }, spec.data.holidays.map((h) => ({ date: h.date, half_day: !!h.half, title: h.title })), timezone) : null),
    [calId, spec.data, timezone],
  );
  const tz = cal?.tz ?? timezone;
  const durationSec = fixed ? Number(row.duration) || null : chosen ? durations[chosen] : null;
  const startMs = Date.parse(start);
  const p = useMemo(() => slaPreview({ duration: durationSec, warn, cal, start: Number.isNaN(startMs) ? Date.now() : startMs }), [durationSec, warn, cal, startMs]);
  const labels = axisLabels(p.marks);

  const save = async () => {
    setSaving(true);
    await ctx.save(fixed ? { warn_percents: warn } : { durations: durationsValue(durations), warn_percents: warn });
    setSaving(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3" aria-label="اهداف">
        <div className="flex flex-wrap items-center gap-2">
          <span className="ds-t-label text-ink-2">{fixed ? "هدف ثابت" : "هدف به ازای اولویت (زمان کاری)"}</span>
          {canEdit ? (
            <div className="ms-auto flex gap-2">
              <Button
                size="small"
                icon={<RotateCcw {...ICON14} />}
                disabled={!dirty}
                onClick={() => {
                  setDurations(savedDurations);
                  setWarn(savedWarn);
                }}
              >
                بازگردانی
              </Button>
              <Button size="small" type="primary" icon={<Save {...ICON14} />} disabled={!dirty} loading={saving} onClick={() => void save()}>
                ذخیرهٔ اهداف
              </Button>
            </div>
          ) : null}
        </div>
        {fixed ? (
          <p className="text-[13px] text-ink-2">{row.duration ? spanText(Number(row.duration) * 1000) : "مدت ثابت را در فرم تعیین کنید."}</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--ds-line)] rounded-lg border border-line bg-surface">
            {priorities.map((o) => (
              <div key={o.value} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="w-40 shrink-0">
                  <ChoiceTag option={o} value={o.value} />
                </span>
                <div className="w-full max-w-[280px]">
                  <DurationInput size="small" value={durations[o.value]} disabled={!canEdit} onChange={(v) => setDurations((d) => ({ ...d, [o.value]: typeof v === "number" && v > 0 ? v : null }))} />
                </div>
                {!durations[o.value] ? <span className="text-[12px] text-ink-3">بی‌هدف: زمان‌سنجی شروع نمی‌شود</span> : null}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-ink-2">هشدار در</span>
          <Select<number[]>
            mode="multiple"
            size="small"
            className="min-w-[240px]"
            value={warn}
            disabled={!canEdit}
            options={WARN_OPTIONS}
            onChange={(v) => setWarn(warnLevels(v))}
            aria-label="آستانه‌های هشدار"
          />
          <span className="text-[12px] text-ink-3">از زمان هدف</span>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" aria-label="پیش‌نمایش">
        <div className="flex flex-wrap items-center gap-3">
          <span className="ds-t-label text-ink-2">پیش‌نمایش</span>
          {!fixed && priorities.length ? (
            <Segmented size="small" value={chosen} onChange={(v) => setPriority(String(v))} options={priorities.map((o) => ({ value: o.value, label: o.label }))} />
          ) : null}
          <span className="flex items-center gap-2 text-[13px] text-ink-2">
            شروع
            <DateTimeInput size="small" value={start} tz={tz} onChange={(v) => setStart(v ?? new Date().toISOString())} />
          </span>
          <span className="ms-auto text-[12px] text-ink-3">{calId ? (spec.data ? `تقویم «${spec.data.name}»` : "") : "شبانه‌روزی، همهٔ روزها"}</span>
        </div>
        {calId && spec.isLoading ? (
          <Loader />
        ) : !p.duration ? (
          <p className="text-[13px] text-ink-3">برای این اولویت هدفی تعیین نشده است.</p>
        ) : p.end === null ? (
          <p className="text-[13px] text-danger">این تقویم ساعت کاری ندارد؛ موعدی به دست نمی‌آید.</p>
        ) : (
          <>
            <div className="relative mt-6 h-3 rounded-full bg-sunken" aria-hidden>
              {p.working.map(([a, b], i) => (
                <span key={i} className="absolute inset-y-0 rounded-full bg-accent-tint-2" style={{ insetInlineStart: `${a}%`, width: `${Math.max(0.4, b - a)}%` }} />
              ))}
              {p.marks.map((m, i) => (
                <span key={`${m.kind}:${m.pct}`} className="absolute -top-6 flex -translate-x-1/2 flex-col items-center rtl:translate-x-1/2" style={{ insetInlineStart: `${m.pos}%` }}>
                  <span className={cx("ds-num h-4 text-[11px]", m.kind === "breach" ? "text-danger" : m.kind === "warn" ? "text-warning" : "text-ink-3")}>
                    {labels[i] ? (m.kind === "start" ? "۰" : `${toFa(m.pct)}٪`) : ""}
                  </span>
                  <span className={cx("mt-0.5 h-5 w-0.5 rounded-full", m.kind === "breach" ? "bg-[var(--ds-danger)]" : m.kind === "warn" ? "bg-[var(--ds-warning)]" : "bg-[var(--ds-text-3)]")} />
                </span>
              ))}
            </div>
            <ol className="mt-2 flex flex-col gap-1 text-[13px]">
              {p.marks.map((m) => (
                <li key={`${m.kind}:${m.pct}`} className="flex flex-wrap items-baseline gap-x-3">
                  <span className={cx("w-24 shrink-0", m.kind === "breach" ? "text-danger" : m.kind === "warn" ? "text-warning" : "text-ink-2")}>{m.label}</span>
                  <span className="ds-num text-ink">{formatJalaliDateTime(new Date(m.at).toISOString(), tz)}</span>
                  {m.kind !== "start" ? <span className="text-ink-3">{spanText(m.at - p.start)} پس از شروع</span> : null}
                </li>
              ))}
            </ol>
            <p className="text-[12px] text-ink-3">
              {spanText(p.duration * 1000)} زمان کاری در {spanText(p.wallMs ?? 0)} زمان تقویمی؛ نوارهای روشن ساعات کاری‌اند.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
