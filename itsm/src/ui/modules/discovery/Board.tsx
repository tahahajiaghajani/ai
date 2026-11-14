// «وضعیت پایش» (design A §15, §9): the CIs and assets the person reads with the status their tools report, worst first
// — chips «قطع»، «بی‌پاسخ»، «هشدار»، «در نگهداری»، «خاموش»، «بی‌تماس بیش از ۱۴ روز»، «خودپردازها» with their counts,
// a search by name, host, asset tag or terminal id, and per row: the name, class or category, branch or place, the
// status as a word with its dot and colour, since when, the last contact (relative; Jalali in the tooltip) and how many
// sources report it. A row opens its record. CMDB readers also see what the tool said; a branch officer sees the word,
// the dot and the times of own-branch assets, never a tool's name (the server leaves it out). Refreshed every minute.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Button, Input, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Activity, RotateCw, Search } from "lucide-react";
import { STATUS_WORDS } from "@shared/discovery/types";
import { useOrg } from "../../lib/org";
import { useDebounced } from "../../lib/hooks";
import { PageHeader } from "../../components/layout";
import { EmptyState, Skeleton } from "../../components/display";
import { DataTable } from "../../components/data";
import { ToggleChip } from "../../components/inputs";
import { ChoiceTag } from "../../records/fields/display";
import { useSchema } from "../../records/data/hooks";
import { BOARD_PAGE, useBoard, useNames } from "./api";
import { BOARD_CHIPS, boardPath, isBoardChip, labelOf, sourcesText, tabLabel, type BoardChip, type BoardRow } from "./model";
import { Refused } from "./Console";
import { Ago, I16 } from "./parts";

export default function Board() {
  const { orgId, timezone, allows } = useOrg();
  const nav = useNavigate();
  const { schema } = useSchema();
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("chip");
  const chip: BoardChip | undefined = isBoardChip(raw) ? raw : undefined;
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 300);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [chip, q]);
  const res = useBoard({ chip, q, page });
  const rows = useMemo(() => res.data?.rows ?? [], [res.data]);
  // CMDB readers open the CI and read what the tool said; everyone else (a branch officer) the asset
  const cmdb = allows({ area: "cmdb" });
  const places = useNames("location", rows.map((r) => r.location_id));
  const branches = useNames("org_unit", rows.map((r) => r.branch_id));
  const counts = res.data?.counts ?? {};
  const open = (r: BoardRow) => {
    const p = boardPath(r, cmdb);
    if (p) nav(`/${orgId}/${p}`);
  };

  const columns: ColumnsType<BoardRow> = [
    {
      title: "نام",
      key: "name",
      render: (_, r) => (
        <div className="dsc-cell">
          {/* rk-open: the crawler opens a list's first record by it (scripts/ui-crawl.mjs) */}
          <a className="rk-open dsc-strong" href={boardPath(r, cmdb) ? `/${orgId}/${boardPath(r, cmdb)}` : undefined} onClick={(e) => (e.preventDefault(), open(r))}>
            {r.name || "—"}
          </a>
          {cmdb && r.message ? <span className="dsc-sub dsc-clamp">{r.message}</span> : null}
        </div>
      ),
    },
    {
      title: "کلاس یا دسته",
      key: "class",
      render: (_, r) => (r.class ? labelOf(schema?.choices["ci.class"], r.class) : r.category ? labelOf(schema?.choices["asset_model.category"], r.category) : <span className="ds-zero">—</span>),
    },
    {
      title: "شعبه یا مکان",
      key: "place",
      render: (_, r) => {
        const branch = r.branch_id ? branches.get(r.branch_id) : undefined;
        const place = r.location_id ? places.get(r.location_id) : undefined;
        return branch || place ? <span>{[branch, place].filter(Boolean).join(" · ")}</span> : <span className="ds-zero">—</span>;
      },
    },
    {
      title: "وضعیت",
      key: "status",
      render: (_, r) => <ChoiceTag option={STATUS_WORDS.find((o) => o.value === r.status)} value={r.status_label} />,
    },
    { title: "از", key: "since", render: (_, r) => <Ago at={r.since} tz={timezone} /> },
    { title: "آخرین تماس", key: "contact", render: (_, r) => <Ago at={r.last_contact_at} tz={timezone} /> },
    { title: "منبع‌ها", key: "sources", render: (_, r) => <span className={r.sources ? "ds-num" : "ds-zero"}>{sourcesText(r.sources)}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="وضعیت پایش" />
      {res.error ? (
        <Refused error={res.error} retry={() => void res.refetch()} />
      ) : (
        <>
          <div className="dsc-bar" role="search">
            <Input
              allowClear
              prefix={<Search {...I16} aria-hidden />}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="جست‌وجوی نام، میزبان یا برچسب"
              aria-label="جست‌وجوی نام، میزبان یا برچسب"
              className="dsc-search"
            />
            <div className="dsc-chips" role="group" aria-label="پالایش وضعیت">
              {BOARD_CHIPS.map((c) => (
                <ToggleChip key={c.key} on={chip === c.key} onChange={(on) => setSp((x) => (on ? x.set("chip", c.key) : x.delete("chip"), x), { replace: true })}>
                  {tabLabel(c.label, counts[c.key])}
                </ToggleChip>
              ))}
            </div>
            <Tooltip title="بازخوانی">
              <Button type="text" icon={<RotateCw {...I16} className={res.isFetching && res.data ? "ds-spin" : undefined} />} onClick={() => void res.refetch()} aria-label="بازخوانی" />
            </Tooltip>
          </div>
          {!res.data ? (
            <Skeleton rows={6} />
          ) : (
            <DataTable<BoardRow>
              rowKey={(r) => `${r.target_table}:${r.target_id}`}
              dataSource={rows}
              columns={columns}
              onRow={(r) => ({ onClick: (e) => (e.target as HTMLElement).closest("a, button") || open(r), className: "dsc-row-link" })}
              pagination={{ current: page, pageSize: BOARD_PAGE, total: res.data.total, onChange: setPage, showSizeChanger: false, hideOnSinglePage: true, size: "small" }}
              locale={{
                emptyText:
                  q || chip ? (
                    <EmptyState compact title="چیزی پیدا نشد" description="عبارت جست‌وجو یا پالایه را تغییر دهید." />
                  ) : (
                    <EmptyState icon={Activity} title="هنوز ابزاری وضعیتی گزارش نکرده است" />
                  ),
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
