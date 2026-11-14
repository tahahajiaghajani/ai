// Shared parts of the person's «گردش‌کارها» pages (design F §5, §8.6, package F7):
//   · where the pages live — the app (`workflows`) or the portal (`portal/workflows`, the same pages in its light
//     shell) — and the page head of each;
//   · the due pill, the notes of a step («به جانشینی از …»…), a case's state chip;
//   · the process form: a version's form laid out with my rights — hidden fields left out, read-only ones as values,
//     required ones marked, «نمایش وقتی…» applied as values change, amounts typed in the organisation's unit, the
//     files of a «پیوست» field kept here until they are sent with the submission;
//   · the values of a case by its forms' sections (read-only).
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { Tabs } from "antd";
import { useQuery } from "@tanstack/react-query";
import { applyShowIf, fieldGetter, formValuesDef, formView, isFieldItem, type FieldSource, type FormLayoutV2, type Right } from "@shared/forms/layout";
import { formatFieldMoney, moneyUnitOf, rialFromInput } from "@shared/forms/fieldtypes";
import type { FormsSnapshot } from "@shared/forms/snapshot";
import type { MoneyUnit } from "@shared/financial/logic";
import type { FieldDef } from "@shared/model/types";
import { useOrg } from "../../../lib/org";
import { cx, Note } from "../../../components/blocks";
import { Chip, StateChip } from "../../../components/display";
import { MoneyInput } from "../../../components/inputs";
import { PageHeader } from "../../../components/layout";
import { FieldInput } from "../../../records/fields/FieldInput";
import { FieldValue } from "../../../records/fields/display";
import { attachmentUrl } from "../../../records/data/api";
import type { Schema } from "../../../records/model/schema";
import type { TableMeta } from "../../../records/model/types";
import { PageHead } from "../../portal/parts";
import { FIELD_KEYS, fieldsApi } from "../admin/fields/api";
import { unitFromRial } from "../admin/process/model";
import { FilesInput, FilesValue, type FileItem } from "../kit";
import { caseStateView, dueView, wfPaths, WF_PATH, type WfPaths } from "./model";
import "../../../records/records.css";
import "./user.css";

// ---------------------------------------------------------------------------------------------------------------
// Where the pages live

interface Where {
  /** organisation-relative base: `workflows` or `portal/workflows` */
  base: string;
  portal: boolean;
}
const WhereCtx = createContext<Where>({ base: WF_PATH, portal: false });

/** The portal's «گردش‌کارها»: the same pages under `portal/workflows`. */
export function PortalWhere({ children }: { children: ReactNode }) {
  return <WhereCtx.Provider value={{ base: "portal/workflows", portal: true }}>{children}</WhereCtx.Provider>;
}

export interface Wf extends Where {
  paths: WfPaths;
  /** an organisation-relative path as the app's address */
  to: (rel: string) => string;
}

export function useWf(): Wf {
  const w = useContext(WhereCtx);
  const { orgId } = useOrg();
  return useMemo(() => ({ ...w, paths: wfPaths(w.base), to: (rel: string) => `/${orgId}/${rel.replace(/^\/+/, "")}` }), [w, orgId]);
}

