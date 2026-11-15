// «فرم‌ها» (design F §8.2, D15; package F5): every form of the system in one list, grouped by module with the process
// forms last — each table's default form, the process forms, and the forms other modules keep (catalogue items and
// record producers, each portal's «گزارش مشکل», surveys, the change risk questionnaire), each opening its own editor.
// Kind chips (kept in `?kind=`) and a search narrow it. «فرم تازه» makes a process form and opens its designer.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, Input, Modal, Table, Tooltip } from "antd";
import { Plus, Search } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { faDigits } from "@shared/format";
import { tableDef } from "@shared/tables";
import { useOrg } from "../../../../lib/org";
import { useNotify } from "../../../../lib/hooks";
import { PageHeader } from "../../../../components/layout";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { Field } from "../../../../components/blocks";
import { ToggleChip } from "../../../../components/inputs";
import { fieldsAccess } from "../fields/model";
import { FORM_KEYS, formsApi, type FormEntry, type FormKind } from "./api";
import { KIND_SHORT, changeText, changedAt, filterForms, groupRows, kindOf, statusText, usedText, type ListRow } from "./model";
import { I14, I16 } from "./parts";
import "../../../../records/records.css";
import "./forms.css";

const tableLabel = (key: string) => tableDef(key)?.plural ?? key;

