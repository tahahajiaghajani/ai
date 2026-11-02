// A party's file (پروندهٔ شخص): identity, balances in every dimension (rial, currencies, gold) and the statement
// (صورتحساب) with an opening balance and a running «مانده» with «تشخیص».
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Tabs, Table, Tooltip } from "antd";
import { Pencil, Phone, Printer, Scale, Weight as WeightIcon, Coins, ShieldCheck, CircleAlert } from "lucide-react";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EntityForm } from "../../components/data";
import { JDate, Balance, Amount, Weight, StatCard, EmptyState, Skeleton } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { ENTITIES, PARTY_ROLES } from "@shared/entities";
import { faDigits, groupDigits } from "@shared/format";
import { D } from "@shared/money";
import { Acc, Amt, Card, DocNo, ICON, PrintFoot, PrintHead, cx } from "../reports/kit";
import { formatJalali } from "@shared/jalali";
import { errorText } from "../../lib/api";

const side = (v: string | null | undefined) => {
  const d = D(v ?? 0);
  return d.isZero() ? "—" : d.gt(0) ? "بد" : "بس";
};

export default function PartyProfile() {
  const { id } = useParams();
  const { api, orgId, can, unit, has } = useOrg();
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState("statement");
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
  const rows = (st.data?.rows ?? []) as any[];
  const data = useMemo(() => (st.data ? [{ __open: true, key: "opening", balance: st.data.opening }, ...rows.map((r) => ({ ...r, key: `${r.voucher_id}-${r.line_no}` }))] : []), [st.data, rows]);
  const back = `/${orgId}/parties`;

  if (p.isLoading)
    return (
      <div>
        <PageHeader back={back} title="شخص" />
        <Card>
          <Skeleton rows={6} />
        </Card>
      </div>
    );
  if (p.error || !party)
    return (
      <div>
        <PageHeader back={back} title="شخص" />
        <Card>
          <EmptyState icon={CircleAlert} title="بارگذاری انجام نشد" description={p.error ? errorText(p.error) : "این شخص پیدا نشد."} action={<Button onClick={() => p.refetch()}>تلاش دوباره</Button>} />
        </Card>
      </div>
    );

  const rial = (bal.data ?? []).reduce((a, b) => a.plus(D(b.balance)), D(0));
  const weight = (bal.data ?? []).reduce((a, b) => a.plus(D(b.w_balance)), D(0));
  const fx = (bal.data ?? []).filter((b) => b.currency_id && !D(b.fx_balance).isZero());
  const roles = (party.roles ?? []).map((r: string) => PARTY_ROLES.find((x) => x.value === r)?.label ?? r);
  const hasFx = rows.some((r) => !D(r.fx_debit).isZero() || !D(r.fx_credit).isZero());
  const hasW = rows.some((r) => !D(r.w_debit).isZero() || !D(r.w_credit).isZero());
  const dash = <span className="sf-zero">—</span>;
  const text = (v: unknown) => (v === null || v === undefined || v === "" ? dash : String(v));

  return (
    <div>
      <PageHeader
        back={back}
        title={party.name}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <span className="sf-num">کد {faDigits(party.code)}</span>
            {party.mobile ? (
              <>
                <span className="bk-sep" />
                <bdi dir="ltr" className="sf-num">{faDigits(party.mobile)}</bdi>
              </>
            ) : null}
            {roles.length ? (
              <>
                <span className="bk-sep" />
                <span>{roles.join("، ")}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          <>
            {party.mobile ? (
              <Tooltip title="تماس">
                <Button type="text" icon={<Phone {...ICON} />} href={`tel:${party.mobile}`} aria-label="تماس" />
              </Tooltip>
            ) : null}
            <Tooltip title="چاپ صورتحساب">
              <Button
                type="text"
                icon={<Printer {...ICON} />}
                aria-label="چاپ صورتحساب"
                onClick={() => {
                  setTab("statement");
                  setTimeout(() => window.print(), 150);
                }}
              />
            </Tooltip>
            {can("parties", "edit") ? (
              <Button type="primary" icon={<Pencil {...ICON} />} onClick={() => setEdit(true)}>
                ویرایش
              </Button>
            ) : null}
          </>
        }
      />
      <div className="no-print mb-4 grid sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="ماندهٔ ریالی"
          icon={<Scale {...ICON} />}
          value={<Balance v={rial.toString()} />}
          hint={rial.gt(0) ? "بدهکار به ما" : rial.lt(0) ? "طلبکار از ما" : "تسویه"}
        />
        {has("gold") ? <StatCard title="ماندهٔ وزنی طلا" icon={<WeightIcon {...ICON} />} value={weight.isZero() ? "—" : <Weight v={weight.toString()} />} hint={weight.isZero() ? "حساب وزنی ندارد" : weight.gt(0) ? "بدهکار به ما" : "طلبکار از ما"} /> : null}
        <StatCard
          title="حساب‌های ارزی"
          icon={<Coins {...ICON} />}
          value={fx.length ? faDigits(fx.length) : "—"}
          hint={fx.length ? fx.map((f) => `${f.currency_code} ${faDigits(D(f.fx_balance).toFixed())}`).join("، ") : "ماندهٔ ارزی ندارد"}
        />
        <StatCard title="سقف اعتبار" icon={<ShieldCheck {...ICON} />} value={party.credit_limit ? <Amt v={party.credit_limit} /> : "—"} hint={party.credit_limit ? unit : "تعیین نشده"} />
      </div>
      <Tabs
        className="no-print"
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "statement", label: "صورتحساب" },
          { key: "info", label: "مشخصات" },
        ]}
      />
      {tab === "statement" ? (
        <Card
          title="گردش حساب"
          meta={<span className="bk-cap">مبالغ به {unit}</span>}
          tools={
            <span className="bk-range">
              <DateInput value={from} onChange={setFrom} allowClear placeholder="از تاریخ" />
              <span>تا</span>
              <DateInput value={to} onChange={setTo} allowClear placeholder="تا تاریخ" />
            </span>
          }
          flush
        >
          <PrintHead title={`صورتحساب ${party.name}`} lines={[`کد ${faDigits(party.code)}`, ...(from || to ? [`${from ? `از ${formatJalali(from)} ` : ""}${to ? `تا ${formatJalali(to)}` : ""}`] : [])]} />
          {st.data ? (
            <div className="bk-strip">
              <div>
                <small>ماندهٔ ابتدای دوره</small>
                <b><Balance v={st.data.opening} /></b>
              </div>
              <div>
                <small>بدهکار</small>
                <b><Amt v={st.data.totals.debit} /></b>
              </div>
              <div>
                <small>بستانکار</small>
                <b><Amt v={st.data.totals.credit} /></b>
              </div>
              <div>
                <small>ماندهٔ پایان دوره</small>
                <b><Balance v={st.data.totals.balance} /></b>
              </div>
            </div>
          ) : null}
          <Table
            className="bk-tbl"
            size="small"
            rowKey="key"
            loading={st.isLoading && !!party.detail_id}
            dataSource={data}
            pagination={{ pageSize: 100, hideOnSinglePage: true, size: "small", showSizeChanger: false }}
            scroll={{ x: 1000 }}
            tableLayout="fixed"
            locale={{ emptyText: <EmptyState title="گردشی نیست" description={party.detail_id ? "در این بازه سندی برای این شخص ثبت نشده است." : "این شخص هنوز حساب تفصیلی ندارد."} /> }}
            rowClassName={(r: any) => cx(r.__open && "bk-open")}
            columns={[
              { key: "date", dataIndex: "date", title: "تاریخ", width: 104, render: (v, r: any) => (r.__open ? null : <JDate v={v} />) },
              { key: "no", dataIndex: "no", title: "سند", width: 64, render: (v, r: any) => (r.__open ? null : <DocNo n={v} />) },
              {
                key: "acc",
                title: "حساب",
                width: 200,
                ellipsis: true,
                render: (_, r: any) => (r.__open ? "ماندهٔ ابتدای دوره" : <Acc code={r.account_code} name={r.account_name} />),
                onCell: (r: any) => (r.__open ? { colSpan: 2 } : {}),
              },
              { key: "desc", dataIndex: "description", title: "شرح", ellipsis: true, render: (v) => <span className="bk-2">{v}</span>, onCell: (r: any) => (r.__open ? { colSpan: 0 } : {}) },
              ...(hasFx ? [{ key: "fx", title: "ارزی", className: "sf-num", width: 136, render: (_: unknown, r: any) => (r.__open || (D(r.fx_debit).isZero() && D(r.fx_credit).isZero()) ? null : <Amount v={D(r.fx_debit).minus(D(r.fx_credit)).toString()} suffix={r.currency_code} />) }] : []),
              ...(hasW ? [{ key: "w", title: "وزن (گرم)", className: "sf-num", width: 120, render: (_: unknown, r: any) => (r.__open || (D(r.w_debit).isZero() && D(r.w_credit).isZero()) ? null : <Weight v={D(r.w_debit).minus(D(r.w_credit)).toString()} unit={false} />) }] : []),
              { key: "dr", dataIndex: "debit", title: "بدهکار", className: "sf-num", width: 144, render: (v, r: any) => (r.__open ? null : <Amt v={v} zero="" />) },
              { key: "cr", dataIndex: "credit", title: "بستانکار", className: "sf-num", width: 144, render: (v, r: any) => (r.__open ? null : <Amt v={v} zero="" />) },
              { key: "bal", dataIndex: "balance", title: "مانده", className: "sf-num", width: 152, render: (v) => <Amt v={D(v ?? 0).abs().toString()} /> },
              { key: "side", dataIndex: "balance", title: "تشخیص", width: 80, render: (v) => <span className="bk-plain">{side(v)}</span> },
            ]}
          />
          <PrintFoot />
        </Card>
      ) : (
        <Card title="مشخصات">
          <dl className="bk-dl" style={{ ["--cols" as string]: 3 }}>
            <div><dt>کد یا شناسهٔ ملی</dt><dd>{party.national_id ? <span className="sf-num">{faDigits(party.national_id)}</span> : dash}</dd></div>
            <div><dt>کد اقتصادی</dt><dd>{party.economic_code ? <span className="sf-num">{faDigits(party.economic_code)}</span> : dash}</dd></div>
            <div><dt>تلفن</dt><dd>{party.phone ? <bdi dir="ltr" className="sf-num">{faDigits(party.phone)}</bdi> : dash}</dd></div>
            <div><dt>ایمیل</dt><dd>{party.email ? <bdi dir="ltr" className="sf-latin">{party.email}</bdi> : dash}</dd></div>
            <div><dt>شهر</dt><dd>{text(party.city)}</dd></div>
            <div><dt>کد پستی</dt><dd>{party.postal_code ? <span className="sf-num">{faDigits(party.postal_code)}</span> : dash}</dd></div>
            <div className="is-wide"><dt>نشانی</dt><dd>{text(party.address)}</dd></div>
            <div><dt>شبا</dt><dd>{party.iban ? <bdi dir="ltr" className="sf-mono">{groupDigits(party.iban)}</bdi> : dash}</dd></div>
            <div><dt>شمارهٔ کارت</dt><dd>{party.card_no ? <bdi dir="ltr" className="sf-mono">{groupDigits(party.card_no)}</bdi> : dash}</dd></div>
            <div><dt>احراز هویت</dt><dd>{text(party.kyc_status)}</dd></div>
            <div className="is-wide"><dt>یادداشت</dt><dd>{text(party.notes)}</dd></div>
          </dl>
        </Card>
      )}
      <Drawer open={edit} onClose={() => setEdit(false)} size={820} title={`ویرایش ${party.name}`} destroyOnHidden>
        {edit ? (
          <EntityForm
            def={ENTITIES.party}
            initial={party}
            onSaved={() => {
              setEdit(false);
              p.refetch();
            }}
            onCancel={() => setEdit(false)}
          />
        ) : null}
      </Drawer>
    </div>
  );
}