/** The page's head: the app's PageHeader, or the portal's own. */
export function Head({ title, sub, actions, back }: { title: string; sub?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  const { portal } = useWf();
  if (portal) return <PageHead title={title} sub={sub} actions={actions} back={back} />;
  return <PageHeader title={title} subtitle={sub} actions={actions} back={back?.to} />;
}

// ---------------------------------------------------------------------------------------------------------------
// Small parts

export function DuePill({ due, prefix }: { due: string | null | undefined; prefix?: string }) {
  const d = dueView(due);
  if (!d) return null;
  return (
    <Chip tone={d.tone === "neutral" ? "neutral" : d.tone === "warning" ? "warning" : "danger"} className="wfu-due">
      {prefix ? `${prefix}: ${d.text}` : d.text}
    </Chip>
  );
}

export function Notes({ notes }: { notes: readonly string[] }) {
  if (!notes.length) return null;
  return (
    <span className="wfu-notes">
      {notes.map((n) => (
        <Chip key={n} tone={n === "در صف ارسال" ? "info" : "neutral"} dot={false}>
          {n}
        </Chip>
      ))}
    </span>
  );
}

export function CaseState({ state, paused }: { state: string; paused?: string | null }) {
  const v = caseStateView(state, paused);
  return <StateChip state={v.kind}>{v.label}</StateChip>;
}

/** The organisation's money unit (GET /financial/meta; every member reads it). */
export function useMoneyUnit(): MoneyUnit {
  const { api, orgId } = useOrg();
  const q = useQuery({ queryKey: FIELD_KEYS.unit(orgId), queryFn: () => fieldsApi.moneyUnit(api), staleTime: 300_000 });
  return q.data ?? "rial";
}

// ---------------------------------------------------------------------------------------------------------------
// The process form

/** The files a form holds before they are sent: tokens in the values, the files here. */
export interface LocalFiles {
  files: Map<string, File>;
  add: (file: File) => FileItem;
}

/** A per-form store of the files picked and not yet sent. */
export function useLocalFiles(): LocalFiles {
  const ref = useRef<{ files: Map<string, File>; seq: number }>({ files: new Map(), seq: 0 });
  return useMemo(
    () => ({
      files: ref.current.files,
      add: (file: File) => {
        const id = `local-${++ref.current.seq}`;
        ref.current.files.set(id, file);
        return { id, name: file.name, size: file.size };
      },
    }),
    [],
  );
}

export interface ProcessFormProps {
  layout: FormLayoutV2;
  /** the definitions of the form's fields (the version's snapshot) */
  fields: Record<string, FieldDef>;
  rights: Record<string, Right>;
  values: Record<string, unknown>;
  /** absent: the form is read-only */
  onChange?: (name: string, value: unknown) => void;
  problems?: Record<string, string>;
  schema: Schema;
  tz: string;
  unit: MoneyUnit;
  /** the files picked here; without it, files cannot be added */
  local?: LocalFiles;
  /** names of files the case already holds */
  known?: readonly FileItem[];
  idPrefix: string;
  label?: string;
  /** names of the people and records the values name */
  display?: Record<string, string>;
}

/** The form as the person sees it at this step (see the header). */
export function ProcessForm(p: ProcessFormProps) {
  const { orgId } = useOrg();
  const now = useMemo(() => applyShowIf(p.layout, p.rights, p.values, p.fields), [p.layout, p.rights, p.values, p.fields]);
  const view = useMemo(() => formView(p.layout, now, p.fields), [p.layout, now, p.fields]);
  const def = useMemo(() => ({ ...formValuesDef(p.layout, p.fields, p.label ?? "فرم"), can: { read: true as const, create: true } }) as TableMeta, [p.layout, p.fields, p.label]);
  const problems = p.problems ?? {};
  const localItems: FileItem[] = p.local ? [...p.local.files].map(([id, f]) => ({ id, name: f.name, size: f.size })) : [];
  const files = [...(p.known ?? []), ...localItems];
  if (!view.tabs.length) return <p className="rk-hint">در این مرحله فیلدی برای شما نیست.</p>;
  const body = (tab: (typeof view.tabs)[number]) => (
    <div className="rk-form">
      {tab.sections.map((sec, si) => (
        <section key={si} className="rk-sec" aria-label={sec.label ?? undefined}>
          {sec.label ? <h3 className="rk-sec-t">{sec.label}</h3> : null}
          <div className="rk-grid">
            {sec.items.map((item, n) => {
              if (item.kind === "note")
                return (
                  <div key={`note-${n}`} className="wfu-note-line">
                    <Note tone={item.tone === "warning" ? "warning" : "neutral"}>{item.text}</Note>
                  </div>
                );
              const f: FieldDef = { ...item.field, label: item.label, help: item.help };
              const id = `${p.idPrefix}-${item.name}`;
              const editable = !!p.onChange && (item.right === "edit" || item.right === "required");
              const problem = problems[item.name];
              const value = p.values[item.name] ?? null;
              const set = (v: unknown) => p.onChange?.(item.name, v);
              let control: ReactNode;
              if (f.check === "attachments") {
                control = editable ? (
                  <FilesInput
                    id={id}
                    value={value}
                    onChange={(ids) => set(ids)}
                    field={{ label: f.label, max: f.max ?? null, accept: (f.accept as string[] | undefined) ?? null, required: item.right === "required" }}
                    files={files}
                    upload={p.local ? async (file) => p.local!.add(file) : undefined}
                    unavailable="پیوست در این صفحه افزوده نمی‌شود"
                    hrefOf={(fid) => (fid.startsWith("local-") ? "" : attachmentUrl(orgId, fid))}
                    status={problem ? "error" : undefined}
                    aria-label={item.label}
                  />
                ) : (
                  <FilesValue value={value} display={Object.fromEntries(files.map((x) => [x.id, x.name]))} />
                );
              } else if (!editable) {
                control = <ReadValue f={f} value={value} schema={p.schema} tz={p.tz} unit={p.unit} display={p.display} />;
              } else if (f.type === "money") {
                const unit = moneyUnitOf(f, p.unit);
                control = (
                  <MoneyInput
                    id={id}
                    value={value === null || value === undefined || value === "" ? null : unitFromRial(String(value), unit)}
                    onChange={(v) => set(rialFromInput(v === null ? null : String(v), unit))}
                    unit={unit === "toman" ? "تومان" : "ریال"}
                    status={problem ? "error" : undefined}
                    aria-label={item.label}
                  />
                );
              } else {
                control = <FieldInput id={id} field={f} value={value} onChange={set} def={def} schema={p.schema} row={p.values} tz={p.tz} status={problem ? "error" : undefined} aria-label={item.label} />;
              }
              return (
                <div key={item.name} className={cx("rk-f", problem && "has-error")} style={{ ["--rk-span" as string]: String(item.span) }}>
                  <span className="rk-f-l">
                    {editable ? <label htmlFor={id}>{item.label}</label> : <span>{item.label}</span>}
                    {item.right === "required" && editable ? (
                      <span className="rk-req" aria-label="الزامی">
                        *
                      </span>
                    ) : null}
                  </span>
                  {control}
                  {item.help && editable ? <span className="rk-hint">{item.help}</span> : null}
                  {problem ? (
                    <span className="rk-err" role="alert">
                      {problem}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
  if (view.tabs.length === 1) return body(view.tabs[0]);
  return <Tabs items={view.tabs.map((t, i) => ({ key: String(i), label: t.label, children: body(t) }))} />;
}

/** A value read-only: amounts in the organisation's unit, the rest as the record pages show them. */
function ReadValue({ f, value, schema, tz, unit, display }: { f: FieldDef; value: unknown; schema: Schema; tz: string; unit: MoneyUnit; display?: Record<string, string> }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length))
    return <span className="wfu-ro ds-zero">—</span>;
  if (f.type === "money") return <span className="wfu-ro ds-num">{formatFieldMoney(f, value, unit, { suffix: true })}</span>;
  return (
    <span className="wfu-ro">
      <FieldValue field={f} value={value} table="process_case" schema={schema} tz={tz} display={display} />
    </span>
  );
}

/** The case's values I may read, by the sections of its forms (each field once). */
export function CaseValues({ forms, data, schema, tz, unit, only, display }: { forms: FormsSnapshot | null; data: Record<string, unknown>; schema: Schema; tz: string; unit: MoneyUnit; only?: (key: string) => boolean; display?: Record<string, string> }) {
  const groups = useMemo(() => {
    const get = fieldGetter((forms?.fields ?? {}) as FieldSource);
    const seen = new Set<string>();
    const out: { key: string; label: string; items: { name: string; label: string; field: FieldDef }[] }[] = [];
    for (const form of Object.values(forms?.forms ?? {})) {
      for (const tab of form.layout.tabs) {
        for (const [si, sec] of tab.sections.entries()) {
          const items: { name: string; label: string; field: FieldDef }[] = [];
          for (const it of sec.items) {
            if (!isFieldItem(it) || seen.has(it.field) || !(it.field in data) || (only && !only(it.field))) continue;
            const f = get(it.field);
            if (!f) continue;
            seen.add(it.field);
            items.push({ name: it.field, label: it.label || f.label, field: f });
          }
          if (items.length) out.push({ key: `${form.id}:${tab.label}:${si}`, label: sec.label || tab.label || form.name, items });
        }
      }
    }
    // values no form lays out (a field of an older layout)
    const rest = Object.keys(data).filter((k) => !seen.has(k) && (!only || only(k)) && get(k));
    if (rest.length) out.push({ key: "rest", label: "دیگر", items: rest.map((k) => ({ name: k, label: get(k)!.label, field: get(k)! })) });
    return out;
  }, [forms, data, only]);
  if (!groups.length) return <p className="rk-hint">مقداری برای نمایش به شما نیست.</p>;
  return (
    <div className="wfu-values">
      {groups.map((g) => (
        <section key={g.key} className="wfu-vsec" aria-label={g.label}>
          <h3 className="rk-sec-t">{g.label}</h3>
          <dl className="wfu-dl">
            {g.items.map((it) => (
              <div key={it.name}>
                <dt>{it.label}</dt>
                <dd>
                  {it.field.check === "attachments" ? <FilesValue value={data[it.name]} /> : <ReadValue f={it.field} value={data[it.name]} schema={schema} tz={tz} unit={unit} display={display} />}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
