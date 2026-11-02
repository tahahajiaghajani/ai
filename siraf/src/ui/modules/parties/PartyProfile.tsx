// A party's file: identity, balances in every dimension (rial, currencies, gold) and statement.
import { useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Tabs, Table, Tag, Descriptions, Spin, Space } from "antd";
import { EditOutlined, PrinterOutlined, PhoneOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { PageHeader, Section } from "../../components/layout";
import { EntityForm } from "../../components/data";
import { Money, JDate, Balance, Amount, Weight, StatCard } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { ENTITIES, PARTY_ROLES } from "@shared/entities";
import { faDigits, groupDigits } from "@shared/format";
import { D } from "@shared/money";

export default function PartyProfile() {
  const { id } = useParams();
  const { api, orgId, can } = useOrg();
  const [edit, setEdit] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const p = useQuery({ queryKey: ["party", id], queryFn: () => api.get(`/data/party/${id}`).then((r) => r.row) });
  const party = p.data;
  const bal = useQuery({
    queryKey: ["party-bal", party?.detail_id],
    queryFn: () => api.get("/accounting/reports/detail-balances", { kind: "person" }).then((r) => (r.rows as any[]).filter((x) => x.detail_id === party.detail_id)),
    enabled: !!party?.detail_id,
  });
  const st = useQuery({
    queryKey: ["party-st", party?.detail_id, from, to],
    queryFn: () => api.get("/accounting/reports/ledger", { detail_id: party.detail_id, from, to }),
    enabled: !!party?.detail_id,
  });
  if (p.isLoading || !party) return <div className="grid h-64 place-content-center"><Spin /></div>;
  const rial = (bal.data ?? []).filter((b) => !b.currency_id).reduce((a, b) => a.plus(D(b.balance)), D(0));
  const weight = (bal.data ?? []).reduce((a, b) => a.plus(D(b.w_balance)), D(0));
  const fx = (bal.data ?? []).filter((b) => b.currency_id && !D(b.fx_balance).isZero());
  return (
    <div>
      <PageHeader
        back={`/${orgId}/parties`}
        title={party.name}
        subtitle={<span className="num">کد {faDigits(party.code)}{party.mobile ? ` · ${faDigits(party.mobile)}` : ""}</span>}
        extra={<Space size={4}>{(party.roles ?? []).map((r: string) => <Tag key={r} variant="filled" color="cyan">{PARTY_ROLES.find((x) => x.value === r)?.label ?? r}</Tag>)}</Space>}
        actions={
          <>
            {party.mobile ? <Button icon={<PhoneOutlined />} href={`tel:${party.mobile}`}>تماس</Button> : null}
            <Button icon={<PrinterOutlined />} onClick={() => window.print()}>چاپ صورتحساب</Button>
            {can("parties", "edit") ? <Button type="primary" icon={<EditOutlined />} onClick={() => setEdit(true)}>ویرایش</Button> : null}
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="مانده‌ی ریالی" value={<Balance v={rial.toString()} />} hint={rial.gt(0) ? "بدهکار به ما" : rial.lt(0) ? "طلبکار از ما" : "تسویه"} tone={rial.gt(0) ? "brand" : rial.lt(0) ? "gold" : "muted"} />
        <StatCard title="مانده‌ی وزنی طلا" value={<Weight v={weight.toString()} zero="—" />} tone="gold" />
        <StatCard title="حساب‌های ارزی" value={fx.length ? faDigits(fx.length) : "—"} hint={fx.map((f) => `${f.currency_code}: ${faDigits(D(f.fx_balance).toFixed())}`).join(" · ")} />
        <StatCard title="سقف اعتبار" value={party.credit_limit ? <Money v={party.credit_limit} /> : "—"} tone="muted" />
      </div>
      <Tabs
        items={[
          {
            key: "statement",
            label: "صورتحساب",
            children: (
              <Section
                title="گردش حساب"
                extra={
                  <Space>
                    <DateInput value={from} onChange={setFrom} allowClear placeholder="از تاریخ" className="!w-36" />
                    <DateInput value={to} onChange={setTo} allowClear placeholder="تا تاریخ" className="!w-36" />
                  </Space>
                }
                bodyClass="p-0"
              >
                <Table
                  className="tz-table print-sheet"
                  size="small"
                  rowKey={(r: any) => `${r.voucher_id}-${r.line_no}`}
                  loading={st.isLoading}
                  dataSource={st.data?.rows ?? []}
                  pagination={{ pageSize: 100, hideOnSinglePage: true }}
                  scroll={{ x: "max-content" }}
                  columns={[
                    { key: "date", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
                    { key: "no", dataIndex: "no", title: "سند", render: (v) => <span className="num">{faDigits(v)}</span> },
                    { key: "acc", dataIndex: "account_name", title: "حساب" },
                    { key: "desc", dataIndex: "description", title: "شرح", ellipsis: true },
                    { key: "dr", dataIndex: "debit", title: "بدهکار", align: "left", render: (v) => <Money v={v} zero="" /> },
                    { key: "cr", dataIndex: "credit", title: "بستانکار", align: "left", render: (v) => <Money v={v} zero="" /> },
                    { key: "bal", dataIndex: "balance", title: "مانده", align: "left", render: (v) => <Balance v={v} /> },
                    { key: "fx", title: "ارزی", align: "left", render: (_, r: any) => (D(r.fx_debit).isZero() && D(r.fx_credit).isZero() ? null : <Amount v={D(r.fx_debit).minus(D(r.fx_credit)).toString()} suffix={r.currency_code} />) },
                    { key: "w", title: "وزن", align: "left", render: (_, r: any) => (D(r.w_debit).isZero() && D(r.w_credit).isZero() ? null : <Weight v={D(r.w_debit).minus(D(r.w_credit)).toString()} />) },
                  ]}
                />
              </Section>
            ),
          },
          {
            key: "info",
            label: "مشخصات",
            children: (
              <Section>
                <Descriptions
                  column={{ xs: 1, md: 2, lg: 3 }}
                  size="small"
                  items={[
                    { key: "nid", label: "کد/شناسه ملی", children: <span className="num">{faDigits(party.national_id ?? "—")}</span> },
                    { key: "eco", label: "کد اقتصادی", children: <span className="num">{faDigits(party.economic_code ?? "—")}</span> },
                    { key: "phone", label: "تلفن", children: <span className="num">{faDigits(party.phone ?? "—")}</span> },
                    { key: "email", label: "ایمیل", children: <span className="ltr">{party.email ?? "—"}</span> },
                    { key: "city", label: "شهر", children: party.city ?? "—" },
                    { key: "postal", label: "کد پستی", children: <span className="num">{faDigits(party.postal_code ?? "—")}</span> },
                    { key: "addr", label: "نشانی", children: party.address ?? "—", span: 3 },
                    { key: "iban", label: "شبا", children: <span className="num ltr">{groupDigits(party.iban) || "—"}</span> },
                    { key: "card", label: "کارت", children: <span className="num ltr">{faDigits(groupDigits(party.card_no)) || "—"}</span> },
                    { key: "kyc", label: "احراز هویت", children: party.kyc_status ?? "—" },
                    { key: "notes", label: "یادداشت", children: party.notes ?? "—", span: 3 },
                  ]}
                />
              </Section>
            ),
          },
        ]}
      />
      <Drawer open={edit} onClose={() => setEdit(false)} size={820} title="ویرایش شخص" destroyOnHidden>
        {edit ? <EntityForm def={ENTITIES.party} initial={party} onSaved={() => { setEdit(false); p.refetch(); }} onCancel={() => setEdit(false)} /> : null}
      </Drawer>
    </div>
  );
}
