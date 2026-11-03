// «موقعیت طلا»: everything the business holds in gold and owes or is owed in gold on a date —
// آب‌شده, jewellery, used gold, gold at workshops, coins, bars and parties' weight balances (plus
// consignment held for others) — in pure and 750-equivalent grams, at book value and at today's
// buy price; and the bubble of the coins over the last weeks.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Table } from "antd";
import { CircleDollarSign, Gem, Scale, Weight } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { AiExplainButton } from "../../ai/explain/AiExplainButton";
import { Money, StatCard, EmptyState } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { D } from "@shared/money";
import { formatNumber } from "@shared/format";
import { Sparkline } from "../dashboard/kit";
import { G, gw, WBalance } from "./shared";

interface Pos {
  as_of: string;
  rate: { at: string; gram18: string | null; buy_gram18: string | null } | null;
  rows: { key: string; title: string; weight750: string; pure: string; count?: string; book: string; value: string | null; own: boolean }[];
  totals: { weight750: string; pure: string; book: string; value: string | null };
}
interface Bubbles {
  at: string | null;
  rows: { key: string; name: string; price: string | null; domestic: string | null; world: string | null; domestic_amount: string | null; history: { at: string; domestic: string | null }[] }[];
}

export default function Position() {
  const { api, orgId } = useOrg();
  const [to, setTo] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const pos = useQuery({ queryKey: ["gold-position", orgId, to], queryFn: () => api.get<Pos>("/gold/reports/position", to ? { to } : {}) });
  const bub = useQuery({ queryKey: ["gold-bubbles", orgId, days], queryFn: () => api.get<Bubbles>("/gold/reports/bubbles", { days }) });
  const p = pos.data;
  return (
    <div>
      <PageHeader
        title="موقعیت طلا"
        actions={
          <>
            <DateInput allowClear placeholder="تا تاریخ (امروز)" value={to} onChange={setTo} className="!w-44" />
            <AiExplainButton report="gold_position" params={{ to }} title="موقعیت طلا" compact />
          </>
        }
      />
      <div className="mb-4 grid sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="طلای خالص" icon={<Ic icon={Gem} />} value={<span className="sf-num">{gw(p?.totals.pure ?? 0)}</span>} />
        <StatCard title="معادل ۷۵۰" icon={<Ic icon={Weight} />} value={<span className="sf-num">{gw(p?.totals.weight750 ?? 0)}</span>} />
        <StatCard title="ارزش به نرخ خرید امروز" icon={<Ic icon={CircleDollarSign} />} value={p?.totals.value ? <Money v={p.totals.value} /> : <span className="sf-zero">—</span>} />
        <StatCard title="بهای دفتری" icon={<Ic icon={Scale} />} value={<Money v={p?.totals.book ?? 0} />} />
      </div>
      <div className="sf-card mb-4">
        <Table
          size="small"
          rowKey="key"
          loading={pos.isLoading}
          dataSource={p?.rows ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          rowClassName={(r) => (!r.own ? "row-muted" : "")}
          columns={[
            { key: "t", dataIndex: "title", title: "شرح" },
            { key: "n", dataIndex: "count", title: "تعداد", className: "sf-num", render: (v) => (v && !D(v).isZero() ? <span className="sf-num">{formatNumber(v)}</span> : <span className="sf-zero">—</span>) },
            { key: "w", dataIndex: "weight750", title: "معادل ۷۵۰", className: "sf-num", render: (v, r) => (r.key === "parties" ? <WBalance v={v} /> : <G v={v} />) },
            { key: "p", dataIndex: "pure", title: "طلای خالص", className: "sf-num", render: (v, r) => (r.key === "parties" ? <WBalance v={v} /> : <G v={v} />) },
            { key: "b", dataIndex: "book", title: "بهای دفتری", className: "sf-num", render: (v) => <Money v={v} zero="—" /> },
            { key: "v", dataIndex: "value", title: "به نرخ خرید امروز", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
          ]}
          summary={() =>
            p ? (
              <Table.Summary.Row className="sf-total-row">
                <Table.Summary.Cell index={0}>جمع دارایی طلایی</Table.Summary.Cell>
                <Table.Summary.Cell index={1} />
                <Table.Summary.Cell index={2} className="sf-num">{gw(p.totals.weight750)}</Table.Summary.Cell>
                <Table.Summary.Cell index={3} className="sf-num">{gw(p.totals.pure)}</Table.Summary.Cell>
                <Table.Summary.Cell index={4} className="sf-num"><Money v={p.totals.book} /></Table.Summary.Cell>
                <Table.Summary.Cell index={5} className="sf-num"><Money v={p.totals.value ?? 0} zero="—" /></Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </div>
      <div className="sf-card">
        <div className="sf-sec-t flex items-center justify-between p-3">
          <span>حباب سکه‌ها</span>
          <Segmented size="small" value={days} onChange={(v) => setDays(Number(v))} options={[{ value: 7, label: "هفته" }, { value: 30, label: "ماه" }, { value: 90, label: "سه ماه" }]} />
        </div>
        {bub.data && !bub.data.rows.length ? (
          <EmptyState compact title="برای سکه‌ها هنوز قیمتی در تابلو ثبت نشده است." />
        ) : (
          <Table
            size="small"
            rowKey="key"
            loading={bub.isLoading}
            dataSource={bub.data?.rows ?? []}
            pagination={false}
            scroll={{ x: "max-content" }}
            columns={[
              { key: "n", dataIndex: "name", title: "سکه" },
              { key: "p", dataIndex: "price", title: "قیمت فروش", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
              { key: "d", dataIndex: "domestic", title: "حباب (داخلی)", className: "sf-num", render: (v, r) => (v ? <span className="sf-num">{formatNumber(v, { dp: 2 })}٪ <span className="text-ink-3">(<Money v={r.domestic_amount ?? 0} />)</span></span> : <span className="sf-zero">—</span>) },
              { key: "w", dataIndex: "world", title: "حباب (جهانی)", className: "sf-num", render: (v) => (v ? <span className="sf-num">{formatNumber(v, { dp: 2 })}٪</span> : <span className="sf-zero">—</span>) },
              {
                key: "h", title: "روند", render: (_, r) => {
                  const vals = r.history.filter((h) => h.domestic !== null).map((h) => Number(h.domestic));
                  return vals.length > 1 ? <div className="w-32"><Sparkline values={vals} h={24} label={`روند حباب ${r.name}`} /></div> : <span className="sf-zero">—</span>;
                },
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
