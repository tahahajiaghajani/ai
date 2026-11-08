// The CI picker of every module (catalogue CMDB-016): CIs the person may read by number or words of their name, with
// the class and a secondary line (host name, serial, user); a requester sees only the CIs they own or use. Restrict it
// to a class and its descendants with `cls`; `mine` for «دستگاه من». Incident, problem and change forms use it for
// their CI fields: index.tsx registers it with `registerRefPicker("ci")` for every reference field to a CI.
import { useEffect, useMemo, useRef, useState } from "react";
import { Select, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { recordsApi } from "../../records/data/api";
import { builtinClass } from "@shared/cmdb/classes";
import { cmdbApi, CMDB_KEYS, type CiPickerHit } from "./api";

export interface CiPickerProps {
  value?: string | string[] | null;
  onChange?: (v: string | string[] | null, hits: CiPickerHit[]) => void;
  multiple?: boolean;
  cls?: string;
  mine?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  allowClear?: boolean;
  autoFocus?: boolean;
  /** «retired» CIs too (history, baselines) */
  retired?: boolean;
  "aria-label"?: string;
}

function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export function CiPicker({ value, onChange, multiple, cls, mine, placeholder, disabled, className, style, allowClear = true, autoFocus, retired, ...rest }: CiPickerProps) {
  const { api, orgId } = useOrg();
  const [text, setText] = useState("");
  const q = useDebounced(text);
  const known = useRef(new Map<string, CiPickerHit>());
  const params = { q: q || undefined, class: cls, mine: mine || undefined, retired: retired || undefined, limit: 20 };
  const hits = useQuery({ queryKey: CMDB_KEYS.picker(orgId, params), queryFn: () => cmdbApi.picker(api, params), staleTime: 30_000 });
  for (const h of hits.data?.hits ?? []) known.current.set(h.id, h);
  const ids = useMemo(() => (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean), [value]);
  const missing = ids.filter((id) => !known.current.has(id));
  // labels of the current value when it is not among the hits
  const resolved = useQuery({
    queryKey: ["cmdb", orgId, "picker-ids", missing.join(",")],
    enabled: missing.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const r = await recordsApi.list(api, "ci", { ids: missing, fields: ["number", "name", "class", "state"], size: missing.length, total: false });
      return r.rows.map((x) => ({ id: String(x.id), number: (x.number as string) ?? null, name: String(x.name ?? ""), class: String(x.class ?? ""), class_label: builtinClass(String(x.class ?? ""))?.label ?? String(x.class ?? ""), state: (x.state as string) ?? null }) as CiPickerHit);
    },
  });
  for (const h of resolved.data ?? []) if (!known.current.has(h.id)) known.current.set(h.id, h);
  const options = useMemo(() => {
    const list = [...(hits.data?.hits ?? [])];
    for (const id of ids) if (!list.some((h) => h.id === id) && known.current.has(id)) list.unshift(known.current.get(id)!);
    return list.map((h) => ({
      value: h.id,
      label: (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate">{h.name}</span>
          <span className="shrink-0 text-[12px] text-ink-3">{h.secondary || h.class_label}</span>
        </span>
      ),
      title: `${h.name} — ${h.class_label}${h.number ? ` (${h.number})` : ""}`,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits.data, resolved.data, ids.join(",")]);
  const emit = (v: string | string[] | null | undefined) => {
    const list = (Array.isArray(v) ? v : v ? [v] : []).map((id) => known.current.get(id)).filter((h): h is CiPickerHit => !!h);
    onChange?.(v ?? null, list);
  };
  return (
    <Select
      showSearch={{ filterOption: false, onSearch: setText }}
      mode={multiple ? "multiple" : undefined}
      value={multiple ? ids : ids[0] ?? undefined}
      onChange={emit}
      options={options}
      placeholder={placeholder ?? "جست‌وجوی پیکربندی با نام یا شماره"}
      notFoundContent={hits.isFetching ? <Spin size="small" /> : text ? "پیکربندی‌ای پیدا نشد" : "نام یا شمارهٔ پیکربندی را بنویسید"}
      disabled={disabled}
      allowClear={allowClear}
      autoFocus={autoFocus}
      className={className}
      style={{ minWidth: 220, ...style }}
      maxTagCount="responsive"
      aria-label={rest["aria-label"] ?? "پیکربندی"}
      onBlur={() => setText("")}
    />
  );
}

export default CiPicker;
