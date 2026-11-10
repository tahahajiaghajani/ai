// Record-page extensions of ITAM's work records: the physical audit's «شمارش» tab (scan or type tags, serials or QR
// links — a keyboard-wedge scanner ends each code with Enter — with the result of every scan and the running counts),
// the purchase order's «دریافت کالا» (quantities and serials per line, posted as a goods receipt that creates the
// assets) and the approved requisition's «ثبت سفارش خرید».
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { App, Button, Input, InputNumber, Modal, Table, type InputRef } from "antd";
import { PackageCheck, ScanBarcode, ShoppingCart } from "lucide-react";
import type { ScanResult } from "@shared/itam/api";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { Card, Field } from "../../components/blocks";
import { Chip, StatCard } from "../../components/display";
import { recordsApi, RecordSelect } from "../../records";
import type { RecordContext } from "../../records/extensions";
import { itamApi } from "./api";
import { ICON } from "./parts";

const RESULT: Record<ScanResult["result"], [string, "in" | "warning" | "danger" | "neutral" | "accent"]> = {
  found: ["دیده شد", "in"], moved: ["جابه‌جا", "warning"], unexpected: ["ناشناخته", "danger"], duplicate: ["تکراری", "neutral"], unknown: ["ثبت‌نشده", "danger"],
};

