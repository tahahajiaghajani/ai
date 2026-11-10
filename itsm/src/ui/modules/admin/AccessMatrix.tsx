// «ماتریس دسترسی»: who can see what — a member's or a role's grants on every table (read / create / write / delete
// scopes, approve, admin, hidden fields), the members who read one record and through what, and a plain-Persian
// explanation of why a member can or cannot see a table or a record (the AI skill when a model is connected, the
// rule-based text otherwise; both from the access checker's facts). Read-only: roles change in «نقش‌ها».
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Drawer, Input, Segmented, Select, Table } from "antd";
import { Download, MessageCircleQuestion, Search } from "lucide-react";
import { SCOPE_LABELS, type Scope } from "@shared/access";
import { useOrg } from "../../lib/org";
import { useAction } from "../../lib/hooks";
import { exportExcel } from "../../lib/excel";
import { PageHeader } from "../../components/layout";
import { Chip, EmptyState, Skeleton } from "../../components/display";
import { Card, ICON, Note } from "../../components/blocks";
import { useMembers, useRoles } from "../access/api";

interface MatrixRow {
  table: string;
  label: string;
  plural: string;
  area: string;
  area_label: string;
  module: string;
  read: Scope;
  create: boolean;
  write: Scope;
  delete: Scope;
  approve: boolean;
  admin: boolean;
  hidden: string[];
}

interface Matrix {
  rows: MatrixRow[];
  roles?: string[];
  legacy?: boolean;
  contains?: string[];
  user?: { id: string; name: string };
  role?: { key: string; name: string };
}

interface Explained {
  text: string;
  ai: boolean;
  model: string | null;
}

type Mode = "member" | "role" | "who";

const scopeTone = (s: Scope) => (s === "none" ? "neutral" : s === "all" ? "warning" : "in");
const ScopeChip = ({ s }: { s: Scope }) => <Chip tone={scopeTone(s)}>{SCOPE_LABELS[s]}</Chip>;
const Yes = ({ v }: { v: boolean }) => (v ? <Chip tone="in">بله</Chip> : <span className="text-ink-3">—</span>);

function Explain({ user, table, record, onClose }: { user: string | null; table: string | null; record?: string | null; onClose: () => void }) {
  const { api } = useOrg();
  const q = useQuery({
    queryKey: ["admin", "explain", user, table, record ?? null],
    queryFn: () => api.post<Explained>("/admin/access/explain", { user_id: user, table, record_id: record || null }),
    enabled: !!user && !!table,
    retry: false,
  });
  return (
    <Drawer open={!!user && !!table} onClose={onClose} title="چرا؟" width={480} destroyOnHidden>
      {q.isError ? (
        <Note tone="warning">{(q.error as Error).message}</Note>
      ) : !q.data ? (
        <Skeleton rows={4} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0 whitespace-pre-line leading-7 text-ink">{q.data.text}</p>
          <span className="text-[12px] text-ink-3">{q.data.ai ? `نوشتهٔ هوش مصنوعی از روی واقعیت‌های بررسی دسترسی${q.data.model ? ` (${q.data.model})` : ""}` : "متن قاعده‌محور از روی واقعیت‌های بررسی دسترسی"}</span>
        </div>
      )}
    </Drawer>
  );
}

