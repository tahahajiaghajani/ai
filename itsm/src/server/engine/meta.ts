// Table definitions for the UI (GET /api/o/:org/meta/tables): the registry as the caller's organisation sees it
// (custom fields, relabelled fields, its choice lists) and as the caller may use it (tables they may read, fields
// they may see, whether they may create).
import { createHash } from "node:crypto";
import type { FieldDef, Option, TableDef } from "@shared/model/types";
import { isNever } from "@shared/model/conditions";
import type { Ctx } from "../context";
import { forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { isSystemCtx } from "./env";
import { orgSchema, type OrgSchema } from "./schema";
import { canOpenRecords } from "./read";
import { physicalTables, tableDef, USER_DEF } from "@shared/tables";

export interface TableMeta extends Omit<TableDef, "fields"> {
  fields: FieldDef[];
  /** `participant`: only the records the caller takes part in open (an approver without a role in the area): no lists */
  can: { read: true; create: boolean; participant?: true };
}

function metaOf(ctx: Ctx, def: TableDef, lists: Set<string>, participant = false): TableMeta {
  const visible = access().visibleFields(ctx, def);
  const fields = def.fields.filter((f) => !visible || visible.has(f.name));
  for (const f of fields) if (typeof f.choices === "string") lists.add(f.choices);
  if (participant) return { ...def, fields, can: { read: true, create: false, participant: true } };
  // a table only the system writes (rowAccess.write NEVER: computed scores, logs) offers nobody else «… تازه» or import
  return { ...def, fields, can: { read: true, create: !def.virtual && (isSystemCtx(ctx) || (!isNever(def.rowAccess?.write) && access().canCreate(ctx, def, null))) } };
}

function choicesOf(schema: OrgSchema, lists: Set<string>): Record<string, Option[]> {
  return Object.fromEntries([...lists].sort().map((k) => [k, schema.choices(k)]));
}

type TablesPayload = { tables: TableMeta[]; choices: Record<string, Option[]> };

/** Every table the caller may read. */
export async function tablesMeta(ctx: Ctx): Promise<TablesPayload> {
  const schema = await orgSchema(ctx);
  const participations = access().participations ? await access().participations!(ctx, ctx.db) : new Set<string>();
  return buildTablesMeta(ctx, schema, participations);
}

function buildTablesMeta(ctx: Ctx, schema: OrgSchema, participations: ReadonlySet<string>): TablesPayload {
  const lists = new Set<string>();
  const tables: TableMeta[] = [];
  for (const base of [USER_DEF, ...physicalTables()]) {
    const def = schema.def(base.key)!;
    if (access().canReadTable(ctx, def)) tables.push(metaOf(ctx, def, lists));
    else if (participations.has(def.key)) tables.push(metaOf(ctx, def, lists, true));
  }
  return { tables, choices: choicesOf(schema, lists) };
}

let registry: string | null = null;
/** The code's table definitions (one per build): part of the validator, so an upgraded server never confirms old ones. */
function registryStamp(): string {
  return (registry ??= createHash("sha256").update(JSON.stringify([USER_DEF, ...physicalTables()])).digest("base64url"));
}

/** Does an If-None-Match header name `tag` (weak comparison, a list or `*`)? */
function named(header: string, tag: string): boolean {
  const bare = (t: string) => t.trim().replace(/^W\//, "");
  return header.split(",").some((t) => t.trim() === "*" || bare(t) === bare(tag));
}

/**
 * GET /meta/tables with a validator: about 2 MB of definitions for an administrator, asked again on every page load
 * of the app. The tag is computed from what the answer is made of — the code's definitions, the organisation's
 * custom fields and choice lists (the schema's stamp), what the caller's access makes of them (the provider's
 * `accessStamp`) and the tables the caller takes part in — so an unchanged answer is confirmed (304) without being
 * built, compressed or sent. The tag also names the person, the session and a support session: a browser one person
 * filled (the Windows app's window after «خروج» and another sign-in, a shared computer) is never told that its
 * definitions still apply to someone else or to a later session, even where both would read the same answer.
 * No tag (the answer is built every time) when the provider cannot give a stamp.
 */
export async function tablesMetaAnswer(ctx: Ctx, ifNoneMatch?: string | null): Promise<{ tag: string | null; notModified: boolean; body?: TablesPayload }> {
  const schema = await orgSchema(ctx);
  const participations = access().participations ? await access().participations!(ctx, ctx.db) : new Set<string>();
  const stamp = access().accessStamp?.(ctx) ?? null;
  const who = [ctx.user.id, ctx.session?.id ?? "", ctx.support?.id ?? ""].join(",");
  const tag =
    stamp === null || isSystemCtx(ctx)
      ? null
      : `W/"m-${createHash("sha256").update([registryStamp(), ctx.org.id, schema.stamp, stamp, [...participations].sort().join(","), who].join("\n")).digest("base64url").slice(0, 32)}"`;
  if (tag && ifNoneMatch && named(ifNoneMatch, tag)) return { tag, notModified: true };
  return { tag, notModified: false, body: buildTablesMeta(ctx, schema, participations) };
}

/** One table (403 when the caller may not read it). */
export async function tableMeta(ctx: Ctx, key: string): Promise<{ table: TableMeta; choices: Record<string, Option[]> }> {
  const schema = await orgSchema(ctx);
  const def = tableDef(key) ? schema.def(key) : undefined;
  if (!def) throw notFound(`جدول «${key}» وجود ندارد`);
  const participant = !access().canReadTable(ctx, def);
  if (participant && !(await canOpenRecords(ctx, def))) throw forbidden(`به «${def.plural}» دسترسی ندارید`);
  const lists = new Set<string>();
  const table = metaOf(ctx, def, lists, participant);
  return { table, choices: choicesOf(schema, lists) };
}
