// Typed links between any two records (sm_links), e.g. an incident «ناشی از» a problem — shown on the problem as
// «علت». A link is stored once (from → to) and listed on both records with the label of its direction
// (LINK_KINDS, src/shared/model/links.ts; modules add kinds with registerLinkKind). Only records the caller may
// read take part: adding needs write access to the record the link is added from and read access to the other;
// lists leave out links whose other record the caller may not read. Adding and removing emit `record.linked` /
// `record.unlinked` on both records (in the same transaction: `addLinkIn` / `removeLinkIn` inside a module's write),
// so counters like «رخدادهای ناشی از این تغییر» follow at once.
import { LINK_KINDS } from "@shared/model/links";
import type { TableDef } from "@shared/model/types";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "../context";
import { pgArray, type Queryable, type Tx } from "../db";
import { bad, conflict, forbidden, notFound } from "../http/errors";
import { access } from "../access/provider";
import { actorId, condEnv, isSystemCtx } from "./env";
import { defFor, type OrgSchema } from "./schema";
import { fieldExpr, readable } from "./sql";
import { labelOf } from "./display";
import { requireReadable, type Row } from "./read";
import { emitEvent } from "./events";

export interface LinkView {
  id: string;
  kind: string;
  /** "out": this record → other; "in": other → this record */
  direction: "out" | "in";
  /** the relation as read from this record («ناشی از», «علت»…) */
  label: string;
  other: { table: string; id: string; number: string | null; display: string; state: string | null; state_label: string | null };
  note: string | null;
  created_at: string;
  created_by: string | null;
}

/** Symmetric kinds are stored once whichever record they were added from. */
const symmetric = (kind: string) => LINK_KINDS[kind]?.in === LINK_KINDS[kind]?.out;

function needLinks(def: TableDef) {
  if (!def.features?.links) throw bad(`«${def.plural}» پیوند ندارد`);
}

export interface LinkInput {
  kind: string;
  table: string;
  id: string;
  note?: string | null;
}

/** A stored link as the events carry it. */
interface LinkRow {
  id: string;
  kind: string;
  from_table: string;
  from_id: string;
  to_table: string;
  to_id: string;
}

/**
 * `record.linked` / `record.unlinked` on both records of a link: `data: { link_id, kind, direction, other_table,
 * other_id }` — `direction` "out" on the record the link goes from, "in" on the other one.
 */
export async function emitLinkEvents(q: Queryable, ctx: Ctx, kind: "record.linked" | "record.unlinked", link: LinkRow, via?: "api" | "sync"): Promise<void> {
  const sides: [string, string, "out" | "in", string, string][] = [
    [link.from_table, link.from_id, "out", link.to_table, link.to_id],
    [link.to_table, link.to_id, "in", link.from_table, link.from_id],
  ];
  for (const [table, id, direction, otherTable, otherId] of sides) {
    await emitEvent(q, ctx, { kind, table, id, ...(via ? { via } : {}), data: { link_id: link.id, kind: link.kind, direction, other_table: otherTable, other_id: otherId } });
  }
}

/** Link record `id` of `table` to another record. */
export async function addLink(ctx: Ctx, table: string, id: string, input: LinkInput): Promise<LinkView> {
  const linkId = await ctx.write((tx) => addLinkIn(tx, ctx, table, id, input));
  const { links } = await listLinks(ctx, table, id);
  return links.find((l) => l.id === linkId)!;
}

/**
 * `addLink` inside the caller's write transaction (a module linking the record it creates to its source); the same
 * checks — write access to the record the link is added from, read access to the other, no duplicates. Returns the
 * link's id; `record.linked` is emitted on both records.
 */
