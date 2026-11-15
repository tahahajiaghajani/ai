// «کتابخانه» (design F §8.1): the organisation's library fields — search, chips «مبلغ · تاریخ · گزینه · افراد ·
// بازنشسته», and the columns برچسب | نام فنی | نوع | گروه حساسیت | به کار رفته در | وضعیت. A row opens its sheet.
import { useState } from "react";
import { Button, Input, Table } from "antd";
import { Plus, Search } from "lucide-react";
import type { LibraryEntry } from "./api";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { ToggleChip } from "../../../../components/inputs";
import { LIBRARY_CHIPS, fieldGroupLabel, filterLibrary, type LibraryChip } from "./model";
import { I14, I16 } from "./parts";
import { UsageCell } from "./Usage";

export interface LibraryProps {
  rows: LibraryEntry[] | undefined;
  loading: boolean;
  canWrite: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
}

export function Library({ rows, loading, canWrite, onOpen, onNew }: LibraryProps) {
  const [q, setQ] = useState("");
  const [chips, setChips] = useState<LibraryChip["key"][]>([]);
  const [retired, setRetired] = useState(false);
  const shown = filterLibrary(rows ?? [], { q, chips, retired });
  const toggle = (k: LibraryChip["key"], on: boolean) => setChips((x) => (on ? [...x, k] : x.filter((c) => c !== k)));
  if (loading && !rows) return <Loader />;
  if (rows && !rows.length)
    return (
      <EmptyState
        title="هنوز فیلدی در کتابخانه نیست"
        description="فیلدی مانند «کد ملی» یا «مبلغ درخواستی» را یک بار بسازید و در جدول‌ها و فرم‌ها به کار ببرید."
        action={canWrite ? <Button icon={<Plus {...I16} />} onClick={onNew}>فیلد تازه</Button> : undefined}
      />
    );
  return (
    <div className="wff-tab">
      <div className="wff-bar" role="search">
        <Input allowClear prefix={<Search {...I14} aria-hidden />} placeholder="جست‌وجوی برچسب یا نام فنی…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجوی فیلدها" className="wff-search" />
        <span className="wff-chips">
          {LIBRARY_CHIPS.map((c) => (
            <ToggleChip key={c.key} on={chips.includes(c.key)} onChange={(on) => toggle(c.key, on)}>
              {c.label}
            </ToggleChip>
          ))}
          <ToggleChip on={retired} onChange={setRetired}>
            بازنشسته
          </ToggleChip>
        </span>
      </div>
      <Table<LibraryEntry>
        size="small"
        className="ds-table"
        rowKey="id"
        dataSource={shown}
        pagination={shown.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
        scroll={{ x: 760 }}
        locale={{ emptyText: <EmptyState compact title="فیلدی با این پالایه نیست" /> }}
        onRow={(r) => ({ onClick: () => onOpen(r.id), onKeyDown: (e) => e.key === "Enter" && onOpen(r.id), tabIndex: 0, className: "cursor-pointer" })}
        columns={[
          { key: "label", title: "برچسب", dataIndex: "label", render: (v: string) => <span className="text-ink">{v}</span> },
          { key: "name", title: "نام فنی", dataIndex: "name", render: (v: string) => <bdi dir="ltr" className="ds-mono">{v}</bdi> },
          { key: "type", title: "نوع", dataIndex: "type_label" },
          { key: "group", title: "گروه حساسیت", dataIndex: "field_group", render: (v: string | null) => fieldGroupLabel(v) || <span className="text-ink-3">—</span> },
          { key: "usage", title: "به کار رفته در", render: (_: unknown, r) => <UsageCell usage={r.usage} /> },
          { key: "status", title: "وضعیت", dataIndex: "status", render: (v: string) => (v === "retired" ? <Chip dot={false}>بازنشسته</Chip> : <Chip tone="in">فعال</Chip>) },
        ]}
      />
    </div>
  );
}
