// Sales report (گزارش فروش طلا): per day, month, invoice, category or customer — weight sold,
// gold value, wage, profit, discount, VAT, coins, trade-ins, cost and gross margin.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Segmented, Switch, Table } from "antd";
import { FileSpreadsheet, Printer, ReceiptText, ShoppingBag, TrendingUp, Weight } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { AiExplainButton } from "../../ai/explain/AiExplainButton";
import { DateInput } from "../../components/inputs";
import { Money, StatCard, JDate } from "../../components/display";
import { exportExcel } from "../../lib/excel";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { gw } from "./shared";
import { formatJalali, presetRange, todayISO } from "@shared/jalali";

type Group = "day" | "month" | "doc" | "category" | "party" | "product";

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
  // the preset the range is (nothing selected for a custom range)
  const presetOf = (): string | undefined => {
    if (fy && from === fy.start_date && to === fy.end_date) return "year";
    for (const k of ["today", "month", "lastMonth"] as const) {
      const r = presetRange(k as "month", todayISO(tz));
      if (r.from === from && r.to === to) return k;
    }
    return undefined;
  };
  const keyTitle: Record<Group, string> = { day: "تاریخ", month: "ماه", doc: "فاکتور", category: "دسته", party: "مشتری", product: "نوع کالا" };
  const label = (r: any) => {
    if (group === "day") return <JDate v={r.date} />;
    if (group === "doc") return <span><b className="sf-num">{faDigits(r.no)}</b>، <JDate v={r.date} />، {r.label ?? "گذری"}</span>;
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
      { title: "شمش", key: "bars", type: "m" },
      { title: "جمع فروش", key: "total", type: "m" },
      { title: "طلای کهنه (۷۵۰)", key: "old_weight750", type: "w" },
      { title: "ارزش طلای کهنه", key: "old_value", type: "m" },
      { title: "بهای تمام‌شده", key: "cost", type: "m" },
      { title: "سود ناخالص", key: "margin", type: "m" },
    ],
    [],
  );
  const toExcel = () =>
    exportExcel(`فروش طلا ${d.from} تا ${d.to}`, [
      { title: keyTitle[group], value: (r: any) => (group === "day" ? formatJalali(r.date) : group === "doc" ? `${r.no} - ${r.label ?? ""}` : r.label) },
      ...cols.map((c) => ({ title: c.title, value: (r: any) => r[c.key], type: "number" as const })),
    ], d.rows);
  // on screen a few figures share a cell (a main figure over a text-3 second line) so every money column fits the
  // panel; a column that is «—» for the whole result says nothing and is left out (Excel keeps every column)
  type VCol = { title: string; key: string; type: string; sub?: { key: string; type: string; pre?: string; post?: string } };
  const view: VCol[] = [
    { title: "فاکتور", key: "docs", type: "count", sub: { key: "pieces", type: "count", post: "جنس" } },
    { title: "وزن (گرم)", key: "weight", type: "w", sub: { key: "weight750", type: "w", pre: "معادل ۷۵۰:" } },
    { title: "ارزش طلا", key: "gold_value", type: "m" },
    { title: "اجرت", key: "wage", type: "m" },
    { title: "سود", key: "profit", type: "m" },
    { title: "تخفیف", key: "discount", type: "m" },
    { title: "مالیات", key: "tax", type: "m" },
    { title: "سنگ", key: "stone", type: "m" },
    { title: "سکه", key: "coins", type: "m" },
    { title: "شمش", key: "bars", type: "m" },
    { title: "جمع فروش", key: "total", type: "m" },
    { title: "دریافتی (تعویض)", key: "old_value", type: "m", sub: { key: "old_weight750", type: "w", post: "گرم ۷۵۰" } },
    { title: "سود ناخالص", key: "margin", type: "m", sub: { key: "cost", type: "m", pre: "بها" } },
  ];
  const any = (k: string) => !D(t?.[k] ?? 0).isZero() || (d?.rows ?? []).some((r: any) => !D(r[k] ?? 0).isZero());
  const shown = view.filter((c) => c.type === "count" || !d || any(c.key) || (c.sub && any(c.sub.key)));
  const vcell = (c: VCol, r: any) => (
    <div className="sf-gdl">
      <span>{cell(c.type, r?.[c.key])}</span>
      {c.sub && !D(r?.[c.sub.key] ?? 0).isZero() && !(c.sub.key === "weight750" && D(r?.weight750 ?? 0).eq(D(r?.weight ?? 0))) ? (
        <span className="m">{c.sub.pre ? `${c.sub.pre} ` : ""}{cell(c.sub.type, r[c.sub.key])}{c.sub.post ? ` ${c.sub.post}` : ""}</span>
      ) : null}
    </div>
  );
  const cell = (type: string, v: any) =>
    type === "count" ? <span className="sf-num">{faDigits(v ?? 0)}</span> : type === "w" ? (D(v).isZero() ? <span className="sf-zero">—</span> : <span className="sf-num">{gw(v)}</span>) : <Money v={v ?? 0} zero="—" />;
  return (
    <div>
      <PageHeader
        title="گزارش فروش طلا"
        actions={
          <>
            <AiExplainButton report="gold_sales" params={{ from, to, group: group === "product" ? undefined : group }} title="گزارش فروش طلا" compact />
            <Button icon={<Ic icon={FileSpreadsheet} />} disabled={!d} onClick={toExcel}>اکسل</Button>
            <Button icon={<Ic icon={Printer} />} onClick={() => window.print()}>چاپ</Button>
          </>
        }
      />
      <div className="sf-print-head hidden print:block">
        <div className="t">{org.name}</div>
        <div className="s">گزارش فروش طلا {d ? `از ${formatJalali(d.from)} تا ${formatJalali(d.to)}` : ""}</div>
      </div>
      <div className="sf-filters no-print">
        <Segmented size="small" value={presetOf() ?? ""} onChange={(v) => preset(v as "month")} options={[{ value: "today", label: "امروز" }, { value: "month", label: "این ماه" }, { value: "lastMonth", label: "ماه قبل" }, { value: "year", label: "سال مالی" }]} />
        <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" className="!w-36" />
        <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" className="!w-36" />
        <Segmented size="small" value={group} onChange={(v) => setGroup(v as Group)} options={[{ value: "day", label: "روزانه" }, { value: "month", label: "ماهانه" }, { value: "doc", label: "فاکتور" }, { value: "category", label: "دسته" }, { value: "product", label: "نوع کالا" }, { value: "party", label: "مشتری" }]} />
        <label className="flex items-center gap-2 text-[13px] text-ink-2"><Switch size="small" checked={bullion} onChange={setBullion} /> با فروش آبشده</label>
      </div>
      <div className="mb-4 grid sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="فاکتورهای فروش" icon={<Ic icon={ReceiptText} />} value={faDigits(t?.docs ?? 0)} hint={<><span className="sf-num">{faDigits(t?.pieces ?? 0)}</span> جنس</>} />
        <StatCard title="وزن فروش‌رفته" icon={<Ic icon={Weight} />} value={<>{gw(t?.weight750 ?? 0)}<span className="sf-unit">گرم ۷۵۰</span></>} hint={<>طلای کهنه‌ی دریافتی <span className="sf-num">{gw(t?.old_weight750 ?? 0)}</span> گرم</>} />
        <StatCard title="جمع فروش" icon={<Ic icon={ShoppingBag} />} value={<Money v={t?.total ?? 0} unit />} hint={<>اجرت <Money v={t?.wage ?? 0} />، سود <Money v={t?.profit ?? 0} /></>} />
        <StatCard title="سود ناخالص" icon={<Ic icon={TrendingUp} />} value={<Money v={t?.margin ?? 0} unit />} hint={<>بدون مالیات؛ مالیات <Money v={t?.tax ?? 0} /></>} />
      </div>
      <div className="print-sheet sf-card">
        <Table
          className=""
          size="small"
          rowKey="key"
          loading={q.isLoading}
          dataSource={d?.rows ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          onRow={(r: any) => (group === "doc" ? { onClick: () => nav(`/${orgId}/gold/docs/${r.key}`), style: { cursor: "pointer" } } : {})}
          columns={[
            { key: "k", title: keyTitle[group], fixed: "right" as const, render: (_: unknown, r: any) => label(r) },
            ...shown.map((c) => ({ key: c.key, title: c.title, className: "sf-num", render: (_: unknown, r: any) => vcell(c, r) })),
          ]}
          summary={() =>
            t ? (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}>جمع</Table.Summary.Cell>
                  {shown.map((c, i) => (
                    <Table.Summary.Cell key={c.key} index={i + 1} className="sf-num">{vcell(c, t)}</Table.Summary.Cell>
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
