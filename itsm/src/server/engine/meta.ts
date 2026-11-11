// Table definitions for the UI (GET /api/o/:org/meta/tables): the registry as the caller's organisation sees it
// (custom fields, relabelled fields, its choice lists) and as the caller may use it (tables they may read, fields
// they may see, whether they may create). An organisation's requirement (FieldDef.formRequired, people's writes only)
// shows as `required` to the people it binds, so forms mark it for them and only for them.
import type { FieldDef, Option, TableDef } from "@shared/model/types";
import { isNever } from "@shared/model/conditions";
import type { Ctx } from "../context";
import { forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { isSystemCtx } from "./env";
import { bindsRequirement, orgSchema, requirementScope, type OrgSchema } from "./schema";
import type { RequiredFor } from "@shared/forms/paths";
import { canOpenRecords } from "./read";
import { physicalTables, tableDef, USER_DEF } from "@shared/tables";

export interface TableMeta extends Omit<TableDef, "fields"> {
  fields: FieldDef[];
  /** `participant`: only the records the caller takes part in open (an approver without a role in the area): no lists */
  can: { read: true; create: boolean; participant?: true };
}

function metaOf(ctx: Ctx, def: TableDef, lists: Set<string>, participant = false, scope: readonly RequiredFor[] = []): TableMeta {
  const visible = access().visibleFields(ctx, def);
  const fields = def.fields.filter((f) => !visible || visible.has(f.name)).map((f) => (bindsRequirement(f, scope) ? { ...f, required: true } : f));
  for (const f of fields) if (typeof f.choices === "string") lists.add(f.choices);
  if (participant) return { ...def, fields, can: { read: true, create: false, participant: true } };
  // a table only the system writes (rowAccess.write NEVER: computed scores, logs) offers nobody else «… تازه» or import
  return { ...def, fields, can: { read: true, create: !def.virtual && (isSystemCtx(ctx) || (!isNever(def.rowAccess?.write) && access().canCreate(ctx, def, null))) } };
}

function choicesOf(schema: OrgSchema, lists: Set<string>): Record<string, Option[]> {
  return Object.fromEntries([...lists].sort().map((k) => [k, schema.choices(k)]));
}

/** Every table the caller may read. */
export async function tablesMeta(ctx: Ctx): Promise<{ tables: TableMeta[]; choices: Record<string, Option[]> }> {
  const schema = await orgSchema(ctx);
  const scope = await requirementScope(ctx);
  const lists = new Set<string>();
  const tables: TableMeta[] = [];
  const participations = access().participations ? await access().participations!(ctx, ctx.db) : new Set<string>();
  for (const base of [USER_DEF, ...physicalTables()]) {
    const def = schema.def(base.key)!;
    if (access().canReadTable(ctx, def)) tables.push(metaOf(ctx, def, lists, false, scope));
    else if (participations.has(def.key)) tables.push(metaOf(ctx, def, lists, true, scope));
  }
  return { tables, choices: choicesOf(schema, lists) };
}

/** One table (403 when the caller may not read it). */
export async function tableMeta(ctx: Ctx, key: string): Promise<{ table: TableMeta; choices: Record<string, Option[]> }> {
  const schema = await orgSchema(ctx);
  const def = tableDef(key) ? schema.def(key) : undefined;
  if (!def) throw notFound(`جدول «${key}» وجود ندارد`);
  const participant = !access().canReadTable(ctx, def);
  if (participant && !(await canOpenRecords(ctx, def))) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const lists = new Set<string>();
  const table = metaOf(ctx, def, lists, participant, await requirementScope(ctx));
  return { table, choices: choicesOf(schema, lists) };
}
