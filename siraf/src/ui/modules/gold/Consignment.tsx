// Consignment (امانی): pieces held for each consignor (count, weight), what we owe them by weight
// after selling their pieces, and the consignment documents.
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Table } from "antd";
import { ImportOutlined, ExportOutlined, AppstoreOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { Balance } from "../../components/display";
import { D } from "@shared/money";
import { faDigits, formatWeight } from "@shared/format";
import { WBalance } from "./shared";
import { DocsTable } from "./Docs";

export default function Consignment() {
  const { api, orgId, can } = useOrg();
  const nav = useNavigate();
  const rep = useQuery({ queryKey: ["gold-consignment", orgId], queryFn: () => api.get("/gold/reports/consignment") });
  const parties = useQuery({ queryKey: ["gold-party-balances", orgId], queryFn: () => api.get("/gold/reports/parties").then((r) => r.rows as any[]) });
  const sold = new Map((rep.data?.sold ?? []).map((s: any) => [s.supplier_id, s]));
  const bal = new Map((parties.data ?? []).map((p: any) => [p.party_id, p]));
  const rows = (rep.data?.suppliers ?? []).map((s: any) => ({ ...s, sold: sold.get(s.supplier_id), bal: bal.get(s.supplier_id) }));
  // consignors whose pieces are all sold still owe/are owed weight
  for (const p of parties.data ?? []) {
    if (!rows.some((r: any) => r.supplier_id === p.party_id) && sold.has(p.party_id)) rows.push({ supplier_id: p.party_id, supplier_name: p.name, supplier_code: p.code, pieces: 0, w750: "0", net: "0", sold: sold.get(p.party_id), bal: p });
  }
  return (
    <div>
      <PageHeader
        title="امانی"
        actions={
          <>
            <Button icon={<AppstoreOutlined />} onClick={() => nav(`/${orgId}/gold/items?ownership=consignment`)}>اجناس امانی</Button>
            {can("gold", "edit") ? <Button icon={<ExportOutlined />} onClick={() => nav(`/${orgId}/gold/consignment/return/new`)}>برگشت امانی</Button> : null}
            {can("gold", "edit") ? <Button type="primary" icon={<ImportOutlined />} onClick={() => nav(`/${orgId}/gold/consignment/in/new`)}>ورود امانی</Button> : null}
          </>
        }
      />
      <Section title="امانی نزد ما به تفکیک امانت‌گذار" bodyClass="p-0" className="mb-3">
        <Table
          className="tz-table"
          size="small"
          rowKey={(r: any) => r.supplier_id ?? "none"}
          loading={rep.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: "جنس امانی نزد ما نیست" }}
          onRow={(r: any) => ({ onClick: () => r.supplier_id && nav(`/${orgId}/parties/${r.supplier_id}`), style: { cursor: "pointer" } })}
          columns={[
            { key: "n", title: "امانت‌گذار", render: (_, r: any) => <span>{r.supplier_name ?? "نامشخص"} {r.supplier_code ? <span className="num text-xs text-muted">({faDigits(r.supplier_code)})</span> : null}</span> },
            { key: "p", dataIndex: "pieces", title: "اجناس موجود", align: "left", render: (v) => <span className="num">{faDigits(v)}</span> },
            { key: "w", dataIndex: "w750", title: "معادل ۷۵۰ موجود", align: "left", render: (v) => <span className="num">{formatWeight(v)}</span> },
            { key: "s", title: "فروخته‌شده", align: "left", render: (_, r: any) => (r.sold ? <span className="num">{faDigits(r.sold.pieces)} جنس، {formatWeight(r.sold.w750)} گرم</span> : "—") },
            { key: "gw", title: "حساب وزنی (بدهی ما)", align: "left", render: (_, r: any) => <WBalance v={r.bal?.gold_w ?? 0} /> },
            { key: "ap", title: "حساب ریالی", align: "left", render: (_, r: any) => <Balance v={D(r.bal?.ar ?? 0).plus(D(r.bal?.ap ?? 0)).toString()} /> },
          ]}
        />
      </Section>
      <Section title="اسناد امانی">
        <DocsTable kinds="consign_in,consign_return" />
      </Section>
    </div>
  );
}