export async function addLinkIn(tx: Tx, ctx: Ctx, table: string, id: string, input: LinkInput): Promise<string> {
  const { def, schema } = await defFor(ctx, table, tx);
  needLinks(def);
  if (!LINK_KINDS[input.kind]) throw bad("نوع پیوند معتبر نیست");
  const other = schema.def(input.table);
  if (!other || other.virtual) throw bad(`جدول «${input.table}» وجود ندارد`);
  if (input.id === id) throw bad("رکورد را نمی‌توان به خودش پیوند داد");
  const note = input.note ? String(input.note).trim().slice(0, 500) || null : null;
  const env = await condEnv(ctx);
  const from = await requireReadable(ctx, def, id, env, tx);
  if (!isSystemCtx(ctx) && (!access().canWrite(ctx, def, from) || from.$writable === false)) throw forbidden(`اجازهٔ تغییر این ${def.label} را ندارید`);
  await requireReadable(ctx, other, input.id, env, tx);
  const params = [ctx.org.id, input.kind, id, input.id];
  const dup = await tx.one(
    `select 1 from sm_links where org_id = $1 and kind = $2 and deleted_at is null and ((from_id = $3 and to_id = $4)${symmetric(input.kind) ? " or (from_id = $4 and to_id = $3)" : ""})`,
    params,
  );
  if (dup) throw conflict("این پیوند از پیش وجود دارد");
  const lid = uuidv7();
  await tx.query(
    `insert into sm_links (id, org_id, kind, from_table, from_id, to_table, to_id, note, created_by, origin) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [lid, ctx.org.id, input.kind, def.key, id, other.key, input.id, note, actorId(ctx), ctx.cfg.origin ?? null],
  );
  await emitLinkEvents(tx, ctx, "record.linked", { id: lid, kind: input.kind, from_table: def.key, from_id: id, to_table: other.key, to_id: input.id });
  return lid;
}

/** Remove a link of record `id` (write access to the record is needed). */
export async function removeLink(ctx: Ctx, table: string, id: string, linkId: string): Promise<{ ok: true }> {
  await ctx.write((tx) => removeLinkIn(tx, ctx, table, id, linkId));
  return { ok: true };
}

/** `removeLink` inside the caller's write transaction; `record.unlinked` is emitted on both records. */
export async function removeLinkIn(tx: Tx, ctx: Ctx, table: string, id: string, linkId: string): Promise<void> {
  const { def } = await defFor(ctx, table, tx);
  needLinks(def);
  const env = await condEnv(ctx);
  const row = await requireReadable(ctx, def, id, env, tx);
  if (!isSystemCtx(ctx) && (!access().canWrite(ctx, def, row) || row.$writable === false)) throw forbidden(`اجازهٔ تغییر این ${def.label} را ندارید`);
  const done = await tx.one<LinkRow>(
    `update sm_links set deleted_at = now(), updated_at = now() where id = $1 and org_id = $2 and (from_id = $3 or to_id = $3) and deleted_at is null
     returning id, kind, from_table, from_id, to_table, to_id`,
    [linkId, ctx.org.id, id],
  );
  if (!done) throw notFound("پیوند پیدا نشد");
  await emitLinkEvents(tx, ctx, "record.unlinked", done);
}

/** Links of a record whose other side the caller may read. */
export async function listLinks(ctx: Ctx, table: string, id: string): Promise<{ links: LinkView[] }> {
  const { def, schema } = await defFor(ctx, table);
  needLinks(def);
  const env = await condEnv(ctx);
  await requireReadable(ctx, def, id, env);
  const rows = await ctx.db.query<Row>(
    `select * from sm_links where org_id = $1 and (from_id = $2 or to_id = $2) and deleted_at is null order by created_at, id`,
    [ctx.org.id, id],
  );
  const wanted = new Map<string, Set<string>>();
  for (const r of rows) {
    const out = r.from_id === id;
    const t = out ? r.to_table : r.from_table;
    const oid = out ? r.to_id : r.from_id;
    wanted.set(t, (wanted.get(t) ?? new Set()).add(oid));
  }
  const others = new Map<string, LinkView["other"]>();
  for (const [key, ids] of wanted) {
    const t = schema.def(key);
    if (!t || t.virtual || !access().canReadTable(ctx, t)) continue;
    for (const o of await readOthers(ctx, t, schema, [...ids], env)) others.set(`${key}:${o.id}`, o);
  }
  const links: LinkView[] = [];
  for (const r of rows) {
    const out = r.from_id === id;
    const other = others.get(out ? `${r.to_table}:${r.to_id}` : `${r.from_table}:${r.from_id}`);
    if (!other) continue;
    const kind = LINK_KINDS[r.kind] ?? { out: r.kind, in: r.kind };
    links.push({ id: r.id, kind: r.kind, direction: out ? "out" : "in", label: out ? kind.out : kind.in, other, note: r.note ?? null, created_at: r.created_at, created_by: r.created_by ?? null });
  }
  return { links };
}

async function readOthers(ctx: Ctx, def: TableDef, schema: OrgSchema, ids: string[], env: Awaited<ReturnType<typeof condEnv>>): Promise<LinkView["other"][]> {
  const params: unknown[] = [pgArray(ids)];
  const where = readable(ctx, def, "t", params, env);
  const visible = access().visibleFields(ctx, def);
  const df = def.fields.find((f) => f.name === def.display);
  const cols = ["t.id"];
  if (def.numbered) cols.push("t.number");
  if (df && df.type !== "secret" && (!visible || visible.has(df.name))) cols.push(`${fieldExpr(def, df, "t")} as d`);
  const stateField = def.states?.field;
  if (stateField && (!visible || visible.has(stateField))) cols.push(`t.${stateField} as s`);
  const rows = await ctx.db.query<Row>(`select ${cols.join(", ")} from ${def.table} t where t.id = any($1::uuid[]) and ${where}`, params);
  return rows.map((r) => ({
    table: def.key,
    id: r.id,
    number: r.number ?? null,
    display: df && r.d !== undefined ? labelOf(df, r.d, schema) : r.number ?? "",
    state: r.s ?? null,
    state_label: r.s ? def.states?.states.find((s) => s.value === r.s)?.label ?? r.s : null,
  }));
}
