// «بررسی دسترسی»: pick a member and a table — and optionally one of its records — to see what that member may do
// there and why: the grant their roles add up to, the fields hidden from them, and for a record every layer of the
// rule (organisation, domain, confidentiality, own, role scope, workspace, restricted group, manager) passed or not,
// checked again by the database itself. Only those who administer access use it, and only on records they can read.
import { useMemo, useState } from "react";
import { Button, Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { Check, X, Minus, SearchCheck, Database } from "lucide-react";
import { OP_LABELS, SCOPE_LABELS, SCOPED_OPS, FLAG_OPS, type RowExplanation } from "@shared/access";
import { FIELD_GROUPS } from "@shared/model/types";
import { useOrg } from "../../lib/org";
import { useAction, useDebounced } from "../../lib/hooks";
import { PageHeader, Section } from "../../components/layout";
import { Chip, EmptyState } from "../../components/display";
import { ICON, ICON14, Note, cx } from "../../components/blocks";
import { useAccessAdmin, useRoles, type AccessCheck } from "./api";
import { MemberSelect } from "./parts";

interface TableMetaLite {
  key: string;
  label: string;
  plural: string;
  display: string;
  virtual?: boolean;
  numbered?: { prefix: string };
}

const VIA: Record<NonNullable<RowExplanation["via"]>, string> = {
  system: "سامانه",
  public: "دادهٔ مرجع است و همهٔ اعضا آن را می‌بینند",
  own: "کاربر از افراد خود رکورد است (درخواست‌دهنده، کارشناس، پیگیری‌کننده یا جانشین)",
  participant: "کاربر در این رکورد مشارکت دارد",
  scope: "دامنهٔ دید نقش‌های کاربر این رکورد را در بر می‌گیرد",
  requester_side: "رکورد از آنِ افراد زیر نظر کاربر است",
};

export default function AccessChecker() {
  const { api } = useOrg();
  const { admin, loading } = useAccessAdmin();
  const roles = useRoles();
  const [user, setUser] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [record, setRecord] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const meta = useQuery({ queryKey: ["meta", "tables"], queryFn: () => api.get<{ tables: TableMetaLite[] }>("/meta/tables"), staleTime: 60_000 });
  const tables = (meta.data?.tables ?? []).filter((t) => !t.virtual);
  const def = tables.find((t) => t.key === table);
  const records = useQuery({
    queryKey: ["access", "check-records", table, q],
    queryFn: () => api.get<{ rows: Record<string, any>[] }>(`/r/${table}`, { q, size: "20", total: "false" }),
    enabled: !!table,
  });
  const check = useAction((v: { user_id: string; table: string; record_id: string | null }) => api.post<AccessCheck>("/access/check", v));
  const result = check.data;
  const roleName = (k: string) => roles.data?.roles.find((r) => r.key === k)?.name ?? k;
  const label = (r: Record<string, any>) => `${r.number ? `${r.number} — ` : ""}${def ? String(r[def.display] ?? "") : ""}`.trim() || r.id;
  const recordOptions = useMemo(() => (records.data?.rows ?? []).map((r) => ({ value: r.id as string, label: label(r) })), [records.data, def]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loading && !admin) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="بررسی دسترسی" />
        <EmptyState icon={SearchCheck} title="این ابزار با مدیران دسترسی است" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="بررسی دسترسی" />
      <section className="ds-card grid gap-3 p-4 md:grid-cols-[1fr_1fr_1.4fr_auto] md:items-end" aria-label="پرسش">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-ink-2">عضو</span>
          <MemberSelect value={user} onChange={setUser} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-ink-2">جدول</span>
          <Select
            value={table ?? undefined}
            onChange={(v) => {
              setTable(v);
              setRecord(null);
            }}
            loading={meta.isLoading}
            placeholder="انتخاب جدول…"
            showSearch={{ filterOption: (input, o) => String(o?.label ?? "").includes(input) }}
            options={tables.map((t) => ({ value: t.key, label: t.plural }))}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-ink-2">رکورد (اختیاری)</span>
          <Select
            value={record ?? undefined}
            onChange={(v) => setRecord(v ?? null)}
            disabled={!table}
            allowClear
            placeholder="شماره یا عنوان…"
            showSearch={{ filterOption: false, onSearch: setSearch }}
            loading={records.isFetching}
            options={recordOptions}
          />
        </label>
        <Button type="primary" icon={<SearchCheck {...ICON} />} disabled={!user || !table} loading={check.isPending} onClick={() => check.mutate({ user_id: user!, table: table!, record_id: record })}>
          بررسی
        </Button>
      </section>

      {result ? (
        <>
          <Section title={`${result.user.name} در «${result.table.plural}»`}>
            {result.legacy ? <Note tone="warning">این عضو نقشی ندارد و با دسترسی نقش عضویت خود کار می‌کند.</Note> : null}
            <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {SCOPED_OPS.map((op) => (
                <div key={op} className="flex flex-col gap-1 rounded-lg border border-line p-3">
                  <span className="text-[12px] text-ink-3">{OP_LABELS[op]}</span>
                  <span className={cx("text-[14px]", result.grant[op] === "none" ? "text-ink-3" : "text-ink")}>{SCOPE_LABELS[result.grant[op]]}</span>
                </div>
              ))}
              {FLAG_OPS.map((op) => (
                <div key={op} className="flex flex-col gap-1 rounded-lg border border-line p-3">
                  <span className="text-[12px] text-ink-3">{OP_LABELS[op]}</span>
                  <span className={cx("text-[14px]", result.grant[op] ? "text-ink" : "text-ink-3")}>{result.grant[op] ? "بله" : "خیر"}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-col gap-1.5 text-[13px]">
              <span>
                <span className="text-ink-3">نقش‌ها: </span>
                {result.roles.map(roleName).join("، ") || "—"}
              </span>
              <span>
                <span className="text-ink-3">فیلدهای پنهان: </span>
                {result.hidden_fields.length ? result.hidden_fields.map((f) => `${f.label} (${FIELD_GROUPS[f.group]})`).join("، ") : "هیچ"}
              </span>
            </div>
          </Section>
          {result.record ? <RecordVerdict r={result.record} /> : null}
        </>
      ) : null}
    </div>
  );
}

function RecordVerdict({ r }: { r: NonNullable<AccessCheck["record"]> }) {
  const e = r.explanation;
  return (
    <Section title={`«${r.label}»`}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={e.read ? "in" : "danger"}>{e.read ? "می‌بیند" : "نمی‌بیند"}</Chip>
        <Chip tone={e.write === "full" ? "in" : e.write === "requester" ? "warning" : "neutral"}>
          {e.write === "full" ? "تغییر می‌دهد" : e.write === "requester" ? "فقط فیلدهای درخواست‌دهنده را تغییر می‌دهد" : "تغییر نمی‌دهد"}
        </Chip>
        <Chip tone={e.delete ? "in" : "neutral"}>{e.delete ? "حذف می‌کند" : "حذف نمی‌کند"}</Chip>
        <span className={cx("ms-auto inline-flex items-center gap-1.5 text-[12px]", r.sql_read === e.read ? "text-ink-3" : "text-danger")}>
          <Database {...ICON14} aria-hidden />
          {r.sql_read === e.read ? "پایگاه داده همین نتیجه را می‌دهد" : "پایگاه داده نتیجهٔ دیگری می‌دهد"}
        </span>
      </div>
      {e.via ? <p className="mt-2 text-[13px] text-ink-2">چرا: {VIA[e.via]}.</p> : null}
      {r.writable_fields?.length ? <p className="mt-1 text-[13px] text-ink-3">فیلدهای قابل تغییر: {r.writable_fields.join("، ")}</p> : null}
      <ol className="mt-3 flex flex-col divide-y divide-[var(--ds-line)]">
        {e.layers.map((l) => (
          <li key={l.key} className="flex items-start gap-2 py-2">
            <span className={cx("mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-full", l.ok === true ? "bg-in-tint text-in" : l.ok === false ? "bg-danger-tint text-danger" : "bg-sunken text-ink-3")} aria-hidden>
              {l.ok === true ? <Check size={12} strokeWidth={2} /> : l.ok === false ? <X size={12} strokeWidth={2} /> : <Minus size={12} strokeWidth={2} />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[13px] text-ink">{l.label}</span>
              <span className="text-[12px] leading-5 text-ink-3">{l.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
