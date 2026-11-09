// Record-page extensions of supplier and contract management: the contract's header actions — «تمدید» (a draft copy
// with lines and coverage that supersedes this contract once active) and «استخراج بندها» (terms and obligations read
// from the contract's smart document or attachment, each with its quote and page; the person picks what to apply,
// saved through the record's own write path) — and the supplier's «نمای ۳۶۰» tab (contracts, obligations, scorecard
// trend, assets, repairs, orders and the year's spend for the financial field group).
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Checkbox, Modal, Space, Table } from "antd";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { FileSearch, RefreshCcw } from "lucide-react";
import { CONTRACT_TYPES } from "@shared/tables/supplier";
import { COST_SOURCES } from "@shared/tables/financial";
import { formatJalali } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { Card, Note } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import type { RecordContext } from "../../records/extensions";
import { AiLabel, ICON, Money } from "../itam/parts";
import { supplierApi, SUPPLIER_KEYS, type ExtractResult } from "./api";

const show = (v: unknown, field: string): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (field.endsWith("_date") && typeof v === "string") return formatJalali(v);
  if (field === "renewal_type") return v === "auto" ? "خودکار" : v === "none" ? "بدون تمدید" : "دستی";
  if (field === "payment_frequency") return ({ one_off: "یک‌جا", monthly: "ماهانه", quarterly: "فصلی", semiannual: "شش‌ماهه", annual: "سالانه" } as Record<string, string>)[String(v)] ?? String(v);
  return String(v);
};

