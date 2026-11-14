// The lifecycle editor (design F §4.2–§4.4, §8.5; package F6): a table's states and transitions as its module defines
// them, with what an organisation may change — a state's label and colour (its value and category stay: module code,
// SLAs, reports and sync use them), a transition's label, the one «اصلی», the fields people must fill to take it, «فقط
// با نقش» (narrowing: one of these roles as well as the module's rule), a condition with its message (people's writes
// only), and «خاموش» where the module marks a transition optional and another way out remains. A lifecycle a module
// configures elsewhere (change requests: the change models) takes labels, colours and the primary transition only;
// tables shaped elsewhere too (catalogue items, journeys, security incidents, an active approval rule) say where, with
// a link. A preview draws the states as the record page does and the buttons a record in one state offers; «تفاوت با
// پیش‌فرض» lists what differs from the module. Changes are a draft with undo and redo; «ذخیرهٔ تغییرها» shows what
// changes and sends it (PUT /lifecycles/:table, `settings` full); «بازگشت به پیش‌فرض» drafts the module's lifecycle.
// The PUT replaces the whole overlay, so before the confirmation and again before the PUT the page reads the stored
// lifecycle: when another administrator saved since it was read, my changes go onto theirs and the confirmation says
// so and lists what saving now sends — their change is never written back unseen.
// `settings` view reads it; phones read it.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Alert, Button, Input, Modal, Radio, Select, Switch, Table, Tooltip } from "antd";
import { Lock, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Cond } from "@shared/model/conditions";
import { COLOR_KEYS, type ColorKey, type TableDef } from "@shared/model/types";
import { builtinRoles } from "@shared/access";
import { tableDef } from "@shared/tables";
import { normalizeFa } from "../../../../lib/fa";
import { useOrg } from "../../../../lib/org";
import { useIsPhone, useNotify } from "../../../../lib/hooks";
import { PageHeader, Section } from "../../../../components/layout";
import { Chip, EmptyState, Loader } from "../../../../components/display";
import { Note } from "../../../../components/blocks";
import { matchItem, useShellItems } from "../../../../components/shell/model";
import { ChoiceTag } from "../../../../records/fields/display";
import { FilterBuilder } from "../../../../records/filter/FilterBuilder";
import { COLOR_LABELS } from "../../../../records/model/colors";
import { useRefreshSchema, useSchema } from "../../../../records/data/hooks";
import { SaveStatus, useHistory, useLeaveGuard, useUndoKeys } from "../forms/parts";
import { F, I14, I16 } from "../fields/parts";
import { HUB_KEYS } from "../hub/api";
import { HUB_PATH } from "../hub/model";
import { LIFECYCLE_KEYS, lifecycleApi, type LifecycleState, type LifecycleTransition, type LifecycleView, type RoleOption } from "./api";
import {
  LIFECYCLE_REFUSAL, VISIBLE_BUTTONS, categoryLabel, channel, condText, defaultDraft, draftDiff, draftOf, draftProblems, isDefault, isDirty, lifecycleAccess, overlayOf,
  previewButtons, requirableFields, scopeChip, setPrimary, setState, setTransition, summaryText, transitionLabel, transitionPath, type DiffLine, type DiffNames,
  type LifecycleDraft,
} from "./model";
import "../../../../records/records.css";
import "../forms/forms.css";
import "./lifecycle.css";