export default function FormsPage() {
  const org = useOrg();
  const { api, orgId } = org;
  const access = fieldsAccess(org);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: FORM_KEYS.list(orgId), queryFn: () => formsApi.list(api), enabled: access.designRead, staleTime: 30_000 });
  const kinds = (list.data?.kinds ?? []).filter((k) => k.available);
  const kind = kindOf(params, kinds.map((k) => k.key));
  const setKind = (k: FormKind | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (k) next.set("kind", k);
        else next.delete("kind");
        return next;
      },
      { replace: true },
    );

  if (!access.designRead) return <EmptyState title="به «فرم‌ها» دسترسی ندارید" description="دیدن و تغییر فرم‌ها با طراحان فرم و گردش‌کار و مدیران تنظیمات سازمان است." />;
  const forms = list.data?.forms ?? [];
  const shown = filterForms(forms, { kind, q }, tableLabel);
  const rows = groupRows(shown);
  const columns = 7;
  const group = (r: ListRow) => r.type === "group";
  // a group's row is one cell across the table
  const cell = (first: boolean) => (r: ListRow) => (group(r) ? { colSpan: first ? columns : 0 } : {});

  return (
    <div className="rk-admin wfm-page">
      <PageHeader
        title="فرم‌ها"
        subtitle={list.data ? `${faDigits(forms.length)} فرم` : undefined}
        actions={
          access.designWrite ? (
            <Button type="primary" icon={<Plus {...I16} />} onClick={() => setCreating(true)}>
              فرم تازه
            </Button>
          ) : null
        }
      />
      {list.isLoading ? (
        <Loader />
      ) : (
        <div className="wfm-list">
          <div className="wfm-bar" role="search">
            <Input allowClear prefix={<Search {...I14} aria-hidden />} placeholder="جست‌وجوی فرم یا جدول…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جست‌وجوی فرم‌ها" className="wfm-search" />
            <span className="wfm-chips" aria-label="نوع فرم">
              <ToggleChip on={!kind} onChange={() => setKind(null)}>
                همه
              </ToggleChip>
              {kinds.map((k) => (
                <ToggleChip key={k.key} on={kind === k.key} onChange={(on) => setKind(on ? k.key : null)}>
                  {k.label} {faDigits(k.count)}
                </ToggleChip>
              ))}
            </span>
          </div>
          <Table<ListRow>
            size="small"
            className="ds-table wfm-table"
            rowKey="key"
            dataSource={rows}
            pagination={false}
            scroll={{ x: 900 }}
            rowClassName={(r) => (r.type === "group" ? "wfm-group-row" : "")}
            locale={{ emptyText: <EmptyState compact title={forms.length ? "فرمی با این پالایه نیست" : "فرمی نیست"} /> }}
            columns={[
              {
                key: "name",
                title: "فرم",
                onCell: cell(true),
                render: (_: unknown, r) =>
                  r.type === "group" ? (
                    <span className="wfm-group">
                      {r.label}
                      <span className="wfm-group-n">{faDigits(r.count)}</span>
                    </span>
                  ) : (
                    <FormName e={r.entry} orgId={orgId} />
                  ),
              },
              { key: "table", title: "جدول", onCell: cell(false), render: (_: unknown, r) => (r.type === "form" ? <TableCell e={r.entry} /> : null) },
              { key: "kind", title: "نوع", onCell: cell(false), render: (_: unknown, r) => (r.type === "form" ? <span className="text-ink-2">{KIND_SHORT[r.entry.kind] ?? r.entry.kind}</span> : null) },
              { key: "fields", title: "فیلدها", align: "end" as const, onCell: cell(false), render: (_: unknown, r) => (r.type === "form" ? <span className="ds-num">{faDigits(r.entry.fields)}</span> : null) },
              {
                key: "changes",
                title: "تغییر نسبت به پیش‌فرض",
                onCell: cell(false),
                render: (_: unknown, r) => (r.type === "form" ? changeText(r.entry) || <span className="text-ink-3">—</span> : null),
              },
              {
                key: "used",
                title: "به کار رفته در",
                onCell: cell(false),
                render: (_: unknown, r) =>
                  r.type === "form" ? (
                    r.entry.used_in.length ? (
                      <Tooltip title={r.entry.used_in.length > 2 ? r.entry.used_in.join("، ") : undefined}>
                        <span>{usedText(r.entry.used_in)}</span>
                      </Tooltip>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )
                  ) : null,
              },
              { key: "at", title: "آخرین تغییر", onCell: cell(false), render: (_: unknown, r) => (r.type === "form" ? changedAt(r.entry.updated_at) || <span className="text-ink-3">—</span> : null) },
            ]}
          />
        </div>
      )}
      {creating ? <NewForm onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function FormName({ e, orgId }: { e: FormEntry; orgId: string }) {
  const status = statusText(e);
  return (
    <span className="wfm-name">
      <span className="wfm-name-l">
        <Link className="ds-link" to={`/${orgId}/${e.link}`}>
          {e.name}
        </Link>
        {status ? <Chip tone={e.kind === "process" && e.status !== "published" ? "neutral" : "in"}>{status}</Chip> : null}
      </span>
      {e.note ? <span className="rk-hint">{e.note}</span> : null}
    </span>
  );
}

/** The table a form fills: a system form's technical name (its name is the table's), another kind's table by name. */
function TableCell({ e }: { e: FormEntry }) {
  if (!e.table) return <span className="text-ink-3">—</span>;
  if (e.kind === "system")
    return (
      <bdi dir="ltr" className="ds-mono text-ink-2">
        {e.table}
      </bdi>
    );
  return <span>{tableLabel(e.table)}</span>;
}

/** «فرم تازه»: a process form, named here; its designer opens next. */
function NewForm({ onClose }: { onClose: () => void }) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await formsApi.create(api, { name: name.trim(), description: description.trim() || null });
      await qc.invalidateQueries({ queryKey: FORM_KEYS.all(orgId) });
      nav(`/${orgId}/settings/forms/${r.form.id}`);
    } catch (e) {
      n.error(e);
      setBusy(false);
    }
  };
  return (
    <Modal open title="فرم تازهٔ گردش‌کار" onCancel={onClose} okText="ساخت و طراحی" cancelText="انصراف" onOk={create} okButtonProps={{ disabled: !name.trim(), loading: busy }} width={480} destroyOnHidden>
      <div className="wfm-stack">
        <Field label="نام فرم" htmlFor="wfm-new-name">
          <Input id="wfm-new-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus onPressEnter={create} placeholder="مثلاً درخواست تنخواه" />
        </Field>
        <Field label="شرح" htmlFor="wfm-new-desc">
          <Input.TextArea id="wfm-new-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} />
        </Field>
      </div>
    </Modal>
  );
}
