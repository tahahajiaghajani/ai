// The filters row of the reports (components.md §2): the period segmented control first (it drives every figure on
// the page), the custom range, the report's own dimensions, then «با پیش‌نویس‌ها» and print/export at the end.
// It sits above the card it scopes, never inside it.
import { useState, type ReactNode } from "react";
import { Button, Segmented, Tooltip } from "antd";
import { Download, FilePen, Printer } from "lucide-react";
import { DateInput } from "../../components/inputs";
import { useOrg } from "../../lib/org";
import { formatJalali, presetRange, todayISO } from "@shared/jalali";
import { ICON, PrintHead } from "./kit";

export interface Range {
  from: string | null;
  to: string | null;
  drafts: boolean;
}

export function useRange(initial: "year" | "month" = "year") {
  const { fy } = useOrg();
  const base = initial === "year" && fy ? { from: fy.start_date, to: fy.end_date } : presetRange(initial);
  return useState<Range>({ from: base.from, to: base.to, drafts: false });
}

type Preset = "fy" | "quarter" | "month" | "lastMonth" | "today";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "fy", label: "سال مالی" },
  { value: "quarter", label: "فصل" },
  { value: "month", label: "این ماه" },
  { value: "lastMonth", label: "ماه قبل" },
  { value: "today", label: "امروز" },
];

export function ReportFilters({
  range,
  setRange,
  children,
  noFrom,
  onExport,
  end,
}: {
  range: Range;
  setRange: (r: Range) => void;
  children?: ReactNode;
  noFrom?: boolean;
  /** Excel export of the report (an icon button at the end of the row) */
  onExport?: () => void;
  /** more controls at the end, before print */
  end?: ReactNode;
}) {
  const { fy } = useOrg();
  const today = todayISO();
  const rangeOf = (p: Preset) => (p === "fy" ? (fy ? { from: fy.start_date, to: fy.end_date } : null) : presetRange(p, today));
  const current = PRESETS.find((p) => {
    const r = rangeOf(p.value);
    return r && r.from === range.from && r.to === range.to;
  })?.value;
  return (
    <div className="bk-filters no-print">
      {!noFrom ? (
        <Segmented
          value={current ?? "__custom"}
          options={PRESETS}
          onChange={(v) => {
            const r = rangeOf(v as Preset);
            if (r) setRange({ ...range, from: r.from, to: r.to });
          }}
        />
      ) : null}
      <span className="bk-range">
        {!noFrom ? (
          <>
            <DateInput value={range.from} onChange={(from) => setRange({ ...range, from })} placeholder="از تاریخ" allowClear />
            <span>تا</span>
          </>
        ) : (
          <span>تا تاریخ</span>
        )}
        <DateInput value={range.to} onChange={(to) => setRange({ ...range, to })} placeholder="تا تاریخ" allowClear />
      </span>
      {children}
      <div className="bk-end">
        <Tooltip title="اسناد پیش‌نویس هم در گزارش بیایند">
          <button type="button" className="bk-tog" aria-pressed={range.drafts} onClick={() => setRange({ ...range, drafts: !range.drafts })}>
            <FilePen {...ICON} aria-hidden />
            با پیش‌نویس‌ها
          </button>
        </Tooltip>
        {end}
        {onExport ? (
          <Tooltip title="خروجی اکسل">
            <Button type="text" icon={<Download {...ICON} />} onClick={onExport} aria-label="خروجی اکسل" />
          </Tooltip>
        ) : null}
        <Tooltip title="چاپ">
          <Button type="text" icon={<Printer {...ICON} />} onClick={() => window.print()} aria-label="چاپ" />
        </Tooltip>
      </div>
    </div>
  );
}

/** The printed title block of a report: the business, the report's name and its period. */
export function ReportTitle({ title, range, noFrom }: { title: string; range?: Range; noFrom?: boolean }) {
  const lines = range ? [noFrom || !range.from ? (range.to ? `تا ${fmt(range.to)}` : "") : `از ${fmt(range.from)}${range.to ? ` تا ${fmt(range.to)}` : ""}`].filter(Boolean) : [];
  return <PrintHead title={title} lines={lines} />;
}

const fmt = (d: string | null) => (d ? formatJalali(d) : "");
