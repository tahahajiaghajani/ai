// Workshops and melting (کارگاه و ذوب): weighed gold on hand (used, bullion), gold at each
// workshop by weight and book value, and the documents that move it.
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Table } from "antd";
import { Banknote, FileInput, Flame, Recycle, Send } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { StatCard, Money, Balance, JDate } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { gw, SplitButton, WBalance } from "./shared";
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
              <Button icon={<Ic icon={FileInput} />} onClick={() => nav(`/${orgId}/gold/workshop/in/new`)}>دریافت از کارگاه</Button>
              <SplitButton
                type="primary"
                icon={<Ic icon={Send} />}
                onClick={() => nav(`/${orgId}/gold/workshop/out/new`)}
                items={[
                  { key: "melt", icon: <Ic icon={Flame} />, label: "ذوب و ری‌گیری", onClick: () => nav(`/${orgId}/gold/workshop/melt/new`) },
                  { key: "bullion", icon: <Ic icon={Banknote} />, label: "فروش آبشده", onClick: () => nav(`/${orgId}/gold/workshop/bullion-sale/new`) },
                ]}
              >
                ارسال به کارگاه
              </SplitButton>
            </>
          ) : null
        }
      />
      <div className="mb-4 grid sm:grid-cols-3">
        <StatCard title="طلای مستعمل و شکسته" icon={<Ic icon={Recycle} />} value={<>{gw(l?.gold_old?.w ?? 0)}<span className="sf-unit">گرم ۷۵۰</span></>} hint={<>بهای دفتری <Money v={l?.gold_old?.rial ?? 0} /></>} />
        <StatCard title="آبشده و شمش" icon={<Ic icon={Flame} />} value={<>{gw(l?.gold_bullion?.w ?? 0)}<span className="sf-unit">گرم ۷۵۰</span></>} hint={<>بهای دفتری <Money v={l?.gold_bullion?.rial ?? 0} /></>} />
        <StatCard title="طلای ما نزد کارگاه‌ها" icon={<Ic icon={Send} />} value={<>{gw(l?.gold_at_workshop?.w ?? 0)}<span className="sf-unit">گرم ۷۵۰</span></>} hint={<>بهای دفتری <Money v={l?.gold_at_workshop?.rial ?? 0} /></>} />
      </div>
      <Section title="طلای نزد کارگاه‌ها و سازندگان" bodyClass="p-0" className="mb-4">
        <Table
          className=""
          size="small"
          rowKey="detail_id"
          loading={ws.isLoading}
          dataSource={ws.data ?? []}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "طلایی نزد کارگاه‌ها نیست" }}
          columns={[
            { key: "n", title: "کارگاه", render: (_, r: any) => <span><span className="sf-docno me-2 text-ink-3">{faDigits(r.code)}</span>{r.name}</span> },
            { key: "w", dataIndex: "workshop_w", title: "وزن ۷۵۰ نزد کارگاه", className: "sf-num", render: (v) => <WBalance v={v} /> },
            { key: "r", dataIndex: "workshop_rial", title: "بهای دفتری", className: "sf-num", render: (v) => <Money v={v} /> },
            { key: "ap", title: "حساب ریالی (اجرت)", className: "sf-num", render: (_, r: any) => <Balance v={D(r.ar).plus(D(r.ap)).toString()} /> },
            { key: "d", dataIndex: "last_date", title: "آخرین گردش", render: (v) => <JDate v={v} /> },
            ...(edit
              ? [{
                  key: "a", render: (_: unknown, r: any) => (
                    <span className="sf-row-act"><Button size="small" type="text" icon={<Ic icon={FileInput} />} onClick={() => nav(`/${orgId}/gold/workshop/in/new?party=${r.party_id}`)}>دریافت مصنوعات</Button></span>
                  ),
                }]
              : []),
          ]}
        />
      </Section>
      <section className="sf-card" aria-label="اسناد کارگاه، ذوب و آبشده">
        <div className="sf-doc-h"><h2>اسناد کارگاه، ذوب و آبشده</h2></div>
        <DocsTable kinds="workshop_out,workshop_in,melt,bullion_sale" />
      </section>
    </div>
  );
}
