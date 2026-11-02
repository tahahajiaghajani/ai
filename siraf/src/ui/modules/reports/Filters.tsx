import { useState, type ReactNode } from "react";
import { Segmented, Space, Switch, Button } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import { DateInput } from "../../components/inputs";
import { useOrg } from "../../lib/org";
import { presetRange, todayISO } from "@shared/jalali";

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

export function ReportFilters({ range, setRange, children, noFrom }: { range: Range; setRange: (r: Range) => void; children?: ReactNode; noFrom?: boolean }) {
  const { fy } = useOrg();
  const presets: { value: string; label: string }[] = [
    { value: "fy", label: "سال مالی" },
    { value: "quarter", label: "فصل" },
    { value: "month", label: "این ماه" },
    { value: "lastMonth", label: "ماه قبل" },
    { value: "today", label: "امروز" },
  ];
  return (
    <div className="no-print mb-3 flex flex-wrap items-center gap-2">
      {!noFrom ? (
        <Segmented
          size="small"
          options={presets}
          onChange={(v) => {
            if (v === "fy" && fy) setRange({ ...range, from: fy.start_date, to: fy.end_date });
            else {
              const r = presetRange(v as "month", todayISO());
              setRange({ ...range, from: r.from, to: r.to });
            }
          }}
        />
      ) : null}
      <Space>
        {!noFrom ? <DateInput value={range.from} onChange={(from) => setRange({ ...range, from })} placeholder="از تاریخ" className="!w-36" allowClear /> : null}
        <DateInput value={range.to} onChange={(to) => setRange({ ...range, to })} placeholder={noFrom ? "تا تاریخ" : "تا تاریخ"} className="!w-36" allowClear />
      </Space>
      <label className="flex items-center gap-1.5 text-xs text-muted">
        <Switch size="small" checked={range.drafts} onChange={(drafts) => setRange({ ...range, drafts })} /> با پیش‌نویس‌ها
      </label>
      {children}
      <Button className="ms-auto" icon={<PrinterOutlined />} onClick={() => window.print()}>
        چاپ
      </Button>
    </div>
  );
}

export function ReportTitle({ title, range }: { title: string; range?: Range }) {
  const { org } = useOrg();
  return (
    <div className="mb-3 hidden text-center print:block">
      <div className="text-lg font-bold">{org.name}</div>
      <div className="text-base font-semibold">{title}</div>
      {range ? <div className="text-xs">{range.from ? `از ${range.from}` : ""} {range.to ? `تا ${range.to}` : ""}</div> : null}
    </div>
  );
}
