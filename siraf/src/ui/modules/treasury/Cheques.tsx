// Cheque register: received cheques (چک‌های دریافتی), issued cheques (چک‌های پرداختی) and the due dates view. The
// status tiles (count and sum) filter the list; overdue cheques carry a danger chip on their due date; every row
// offers the operations of its status; clicking a row opens the cheque's file in the side sheet.
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Dropdown, Input, Table, Tabs, Tooltip } from "antd";
import type { TablePaginationConfig } from "antd/es/table";
import { Download, Ellipsis, History, Plus, RotateCw, Search, TriangleAlert } from "lucide-react";
import { useOrg } from "../../lib/org";
import { useDebounced, useNotify } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { DateInput, PartySelect } from "../../components/inputs";
import { EmptyState, JDate, StatusTag } from "../../components/display";
import { ChequeIcon } from "../../components/shell/icons";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { ACTION_LABEL, KIND_TITLE, STATUSES, chequeStatusMap, type ChequeAction, type Direction, type DocKind } from "./labels";
import { ChequeActionModal } from "./ChequeAction";
import { ChequeDrawer, DueBadge } from "./ChequeDrawer";
import { ChequesDue } from "./ChequesDue";
import { Amt, ICON, ICON14, Who, cx, docNo } from "../reports/kit";

/** The tone of a status tile's nuqta: what needs attention is coloured, the rest is quiet. */
const TILE_TONE: Record<string, string | undefined> = { bounced: "danger", deposited: "warning", cleared: "in" };

export default function Cheques() {
  const { tab } = useParams();
  const view: Direction | "due" = tab === "issued" ? "issued" : tab === "due" ? "due" : "received";
  const [sp, setSp] = useSearchParams();
  const { orgId, can } = useOrg();
  const nav = useNavigate();
  const openId = sp.get("open");
  const open = (id: string | null) => {
    const next = new URLSearchParams(sp);
    if (id) next.set("open", id);
    else next.delete("open");
    setSp(next, { replace: true });
  };
  const title = view === "issued" ? "چک‌های پرداختی" : view === "due" ? "سررسید چک‌ها" : "چک‌های دریافتی";
  return (
    <div>
      <PageHeader
        title={title}
        actions={
          can("treasury", "edit") && view !== "due" ? (
            <Button type="primary" icon={<Plus {...ICON} />} onClick={() => nav(`/${orgId}/treasury/docs/new?kind=${view === "issued" ? "payment" : "receipt"}`)}>
              {view === "issued" ? "صدور چک" : "دریافت چک"}
            </Button>
          ) : null
        }
      />
      <Tabs
        className="no-print bk-tabs"
        activeKey={view}
        onChange={(v) => nav(v === "received" ? `/${orgId}/treasury/cheques` : `/${orgId}/treasury/cheques/${v}`)}
        items={[
          { key: "received", label: "دریافتی" },
          { key: "issued", label: "پرداختی" },
          { key: "due", label: "سررسیدها" },
        ]}
      />
      {view === "due" ? <ChequesDue onOpen={open} /> : <ChequeList key={view} direction={view} onOpen={open} activeId={openId} />}
      <ChequeDrawer id={openId} onClose={() => open(null)} />
    </div>
  );
}

