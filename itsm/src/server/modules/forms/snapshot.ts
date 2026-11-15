// The forms of a publish, on the server (design F §3.2, §3.5, D10, package F2): the organisation's forms, field library
// and shared lists, read in the publish's transaction and handed to the shared `snapshotForms`.
//   · `loadFormsSnapshot`: the snapshot of some forms as they are now, with the problems a publish must refuse (a form
//     or a field that is missing or cannot be used, a retired field) — the designer's preview shows them too;
//   · `publishForms` (F4c's publish calls it inside its transaction): the same, the forms' rows locked, and when there
//     is no problem the publish recorded on every form it takes — published, and a layout changed since its last
//     publish moves the form to its next version — so the version and its forms agree. Nothing is recorded when there
//     are problems (the publish is refused).
import type { Option } from "@shared/model/types";
import { layoutFields, cleanFormLayout } from "@shared/forms/layout";
import { layoutHash, snapshotForms, type FormsSnapshot } from "@shared/forms/snapshot";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { pgArray } from "../../db";
import { orgSchema, updateIn } from "../../engine";
import { sysOf } from "../admin/common";
import { libraryFields } from "./library";

interface FormRow {
  id: string;
  name: string;
  layout: unknown;
  status: string | null;
  version_no: number | null;
  published_hash: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function formRows(q: Queryable, orgId: string, ids: readonly string[], lock: boolean): Promise<FormRow[]> {
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))];
  if (!wanted.length) return [];
  return q.query<FormRow>(
    `select id, name, layout, status, version_no, published_hash from sm_forms
     where org_id = $1 and id = any($2::uuid[]) and deleted_at is null order by name${lock ? " for update" : ""}`,
    [orgId, pgArray(wanted)],
  );
}

async function snapshotOf(q: Queryable, ctx: Ctx, ids: readonly string[], rows: FormRow[]): Promise<{ snapshot: FormsSnapshot; problems: string[] }> {
  const found = new Set(rows.map((r) => String(r.id)));
  const missing = [...new Set(ids)].filter((id) => !found.has(String(id).toLowerCase()));
  const names = rows.flatMap((r) => layoutFields(cleanFormLayout(r.layout)));
  const [lib, schema] = await Promise.all([libraryFields(q, ctx.org.id, names), orgSchema(ctx, q)]);
  const out = snapshotForms(
    rows.map((r) => ({ id: String(r.id), name: String(r.name), layout: r.layout, version_no: r.version_no })),
    { field: (n) => lib.get(n) ?? null, choices: (list): Option[] => schema.choices(list) },
  );
  if (missing.length) out.problems.unshift(...missing.map(() => "فرمی که این گردش‌کار به کار می‌برد پیدا نشد؛ آن را دوباره برگزینید"));
  out.problems = [...new Set(out.problems)];
  return out;
}

/** The snapshot of forms `ids` as they are now, with what a publish of them must refuse. */
export async function loadFormsSnapshot(q: Queryable, ctx: Ctx, ids: readonly string[]): Promise<{ snapshot: FormsSnapshot; problems: string[] }> {
  return snapshotOf(q, ctx, ids, await formRows(q, ctx.org.id, ids, false));
}

/**
 * The snapshot of a publish, inside its transaction: the forms locked and taken; without problems, each recorded as
 * published — at its next version when its layout changed since its last publish (the snapshot carries the version
 * numbers after that). With problems, nothing is written.
 */
export async function publishForms(tx: Tx, ctx: Ctx, ids: readonly string[]): Promise<{ snapshot: FormsSnapshot; problems: string[] }> {
  const rows = await formRows(tx, ctx.org.id, ids, true);
  const out = await snapshotOf(tx, ctx, ids, rows);
  if (out.problems.length) return out;
  const sys = sysOf(ctx, ctx.actor === "system" ? null : ctx.user.id);
  const at = out.snapshot.at;
  for (const r of rows) {
    const form = out.snapshot.forms[String(r.id)];
    if (!form) continue;
    const hash = layoutHash(form.layout);
    if (r.status === "published" && r.published_hash === hash) continue;
    const version = (Number(r.version_no) || 0) + 1;
    await updateIn(tx, sys, "form", String(r.id), { status: "published", version_no: version, published_at: at, published_hash: hash }, { trusted: true });
    form.version_no = version;
  }
  return out;
}
