// Bulk actions on the selected records (or on every record the filter matches, up to the engine's 500): set a field,
// assign, take a transition (asking for the fields it requires), watch, delete — each confirmed, each answered with
// what was done and what was refused per record (the engine checks every record on its own).
import { useEffect, useMemo, useState } from "react";
import { Button, Dropdown, Modal, Select, Tooltip } from "antd";
import { X, UserCheck, ArrowLeftRight, PenLine, Trash2, Ellipsis } from "lucide-react";
import type { Cond } from "@shared/model/conditions";
import type { FieldDef } from "@shared/model/types";
import { faDigits } from "@shared/format";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { recordsApi, allIds } from "../data/api";
import { useMe, useRecordActions } from "../data/hooks";
import { fieldOf, isInlineEditable, stateOf, type Schema } from "../model/schema";
import { isEmptyValue } from "../model/schema";
import type { ListQuery, TableMeta } from "../model/types";
import type { BulkAction } from "../extensions";
import { FieldInput } from "../fields/FieldInput";

const I16 = { size: 16, strokeWidth: 1.4, absoluteStrokeWidth: true } as const;
const BULK_MAX = 500;

export interface BulkBarProps {
  def: TableMeta;
  schema: Schema;
  /** selected ids on the page */
  ids: string[];
  /** «همهٔ نتیجه‌ها»: act on the filter instead of the ids */
  all: boolean;
  total: number | null;
  /** the page is fully selected and more records match */
  canSelectAll: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  /** the list's query (for watching every matching record) */
  query: ListQuery;
  filter: Cond | null;
  extra?: BulkAction[];
}

type Failure = { id: string; message: string };

