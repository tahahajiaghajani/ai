// Cheque register: received cheques (چک‌های دریافتی), issued cheques (چک‌های پرداختی) and the due
// dates view. Status chips with totals filter the list; overdue cheques are highlighted; every row
// offers the operations of its status; clicking a row opens the cheque's file.
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Dropdown, Input, Segmented, Space, Switch, Table, Tooltip } from "antd";
import type { TablePaginationConfig } from "antd/es/table";
import { FileExcelOutlined, HistoryOutlined, MoreOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useOrg } from "../../lib/org";
import { useDebounced, useNotify } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { DateInput, PartySelect } from "../../components/inputs";
import { EmptyState, JDate, Money, StatusTag } from "../../components/display";
import { faDigits } from "@shared/format";
import { formatJalali } from "@shared/jalali";
import { ACTION_LABEL, KIND_TITLE, STATUSES, chequeStatusMap, type ChequeAction, type Direction, type DocKind } from "./labels";
import { ChequeActionModal } from "./ChequeAction";
import { ChequeDrawer, DueBadge } from "./ChequeDrawer";
import { ChequesDue } from "./ChequesDue";

const OVERDUE_CSS = `.tz-cheque-overdue td { background: color-mix(in srgb, var(--tz-danger) 7%, transparent) !important; }`;

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
      <style>{OVERDUE_CSS}</style>
      <PageHeader
        title={title}
        extra={
          <Segmented
            value={view}
            onChange={(v) => nav(v === "received" ? `/${orgId}/treasury/cheques` : `/${orgId}/treasury/cheques/${v}`)}
            options={[
              { value: "received", label: "دریافتی" },
              { value: "issued", label: "پرداختی" },
              { value: "due", label: "سررسیدها" },
            ]}
          />
        }
        actions={
          can("treasury", "edit") && view !== "due" ? (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => nav(`/${orgId}/treasury/docs/new?kind=${view === "issued" ? "payment" : "receipt"}`)}
            >
              {view === "issued" ? "صدور چک (پرداخت)" : "دریافت چک"}
            </Button>
          ) : null
        }
      />
      {view === "due" ? <ChequesDue onOpen={open} /> : <ChequeList key={view} direction={view} onOpen={open} />}
      <ChequeDrawer id={openId} onClose={() => open(null)} />
    </div>
  );
}