function ChequeList({ direction, onOpen, activeId }: { direction: Direction; onOpen: (id: string) => void; activeId: string | null }) {
  const { api, orgId, can, unit } = useOrg();
  const n = useNotify();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [partyId, setPartyId] = useState<string | null>(null);
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [sort, setSort] = useState<{ field?: string; dir?: "asc" | "desc" }>({});
  const [act, setAct] = useState<{ row: any; action: ChequeAction } | null>(null);
  const [exporting, setExporting] = useState(false);
  const dq = useDebounced(q);
  const params = { direction, q: dq, status: status.join(","), from, to, party_id: partyId, overdue: overdue ? 1 : undefined };
  const query = useQuery({
    queryKey: ["treasury-cheques", params, page, size, sort],
    queryFn: () => api.get("/treasury/cheques", { ...params, page, size, sort: sort.field, dir: sort.dir }),
    placeholderData: keepPreviousData,
  });
  useEffect(() => setPage(1), [dq, status.join(","), from, to, partyId, overdue]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = query.data;
  const map = chequeStatusMap(direction);
  const byStatus = (s: string) => (data?.by_status ?? []).find((x: any) => x.status === s);
  const canEdit = can("treasury", "edit");
  const all = (data?.by_status ?? []).reduce((a: { n: number; sum: number }, x: any) => ({ n: a.n + x.count, sum: a.sum + Number(x.sum) }), { n: 0, sum: 0 });
  const filtered = !!(dq || from || to || partyId || overdue || status.length);

  const toggle = (s: string) => setStatus((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const exportAll = async () => {
    setExporting(true);
    try {
      const rows = await api.get("/treasury/cheques", { ...params, page: 1, size: 500, sort: sort.field, dir: sort.dir });
      await exportExcel(direction === "received" ? "چک‌های دریافتی" : "چک‌های پرداختی", [
        { title: "سررسید", value: (r: any) => formatJalali(r.due_date, { latin: true }) },
        { title: "سریال", value: (r: any) => r.serial_no },
        { title: "شناسه صیادی", value: (r: any) => r.sayad_no },
        { title: "بانک", value: (r: any) => [r.bank_name, r.branch_name].filter(Boolean).join(" — ") },
        { title: direction === "received" ? "طرف حساب" : "در وجه", value: (r: any) => r.party_name },
        { title: "مبلغ", value: (r: any) => r.amount, type: "number" },
        { title: "وضعیت", value: (r: any) => map[r.status]?.[0] ?? r.status },
        { title: "حساب بانکی", value: (r: any) => r.bank_account_name },
        { title: "سند", value: (r: any) => (r.doc_no ? `${KIND_TITLE[r.doc_kind as DocKind] ?? ""} ${r.doc_no}` : "") },
      ], rows.rows);
    } catch (e) {
      n.error(e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="bk-tiles no-print mb-4" role="group" aria-label="وضعیت چک‌ها">
        <button type="button" className="bk-tile" aria-pressed={!status.length} onClick={() => setStatus([])}>
          <small>همه</small>
          <b>{faDigits(all.n)} چک</b>
          <span><Amt v={all.sum} zero="—" /></span>
        </button>
        {STATUSES[direction].map((s) => {
          const t = byStatus(s);
          return (
            <button key={s} type="button" className={cx("bk-tile", !t?.count && "is-empty")} data-tone={TILE_TONE[s]} aria-pressed={status.includes(s)} onClick={() => toggle(s)}>
              <small>
                <i className="sf-nuqta" aria-hidden />
                {map[s][0]}
              </small>
              <b>{t?.count ? faDigits(t.count) : <span className="sf-zero">—</span>}</b>
              <span><Amt v={t?.sum ?? 0} zero="—" /></span>
            </button>
          );
        })}
      </div>

      <section className="sf-card">
        <div className="sf-st">
          <div className="sf-st-bar no-print">
            <div className="sf-st-filters">
              <Input allowClear prefix={<Search {...ICON} className="bk-3" />} placeholder="سریال، صیادی، بانک، صاحب حساب یا شخص" value={q} onChange={(e) => setQ(e.target.value)} className="!w-72" />
              <PartySelect value={partyId} onChange={setPartyId} allowClear placeholder="شخص" className="!w-52" />
              <span className="bk-range">
                <DateInput value={from} onChange={setFrom} placeholder="سررسید از" allowClear />
                <span>تا</span>
                <DateInput value={to} onChange={setTo} placeholder="سررسید تا" allowClear />
              </span>
              <button type="button" className="bk-tog" aria-pressed={overdue} onClick={() => setOverdue(!overdue)}>
                <TriangleAlert {...ICON} aria-hidden />
                سررسیدگذشته
              </button>
            </div>
            <div className="sf-st-tools">
              <Tooltip title="بازخوانی">
                <Button type="text" icon={<RotateCw {...ICON} className={query.isFetching && data ? "sf-spin" : undefined} />} onClick={() => query.refetch()} aria-label="بازخوانی" />
              </Tooltip>
              <Tooltip title="خروجی اکسل">
                <Button type="text" icon={<Download {...ICON} />} loading={exporting} onClick={exportAll} aria-label="خروجی اکسل" />
              </Tooltip>
            </div>
          </div>
          <Table
            className="bk-tbl"
            size="small"
            rowKey="id"
            loading={query.isLoading}
            dataSource={data?.rows ?? []}
            scroll={{ x: 1040 }}
            sticky={{ offsetHeader: 56 }}
            locale={{
              emptyText: query.isLoading ? (
                " "
              ) : (
                <EmptyState
                  icon={ChequeIcon}
                  title={filtered ? "چکی با این شرایط نیست" : direction === "received" ? "هنوز چکی دریافت نشده" : "هنوز چکی صادر نشده"}
                  description={filtered ? "پالایه‌ها یا جستجو را تغییر دهید." : "چک‌ها با دریافت و پرداخت ثبت می‌شوند و با سررسیدشان اینجا می‌آیند."}
                  action={filtered ? <Button onClick={() => { setQ(""); setFrom(null); setTo(null); setPartyId(null); setOverdue(false); setStatus([]); }}>پاک کردن پالایه‌ها</Button> : undefined}
                />
              ),
            }}
            rowClassName={(r: any) => cx("bk-click", r.id === activeId && "ant-table-row-selected")}
            onRow={(r: any) => ({
              onClick: () => onOpen(r.id),
              onKeyDown: (e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) onOpen(r.id);
              },
              tabIndex: 0,
            })}
            onChange={(p: TablePaginationConfig, _f, s) => {
              setPage(p.current ?? 1);
              setSize(p.pageSize ?? 50);
              const so = Array.isArray(s) ? s[0] : s;
              setSort(so?.order ? { field: String(so.columnKey ?? so.field), dir: so.order === "descend" ? "desc" : "asc" } : {});
            }}
            pagination={{
              current: page,
              pageSize: size,
              total: data?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100, 200],
              showTotal: (t) => `${faDigits(t)} چک`,
              size: "small",
              hideOnSinglePage: (data?.total ?? 0) <= 20,
            }}
            summary={() =>
              data && data.total ? (
                <Table.Summary fixed>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4} className="bk-sum-l">
                      جمع<small>{faDigits(data.total)} چک</small>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} className="sf-num"><Amt v={data.sum} /></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} colSpan={4} />
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null
            }
            columns={[
              {
                key: "due_date",
                dataIndex: "due_date",
                title: "سررسید",
                sorter: true,
                width: 204,
                render: (v, r: any) => (
                  <span className="inline-flex items-center gap-2">
                    <JDate v={v} />
                    <DueBadge c={r} />
                  </span>
                ),
              },
              {
                key: "serial_no",
                dataIndex: "serial_no",
                title: "سریال",
                sorter: true,
                width: 96,
                render: (v) => (v ? <span className="bk-docno">{docNo(v)}</span> : <span className="sf-zero">—</span>),
              },
              { key: "bank", title: "بانک", width: 150, ellipsis: true, render: (_, r: any) => <span className="bk-2">{[r.bank_name, r.branch_name].filter(Boolean).join("، ") || "—"}</span> },
              {
                key: "party_name",
                dataIndex: "party_name",
                title: direction === "received" ? "طرف حساب" : "در وجه",
                sorter: true,
                ellipsis: true,
                render: (v, r: any) => <Who name={v} sub={r.holder_name ? `← ${r.holder_name}` : undefined} />,
              },
              {
                key: "amount",
                dataIndex: "amount",
                title: `مبلغ (${unit})`,
                className: "sf-num",
                sorter: true,
                width: 156,
                render: (v, r: any) => <Amt v={v} className={r.status === "bounced" || r.status === "returned" || r.status === "cancelled" ? "sf-excluded" : undefined} />,
              },
              { key: "status", dataIndex: "status", title: "وضعیت", sorter: true, width: 128, render: (v) => <StatusTag s={v} map={map} /> },
              {
                key: "doc",
                title: "ثبت در",
                width: 112,
                render: (_, r: any) =>
                  r.doc_no ? (
                    <Link className="bk-lnk" to={`/${orgId}/treasury/docs/${r.source_id}`} onClick={(e) => e.stopPropagation()}>
                      {KIND_TITLE[r.doc_kind as DocKind] ?? "سند"} {docNo(r.doc_no)}
                    </Link>
                  ) : (
                    <span className="sf-zero">—</span>
                  ),
              },
              {
                key: "_actions",
                width: 48,
                render: (_, r: any) => {
                  const items = [
                    ...(canEdit
                      ? (r.actions as ChequeAction[]).map((a) => ({
                          key: a,
                          label: ACTION_LABEL[direction][a] ?? a,
                          danger: a === "bounce" || a === "undo",
                          onClick: () => setAct({ row: r, action: a }),
                        }))
                      : []),
                    ...(canEdit && (r.actions as ChequeAction[]).length ? [{ type: "divider" as const }] : []),
                    { key: "history", icon: <History {...ICON14} />, label: "پرونده و گردش چک", onClick: () => onOpen(r.id) },
                  ];
                  return (
                    <span className="bk-ra" onClick={(e) => e.stopPropagation()}>
                      <Dropdown trigger={["click"]} rootClassName="sf-glass" menu={{ items }}>
                        <Button type="text" size="small" icon={<Ellipsis {...ICON14} />} aria-label="عملیات چک" />
                      </Dropdown>
                    </span>
                  );
                },
              },
            ]}
          />
        </div>
      </section>
      {act ? <ChequeActionModal cheque={act.row} action={act.action} onClose={() => setAct(null)} /> : null}
    </>
  );
}
