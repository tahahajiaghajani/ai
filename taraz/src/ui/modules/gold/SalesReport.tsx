// Sales report (گزارش فروش طلا): per day, month, invoice, category or customer — weight sold,
// gold value, wage, profit, discount, VAT, coins, trade-ins, cost and gross margin.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Switch, Table } from "antd";
import { FileExcelOutlined, PrinterOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { DateInput } from "../../components/inputs";
import { Money, StatCard, JDate } from "../../components/display";
import { exportExcel } from "../../lib/excel";
import { D } from "@shared/money";
import { faDigits, formatWeight } from "@shared/format";
import { formatJalali, presetRange, todayISO } from "@shared/jalali";

type Group = "day" | "month" | "doc" | "category" | "party";

export default function SalesReport() {
  const { api, orgId, org, fy } = useOrg();
  const nav = useNavigate();
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";
  const month = presetRange("month", todayISO(tz));
  const [from, setFrom] = useState<string | null>(month.from);
  const [to, setTo] = useState<string | null>(month.to);
  const [group, setGroup] = useState<Group>("day");
  const [bullion, setBullion] = useState(false);
  const q = useQuery({
    queryKey: ["gold-sales", orgId, from, to, group, bullion],
    queryFn: () => api.get("/gold/reports/sales", { from, to, group, kinds: bullion ? "sale,bullion_sale" : "sale" }),
  });
  const d = q.data;
  const t = d?.totals;
  const preset = (p: "today" | "month" | "lastMonth" | "year") => {
    if (p === "year" && fy) {
      setFrom(fy.start_date);
      setTo(fy.end_date);
      return;
    }
    const r = presetRange(p as "month", todayISO(tz));
    setFrom(r.from);
    setTo(r.to);
  };
  const keyTitle: Record<Group, string> = { day: "تاریخ", month: "ماه", doc: "فاکتور", category: "دسته", party: "مشتری" };
  const label = (r: any) => {
    if (group === "day") return <JDate v={r.date} />;
    if (group === "doc") return <span><b className="num">{faDigits(r.no)}</b>، <JDate v={r.date} />، {r.label ?? "گذری"}</span>;
    return r.label;
  };
  const cols = useMemo(
    () => [
      { title: "تعداد فاکتور", key: "docs", type: "count" },
      { title: "جنس", key: "pieces", type: "count" },
      { title: "وزن (گرم)", key: "weight", type: "w" },
      { title: "معادل ۷۵۰", key: "weight750", type: "w" },
      { title: "ارزش طلا", key: "gold_value", type: "m" },
      { title: "اجرت", key: "wage", type: "m" },
      { title: "سود", key: "profit", type: "m" },
      { title: "تخفیف", key: "discount", type: "m" },
      { title: "مالیات", key: "tax", type: "m" },
      { title: "سنگ", key: "stone", type: "m" },
      { title: "سکه", key: "coins", type: "m" },
      { title: "جمع فروش", key: "total", type: "m" },
      { title: "طلای کهنه (۷۵۰)", key: "old_weight750", type: "w" },
      { title: "ارزش طلای کهنه", key: "old_value", type: "m" },
      { title: "بهای تمام‌شده", key: "cost", type: "m" },
      { title: "سود ناخالص", key: "margin", type: "m" },
    ],
    [],
  );
  const cell = (type: string, v: any) =>
    type === "count" ? <span className="num">{faDigits(v ?? 0)}</span> : type === "w" ? (D(v).isZero() ? <span className="text-muted">—</span> : <span className="num">{formatWeight(v)}</span>) : <Money v={v ?? 0} zero="—" />;
  return (
    <div>
      <PageHeader title="گزارش فروش طلا" subtitle={d ? `${formatJalali(d.from)} تا ${formatJalali(d.to)}` : null} actions={<Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>} />
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Segmented size="small" onChange={(v) => preset(v as "month")} options={[{ value: "today", label: "امروز" }, { value: "month", label: "این ماه" }, { value: "lastMonth", label: "ماه قبل" }, { value: "year", label: "سال مالی" }]} />
        <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" className="!w-36" />
        <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" className="!w-36" />
        <Segmented value={group} onChange={(v) => setGroup(v as Group)} options={[{ value: "day", label: "روزانه" }, { value: "month", label: "ماهانه" }, { value: "doc", label: "فاکتور" }, { value: "category", label: "دسته" }, { value: "party", label: "مشتری" }]} />
        <label className="flex items-center gap-1.5 text-xs text-muted"><Switch size="small" checked={bullion} onChange={setBullion} /> با فروش آبشده</label>
        <Button
          className="ms-auto"
          icon={<FileExcelOutlined />}
          disabled={!d}
          onClick={() =>
            exportExcel(`فروش طلا ${d.from} تا ${d.to}`, [
              { title: keyTitle[group], value: (r: any) => (group === "day" ? formatJalali(r.date) : group === "doc" ? `${r.no} - ${r.label ?? ""}` : r.label) },
              ...cols.map((c) => ({ title: c.title, value: (r: any) => r[c.key], type: "number" as const })),
            ], d.rows)
          }
        >
          اکسل
        </Button>
      </div>
      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="فاکتورهای فروش" value={<span className="num">{faDigits(t?.docs ?? 0)} فاکتور، {faDigits(t?.pieces ?? 0)} جنس</span>} />
        <StatCard title="وزن فروش‌رفته (۷۵۰)" value={<span className="num">{formatWeight(t?.weight750 ?? 0)} گرم</span>} tone="gold" hint={<>طلای کهنه‌ی دریافتی: <span className="num">{formatWeight(t?.old_weight750 ?? 0)}</span> گرم</>} />
        <StatCard title="جمع فروش" value={<Money v={t?.total ?? 0} />} hint={<>اجرت <Money v={t?.wage ?? 0} />، سود <Money v={t?.profit ?? 0} /></>} tone="ok" />
        <StatCard title="سود ناخالص (بدون مالیات)" value={<Money v={t?.margin ?? 0} colored />} hint={<>مالیات بر ارزش افزوده: <Money v={t?.tax ?? 0} /></>} />
      </div>
      <div className="print-sheet tz-card p-3 md:p-4">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-bold">{org.name}</div>
          <div className="font-semibold">گزارش فروش طلا {d ? `از ${formatJalali(d.from)} تا ${formatJalali(d.to)}` : ""}</div>
        </div>
        <Table
          className="tz-table"
          size="small"
          rowKey="key"
          loading={q.isLoading}
          dataSource={d?.rows ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          onRow={(r: any) => (group === "doc" ? { onClick: () => nav(`/${orgId}/gold/docs/${r.key}`), style: { cursor: "pointer" } } : {})}
          columns={[
            { key: "k", title: keyTitle[group], fixed: "right" as const, render: (_: unknown, r: any) => label(r) },
            ...cols.map((c) => ({ key: c.key, dataIndex: c.key, title: c.title, align: "left" as const, render: (v: any) => cell(c.type, v) })),
          ]}
          summary={() =>
            t ? (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>جمع</Table.Summary.Cell>
                  {cols.map((c, i) => (
                    <Table.Summary.Cell key={c.key} index={i + 1} align="left">{cell(c.type, t[c.key])}</Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              </Table.Summary>
            ) : null
          }
        />
      </div>
    </div>
  );
}
