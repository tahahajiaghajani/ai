// RecordPage: one record of any table (`/:org/r/:table/:id`, `/new`, or a module's own path). The header (number,
// title, state, priority, people, SLA timers, viewers, transitions, «بیشتر»), the form — view mode with in-place
// edits, or «ویرایش» for all fields; sections and tabs from the layout; UI policies live; server errors on their
// fields; a stale version opens the merge dialog — the module's tabs and the related lists, the side panel and the
// activity stream. Keyboard: Alt+S saves, Esc cancels editing, Ctrl+Enter posts in the composer.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, Tabs } from "antd";
import { CircleAlert, SearchX, RotateCw } from "lucide-react";
import type { FieldDef } from "@shared/model/types";
import { FIELD_TYPES } from "@shared/model/types";
import { todayISO } from "@shared/jalali";
import { useOrg } from "../../lib/org";
import { useNotify } from "../../lib/hooks";
import { errorText } from "../../lib/api";
import { EmptyState } from "../../components/display";
import { Note } from "../../components/blocks";
import { PageHeader } from "../../components/layout";
import { useMe, useRecord, useRecordActions, useTableDef } from "../data/hooks";
import { extensionsFor, extensionsVersion, forParticipants, getPolicySource, recordPath, tablePath, type RecordContext, type RecordExtensions } from "../extensions";
import { formLayout } from "../model/layout";
import { formState, missingRequired, type UiPolicy } from "../model/policies";
import { recordLabel, displayText, fieldOf, isEmptyValue, type Schema } from "../model/schema";
import { changedValues } from "../model/values";
import { fieldErrorsOf, isConflict, type RecordResult, type RecordRow, type RecordTransition, type TableMeta } from "../model/types";
import { RecordHeader } from "./RecordHeader";
import { RecordForm } from "./RecordForm";
import { TransitionDialog, needsDialog } from "./TransitionDialog";
import { ConflictDialog } from "./ConflictDialog";
import { ActivityStream } from "./ActivityStream";
import { SidePanel } from "./SidePanel";
import { RecordList } from "../list/RecordList";
import "../records.css";

export interface RecordPageProps {
  table: string;
  /** a record id, or "new" */
  id: string;
  /** extensions on top of those the table registered */
  extensions?: RecordExtensions;
  /** where «بازگشت» goes (default: the table's list) */
  backTo?: string;
}

export function RecordPage({ table, id, extensions, backTo }: RecordPageProps) {
  const { def, schema, error, missing } = useTableDef(table);
  const { orgId } = useOrg();
  if (missing)
    return (
      <>
        <PageHeader title="پیدا نشد" back />
        <EmptyState icon={SearchX} title="این جدول در دسترس نیست" description={`جدول «${table}» وجود ندارد یا به آن دسترسی ندارید.`} />
      </>
    );
  if (error && !def) return <EmptyState icon={CircleAlert} title="بارگذاری انجام نشد" description={errorText(error)} />;
  if (!def || !schema) return <PageSkeleton />;
  const back = backTo ?? `/${orgId}/${tablePath(table)}`;
  return id === "new" ? <CreateRecord def={def} schema={schema} extensions={extensions} back={back} /> : <ViewRecord key={id} def={def} schema={schema} id={id} extensions={extensions} back={back} />;
}

