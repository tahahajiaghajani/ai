// Stock and weight report (گزارش موجودی و وزنی): pieces in the showcase by category, weighed
// gold and coins from the ledger with book and market value, and every party's weight
// account (wholesalers, workshops, consignors). Each table exports to Excel.
import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Table, Tabs, Segmented } from "antd";
import { FileExcelOutlined, PrinterOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { DateInput } from "../../components/inputs";
import { Money, Balance, StatCard, JDate } from "../../components/display";
import { exportExcel } from "../../lib/excel";
import { D } from "@shared/money";
import { faDigits, formatNumber, formatWeight } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { WBalance } from "./shared";

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
        subtitle={d?.rate ? <>ارزش‌گذاری با گرم ۱۸ عیار <span className="num">{formatNumber(g18 ?? 0)}</span></> : "قیمت روز ثبت نشده؛ ارزش بازار محاسبه نمی‌شود"}
        actions={
          <>
            <DateInput value={to} onChange={setTo} placeholder="تا امروز" allowClear className="!w-36" />
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ</Button>
          </>
        }
      />
      <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="اجناس موجود" value={<span className="num">{faDigits(d?.totals.count ?? 0)} جنس، {formatWeight(d?.totals.w750 ?? 0)} گرم</span>} hint={d ? <>امانی: {faDigits(d.totals.consigned_count)} جنس، <span className="num">{formatWeight(d.totals.consigned_w750)}</span> گرم</> : null} tone="gold" />
        <StatCard title="کل طلای ما (۷۵۰)" value={<span className="num">{formatWeight(d?.valuation.gold_w750 ?? 0)} گرم</span>} hint={<>مصنوعات، مستعمل، آبشده و نزد کارگاه</>} />
        <StatCard title="ارزش روز طلا" value={<Money v={d?.valuation.gold_value ?? 0} />} hint={<>بهای دفتری: <Money v={d?.valuation.gold_book ?? 0} /></>} tone="ok" />
        <StatCard title="سکه‌ها به قیمت روز" value={<Money v={d?.valuation.coins_value ?? 0} />} hint={<>بهای دفتری: <Money v={d?.valuation.coins_book ?? 0} /></>} />
      </div>
      {d && !D(d.check.diff).isZero() ? (
        <Alert
          className="!mb-3"
          type="warning"
          showIcon
          title={
            <span>
              وزن اجناس موجود (<span className="num">{formatWeight(d.check.pieces_w)}</span> گرم ۷۵۰) با مانده‌ی وزنی «موجودی مصنوعات» در دفتر (<span className="num">{formatWeight(d.check.ledger_w)}</span>) <span className="num">{formatWeight(D(d.check.diff).abs())}</span> گرم اختلاف دارد.
              اتیکت‌هایی که بدون سند ساخته شده‌اند را با سند «موجودی اول دوره» ثبت کنید.
            </span>
          }
        />
      ) : null}
      <div className="print-sheet tz-card p-3 md:p-4">
        <div className="mb-3 hidden text-center print:block">
          <div className="text-lg font-bold">{org.name}</div>
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
                    <Button size="small" icon={<FileExcelOutlined />} onClick={() => exportExcel("موجودی اجناس طلا", [
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
                    className="tz-table"
                    size="small"
                    rowKey={(r: any) => `${r.category_id ?? "none"}-${r.ownership}`}
                    loading={q.isLoading}
                    dataSource={d?.categories ?? []}
                    pagination={false}
                    scroll={{ x: "max-content" }}
                    onRow={(r: any) => ({ onClick: () => nav(`/${orgId}/gold/items?${r.category_id ? `category=${r.category_id}&` : ""}ownership=${r.ownership}`), style: { cursor: "pointer" } })}
                    columns={[
                      { key: "c", title: "دسته", render: (_, r: any) => r.category_name ?? <span className="text-muted">بدون دسته</span> },
                      { key: "o", dataIndex: "ownership", title: "مالکیت", render: (v) => (v === "consignment" ? "امانی" : "متعلق به ما") },
                      { key: "n", dataIndex: "count", title: "تعداد", align: "left", render: (v, r: any) => <span className="num">{faDigits(v)}{r.reserved ? <span className="text-xs text-muted"> ({faDigits(r.reserved)} رزرو)</span> : null}</span> },
                      { key: "g", dataIndex: "gross", title: "وزن کل", align: "left", render: (v) => <span className="num">{formatWeight(v)}</span> },
                      { key: "s", dataIndex: "stone", title: "سنگ", align: "left", render: (v) => <span className="num">{formatWeight(v)}</span> },
                      { key: "t", dataIndex: "net", title: "خالص", align: "left", render: (v) => <span className="num">{formatWeight(v)}</span> },
                      { key: "w", dataIndex: "w750", title: "معادل ۷۵۰", align: "left", render: (v) => <b className="num text-gold">{formatWeight(v)}</b> },
                      { key: "v", dataIndex: "value", title: "ارزش روز طلا", align: "left", render: (v) => <Money v={v} /> },
                    ]}
                    summary={() =>
                      d ? (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={2}>جمع</Table.Summary.Cell>
                          <Table.Summary.Cell index={2} align="left"><span className="num">{faDigits(d.totals.count)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={3} align="left"><span className="num">{formatWeight(d.totals.gross)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={4} align="left"><span className="num">{formatWeight(d.totals.stone)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={5} align="left"><span className="num">{formatWeight(d.totals.net)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="left"><span className="num">{formatWeight(d.totals.w750)}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={7} align="left"><Money v={D(d.totals.w750).times(D(g18 ?? 0)).toDecimalPlaces(org.money_decimals).toString()} /></Table.Summary.Cell>
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
                      className="tz-table"
                      size="small"
                      rowKey="key"
                      dataSource={d?.bulk ?? []}
                      pagination={false}
                      columns={[
                        { key: "k", dataIndex: "key", title: "حساب", render: (v) => BULK_TITLE[v] ?? v },
                        { key: "w", dataIndex: "w", title: "وزن ۷۵۰", align: "left", render: (v) => <span className="num">{formatWeight(v)}</span> },
                        { key: "r", dataIndex: "rial", title: "بهای دفتری", align: "left", render: (v) => <Money v={v} /> },
                        { key: "v", dataIndex: "value", title: "ارزش روز", align: "left", render: (v) => <Money v={v} /> },
                      ]}
                    />
                  </Section>
                  <Section
                    title="سکه‌ها"
                    bodyClass="p-0"
                    extra={<Button size="small" type="link" icon={<FileExcelOutlined />} onClick={() => exportExcel("موجودی سکه", [
                      { title: "سکه", value: (r: any) => r.name }, { title: "تعداد", value: (r: any) => r.qty, type: "number" }, { title: "میانگین بها", value: (r: any) => r.avg_cost, type: "number" },
                      { title: "بهای دفتری", value: (r: any) => r.value, type: "number" }, { title: "قیمت روز", value: (r: any) => r.price, type: "number" }, { title: "ارزش روز", value: (r: any) => r.market_value, type: "number" },
                    ], d?.coins ?? [])}>اکسل</Button>}
                  >
                    <Table
                      className="tz-table"
                      size="small"
                      rowKey="id"
                      dataSource={d?.coins ?? []}
                      pagination={false}
                      columns={[
                        { key: "n", dataIndex: "name", title: "سکه" },
                        { key: "q", dataIndex: "qty", title: "تعداد", align: "left", render: (v) => <span className="num">{faDigits(D(v).toString())}</span> },
                        { key: "a", dataIndex: "avg_cost", title: "میانگین بها", align: "left", render: (v) => <Money v={v ?? 0} zero="—" /> },
                        { key: "b", title: "بهای دفتری", align: "left", render: (_, r: any) => <Money v={r.value} zero="—" /> },
                        { key: "p", dataIndex: "price", title: "قیمت روز", align: "left", render: (v) => <Money v={v ?? 0} zero="—" /> },
                        { key: "v", dataIndex: "market_value", title: "ارزش روز", align: "left", render: (v) => <Money v={v ?? 0} zero="—" /> },
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
                    <span className="text-xs text-muted">«بس» یعنی ما به او طلا بدهکاریم؛ «بد» یعنی او به ما بدهکار است.</span>
                    <Button className="ms-auto" size="small" icon={<FileExcelOutlined />} onClick={() => exportExcel("حساب وزنی اشخاص", [
                      { title: "کد", value: (r: any) => r.code }, { title: "نام", value: (r: any) => r.name },
                      { title: "مانده وزنی ۷۵۰", value: (r: any) => r.gold_w, type: "number" }, { title: "ریالی حساب وزنی", value: (r: any) => r.gold_rial, type: "number" },
                      { title: "نزد کارگاه ۷۵۰", value: (r: any) => r.workshop_w, type: "number" }, { title: "امانی ۷۵۰", value: (r: any) => r.consign_w, type: "number" },
                      { title: "مانده ریالی", value: (r: any) => r.rial, type: "number" }, { title: "آخرین گردش", value: (r: any) => r.last_date },
                    ], p.data?.rows ?? [])}>اکسل</Button>
                  </div>
                  <Table
                    className="tz-table"
                    size="small"
                    rowKey="detail_id"
                    loading={p.isLoading}
                    dataSource={p.data?.rows ?? []}
                    pagination={{ pageSize: 100, hideOnSinglePage: true }}
                    scroll={{ x: "max-content" }}
                    onRow={(r: any) => ({ onClick: () => r.party_id && nav(`/${orgId}/parties/${r.party_id}`), style: { cursor: "pointer" } })}
                    columns={[
                      { key: "c", dataIndex: "code", title: "کد", render: (v) => <span className="num">{faDigits(v)}</span> },
                      { key: "n", dataIndex: "name", title: "نام" },
                      { key: "gw", dataIndex: "gold_w", title: "حساب وزنی (۷۵۰)", align: "left", render: (v) => <WBalance v={v} /> },
                      { key: "gr", dataIndex: "gold_rial", title: "ریالی حساب وزنی", align: "left", render: (v) => <Balance v={v} /> },
                      { key: "ww", dataIndex: "workshop_w", title: "نزد کارگاه", align: "left", render: (v) => <WBalance v={v} /> },
                      { key: "cw", dataIndex: "consign_w", title: "امانی نزد ما", align: "left", render: (v) => <WBalance v={v} /> },
                      { key: "r", dataIndex: "rial", title: "مانده‌ی ریالی", align: "left", render: (v) => <Balance v={v} /> },
                      { key: "d", dataIndex: "last_date", title: "آخرین گردش", render: (v) => <JDate v={v} /> },
                    ]}
                    summary={() =>
                      p.data ? (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={2}>جمع</Table.Summary.Cell>
                          <Table.Summary.Cell index={2} align="left"><WBalance v={p.data.totals.gold_w} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={3} align="left"><Balance v={p.data.totals.gold_rial} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={4} align="left"><WBalance v={p.data.totals.workshop_w} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={5} align="left"><WBalance v={p.data.totals.consign_w} /></Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="left"><Balance v={p.data.totals.rial} /></Table.Summary.Cell>
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
