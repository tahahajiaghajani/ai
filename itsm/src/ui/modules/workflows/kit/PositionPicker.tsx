// `PositionPicker` (design F §3.1, §3.4): choose an organisational role «نقش سازمانی». A «نقش سازمانی» field of a
// record or a form stores the position's id (`by="id"`, its widget `position`); an assignee rule names the position by
// its key (`by="key"`). Searchable by name or key; each option shows where the role is held («در شعبه‌ها») and its
// key (LTR). Inactive positions are not offered (a current value stays, marked); the demo pack's are marked «نمایشی»
// (the list's own mark, release 1.1.5). A server without positions shows a quiet disabled box.
import { useMemo, useState } from "react";
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import { UNIT_KINDS } from "@shared/tables/access";
import { useOrg } from "../../../lib/org";
import { useDebounced } from "../../../lib/hooks";
import { Loader } from "../../../components/display";
import { useSchema } from "../../../records/data/hooks";
import { kitApi, type PositionRow } from "./api";
import { DemoTag } from "./demo";

export interface PositionPickerProps {
  value: string | string[] | null | undefined;
  /** `picked`: the chosen positions themselves (their id, key and the kind of unit they are held in) */
  onChange: (v: string | string[] | null, picked?: PositionRow[]) => void;
  /** what the value holds: the position's id (a field) or its key (an assignee rule) */
  by?: "id" | "key";
  multiple?: boolean;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  id?: string;
  status?: "error" | "warning";
  size?: "small" | "middle";
  autoFocus?: boolean;
  /** the field's `refFilter`: only positions it allows are offered */
  filter?: Cond | null;
  /** the picked positions themselves (an assignee rule needs the id and the unit kind of its key) */
  onPick?: (rows: PositionRow[]) => void;
  "aria-label"?: string;
}

const kindLabel = (k: string | null) => (k ? (UNIT_KINDS.find((o) => o.value === k)?.label ?? k) : null);

/** «در شعبه‌ها» or «همه‌جا»: where a position is held. */
export const heldIn = (k: string | null): string => (k ? `در ${kindLabel(k)}‌ها` : "بدون نوع واحد");

const asList = (v: string | string[] | null | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);

export function PositionPicker({ value, onChange, by = "id", multiple, onPick, filter, placeholder, allowClear = true, ...rest }: PositionPickerProps) {
  const { api, orgId } = useOrg();
  const { schema } = useSchema();
  const ready = !!schema?.def("position");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const current = asList(value);
  const list = useQuery({ queryKey: ["wfk-positions", orgId, q, filter ?? null], queryFn: () => kitApi.positions(api, { q, filter }), enabled: ready, staleTime: 60_000 });
  const missing = current.filter((v) => !(list.data ?? []).some((p) => (by === "id" ? p.id === v : p.key === v)));
  const known = useQuery({
    queryKey: ["wfk-positions-of", orgId, by, missing],
    queryFn: () => kitApi.positions(api, by === "id" ? { ids: missing } : { keys: missing }),
    enabled: ready && missing.length > 0,
    staleTime: 300_000,
  });
  const rows = useMemo(() => {
    const all = new Map<string, PositionRow>();
    for (const p of [...(known.data ?? []), ...(list.data ?? [])]) all.set(p.id, p);
    return [...all.values()];
  }, [list.data, known.data]);
  const keyOf = (p: PositionRow) => (by === "id" ? p.id : p.key);
  const options = rows
    .filter((p) => p.active || current.includes(keyOf(p)))
    .map((p) => ({ value: keyOf(p), label: p.name, p }));
  for (const v of current) if (!options.some((o) => o.value === v)) options.unshift({ value: v, label: known.isFetching ? "…" : v, p: { id: v, key: v, name: v, unit_kind: null, active: true } });

  if (schema && !ready) return <Select {...rest} disabled placeholder="نقش‌های سازمانی هنوز در دسترس نیست" />;
  return (
    <Select
      {...rest}
      mode={multiple ? "multiple" : undefined}
      value={multiple ? current : (current[0] ?? undefined)}
      allowClear={allowClear}
      placeholder={placeholder ?? "نقش سازمانی…"}
      showSearch={{ filterOption: false, onSearch: setSearch }}
      maxTagCount="responsive"
      popupMatchSelectWidth={false}
      onOpenChange={(o) => !o && setSearch("")}
      notFoundContent={list.isFetching ? <div className="grid place-items-center py-3"><Loader /></div> : <div className="py-2 text-center text-ink-3">نقشی پیدا نشد</div>}
      onChange={(v) => {
        const picked = asList(v as string | string[] | undefined);
        const chosen = rows.filter((p) => picked.includes(keyOf(p)));
        onChange(multiple ? picked : (picked[0] ?? null), chosen);
        onPick?.(chosen);
      }}
      options={options}
      optionRender={(o) => {
        const p = (o.data as { p: PositionRow }).p;
        return (
          <span className="rk-opt">
            <span className="rk-opt-b">
              <span className="rk-opt-t">
                {p.name}
                {p.active ? null : <span className="rk-me">غیرفعال</span>}
                {p.demo ? <DemoTag title="نقش سازمانی دادهٔ نمایشی" /> : null}
              </span>
              <span className="rk-opt-s">
                {heldIn(p.unit_kind)} ·{" "}
                <bdi dir="ltr" className="ds-mono">
                  {p.key}
                </bdi>
              </span>
            </span>
          </span>
        );
      }}
    />
  );
}