export default function LifecycleEditor() {
  const { table = "" } = useParams<{ table: string }>();
  const org = useOrg();
  const { api, orgId } = org;
  const access = lifecycleAccess(org);
  const phone = useIsPhone();
  const q = useQuery({ queryKey: LIFECYCLE_KEYS.one(orgId, table), queryFn: () => lifecycleApi.get(api, table), enabled: access.read, retry: false, staleTime: 30_000 });
  const base = tableDef(table);

  if (!access.read) return <EmptyState title="به چرخهٔ عمر رکوردها دسترسی ندارید" description="دیدن چرخهٔ عمر جدول‌ها با کسانی است که تنظیمات سازمان را می‌بینند." />;
  if (q.isLoading) return <Loader />;
  if (q.isError || !q.data || !base?.states)
    return (
      <EmptyState
        title={`چرخهٔ عمر «${base?.plural ?? table}» خوانده نشد`}
        description={q.error instanceof Error ? q.error.message : "این جدول چرخهٔ وضعیت ندارد."}
        action={
          <Link className="ds-link" to={`/${orgId}/${HUB_PATH}?kind=lifecycle`}>
            چرخه‌های عمر رکوردها
          </Link>
        }
      />
    );
  return <Editor key={table} view={q.data} base={base} editable={access.write && !phone} canWrite={access.write} phone={phone} />;
}

interface EditorProps {
  view: LifecycleView;
  base: TableDef;
  editable: boolean;
  /** `settings` full (a phone reads only) */
  canWrite: boolean;
  phone: boolean;
}