export function ContractActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message, modal } = App.useApp();
  const nav = useNavigate();
  const id = String(ctx.row.id);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [obls, setObls] = useState<number[]>([]);
  const renew = useMutation({
    mutationFn: () => supplierApi.renew(api, id),
    onSuccess: (r) => {
      message.success(`پیش‌نویس تمدید ${r.number ?? ""} ساخته شد`);
      nav(`/${orgId}/contracts/${r.id}`);
    },
    onError: (e: Error) => message.error(e.message),
  });
  const extract = useMutation({
    mutationFn: () => supplierApi.extract(api, id),
    onSuccess: (r) => {
      setResult(r);
      setFields(r.suggestions.map((s) => s.field));
      setObls(r.obligations.map((_, i) => i));
    },
    onError: (e: Error) => message.error(e.message),
  });
  const apply = useMutation({
    mutationFn: async () => {
      const data = Object.fromEntries((result?.suggestions ?? []).filter((s) => fields.includes(s.field)).map((s) => [s.field, s.value]));
      if (Object.keys(data).length && !(await ctx.save(data))) throw new Error("ذخیره انجام نشد");
      const items = (result?.obligations ?? []).filter((_, i) => obls.includes(i)).map((o) => ({ title: o.title.slice(0, 200), party: o.party }));
      if (items.length) await supplierApi.obligations(api, id, items);
      return { fields: Object.keys(data).length, obligations: items.length };
    },
    onSuccess: (r) => {
      message.success(`${fa(r.fields)} فیلد و ${fa(r.obligations)} تعهد ثبت شد`);
      setResult(null);
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const state = String(ctx.row.state);
  return (
    <Space size={6} wrap>
      {ctx.meta.canWrite ? <Button size="small" icon={<FileSearch {...ICON} />} loading={extract.isPending} onClick={() => extract.mutate()}>استخراج بندها</Button> : null}
      {["active", "expired"].includes(state) ? (
        <Button size="small" icon={<RefreshCcw {...ICON} />} loading={renew.isPending} onClick={() => modal.confirm({ title: "تمدید قرارداد", content: "یک پیش‌نویس از همین قرارداد با سطرها و پوشش آن برای دورهٔ بعد ساخته می‌شود.", okText: "ساخت پیش‌نویس", cancelText: "انصراف", onOk: () => renew.mutateAsync() })}>تمدید</Button>
      ) : null}
      <Modal open={!!result} width={820} title="بندهای استخراج‌شده" onCancel={() => setResult(null)} onOk={() => apply.mutate()} okText="ثبت انتخاب‌شده‌ها" confirmLoading={apply.isPending} okButtonProps={{ disabled: !fields.length && !obls.length }} destroyOnHidden>
        {result ? (
          result.source.kind === "none" ? (
            <Note tone="warning">متنی برای خواندن نیست: سند قرارداد را در «اسناد هوشمند» انتخاب کنید یا PDF یا Word قرارداد را پیوست کنید.</Note>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="text-[13px] text-ink-3">از {result.source.kind === "document" ? "سند هوشمند" : "پیوست"} «{result.source.name}» ({fa(result.source.pages)} صفحه)</div>
              {result.summary ? <Note>{result.summary}</Note> : null}
              <Table
                rowKey="field"
                size="small"
                pagination={false}
                dataSource={result.suggestions}
                locale={{ emptyText: "مقدار تازه‌ای پیدا نشد" }}
                rowSelection={{ selectedRowKeys: fields, onChange: (k) => setFields(k.map(String)) }}
                columns={[
                  { title: "فیلد", dataIndex: "label", key: "label", width: 140 },
                  { title: "کنونی", dataIndex: "current", key: "current", render: (v: unknown, r) => show(v, r.field) },
                  { title: "پیشنهاد", dataIndex: "value", key: "value", render: (v: unknown, r) => <b>{show(v, r.field)}</b> },
                  { title: "شاهد", dataIndex: "evidence", key: "evidence", render: (v: string | null, r) => (v ? <span className="text-[12px] text-ink-3">«{v}»{r.page ? ` — ص ${fa(r.page)}` : ""}</span> : "—") },
                ]}
              />
              {result.obligations.length ? (
                <Card title="تعهدها">
                  <Checkbox.Group value={obls} onChange={(v) => setObls(v as number[])} className="flex flex-col gap-1">
                    {result.obligations.map((o, i) => (
                      <Checkbox key={i} value={i}>
                        <Chip tone={o.party === "supplier" ? "accent" : "neutral"}>{o.party === "supplier" ? "تأمین‌کننده" : "سازمان ما"}</Chip> {o.title}
                      </Checkbox>
                    ))}
                  </Checkbox.Group>
                </Card>
              ) : null}
              <AiLabel ai={result.ai} model={result.model} />
            </div>
          )
        ) : null}
      </Modal>
    </Space>
  );
}

export function Supplier360Tab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: SUPPLIER_KEYS.s360(orgId, id), queryFn: () => supplierApi.s360(api, id) });
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d) return <EmptyState compact title="نمای ۳۶۰ در دسترس نیست" />;
  const trend = [...d.scorecards].reverse();
  return (
    <div className="flex flex-col gap-3">
      <div className="itam-tiles">
        <StatCard title="امتیاز عملکرد" value={d.supplier.score === null ? "—" : fa(d.supplier.score)} />
        <StatCard title="دارایی‌های تأمین‌شده" value={fa(d.assets.total)} hint={`${fa(d.assets.in_use)} در استفاده، ${fa(d.assets.in_repair)} در تعمیر`} />
        <StatCard title="تعمیرها" value={fa(d.repairs)} />
        <StatCard title="سفارش باز" value={fa(d.orders.open)} hint={d.orders.late ? `${fa(d.orders.late)} دیرکرد` : undefined} />
        {d.spend ? <StatCard title={`هزینهٔ سال ${fa(d.spend.year)}`} value={<Money v={d.spend.total} />} /> : null}
      </div>
      <Card title="قراردادها" flush>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={d.contracts}
          locale={{ emptyText: "قراردادی نیست یا اجازهٔ دیدن قراردادها را ندارید" }}
          columns={[
            { title: "قرارداد", dataIndex: "name", key: "name", render: (v: string, r) => <Link className="ds-link" to={`/${orgId}/contracts/${r.id}`}>{r.number} {v}</Link> },
            { title: "نوع", dataIndex: "type", key: "type", render: (v: string | null) => CONTRACT_TYPES.find((t) => t.value === v)?.label ?? "—" },
            { title: "پایان", dataIndex: "end_date", key: "end", render: (v: string | null) => (v ? formatJalali(v) : "—") },
            { title: "هزینهٔ سالانه", dataIndex: "annual_value", key: "value", render: (v: string | null) => <Money v={v} /> },
          ]}
        />
      </Card>
      {trend.length ? (
        <Card title="روند امتیاز">
          <div style={{ height: 180 }} dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--ds-line)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} />
                <YAxis domain={[0, 100]} width={32} tick={{ fontSize: 11, fill: "var(--ds-text-3)" }} tickFormatter={(v: number) => fa(v)} />
                <Tooltip formatter={(v) => [fa(Number(v)), "امتیاز"]} />
                <Line type="monotone" dataKey="score" stroke="var(--ds-chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}
      {d.obligations.length ? (
        <Card title="تعهدهای باز">
          <ul className="itam-list">
            {d.obligations.map((o) => (
              <li key={o.id}>
                <Link className="ds-link" to={`/${orgId}/supplier/obligations/${o.id}`}>{o.number} {o.title}</Link>
                <span className="text-ink-3 text-[12px]">{o.due_date ? formatJalali(o.due_date) : "—"}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {d.spend?.by_source.length ? (
        <Card title="هزینه بر پایهٔ منبع">
          <ul className="itam-list">{d.spend.by_source.map((s) => <li key={s.source}><span>{COST_SOURCES.find((x) => x.value === s.source)?.label ?? s.source}</span><Money v={s.amount} /></li>)}</ul>
        </Card>
      ) : null}
    </div>
  );
}
