// Stock and weight report (گزارش موجودی و وزنی): pieces in the showcase by category, weighed
// gold and coins from the ledger with book and market value, and every party's weight
// account (wholesalers, workshops, consignors). Each table exports to Excel.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Table, Tabs, Segmented } from "antd";
import { Coins, FileSpreadsheet, Gem, Printer, Tag, Weight } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { DateInput } from "../../components/inputs";
import { Money, Balance, StatCard, JDate } from "../../components/display";
import { exportExcel } from "../../lib/excel";
import { D } from "@shared/money";
import { faDigits, formatNumber } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { G, gw, WBalance } from "./shared";

const BULK_TITLE: Record<string, string> = {
  gold_inventory: "موجودی مصنوعات (دفتر)", gold_old: "طلای مستعمل و شکسته", gold_bullion: "آبشده و شمش", gold_at_workshop: "طلای ما نزد کارگاه‌ها",
};

export default function StockReport() {
  const { api, orgId, org } = useOrg();
  const nav = useNavigate();
  const [to, setTo] = useState<string | null>(null);
  const [tab, setTab] = useState("pieces");
  const [scope, setScope] = useState<string>("all");
  const q = useQuery({ queryKey: ["gold-stock", orgId, to], queryFn: () => api.get("/gold/reports/stock", { to }) });
  const p = useQuery({ queryKey: ["gold-party-balances", orgId, scope, to], queryFn: () => api.get("/gold/reports/parties", { to, scope: scope === "all" ? undefined : scope }) });
  const d = q.data;
  const g18 = d?.rate?.gram18;
  const title = `گزارش موجودی و وزنی ${d ? `تا ${formatJalali(d.as_of)}` : ""}`;
  return (
    <div>
      <PageHeader
        title="گزارش موجودی و وزنی"
        subtitle={<span className="sf-doc-meta">{d?.rate ? <>ارزش‌گذاری با گرم ۱۸ عیار <span className="sf-num ms-1">{formatNumber(g18 ?? 0)}</span></> : "قیمت روز ثبت نشده؛ ارزش بازار محاسبه نمی‌شود"}</span>}
        actions={
          <>
            <DateInput value={to} onChange={setTo} placeholder="تا امروز" allowClear className="!w-36" />
            <Button icon={<Ic icon={Printer} />} onClick={() => window.print()}>چاپ</Button>
          </>
        }
      />
      <div className="mb-4 grid sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="اجناس موجود" icon={<Ic icon={Tag} />} value={<>{gw(d?.totals.w750 ?? 0)}<span className="sf-unit">گرم ۷۵۰</span></>} hint={d ? <><span className="sf-num">{faDigits(d.totals.count)}</span> جنس، امانی <span className="sf-num">{faDigits(d.totals.consigned_count)}</span></> : null} />
        <StatCard title="کل طلای ما" icon={<Ic icon={Weight} />} value={<>{gw(d?.valuation.gold_w750 ?? 0)}<span className="sf-unit">گرم ۷۵۰</span></>} hint="مصنوعات، مستعمل، آبشده و نزد کارگاه" />
        <StatCard title="ارزش روز طلا" icon={<Ic icon={Gem} />} value={<Money v={d?.valuation.gold_value ?? 0} unit />} hint={<>بهای دفتری <Money v={d?.valuation.gold_book ?? 0} /></>} />
        <StatCard title="سکه‌ها به قیمت روز" icon={<Ic icon={Coins} />} value={<Money v={d?.valuation.coins_value ?? 0} unit />} hint={<>بهای دفتری <Money v={d?.valuation.coins_book ?? 0} /></>} />
      </div>
      {d && !D(d.check.diff).isZero() ? (
        <Alert
          className="!mb-3"
          type="warning"
          showIcon
          title={
            <span>
              <b>اختلاف وزن.</b> وزن اجناس موجود (<span className="sf-num">{gw(d.check.pieces_w)}</span> گرم ۷۵۰) با مانده‌ی وزنی «موجودی مصنوعات» در دفتر (<span className="sf-num">{gw(d.check.ledger_w)}</span>) <span className="sf-num">{gw(D(d.check.diff).abs())}</span> گرم اختلاف دارد.
              اتیکت‌هایی که بدون سند ساخته شده‌اند را با سند «موجودی اول دوره» ثبت کنید.
            </span>
          }
        />
      ) : null}
      <div className="print-sheet sf-card px-5 pb-4">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-semibold">{org.name}</div>
          <div className="font-semibold">{title}</div>
        </div>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "pieces",
              label: "اجناس به تفکیک دسته",
              children: (
                <>
                  <div className="no-print mb-2 flex justify-end">
                    <Button size="small" icon={<Ic icon={FileSpreadsheet} />} onClick={() => exportExcel("موجودی اجناس طلا", [
                      { title: "دسته", value: (r: any) => r.category_name ?? "بدون دسته" },
                      { title: "مالکیت", value: (r: any) => (r.ownership === "consignment" ? "امانی" : "متعلق به ما") },
                      { title: "تعداد", value: (r: any) => r.count, type: "number" },
                      { title: "وزن کل", value: (r: any) => r.gross, type: "number" },
                      { title: "وزن سنگ", value: (r: any) => r.stone, type: "number" },
                      { title: "وزن خالص", value: (r: any) => r.net, type: "number" },
                      { title: "معادل ۷۵۰", value: (r: any) => r.w750, type: "number" },
                      { title: "ارزش روز طلا", value: (r: any) => r.value, type: "number" },
                    ], d?.categories ?? [])}>اکسل</Button>
                  </div>
                  <Table
                    className=""
                    size="small"
                    rowKey={(r: any) => `${r.category_id ?? "none"}-${r.ownership}`}
                    loading={q.isLoading}
                    dataSource={d?.categories ?? []}
                    pagination={false}
                    scroll={{ x: "max-content" }}
                    onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/gold/items?${r.category_id ? `category=${r.category_id}&` : ""}ownership=${r.ownership}`), style: { cursor: "pointer" } })}
                    columns={[
                      { key: "c", title: "دسته", render: (_, r: any) => r.category_name ?? <span className="text-ink-3">بدون دسته</span> },
                      { key: "o", dataIndex: "ownership", title: "مالکیت", render: (v) => (v === "consignment" ? "امانی" : "متعلق به ما") },
                      { key: "n", dataIndex: "count", title: "تعداد", className: "sf-num", render: (v, r: any) => <span className="sf-num">{faDigits(v)}{r.reserved ? <span className="text-[12px] text-ink-3"> ({faDigits(r.reserved)} رزرو)</span> : null}</span> },
                      { key: "g", dataIndex: "gross", title: "وزن کل", className: "sf-num", render: (v) => <span className="sf-num">{gw(v)}</span> },
                      { key: "s", dataIndex: "stone", title: "سنگ", className: "sf-num", render: (v) => <G v={v} /> },
                      { key: "t", dataIndex: "net", title: "خالص", className: "sf-num", render: (v) => <span className="sf-num">{gw(v)}</span> },
                      { key: "w", dataIndex: "w750", title: "معادل ۷۵۰", className: "sf-num", render: (v) => <span className="sf-num font-medium">{gw(v)}</span> },
                      { key: "v", dataIndex: "value", title: "ارزش روز طلا", className: "sf-num", render: (v) => <Money v={v} /> },
                    ]}
                    summary={() =>
                      d ? (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={2}>جمع</Table.Summary.Cell>
                          <Table.Summary.Cell index={2} className="sf-num"><span className="sf-num">{faDigits(d.totals.count)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={3} className="sf-num"><span className="sf-num">{gw(d.totals.gross)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={4} className="sf-num"><span className="sf-num">{gw(d.totals.stone)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={5} className="sf-num"><span className="sf-num">{gw(d.totals.net)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} className="sf-num"><span className="sf-num">{gw(d.totals.w750)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={7} className="sf-num"><Money v={D(d.totals.w750).times(D(g18 ?? 0)).toDecimalPlaces(org.money_decimals).toString()} /></Table.Summary.Cell>
                        </Table.Summary.Row>
                      ) : null
                    }
                  />
                </>
              ),
            },
            {
              key: "bulk",
              label: "طلای وزنی و سکه",
              children: (
                <div className="grid gap-3 lg:grid-cols-2">
                  <Section title="حساب‌های وزنی طلا (از دفتر)" bodyClass="p-0">
                    <Table
                      className=""
                      size="small"
                      rowKey="key"
                      dataSource={d?.bulk ?? []}
                      pagination={false}
                      columns={[
                        { key: "k", dataIndex: "key", title: "حساب", render: (v) => BULK_TITLE[v] ?? v },
                        { key: "w", dataIndex: "w", title: "وزن ۷۵۰", className: "sf-num", render: (v) => <span className="sf-num">{gw(v)}</span> },
                        { key: "r", dataIndex: "rial", title: "بهای دفتری", className: "sf-num", render: (v) => <Money v={v} /> },
                        { key: "v", dataIndex: "value", title: "ارزش روز", className: "sf-num", render: (v) => <Money v={v} /> },
                      ]}
                    />
                  </Section>
                  <Section
                    title="سکه‌ها"
                    bodyClass="p-0"
                    extra={<Button size="small" type="link" icon={<Ic icon={FileSpreadsheet} />} onClick={() => exportExcel("موجودی سکه", [
                      { title: "سکه", value: (r: any) => r.name }, { title: "تعداد", value: (r: any) => r.qty, type: "number" }, { title: "میانگین بها", value: (r: any) => r.avg_cost, type: "number" },
                      { title: "بهای دفتری", value: (r: any) => r.value, type: "number" }, { title: "قیمت روز", value: (r: any) => r.price, type: "number" }, { title: "ارزش روز", value: (r: any) => r.market_value, type: "number" },
                    ], d?.coins ?? [])}>اکسل</Button>}
                  >
                    <Table
                      className=""
                      size="small"
                      rowKey="id"
                      dataSource={d?.coins ?? []}
                      pagination={false}
                      columns={[
                        { key: "n", dataIndex: "name", title: "سکه" },
                        { key: "q", dataIndex: "qty", title: "تعداد", className: "sf-num", render: (v) => <span className="sf-num">{faDigits(D(v).toString())}</span> },
                        { key: "a", dataIndex: "avg_cost", title: "میانگین بها", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
                        { key: "b", title: "بهای دفتری", className: "sf-num", render: (_, r: any) => <Money v={r.value} zero="—" /> },
                        { key: "p", dataIndex: "price", title: "قیمت روز", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
                        { key: "v", dataIndex: "market_value", title: "ارزش روز", className: "sf-num", render: (v) => <Money v={v ?? 0} zero="—" /> },
                      ]}
                    />
                  </Section>
                </div>
              ),
            },
            {
              key: "parties",
              label: "حساب وزنی اشخاص",
              children: (
                <>
                  <div className="no-print mb-2 flex flex-wrap items-center gap-2">
                    <Segmented size="small" value={scope} onChange={(v) => setScope(String(v))} options={[{ value: "all", label: "همه" }, { value: "parties", label: "همکار و بنکدار" }, { value: "workshop", label: "کارگاه‌ها" }, { value: "consignment", label: "امانت‌گذاران" }]} />
                    <span className="text-[12px] text-ink-3">«بس»: ما به او طلا بدهکاریم؛ «بد»: او به ما بدهکار است.</span>
                    <Button className="ms-auto" size="small" icon={<Ic icon={FileSpreadsheet} />} onClick={() => exportExcel("حساب وزنی اشخاص", [
                      { title: "کد", value: (r: any) => r.code }, { title: "نام", value: (r: any) => r.name },
                      { title: "مانده وزنی ۷۵۰", value: (r: any) => r.gold_w, type: "number" }, { title: "ریالی حساب وزنی", value: (r: any) => r.gold_rial, type: "number" },
                      { title: "نزد کارگاه ۷۵۰", value: (r: any) => r.workshop_w, type: "number" }, { title: "امانی ۷۵۰", value: (r: any) => r.consign_w, type: "number" },
                      { title: "مانده ریالی", value: (r: any) => r.rial, type: "number" }, { title: "آخرین گردش", value: (r: any) => r.last_date },
                    ], p.data?.rows ?? [])}>اکسل</Button>
                  </div>
                  <Table
                    className=""
                    size="small"
                    rowKey="detail_id"
                    loading={p.isLoading}
                    dataSource={p.data?.rows ?? []}
                    pagination={{ pageSize: 100, hideOnSinglePage: true }}
                    scroll={{ x: "max-content" }}
                    onRow={(r: any) => ({ onClick: () => r.party_id && nav(`/${orgId}/parties/${r.party_id}`), style: { cursor: "pointer" } })}
                    columns={[
                      { key: "c", dataIndex: "code", title: "کد", render: (v) => <span className="sf-docno">{faDigits(v)}</span> },
                      { key: "n", dataIndex: "name", title: "نام" },
                      { key: "gw", dataIndex: "gold_w", title: "حساب وزنی (۷۵۰)", className: "sf-num", render: (v) => <WBalance v={v} /> },
                      { key: "gr", dataIndex: "gold_rial", title: "ریالی حساب وزنی", className: "sf-num", render: (v) => <Balance v={v} /> },
                      { key: "ww", dataIndex: "workshop_w", title: "نزد کارگاه", className: "sf-num", render: (v) => <WBalance v={v} /> },
                      { key: "cw", dataIndex: "consign_w", title: "امانی نزد ما", className: "sf-num", render: (v) => <WBalance v={v} /> },
                      { key: "r", dataIndex: "rial", title: "مانده‌ی ریالی", className: "sf-num", render: (v) => <Balance v={v} /> },
                      { key: "d", dataIndex: "last_date", title: "آخرین گردش", render: (v) => <JDate v={v} /> },
                    ]}
                    summary={() =>
                      p.data ? (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={2}>جمع</Table.Summary.Cell>
                          <Table.Summary.Cell index={2} className="sf-num"><WBalance v={p.data.totals.gold_w} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={3} className="sf-num"><Balance v={p.data.totals.gold_rial} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={4} className="sf-num"><WBalance v={p.data.totals.workshop_w} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={5} className="sf-num"><WBalance v={p.data.totals.consign_w} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} className="sf-num"><Balance v={p.data.totals.rial} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={7} />
                        </Table.Summary.Row>
                      ) : null
                    }
                  />
                </>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
