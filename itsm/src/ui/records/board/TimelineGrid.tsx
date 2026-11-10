// TimelineGrid: the drawing of a timeline — Jalali days from the inline start (right), Fridays and holidays shaded,
// background bands (maintenance / blackout / freeze windows, outages…), a «now» line, and items as bars positioned to
// the minute and packed into lanes, each with its state colour and a tone (an outline and an icon for what needs
// attention: a conflict, a blackout). Presentational: the caller loads the items, bands and holidays — TimelineView
// for a table's records, a module's own screen (the change calendar) for its data. Every bar is a button.
import type { ReactNode } from "react";
import { Tooltip } from "antd";
import { OctagonAlert, TriangleAlert } from "lucide-react";
import { JALALI_MONTHS, WEEKDAYS_SHORT, toFa } from "@shared/jalali";
import { cx } from "../../components/blocks";
import { placeBands, placeSpans, scaleDays, windowRange, type CalendarBand, type CalendarTone } from "../model/calendar";
import type { Holiday } from "../extensions";
import "../records.css";

const ICON14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const LANE = 32;

export interface TimelineItem {
  id: string;
  /** ISO date-times (or epoch ms) */
  start: unknown;
  end: unknown;
  label: string;
  number?: string | null;
  /** the kit's palette key (a state's colour) */
  color?: string;
  /** the state's category: waiting is dashed, resolved and closed are muted */
  category?: string;
  tone?: CalendarTone | null;
  /** the tooltip (lines); default: number and label */
  title?: string;
}

export interface TimelineGridProps {
  /** first local day and the number of days */
  from: string;
  days: number;
  tz: string;
  today: string;
  holidays?: readonly Holiday[];
  bands?: readonly CalendarBand[];
  items: readonly TimelineItem[];
  /** opens an item; without it the bars only show (a person's shifts on the on-call page are no records) */
  onOpen?: (id: string) => void;
  /** shown when no item falls in the range */
  empty?: ReactNode;
  busy?: boolean;
}

export function TimelineGrid({ from, days, tz, today, holidays = [], bands = [], items, onOpen, empty, busy }: TimelineGridProps) {
  const range = windowRange(from, days, tz);
  const ds = scaleDays(from, days, holidays, today);
  const placedBands = placeBands(bands, range);
  const { bars, lanes } = placeSpans(items, range, (i) => i.start, (i) => i.end);
  const now = Date.now();
  const nowLeft = now > range.start && now < range.end ? ((now - range.start) / (range.end - range.start)) * 100 : null;
  // more than about six weeks: narrow days, a number every week
  const dense = days > 40;
  return (
    <div className={cx("rk-tg", dense && "is-dense")} style={{ ["--rk-tg-days" as string]: days }} aria-busy={busy || undefined}>
      <div className="rk-tg-in">
        <div className="rk-tg-head" aria-hidden>
          {ds.map((d) => (
            <span key={d.iso} className={cx(d.off && "is-off", d.today && "is-today")} title={d.holiday ?? undefined}>
              {d.jd === 1 || d.iso === from ? <b>{JALALI_MONTHS[d.jm - 1]}</b> : null}
              {dense ? null : <span>{WEEKDAYS_SHORT[d.weekday]}</span>}
              <span className="ds-num">{dense && d.jd % 7 !== 1 ? "" : toFa(d.jd)}</span>
            </span>
          ))}
        </div>
        <div className="rk-tg-body" style={{ minBlockSize: Math.max(96, 28 + lanes * LANE) }}>
          <div className="rk-tg-cols" aria-hidden>
            {ds.map((d) => (
              <i key={d.iso} className={d.off ? "is-off" : undefined} />
            ))}
          </div>
          {placedBands.map((b, i) => (
            <Tooltip key={`${b.item.id}:${i}`} title={b.item.title ?? b.item.label}>
              <div className="rk-tg-band" data-k={b.item.kind} style={{ insetInlineStart: `${b.left}%`, inlineSize: `${b.width}%` }}>
                <span>{b.item.label}</span>
              </div>
            </Tooltip>
          ))}
          {nowLeft !== null ? <div className="rk-tg-now" style={{ insetInlineStart: `${nowLeft}%` }} aria-hidden /> : null}
          {bars.map((b) => {
            const it = b.item;
            const title = it.title ?? [it.number, it.label].filter(Boolean).join(" — ");
            const props = {
              className: cx("rk-tg-bar", b.clippedStart && "is-clip-s", b.clippedEnd && "is-clip-e", !onOpen && "is-static"),
              "data-tone": it.tone ?? undefined,
              "data-cat": it.category,
              "data-c": it.color,
              style: { insetInlineStart: `${b.left}%`, inlineSize: `${b.width}%`, insetBlockStart: 22 + b.lane * LANE },
              "aria-label": title.replace(/\n/g, "، "),
            };
            const body = (
              <>
                {it.tone === "danger" ? <OctagonAlert {...ICON14} className="rk-tg-icon is-danger" aria-hidden /> : it.tone === "warning" ? <TriangleAlert {...ICON14} className="rk-tg-icon is-warning" aria-hidden /> : null}
                {it.number ? <span className="rk-tg-no ds-ltr">{it.number}</span> : null}
                <span className="rk-tg-t">{it.label}</span>
              </>
            );
            return (
              <Tooltip key={it.id} title={<span style={{ whiteSpace: "pre-line" }}>{title}</span>}>
                {onOpen ? (
                  <button type="button" {...props} onClick={() => onOpen(it.id)}>
                    {body}
                  </button>
                ) : (
                  // nothing to open: not a button (a bar that looks clickable and does nothing was a dead end)
                  <span role="img" {...props}>
                    {body}
                  </span>
                )}
              </Tooltip>
            );
          })}
          {!bars.length && !busy ? <p className="rk-tg-empty">{empty ?? "در این بازه موردی نیست."}</p> : null}
        </div>
      </div>
    </div>
  );
}
