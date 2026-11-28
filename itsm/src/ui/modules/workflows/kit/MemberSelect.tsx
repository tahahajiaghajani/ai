// `MemberSelect` (release 1.1.5): a people picker of the workflow screens — members by name or e-mail, the current
// value always shown, the demo pack's people marked «نمایشی». Where they may not take the work (a real case's step:
// FINAL-1) they are left out; where one of them is what is wanted (a preview's sample requester while a pack is
// loaded) they are offered first under «حساب‌های نمایشی».
import { useMemo, useState } from "react";
import { Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../../lib/org";
import { useDebounced } from "../../../lib/hooks";
import { Loader } from "../../../components/display";
import { Avatar } from "../../../components/blocks";
import { useMe } from "../../../records/data/hooks";
import { kitApi } from "./api";
import { DemoTag, useDemoPeople } from "./demo";
import { memberOptions, type MemberOption } from "./model";

export interface MemberSelectProps {
  value: string | string[] | null | undefined;
  /** `picked`: the chosen people as offered (their names, and whether they are the demo pack's) */
  onChange: (v: string | string[] | null, picked?: MemberOption[]) => void;
  multiple?: boolean;
  /** the demo pack's people: «hide» leaves them out, «first» offers them first, «mark» only marks them (default) */
  demo?: "hide" | "first" | "mark";
  /** «من» first while nothing is searched */
  meFirst?: boolean;
  /** names already known for the current value */
  display?: Record<string, string>;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  status?: "error" | "warning";
  "aria-label"?: string;
}

/** An option of the select, or a group of them («حساب‌های نمایشی»، «اعضا»). */
type PickOption = { value: string; label: string; opt: MemberOption } | { label: string; options: PickOption[] };

const asList = (v: string | string[] | null | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean).map((x) => x.toLowerCase());

export function MemberSelect({ value, onChange, multiple, demo = "mark", meFirst, display, placeholder, allowClear = true, ...rest }: MemberSelectProps) {
  const { api, orgId } = useOrg();
  const { userId } = useMe();
  const pack = useDemoPeople();
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 250).trim();
  const ids = asList(value);
  const list = useQuery({ queryKey: ["wfk-members", orgId, q], queryFn: () => kitApi.members(api, { q, size: 50 }), staleTime: 30_000 });
  const packIds = demo === "first" && !q ? [...pack].sort().slice(0, 50) : [];
  const packRows = useQuery({ queryKey: ["wfk-members-ids", orgId, packIds], queryFn: () => kitApi.members(api, { ids: packIds }), enabled: packIds.length > 0, staleTime: 300_000 });
  const have = new Set([...(list.data ?? []), ...(packRows.data ?? [])].map((m) => m.id));
  const missing = ids.filter((id) => !display?.[id] && !have.has(id));
  const known = useQuery({ queryKey: ["wfk-members-ids", orgId, missing], queryFn: () => kitApi.members(api, { ids: missing }), enabled: missing.length > 0, staleTime: 300_000 });
  const groups = useMemo(
    () => memberOptions({ rows: list.data ?? [], pack: packRows.data, known: known.data, value: ids, display, demo: pack, mode: demo, me: userId, meFirst, searching: !!q }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list.data, packRows.data, known.data, ids.join(","), display, pack, demo, userId, meFirst, q],
  );
  const toOption = (o: MemberOption): PickOption => ({ value: o.value, label: o.me ? `${o.label} (من)` : o.label, opt: o });
  const options: PickOption[] = groups.length === 1 && groups[0].label === null ? groups[0].options.map(toOption) : groups.map((g) => ({ label: g.label ?? "", options: g.options.map(toOption) }));
  return (
    <Select
      {...rest}
      mode={multiple ? "multiple" : undefined}
      showSearch={{ filterOption: false, onSearch: setSearch }}
      value={multiple ? ids : (ids[0] ?? undefined)}
      placeholder={placeholder ?? "نام یا ایمیل…"}
      allowClear={allowClear}
      maxTagCount="responsive"
      popupMatchSelectWidth={false}
      notFoundContent={list.isFetching ? <div className="grid place-items-center py-3"><Loader /></div> : <div className="py-2 text-center text-ink-3">کسی پیدا نشد</div>}
      onOpenChange={(o) => !o && setSearch("")}
      onChange={(v) => {
        const chosen = new Set(asList(v as string | string[] | undefined));
        const picked = groups.flatMap((g) => g.options).filter((o) => chosen.has(o.value));
        if (multiple) onChange(Array.isArray(v) ? (v as string[]) : [], picked);
        else onChange((v as string | undefined) ?? null, picked);
      }}
      options={options}
      optionRender={(o) => {
        const opt = (o.data as { opt?: MemberOption }).opt;
        if (!opt) return o.label;
        return (
          <span className="rk-opt">
            <Avatar name={opt.label} />
            <span className="rk-opt-b">
              <span className="rk-opt-t">
                {opt.label}
                {opt.me ? <span className="rk-me">(من)</span> : null}
                {opt.inactive ? <span className="rk-me">غیرفعال</span> : null}
                {opt.demo ? <DemoTag /> : null}
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
  );
}
