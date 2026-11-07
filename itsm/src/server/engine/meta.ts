// Table definitions for the UI (GET /api/o/:org/meta/tables): the registry as the caller's organisation sees it
// (custom fields, relabelled fields, its choice lists) and as the caller may use it (tables they may read, fields
// they may see, whether they may create).
import type { FieldDef, Option, TableDef } from "@shared/model/types";
import type { Ctx } from "../context";
import { forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { isSystemCtx } from "./env";
import { orgSchema, type OrgSchema } from "./schema";
import { physicalTables, tableDef, USER_DEF } from "@shared/tables";

export interface TableMeta extends Omit<TableDef, "fields"> {
  fields: FieldDef[];
  can: { read: true; create: boolean };
}

function metaOf(ctx: Ctx, def: TableDef, lists: Set<string>): TableMeta {
  const visible = access().visibleFields(ctx, def);
  const fields = def.fields.filter((f) => !visible || visible.has(f.name));
  for (const f of fields) if (typeof f.choices === "string") lists.add(f.choices);
  return { ...def, fields, can: { read: true, create: !def.virtual && (isSystemCtx(ctx) || access().canCreate(ctx, def, null)) } };
}

function choicesOf(schema: OrgSchema, lists: Set<string>): Record<string, Option[]> {
  return Object.fromEntries([...lists].sort().map((k) => [k, schema.choices(k)]));
}

/** Every table the caller may read. */
export async function tablesMeta(ctx: Ctx): Promise<{ tables: TableMeta[]; choices: Record<string, Option[]> }> {
  const schema = await orgSchema(ctx);
  const lists = new Set<string>();
  const tables: TableMeta[] = [];
  for (const base of [USER_DEF, ...physicalTables()]) {
    const def = schema.def(base.key)!;
    if (!access().canReadTable(ctx, def)) continue;
    tables.push(metaOf(ctx, def, lists));
  }
  return { tables, choices: choicesOf(schema, lists) };
}

/** One table (403 when the caller may not read it). */
export async function tableMeta(ctx: Ctx, key: string): Promise<{ table: TableMeta; choices: Record<string, Option[]> }> {
  const schema = await orgSchema(ctx);
  const def = tableDef(key) ? schema.def(key) : undefined;
  if (!def) throw notFound(`جدول «${key}» وجود ندارد`);
  if (!access().canReadTable(ctx, def)) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const lists = new Set<string>();
  const table = metaOf(ctx, def, lists);
  return { table, choices: choicesOf(schema, lists) };
}
