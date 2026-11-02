// Daily cash report (گزارش صندوق روزانه): opening, received, paid and closing of every currency
// in every cash box for a day, a counted-amount column for the end-of-day till check, the day's
// deals and the movements of one box.
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Select, Table, Tag } from "antd";
import { PrinterOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { DateInput, NumberInput } from "../../components/inputs";
import { EmptyState, Money } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { addDays, formatJalali, todayISO } from "@shared/jalali";
import { CurrencyChip, FxAmount, KIND_FA } from "./shared";

export default function CashReport() {
  const { api, org, orgId, unit } = useOrg();
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";
  const [date, setDate] = useState<string>(todayISO(tz));
  const [box, setBox] = useState<string | null>(null);
  const [counted, setCounted] = useState<Record<string, string | null>>({});
  const q = useQuery({ queryKey: ["fx-cash-report", date, box], queryFn: () => api.get("/fx/reports/cash", { date, cash_box_id: box }) });
  const d = q.data;
  const baseDp = org.money_decimals ?? 0;
  const dp = (r: any) => (r.is_base ? baseDp : Number(r.decimals ?? 2));
  const code = (r: any) => (r.is_base ? unit : r.code);
  const deals = useMemo(() => {
    const list = d?.deals ?? [];
    return { n: list.reduce((a: number, x: any) => a + Number(x.n), 0), profit: list.reduce((a: any, x: any) => a.plus(D(x.profit)), D(0)).toFixed(), fees: list.reduce((a: any, x: any) => a.plus(D(x.fees)), D(0)).toFixed(), list };
  }, [d]);
  const key = (r: any) => `${r.cash_box_id}:${r.currency_id}`;

  return (
    <div>
      <PageHeader title="گزارش صندوق روزانه" actions={<Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Button icon={<RightOutlined />} onClick={() => setDate(addDays(date, -1))} aria-label="روز قبل" />
        <DateInput value={date} onChange={(v) => v && setDate(v)} className="!w-36" />
        <Button icon={<LeftOutlined />} onClick={() => setDate(addDays(date, 1))} aria-label="روز بعد" />
        <Select
          className="!w-56"
          allowClear
          placeholder="همه‌ی صندوق‌ها"
          value={box ?? undefined}
          onChange={(v) => setBox(v ?? null)}
          options={(d?.boxes ?? []).map((b: any) => ({ value: b.id, label: b.name }))}
        />
        <span className="text-xs text-muted">{formatJalali(date, { style: "full" })}</span>
      </div>
      <div className="print-sheet">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-bold">{org.name}</div>
          <div>گزارش صندوق — {formatJalali(date, { style: "full" })}{d?.cash_box ? ` — ${d.cash_box.name}` : ""}</div>
        </div>
        <Section title="موجودی صندوق‌ها" bodyClass="p-0">
          <Table
            className="tz-table"
            size="small"
            rowKey={key}
            loading={q.isLoading}
            dataSource={d?.rows ?? []}
            pagination={false}
            scroll={{ x: "max-content" }}
            locale={{ emptyText: <EmptyState title="در این روز گردش و موجودی‌ای ثبت نشده است" /> }}
            columns={[
              { key: "box", dataIndex: "cash_box", title: "صندوق" },
              { key: "cur", title: "ارز", render: (_, r: any) => <span className="flex items-center gap-1.5"><CurrencyChip c={{ code: r.is_base ? unit : r.code, kind: "fiat" }} /> <span className="text-xs text-muted">{r.is_base ? "" : r.name}</span></span> },
              { key: "open", title: "اول روز", align: "left", render: (_, r: any) => <FxAmount v={r.opening} dp={dp(r)} /> },
              { key: "in", title: "دریافت", align: "left", render: (_, r: any) => (D(r.inflow).isZero() ? <span className="text-muted">—</span> : <FxAmount v={r.inflow} dp={dp(r)} className="tz-pos" />) },
              { key: "out", title: "پرداخت", align: "left", render: (_, r: any) => (D(r.outflow).isZero() ? <span className="text-muted">—</span> : <FxAmount v={r.outflow} dp={dp(r)} className="tz-neg" />) },
              { key: "close", title: "پایان روز", align: "left", render: (_, r: any) => <FxAmount v={r.closing} dp={dp(r)} strong /> },
              { key: "value", title: "ارزش دفتری", align: "left", render: (_, r: any) => (r.is_base ? <span className="text-muted">—</span> : <Money v={r.book_value} />) },
              {
                key: "count",
                title: "شمارش",
                width: 150,
                render: (_, r: any) => <NumberInput size="small" decimals={dp(r)} value={counted[key(r)] ?? null} onChange={(v) => setCounted({ ...counted, [key(r)]: v })} placeholder="شمرده‌شده" />,
              },
              {
                key: "diff",
                title: "اختلاف",
                align: "left",
                render: (_, r: any) => {
                  const c = counted[key(r)];
                  if (c === null || c === undefined || c === "") return <span className="text-muted">—</span>;
                  const diff = D(c).minus(D(r.closing));
                  return diff.isZero() ? <Tag color="green" variant="filled" className="!m-0">درست</Tag> : <FxAmount v={diff.toFixed()} code={code(r)} dp={dp(r)} colored />;
                },
              },
            ]}
          />
        </Section>

        {(d?.totals ?? []).length > 1 || !box ? (
          <Section className="mt-4" title="جمع به تفکیک ارز" bodyClass="p-0">
            <Table
              className="tz-table"
              size="small"
              rowKey="currency_id"
              dataSource={d?.totals ?? []}
              pagination={false}
              columns={[
                { key: "c", title: "ارز", render: (_, r: any) => <b className="ltr">{r.code === org.base_currency ? unit : r.code}</b> },
                { key: "o", title: "اول روز", align: "left", render: (_, r: any) => <FxAmount v={r.opening} dp={r.code === org.base_currency ? baseDp : r.decimals} /> },
                { key: "i", title: "دریافت", align: "left", render: (_, r: any) => <FxAmount v={r.inflow} dp={r.code === org.base_currency ? baseDp : r.decimals} /> },
                { key: "p", title: "پرداخت", align: "left", render: (_, r: any) => <FxAmount v={r.outflow} dp={r.code === org.base_currency ? baseDp : r.decimals} /> },
                { key: "x", title: "پایان روز", align: "left", render: (_, r: any) => <FxAmount v={r.closing} dp={r.code === org.base_currency ? baseDp : r.decimals} strong /> },
                { key: "v", title: "ارزش دفتری", align: "left", render: (_, r: any) => <Money v={r.book_value} /> },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={5}>ارزش کل صندوق‌ها (دفتری)</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="left"><Money v={d?.value_total ?? 0} unit /></Table.Summary.Cell>
                </Table.Summary.Row>
              )}
            />
          </Section>
        ) : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Section title={`معاملات این روز${box ? " در این صندوق" : ""}`}>
            {deals.n ? (
              <div className="grid gap-2 text-sm">
                {deals.list.map((x: any) => (
                  <div key={x.kind} className="flex justify-between border-b border-dashed border-line pb-1">
                    <span>{KIND_FA[x.kind]} <span className="num text-xs text-muted">({faDigits(x.n)})</span></span>
                    <Money v={x.volume} />
                  </div>
                ))}
                <div className="flex justify-between"><span className="text-muted">سود معاملات</span><Money v={deals.profit} colored /></div>
                <div className="flex justify-between"><span className="text-muted">کارمزد</span><Money v={deals.fees} /></div>
                <Link className="no-print text-xs" to={`/${orgId}/fx/deals`}>فهرست معاملات</Link>
              </div>
            ) : (
              <div className="text-xs text-muted">معامله‌ای ثبت نشده است</div>
            )}
          </Section>
          {box ? (
            <Section title="گردش این صندوق" bodyClass="p-0">
              <Table
                className="tz-table"
                size="small"
                rowKey={(_, i) => String(i)}
                dataSource={d?.moves ?? []}
                pagination={false}
                locale={{ emptyText: <EmptyState title="گردشی ندارد" /> }}
                columns={[
                  { key: "no", dataIndex: "no", title: "سند", render: (v, r: any) => <Link to={`/${orgId}/accounting/vouchers/${r.voucher_id}`} className="num">{faDigits(v)}</Link> },
                  { key: "d", dataIndex: "description", title: "شرح", ellipsis: true },
                  { key: "c", dataIndex: "code", title: "ارز", render: (v) => <span className="ltr text-xs">{v === org.base_currency ? unit : v}</span> },
                  { key: "i", dataIndex: "inflow", title: "دریافت", align: "left", render: (v) => (D(v).isZero() ? null : <span className="num tz-pos">{faDigits(D(v).toFixed())}</span>) },
                  { key: "o", dataIndex: "outflow", title: "پرداخت", align: "left", render: (v) => (D(v).isZero() ? null : <span className="num tz-neg">{faDigits(D(v).toFixed())}</span>) },
                ]}
              />
            </Section>
          ) : (
            <Section title="گردش صندوق">
              <div className="text-xs text-muted">برای دیدن ریز دریافت و پرداخت‌ها یک صندوق را انتخاب کنید.</div>
            </Section>
          )}
        </div>
        <div className="mt-8 hidden grid-cols-2 gap-6 text-center text-xs print:grid">
          <div className="border-t border-line pt-1">امضای صندوقدار</div>
          <div className="border-t border-line pt-1">امضای مدیر</div>
        </div>
      </div>
    </div>
  );
}