function PageSkeleton() {
  return (
    <div className="rk-rp" aria-busy="true" aria-label="در حال بارگذاری">
      <div className="rk-skel-h">
        <i className="ds-skel" style={{ inlineSize: 260, blockSize: 24 }} />
      </div>
      <div className="rk-rp-grid">
        <div className="rk-rp-main rk-sec">
          {[70, 45, 85, 60, 75].map((w, i) => (
            <i key={i} className="ds-skel" style={{ inlineSize: `${w}%`, marginBlock: 10 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The extensions of the table merged with the page's own, and the organisation's stored UI policies. */
function useExtensions(table: string, extra?: RecordExtensions): { ext: RecordExtensions; policies: UiPolicy[] } {
  const { api, orgId } = useOrg();
  const version = extensionsVersion();
  const ext = useMemo(() => {
    const base = extensionsFor(table);
    if (!extra) return base;
    return {
      ...base,
      ...extra,
      policies: [...(base.policies ?? []), ...(extra.policies ?? [])],
      sidePanels: [...(base.sidePanels ?? []), ...(extra.sidePanels ?? [])],
      tabs: [...(base.tabs ?? []), ...(extra.tabs ?? [])],
      moreActions: [...(base.moreActions ?? []), ...(extra.moreActions ?? [])],
    } satisfies RecordExtensions;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, extra, version]);
  const source = getPolicySource();
  const stored = useQuery({ queryKey: ["records-policies", orgId, table], queryFn: () => source!(api, table), enabled: !!source, staleTime: 5 * 60_000 });
  const policies = useMemo(() => [...(ext.policies ?? []), ...(stored.data ?? [])], [ext.policies, stored.data]);
  return { ext, policies };
}

/** Values of a URL parameter for a field (a related list's «تازه» passes its parent; a calendar day its date). */
function paramValue(f: FieldDef, raw: string): unknown {
  if (FIELD_TYPES[f.type].array) return raw.split(",").map((x) => x.trim()).filter(Boolean);
  if (f.type === "bool") return raw === "true" || raw === "1";
  if (f.type === "int" || f.type === "rating" || f.type === "duration") return Number.isFinite(Number(raw)) ? Number(raw) : null;
  return raw;
}

/** What a new record starts with: static defaults, «من», today, URL parameters and the module's template. */
function initialValues(def: TableMeta, params: URLSearchParams, me: string | null, tz: string, ext: RecordExtensions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (f.system || f.base) continue;
    const d = f.default;
    if (d === "$me") out[f.name] = me;
    else if (d === "$today") out[f.name] = todayISO(tz);
    else if (d === "$now" || d === "$my_unit" || d === "$my_domain") continue;
    else if (d !== undefined) out[f.name] = d;
  }
  for (const [k, v] of params) {
    const f = fieldOf(def, k);
    if (f && !f.system && !f.base && !f.readonly) out[k] = paramValue(f, v);
  }
  return { ...out, ...(ext.defaults?.(params) ?? {}) };
}

function useHotkeys(on: boolean, save: () => void, cancel: () => void) {
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape" && !document.querySelector(".ant-modal-wrap, .ant-select-dropdown:not(.ant-select-dropdown-hidden), .ant-popover:not(.ant-popover-hidden)")) {
        cancel();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [on, save, cancel]);
}

/** «تغییرات ذخیره نشده‌اند» when leaving the page with a dirty form. */
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

// ---------------------------------------------------------------- new record

function CreateRecord({ def, schema, extensions, back }: { def: TableMeta; schema: Schema; extensions?: RecordExtensions; back: string }) {
  const { orgId } = useOrg();
  const nav = useNavigate();
  const n = useNotify();
  const [params] = useSearchParams();
  const { userId, env, tz } = useMe();
  const { ext, policies } = useExtensions(def.key, extensions);
  const actions = useRecordActions(def.key);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(def, params, userId, tz, ext));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const state = useMemo(() => formState(def, values, policies, { mode: "create", canWrite: def.can.create, env, lookup: schema.lookup }), [def, values, policies, env, schema]);
  const tabs = useMemo(() => formLayout(def, { mode: "create" }), [def]);
  useLeaveGuard(touched && !saving);

  const save = useCallback(async () => {
    const missing = missingRequired(def, values, state);
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((f) => [f.name, `«${f.label}» را وارد کنید`])));
      return;
    }
    const data: Record<string, unknown> = {};
    for (const f of def.fields) if (!state.readonly.has(f.name) && !state.hidden.has(f.name) && !isEmptyValue(values[f.name])) data[f.name] = values[f.name];
    setSaving(true);
    try {
      const r = await actions.create(data);
      n.ok(`${def.label} ${r.row.number ? `${r.row.number} ` : ""}ثبت شد`);
      setTouched(false);
      nav(`/${orgId}/${recordPath(def.key, r.row.id)}`, { replace: true });
    } catch (e) {
      const fe = fieldErrorsOf(e);
      if (Object.keys(fe).length) setErrors(fe);
      else n.error(e);
    } finally {
      setSaving(false);
    }
  }, [def, values, state, actions, n, nav, orgId]);
  const cancel = useCallback(() => nav(back), [nav, back]);
  useHotkeys(true, () => void save(), cancel);

  const onChange = (field: string, v: unknown) => {
    setTouched(true);
    setValues((x) => {
      const next = { ...x, [field]: v };
      // a parent choice changed: its dependent field's value may no longer fit
      for (const f of def.fields) if (f.dependsOn === field && x[field] !== v) next[f.name] = null;
      return next;
    });
    if (errors[field]) setErrors(({ [field]: _gone, ...rest }) => rest);
  };

  return (
    <div className="rk-rp">
      <RecordHeader
        def={def}
        schema={schema}
        row={null}
        display={{}}
        meta={null}
        mode="create"
        title={`${def.label} تازه`}
        saving={saving}
        dirty
        backTo={back}
        ctx={null}
        moreActions={[]}
        onEdit={() => undefined}
        onCancel={cancel}
        onSave={() => void save()}
        onTransition={() => undefined}
        onCopyLink={() => undefined}
        onWatch={() => undefined}
        onPrint={() => undefined}
        onDelete={() => undefined}
      />
      {state.messages.map((m) => (
        <Note key={m.key} tone={m.tone === "warning" ? "warning" : "neutral"}>
          {m.text}
        </Note>
      ))}
      <div className="rk-rp-grid is-single">
        <div className="rk-rp-main">
          <FormTabs tabs={tabs} render={(sections) => <RecordForm def={def} schema={schema} sections={sections} values={values} state={state} mode="edit" errors={errors} display={{}} me={userId} tz={tz} onChange={onChange} idPrefix="new" />} />
          <div className="rk-savebar">
            <Button onClick={cancel} disabled={saving}>
              انصراف
            </Button>
            <Button type="primary" onClick={() => void save()} loading={saving}>
              ثبت {def.label}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The form's tabs (one tab: no tab bar). */
function FormTabs({ tabs, render, extra = [] }: { tabs: ReturnType<typeof formLayout>; render: (sections: ReturnType<typeof formLayout>[number]["sections"]) => React.ReactNode; extra?: { key: string; label: string; children: React.ReactNode }[] }) {
  const items = [...tabs.map((t) => ({ key: t.key, label: t.label, children: render(t.sections) })), ...extra];
  if (items.length === 1) return <>{items[0].children}</>;
  return <Tabs className="rk-tabs" items={items} destroyOnHidden={false} />;
}

// ---------------------------------------------------------------- an existing record

function ViewRecord({ def, schema, id, extensions, back }: { def: TableMeta; schema: Schema; id: string; extensions?: RecordExtensions; back: string }) {
  const nav = useNavigate();
  const n = useNotify();
  const { userId, env, tz } = useMe();
  const { ext: allExt, policies } = useExtensions(def.key, extensions);
  const actions = useRecordActions(def.key);
  const rec = useRecord(def.key, id);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [base, setBase] = useState<RecordRow | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<RecordTransition | null>(null);
  const [conflict, setConflict] = useState<{ base: RecordRow; mine: Record<string, unknown> } | null>(null);

  const row = rec.data?.row ?? null;
  const meta = rec.data?.meta ?? null;
  const display = rec.data?.display ?? {};
  const values = useMemo(() => ({ ...(row ?? {}), ...draft }), [row, draft]);
  const state = useMemo(
    () => formState(def, values, policies, { mode: "update", canWrite: !!meta?.canWrite, locked: meta?.locked, readonly: meta?.readonly, env, lookup: schema.lookup }),
    [def, values, policies, meta, env, schema],
  );
  const tabs = useMemo(() => formLayout(def, { mode: "update" }), [def]);
  const dirty = Object.keys(draft).length > 0;
  useLeaveGuard(dirty);

  const refresh = useCallback(() => void rec.refetch(), [rec]);
  const startEdit = () => {
    setBase(row);
    setDraft({});
    setErrors({});
    setMode("edit");
  };
  const cancel = useCallback(() => {
    setDraft({});
    setErrors({});
    setBase(null);
    setMode("view");
  }, []);

  const save = useCallback(async () => {
    if (!row) return;
    const missing = missingRequired(def, values, state);
    if (missing.length) {
      setErrors(Object.fromEntries(missing.map((f) => [f.name, `«${f.label}» را وارد کنید`])));
      return;
    }
    const from = base ?? row;
    const data = changedValues(from, values, def.fields.filter((f) => !state.readonly.has(f.name)));
    if (!Object.keys(data).length) return cancel();
    setSaving(true);
    try {
      await actions.update(row.id, data, from.version);
      n.ok("تغییرات ذخیره شد");
      cancel();
    } catch (e) {
      const fe = fieldErrorsOf(e);
      if (isConflict(e)) setConflict({ base: from, mine: data });
      else if (Object.keys(fe).length) setErrors(fe);
      else n.error(e);
    } finally {
      setSaving(false);
    }
  }, [row, def, values, state, base, actions, n, cancel]);
  useHotkeys(mode === "edit", () => void save(), cancel);

  const saveField = useCallback(
    async (field: string, value: unknown): Promise<boolean> => {
      if (!row) return false;
      try {
        await actions.update(row.id, { [field]: value }, row.version);
        return true;
      } catch (e) {
        if (isConflict(e)) setConflict({ base: row, mine: { [field]: value } });
        else {
          const fe = fieldErrorsOf(e);
          n.error(fe[field] ? new Error(fe[field]) : e);
        }
        return false;
      }
    },
    [row, actions, n],
  );

  const takeTransition = useCallback(
    async (t: RecordTransition) => {
      if (!row) return;
      if (needsDialog(def, values, t.requires)) return setPending(t);
      try {
        await actions.transition(row.id, t.to, mode === "edit" ? changedValues(base ?? row, values, def.fields) : {}, (base ?? row).version);
        n.ok(`${t.label}: انجام شد`);
        cancel();
      } catch (e) {
        if (isConflict(e)) setConflict({ base: base ?? row, mine: draft });
        else n.error(e);
      }
    },
    [row, def, values, actions, mode, base, n, cancel, draft],
  );

  const ctx: RecordContext | null = useMemo(
    () =>
      row && meta
        ? {
            table: def.key,
            def,
            schema,
            row,
            display,
            meta,
            refresh,
            save: async (data) => {
              try {
                await actions.update(row.id, data, row.version);
                return true;
              } catch (e) {
                if (isConflict(e)) setConflict({ base: row, mine: data });
                else n.error(e);
                return false;
              }
            },
            transition: async (to) => {
              const t = meta.transitions.find((x) => x.to === to);
              if (!t) return false;
              await takeTransition(t);
              return true;
            },
          }
        : null,
    [row, meta, def, schema, display, refresh, actions, n, takeTransition],
  );

  if (rec.isError && !row) {
    const status = (rec.error as { status?: number }).status;
    return (
      <>
        <PageHeader title={status === 404 ? "رکورد پیدا نشد" : "بارگذاری انجام نشد"} back={back} />
        <EmptyState
          icon={status === 404 ? SearchX : CircleAlert}
          title={status === 404 ? "این رکورد پیدا نشد" : "بارگذاری انجام نشد"}
          description={status === 404 ? "شاید حذف شده باشد یا به آن دسترسی نداشته باشید." : errorText(rec.error)}
          action={status === 404 ? <Button onClick={() => nav(back)}>بازگشت به فهرست</Button> : <Button icon={<RotateCw size={16} strokeWidth={1.4} absoluteStrokeWidth />} onClick={refresh}>تلاش دوباره</Button>}
        />
      </>
    );
  }
  if (!row || !meta || !ctx) return <PageSkeleton />;

  // an approver without a role in the area reads the record and decides; the module's own widgets are not for them
  const participant = meta.reach === "participant";
  const ext = participant ? forParticipants(allExt) : allExt;
  const title = displayText(def, row) || recordLabel(def, row) || def.label;
  const newer = mode === "edit" && base && row.version > base.version;
  const related = (participant ? [] : def.form?.related ?? [])
    .filter((r) => !!schema.def(r.table) && !schema.def(r.table)!.can.participant)
    .map((r) => ({
      key: `rel:${r.table}:${r.field}`,
      label: r.label ?? schema.def(r.table)!.plural,
      children: <RecordList table={r.table} embedded baseFilter={{ f: r.field, op: "eq", v: row.id }} newDefaults={{ [r.field]: row.id }} preset={r.columns ? { columns: r.columns } : undefined} />,
    }));
  const moduleTabs = (ext.tabs ?? []).filter((t) => !t.when || t.when(ctx)).map((t) => ({ key: `x:${t.key}`, label: t.label, children: t.render(ctx) }));

  return (
    <div className="rk-rp">
      <RecordHeader
        def={def}
        schema={schema}
        row={row}
        display={display}
        meta={meta}
        mode={mode}
        title={title}
        saving={saving}
        dirty={dirty}
        backTo={back}
        ctx={ctx}
        moreActions={ext.moreActions ?? []}
        extraActions={ext.headerActions?.(ctx)}
        onEdit={startEdit}
        onCancel={cancel}
        onSave={() => void save()}
        onTransition={(t) => void takeTransition(t)}
        onCopyLink={() => {
          void navigator.clipboard?.writeText(window.location.href).then(() => n.note("پیوند رونوشت شد."));
        }}
        onWatch={(on) => void actions.watch(row.id, on).catch((e) => n.error(e))}
        onPrint={() => window.print()}
        onDelete={async () => {
          if (!(await n.confirm(`حذف ${row.number ?? title}؟`, "رکورد از فهرست‌ها بیرون می‌رود؛ تاریخچه‌اش می‌ماند.", true))) return;
          try {
            await actions.remove(row.id, row.version);
            n.ok(`${row.number ?? title} حذف شد`);
            nav(back);
          } catch (e) {
            n.error(e);
          }
        }}
      />
      {newer ? (
        <Note tone="warning" action={<Button size="small" onClick={() => setConflict({ base: base!, mine: changedValues(base!, values, def.fields) })}>بررسی</Button>}>
          این رکورد را کس دیگری هم‌اکنون تغییر داد؛ هنگام ذخیره می‌توانید تغییرات را ادغام کنید.
        </Note>
      ) : null}
      {state.messages.map((m) => (
        <Note key={m.key} tone={m.tone === "warning" ? "warning" : "neutral"}>
          {m.text}
        </Note>
      ))}
      <div className="rk-rp-grid">
        <div className="rk-rp-main">
          <FormTabs
            tabs={tabs}
            extra={[...moduleTabs, ...related]}
            render={(sections) => (
              <RecordForm
                def={def}
                schema={schema}
                sections={sections}
                values={values}
                state={state}
                mode={mode}
                errors={errors}
                display={display}
                me={userId}
                tz={tz}
                onChange={(field, v) => {
                  setDraft((d) => {
                    const next = { ...d, [field]: v };
                    for (const f of def.fields) if (f.dependsOn === field && values[field] !== v) next[f.name] = null;
                    return next;
                  });
                  if (errors[field]) setErrors(({ [field]: _gone, ...rest }) => rest);
                }}
                onSaveField={meta.canWrite && !meta.locked ? saveField : undefined}
              />
            )}
          />
          {mode === "edit" ? (
            <div className="rk-savebar">
              <span className="rk-hint">Alt+S ذخیره، Esc انصراف</span>
              <Button onClick={cancel} disabled={saving}>
                انصراف
              </Button>
              <Button type="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>
                ذخیره
              </Button>
            </div>
          ) : null}
        </div>
        <SidePanel def={def} schema={schema} ctx={ctx} widgets={ext.sidePanels ?? []} />
        <div className="rk-rp-act">{def.features?.journal || def.features?.history !== false ? <ActivityStream def={def} schema={schema} ctx={ctx} ext={ext} createdAt={typeof row.created_at === "string" ? row.created_at : null} /> : null}</div>
      </div>
      {pending ? (
        <TransitionDialog
          def={def}
          schema={schema}
          row={{ ...values, id: row.id, version: (base ?? row).version } as RecordRow}
          display={display}
          transition={pending}
          onClose={() => setPending(null)}
          onDone={() => cancel()}
          onConflict={() => setConflict({ base: base ?? row, mine: draft })}
        />
      ) : null}
      {conflict ? (
        <ConflictDialog
          open
          def={def}
          schema={schema}
          base={conflict.base}
          mine={conflict.mine}
          onCancel={() => setConflict(null)}
          onReload={() => {
            setConflict(null);
            cancel();
            refresh();
          }}
          onMerged={(_r: RecordResult) => {
            setConflict(null);
            cancel();
          }}
        />
      ) : null}
    </div>
  );
}
