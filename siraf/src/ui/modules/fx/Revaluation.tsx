// Revaluation (تسعیر ارز): preview the adjustment of every foreign balance to the rate of a date
// (rates from the board, editable), post it as one voucher, and list or remove past runs.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Switch, Table, Tooltip } from "antd";
import { CalculatorOutlined, CheckOutlined, DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
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
              icon={<CheckOutlined />}
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted">تاریخ تسعیر</span>
        <DateInput value={date} onChange={(v) => v && setDate(v)} className="!w-36" />
        <label className="flex items-center gap-2 text-sm">
          <Switch size="small" checked={parties} onChange={setParties} /> حساب ارزی مشتریان و همکاران هم تسعیر شود
        </label>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => setRates({})}>نرخ‌های تابلو</Button>
      </div>
      {pv.error ? <Alert className="!mb-4" type="error" showIcon title={errorText(pv.error)} /> : null}
      {p?.missing_rates?.length ? <Alert className="!mb-4" type="warning" showIcon title={`نرخ این ارزها تا ${formatJalali(date)} در تابلو نیست؛ نرخ را در جدول زیر بنویسید: ${p.missing_rates.join("، ")}`} /> : null}
      {p?.existing ? <Alert className="!mb-4" type="info" showIcon title={<>برای این تاریخ قبلاً سند تسعیر ش <Link to={`/${orgId}/accounting/vouchers/${p.existing.voucher_id}`}>{faDigits(p.existing.no)}</Link> ثبت شده است؛ ثبت دوباره جایگزینش می‌کند.</>} /> : null}

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Section title="نرخ تسعیر" bodyClass="p-0">
          <Table
            className="tz-table"
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
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard title="اثر تسعیر" value={<Money v={p?.total ?? 0} colored />} icon={<CalculatorOutlined />} tone={D(p?.total ?? 0).lt(0) ? "bad" : "ok"} hint={D(p?.total ?? 0).gte(0) ? "سود تسعیر" : "زیان تسعیر"} />
            <StatCard title="ردیف‌های تعدیل" value={faDigits(p?.rows?.length ?? 0)} tone="muted" />
            <StatCard title="تاریخ" value={formatJalali(date)} tone="muted" />
          </div>
          <Section title="پیش‌نمایش تعدیل‌ها" bodyClass="p-0">
            <Table
              className="tz-table"
              size="small"
              rowKey={(r: any) => `${r.account_id}-${r.detail_id}-${r.currency_id}`}
              loading={pv.isFetching}
              dataSource={p?.rows ?? []}
              pagination={false}
              scroll={{ x: "max-content" }}
              locale={{ emptyText: <EmptyState title="همه‌ی مانده‌ها با نرخ این تاریخ هم‌خوان‌اند" /> }}
              columns={[
                { key: "a", title: "حساب", render: (_, r: any) => <div className="leading-4"><div className="text-xs">{r.account_name}</div><div className="text-[11px] text-muted">{r.detail_name ?? ""}</div></div> },
                { key: "c", dataIndex: "code", title: "ارز", render: (v) => <span className="ltr text-xs font-bold">{v}</span> },
                { key: "fx", title: "مانده‌ی ارزی", align: "left", render: (_, r: any) => <FxAmount v={r.fx} dp={r.decimals} /> },
                { key: "book", title: "ارزش دفتری", align: "left", render: (_, r: any) => <Money v={r.book} /> },
                { key: "rate", title: "نرخ", align: "left", render: (_, r: any) => <span className="num text-muted">{rateLabel(r.rate, baseDp)}</span> },
                { key: "target", title: "ارزش با نرخ تسعیر", align: "left", render: (_, r: any) => <Money v={r.target} /> },
                { key: "diff", title: "تعدیل", align: "left", render: (_, r: any) => <Money v={r.diff} colored /> },
              ]}
            />
          </Section>
          <Section title="سندهای تسعیر قبلی" bodyClass="p-0">
            <Table
              className="tz-table"
              size="small"
              rowKey="id"
              loading={list.isLoading}
              dataSource={list.data?.rows ?? []}
              pagination={false}
              locale={{ emptyText: <EmptyState title="هنوز تسعیری ثبت نشده است" /> }}
              columns={[
                { key: "d", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
                { key: "no", dataIndex: "no", title: "سند", render: (v, r: any) => <Link to={`/${orgId}/accounting/vouchers/${r.id}`} className="num">{faDigits(v)}</Link> },
                { key: "r", dataIndex: "result", title: "اثر", align: "left", render: (v) => <Money v={v} colored /> },
                {
                  key: "x",
                  width: 40,
                  render: (_, r: any) =>
                    canPost ? (
                      <Tooltip title="حذف سند تسعیر">
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={async () => { if (await n.confirm("حذف سند تسعیر؟", undefined, true)) remove.mutate(r.id); }} />
                      </Tooltip>
                    ) : null,
                },
              ]}
            />
          </Section>
        </div>
      </div>
      <div className="mt-3 text-[11px] text-muted">
        تسعیر، ارزش ریالی مانده‌ی هر ارز در صندوق‌ها، بانک‌ها و کیف‌پول‌ها (و در صورت انتخاب، حساب اشخاص و همکاران) را با نرخ تاریخ تسعیر برابر می‌کند و اختلاف را به «سود (زیان) تسعیر ارز» می‌برد. پس از تسعیر، میانگین بهای ارز همان نرخ تسعیر است.
      </div>
    </div>
  );
}
