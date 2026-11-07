// The «توافق‌ها» tab of a record: each SLA timer — its kind and target, the share of working time used (toned from
// 75 % and when breached), the start, the deadline and what is left — and its history on a timeline: start, pauses,
// warnings, the breach, a target recomputed after a priority change, the stop.
import { Timeline } from "antd";
import { SLA_STAGES, SLA_TARGETS, SLA_TYPES } from "@shared/tables/sla";
import { formatJalaliDateTime, toFa } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { EmptyState, Loader } from "../../components/display";
import { cx } from "../../components/blocks";
import { ChoiceTag, type RecordContext } from "../../records";
import { spanText } from "../../records/model/sla";
import { formatDuration } from "../../records/model/values";
import { useSlaTimeline, type TimelineEvent, type TimerView } from "./api";

const EVENT_COLOR: Record<TimelineEvent["kind"], string> = {
  start: "blue",
  pause: "gray",
  resume: "blue",
  warning: "orange",
  breach: "red",
  stop: "green",
  cancel: "gray",
  repair: "purple",
};

/** «۳۶۰۰ → ۷۲۰۰» (seconds) as «۱ ساعت → ۲ ساعت». */
function detailText(e: TimelineEvent): string | null {
  if (!e.detail || e.kind === "warning") return null;
  const parts = e.detail.split("→").map((x) => x.trim());
  return parts.every((x) => /^\d+(\.\d+)?$/.test(x)) ? parts.map((x) => formatDuration(Number(x)) || "—").join(" ← ") : e.detail;
}

function TimerCard({ t, tz }: { t: TimerView; tz: string }) {
  const pct = Math.max(0, Math.round(t.percent));
  const tone = t.state === "breached" ? "danger" : t.state === "achieved" ? "in" : t.state === "paused" || t.state === "canceled" ? "neutral" : pct >= 75 ? "warning" : "accent";
  const left = t.remaining_ms;
  const live = t.state === "in_progress" || t.state === "paused" || (t.state === "breached" && !t.stop_at);
  const option = (list: typeof SLA_TYPES, v: string) => list.find((o) => o.value === v)?.label ?? v;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" aria-label={t.label}>
      <header className="flex flex-wrap items-center gap-2">
        <span className="ds-t-title text-ink">{t.label}</span>
        <ChoiceTag option={SLA_STAGES.find((o) => o.value === t.state)} value={t.state} strong />
        <span className="ms-auto text-[12px] text-ink-3">
          {option(SLA_TYPES, t.type)} · {option(SLA_TARGETS, t.target)}
        </span>
      </header>
      <div className="flex items-center gap-3">
        <div
          className="relative h-2 flex-1 overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, pct)}
          aria-label={`${toFa(pct)} درصد از زمان هدف سپری شده است`}
        >
          <div
            className={cx(
              "absolute inset-y-0 start-0 rounded-full",
              tone === "danger" ? "bg-[var(--ds-danger)]" : tone === "warning" ? "bg-[var(--ds-warning)]" : tone === "in" ? "bg-[var(--ds-in)]" : tone === "neutral" ? "bg-[var(--ds-text-3)]" : "bg-accent",
            )}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <span className="ds-num w-12 text-end text-[13px] text-ink-2">{toFa(pct)}٪</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-ink-3">شروع</dt>
          <dd className="ds-num text-ink">{formatJalaliDateTime(t.start_at, tz) || "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">موعد</dt>
          <dd className="ds-num text-ink">{formatJalaliDateTime(t.due_at, tz) || "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-3">زمان کاری سپری‌شده</dt>
          <dd className="text-ink">
            {spanText(t.elapsed_ms)} از {spanText(t.duration_ms)}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">{live ? (left !== null && left < 0 ? "از موعد گذشته" : "مانده") : "پایان"}</dt>
          <dd className={cx("text-ink", left !== null && left < 0 && live && "text-danger")}>
            {live ? (t.paused ? "متوقف" : left === null ? "—" : spanText(left)) : <span className="ds-num">{formatJalaliDateTime(t.stop_at, tz) || "—"}</span>}
          </dd>
        </div>
      </dl>
      {t.events.length ? (
        <Timeline
          className="mt-1"
          items={t.events.map((e, i) => {
            const d = detailText(e);
            return {
              key: `${e.kind}:${i}`,
              color: EVENT_COLOR[e.kind],
              content: (
                <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="text-ink">{e.label}</span>
                  <span className="ds-num text-ink-3">{formatJalaliDateTime(e.at, tz)}</span>
                  {d ? <span className="text-ink-3">({d})</span> : null}
                </div>
              ),
            };
          })}
        />
      ) : null}
    </section>
  );
}

export default function SlaTimeline({ ctx }: { ctx: RecordContext }) {
  const { timezone } = useOrg();
  const q = useSlaTimeline(ctx.table, ctx.row.id);
  if (q.isLoading) return <Loader />;
  const timers = q.data?.timers ?? [];
  if (!timers.length) return <EmptyState compact title="توافقی به این رکورد نپیوسته است" />;
  return (
    <div className="flex flex-col gap-3">
      {timers.map((t) => (
        <TimerCard key={t.id} t={t} tz={timezone} />
      ))}
    </div>
  );
}
