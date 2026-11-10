// Engine hooks of the access model (same transaction as the write, no network):
// - every table with requester fields: the record's `unit_id` / `domain_id` anchors come from the profile of the
//   person it is for (set on create, recomputed when that person changes); the assignment constraint (an agent
//   assigns only to groups of their workspaces) and the create-on-behalf rule (a caller who is only a requester in
//   the area files records for themselves or their reportees);
// - org_unit / location / group trees: parent cycles refused, materialised paths kept (descendants follow a move),
//   a node with live children is not deleted;
// - member_profile, group.roles and role: role keys must exist, definitions must be valid and cycle-free, and nobody
//   grants or defines access above their own (owners excepted) or changes their own roles;
// - workspace: one default.
// Scope epochs and the access version move by trigger (migration 0007_access), on every write path.
import type { Ctx } from "../context";
import type { Tx } from "../db";
import { bad, conflict, forbidden } from "../http/errors";
import { needRecentAuth } from "../auth/policy";
import { registerHooks, isSystemCtx, type WriteArgs } from "../engine";
import {
  combineRoles, exceeds, roleClosure, roleProblem, scopeColumns, composeEffective, grantIn, OP_LABELS, areaLabel,
  type RoleDef, type Op,
} from "@shared/access";
import { FIELD_GROUPS, type FieldGroup } from "@shared/model/types";
import { permissionMap, type Role as MembershipRole } from "@shared/permissions";
import type { Queryable } from "../db";
import type { Subject } from "@shared/access";
import { access } from "./provider";
import { itsmProvider } from "./itsm";
import { accessSettings, catalogOf, memberDomain, prepareSubject, snapshotFor, type Snapshot } from "./subject";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : Array.isArray(v) && typeof v[0] === "string" && UUID.test(v[0]) ? v[0].toLowerCase() : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** A Persian description of the first areas/operations in which `extra` (from `exceeds`) goes beyond the caller. */
export function describeExcess(extra: string[]): string {
  const one = (x: string) => {
    if (x.startsWith("field:")) return `گروه فیلد «${FIELD_GROUPS[x.slice(6) as FieldGroup] ?? x.slice(6)}»`;
    if (x === "workspaces:all") return "همهٔ فضاهای کاری";
    if (x === "domains:all") return "همهٔ دامنه‌ها";
    const [area, op] = x.split(".");
    return `«${OP_LABELS[op as Op] ?? op}» در «${areaLabel(area)}»`;
  };
  return extra.slice(0, 3).map(one).join("، ");
}

const isOwner = (ctx: Ctx) => ctx.member.role === "owner" && !ctx.support;

/**
 * The caller's subject when the ITSM model decides — null for the system and while another provider is installed
 * (tests' fakes): the hooks then keep the data consistent (anchors, paths, valid roles) but judge nobody.
 */
async function callerSubject(ctx: Ctx, q: Queryable): Promise<Subject | null> {
  if (isSystemCtx(ctx) || access() !== itsmProvider) return null;
  const s = (await prepareSubject(ctx, q)).subject;
  return s.kind === "user" ? s : null;
}

/** Role keys must exist; nobody hands out roles that reach beyond their own access (owners and the system excepted). */
export function checkGrantable(ctx: Ctx, snap: Snapshot, keys: string[], s: Subject | null): void {
  const catalog = catalogOf(snap, accessSettings(ctx.org));
  const unknown = keys.filter((k) => !catalog.has(k));
  if (unknown.length) throw bad(`نقش «${unknown[0]}» وجود ندارد`);
  if (!s || isOwner(ctx)) return;
  const wanted = combineRoles(roleClosure(keys, catalog).map((k) => catalog.get(k)!));
  const extra = exceeds(wanted, s.eff);
  if (extra.length) throw forbidden(`نمی‌توانید نقشی با دسترسی بیشتر از دسترسی خودتان بدهید: ${describeExcess(extra)}`);
}