function MatrixTable({ data, onExplain, title }: { data: Matrix; onExplain?: (table: string) => void; title: string }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => data.rows.filter((r) => !q || `${r.plural} ${r.label} ${r.area_label} ${r.table}`.includes(q.trim())), [data.rows, q]);
  const download = () =>
    exportExcel(
      `ماتریس دسترسی ${title}`,
      [
        { title: "جدول", value: (r: MatrixRow) => r.plural, width: 28 },
        { title: "حوزه", value: (r: MatrixRow) => r.area_label, width: 18 },
        { title: "مشاهده", value: (r: MatrixRow) => SCOPE_LABELS[r.read], width: 16 },
        { title: "ساخت", value: (r: MatrixRow) => (r.create ? "بله" : "خیر"), width: 8 },
        { title: "ویرایش", value: (r: MatrixRow) => SCOPE_LABELS[r.write], width: 16 },
        { title: "حذف", value: (r: MatrixRow) => SCOPE_LABELS[r.delete], width: 16 },
        { title: "تأیید", value: (r: MatrixRow) => (r.approve ? "بله" : "خیر"), width: 8 },
        { title: "مدیریت", value: (r: MatrixRow) => (r.admin ? "بله" : "خیر"), width: 8 },
        { title: "فیلدهای پنهان", value: (r: MatrixRow) => r.hidden.join("، "), width: 40 },
      ] as never,
      rows,
      "ماتریس",
    );
  return (
    <Card
      title={title}
      meta={
        data.legacy ? <Chip tone="warning">دسترسی پیشین (بدون نقش)</Chip> : data.roles?.length || data.contains?.length ? <span className="text-[12px] text-ink-3">{(data.roles ?? data.contains ?? []).join("، ")}</span> : null
      }
      tools={
        <span className="flex items-center gap-2">
          <Input allowClear size="small" prefix={<Search {...ICON} />} placeholder="جست‌وجوی جدول" value={q} onChange={(e) => setQ(e.target.value)} className="w-48" />
          <Button size="small" icon={<Download {...ICON} />} onClick={download}>
            اکسل
          </Button>
        </span>
      }
      flush
    >
      <Table
        size="small"
        rowKey="table"
        dataSource={rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: true }}
        columns={[
          { title: "جدول", dataIndex: "plural", render: (v: string, r) => <span title={r.table}>{v}</span>, fixed: "start" },
          { title: "حوزه", dataIndex: "area_label", render: (v: string) => <span className="text-ink-2">{v}</span> },
          { title: "مشاهده", dataIndex: "read", render: (v: Scope) => <ScopeChip s={v} /> },
          { title: "ساخت", dataIndex: "create", render: (v: boolean) => <Yes v={v} /> },
          { title: "ویرایش", dataIndex: "write", render: (v: Scope) => <ScopeChip s={v} /> },
          { title: "حذف", dataIndex: "delete", render: (v: Scope) => <ScopeChip s={v} /> },
          { title: "تأیید", dataIndex: "approve", render: (v: boolean) => <Yes v={v} /> },
          { title: "مدیریت", dataIndex: "admin", render: (v: boolean) => <Yes v={v} /> },
          { title: "فیلدهای پنهان", dataIndex: "hidden", render: (v: string[]) => (v.length ? <span className="text-[12px] text-ink-2">{v.slice(0, 4).join("، ")}{v.length > 4 ? "…" : ""}</span> : <span className="text-ink-3">—</span>) },
          ...(onExplain
            ? [{ key: "why", title: "", width: 64, render: (_: unknown, r: MatrixRow) => <Button size="small" type="text" icon={<MessageCircleQuestion {...ICON} />} aria-label={`چرا؟ ${r.plural}`} onClick={() => onExplain(r.table)} /> }]
            : []),
        ]}
      />
    </Card>
  );
}

