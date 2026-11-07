// Searchable pickers of records and members: type a number, a name or any word of the target table's search fields
// (GET /r/:table/query with `q`, Persian-normalised by the engine), one or many values, a secondary line under each
// option (a member's e-mail and title, a record's number and state), «من» first for members, the reference's
// `refFilter` applied, and a link to open the chosen record. A target the organisation does not have yet (a module
// still to come) is a quiet disabled box.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Select, Tooltip } from "antd";
import { ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import type { Option } from "@shared/model/types";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { Loader } from "../../components/display";
import { Avatar } from "../../components/blocks";
import { recordsApi } from "../data/api";
import { useMe, useSchema } from "../data/hooks";
import { displayOf, displayText, optionLabel, valuesOf } from "../model/schema";
import type { DisplayMap, RecordRow, TableMeta } from "../model/types";
import { recordPath } from "../extensions";

const I14 = { size: 14, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;

export interface RecordSelectProps {
  /** target table ("user" for members) */
  table: string;
  value: string | string[] | null | undefined;
  onChange: (v: string | string[] | null) => void;
  multiple?: boolean;
  /** the reference's refFilter (records the server would accept) */
  filter?: Cond | null;
  /** labels already known for the current value (a response's display map) */
  display?: DisplayMap;
  placeholder?: string;
  disabled?: boolean;
  status?: "error" | "warning";
  autoFocus?: boolean;
  id?: string;
  size?: "small" | "middle" | "large";
  allowClear?: boolean;
  /** members: «من» first */
  meFirst?: boolean;
  /** a link beside a chosen record to open it */
  openLink?: boolean;
  variant?: "outlined" | "borderless" | "filled";
  className?: string;
  "aria-label"?: string;
  onBlur?: () => void;
}

interface Opt {
  value: string;
  label: string;
  sub?: string;
  inactive?: boolean;
  me?: boolean;
}

function optOf(def: TableMeta, row: RecordRow, choices: Record<string, Option[]>, me: string | null): Opt {
  if (def.key === "user") {
    const sub = [row.email, row.title].filter(Boolean).map(String).join("، ");
    return { value: row.id, label: String(row.name || row.email || "—"), sub, inactive: row.is_active === false, me: row.id === me };
  }
  const text = displayText(def, row);
  const state = def.states ? optionLabel(def.fields.find((f) => f.name === def.states!.field)!, choices, row[def.states.field]) : "";
  return { value: row.id, label: text || String(row.number ?? "—"), sub: [row.number, state].filter(Boolean).map(String).join("، ") || undefined };
}

export function RecordSelect({ table, value, onChange, multiple, filter, display, placeholder, meFirst, openLink, ...rest }: RecordSelectProps) {
  const { api, orgId } = useOrg();
  const { schema } = useSchema();
  const { userId, name: myName } = useMe();
  const def = schema?.def(table);
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250);
  const ids = valuesOf(value);
  const fields = useMemo(() => {
    if (!def) return [];
    if (def.key === "user") return ["name", "email", "title", "is_active"];
    return [def.display, ...(def.states ? [def.states.field] : [])];
  }, [def]);

  const list = useQuery({
    queryKey: ["records-pick", orgId, table, q, filter ?? null],
    queryFn: () => recordsApi.list(api, table, { q: q || undefined, filter: filter ?? undefined, size: 20, fields, total: false }),
    enabled: !!def,
    staleTime: 30_000,
  });
  // labels of the current value(s) not in the first page and not in `display`
  const missing = ids.filter((id) => !displayOf(display, id) && !(list.data?.rows ?? []).some((r) => r.id === id));
  const known = useQuery({
    queryKey: ["records-pick-ids", orgId, table, missing],
    queryFn: () => recordsApi.list(api, table, { ids: missing, size: missing.length, fields, total: false }),
    enabled: !!def && missing.length > 0,
    staleTime: 300_000,
  });

  const options = useMemo(() => {
    if (!def) return [] as Opt[];
    const choices = schema?.choices ?? {};
    const out: Opt[] = (list.data?.rows ?? []).map((r) => optOf(def, r, choices, userId));
    for (const r of known.data?.rows ?? []) if (!out.some((o) => o.value === r.id)) out.unshift(optOf(def, r, choices, userId));
    for (const id of ids) if (!out.some((o) => o.value === id)) out.unshift({ value: id, label: displayOf(display, id) ?? "…" });
    if (meFirst && def.key === "user" && userId && !q) {
      const i = out.findIndex((o) => o.value === userId);
      const mine = i >= 0 ? out.splice(i, 1)[0] : { value: userId, label: myName || "من" };
      out.unshift({ ...mine, me: true });
    }
    return out;
  }, [def, schema, list.data, known.data, ids, display, meFirst, userId, myName, q]);

  useEffect(() => {
    if (!rest.disabled) return;
    setSearch("");
  }, [rest.disabled]);

  if (schema && !def)
    return <Select {...rest} disabled mode={multiple ? "multiple" : undefined} value={ids.length ? ids : undefined} placeholder="هنوز در دسترس نیست" options={ids.map((id) => ({ value: id, label: displayOf(display, id) ?? id.slice(0, 8) }))} />;

  const isUser = def?.key === "user";
  const single = !multiple && ids.length === 1 ? ids[0] : null;
  const link = openLink && single && def && !isUser ? `/${orgId}/${recordPath(table, single)}` : null;

  return (
    <span className="rk-pick">
      <Select
        {...rest}
        mode={multiple ? "multiple" : undefined}
        showSearch={{ filterOption: false, onSearch: setSearch }}
        value={multiple ? ids : (ids[0] ?? undefined)}
        placeholder={placeholder ?? (isUser ? "نام یا ایمیل…" : "شماره یا عنوان…")}
        allowClear={rest.allowClear ?? true}
        maxTagCount="responsive"
        popupMatchSelectWidth={false}
        notFoundContent={list.isFetching ? <div className="grid place-items-center py-3"><Loader /></div> : <div className="py-2 text-center text-ink-3">موردی پیدا نشد</div>}
        onOpenChange={(o) => !o && setSearch("")}
        onChange={(v) => {
          if (multiple) onChange(Array.isArray(v) ? (v as string[]) : []);
          else onChange((v as string | undefined) ?? null);
        }}
        options={options.map((o) => ({ value: o.value, label: o.me ? `${o.label} (من)` : o.label, opt: o }))}
        optionRender={(o) => {
          const opt = (o.data as { opt: Opt }).opt;
          return (
            <span className="rk-opt">
              {isUser ? <Avatar name={opt.label} /> : null}
              <span className="rk-opt-b">
                <span className="rk-opt-t">
                  {opt.label}
                  {opt.me ? <span className="rk-me">(من)</span> : null}
                  {opt.inactive ? <span className="rk-me">غیرفعال</span> : null}
                </span>
                {opt.sub ? (
                  <bdi className="rk-opt-s" dir="auto">
                    {opt.sub}
                  </bdi>
                ) : null}
              </span>
            </span>
          );
        }}
      />
      {link ? (
        <Tooltip title="باز کردن">
          <Link to={link} className="rk-pick-open" aria-label="باز کردن رکورد">
            <ExternalLink {...I14} aria-hidden />
          </Link>
        </Tooltip>
      ) : null}
    </span>
  );
}

/** Members picker (`user` table) with «من» first. */
export const UserSelect = (p: Omit<RecordSelectProps, "table">) => <RecordSelect table="user" meFirst {...p} />;
