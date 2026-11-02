// A party's file (پروندهٔ شخص): identity, balances in every dimension (rial, currencies, gold) and the statement
// (صورتحساب) with an opening balance and a running «مانده» with «تشخیص».
import { useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Tabs, Table, Tooltip } from "antd";
import { Pencil, Phone as PhoneIcon, Printer, Scale, Weight as WeightIcon, Coins, ShieldCheck, CircleAlert } from "lucide-react";
import { useOrg } from "../../lib/org";
import { PageHeader } from "../../components/layout";
import { EntityForm } from "../../components/data";
import { JDate, Balance, Amount, Weight, Money, Figure, EmptyState, Skeleton } from "../../components/display";
import { DateInput } from "../../components/inputs";
import { ENTITIES, PARTY_ROLES } from "@shared/entities";
import { faDigits } from "@shared/format";
import { D } from "@shared/money";
import { Acc, Amt, Card, DocNo, ICON, ICON14, Phone, PrintFoot, PrintHead, Ref, cx } from "../reports/kit";
import { formatJalali } from "@shared/jalali";
import { errorText } from "../../lib/api";

const side = (v: string | null | undefined) => {
  const d = D(v ?? 0);
  return d.isZero() ? "—" : d.gt(0) ? "بد" : "بس";
};

export default function PartyProfile() {
  const { id } = useParams();
  const { api, orgId, can, unit, has, org } = useOrg();
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
  // the printed period: the chosen dates, else the first movement up to today
  const pFrom = from ?? rows[0]?.date ?? null;
  const pTo = to ?? new Date().toISOString().slice(0, 10);

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
  // «حساب» only when the statement spans more than one account (receivables and payables, say)
  const showAcc = rows.some((r) => r.account_code !== rows[0].account_code);
  const tableX = 104 + 64 + (showAcc ? 200 : 0) + 240 + (hasFx ? 136 : 0) + (hasW ? 120 : 0) + 136 * 3 + 84;
  const dash = <span className="sf-zero">—</span>;
  // only the dimensions that hold a value get a figure; the rest fold into one quiet line under the hero
  const gold = has("gold");
  const extras: { key: string; title: string; icon: ReactNode; value: ReactNode; hint?: ReactNode }[] = [];
  if (gold && !weight.isZero())
    extras.push({ key: "w", title: "ماندهٔ وزنی طلا", icon: <WeightIcon {...ICON14} aria-hidden />, value: <Weight v={weight.abs().toString()} />, hint: weight.gt(0) ? "بدهکار به ما" : "طلبکار از ما" });
  for (const f of fx)
    extras.push({
      key: `fx-${f.currency_id}`,
      title: "ماندهٔ ارزی",
      icon: <Coins {...ICON14} aria-hidden />,
      value: <Amount v={D(f.fx_balance).abs().toString()} suffix={<span className="sf-latin">{f.currency_code}</span>} />,
      hint: D(f.fx_balance).gt(0) ? "بدهکار به ما" : "طلبکار از ما",
    });
  if (party.credit_limit && !D(party.credit_limit).isZero())
    extras.push({ key: "cl", title: "سقف اعتبار", icon: <ShieldCheck {...ICON14} aria-hidden />, value: <Money v={party.credit_limit} unit /> });
  const noW = gold && weight.isZero();
  const noFx = !fx.length;
  const missing = [
    noW && noFx ? "حساب وزنی و ارزی ندارد" : noW ? "حساب وزنی ندارد" : noFx ? "حساب ارزی ندارد" : null,
    party.credit_limit && !D(party.credit_limit).isZero() ? null : "سقف اعتبار تعیین نشده",
  ].filter(Boolean) as string[];
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
                <Phone v={party.mobile} />
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
                <Button type="text" icon={<PhoneIcon {...ICON} />} href={`tel:${party.mobile}`} aria-label="تماس" />
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
      <section className="bk-card bk-hero no-print">
        <div className="bk-hero-main">
          <div className="bk-hero-l">
            <Scale {...ICON} aria-hidden />
            ماندهٔ ریالی
          </div>
          <div className="bk-hero-v">
            {rial.isZero() ? (
              <span className="sf-zero">—</span>
            ) : (
              <>
                <span className="sf-t-hero">
                  <Figure v={rial.abs()} dp={org.money_decimals ?? 0} />
                </span>
                <span className="bk-hero-u">{unit}</span>
              </>
            )}
          </div>
          <div className="bk-hero-c">{rial.gt(0) ? "بدهکار به ما" : rial.lt(0) ? "طلبکار از ما" : "تسویه"}</div>
        </div>
        {extras.length ? (
          <div className="bk-hero-x">
            {extras.map((x) => (
              <div key={x.key}>
                <small>
                  {x.icon}
                  {x.title}
                </small>
                <b>{x.value}</b>
                {x.hint ? <span>{x.hint}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        {missing.length ? <p className="bk-hero-q">{missing.join("، ")}</p> : null}
      </section>
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
          <PrintHead title={`صورتحساب ${party.name}`} lines={[`کد ${faDigits(party.code)}`, pFrom ? `از ${formatJalali(pFrom)} تا ${formatJalali(pTo)}` : `تا ${formatJalali(pTo)}`]} />
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
            scroll={{ x: tableX }}
            tableLayout="fixed"
            locale={{ emptyText: <EmptyState title="گردشی نیست" description={party.detail_id ? "در این بازه سندی برای این شخص ثبت نشده است." : "این شخص هنوز حساب تفصیلی ندارد."} /> }}
            rowClassName={(r: any) => cx(r.__open && "bk-open")}
            columns={[
              { key: "date", dataIndex: "date", title: "تاریخ", width: 104, render: (v, r: any) => (r.__open ? null : <JDate v={v} />) },
              { key: "no", dataIndex: "no", title: "سند", width: 64, render: (v, r: any) => (r.__open ? null : <DocNo n={v} />) },
              ...(showAcc
                ? [
                    {
                      key: "acc",
                      title: "حساب",
                      width: 200,
                      ellipsis: true,
                      render: (_: unknown, r: any) => (r.__open ? "ماندهٔ ابتدای دوره" : <Acc code={r.account_code} name={r.account_name} />),
                      onCell: (r: any) => (r.__open ? { colSpan: 2 } : {}),
                    },
                  ]
                : []),
              {
                key: "desc",
                dataIndex: "description",
                title: "شرح",
                ellipsis: true,
                render: (v: string, r: any) => (r.__open && !showAcc ? "ماندهٔ ابتدای دوره" : <span className="bk-2">{v}</span>),
                onCell: (r: any) => (r.__open && showAcc ? { colSpan: 0 } : {}),
              },
              ...(hasFx ? [{ key: "fx", title: "ارزی", className: "sf-num", width: 136, render: (_: unknown, r: any) => (r.__open || (D(r.fx_debit).isZero() && D(r.fx_credit).isZero()) ? null : <Amount v={D(r.fx_debit).minus(D(r.fx_credit)).toString()} suffix={r.currency_code} />) }] : []),
              ...(hasW ? [{ key: "w", title: "وزن (گرم)", className: "sf-num", width: 120, render: (_: unknown, r: any) => (r.__open || (D(r.w_debit).isZero() && D(r.w_credit).isZero()) ? null : <Weight v={D(r.w_debit).minus(D(r.w_credit)).toString()} unit={false} />) }] : []),
              { key: "dr", dataIndex: "debit", title: "بدهکار", className: "sf-num", width: 136, render: (v, r: any) => (r.__open ? null : <Amt v={v} zero="" />) },
              { key: "cr", dataIndex: "credit", title: "بستانکار", className: "sf-num", width: 136, render: (v, r: any) => (r.__open ? null : <Amt v={v} zero="" />) },
              { key: "bal", dataIndex: "balance", title: "مانده", className: "sf-num", width: 136, render: (v) => <Amt v={D(v ?? 0).abs().toString()} /> },
              { key: "side", dataIndex: "balance", title: "تشخیص", width: 84, render: (v) => <span className="bk-plain">{side(v)}</span> },
            ]}
            summary={() =>
              st.data ? (
                <Table.Summary>
                  <Table.Summary.Row className="bk-sum">
                    <Table.Summary.Cell index={0} colSpan={3 + (showAcc ? 1 : 0) + (hasFx ? 1 : 0) + (hasW ? 1 : 0)} className="bk-sum-l">
                      جمع دوره<small>{faDigits(rows.length)} ردیف</small>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} className="sf-num"><Amt v={st.data.totals.debit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} className="sf-num"><Amt v={st.data.totals.credit} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} className="sf-num"><Amt v={D(st.data.totals.balance).abs().toString()} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={4}><span className="bk-plain">{side(st.data.totals.balance)}</span></Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
          />
          <PrintFoot sign={["تهیه‌کننده", "تأییدکننده", `تأیید ${party.name}`]} />
        </Card>
      ) : (
        <Card title="مشخصات">
          <dl className="bk-dl" style={{ ["--cols" as string]: 3 }}>
            <div><dt>کد یا شناسهٔ ملی</dt><dd>{party.national_id ? <span className="sf-num">{faDigits(party.national_id)}</span> : dash}</dd></div>
            <div><dt>کد اقتصادی</dt><dd>{party.economic_code ? <span className="sf-num">{faDigits(party.economic_code)}</span> : dash}</dd></div>
            <div><dt>تلفن</dt><dd>{party.phone ? <Phone v={party.phone} /> : dash}</dd></div>
            <div><dt>ایمیل</dt><dd>{party.email ? <bdi dir="ltr" className="sf-latin">{party.email}</bdi> : dash}</dd></div>
            <div><dt>شهر</dt><dd>{text(party.city)}</dd></div>
            <div><dt>کد پستی</dt><dd>{party.postal_code ? <span className="sf-num">{faDigits(party.postal_code)}</span> : dash}</dd></div>
            <div className="is-wide"><dt>نشانی</dt><dd>{text(party.address)}</dd></div>
            <div><dt>شبا</dt><dd>{party.iban ? <Ref v={party.iban} /> : dash}</dd></div>
            <div><dt>شمارهٔ کارت</dt><dd>{party.card_no ? <Ref v={party.card_no} /> : dash}</dd></div>
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
