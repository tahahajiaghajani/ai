// Record-page extensions of IT financial management: the allocation run's header actions («محاسبه»، «ثبت در دفتر» for
// an approved chargeback) and its «صورت‌حساب» tab (each consumer unit's share by service, printable for showback), the
// cost entry's «برگشت ثبت» (the ledger is insert-only), and the «هزینهٔ خدمت» panel of services (direct and allocated
// costs of the fiscal year — financial field group).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Modal, Space, Table } from "antd";
import { Calculator, Printer, Stamp, Undo2 } from "lucide-react";
import { fiscalYearOf } from "@shared/financial/logic";
import { todayISO } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { Card, PrintHead } from "../../components/blocks";
import { EmptyState, Loader } from "../../components/display";
import type { RecordContext } from "../../records/extensions";
import { ICON, Money } from "../itam/parts";
import { financialApi, FINANCIAL_KEYS } from "../supplier/api";

export function RunActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const id = String(ctx.row.id);
  const calc = useMutation({
    mutationFn: () => financialApi.calculate(api, id),
    onSuccess: (r) => {
      message.success(`${fa(r.results)} سهم محاسبه شد`);
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const post = useMutation({
    mutationFn: () => financialApi.post(api, id),
    onSuccess: (r) => {
      message.success(`${fa(r.entries)} ثبت در دفتر هزینه انجام شد`);
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (!ctx.meta.canWrite) return null;
  const state = String(ctx.row.state);
  return (
    <Space size={6}>
      {["draft", "calculated"].includes(state) ? <Button size="small" type={state === "draft" ? "primary" : "default"} icon={<Calculator {...ICON} />} loading={calc.isPending} onClick={() => calc.mutate()}>{state === "draft" ? "محاسبه" : "محاسبهٔ دوباره"}</Button> : null}
      {state === "approved" && ctx.row.mode === "chargeback" ? <Button size="small" type="primary" icon={<Stamp {...ICON} />} loading={post.isPending} onClick={() => post.mutate()}>ثبت در دفتر</Button> : null}
    </Space>
  );
}

export function StatementTab({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: FINANCIAL_KEYS.statement(orgId, id), queryFn: () => financialApi.statement(api, id) });
  const d = q.data;
  if (q.isLoading) return <Loader />;
  if (!d || !d.units.length) return <EmptyState compact title="هنوز محاسبه نشده است" description="«محاسبه» سهم هر خدمت و هر واحد مصرف‌کننده را می‌سازد." />;
  return (
    <div className="flex flex-col gap-3">
      <div className="no-print"><Button size="small" icon={<Printer {...ICON} />} onClick={() => window.print()}>چاپ صورت‌حساب</Button></div>
      <PrintHead title={`${d.run.mode === "chargeback" ? "صورت‌حساب بازپرداخت هزینه" : "گزارش نمایش هزینه"} — ${d.run.name}`} no={d.run.number} lines={[d.run.period]} />
      <Card title="سهم خدمت‌ها" flush>
        <Table rowKey="service_id" size="small" pagination={false} dataSource={d.services} columns={[
          { title: "خدمت", dataIndex: "service", key: "service" },
          { title: "مبلغ", dataIndex: "total", key: "total", width: 200, render: (v: string) => <Money v={v} /> },
        ]} />
      </Card>
      {d.units.map((u) => (
        <Card key={u.unit_id ?? "none"} title={u.unit} meta={<Money v={u.total} />} flush>
          <Table rowKey={(r) => `${r.service_id}-${r.basis}`} size="small" pagination={false} dataSource={u.lines} columns={[
            { title: "خدمت", dataIndex: "service", key: "service" },
            { title: "مبنا", dataIndex: "basis", key: "basis" },
            { title: "مبلغ", dataIndex: "amount", key: "amount", width: 200, render: (v: string) => <Money v={v} /> },
          ]} />
        </Card>
      ))}
      <div className="text-[13px]">جمع: <Money v={d.total} /></div>
    </div>
  );
}

export function EntryActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const run = useMutation({
    mutationFn: () => financialApi.reverse(api, String(ctx.row.id), reason),
    onSuccess: (r) => {
      message.success(`ثبت برگشتی ${r.number ?? ""} زده شد`);
      setOpen(false);
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (ctx.row.reversed || ctx.row.reversal_of) return null;
  return (
    <>
      <Button size="small" icon={<Undo2 {...ICON} />} onClick={() => { setReason(""); setOpen(true); }}>برگشت ثبت</Button>
      <Modal open={open} title="برگشت ثبت هزینه" onCancel={() => setOpen(false)} onOk={() => run.mutate()} okText="ثبت برگشتی" confirmLoading={run.isPending} okButtonProps={{ disabled: reason.trim().length < 2 }} destroyOnHidden>
        <Input.TextArea aria-label="علت" rows={3} placeholder="علت برگشت (مثلاً ثبت تکراری)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
      </Modal>
    </>
  );
}

export function ServiceCostPanel({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const year = fiscalYearOf(todayISO());
  const id = String(ctx.row.id);
  const q = useQuery({ queryKey: FINANCIAL_KEYS.serviceCost(orgId, id, year), queryFn: () => financialApi.serviceCost(api, id, year), retry: false });
  if (q.isError) return <div className="text-ink-3 text-[13px]">هزینهٔ خدمت گروه فیلد «مالی» لازم دارد</div>;
  const d = q.data;
  if (!d) return <Loader />;
  return (
    <dl className="itam-dl">
      <dt>هزینهٔ مستقیم</dt>
      <dd><Money v={d.direct} /></dd>
      <dt>سهم از تسهیم</dt>
      <dd><Money v={d.allocated} /></dd>
      <dt>جمع سال</dt>
      <dd><Money v={d.total} /></dd>
    </dl>
  );
}
