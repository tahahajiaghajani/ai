// Revaluation (تسعیر ارز): preview the adjustment of every foreign balance to the rate of a date
// (rates from the board, editable), post it as one voucher, and list or remove past runs.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Switch, Table, Tooltip } from "antd";
import { Calculator, Calendar, Check, RefreshCw, Rows3, Trash2 } from "lucide-react";
import { Ic } from "../../components/shell/icons";
import { useOrg } from "../../lib/org";
import { useAction, useDebounced, useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { PageHeader, Section } from "../../components/layout";
import { DateInput, NumberInput } from "../../components/inputs";
import { EmptyState, JDate, Money, StatCard } from "../../components/display";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { formatJalali, todayISO } from "@shared/jalali";
import { CurrencyChip, FxAmount, rateLabel, SourceTag } from "./shared";

export default function Revaluation() {
  const { api, org, orgId, can } = useOrg();
  const qc = useQueryClient();
  const n = useNotify();
  const tz = (org.settings?.timezone as string) || "Asia/Tehran";
  const [date, setDate] = useState<string>(todayISO(tz));
  const [parties, setParties] = useState(false);
  const [rates, setRates] = useState<Record<string, string | null>>({});
  const body = useMemo(() => ({ date, include_parties: parties, rates: Object.fromEntries(Object.entries(rates).filter(([, v]) => v)) }), [date, parties, rates]);
  const debounced = useDebounced(JSON.stringify(body), 400);
  const pv = useQuery({ queryKey: ["fx-reval-preview", debounced], queryFn: () => api.post("/fx/revaluation/preview", JSON.parse(debounced)), retry: false });
  const list = useQuery({ queryKey: ["fx-revaluations"], queryFn: () => api.get("/fx/revaluations") });
  const p = pv.data;
  const baseDp = org.money_decimals ?? 0;
  useEffect(() => setRates({}), [date]);
  const canPost = can("fx", "full") && can("accounting", "edit");
  const post = useAction(() => api.post("/fx/revaluation", body), {
    invalidate: [["fx-revaluations"], ["fx-reval-preview"], ["fx-positions"], ["table"]],
    onSuccess: (r: any) => (r.voucher_id ? n.ok(`سند تسعیر ش ${faDigits(r.voucher_no)} ثبت شد`) : n.info("تسعیری لازم نبود؛ سندی ثبت نشد")),
  });
  const remove = useAction((id: string) => api.del(`/fx/revaluations/${id}`), { success: "سند تسعیر حذف شد", invalidate: [["fx-revaluations"], ["fx-reval-preview"], ["fx-positions"], ["table"]] });

  return (
    <div>
      <PageHeader
        title="تسعیر ارز"
        actions={
          canPost ? (
            <Button
              type="primary"
              icon={<Ic icon={Check} />}
              loading={post.isPending}
              disabled={!p || !!p.missing_rates?.length}
              onClick={async () => {
                if (await n.confirm(p?.existing ? "سند تسعیر این تاریخ جایگزین شود؟" : "سند تسعیر ثبت شود؟", `اثر: ${faDigits(D(p?.total ?? 0).toFixed(0))} (${D(p?.total ?? 0).gte(0) ? "سود" : "زیان"})`)) post.mutate(undefined);
              }}
            >
              {p?.existing ? "ثبت دوباره‌ی تسعیر" : "ثبت سند تسعیر"}
            </Button>
          ) : null
        }
      />
      <div className="sf-filters">
        <span className="text-[13px] text-ink-3">تاریخ تسعیر</span>
        <DateInput value={date} onChange={(v) => v && setDate(v)} className="!w-36" />
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          <Switch size="small" checked={parties} onChange={setParties} /> حساب ارزی مشتریان و همکاران هم تسعیر شود
        </label>
        <Button size="small" type="text" icon={<Ic icon={RefreshCw} />} onClick={() => setRates({})}>بازگشت به نرخ‌های تابلو</Button>
      </div>
      {pv.error ? <Alert className="!mb-4" type="error" showIcon title={errorText(pv.error)} /> : null}
      {p?.missing_rates?.length ? <div className="sf-inline mb-4" data-tone="warning"><i className="sf-nuqta" aria-hidden /><span><b>نرخ ندارد.</b> نرخ این ارزها تا <span className="sf-num">{formatJalali(date)}</span> در تابلو نیست؛ نرخ را در جدول بنویسید: {p.missing_rates.join("، ")}</span></div> : null}
      {p?.existing ? <div className="sf-inline mb-4"><i className="sf-nuqta" aria-hidden /><span>برای این تاریخ قبلاً <Link className="sf-link" to={`/${orgId}/accounting/vouchers/${p.existing.voucher_id}`}>سند تسعیر {faDigits(p.existing.no)}</Link> ثبت شده است؛ ثبت دوباره جایگزینش می‌کند.</span></div> : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Section title="نرخ تسعیر" bodyClass="p-0">
          <Table
            className=""
            size="small"
            rowKey="currency_id"
            loading={pv.isLoading}
            dataSource={p?.currencies ?? []}
            pagination={false}
            locale={{ emptyText: <EmptyState title="مانده‌ی ارزی برای تسعیر نیست" /> }}
            columns={[
              { key: "c", dataIndex: "code", title: "ارز", render: (v) => <CurrencyChip c={{ code: v, kind: "fiat" }} /> },
              {
                key: "r",
                title: "نرخ",
                render: (_, c: any) => <NumberInput size="small" decimals={8} value={rates[c.currency_id] ?? c.rate} onChange={(v) => setRates({ ...rates, [c.currency_id]: v })} status={!c.rate && !rates[c.currency_id] ? "warning" : undefined} />,
              },
              { key: "s", dataIndex: "source", title: "منبع", render: (v, c: any) => (rates[c.currency_id] ? <SourceTag s="manual" /> : <SourceTag s={v || null} />) },
            ]}
          />
        </Section>
        <div className="grid content-start gap-4">
          <div className="grid sm:grid-cols-3">
            <StatCard title="اثر تسعیر" value={<Money v={p?.total ?? 0} unit />} icon={<Ic icon={Calculator} />} hint={D(p?.total ?? 0).gte(0) ? "سود تسعیر" : "زیان تسعیر"} />
            <StatCard title="ردیف‌های تعدیل" icon={<Ic icon={Rows3} />} value={faDigits(p?.rows?.length ?? 0)} />
            <StatCard title="تاریخ تسعیر" icon={<Ic icon={Calendar} />} value={formatJalali(date)} />
          </div>
          <Section title="پیش‌نمایش تعدیل‌ها" bodyClass="p-0">
            <Table
              className=""
              size="small"
              rowKey={(r: any) => `${r.account_id}-${r.detail_id}-${r.currency_id}`}
              loading={pv.isFetching}
              dataSource={p?.rows ?? []}
              pagination={false}
              scroll={{ x: "max-content" }}
              locale={{ emptyText: <EmptyState title="همه‌ی مانده‌ها با نرخ این تاریخ هم‌خوان‌اند" /> }}
              columns={[
                { key: "a", title: "حساب", render: (_, r: any) => <div className="leading-5"><div className="text-[13px]">{r.account_name}</div>{r.detail_name ? <div className="text-[12px] text-ink-3">{r.detail_name}</div> : null}</div> },
                { key: "c", dataIndex: "code", title: "ارز", render: (v) => <CurrencyChip c={{ code: v, kind: "fiat" }} /> },
                { key: "fx", title: "مانده‌ی ارزی", className: "sf-num", render: (_, r: any) => <FxAmount v={r.fx} dp={r.decimals} /> },
                { key: "book", title: "ارزش دفتری", className: "sf-num", render: (_, r: any) => <Money v={r.book} /> },
                { key: "rate", title: "نرخ", className: "sf-num", render: (_, r: any) => <span className="sf-num text-ink-3">{rateLabel(r.rate, baseDp)}</span> },
                { key: "target", title: "ارزش با نرخ تسعیر", className: "sf-num", render: (_, r: any) => <Money v={r.target} /> },
                { key: "diff", title: "تعدیل", className: "sf-num", render: (_, r: any) => <Money v={r.diff} /> },
              ]}
            />
          </Section>
          <Section title="سندهای تسعیر قبلی" bodyClass="p-0">
            <Table
              className=""
              size="small"
              rowKey="id"
              loading={list.isLoading}
              dataSource={list.data?.rows ?? []}
              pagination={false}
              locale={{ emptyText: <EmptyState title="هنوز تسعیری ثبت نشده است" /> }}
              columns={[
                { key: "d", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
                { key: "no", dataIndex: "no", title: "سند", render: (v, r: any) => <Link to={`/${orgId}/accounting/vouchers/${r.id}`} className="sf-link sf-num">{faDigits(v)}</Link> },
                { key: "r", dataIndex: "result", title: "اثر", className: "sf-num", render: (v) => <Money v={v} /> },
                {
                  key: "x",
                  width: 40,
                  render: (_, r: any) =>
                    canPost ? (
                      <Tooltip title="حذف سند تسعیر">
                        <span className="sf-row-act"><Button size="small" type="text" icon={<Ic icon={Trash2} />} aria-label="حذف سند تسعیر" onClick={async () => { if (await n.confirm("سند تسعیر حذف شود؟", undefined, true)) remove.mutate(r.id); }} /></span>
                      </Tooltip>
                    ) : null,
                },
              ]}
            />
          </Section>
        </div>
      </div>
      <div className="mt-4 max-w-[760px] text-[12px] leading-5 text-ink-3">
        تسعیر، ارزش ریالی مانده‌ی هر ارز در صندوق‌ها، بانک‌ها و کیف‌پول‌ها (و در صورت انتخاب، حساب اشخاص و همکاران) را با نرخ تاریخ تسعیر برابر می‌کند و اختلاف را به «سود (زیان) تسعیر ارز» می‌برد. پس از تسعیر، میانگین بهای ارز همان نرخ تسعیر است.
      </div>
    </div>
  );
}
