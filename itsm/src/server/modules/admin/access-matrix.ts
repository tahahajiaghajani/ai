// «ماتریس دسترسی» — who can see what, with explanations (catalogue ACC-089/091, ADM-001): for a member or a role, every
// table with its read / create / write / delete scopes and the fields it hides; for a record, who among the members
// reads it and why; for a member and a record, the access checker's layers told in plain Persian (the AI skill
// «admin.access_explain», with the rule-based text when no model answers). Everything is computed by the access model
// itself (subjects, grants, the same evaluator the SQL predicate is proven equal to) — nothing here decides access.
import type { Ctx } from "../../context";
import type { TableDef } from "@shared/model/types";
import { physicalTables, tableDef } from "@shared/tables";
import { areaLabel, combineRoles, grantIn, roleClosure, type FullGrant, type RoleDef } from "@shared/access";
import { explainAccessText } from "@shared/admin/explain";
import { isCustomSlot } from "@shared/admin/studio";
import { bad, notFound } from "../../http/errors";
import { checkAccess, explainAccess, listRoles, memberCtx, needAccessAdmin, needAccessView } from "../../access";
import { subjectOf } from "../../access/subject";
import { access } from "../../access/provider";
import { condEnv, orgSchema, requireReadable } from "../../engine";
import { liveRows, sysOf } from "./common";
import { isAiUnavailable, runSkill } from "../ai/skills/runtime";
import { AiUnavailableError } from "../ai/errors";
import { AI_CLOSED, aiChannelOpen } from "../ai/rag/registry";

export interface MatrixRow {
  table: string;
  label: string;
  plural: string;
  area: string;
  area_label: string;
  module: string;
  read: string;
  create: boolean;
  write: string;
  delete: string;
  approve: boolean;
  admin: boolean;
  hidden: string[];
}

/** The organisation's names of its custom tables (slot → name). */
async function customNames(ctx: Ctx): Promise<Map<string, { label: string; plural: string }>> {
  const rows = await liveRows(ctx.db, sysOf(ctx), "custom_table", null);
  return new Map(rows.map((r) => [String(r.slot), { label: String(r.label), plural: String(r.plural) }]));
}

function rowOf(def: TableDef, g: FullGrant, hidden: string[], names: Map<string, { label: string; plural: string }>): MatrixRow {
  const custom = isCustomSlot(def.key) ? names.get(def.key) : undefined;
  return {
    table: def.key,
    label: custom?.label ?? def.label,
    plural: custom?.plural ?? def.plural,
    area: String(def.area),
    area_label: areaLabel(String(def.area)),
    module: String(def.module ?? ""),
    read: g.read,
    create: g.create,
    write: g.write,
    delete: g.delete,
    approve: g.approve,
    admin: g.admin,
    hidden,
  };
}

/** Tables to show: every physical table but the custom slots this organisation does not use. */
function shown(def: TableDef, names: Map<string, unknown>): boolean {
  return !isCustomSlot(def.key) || names.has(def.key);
}

/** A member's matrix (users admin: the same right as the access checker). */
export async function memberMatrix(ctx: Ctx, userId: string) {
  await needAccessAdmin(ctx);
  const target = await memberCtx(ctx.cfg, ctx.org.id, userId);
  const schema = await orgSchema(target);
  const s = subjectOf(target);
  const names = await customNames(ctx);
  const rows: MatrixRow[] = [];
  for (const base of physicalTables()) {
    if (!shown(base, names)) continue;
    const def = schema.def(base.key)!;
    const visible = access().visibleFields(target, def);
    const hidden = visible ? def.fields.filter((f) => !visible.has(f.name)).map((f) => f.label) : [];
    rows.push(rowOf(def, grantIn(s.eff, String(def.area)), hidden, names));
  }
  return {
    user: { id: target.user.id, name: target.user.full_name || target.user.email },
    roles: s.eff.roles,
    legacy: s.eff.legacy,
    field_groups: s.eff.fieldGroups,
    rows,
  };
}