async function anchors(w: WriteArgs, snap: Snapshot): Promise<void> {
  const { def, next } = w;
  const c = scopeColumns(def);
  if (c.unit !== "unit_id" && c.domain !== "domain_id") return;
  let person: string | null = null;
  for (const f of c.requester) {
    person = idOf(next[f.name]);
    if (person) break;
  }
  const profile = person ? snap.profiles.get(person) : undefined;
  const unit = profile?.org_unit_id && snap.units.has(profile.org_unit_id) ? profile.org_unit_id : null;
  if (c.unit === "unit_id") next.unit_id = unit;
  if (c.domain === "domain_id") next.domain_id = memberDomain(snap, profile);
}

async function nameOf(tx: Tx, userId: string): Promise<string | null> {
  const r = await tx.one<{ name: string }>(`select coalesce(nullif(full_name, ''), email) as name from sm_users where id = $1`, [userId]);
  return r?.name ?? null;
}

// ----- every table --------------------------------------------------------------------------------------------

async function everyTable(w: WriteArgs): Promise<void> {
  const { def, ctx, next, op, tx } = w;
  if (def.virtual || op === "delete") return;
  const c = scopeColumns(def);
  if (def.key === "member_profile" || !c.requester.length) return;
  const requesterChanged = op === "create" || c.requester.some((f) => w.changed.has(f.name));
  if (!requesterChanged && !(c.group && w.changed.has(c.group))) return;
  const snap = await snapshotFor(ctx, tx);
  if (requesterChanged) await anchors(w, snap);
  const s = await callerSubject(ctx, tx);
  if (!s) return;
  // assignment constraint: only groups of the caller's workspaces (unless their roles reach every workspace)
  if (c.group && w.changed.has(c.group) && next[c.group] && !s.eff.workspacesAll) {
    const g = snap.groups.get(String(next[c.group]));
    if (g?.workspace_id && !s.workspaces.includes(g.workspace_id)) {
      throw forbidden("این گروه در فضای کاری‌ای است که شما عضو آن نیستید؛ ارجاع به آن با کسی است که به آن فضای کاری دسترسی دارد");
    }
  }
  // create on behalf: a caller who is only a requester in this area files for themselves or their people
  if (op === "create") {
    const g = grantIn(s.eff, def.area);
    if (g.write === "none" || g.write === "own") {
      for (const f of c.requester) {
        const v = next[f.name];
        const people = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
        for (const p of people) {
          if (p === s.userId || s.reportees.includes(p)) continue;
          const unit = snap.profiles.get(p)?.org_unit_id;
          if (unit && s.managedTree.includes(unit)) continue;
          const label = def.fields.find((x) => x.name === f.name)?.label ?? f.name;
          throw forbidden(`«${label}» را فقط می‌توانید خودتان یا افراد زیر نظرتان بگذارید`);
        }
      }
    }
  }
}

// ----- trees --------------------------------------------------------------------------------------------------

/** Refuse a parent that is the node itself or one of its descendants. */
async function checkParent(w: WriteArgs, table: string, label: string): Promise<void> {
  const { next, tx, ctx } = w;
  const parent = idOf(next.parent_id);
  if (!parent) return;
  if (parent === String(next.id)) throw bad(`${label} نمی‌تواند زیرمجموعهٔ خودش باشد`);
  const loop = await tx.one(
    `with recursive up as (
       select id, parent_id, 1 as n from ${table} where id = $1 and org_id = $2
       union all
       select t.id, t.parent_id, up.n + 1 from ${table} t join up on t.id = up.parent_id where t.org_id = $2 and up.n < 200
     ) select 1 from up where id = $3 limit 1`,
    [parent, ctx.org.id, String(next.id)],
  );
  if (loop) throw bad(`${label} نمی‌تواند زیرمجموعهٔ یکی از زیرمجموعه‌های خودش باشد`);
}