export function BulkBar({ def, schema, ids, all, total, canSelectAll, onSelectAll, onClear, query, filter, extra = [] }: BulkBarProps) {
  const { api } = useOrg();
  const n = useNotify();
  const { tz } = useMe();
  const actions = useRecordActions(def.key);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<null | "field" | "assign" | { to: string; label: string; requires: string[] }>(null);
  const [failures, setFailures] = useState<Failure[] | null>(null);
  const count = all ? Math.min(total ?? BULK_MAX, BULK_MAX) : ids.length;
  const target = all ? { filter: filter ?? { and: [] } } : { ids };
  const countText = `${faDigits(count)} مورد`;

  const run = async (what: string, body: Parameters<typeof actions.bulk>[0]) => {
    setBusy(true);
    try {
      const r = await actions.bulk({ ...target, ...body });
      if (r.failed.length) {
        n.warn(`${faDigits(r.updated)} مورد ${what}؛ ${faDigits(r.failed.length)} مورد انجام نشد`, { action: { label: "جزئیات", onClick: () => setFailures(r.failed) } });
      } else n.ok(`${faDigits(r.updated)} مورد ${what}`);
      onClear();
      setModal(null);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };

  const transitions = useMemo(() => {
    const sm = def.states;
    if (!sm) return [];
    const out = new Map<string, { to: string; label: string; requires: Set<string> }>();
    for (const t of sm.transitions) {
      const cur = out.get(t.to) ?? { to: t.to, label: stateOf(def, t.to)?.label ?? t.label, requires: new Set<string>() };
      for (const r of t.requires ?? []) cur.requires.add(r);
      out.set(t.to, cur);
    }
    return [...out.values()].map((t) => ({ ...t, requires: [...t.requires] }));
  }, [def]);

  const watchAll = async () => {
    setBusy(true);
    try {
      const list = all ? (await allIds(api, def.key, { ...query, page: 1 }, BULK_MAX)).map((r) => r.id) : ids;
      const failed: Failure[] = [];
      for (const id of list) {
        try {
          await recordsApi.watch(api, def.key, id);
        } catch (e) {
          failed.push({ id, message: (e as Error).message });
        }
      }
      if (failed.length) n.warn(`${faDigits(list.length - failed.length)} مورد پیگیری شد؛ ${faDigits(failed.length)} مورد انجام نشد`, { action: { label: "جزئیات", onClick: () => setFailures(failed) } });
      else n.ok(`${faDigits(list.length)} مورد به پیگیری‌های شما افزوده شد`);
      actions.refreshLists();
      onClear();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await n.confirm(`حذف ${countText}؟`, "رکوردهای حذف‌شده از فهرست‌ها بیرون می‌روند و تاریخچه‌شان می‌ماند.", true))) return;
    await run("حذف شد", { delete: true });
  };

  const hasAssign = !!fieldOf(def, "assigned_to");
  const more: { key: string; label: string; danger?: boolean }[] = [
    ...extra.map((x) => ({ key: `x:${x.key}`, label: x.label, danger: x.danger })),
    ...(def.features?.watchers ? [{ key: "watch", label: "پیگیری همه" }] : []),
  ];

  return (
    <div className="rk-bulk ds-enter" role="region" aria-label="کار گروهی روی انتخاب‌شده‌ها">
      <span className="rk-bulk-n" aria-live="polite">
        {all ? `همهٔ نتیجه‌ها (${countText})` : `${countText} انتخاب شد`}
      </span>
      {canSelectAll && !all && total ? (
        <button type="button" className="ds-link rk-bulk-all" onClick={onSelectAll}>
          انتخاب همهٔ {faDigits(Math.min(total, BULK_MAX))} مورد
        </button>
      ) : null}
      <span className="rk-bulk-acts">
        {hasAssign ? (
          <Button size="small" icon={<UserCheck {...I16} />} disabled={busy} onClick={() => setModal("assign")}>
            واگذاری
          </Button>
        ) : null}
        {transitions.length ? (
          <Dropdown
            trigger={["click"]}
            rootClassName="ds-glass"
            menu={{
              items: transitions.map((t) => ({ key: t.to, label: t.label })),
              onClick: ({ key }) => {
                const t = transitions.find((x) => x.to === key)!;
                if (t.requires.length) setModal(t);
                else void run(`به «${t.label}» رفت`, { transition: t.to });
              },
            }}
          >
            <Button size="small" icon={<ArrowLeftRight {...I16} />} disabled={busy}>
              تغییر وضعیت
            </Button>
          </Dropdown>
        ) : null}
        <Button size="small" icon={<PenLine {...I16} />} disabled={busy} onClick={() => setModal("field")}>
          تغییر فیلد
        </Button>
        {more.length ? (
          <Dropdown
            trigger={["click"]}
            rootClassName="ds-glass"
            menu={{
              items: more,
              onClick: async ({ key }) => {
                if (key === "watch") return watchAll();
                const x = extra.find((e) => `x:${e.key}` === key);
                if (!x) return;
                setBusy(true);
                try {
                  const list = all ? (await allIds(api, def.key, { ...query, page: 1 }, BULK_MAX)).map((r) => r.id) : ids;
                  const msg = await x.run(list, api);
                  if (msg) n.ok(msg);
                  actions.refreshLists();
                  onClear();
                } catch (e) {
                  n.error(e);
                } finally {
                  setBusy(false);
                }
              },
            }}
          >
            <Button size="small" icon={<Ellipsis {...I16} />} disabled={busy} aria-label="کارهای دیگر" />
          </Dropdown>
        ) : null}
        <Button size="small" danger icon={<Trash2 {...I16} />} disabled={busy} onClick={remove}>
          حذف
        </Button>
      </span>
      <Tooltip title="لغو انتخاب (Esc)">
        <Button size="small" type="text" icon={<X {...I16} />} onClick={onClear} aria-label="لغو انتخاب" className="rk-bulk-x" />
      </Tooltip>

      {modal === "field" ? <SetFieldModal def={def} schema={schema} tz={tz} count={countText} busy={busy} onClose={() => setModal(null)} onApply={(data, label) => run(`به‌روز شد (${label})`, { data })} /> : null}
      {modal === "assign" ? <AssignModal def={def} schema={schema} tz={tz} count={countText} busy={busy} onClose={() => setModal(null)} onApply={(data) => run("واگذار شد", { data })} /> : null}
      {modal && typeof modal === "object" ? (
        <RequiresModal def={def} schema={schema} tz={tz} count={countText} busy={busy} t={modal} onClose={() => setModal(null)} onApply={(data) => run(`به «${modal.label}» رفت`, { transition: modal.to, data })} />
      ) : null}
      <Modal open={!!failures} title="موردهایی که انجام نشد" footer={null} onCancel={() => setFailures(null)} width={560} destroyOnHidden>
        <FailureList def={def} failures={failures ?? []} />
      </Modal>
    </div>
  );
}

