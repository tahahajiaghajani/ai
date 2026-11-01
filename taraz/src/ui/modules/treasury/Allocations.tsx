// Settling a receipt/payment against the party's invoices (تخصیص به فاکتور). Invoices are only
// read; the allocations are saved with the treasury document.
import { Button, Table, Tag } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { Section } from "../../components/layout";
import { Money, JDate } from "../../components/display";
import { MoneyInput } from "../../components/inputs";
import { faDigits } from "@shared/format";
import { D, type Num } from "@shared/money";
import type { DocKind } from "./labels";

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
    <Section
      className="mt-4"
      title="تسویه با فاکتورها"
      extra={
        !readonly && rows.length ? (
          <Button size="small" icon={<ThunderboltOutlined />} onClick={auto}>
            تخصیص خودکار (قدیمی‌ترها اول)
          </Button>
        ) : null
      }
      bodyClass="p-0"
    >
      <Table
        className="tz-table"
        size="small"
        rowKey="id"
        loading={q.isLoading}
        pagination={false}
        dataSource={rows}
        scroll={{ x: "max-content" }}
        columns={[
          { key: "kind", dataIndex: "kind", title: "نوع", render: (v) => <Tag variant="filled" className="!m-0">{INVOICE_KIND[v] ?? v}</Tag> },
          { key: "no", dataIndex: "no", title: "شماره", render: (v) => <b className="num">{faDigits(v)}</b> },
          { key: "date", dataIndex: "date", title: "تاریخ", render: (v) => <JDate v={v} /> },
          { key: "due", dataIndex: "due_date", title: "سررسید", render: (v) => <JDate v={v} /> },
          { key: "total", dataIndex: "total", title: "مبلغ فاکتور", align: "left", render: (v) => <Money v={v} /> },
          { key: "left", title: "قابل تخصیص", align: "left", render: (_, r: any) => <Money v={room(r).toString()} /> },
          {
            key: "amount",
            title: "تخصیص از این سند",
            width: 180,
            render: (_, r: any) => (
              <MoneyInput
                size="small"
                value={value[r.id] ?? null}
                disabled={readonly}
                status={D(value[r.id]).gt(room(r)) ? "error" : undefined}
                onChange={(v) => onChange({ ...value, [r.id]: v })}
                placeholder="۰"
              />
            ),
          },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 text-xs">
        <span className="text-muted">جمع تخصیص:</span>
        <Money v={allocated.toString()} />
        <span className="text-muted">از</span>
        <Money v={D(total).toString()} />
        {over ? <Tag color="error" variant="filled">جمع تخصیص از مبلغ سند بیشتر است</Tag> : null}
      </div>
    </Section>
  );
}
