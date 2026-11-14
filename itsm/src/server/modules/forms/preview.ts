// «پیش‌نمایش» (design F §3.2, §8.2, §8.4, package F2): a form as a person sees it — the same `effectiveRights` the step
// form, the authority's apply and the read redaction use (one function, so they agree with the preview).
//   · GET /forms/:id/preview?step=&as=&rights=&values= — a process form: the definitions its next publish would take
//     (the snapshot builder itself), the rights at a step for a viewpoint, «نمایش وقتی…» on sample values, what the
//     form shows, and the sample values checked as a submission would be. The step is named by a reference that F4
//     resolves (`registerStepRights`: a step of a process draft or version that uses the form); `rights` gives a step's
//     rights directly (the designer's matrix before it is saved); neither: the form alone.
//   · GET /forms/system/:table/preview?as= — a table's default form for «درخواست‌دهنده» or «کارشناس» (or a member): which
//     fields it shows, which it asks for (the module's requirements, and the organisation's for those they bind) and
//     which only show, through the same function.
import type { FieldDef } from "@shared/model/types";
import { tableDef } from "@shared/tables";
import {
  applyShowIf, cleanStepRights, effectiveRights, formView, layoutFields, tableFormFields, type FieldItem, type FormLayoutV2, type FormView, type Right,
  type StepRights,
} from "@shared/forms/layout";
import { snapshotFields } from "@shared/forms/snapshot";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { bad, notFound } from "../../http/errors";
import { condEnv, orgSchema, orgTz } from "../../engine";
import { bindsRequirement } from "../../engine/schema";
import { needFormsRead, viewpointOf, type Viewpoint } from "./access";
import { formOut, formRow } from "./service";
import { loadFormsSnapshot } from "./snapshot";
import { checkFormValues } from "./values";
import { NO_LIBRARY_TABLES } from "../fields";

/** A step that uses a form, as F4 resolves it from a reference (a process draft's or version's step). */
export interface StepOfForm {
  label: string;
  rights: StepRights;
  /** the step's action (fill, review, approve): approve and submit outcomes bind required fields */
  action?: string;
}

export type StepRightsSource = (q: Queryable, ctx: Ctx, formId: string, ref: string) => Promise<StepOfForm | null>;

const sources: StepRightsSource[] = [];

/** Where steps come from (F4: process drafts and published versions). Returns an unregister function (tests). */
export function registerStepRights(source: StepRightsSource): () => void {
  sources.push(source);
  return () => {
    const at = sources.indexOf(source);
    if (at >= 0) sources.splice(at, 1);
  };
}

async function stepOf(ctx: Ctx, formId: string, ref: string): Promise<StepOfForm> {
  for (const s of sources) {
    const found = await s(ctx.db, ctx, formId, ref);
    if (found) return { ...found, rights: cleanStepRights(found.rights) };
  }
  throw notFound("مرحله‌ای با این فرم پیدا نشد");
}

export interface PreviewInput {
  /** a step that uses the form (a reference F4 resolves) */
  step?: string | null;
  /** a step's rights given directly */
  rights?: unknown;
  /** whose view: me (default), requester, agent, or a member's id */
  as?: string | null;
  /** sample values: «نمایش وقتی…» and the checks of a submission */
  values?: Record<string, unknown> | null;
}

export interface FormPreview {
  form: { id: string; name: string; status: string; version_no: number };
  step: { ref: string | null; label: string | null; rights: StepRights } | null;
  as: Viewpoint;
  /** every field's right at the step for the viewpoint */
  rights: Record<string, Right>;
  /** the rights once «نمایش وقتی…» reads the sample values (equal to `rights` without values) */
  shown: Record<string, Right>;
  /** what the form shows */
  view: FormView;
  /** the definitions of the form's fields, as a publish now would take them */
  fields: Record<string, FieldDef>;
  /** the sample values checked as a submission (submit or approve) would be */
  check: { values: Record<string, unknown>; dropped: string[]; problems: Record<string, string> } | null;
  /** what a publish with this form would be refused for (missing or retired fields) */
  publish_problems: string[];
}