function FailureList({ def, failures }: { def: TableMeta; failures: Failure[] }) {
  const { api } = useOrg();
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    const ids = failures.map((f) => f.id).slice(0, 200);
    if (!ids.length) return;
    let live = true;
    recordsApi
      .list(api, def.key, { ids, size: ids.length, fields: ["number", def.display], total: false })
      .then((r) => live && setLabels(Object.fromEntries(r.rows.map((x) => [x.id, String(x.number ?? x[def.display] ?? "")]))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [failures, api, def]);
  return (
    <ul className="rk-fail">
      {failures.map((f) => (
        <li key={f.id}>
          <bdi dir="ltr" className="rk-no">{labels[f.id] ?? f.id.slice(0, 8)}</bdi>
          <span className="text-danger">{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

interface ModalBase {
  def: TableMeta;
  schema: Schema;
  tz: string;
  count: string;
  busy: boolean;
  onClose: () => void;
}

function SetFieldModal({ def, schema, tz, count, busy, onClose, onApply }: ModalBase & { onApply: (data: Record<string, unknown>, label: string) => void }) {
  const fields = useMemo(() => def.fields.filter((f) => isInlineEditable(f) && !(def.states && f.name === def.states.field)), [def]);
  const [name, setName] = useState<string | undefined>(fields[0]?.name);
  const [value, setValue] = useState<unknown>(null);
  const f: FieldDef | undefined = name ? fieldOf(def, name) : undefined;
  return (
    <Modal open title={`تغییر فیلد ${count}`} onCancel={onClose} okText="اعمال" cancelText="انصراف" confirmLoading={busy} onOk={() => f && onApply({ [f.name]: value }, f.label)} width={480} destroyOnHidden>
      <div className="rk-stack">
        <label className="rk-lbl" htmlFor="rk-bulk-f">
          فیلد
        </label>
        <Select id="rk-bulk-f" value={name} onChange={(v) => (setName(v), setValue(null))} options={fields.map((x) => ({ value: x.name, label: x.label }))} showSearch={{ optionFilterProp: "label" }} />
        {f ? (
          <>
            <label className="rk-lbl" htmlFor="rk-bulk-v">
              مقدار تازه
            </label>
            <FieldInput id="rk-bulk-v" field={f} value={value} onChange={setValue} def={def} schema={schema} tz={tz} />
            {isEmptyValue(value) ? <p className="rk-hint">خالی بگذارید تا مقدار این فیلد پاک شود.</p> : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function AssignModal({ def, schema, tz, count, busy, onClose, onApply }: ModalBase & { onApply: (data: Record<string, unknown>) => void }) {
  const assignee = fieldOf(def, "assigned_to")!;
  const groupName = def.scope?.group ?? (fieldOf(def, "assignment_group_id") ? "assignment_group_id" : null);
  const group = groupName ? fieldOf(def, groupName) : undefined;
  const groupKnown = !!group && !!schema.def(group.ref ?? "group");
  const [data, setData] = useState<Record<string, unknown>>({});
  return (
    <Modal open title={`واگذاری ${count}`} onCancel={onClose} okText="واگذاری" cancelText="انصراف" confirmLoading={busy} okButtonProps={{ disabled: !Object.keys(data).length }} onOk={() => onApply(data)} width={480} destroyOnHidden>
      <div className="rk-stack">
        {group && groupKnown ? (
          <>
            <label className="rk-lbl">{group.label}</label>
            <FieldInput field={group} value={data[group.name] ?? null} onChange={(v) => setData({ ...data, [group.name]: v })} def={def} schema={schema} tz={tz} />
          </>
        ) : null}
        <label className="rk-lbl">{assignee.label}</label>
        <FieldInput field={assignee} value={data.assigned_to ?? null} onChange={(v) => setData({ ...data, assigned_to: v })} def={def} schema={schema} tz={tz} />
      </div>
    </Modal>
  );
}

function RequiresModal({ def, schema, tz, count, busy, t, onClose, onApply }: ModalBase & { t: { to: string; label: string; requires: string[] }; onApply: (data: Record<string, unknown>) => void }) {
  const [data, setData] = useState<Record<string, unknown>>({});
  const fields = t.requires.map((r) => fieldOf(def, r)).filter((f): f is FieldDef => !!f);
  const missing = fields.filter((f) => isEmptyValue(data[f.name]));
  return (
    <Modal open title={`«${t.label}» برای ${count}`} onCancel={onClose} okText={t.label} cancelText="انصراف" confirmLoading={busy} okButtonProps={{ disabled: missing.length > 0 }} onOk={() => onApply(data)} width={520} destroyOnHidden>
      <div className="rk-stack">
        <p className="rk-hint">این تغییر وضعیت این فیلدها را لازم دارد؛ برای همهٔ انتخاب‌شده‌ها ثبت می‌شوند.</p>
        {fields.map((f) => (
          <div key={f.name} className="rk-stack-s">
            <label className="rk-lbl" htmlFor={`rk-req-${f.name}`}>
              {f.label} <span className="rk-req" aria-hidden>*</span>
            </label>
            <FieldInput id={`rk-req-${f.name}`} field={f} value={data[f.name] ?? null} onChange={(v) => setData({ ...data, [f.name]: v })} def={def} schema={schema} row={data} tz={tz} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
