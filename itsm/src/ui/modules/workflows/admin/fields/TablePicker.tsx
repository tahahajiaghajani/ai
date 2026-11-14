// The table picker of «فیلدهای جدول‌ها» kept in `?table=`, and the tables a tenant may customise (every engine table but
// the customisation tables themselves) — moved here from the records module's designers (design F §12.1, package F5).
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Select } from "antd";
import type { Schema } from "../../../../records/model/schema";
import type { TableMeta } from "../../../../records/model/types";

const NOT_CUSTOMISABLE = new Set(["custom_field", "choice", "view"]);

export function customisableTables(schema: Schema | undefined): TableMeta[] {
  if (!schema) return [];
  return [...schema.tables.values()].filter((t) => !t.virtual && !NOT_CUSTOMISABLE.has(t.key)).sort((a, b) => a.plural.localeCompare(b.plural, "fa"));
}

/** The designer's table in the URL (`?table=todo`), defaulting to the first customisable table. */
export function useTableParam(schema: Schema | undefined): [TableMeta | undefined, (key: string) => void] {
  const [params, setParams] = useSearchParams();
  const tables = useMemo(() => customisableTables(schema), [schema]);
  const key = params.get("table") ?? tables[0]?.key;
  const def = key ? tables.find((t) => t.key === key) : undefined;
  return [
    def,
    (k: string) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.set("table", k);
          return next;
        },
        { replace: true },
      ),
  ];
}

export function TablePicker({ schema, value, onChange }: { schema: Schema | undefined; value: string | undefined; onChange: (k: string) => void }) {
  const tables = customisableTables(schema);
  return (
    <Select
      value={value}
      onChange={onChange}
      options={tables.map((t) => ({ value: t.key, label: t.plural }))}
      showSearch={{ optionFilterProp: "label" }}
      aria-label="جدول"
      placeholder="جدول"
      popupMatchSelectWidth={false}
    />
  );
}