function Who({ tables }: { tables: { value: string; label: string }[] }) {
  const { api } = useOrg();
  const [table, setTable] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [why, setWhy] = useState<string | null>(null);
  const who = useAction((v: { table: string; id: string }) => api.get<{ readers: { user_id: string; name: string; via: string | null; write: string | null }[]; others: number; truncated: boolean }>("/admin/access/who", v));
  const record = id.trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? "";
  return (
    <Card title="چه کسانی این رکورد را می‌بینند؟">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
        <Select showSearch optionFilterProp="label" value={table ?? undefined} onChange={setTable} options={tables} placeholder="جدول" aria-label="جدول" />
        <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="شناسه یا نشانی رکورد" className="ltr" dir="ltr" aria-label="رکورد" />
        <Button type="primary" disabled={!table || !record} loading={who.isPending} onClick={() => who.mutate({ table: table!, id: record })}>
          بررسی
        </Button>
      </div>
      {who.data ? (
        <div className="mt-3 flex flex-col gap-2">
          <Table
            size="small"
            rowKey="user_id"
            dataSource={who.data.readers}
            pagination={{ pageSize: 25, hideOnSinglePage: true }}
            columns={[
              { title: "عضو", dataIndex: "name" },
              { title: "از راه", dataIndex: "via", render: (v: string | null) => v ?? "—" },
              { title: "ویرایش", dataIndex: "write", render: (v: string | null) => v ?? <span className="text-ink-3">—</span> },
              { key: "why", title: "", width: 64, render: (_: unknown, r) => <Button size="small" type="text" icon={<MessageCircleQuestion {...ICON} />} aria-label={`چرا؟ ${r.name}`} onClick={() => setWhy(r.user_id)} /> },
            ]}
          />
          <span className="text-[13px] text-ink-3">
            {who.data.others ? `${who.data.others.toLocaleString("fa-IR")} عضو دیگر این رکورد را نمی‌بینند.` : "همهٔ اعضای فعال این رکورد را می‌بینند."}
            {who.data.truncated ? " فقط ۵۰۰ عضو نخست بررسی شد." : ""}
          </span>
        </div>
      ) : null}
      <Explain user={why} table={table} record={record} onClose={() => setWhy(null)} />
    </Card>
  );
}

export default function AccessMatrix() {
  const { api, orgId } = useOrg();
  const [mode, setMode] = useState<Mode>("member");
  const [user, setUser] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const members = useMembers();
  const roles = useRoles();
  const subject: Record<string, string> | null = mode === "member" ? (user ? { user } : null) : mode === "role" ? (role ? { role } : null) : null;
  const matrix = useQuery({ queryKey: ["admin", "matrix", subject], queryFn: () => api.get<Matrix>("/admin/access/matrix", subject!), enabled: !!subject, retry: false });
  const meta = useQuery({ queryKey: ["meta", "tables"], queryFn: () => api.get<{ tables: { key: string; plural: string; virtual?: boolean }[] }>("/meta/tables"), staleTime: 60_000, enabled: mode === "who" });
  const tables = (meta.data?.tables ?? []).filter((t) => !t.virtual).map((t) => ({ value: t.key, label: t.plural }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="ماتریس دسترسی" extra={<Link to={`/${orgId}/access/roles`}>نقش‌ها</Link>} />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "member", label: "بر پایهٔ عضو" },
            { value: "role", label: "بر پایهٔ نقش" },
            { value: "who", label: "بیننده‌های یک رکورد" },
          ]}
        />
        {mode === "member" ? (
          <Select
            showSearch
            optionFilterProp="label"
            value={user ?? undefined}
            onChange={setUser}
            placeholder="عضو"
            className="min-w-64"
            loading={members.isLoading}
            options={(members.data ?? []).filter((m) => m.is_active).map((m) => ({ value: m.id, label: m.name || m.email }))}
          />
        ) : mode === "role" ? (
          <Select showSearch optionFilterProp="label" value={role ?? undefined} onChange={setRole} placeholder="نقش" className="min-w-64" loading={roles.isLoading} options={(roles.data?.roles ?? []).map((r) => ({ value: r.key, label: r.name }))} />
        ) : null}
      </div>
      {mode === "who" ? (
        <Who tables={tables} />
      ) : !subject ? (
        <EmptyState icon={Search} title={mode === "member" ? "یک عضو انتخاب کنید" : "یک نقش انتخاب کنید"} />
      ) : matrix.isError ? (
        <Note tone="warning">{(matrix.error as Error).message}</Note>
      ) : !matrix.data ? (
        <Skeleton rows={8} />
      ) : (
        <MatrixTable data={matrix.data} title={matrix.data.user?.name ?? matrix.data.role?.name ?? ""} onExplain={mode === "member" ? setWhy : undefined} />
      )}
      <Explain user={mode === "member" ? user : null} table={why} onClose={() => setWhy(null)} />
    </div>
  );
}