async function refuseChildren(w: WriteArgs, table: string, label: string): Promise<void> {
  const child = await w.tx.one(`select 1 from ${table} where org_id = $1 and parent_id = $2 and deleted_at is null limit 1`, [w.ctx.org.id, String(w.prev!.id)]);
  if (child) throw conflict(`این ${label} زیرمجموعه دارد؛ ابتدا زیرمجموعه‌ها را جابه‌جا یا حذف کنید`);
}

function treeHooks(key: string, table: string, label: string, withPath: boolean) {
  registerHooks(key, {
    async beforeWrite(w) {
      if (w.op === "delete") return refuseChildren(w, table, label);
      if (w.op !== "create" && !w.changed.has("parent_id")) return;
      await checkParent(w, table, label);
      if (!withPath) return;
      const parent = idOf(w.next.parent_id);
      let prefix = "/";
      if (parent) {
        const p = await w.tx.one<{ path: string | null }>(`select path from ${table} where id = $1 and org_id = $2 and deleted_at is null`, [parent, w.ctx.org.id]);
        if (!p) throw bad(`${label} بالادستی پیدا نشد`);
        prefix = p.path ?? `/${parent}/`;
      }
      w.next.path = `${prefix}${w.next.id}/`;
      w.next.depth = String(w.next.path).split("/").filter(Boolean).length;
    },
    async afterWrite(w) {
      if (!withPath || w.op === "create" || w.op === "delete" || !w.prev) return;
      const before = String(w.prev.path ?? `/${w.prev.id}/`);
      const after = String(w.next.path ?? "");
      if (!after || before === after) return;
      // descendants follow the move (derived columns: no history, the row's version stays; the sync trigger
      // moves their revisions so every Windows app gets the new paths)
      const shift = after.split("/").filter(Boolean).length - before.split("/").filter(Boolean).length;
      await w.tx.query(
        `update ${table} set path = $3 || substr(path, length($2) + 1), depth = coalesce(depth, 0) + $4, updated_at = now()
         where org_id = $1 and left(path, length($2)) = $2 and id <> $5 and deleted_at is null`,
        [w.ctx.org.id, before, after, shift, String(w.next.id)],
      );
    },
  });
}

// ----- roles --------------------------------------------------------------------------------------------------

function roleFromRow(r: Record<string, unknown>): RoleDef {
  return {
    key: String(r.key ?? ""),
    name: String(r.name ?? ""),
    description: (r.description as string) ?? undefined,
    persona: (r.persona as RoleDef["persona"]) ?? "agent",
    grants: r.grants && typeof r.grants === "object" && !Array.isArray(r.grants) ? (r.grants as RoleDef["grants"]) : {},
    field_groups: strings(r.field_groups) as FieldGroup[],
    contains: strings(r.contains),
    workspaces: r.workspaces === "all" ? "all" : "member",
    domains: r.domains === "all" ? "all" : "own",
    active: r.active !== false,
  };
}

/**
 * Changing who holds which access is sensitive administration: a person's session must have proven who they are
 * recently (the organisation's re-authentication minutes), on every path — the access routes, the generic record
 * API, a Windows app's push. Server code (system contexts, trusted writes, sessionless contexts) is not asked.
 */
function needRecentProof(w: WriteArgs): void {
  if (isSystemCtx(w.ctx) || w.trusted) return;
  needRecentAuth(w.ctx);
}

async function roleHook(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, prev, op } = w;
  needRecentProof(w);
  const s = isOwner(ctx) ? null : await callerSubject(ctx, tx);
  if (op === "delete") {
    if (s) checkDefinable(s, roleFromRow(prev!), "remove");
    return;
  }
  if (prev && String(prev.key) !== String(next.key)) throw bad("کلید نقش پس از ساخت تغییر نمی‌کند");
  // contained roles must exist in the catalogue before the change and must not lead back to this role
  const catalog = catalogOf(await snapshotFor(ctx, tx, true), accessSettings(ctx.org));
  const role = roleFromRow(next);
  const problem = roleProblem(role, catalog);
  if (problem) throw bad(problem);
  if (s) checkDefinable(s, role, "define");
}

