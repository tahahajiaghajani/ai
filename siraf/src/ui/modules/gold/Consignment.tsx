// Consignment (امانی): pieces held for each consignor (count, weight), what we owe them by weight
// after selling their pieces, and the consignment documents.
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Table } from "antd";
import { FileInput, FileOutput, LayoutGrid, PackageOpen } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { Balance, EmptyState } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { gw, WBalance } from "./shared";
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
            {can("gold", "edit") ? <Button icon={<Ic icon={FileOutput} />} onClick={() => nav(`/${orgId}/gold/consignment/return/new`)}>برگشت امانی</Button> : null}
            {can("gold", "edit") ? <Button type="primary" icon={<Ic icon={FileInput} />} onClick={() => nav(`/${orgId}/gold/consignment/in/new`)}>ورود امانی</Button> : null}
          </>
        }
      />
      <Section title="امانی نزد ما به تفکیک امانت‌گذار" extra={<button type="button" className="sf-link inline-flex items-center gap-1.5" onClick={() => nav(`/${orgId}/gold/items?ownership=consignment`)}><Ic icon={LayoutGrid} size={14} />اجناس امانی</button>} bodyClass="p-0" className="mb-4">
        <Table
          className=""
          size="small"
          rowKey={(r: any) => r.supplier_id ?? "none"}
          loading={rep.isLoading}
          dataSource={rows}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{ emptyText: <EmptyState compact icon={PackageOpen} title="جنس امانی نزد ما نیست" /> }}
          onRow={(r: any) => ({ onClick: () => r.supplier_id && nav(`/${orgId}/parties/${r.supplier_id}`), style: { cursor: "pointer" } })}
          columns={[
            { key: "n", title: "امانت‌گذار", render: (_, r: any) => <span>{r.supplier_code ? <span className="sf-docno me-2 text-ink-3">{faDigits(r.supplier_code)}</span> : null}{r.supplier_name ?? "نامشخص"}</span> },
            { key: "p", dataIndex: "pieces", title: "اجناس موجود", className: "sf-num", render: (v) => <span className="sf-num">{faDigits(v)}</span> },
            { key: "w", dataIndex: "w750", title: "معادل ۷۵۰ موجود", className: "sf-num", render: (v) => <span className="sf-num">{gw(v)}</span> },
            { key: "s", title: "فروخته‌شده", className: "sf-num", render: (_, r: any) => (r.sold ? <span className="sf-num">{faDigits(r.sold.pieces)} جنس، {gw(r.sold.w750)} گرم</span> : <span className="sf-zero">—</span>) },
            { key: "gw", title: "حساب وزنی (بدهی ما)", className: "sf-num", render: (_, r: any) => <WBalance v={r.bal?.gold_w ?? 0} /> },
            { key: "ap", title: "حساب ریالی", className: "sf-num", render: (_, r: any) => <Balance v={D(r.bal?.ar ?? 0).plus(D(r.bal?.ap ?? 0)).toString()} /> },
          ]}
        />
      </Section>
      <section className="sf-card" aria-label="اسناد امانی">
        <div className="sf-doc-h"><h2>اسناد امانی</h2></div>
        <DocsTable kinds="consign_in,consign_return" />
      </section>
    </div>
  );
}
