// Workshops and melting (کارگاه و ذوب): weighed gold on hand (used, bullion), gold at each
// workshop by weight and book value, and the documents that move it.
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Table } from "antd";
import { SendOutlined, ImportOutlined, FireOutlined, DollarOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { StatCard, Money, Balance, JDate } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatWeight } from "@shared/format";
import { WBalance } from "./shared";
import { DocsTable } from "./Docs";

export default function Workshop() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const stock = useQuery({ queryKey: ["gold-stock", orgId, null], queryFn: () => api.get("/gold/reports/stock") });
  const ws = useQuery({ queryKey: ["gold-party-balances", orgId, "workshop"], queryFn: () => api.get("/gold/reports/parties", { scope: "workshop" }).then((r) => r.rows as any[]) });
  const l = stock.data?.ledger;
  const edit = can("gold", "edit");
  return (
    <div>
      <PageHeader
        title="کارگاه و ذوب"
        actions={
          edit ? (
            <>
              <Button icon={<DollarOutlined />} onClick={() => nav(`/${orgId}/gold/workshop/bullion-sale/new`)}>فروش آبشده</Button>
              <Button icon={<FireOutlined />} onClick={() => nav(`/${orgId}/gold/workshop/melt/new`)}>ذوب و ری‌گیری</Button>
              <Button icon={<ImportOutlined />} onClick={() => nav(`/${orgId}/gold/workshop/in/new`)}>دریافت از کارگاه</Button>
              <Button type="primary" icon={<SendOutlined />} onClick={() => nav(`/${orgId}/gold/workshop/out/new`)}>ارسال به کارگاه</Button>
            </>
          ) : null
        }
      />
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <StatCard title="طلای مستعمل و شکسته (۷۵۰)" value={<span className="num">{formatWeight(l?.gold_old?.w ?? 0)} گرم</span>} hint={<>بهای دفتری: <Money v={l?.gold_old?.rial ?? 0} /></>} tone="gold" icon={<FireOutlined />} />
        <StatCard title="آبشده و شمش (۷۵۰)" value={<span className="num">{formatWeight(l?.gold_bullion?.w ?? 0)} گرم</span>} hint={<>بهای دفتری: <Money v={l?.gold_bullion?.rial ?? 0} /></>} tone="gold" icon={<DollarOutlined />} />
        <StatCard title="طلای ما نزد کارگاه‌ها (۷۵۰)" value={<span className="num">{formatWeight(l?.gold_at_workshop?.w ?? 0)} گرم</span>} hint={<>بهای دفتری: <Money v={l?.gold_at_workshop?.rial ?? 0} /></>} icon={<SendOutlined />} />
      </div>
      <Section title="طلای نزد کارگاه‌ها و سازندگان" bodyClass="p-0" className="mb-3">
        <Table
          className="tz-table"
          size="small"
          rowKey="detail_id"
          loading={ws.isLoading}
          dataSource={ws.data ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "طلایی نزد کارگاه‌ها نیست" }}
          columns={[
            { key: "n", title: "کارگاه", render: (_, r: any) => <span>{r.name} <span className="num text-xs text-muted">({faDigits(r.code)})</span></span> },
            { key: "w", dataIndex: "workshop_w", title: "وزن ۷۵۰ نزد کارگاه", align: "left", render: (v) => <WBalance v={v} /> },
            { key: "r", dataIndex: "workshop_rial", title: "بهای دفتری", align: "left", render: (v) => <Money v={v} /> },
            { key: "ap", title: "حساب ریالی (اجرت)", align: "left", render: (_, r: any) => <Balance v={D(r.ar).plus(D(r.ap)).toString()} /> },
            { key: "d", dataIndex: "last_date", title: "آخرین گردش", render: (v) => <JDate v={v} /> },
            ...(edit
              ? [{
                  key: "a", render: (_: unknown, r: any) => (
                    <Button size="small" onClick={() => nav(`/${orgId}/gold/workshop/in/new?party=${r.party_id}`)}>دریافت مصنوعات</Button>
                  ),
                }]
              : []),
          ]}
        />
      </Section>
      <Section title="اسناد کارگاه، ذوب و آبشده">
        <DocsTable kinds="workshop_out,workshop_in,melt,bullion_sale" />
      </Section>
    </div>
  );
}
