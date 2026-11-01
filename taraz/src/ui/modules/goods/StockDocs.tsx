// Stock documents list (رسید، حواله، انتقال، تعدیل) — or only stock counts (انبارگردانی).
import { useState } from "react";
import { Button, Dropdown, Input, Select, Space } from "antd";
import { DownOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { ServerTable } from "../../components/data";
import { JDate, Money } from "../../components/display";
import { DateInput, RefSelect } from "../../components/inputs";
import { D } from "@shared/money";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { STOCK_DOC_KINDS, STOCK_DOC_META, type StockDocKind } from "./labels";
import { InvoiceStatus, KindTag } from "./components";

const docValue = (r: any) => (r.kind === "transfer" ? D(r.value_in) : D(r.value_in).plus(D(r.value_out))).toString();

export default function StockDocs({ countOnly }: { countOnly?: boolean }) {
  const { fy, orgId, can } = useOrg();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const dq = useDebounced(q);
  const base = countOnly ? "inventory/count" : "inventory/docs";
  const kinds = countOnly ? "count" : kind ?? STOCK_DOC_KINDS.filter((k) => k !== "count").join(",");
  const title = countOnly ? "انبارگردانی" : "اسناد انبار";
  return (
    <div>
      <PageHeader
        title={title}
        subtitle={countOnly ? STOCK_DOC_META.count.hint : "رسید، حواله، انتقال بین انبارها و تعدیل موجودی"}
        actions={
          can("inventory", "edit") ? (
            countOnly ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/${orgId}/inventory/count/new`)}>انبارگردانی جدید</Button>
            ) : (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: STOCK_DOC_KINDS.filter((k) => k !== "count").map((k) => ({
                    key: k,
                    label: <div><div>{STOCK_DOC_META[k].title}</div><div className="text-[11px] text-muted">{STOCK_DOC_META[k].hint}</div></div>,
                    onClick: () => nav(`/${orgId}/inventory/docs/new?kind=${k}`),
                  })),
                }}
              >
                <Button type="primary" icon={<PlusOutlined />}>سند جدید <DownOutlined /></Button>
              </Dropdown>
            )
          ) : null
        }
      />
      <div className="tz-card p-3 md:p-4">
        <ServerTable
          path="/goods/stock-docs"
          params={{ kind: kinds, fiscal_year_id: fy?.id, q: dq, status, warehouse_id: warehouseId, from, to }}
          queryKey={["table", "goods-stock-docs", countOnly ? "count" : "docs"]}
          onRowClick={(r: any) => nav(`/${orgId}/${r.kind === "count" ? "inventory/count" : base}/${r.id}`)}
          exportName={title}
          exportColumns={[
            { title: "نوع", value: (r: any) => STOCK_DOC_META[r.kind as StockDocKind]?.title ?? r.kind },
            { title: "شماره", value: (r: any) => r.no, type: "number" },
            { title: "تاریخ", value: (r: any) => formatJalali(r.date, { latin: true }) },
            { title: "انبار", value: (r: any) => r.warehouse_name },
            { title: "انبار مقصد", value: (r: any) => r.dest_warehouse_name },
            { title: "شرح", value: (r: any) => r.description ?? r.party_name },
            { title: "ارزش", value: docValue, type: "number" },
          ]}
          toolbar={
            <Space wrap>
              <Input allowClear prefix={<SearchOutlined className="text-muted" />} placeholder="شماره یا شرح" value={q} onChange={(e) => setQ(e.target.value)} className="!w-48" />
              {!countOnly ? (
                <Select allowClear placeholder="نوع سند" value={kind} onChange={setKind} className="!w-40" options={STOCK_DOC_KINDS.filter((k) => k !== "count").map((k) => ({ value: k, label: STOCK_DOC_META[k].title }))} />
              ) : null}
              <RefSelect entity="warehouse" value={warehouseId} onChange={setWarehouseId} allowClear placeholder="انبار" className="!w-40" showCode={false} />
              <DateInput value={from} onChange={setFrom} placeholder="از تاریخ" allowClear className="!w-36" />
              <DateInput value={to} onChange={setTo} placeholder="تا تاریخ" allowClear className="!w-36" />
              <Select allowClear placeholder="وضعیت" value={status} onChange={setStatus} className="!w-32" options={[{ value: "draft", label: "پیش‌نویس" }, { value: "posted", label: "ثبت‌شده" }]} />
            </Space>
          }
          columns={[
            { key: "no", dataIndex: "no", title: "شماره", width: 80, sorter: true, render: (v) => <b className="num">{faDigits(v)}</b> },
            { key: "date", dataIndex: "date", title: "تاریخ", width: 110, sorter: true, render: (v) => <JDate v={v} /> },
            ...(!countOnly ? [{ key: "kind", dataIndex: "kind", title: "نوع", width: 130, render: (v: string) => <KindTag kind={v} /> }] : []),
            {
              key: "wh",
              title: "انبار",
              render: (_, r: any) => (
                <span>
                  {r.warehouse_name}
                  {r.kind === "transfer" ? <span className="text-muted"> ← {r.dest_warehouse_name}</span> : null}
                </span>
              ),
            },
            { key: "desc", title: "شرح", ellipsis: true, render: (_, r: any) => r.description ?? r.party_name ?? <span className="text-muted">—</span> },
            { key: "lines", dataIndex: "line_count", title: "ردیف", width: 70, render: (v) => <span className="num">{faDigits(v)}</span> },
            { key: "value", title: "ارزش", align: "left", width: 150, render: (_, r: any) => <Money v={docValue(r)} zero="—" /> },
            { key: "status", dataIndex: "status", title: "وضعیت", width: 100, render: (v) => <InvoiceStatus s={v} /> },
          ]}
        />
      </div>
    </div>
  );
}