/** Values given as JSON text in a query string (or as an object). */
export function jsonParam(raw: unknown, what: string): unknown {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    throw bad(`${what} باید JSON معتبر باشد`);
  }
}

/** GET|POST /forms/:id/preview */
export async function formPreview(ctx: Ctx, id: string, input: PreviewInput): Promise<FormPreview> {
  await needFormsRead(ctx);
  const row = await formRow(ctx, id);
  const form = formOut(row);
  const as = await viewpointOf(ctx, input.as);
  let step: FormPreview["step"] = null;
  if (input.step) {
    const s = await stepOf(ctx, form.id, input.step);
    step = { ref: input.step, label: s.label, rights: s.rights };
  } else if (input.rights !== undefined && input.rights !== null) {
    step = { ref: null, label: null, rights: cleanStepRights(input.rights) };
  }
  const { snapshot, problems } = await loadFormsSnapshot(ctx.db, ctx, [form.id]);
  const fields = snapshotFields(snapshot);
  const layout: FormLayoutV2 = snapshot.forms[form.id]?.layout ?? form.layout;
  const rights = effectiveRights(layout, step?.rights ?? null, fields, { groups: as.groups });
  const values = input.values && typeof input.values === "object" && !Array.isArray(input.values) ? input.values : null;
  const env = await condEnv(ctx);
  const shown = values ? applyShowIf(layout, rights, values, fields, env) : rights;
  let check: FormPreview["check"] = null;
  if (values && snapshot.forms[form.id]) {
    const r = checkFormValues(snapshot, form.id, values, { rights, requireAll: true, tz: orgTz(ctx), env });
    check = { values: r.values, dropped: r.dropped, problems: r.problems };
  }
  const used = new Set(layoutFields(layout));
  return {
    form: { id: form.id, name: form.name, status: form.status, version_no: form.version_no },
    step,
    as,
    rights,
    shown,
    view: formView(layout, shown, fields),
    fields: Object.fromEntries([...fields].filter(([n]) => used.has(n))),
    check,
    publish_problems: problems,
  };
}

export interface SystemPreview {
  table: string;
  as: Viewpoint;
  /** the right of each field of the table's form for the viewpoint (hidden: not on its form) */
  rights: Record<string, Right>;
  fields: { name: string; label: string; right: Right; required_by: "module" | "organisation" | null }[];
}

/**
 * GET /forms/system/:table/preview — a table's default form for a viewpoint, through `effectiveRights`: the fields of
 * the record page's body (engine-maintained ones read-only) as items of one form whose flags are the table's — hidden
 * on forms (the organisation's «پنهان در فرم»), read-only (the module's), required (the module's, or the
 * organisation's where it binds the viewpoint) — and the viewpoint's field groups.
 */
export async function systemPreview(ctx: Ctx, table: string, as: string | null | undefined): Promise<SystemPreview> {
  await needFormsRead(ctx);
  const base = tableDef(table);
  if (!base || base.virtual || NO_LIBRARY_TABLES.has(base.key)) throw notFound(`جدول «${table}» وجود ندارد`);
  const def = (await orgSchema(ctx)).def(base.key)!;
  const who = await viewpointOf(ctx, as);
  const shown = tableFormFields(def, { engine: true });
  const requiredBy = (f: FieldDef): "module" | "organisation" | null => (f.required && !f.system ? "module" : bindsRequirement(f, who.scope) ? "organisation" : null);
  const items: FieldItem[] = shown.map((f) => {
    const item: FieldItem = { field: f.name };
    if (f.formHidden) item.hidden = true;
    else if (f.readonly || f.system) item.readonly = true;
    else if (requiredBy(f)) item.required = true;
    return item;
  });
  const layout: FormLayoutV2 = { tabs: [{ label: "جزئیات", sections: [{ label: null, items }] }] };
  const rights = effectiveRights(layout, null, new Map(shown.map((f) => [f.name, f])), { groups: who.groups });
  return {
    table: def.key,
    as: who,
    rights,
    fields: shown.map((f) => ({ name: f.name, label: f.label, right: rights[f.name], required_by: rights[f.name] === "required" ? requiredBy(f) : null })),
  };
}