function Editor({ view, base, editable, canWrite, phone }: EditorProps) {
  const { api, orgId } = useOrg();
  const n = useNotify();
  const qc = useQueryClient();
  const refresh = useRefreshSchema();
  const { schema } = useSchema();
  const items = useShellItems();
  const def: TableDef = schema?.def(view.table) ?? base;
  const choices = schema?.choices ?? {};
  const stored = useMemo(() => draftOf(view), [view]);
  const hist = useHistory<LifecycleDraft>(stored);
  const draft = hist.value;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // the stored lifecycle changed (our own save, or another administrator's): it is the new baseline, and a draft with
  // no unsaved edits follows it — unsaved edits stay (saving them replaces the whole overlay)
  const seen = useRef(view);
  const ownSave = useRef(false);
  useEffect(() => {
    const prev = seen.current;
    if (prev === view) return;
    seen.current = view;
    if (ownSave.current || !isDirty(prev, draftRef.current)) hist.reset(draftOf(view));
    ownSave.current = false;
  }, [view, hist.reset]);

  const roles = useQuery({ queryKey: LIFECYCLE_KEYS.roles(orgId), queryFn: () => lifecycleApi.roles(api), enabled: !view.labels_only, retry: false, staleTime: 60_000 });
  // the roles' names: the organisation's (`users` read), else the built-in ones
  const roleList = useMemo<RoleOption[]>(
    () => roles.data ?? (roles.isError ? builtinRoles().map((r) => ({ key: r.key, name: r.name, active: r.active !== false })) : []),
    [roles.data, roles.isError],
  );
  const roleNames = useMemo(() => new Map(roleList.map((r) => [r.key, r.name])), [roleList]);
  const [busy, setBusy] = useState(false);
  /** the confirmation: what saving sends, and whether my changes were just put onto another administrator's save */
  const [confirm, setConfirm] = useState<{ lines: DiffLine[]; moved: boolean } | null>(null);
  const [condFor, setCondFor] = useState<string | null>(null);
  const [at, setAt] = useState<string>(base.states?.initial ?? view.states[0]?.value ?? "");

  const dirty = isDirty(view, draft);
  const problems = useMemo(
    () => (editable ? draftProblems(view, draft, { base, def, roles: roles.data ? new Set(roles.data.map((r) => r.key)) : null }) : []),
    [editable, view, draft, base, def, roles.data],
  );
  useLeaveGuard(dirty, `/${orgId}/${HUB_PATH}?kind=lifecycle`);
  useUndoKeys(editable, hist.undo, hist.redo);

  const names: DiffNames = {
    field: (name) => def.fields.find((f) => f.name === name)?.label ?? name,
    role: (key) => roleNames.get(key) ?? key,
    cond: (c) => condText(c, def, choices),
  };
  const fromDefault = draftDiff(view, defaultDraft(view), draft, names);
  const set = (next: LifecycleDraft, key?: string) => hist.set(next, key);

  /**
   * The stored lifecycle, read again: when another administrator saved since this page read it, my changes go onto
   * theirs (the page's baseline and draft move, undo starts again) and the confirmation shows what saving now sends.
   * True when that happened (the caller stops: the person confirms again).
   */
  const moved = async (): Promise<boolean> => {
    const r = await lifecycleApi.recheck(api, view, draft);
    if (!r) return false;
    const { now, draft: rebased } = r;
    // the baseline moves with the rebased draft (the effect above would otherwise judge it by the old view)
    seen.current = qc.setQueryData<LifecycleView>(LIFECYCLE_KEYS.one(orgId, view.table), now) ?? now;
    hist.reset(rebased);
    const lines = draftDiff(now, draftOf(now), rebased, names);
    if (lines.length) setConfirm({ lines, moved: true });
    else {
      setConfirm(null);
      n.info("همکار دیگری همین تغییرها را پیش‌تر ذخیره کرده بود؛ چیزی برای ذخیره نماند.");
    }
    return true;
  };
  const review = async () => {
    setBusy(true);
    try {
      if (await moved()) return;
      setConfirm({ lines: draftDiff(view, draftOf(view), draft, names), moved: false });
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (await moved()) return;
      const saved = await lifecycleApi.save(api, view.table, overlayOf(view, draft));
      ownSave.current = true;
      qc.setQueryData(LIFECYCLE_KEYS.one(orgId, view.table), saved);
      await Promise.all([refresh(), qc.invalidateQueries({ queryKey: HUB_KEYS.all(orgId) })]);
      setConfirm(null);
      n.ok(`چرخهٔ عمر «${base.plural}» ذخیره شد`);
    } catch (e) {
      n.error(e);
    } finally {
      setBusy(false);
    }
  };
  const toDefault = async () => {
    if (!(await n.confirm(`بازگشت چرخهٔ عمر «${base.plural}» به پیش‌فرض ماژول؟`, "برچسب‌ها، رنگ‌ها، الزام‌ها و شرط‌های سازمان کنار می‌رود؛ با «ذخیرهٔ تغییرها» اعمال می‌شود.", false, "بازگشت به پیش‌فرض"))) return;
    set(defaultDraft(view));
  };

  const header = (
    <PageHeader
      back={`/${orgId}/${HUB_PATH}?kind=lifecycle`}
      title={`چرخهٔ عمر «${base.plural}»`}
      subtitle={
        <span className="wfm-toolbar">
          <Chip tone={view.labels_only ? "neutral" : "in"}>{scopeChip(view)}</Chip>
          <span>{summaryText(view, fromDefault.length)}</span>
          {editable ? <SaveStatus state={problems.length ? "invalid" : dirty ? "pending" : "saved"} at={null} problems={problems.length} /> : null}
        </span>
      }
      actions={
        editable ? (
          <>
            <Tooltip title="واگرد (Ctrl+Z)">
              <Button icon={<Undo2 {...I16} />} onClick={hist.undo} disabled={!hist.canUndo} aria-label="واگرد" />
            </Tooltip>
            <Tooltip title="ازنو (Ctrl+Shift+Z)">
              <Button icon={<Redo2 {...I16} />} onClick={hist.redo} disabled={!hist.canRedo} aria-label="ازنو" />
            </Tooltip>
            <Button icon={<RotateCcw {...I16} />} onClick={toDefault} disabled={isDefault(view, draft)}>
              بازگشت به پیش‌فرض
            </Button>
            <Button type="primary" icon={<Save {...I16} />} loading={busy && !confirm} disabled={!dirty || problems.length > 0} onClick={review}>
              ذخیرهٔ تغییرها
            </Button>
          </>
        ) : null
      }
    />
  );

  const editTarget = condFor ? view.transitions.find((t) => t.key === condFor) : undefined;
  return (
    <div className="rk-admin wfl-page">
      {header}
      {view.notes.map((x) => {
        const page = matchItem(items, x.link);
        return (
          <Note
            key={x.link}
            action={
              page ? (
                <Link className="ds-link" to={`/${orgId}/${x.link}`}>
                  {page.label}
                </Link>
              ) : undefined
            }
          >
            {x.text}
          </Note>
        );
      })}
      {!canWrite ? <Note>{LIFECYCLE_REFUSAL}.</Note> : phone ? <Note>ویرایش چرخهٔ عمر روی رایانه ممکن است.</Note> : null}
      {problems.map((p) => (
        <Alert key={p} type="warning" showIcon title={p} />
      ))}
      <Preview view={view} draft={draft} at={at} onAt={setAt} />
      <Section title="وضعیت‌ها" bodyClass="wfl-sec">
        <StatesTable view={view} draft={draft} editable={editable} onChange={(value, p, key) => set(setState(draft, value, p), key)} />
      </Section>
      <Section title="انتقال‌ها" bodyClass="wfl-sec">
        <TransitionsTable
          view={view}
          draft={draft}
          def={def}
          editable={editable}
          roles={roleList}
          names={names}
          onChange={(key, p, typing) => set(setTransition(draft, key, p), typing)}
          onPrimary={(key) => set(setPrimary(draft, key))}
          onCond={setCondFor}
        />
      </Section>
      <Section title="تفاوت با پیش‌فرض">
        {fromDefault.length ? <DiffList lines={fromDefault} /> : <p className="rk-hint wfl-none">همان چرخهٔ عمر ماژول است.</p>}
      </Section>
      {confirm ? (
        <Modal open title={`ذخیرهٔ چرخهٔ عمر «${base.plural}»؟`} onCancel={() => setConfirm(null)} okText="ذخیره" cancelText="انصراف" onOk={save} okButtonProps={{ loading: busy }} width={600}>
          <div className="wfh-stack">
            {confirm.moved ? <Note tone="warning">همکار دیگری پس از باز شدن این صفحه این چرخهٔ عمر را تغییر داد؛ تغییرهای شما روی نسخهٔ تازه گذاشته شد. آنچه اکنون ذخیره می‌شود:</Note> : null}
            <p className="rk-hint">این تغییرها به همهٔ «{base.plural}» می‌رسد: صفحهٔ رکوردها، فهرست‌ها، نسخهٔ ویندوز و گزارش‌ها.</p>
            <DiffList lines={confirm.lines} />
          </div>
        </Modal>
      ) : null}
      {editTarget && schema ? (
        <CondDialog
          key={editTarget.key}
          title={transitionLabel(view, draft, editTarget.key)}
          def={def}
          schema={schema}
          value={draft.transitions[editTarget.key]?.when ?? null}
          message={draft.transitions[editTarget.key]?.message ?? ""}
          onClose={() => setCondFor(null)}
          onSave={(when, message) => {
            set(setTransition(draft, editTarget.key, { when, message: when ? message : "" }));
            setCondFor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function DiffList({ lines }: { lines: DiffLine[] }) {
  return (
    <ul className="wfl-diff">
      {lines.map((l) => (
        <li key={`${l.what}:${l.to}`}>
          <span className="text-ink">{l.what}:</span>{" "}
          <Tooltip title="پیش از این">
            <span className="wfl-was">{l.from}</span>
          </Tooltip>{" "}
          <span className="text-ink-3" aria-hidden>
            ←
          </span>{" "}
          <span className="text-ink">{l.to}</span>
        </li>
      ))}
    </ul>
  );
}

/** The states as the record page draws them; a state chosen shows the buttons a record in it offers. */
function Preview({ view, draft, at, onAt }: { view: LifecycleView; draft: LifecycleDraft; at: string; onAt: (v: string) => void }) {
  const states = channel(view, draft);
  const buttons = previewButtons(view, draft, at);
  const shown = buttons.slice(0, VISIBLE_BUTTONS);
  const rest = buttons.length - shown.length;
  const here = states.find((s) => s.value === at);
  return (
    <Section title="پیش‌نمایش" bodyClass="wfl-preview">
      <div className="wfl-channel" role="radiogroup" aria-label="وضعیت رکورد">
        {states.map((s) => (
          <button key={s.value} type="button" role="radio" aria-checked={s.value === at} className={s.value === at ? "wfl-state is-on" : "wfl-state"} onClick={() => onAt(s.value)}>
            <ChoiceTag option={{ value: s.value, label: s.label, color: s.color ?? undefined }} strong />
            <span className="wfl-cat">{s.category}</span>
          </button>
        ))}
      </div>
      <div className="wfl-buttons" aria-live="polite">
        <span className="rk-hint">{here ? `رکوردی در «${here.label}»:` : null}</span>
        {shown.length ? (
          shown.map((b) => (
            <Button key={b.key} size="small" type={b.primary ? "primary" : "default"} tabIndex={-1} className="wfl-fake">
              {b.label}
            </Button>
          ))
        ) : (
          <span className="rk-hint">انتقالی از این وضعیت نیست</span>
        )}
        {rest > 0 ? <span className="rk-hint">و {rest.toLocaleString("fa-IR")} انتقال دیگر در «بیشتر»</span> : null}
      </div>
    </Section>
  );
}

function StatesTable({ view, draft, editable, onChange }: { view: LifecycleView; draft: LifecycleDraft; editable: boolean; onChange: (value: string, p: { label?: string; color?: ColorKey | null }, key?: string) => void }) {
  return (
    <Table<LifecycleState>
      size="small"
      className="ds-table wfl-table"
      rowKey="value"
      dataSource={view.states}
      pagination={false}
      scroll={{ x: 640 }}
      columns={[
        {
          key: "value",
          title: "مقدار",
          width: 170,
          render: (_: unknown, s) => (
            <span className="wfl-locked">
              <bdi dir="ltr" className="ds-mono">
                {s.value}
              </bdi>
              <LockMark />
            </span>
          ),
        },
        {
          key: "cat",
          title: "دسته",
          width: 130,
          render: (_: unknown, s) => (
            <span className="wfl-locked">
              {categoryLabel(s.category)}
              <LockMark />
            </span>
          ),
        },
        {
          key: "label",
          title: "برچسب",
          render: (_: unknown, s) =>
            editable ? (
              <Input
                size="small"
                value={draft.states[s.value]?.label ?? ""}
                placeholder={s.default_label}
                maxLength={60}
                onChange={(e) => onChange(s.value, { label: e.target.value }, `state:${s.value}:label`)}
                aria-label={`برچسب وضعیت «${s.default_label}»`}
              />
            ) : (
              <span>{draft.states[s.value]?.label || s.default_label}</span>
            ),
        },
        {
          key: "color",
          title: "رنگ",
          width: 170,
          render: (_: unknown, s) => {
            const c = draft.states[s.value]?.color ?? null;
            const shown = c ?? s.default_color;
            return editable ? (
              <Select<ColorKey>
                size="small"
                className="wfl-color"
                value={c ?? undefined}
                allowClear
                placeholder={<ChoiceTag option={{ value: s.value, label: s.default_color ? `${COLOR_LABELS[s.default_color]} (ماژول)` : "رنگ ماژول", color: s.default_color ?? undefined }} />}
                onChange={(v) => onChange(s.value, { color: v ?? null })}
                options={COLOR_KEYS.map((k) => ({ value: k, label: COLOR_LABELS[k] }))}
                optionRender={(o) => <ChoiceTag option={{ value: String(o.value), label: String(o.label), color: o.value as ColorKey }} />}
                labelRender={(o) => <ChoiceTag option={{ value: String(o.value), label: String(o.label), color: o.value as ColorKey }} />}
                aria-label={`رنگ وضعیت «${s.default_label}»`}
              />
            ) : shown ? (
              <ChoiceTag option={{ value: s.value, label: COLOR_LABELS[shown], color: shown }} />
            ) : (
              <span className="text-ink-3">—</span>
            );
          },
        },
      ]}
    />
  );
}

interface TransitionsProps {
  view: LifecycleView;
  draft: LifecycleDraft;
  def: TableDef;
  editable: boolean;
  roles: RoleOption[];
  names: DiffNames;
  onChange: (key: string, p: Partial<LifecycleDraft["transitions"][string]>, typing?: string) => void;
  onPrimary: (key: string) => void;
  onCond: (key: string) => void;
}

function TransitionsTable({ view, draft, def, editable, roles, names, onChange, onPrimary, onCond }: TransitionsProps) {
  const fields = requirableFields(def);
  const roleOptions = roles.map((r) => ({ value: r.key, label: r.name, disabled: !r.active }));
  const labelsOnly = view.labels_only;
  const filterFa = (input: string, o?: { label?: unknown }) => normalizeFa(String(o?.label ?? "")).includes(normalizeFa(input));
  return (
    <Table<LifecycleTransition>
      size="small"
      className="ds-table wfl-table"
      rowKey="key"
      dataSource={view.transitions}
      pagination={false}
      scroll={{ x: labelsOnly ? 640 : 1080 }}
      columns={[
        {
          key: "path",
          title: "از ← به",
          width: 200,
          render: (_: unknown, t) => (
            <span className="wfl-path">
              <span className="wfl-locked">
                {transitionPath(view, draft, t)}
                <LockMark />
              </span>
              {t.guard ? <span className="rk-hint">شرط ماژول در کد</span> : null}
              {t.roles?.roles?.length ? <span className="rk-hint">نقش‌های ماژول: {t.roles.roles.map(names.role).join("، ")}</span> : null}
            </span>
          ),
        },
        {
          key: "label",
          title: "برچسب",
          width: 170,
          render: (_: unknown, t) =>
            editable ? (
              <Input
                size="small"
                value={draft.transitions[t.key]?.label ?? ""}
                placeholder={t.default_label}
                maxLength={60}
                onChange={(e) => onChange(t.key, { label: e.target.value }, `transition:${t.key}:label`)}
                aria-label={`برچسب انتقال ${transitionPath(view, draft, t)}`}
              />
            ) : (
              <span>{transitionLabel(view, draft, t.key)}</span>
            ),
        },
        {
          key: "primary",
          title: "اصلی",
          width: 56,
          align: "center" as const,
          render: (_: unknown, t) => (
            <Radio
              checked={!!draft.transitions[t.key]?.primary}
              disabled={!editable}
              onClick={() => onPrimary(t.key)}
              aria-label={`«${transitionLabel(view, draft, t.key)}» انتقال اصلی باشد`}
            />
          ),
        },
        ...(labelsOnly
          ? []
          : [
              {
                key: "needs",
                title: "فیلدهای لازم",
                width: 200,
                render: (_: unknown, t: LifecycleTransition) => {
                  const own = draft.transitions[t.key]?.needs ?? [];
                  return (
                    <span className="wfl-cell">
                      {t.requires.length ? (
                        <span className="wfl-module-tags">
                          {t.requires.map((r) => (
                            <Tooltip key={r} title="ماژول این فیلد را برای این انتقال لازم دارد">
                              <span className="wfl-req">
                                <Lock {...I14} aria-hidden />
                                {names.field(r)}
                              </span>
                            </Tooltip>
                          ))}
                        </span>
                      ) : null}
                      {editable ? (
                        <Select
                          size="small"
                          mode="multiple"
                          className="wfl-multi"
                          value={own}
                          onChange={(v: string[]) => onChange(t.key, { needs: v })}
                          options={fields.filter((f) => !t.requires.includes(f.name)).map((f) => ({ value: f.name, label: f.label, disabled: !!f.blocked && !own.includes(f.name), title: f.blocked ?? undefined }))}
                          showSearch={{ filterOption: filterFa }}
                          placeholder="افزودن فیلد"
                          maxTagCount="responsive"
                          aria-label={`فیلدهای لازم «${transitionLabel(view, draft, t.key)}»`}
                        />
                      ) : own.length ? (
                        <span>{own.map(names.field).join("، ")}</span>
                      ) : t.requires.length ? null : (
                        <span className="text-ink-3">—</span>
                      )}
                    </span>
                  );
                },
              },
              {
                key: "also",
                title: "فقط با نقش",
                width: 180,
                render: (_: unknown, t: LifecycleTransition) => {
                  const own = draft.transitions[t.key]?.also ?? [];
                  const extra = own.filter((k) => !roleOptions.some((o) => o.value === k)).map((k) => ({ value: k, label: k, disabled: false }));
                  return editable ? (
                    <Select
                      size="small"
                      mode="multiple"
                      className="wfl-multi"
                      value={own}
                      onChange={(v: string[]) => onChange(t.key, { also: v })}
                      options={[...roleOptions, ...extra]}
                      showSearch={{ filterOption: filterFa }}
                      placeholder="بدون شرط نقش"
                      maxTagCount="responsive"
                      aria-label={`فقط با نقش «${transitionLabel(view, draft, t.key)}»`}
                    />
                  ) : own.length ? (
                    <span>{own.map(names.role).join("، ")}</span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  );
                },
              },
              {
                key: "when",
                title: "شرط",
                width: 200,
                render: (_: unknown, t: LifecycleTransition) => {
                  const x = draft.transitions[t.key];
                  const text = x?.when ? names.cond(x.when) : "";
                  return (
                    <span className="wfl-cell">
                      {text ? <span className="wfl-cond">{text}</span> : editable ? null : <span className="text-ink-3">—</span>}
                      {x?.when && x.message ? <span className="rk-hint">«{x.message}»</span> : null}
                      {editable ? (
                        <Button size="small" type="link" className="wfl-cond-btn" onClick={() => onCond(t.key)}>
                          {x?.when ? "ویرایش شرط" : "افزودن شرط"}
                        </Button>
                      ) : null}
                    </span>
                  );
                },
              },
              {
                key: "off",
                title: "خاموش",
                width: 64,
                align: "center" as const,
                render: (_: unknown, t: LifecycleTransition) =>
                  t.optional ? (
                    <Switch size="small" checked={!!draft.transitions[t.key]?.off} disabled={!editable} onChange={(v) => onChange(t.key, { off: v })} aria-label={`خاموش‌کردن «${transitionLabel(view, draft, t.key)}»`} />
                  ) : (
                    <Tooltip title="این انتقال را ماژول به کار می‌برد و خاموش نمی‌شود">
                      <span className="text-ink-3" aria-label="خاموش نمی‌شود">
                        —
                      </span>
                    </Tooltip>
                  ),
              },
            ]),
      ]}
    />
  );
}

function LockMark() {
  return (
    <Tooltip title="این وضعیت را ماژول به کار می‌برد">
      <Lock {...I14} className="wfl-lock" aria-label="قفل: ماژول به کار می‌برد" />
    </Tooltip>
  );
}

/** A transition's condition (the record's own fields) and the message people see when it does not hold. */
function CondDialog({
  title, def, schema, value, message, onClose, onSave,
}: {
  title: string;
  def: TableDef;
  schema: NonNullable<ReturnType<typeof useSchema>["schema"]>;
  value: Cond | null;
  message: string;
  onClose: () => void;
  onSave: (when: Cond | null, message: string) => void;
}) {
  const [cond, setCond] = useState<Cond | null>(value);
  const [msg, setMsg] = useState(message);
  return (
    <Modal open title={`شرط «${title}»`} onCancel={onClose} okText="به‌کاربردن" cancelText="انصراف" onOk={() => onSave(cond, msg)} width={720} destroyOnHidden>
      <div className="wfh-stack">
        <p className="rk-hint">افراد این انتقال را فقط وقتی می‌توانند انجام دهند که شرط برقرار باشد؛ کارهای خود سامانه از آن نمی‌گذرند.</p>
        <FilterBuilder def={def} schema={schema} value={cond} onChange={setCond} walk={false} />
        <F label="پیام وقتی شرط برقرار نیست" htmlFor="wfl-cond-msg" hint="کسی که این انتقال را بخواهد و شرط برقرار نباشد، همین پیام را می‌بیند.">
          <Input id="wfl-cond-msg" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} disabled={!cond} placeholder={`«${title}» اکنون ممکن نیست`} />
        </F>
      </div>
    </Modal>
  );
}