/** A role definition (with what it contains) may not reach beyond the caller's own access. */
function checkDefinable(s: Subject, role: RoleDef, what: "define" | "remove"): void {
  const wanted = combineRoles([role]);
  const extra = exceeds(wanted, s.eff);
  if (extra.length) {
    throw forbidden(
      what === "define"
        ? `نمی‌توانید نقشی با دسترسی بیشتر از دسترسی خودتان تعریف کنید: ${describeExcess(extra)}`
        : `این نقش دسترسی‌ای بیشتر از دسترسی شما دارد (${describeExcess(extra)})؛ تغییر آن با مالک است`,
    );
  }
}

async function profileHook(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, prev, op } = w;
  if (op === "delete") return;
  if (op === "create" || !next.name) next.name = (await nameOf(tx, String(next.user_id))) ?? next.name ?? null;
  const snap = await snapshotFor(ctx, tx);
  // the profile's own anchors: the member's unit and domain
  next.unit_id = idOf(next.org_unit_id);
  next.domain_id = memberDomain(snap, {
    user_id: String(next.user_id),
    org_unit_id: idOf(next.org_unit_id),
    domain_unit_id: idOf(next.domain_unit_id),
  } as never);
  if (idOf(next.delegate_id) && idOf(next.delegate_id) === idOf(next.user_id)) throw bad("جانشین هر کس باید فرد دیگری باشد");
  if (idOf(next.manager_id) && idOf(next.manager_id) === idOf(next.user_id)) throw bad("مدیر مستقیم هر کس باید فرد دیگری باشد");
  const s = isOwner(ctx) ? null : await callerSubject(ctx, tx);
  const self = String(next.user_id) === ctx.user.id;
  if (s) {
    // nobody widens their own reach through a profile: their own workspaces, unit or domain, or someone else's delegate
    const touched = (f: string) => (op === "create" ? !!next[f] && !(Array.isArray(next[f]) && !(next[f] as unknown[]).length) : w.changed.has(f));
    if (self && ["workspaces", "org_unit_id", "domain_unit_id"].some(touched)) throw forbidden("فضاهای کاری، واحد و دامنهٔ خودتان را نمی‌توانید تغییر دهید؛ این کار با مالک یا مدیر دیگری است");
    if (!self && touched("delegate_id") && idOf(next.delegate_id) === ctx.user.id) throw forbidden("خودتان را جانشین عضو دیگری نکنید؛ جانشین را خود او یا مدیر دیگری می‌گذارد");
  }
  const rolesChanged = op === "create" ? strings(next.roles).length > 0 : w.changed.has("roles");
  if (rolesChanged || (op === "create" ? strings(next.workspaces).length > 0 || !!next.persona : w.changed.has("workspaces") || w.changed.has("persona"))) needRecentProof(w);
  if (!rolesChanged) return;
  const roles = [...new Set(strings(next.roles))];
  next.roles = roles;
  checkGrantable(ctx, snap, roles, s);
  if (!s) return;
  if (self) throw forbidden("نقش‌های خودتان را نمی‌توانید تغییر دهید؛ این کار با مالک یا مدیر دیگری است");
  // nobody changes the roles of a member who has more access than they do
  if (prev) {
    const catalog = catalogOf(snap, accessSettings(ctx.org));
    const target = await tx.one<{ role: MembershipRole; overrides: Record<string, unknown> | null }>(
      `select role, overrides from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`,
      [ctx.org.id, String(next.user_id)],
    );
    const theirs = composeEffective({ role: target?.role ?? "viewer", levels: permissionMap(target?.role ?? "viewer", target?.overrides as never), explicit: strings(prev.roles), catalog });
    const above = exceeds(theirs, s.eff);
    if (above.length && !theirs.legacy) throw forbidden(`دسترسی این عضو از شما بیشتر است (${describeExcess(above)})؛ تغییر نقش‌های او با مالک است`);
  }
}