function ChequeList({ direction, onOpen }: { direction: Direction; onOpen: (id: string) => void }) {
  const { api, orgId, can } = useOrg();
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

  const toggle = (s: string) => setStatus((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const exportAll = async () => {
    try {
      const all = await api.get("/treasury/cheques", { ...params, page: 1, size: 500, sort: sort.field, dir: sort.dir });
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
      ], all.rows);
    } catch (e) {
      n.error(e);
    }
  };

  return (
    <div className="tz-card p-3 md:p-4">
      <div className="no-print mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatus([])}
          className={`rounded-lg border px-3 py-1.5 text-start text-xs transition ${status.length ? "border-line" : "border-brand bg-brand-soft"}`}
        >
          <div className="text-muted">همه</div>
          <div className="mt-0.5 font-bold">
            {faDigits((data?.by_status ?? []).reduce((a: number, x: any) => a + x.count, 0))} چک
          </div>
        </button>
        {STATUSES[direction].map((s) => {
          const t = byStatus(s);
          const on = status.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={`rounded-lg border px-3 py-1.5 text-start text-xs transition ${on ? "border-brand bg-brand-soft" : "border-line hover:bg-surface-2"} ${t ? "" : "opacity-60"}`}
            >
              <div className="text-muted">{map[s][0]}</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <b>{faDigits(t?.count ?? 0)}</b>
                <span className="text-muted">·</span>
                <Money v={t?.sum ?? 0} />
              </div>
            </button>
          );
        })}
      </div>
      <div className="no-print mb-3 flex flex-wrap items-center gap-2">
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined className="text-muted" />}
            placeholder="سریال، صیادی، بانک، صاحب حساب یا شخص"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="!w-64"
          />
          <PartySelect value={partyId} onChange={setPartyId} allowClear placeholder="شخص" className="!w-52" />
          <DateInput value={from} onChange={setFrom} placeholder="سررسید از" allowClear className="!w-36" />
          <DateInput value={to} onChange={setTo} placeholder="سررسید تا" allowClear className="!w-36" />
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <Switch size="small" checked={overdue} onChange={setOverdue} /> فقط سررسیدگذشته‌ها
          </label>
        </Space>
        <div className="ms-auto flex gap-1">
          <Tooltip title="بازخوانی">
            <Button icon={<ReloadOutlined />} onClick={() => query.refetch()} loading={query.isFetching} />
          </Tooltip>
          <Tooltip title="خروجی اکسل">
            <Button icon={<FileExcelOutlined />} onClick={exportAll} />
          </Tooltip>
        </div>
      </div>
      <Table
        className="tz-table"
        size="small"
        rowKey="id"
        loading={query.isLoading}
        dataSource={data?.rows ?? []}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <EmptyState title={direction === "received" ? "چک دریافتی‌ای با این شرایط نیست" : "چک پرداختی‌ای با این شرایط نیست"} /> }}
        rowClassName={(r: any) => (r.overdue ? "tz-cheque-overdue" : "")}
        onRow={(r: any) => ({ onClick: () => onOpen(r.id), style: { cursor: "pointer" } })}
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
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}>جمع {faDigits(data.total)} چک</Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="left"><Money v={data.sum} /></Table.Summary.Cell>
              <Table.Summary.Cell index={2} colSpan={4} />
            </Table.Summary.Row>
          ) : null
        }
        columns={[
          {
            key: "due_date",
            dataIndex: "due_date",
            title: "سررسید",
            sorter: true,
            width: 150,
            render: (v, r: any) => (
              <span className="flex items-center gap-1.5">
                <span className={r.overdue ? "font-bold text-bad" : ""}><JDate v={v} /></span>
                <DueBadge c={r} />
              </span>
            ),
          },
          {
            key: "serial_no",
            dataIndex: "serial_no",
            title: "سریال / صیادی",
            sorter: true,
            render: (_, r: any) => (
              <div className="leading-5">
                <div className="num ltr">{faDigits(r.serial_no ?? "—")}</div>
                {r.sayad_no ? <div className="num ltr text-[11px] text-muted">{faDigits(r.sayad_no)}</div> : null}
              </div>
            ),
          },
          { key: "bank", title: "بانک", render: (_, r: any) => [r.bank_name, r.branch_name].filter(Boolean).join(" — ") || <span className="text-muted">—</span> },
          {
            key: "party_name",
            dataIndex: "party_name",
            title: direction === "received" ? "طرف حساب" : "در وجه",
            sorter: true,
            render: (v, r: any) => (
              <span>
                {v ?? "—"}
                {r.holder_name ? <span className="text-xs text-muted"> ← {r.holder_name}</span> : null}
              </span>
            ),
          },
          { key: "amount", dataIndex: "amount", title: "مبلغ", align: "left", sorter: true, render: (v) => <Money v={v} /> },
          { key: "status", dataIndex: "status", title: "وضعیت", sorter: true, render: (v) => <StatusTag s={v} map={map} /> },
          {
            key: "bank_account",
            dataIndex: "bank_account_name",
            title: direction === "received" ? "بانک وصول" : "حساب ما",
            render: (v) => v ?? <span className="text-muted">—</span>,
          },
          {
            key: "doc",
            title: "ثبت در",
            render: (_, r: any) =>
              r.doc_no ? (
                <Link to={`/${orgId}/treasury/docs/${r.source_id}`} onClick={(e) => e.stopPropagation()}>
                  {KIND_TITLE[r.doc_kind as DocKind] ?? "سند"} {faDigits(r.doc_no)}
                </Link>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
          {
            key: "_actions",
            width: 56,
            fixed: "left" as const,
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
                { key: "history", icon: <HistoryOutlined />, label: "پرونده و گردش چک", onClick: () => onOpen(r.id) },
              ];
              return (
                <span onClick={(e) => e.stopPropagation()}>
                  <Dropdown trigger={["click"]} menu={{ items }}>
                    <Button type="text" size="small" icon={<MoreOutlined />} aria-label="عملیات چک" />
                  </Dropdown>
                </span>
              );
            },
          },
        ]}
      />
      {act ? <ChequeActionModal cheque={act.row} action={act.action} onClose={() => setAct(null)} /> : null}
    </div>
  );
}
