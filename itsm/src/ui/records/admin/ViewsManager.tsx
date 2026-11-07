// «نماهای ذخیره‌شده»: every saved list view the person may see — their own (rename, share, make default, delete:
// inline or in bulk) and those others shared — as a list of the `view` table, filtered by `?table=`. A view opens
// its list from its own page («نمایش فهرست»).
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import type { Cond } from "@shared/model/conditions";
import { RecordList } from "../list/RecordList";
import type { ListPreset } from "../extensions";

export default function ViewsManager() {
  const [params] = useSearchParams();
  const table = params.get("table");
  const preset = useMemo<ListPreset>(
    () => ({
      columns: ["name", "table_key", "kind", "shared", "is_default", "owner_id"],
      sort: "table_key,name",
      filter: table ? ({ f: "table_key", op: "eq", v: table } satisfies Cond) : null,
      modes: ["list"],
      emptyText: "هنوز نمایی ذخیره نشده است",
    }),
    [table],
  );
  return <RecordList table="view" title="نماهای ذخیره‌شده" preset={preset} />;
}