export function AuditScanTab({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const id = String(ctx.row.id);
  const [code, setCode] = useState("");
  const [log, setLog] = useState<(ScanResult & { code: string; at: string })[]>([]);
  const input = useRef<InputRef>(null);
  const live = ctx.row.state === "in_progress";
  useEffect(() => {
    if (live) input.current?.focus();
  }, [live]);
  const scan = useMutation({
    mutationFn: (c: string) => itamApi.scan(api, id, c),
    onSuccess: (r, c) => {
      setLog((xs) => [{ ...r, code: c, at: new Date().toISOString() }, ...xs].slice(0, 50));
      setCode("");
      input.current?.focus();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const counts = log[0]?.counts ?? { expected: Number(ctx.row.expected_count ?? 0), found: Number(ctx.row.found_count ?? 0), missing: Number(ctx.row.missing_count ?? 0), unexpected: Number(ctx.row.unexpected_count ?? 0) };
  return (
    <div className="flex flex-col gap-3">
      <div className="itam-tiles">
        <StatCard title="مورد انتظار" value={fa(counts.expected)} />
        <StatCard title="دیده‌شده" value={fa(counts.found)} />
        <StatCard title="ناشناخته یا جابه‌جا" value={fa(counts.unexpected)} />
      </div>
      <Card title="اسکن">
        {live ? (
          <Input
            ref={input}
            size="large"
            dir="ltr"
            prefix={<ScanBarcode {...ICON} />}
            placeholder="برچسب، سریال یا QR را اسکن کنید و Enter بزنید"
            aria-label="کد"
            value={code}
            disabled={scan.isPending}
            onChange={(e) => setCode(e.target.value)}
            onPressEnter={() => code.trim() && scan.mutate(code.trim())}
          />
        ) : (
          <div className="text-ink-3 text-[13px]">{ctx.row.state === "planned" ? "برای اسکن، «شروع شمارش» را بزنید" : "شمارش پایان یافته است"}</div>
        )}
      </Card>
      {log.length ? (
        <Card title="آخرین اسکن‌ها" flush>
          <Table
            rowKey={(r) => `${r.at}-${r.code}`}
            size="small"
            pagination={false}
            dataSource={log}
            columns={[
              { title: "کد", dataIndex: "code", key: "code", render: (v: string) => <span dir="ltr">{v}</span> },
              { title: "دارایی", dataIndex: "asset", key: "asset", render: (v: ScanResult["asset"]) => (v ? `${v.asset_tag ?? v.number ?? ""} ${v.name}` : "—") },
              { title: "نتیجه", dataIndex: "result", key: "result", render: (v: ScanResult["result"]) => <Chip tone={RESULT[v][1]}>{RESULT[v][0]}</Chip> },
            ]}
          />
        </Card>
      ) : null}
    </div>
  );
}

interface LineRow {
  id: string;
  line_no: number;
  description: string;
  quantity: number;
  received_qty: number;
}

export function PoActions({ ctx }: { ctx: RecordContext }) {
  const { api } = useOrg();
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<string | null>((ctx.row.delivery_stockroom_id as string) ?? null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [serials, setSerials] = useState<Record<string, string>>({});
  const id = String(ctx.row.id);
  const lines = useQuery({
    queryKey: ["itam", "po-lines", id, open],
    queryFn: () => recordsApi.list(api, "purchase_order_line", { filter: { f: "po_id", op: "eq", v: id }, sort: "line_no", size: 200 }),
    enabled: open,
  });
  const rows: LineRow[] = (lines.data?.rows ?? []).map((r) => ({ id: String(r.id), line_no: Number(r.line_no ?? 0), description: String(r.description ?? ""), quantity: Number(r.quantity ?? 0), received_qty: Number(r.received_qty ?? 0) }));
  const receive = useMutation({
    mutationFn: () => itamApi.receive(api, id, {
      stockroom_id: room,
      lines: rows.filter((r) => (qty[r.id] ?? 0) > 0).map((r) => ({ po_line_id: r.id, quantity: qty[r.id], serials: (serials[r.id] ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean) })),
    }),
    onSuccess: (r) => {
      message.success(`رسید ${r.number ?? ""} ثبت شد؛ ${fa(r.assets)} دارایی ساخته شد`);
      setOpen(false);
      ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (!ctx.meta.canWrite || !["ordered", "partially_received"].includes(String(ctx.row.state))) return null;
  return (
    <>
      <Button size="small" type="primary" icon={<PackageCheck {...ICON} />} onClick={() => { setQty({}); setSerials({}); setOpen(true); }}>دریافت کالا</Button>
      <Modal open={open} width={760} title="دریافت کالا" onCancel={() => setOpen(false)} onOk={() => receive.mutate()} okText="ثبت رسید" confirmLoading={receive.isPending} okButtonProps={{ disabled: !room || !Object.values(qty).some((v) => v > 0) }} destroyOnHidden>
        <div className="flex flex-col gap-3">
          <Field label="انبار دریافت"><RecordSelect table="stockroom" value={room} onChange={(v) => setRoom((v as string) ?? null)} /></Field>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            loading={lines.isLoading}
            dataSource={rows}
            columns={[
              { title: "ردیف", dataIndex: "line_no", key: "no", width: 56, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
              { title: "شرح", dataIndex: "description", key: "desc" },
              { title: "مانده", key: "left", width: 70, render: (_: unknown, r: LineRow) => <span className="ds-num">{fa(r.quantity - r.received_qty)}</span> },
              { title: "دریافت", key: "qty", width: 100, render: (_: unknown, r: LineRow) => <InputNumber aria-label="تعداد دریافت" min={0} max={r.quantity - r.received_qty} value={qty[r.id] ?? 0} onChange={(v) => setQty((x) => ({ ...x, [r.id]: Number(v ?? 0) }))} /> },
              { title: "سریال‌ها (هر خط یکی)", key: "serials", render: (_: unknown, r: LineRow) => <Input.TextArea aria-label="سریال‌ها" dir="ltr" rows={2} value={serials[r.id] ?? ""} onChange={(e) => setSerials((x) => ({ ...x, [r.id]: e.target.value }))} /> },
            ]}
          />
        </div>
      </Modal>
    </>
  );
}

export function RequisitionActions({ ctx }: { ctx: RecordContext }) {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const order = useMutation({
    mutationFn: () => itamApi.order(api, String(ctx.row.id)),
    onSuccess: (r) => {
      message.success(`${fa(r.orders.length)} سفارش خرید ساخته شد`);
      if (r.orders[0]) nav(`/${orgId}/itam/orders/${r.orders[0].id}`);
      else ctx.refresh();
    },
    onError: (e: Error) => message.error(e.message),
  });
  if (ctx.row.state !== "approved") return null;
  return <Button size="small" type="primary" icon={<ShoppingCart {...ICON} />} loading={order.isPending} onClick={() => order.mutate()}>ثبت سفارش خرید</Button>;
}
