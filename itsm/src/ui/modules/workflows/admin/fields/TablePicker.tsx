// The table picker of «فیلدهای جدول‌ها» kept in `?table=`, and the tables a tenant may customise — the tables whose
// default form «فرم‌ها» lists (`tailoredTable`: not the customisation rows, not a process case, whose fields belong to
// its process forms) — moved here from the records module's designers (design F §12.1, package F5).
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { Select } from "antd";
import { tailoredTable } from "@shared/tables/fields";
import type { Schema } from "../../../../records/model/schema";
import type { TableMeta } from "../../../../records/model/types";

export function customisableTables(schema: Pick<Schema, "tables"> | undefined): TableMeta[] {
  if (!schema) return [];
  return [...schema.tables.values()].filter(tailoredTable).sort((a, b) => a.plural.localeCompare(b.plural, "fa"));
}

/**
 * The designer's table in the URL (`?table=todo`), defaulting to the first customisable table — also for a table it
 * does not offer (an old link to a process case, or a table the person cannot read).
 */
export function useTableParam(schema: Schema | undefined): [TableMeta | undefined, (key: string) => void] {
  const [params, setParams] = useSearchParams();
  const tables = useMemo(() => customisableTables(schema), [schema]);
  const key = params.get("table");
  const def = (key ? tables.find((t) => t.key === key) : undefined) ?? tables[0];
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
