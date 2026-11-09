// «موجودی انبارها» (catalogue ITAM-013/014/015): stock per model and stockroom (available, reserved, defective) against
// the stock rules, the alerts first — what is out or at its reorder point, with the quantity to order — and a purchase
// requisition raised for the chosen alerts in one step. The ledger of movements stays in «گردش موجودی».
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Select, Space, Table } from "antd";
import { ArrowLeftRight, RefreshCw, ShoppingCart, Warehouse } from "lucide-react";
import type { StockRow } from "@shared/itam/api";
import { useOrg } from "../../lib/org";
import { fa } from "../../lib/fa";
import { PageHeader } from "../../components/layout";
import { Card } from "../../components/blocks";
import { Chip, EmptyState, Loader, StatCard } from "../../components/display";
import { itamApi, ITAM_KEYS } from "./api";
import { ICON } from "./parts";

const STATUS: Record<string, [string, "in" | "warning" | "danger"]> = { ok: ["کافی", "in"], low: ["زیر نقطهٔ سفارش", "warning"], out: ["تمام‌شده", "danger"] };

export default function StockPage() {
  const { api, orgId } = useOrg();
  const { message } = App.useApp();
  const nav = useNavigate();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ITAM_KEYS.meta(orgId), queryFn: () => itamApi.meta(api), staleTime: 300_000 });
  const q = useQuery({ queryKey: ITAM_KEYS.stock(orgId), queryFn: () => itamApi.stock(api) });
  const [room, setRoom] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const raise = useMutation({
    mutationFn: () => itamApi.stockRequisition(api, picked),
    onSuccess: (r) => {
      message.success(`درخواست خرید ${r.number ?? ""} ساخته شد`);
      setPicked([]);
      nav(`/${orgId}/itam/requisitions/${r.id}`);
    },
    onError: (e: Error) => message.error(e.message),
  });
  const check = useMutation({
    mutationFn: () => itamApi.stockCheck(api),
    onSuccess: (r) => {
      message.success(`${fa(r.checked)} قاعده بررسی شد؛ ${fa(r.alerts)} هشدار تازه`);
      qc.invalidateQueries({ queryKey: ITAM_KEYS.stock(orgId) });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const d = q.data;
  const rows = useMemo(() => (d?.rows ?? []).filter((r) => !room || r.stockroom_id === room), [d, room]);
  const alerts = rows.filter((r) => r.status === "low" || r.status === "out");
  const columns = [
    { title: "مدل", dataIndex: "model", key: "model", render: (v: string, r: StockRow) => <Link className="ds-link" to={`/${orgId}/itam/models/${r.model_id}`}>{v}</Link> },
    { title: "انبار", dataIndex: "stockroom", key: "room" },
    { title: "آماده", dataIndex: "available", key: "available", width: 80, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "رزرو", dataIndex: "reserved", key: "reserved", width: 70, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "معیوب", dataIndex: "defective", key: "defective", width: 70, render: (v: number) => <span className="ds-num">{fa(v)}</span> },
    { title: "نقطهٔ سفارش", dataIndex: "min_qty", key: "min", width: 100, render: (v: number | null) => (v === null ? "—" : <span className="ds-num">{fa(v)}</span>) },
    { title: "سطح هدف", dataIndex: "max_qty", key: "max", width: 90, render: (v: number | null) => (v === null ? "—" : <span className="ds-num">{fa(v)}</span>) },
    { title: "وضعیت", dataIndex: "status", key: "status", width: 140, render: (v: string | null) => (v ? <Chip tone={STATUS[v][1]}>{STATUS[v][0]}</Chip> : <span className="text-ink-3">بی‌قاعده</span>) },
    { title: "سفارش", dataIndex: "order_qty", key: "order", width: 80, render: (v: number) => (v ? <span className="ds-num">{fa(v)}</span> : "—") },
  ];
  return (
    <div>
      <PageHeader
        title="موجودی انبارها"
        actions={
          <Space wrap>
            <Select allowClear placeholder="همهٔ انبارها" style={{ minWidth: 200 }} value={room ?? undefined} onChange={(v) => setRoom(v ?? null)} options={(d?.stockrooms ?? []).map((s) => ({ value: s.id, label: s.name }))} aria-label="انبار" />
            <Button icon={<ArrowLeftRight {...ICON} />} onClick={() => nav(`/${orgId}/itam/movements`)}>گردش موجودی</Button>
            {meta.data?.can_manage ? <Button icon={<RefreshCw {...ICON} />} loading={check.isPending} onClick={() => check.mutate()}>بررسی قاعده‌ها</Button> : null}
          </Space>
        }
      />
      {q.isLoading ? (
        <Loader />
      ) : !d || !d.rows.length ? (
        <EmptyState title="موجودی‌ای ثبت نشده است" description="دارایی‌های «در انبار» و قاعده‌های موجودی این‌جا دیده می‌شوند." icon={Warehouse} action={<Button type="primary" onClick={() => nav(`/${orgId}/itam/stock-rules/new`)}>قاعدهٔ موجودی تازه</Button>} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="itam-tiles">
            {d.stockrooms.map((s) => (
              <StatCard key={s.id} title={s.name} value={fa(s.available)} hint={s.alerts ? `${fa(s.alerts)} هشدار` : "بدون هشدار"} onClick={() => setRoom(s.id)} />
            ))}
          </div>
          {alerts.length ? (
            <Card
              title="هشدارهای موجودی"
              flush
              tools={<Button size="small" type="primary" icon={<ShoppingCart {...ICON} />} disabled={!picked.length} loading={raise.isPending} onClick={() => raise.mutate()}>درخواست خرید برای انتخاب‌شده‌ها</Button>}
            >
              <Table
                rowKey={(r) => r.rule_id ?? `${r.model_id}|${r.stockroom_id}`}
                size="small"
                pagination={false}
                dataSource={alerts}
                columns={columns}
                scroll={{ x: 900 }}
                rowSelection={{ selectedRowKeys: picked, onChange: (keys) => setPicked(keys.map(String)) }}
              />
            </Card>
          ) : null}
          <Card title="همهٔ موجودی‌ها" flush>
            <Table rowKey={(r) => `${r.model_id}|${r.stockroom_id}`} size="small" pagination={{ pageSize: 50, hideOnSinglePage: true }} dataSource={rows} columns={columns} scroll={{ x: 900 }} />
          </Card>
        </div>
      )}
    </div>
  );
}