/** A role's matrix (its containment resolved), from the organisation's role catalogue. */
export async function roleMatrix(ctx: Ctx, key: string) {
  await needAccessView(ctx);
  const { roles } = await listRoles(ctx);
  const catalog = new Map<string, RoleDef>(roles.map((r) => [r.key, r]));
  const role = catalog.get(key);
  if (!role) throw notFound("نقش پیدا نشد");
  const closure = roleClosure([key], catalog);
  const eff = combineRoles(closure.map((k) => catalog.get(k)!).filter(Boolean));
  const schema = await orgSchema(ctx);
  const names = await customNames(ctx);
  const rows: MatrixRow[] = [];
  for (const base of physicalTables()) {
    if (!shown(base, names)) continue;
    const def = schema.def(base.key)!;
    const hidden = def.fields.filter((f) => f.group && !eff.fieldGroups.includes(f.group)).map((f) => f.label);
    rows.push(rowOf(def, grantIn(eff, String(def.area)), hidden, names));
  }
  return { role: { key: role.key, name: role.name, persona: role.persona }, contains: closure.filter((k) => k !== key), field_groups: eff.fieldGroups, rows };
}

/**
 * Who among the active members reads a record, and through what (own record, scope of a role, participant …). The caller
 * must be an access administrator who reads the record (like the access checker).
 */
export async function whoCanRead(ctx: Ctx, table: string, id: string) {
  await needAccessAdmin(ctx);
  const base = tableDef(table);
  if (!base || base.virtual) throw notFound(`جدول «${table}» وجود ندارد`);
  const schema = await orgSchema(ctx);
  const def = schema.def(table)!;
  const row = await requireReadable(ctx, def, id, await condEnv(ctx));
  const raw = await ctx.db.one<Record<string, unknown>>(`select * from ${def.table} where id = $1 and org_id = $2`, [String(row.id), ctx.org.id]);
  const members = await ctx.db.query<{ user_id: string; name: string }>(
    `select m.user_id, coalesce(nullif(u.full_name, ''), u.email) as name from sm_org_members m join sm_users u on u.id = m.user_id
     where m.org_id = $1 and m.deleted_at is null and m.is_active and not u.disabled order by name limit 500`,
    [ctx.org.id],
  );
  const readers: { user_id: string; name: string; via: string | null; write: string | null }[] = [];
  let others = 0;
  for (const m of members) {
    const target = await memberCtx(ctx.cfg, ctx.org.id, m.user_id).catch(() => null);
    if (!target) continue;
    const e = await explainAccess(target, def, raw!);
    if (e.read) readers.push({ user_id: m.user_id, name: m.name, via: e.via, write: e.write });
    else others++;
  }
  return { table, id: String(row.id), readers, others, truncated: members.length >= 500 };
}

/** Why a member can or cannot read a table / a record — the checker's facts and their Persian explanation. */
export async function explainFor(ctx: Ctx, input: { user_id: string; table: string; record_id?: string | null }) {
  const check = await checkAccess(ctx, input);
  const names = await customNames(ctx);
  const custom = isCustomSlot(check.table.key) ? names.get(check.table.key) : undefined;
  const { roles } = await listRoles(ctx);
  const roleName = new Map(roles.map((r) => [r.key, r.name]));
  const facts = {
    user: check.user,
    table: { label: custom?.label ?? check.table.label, plural: custom?.plural ?? check.table.plural },
    grant: check.grant,
    roles: check.roles.map((k) => roleName.get(k) ?? k),
    legacy: check.legacy,
    hidden_fields: check.hidden_fields,
    participant_only: check.can.participant_only,
    record: check.record ? { label: check.record.label, explanation: check.record.explanation, writable_fields: check.record.writable_fields } : undefined,
  };
  const rule = explainAccessText(facts);
  let text = rule;
  let ai = false;
  let model: string | null = null;
  try {
    // a record's label is that table's data: the explanation goes to a model only as its data-use policy allows (an HR
    // case «فقط محلی», a legal request «هرگز»), and never for a record closed to AI (a privileged legal request)
    if (check.record && !(await aiChannelOpen(ctx.db, ctx.org.id, check.table.key, check.record.id))) throw new AiUnavailableError("policy", AI_CLOSED);
    const r = await runSkill(ctx, "admin.access_explain", { params: { facts: JSON.stringify(facts) } }, { ephemeral: true, ...(check.record ? { dataTables: [check.table.key] } : {}) });
    if (r.text && !r.fallback) {
      text = r.text;
      ai = true;
      model = r.model ?? null;
    }
  } catch (e) {
    if (!isAiUnavailable(e) && !(e instanceof Error && /پیدا نشد|اجازه|forbidden/i.test(e.message))) throw e;
  }
  return { check, text, rule, ai, model };
}

/** A matrix as rows for a spreadsheet (the page's «خروجی اکسل»). */
export function matrixCells(rows: MatrixRow[]): (string | boolean)[][] {
  if (!rows.length) throw bad("سطری نیست");
  return rows.map((r) => [r.plural, r.area_label, r.read, r.create, r.write, r.delete, r.hidden.join("، ")]);
}
