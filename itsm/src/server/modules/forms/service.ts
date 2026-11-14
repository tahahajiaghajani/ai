// The API of process forms (design F §3.2, §8.2, package F2), behind src/server/routes/forms.ts. Writes go through the
// engine as the system acting for the person (`sysOf(ctx, ctx.user.id)`, as F1's routes do): the form's hooks hold on
// this path as on every other, the person is the actor of history and events, and a support session's change is
// audited. Reads are the service's own once the caller passed the check: `process_design` read or `settings` edit to
// read, `process_design` write or `settings` edit to write (design F §6.1).
import type { FieldDef } from "@shared/model/types";
import { cleanFormLayout, layoutFields, type FormLayoutV2 } from "@shared/forms/layout";
import { layoutHash } from "@shared/forms/snapshot";
import type { Ctx } from "../../context";
import { notFound } from "../../http/errors";
import { createIn, removeIn, updateIn } from "../../engine";
import type { Row } from "../../engine/hooks";
import { sysOf } from "../admin/common";
import { canDesignForms, needFormsRead, needFormsWrite } from "./access";
import { libraryFields } from "./library";
import { formUsage, type FormUsage } from "./usage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The system, acting for the person (their own write: audited, and refused once their session ended). */
const actingFor = (ctx: Ctx) => sysOf(ctx, ctx.user.id);

export interface FormOut {
  id: string;
  name: string;
  description: string | null;
  status: string;
  version_no: number;
  layout: FormLayoutV2;
  /** the library fields the layout uses */
  fields: string[];
  published_at: string | null;
  /** published, and the layout changed since («تغییرهای منتشرنشده») */
  changed: boolean;
  updated_at: string | null;
}

export function formOut(r: Row): FormOut {
  const layout = cleanFormLayout(r.layout);
  const status = String(r.status ?? "draft");
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    description: r.description ?? null,
    status,
    version_no: Number(r.version_no ?? 0) || 0,
    layout,
    fields: layoutFields(layout),
    published_at: r.published_at ? new Date(r.published_at).toISOString() : null,
    changed: status === "published" && !!r.published_hash && r.published_hash !== layoutHash(layout),
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
  };
}

/** A live form of the organisation (404 otherwise). */
export async function formRow(ctx: Ctx, id: string): Promise<Row> {
  const row = UUID.test(id) ? await ctx.db.one<Row>(`select * from sm_forms where org_id = $1 and id = $2 and deleted_at is null`, [ctx.org.id, id.toLowerCase()]) : null;
  if (!row) throw notFound("فرم پیدا نشد");
  return row;
}

export interface FormDetail {
  form: FormOut;
  /** the library fields the form uses, as the online forms build them (with their status) */
  fields: Record<string, { label: string; type: string; type_label: string; def: FieldDef | null; retired: boolean }>;
  usage: FormUsage;
  editable: boolean;
}

/** GET /forms/:id — a process form, the definitions of its fields and where it is used. */
export async function getForm(ctx: Ctx, id: string): Promise<FormDetail> {
  await needFormsRead(ctx);
  const row = await formRow(ctx, id);
  const form = formOut(row);
  const lib = await libraryFields(ctx.db, ctx.org.id, form.fields);
  const fields: FormDetail["fields"] = {};
  for (const name of form.fields) {
    const f = lib.get(name);
    if (f) fields[name] = { label: f.label, type: f.type, type_label: f.type_label, def: f.def, retired: f.retired };
  }
  return { form, fields, usage: await formUsage(ctx.db, ctx.org.id, { id: form.id, name: form.name }), editable: await canDesignForms(ctx) };
}

/** GET /forms/:id/usage */
export async function usageOf(ctx: Ctx, id: string): Promise<{ id: string; name: string; usage: FormUsage }> {
  await needFormsRead(ctx);
  const row = await formRow(ctx, id);
  return { id: String(row.id), name: String(row.name), usage: await formUsage(ctx.db, ctx.org.id, { id: String(row.id), name: String(row.name) }) };
}

export interface FormInput {
  name?: string;
  description?: string | null;
  layout?: unknown;
}

const values = (input: FormInput): Row => {
  const out: Row = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.description !== undefined) out.description = input.description;
  if (input.layout !== undefined) out.layout = input.layout;
  return out;
};

/** POST /forms — a process form (a draft until a process publish takes it). */
export async function createForm(ctx: Ctx, input: FormInput): Promise<FormOut> {
  await needFormsWrite(ctx);
  const sys = actingFor(ctx);
  const row = await sys.write((tx) => createIn(tx, sys, "form", { layout: { tabs: [] }, ...values(input) }));
  return formOut(row);
}

/** PATCH /forms/:id — its name, description or layout (running processes keep the snapshot of their version). */
export async function updateForm(ctx: Ctx, id: string, input: FormInput): Promise<FormOut> {
  await needFormsWrite(ctx);
  const prev = await formRow(ctx, id);
  const sys = actingFor(ctx);
  const row = await sys.write((tx) => updateIn(tx, sys, "form", String(prev.id), values(input)));
  return formOut(row);
}

/** DELETE /forms/:id — refused while a process uses it (the form's hook). */
export async function deleteForm(ctx: Ctx, id: string): Promise<{ ok: true }> {
  await needFormsWrite(ctx);
  const prev = await formRow(ctx, id);
  const sys = actingFor(ctx);
  await sys.write((tx) => removeIn(tx, sys, "form", String(prev.id)));
  return { ok: true };
}
