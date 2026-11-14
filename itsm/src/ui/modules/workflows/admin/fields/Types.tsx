// «انواع فیلد» (design F §3.1, §8.1): the built-in types grouped as §3.1 lists them, each with the lock chip «پیش‌فرض»,
// and under each group the organisation's types derived from them. Any row opens the type's sheet (a built-in one
// read-only).
import { Fragment } from "react";
import { Table } from "antd";
import { Lock } from "lucide-react";
import { FIELD_TYPES } from "@shared/model/types";
import { WIDGET_LABELS, builtinFieldType, type FieldTypeGroup } from "@shared/forms/fieldtypes";
import { faDigits } from "@shared/format";
import { Chip, Loader } from "../../../../components/display";
import type { TypesResult } from "./api";
import { I14 } from "./parts";

export interface TypeRow {
  key: string;
  /** an organisation's type: its id */
  id: string | null;
  label: string;
  base: string | null;
  group: FieldTypeGroup;
  storage: string;
  widget: string;
  fields: number;
  status: string;
  available: boolean;
}

/** Rows of the tab: by group, the built-in types first, then the organisation's types of that group. */
export function typeRows(t: TypesResult): TypeRow[] {
  const out: TypeRow[] = [];
  for (const g of Object.keys(t.groups) as FieldTypeGroup[]) {
    for (const b of t.builtin.filter((x) => x.group === g))
      out.push({ key: b.key, id: null, label: b.label, base: null, group: g, storage: b.storage, widget: b.widget, fields: b.fields, status: "active", available: b.available });
    for (const o of t.types.filter((x) => builtinFieldType(x.base)?.group === g))
      out.push({ key: o.key, id: o.id, label: o.name, base: o.base_label, group: g, storage: o.storage ?? "", widget: o.widget ?? "", fields: o.fields, status: o.status, available: true });
  }
  return out;
}

export function Types({ types, loading, onOpenBuiltin, onOpenType }: { types: TypesResult | undefined; loading: boolean; onOpenBuiltin: (key: string) => void; onOpenType: (id: string) => void }) {
  if (loading && !types) return <Loader />;
  if (!types) return null;
  const rows = typeRows(types);
  const open = (r: TypeRow) => (r.id ? onOpenType(r.id) : onOpenBuiltin(r.key));
  return (
    <div className="wff-tab">
      <Table<TypeRow>
        size="small"
        className="ds-table"
        rowKey="key"
        dataSource={rows}
        pagination={false}
        scroll={{ x: 680 }}
        onRow={(r) => ({ onClick: () => open(r), onKeyDown: (e) => e.key === "Enter" && open(r), tabIndex: 0, className: "cursor-pointer" })}
        columns={[
          {
            key: "label",
            title: "نوع",
            render: (_: unknown, r) => (
              <span className="wff-cell-2">
                <span className="text-ink">{r.label}</span>
                {r.base ? <span className="rk-hint">بر پایهٔ {r.base}</span> : null}
              </span>
            ),
          },
          { key: "group", title: "گروه", render: (_: unknown, r) => types.groups[r.group] },
          { key: "storage", title: "نوع ذخیره", render: (_: unknown, r) => FIELD_TYPES[r.storage as keyof typeof FIELD_TYPES]?.label ?? r.storage },
          { key: "widget", title: "نمایش", render: (_: unknown, r) => WIDGET_LABELS[r.widget as keyof typeof WIDGET_LABELS] ?? "—" },
          { key: "fields", title: "فیلدها", align: "end", render: (_: unknown, r) => <span className="ds-num">{faDigits(r.fields)}</span> },
          {
            key: "chip",
            title: "",
            render: (_: unknown, r) => (
              <Fragment>
                {r.id ? (
                  r.status === "retired" ? (
                    <Chip dot={false}>بازنشسته</Chip>
                  ) : (
                    <Chip tone="info" dot={false}>سازمان</Chip>
                  )
                ) : (
                  <Chip dot={false}>
                    <span className="inline-flex items-center gap-1">
                      <Lock {...I14} aria-hidden /> پیش‌فرض
                    </span>
                  </Chip>
                )}
                {!r.available ? <span className="rk-me">در دسترس نیست</span> : null}
              </Fragment>
            ),
          },
        ]}
      />
    </div>
  );
}