async function groupHook(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, op } = w;
  if (op === "delete") return;
  if (op === "create" ? strings(next.roles).length > 0 : w.changed.has("roles")) {
    needRecentProof(w);
    next.roles = [...new Set(strings(next.roles))];
    const s = isOwner(ctx) ? null : await callerSubject(ctx, tx);
    checkGrantable(ctx, await snapshotFor(ctx, tx, true), strings(next.roles), s);
  }
}

/**
 * Nobody but an owner admits themselves to a restricted group or a group of a secure workspace, or makes themselves a
 * group's lead: membership of those is given by someone else (a lead, an administrator).
 */
async function membershipHook(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, prev, op } = w;
  // joining or leaving a group that grants roles or a workspace grants or takes access: a recent proof of identity
  if (!isSystemCtx(ctx) && !w.trusted && (op === "create" || op === "delete" || ["user_id", "group_id"].some((f) => w.changed.has(f)))) {
    const ids = [...new Set([next?.group_id, prev?.group_id].filter(Boolean).map(String))].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const granting = ids.length
      ? await tx.one(
          `select 1 from sm_groups where org_id = $1 and id = any($2::uuid[]) and deleted_at is null
             and (workspace_id is not null or jsonb_array_length(coalesce(case when jsonb_typeof(roles) = 'array' then roles end, '[]'::jsonb)) > 0) limit 1`,
          [ctx.org.id, `{${ids.join(",")}}`],
        )
      : null;
    if (granting) needRecentProof(w);
  }
  if (op === "delete" || isOwner(ctx) || String(next.user_id) !== ctx.user.id) return;
  if (op !== "create" && !["user_id", "group_id", "kind"].some((f) => w.changed.has(f))) return;
  const s = await callerSubject(ctx, tx);
  if (!s) return;
  const snap = await snapshotFor(ctx, tx);
  const g = snap.groups.get(String(next.group_id));
  const secure = !!g?.workspace_id && !!snap.workspaces.get(g.workspace_id)?.secure;
  const joining = op === "create" || w.changed.has("group_id") || w.changed.has("user_id");
  if (joining && (g?.restricted || secure)) throw forbidden("عضویت خودتان در گروه محدود یا گروه فضای کاری امن را سرپرست آن یا مالک می‌دهد");
  if (next.kind === "lead" && (joining || prev?.kind !== "lead")) throw forbidden("خودتان را سرپرست گروه نکنید؛ این کار با سرپرست دیگر یا مدیر سامانه است");
}

async function workspaceHook(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, op } = w;
  if (op === "delete" || next.is_default !== true || (op !== "create" && !w.changed.has("is_default"))) return;
  // one default workspace: the others give it up (a derived flag, as the engine's own stamps)
  await tx.query(`update sm_workspaces set is_default = false, updated_at = now() where org_id = $1 and id <> $2 and is_default and deleted_at is null`, [ctx.org.id, String(next.id)]);
}

let installed = false;

/** Register the hooks (once per process). */
export function installAccessHooks(): void {
  if (installed) return;
  installed = true;
  registerHooks("*", { beforeWrite: everyTable });
  treeHooks("org_unit", "sm_org_units", "واحد", true);
  treeHooks("location", "sm_locations", "مکان", true);
  treeHooks("group", "sm_groups", "گروه", false);
  registerHooks("group", { beforeWrite: groupHook });
  registerHooks("role", { beforeWrite: roleHook });
  registerHooks("member_profile", { beforeWrite: profileHook });
  registerHooks("group_member", { beforeWrite: membershipHook });
  registerHooks("workspace", { afterWrite: workspaceHook });
}
