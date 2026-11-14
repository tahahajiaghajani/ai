// Values entered on a process form (design F §3.6.4 steps 3–4, package F2), checked against the version's snapshot
// alone: the record engine's storage coercion (`coerceValue`, with the snapshot's own options, so no `choice` row is
// read) and the shared validators of field types (named checks, patterns, decimals, date limits, «پیوست») — the same
// answers on the authority and on a Windows app's local server, which never need `field_def`, `field_type`,
// `custom_field` or `choice` rows.
//   · keys the person may not change at the step (`effectiveRights`) are dropped and counted;
//   · a field that a «نمایش وقتی…» condition hides is neither asked for nor taken (`applyShowIf`);
//   · required fields bind the outcomes that carry the form forward (submit, approve: `requireAll`), never reject or
//     return; a required yes/no field must be ticked;
//   · a value sent back unchanged is not judged again (a field type tightened later binds new values only);
//   · references and files: `checkFormRefs` asks the organisation's rows (the authority's apply runs it in its
//     transaction), and «پیوست» values may name only the files the caller passes (the submission's own).
// The preview checks sample values with it; F4a's apply checks submissions with it.
import type { FieldDef, TableDef } from "@shared/model/types";
import type { CondEnv } from "@shared/model/conditions";
import { applyShowIf, canEdit, fieldItems, formValuesDef, type Right } from "@shared/forms/layout";
import { snapshotFields, type FormsSnapshot } from "@shared/forms/snapshot";
import { attachmentsProblem } from "@shared/forms/validators";
import type { Ctx } from "../../context";
import type { Queryable } from "../../db";
import { notFound } from "../../http/errors";
import { FieldError, Problems, checkRefs, coerceValue, condEnv, orgSchema } from "../../engine";
import type { ValueContext } from "../../engine/values";

export interface FormValuesOptions {
  /** the person's rights at the step (`effectiveRights`) */
  rights: Record<string, Right>;
  /** the values the case holds already: unchanged values are not judged again, conditions and requirements read them */
  stored?: Record<string, unknown>;
  /** required fields bind this outcome (submit, approve) — never reject or return */
  requireAll?: boolean;
  /** the organisation's time zone */
  tz: string;
  /** the day relative date limits ($today) count from (YYYY-MM-DD; default today in `tz`): a submission's own day */
  today?: string;
  /** the files a «پیوست» value may name (id → file name): the submission's own; absent = their shape only */
  attachments?: ReadonlyMap<string, { name: string }>;
  /** who enters them (conditions on «من») */
  env?: CondEnv;
}

export interface FormValuesResult {
  /** the values kept, in their stored shape */
  values: Record<string, unknown>;
  /** keys left out: not on the form, or not editable by the person here */
  dropped: string[];
  /** field → Persian message */
  problems: Record<string, string>;
  /** the rights once «نمایش وقتی…» is applied to these values */
  rights: Record<string, Right>;
}

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** No choice lists: a snapshot's fields carry their options. */
const NO_LISTS: ValueContext["schema"] = { choices: () => [] };

/**
 * The values of `input` a person may give on form `formId` of the snapshot with `rights`, coerced and checked. Throws
 * 404 when the snapshot does not hold the form.
 */
export function checkFormValues(snapshot: FormsSnapshot, formId: string, input: Record<string, unknown>, opts: FormValuesOptions): FormValuesResult {
  const form = snapshot.forms[formId];
  if (!form) throw notFound("فرم این مرحله در نسخهٔ گردش‌کار نیست");
  const defs = snapshotFields(snapshot);
  // messages name a field as this form shows it
  const fields = new Map<string, FieldDef>();
  for (const item of fieldItems(form.layout)) {
    const f = defs.get(item.field);
    if (f) fields.set(item.field, item.label ? { ...f, label: item.label } : f);
  }
  const stored = opts.stored ?? {};
  const rights = applyShowIf(form.layout, opts.rights, { ...stored, ...input }, fields, opts.env);
  const vc: ValueContext = { schema: NO_LISTS, tz: opts.tz, today: opts.today };
  const values: Record<string, unknown> = {};
  const dropped: string[] = [];
  const problems = new Problems();
  for (const [key, raw] of Object.entries(input ?? {})) {
    const f = fields.get(key);
    if (!f || !canEdit(rights[key])) {
      dropped.push(key);
      continue;
    }
    const v = problems.try(() => coerceValue(f, raw, vc, stored[key]));
    if (v === undefined) continue;
    values[key] = v;
    if (f.check === "attachments" && opts.attachments && Array.isArray(v) && v.length) {
      const p = attachmentsProblem(f, v.map(String), opts.attachments);
      if (p) problems.add(key, p);
    }
  }
  const valueOf = (k: string) => (k in values ? values[k] : stored[k]);
  for (const [key, f] of fields) {
    // a dependent choice: each option's parent must be the parent field's value
    if (f.dependsOn && (f.type === "choice" || f.type === "multichoice") && key in values && !isEmpty(values[key]) && Array.isArray(f.choices)) {
      const parent = valueOf(f.dependsOn);
      for (const x of Array.isArray(values[key]) ? (values[key] as unknown[]) : [values[key]]) {
        const o = f.choices.find((y) => y.value === x);
        if (o?.parent && o.parent !== parent) problems.add(key, `«${o.label}» با «${fields.get(f.dependsOn)?.label ?? f.dependsOn}» انتخاب‌شده جور نیست`);
      }
    }
    if (!opts.requireAll || rights[key] !== "required") continue;
    const v = valueOf(key);
    if (f.type === "bool" ? v !== true : isEmpty(v)) problems.add(key, f.type === "bool" ? `«${f.label}» باید تیک بخورد` : `«${f.label}» را وارد کنید`);
  }
  return { values, dropped, problems: problems.fields, rights };
}

/**
 * References among `values` (fields of form `formId`) must point at live rows of the organisation that satisfy each
 * field's condition (`refFilter`): the engine's `checkRefs`, one query per target table. Field → message.
 */
export async function checkFormRefs(q: Queryable, ctx: Ctx, snapshot: FormsSnapshot, formId: string, values: Record<string, unknown>): Promise<Record<string, string>> {
  const form = snapshot.forms[formId];
  if (!form) throw notFound("فرم این مرحله در نسخهٔ گردش‌کار نیست");
  const def: TableDef = formValuesDef(form.layout, snapshotFields(snapshot));
  const schema = await orgSchema(ctx, q);
  const problems = new Problems();
  // no record id: a «پیوست» value's files are the caller's to check (the submission's own)
  await checkRefs(q, ctx, def, { ...values, id: undefined }, Object.keys(values), schema, await condEnv(ctx), problems).catch((e) => {
    if (e instanceof FieldError) problems.add(e.field, e.message);
    else throw e;
  });
  return problems.fields;
}
