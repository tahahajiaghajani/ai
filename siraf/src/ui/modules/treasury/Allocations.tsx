// Settling a receipt/payment against the party's invoices (تخصیص به فاکتور). Invoices are only
// read; the allocations are saved with the treasury document.
import { Button, Table } from "antd";
import { Zap } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { Chip, JDate } from "../../components/display";
import { MoneyInput } from "../../components/inputs";
import { faDigits } from "@shared/format";
import { D, type Num } from "@shared/money";
import type { DocKind } from "./labels";
import { Amt, Card, ICON14, docNo } from "../reports/kit";

const INVOICE_KIND: Record<string, string> = { sale: "فروش", purchase: "خرید", sale_return: "برگشت از فروش", purchase_return: "برگشت از خرید" };

interface Props {
  kind: DocKind;
  partyId: string;
  docId: string | null;
  total: Num;
  value: Record<string, string | null>;
  onChange: (v: Record<string, string | null>) => void;
  readonly: boolean;
}

export function Allocations({ kind, partyId, docId, total, value, onChange, readonly }: Props) {
  const { api } = useOrg();
  const q = useQuery({
    queryKey: ["treasury-open-invoices", partyId, kind, docId],
    queryFn: () => api.get<{ rows: any[] }>("/treasury/invoices", { party_id: partyId, kind, doc_id: docId }).then((r) => r.rows),
  });
  const rows = q.data ?? [];
  const allocated = Object.values(value).reduce((a, v) => a.plus(D(v)), D(0));
  const over = allocated.gt(D(total));
  const room = (r: any) => D(r.total).minus(D(r.allocated));

  const auto = () => {
    let left = D(total);
    const next: Record<string, string | null> = {};
    for (const r of rows) {
      const take = left.lt(room(r)) ? left : room(r);
      if (take.gt(0)) next[r.id] = take.toString();
      left = left.minus(take.gt(0) ? take : 0);
    }
    onChange(next);
  };

  if (!q.isLoading && !rows.length && !Object.keys(value).length) return null;
  return (
    <Card
      className="mt-4"
      title="تسویه با فاکتورها"
      meta={rows.length ? <span className="bk-cap">{faDigits(rows.length)} فاکتور باز</span> : null}
      tools={
        !readonly && rows.length ? (
          <Button size="small" icon={<Zap {...ICON14} />} onClick={auto}>
            تخصیص خودکار، قدیمی‌ترها اول
          </Button>
        ) : null
      }
      flush
    >
      <Table
        className="bk-tbl"
        size="small"
        rowKey="id"
        loading={q.isLoading}
        pagination={false}
        dataSource={rows}
        scroll={{ x: "max-content" }}
        columns={[
          { key: "no", dataIndex: "no", title: "فاکتور", width: 120, render: (v, r: any) => <span className="bk-docno">{INVOICE_KIND[r.kind] ?? r.kind} {docNo(v)}</span> },
          { key: "date", dataIndex: "date", title: "تاریخ", width: 112, render: (v) => <JDate v={v} /> },
          { key: "due", dataIndex: "due_date", title: "سررسید", width: 112, render: (v) => <JDate v={v} /> },
          { key: "total", dataIndex: "total", title: "مبلغ فاکتور", className: "sf-num", width: 152, render: (v) => <Amt v={v} /> },
          { key: "left", title: "قابل تخصیص", className: "sf-num", width: 152, render: (_, r: any) => <Amt v={room(r).toString()} /> },
          {
            key: "amount",
            title: "تخصیص از این سند",
            width: 184,
            render: (_, r: any) => (
              <MoneyInput
                size="small"
                value={value[r.id] ?? null}
                disabled={readonly}
                status={D(value[r.id]).gt(room(r)) ? "error" : undefined}
                onChange={(v) => onChange({ ...value, [r.id]: v })}
                placeholder="—"
              />
            ),
          },
        ]}
      />
      <div className="bk-foot">
        <div className="bk-foot-sm">
          <small>جمع تخصیص</small>
          <b><Amt v={allocated.toString()} zero="۰" /></b>
        </div>
        <div className="bk-foot-sm">
          <small>مبلغ سند</small>
          <b><Amt v={D(total).toString()} zero="۰" /></b>
        </div>
        {over ? (
          <Chip tone="danger">جمع تخصیص از مبلغ سند بیشتر است</Chip>
        ) : D(total).gt(allocated) && allocated.gt(0) ? (
          <span className="bk-plain sf-num">
            بی‌تخصیص <Amt v={D(total).minus(allocated).toString()} />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
