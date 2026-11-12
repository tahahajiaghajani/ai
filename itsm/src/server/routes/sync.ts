// /api/sync — the cloud side of desktop synchronisation.
//
// push: the desktop sends aggregates it changed (with the revision it last saw). Each one is
//       applied in one write transaction; when the cloud copy changed since (another revision) and
//       is newer, the cloud wins ("conflict") and the desktop receives it with the next pull.
// pull: everything of the organisation written after the desktop's cursor — a snapshot, not a
//       number: revisions are transaction ids, in no particular order (src/server/sync/snapshot.ts) —
//       a page at a time in (revision, id) order.
// Record engine rows are checked and filtered by the engine (src/server/engine/sync.ts): pushes by the access
// provider and the engine's values, pulls by what the linked account may read — rows it may no longer read go out
// as tombstones, and a member whose scope epoch moved is told to read everything again (`reset`).
import { z } from "zod";
import { router, body, requireUser, type C } from "../http/hono";
import { guardOrgSession } from "../auth/policy";
import { bad, forbidden, notFound } from "../http/errors";
import { makeCtx, lockOrg, type MemberRow, type OrgRow, type Ctx } from "../context";
import { isTransientDbError, pgArray, type Tx } from "../db";
import { AGGREGATES, BY_ENTITY, comparePush, setPushBatch, type AggregateDef, type WireAggregate } from "../sync/registry";
import { readAggregates, writeAggregate } from "../sync/apply";
import { ident } from "../db/sql";
import { orgStatus, statusError } from "../modules/platform/org-admin";
import { CREATED_HERE_SQL, lockActiveOwners, memberChangeProblem, OWNER_ONLY_MESSAGE, sameGrant, type MemberGrant } from "../modules/platform/members";
import { requestMeta, securityEvent, type SecurityEventInput } from "../modules/platform/security";
import type { Area, Level, Role } from "@shared/permissions";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { inDemoScope } from "../db/scope";
import { demoSignInRefusal } from "../modules/demo/signin";
import { afterEnginePush, checkEnginePush, replicaRows, scopeEpoch } from "../engine/sync";
import { condEnv, orgSchema } from "../engine";
import {
  afterSql, afterText, checkXidRegression, compareKey, currentSnap, deltaSql, orgSyncState, parseAfter, parseSnap, snapText, visibleIn,
  type After,
} from "../sync/snapshot";

type StoredMember = MemberGrant & { is_active: boolean; deleted_at: string | null };

/** jsonb from a pushed row: an object (or its JSON text); anything else is no overrides */
function jsonObject(v: unknown): Partial<Record<Area, Level>> {
  let o = v;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch {
      return {};
    }
  }
  return o && typeof o === "object" && !Array.isArray(o) ? (o as Partial<Record<Area, Level>>) : {};
}

/**
 * Rules a module applies to an aggregate a Windows app pushes (the same ones its routes apply), keyed by
 * entity: a Persian refusal, or null to write it. `existing` is the stored copy's head (null for a new one).
 */
export const pushRules = new Map<string, (tx: Tx, ctx: Ctx, agg: WireAggregate, existing: { org_id: string; rev: number; updated_at: string } | null) => Promise<string | null>>();

export const syncRoutes = router();
syncRoutes.use("*", requireUser);

/** Rows per pull page (all synced tables and accounts together). */
export const PULL_PAGE = 1000;
/** Tables read by one statement of a pull page (each holds its tables' locks only while it runs). */
const SOURCES_PER_STATEMENT = 24;

async function orgCtx(c: C, orgId: string): Promise<Ctx> {
  const cfg = c.get("cfg");
  const user = c.get("user");
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw bad("شناسه‌ی سازمان معتبر نیست");
  const org = await cfg.db.one<OrgRow>(`select * from sm_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("سازمان در فضای ابری پیدا نشد");
  const member = await cfg.db.one<MemberRow>(
    `select id, org_id, user_id, role, overrides, is_active from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null`,
    [orgId, user.id],
  );
  if (!member || !member.is_active) throw forbidden("شما عضو این سازمان نیستید");
  guardOrgSession(org, c.get("session"), user, member, cfg.mode);
  // a demo account reaches the organisation only while its administrators allow demo sign-in (docs/DEMO_FA.md)
  const demoRefused = await demoSignInRefusal(cfg.db, user, orgId);
  if (demoRefused) throw forbidden(demoRefused);
  const status = await orgStatus(cfg.db, orgId);
  if (status.status === "suspended") throw statusError(status);
  return makeCtx(cfg, user, org, member, { status });
}

syncRoutes.get("/status", async (c) => {
  const ctx = await orgCtx(c, c.req.query("org_id") ?? "");
  return c.json({ protocol: SYNC_PROTOCOL, head: snapText(await currentSnap(ctx.db)), server_time: new Date().toISOString() });
});

syncRoutes.post("/register", async (c) => {
  const input = await body(c, z.object({ org_id: z.string(), device_id: z.string().uuid().optional(), name: z.string().max(120), platform: z.string().max(40).optional(), app_version: z.string().max(40).optional() }));
  const ctx = await orgCtx(c, input.org_id);
  // A device id is no secret (it rides along as the origin of synced rows): an id registered by
  // another account or for another organisation gets a fresh one instead of taking that record over.
  const save = (id: string) =>
    ctx.db.one<{ id: string }>(
      `insert into sm_devices (id, org_id, user_id, name, platform, app_version) values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set name = excluded.name, platform = excluded.platform, app_version = excluded.app_version, revoked_at = null
       where sm_devices.org_id = excluded.org_id and sm_devices.user_id = excluded.user_id
       returning id`,
      [id, ctx.org.id, ctx.user.id, input.name, input.platform ?? null, input.app_version ?? null],
    );
  const row = (input.device_id ? await save(input.device_id) : null) ?? (await save(uuidv7()));
  return c.json({ device_id: row!.id, protocol: SYNC_PROTOCOL });
});

/** Create the organisation in the cloud from a desktop that worked alone so far ("upload"). */
syncRoutes.post("/adopt", async (c) => {
  const cfg = c.get("cfg");
  const user = c.get("user");
  const input = await body(c, z.object({ org: z.record(z.string(), z.unknown()) }));
  const orgId = String(input.org.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw bad("شناسه‌ی سازمان معتبر نیست");
  const exists = await cfg.db.one<{ id: string }>(`select id from sm_orgs where id = $1`, [orgId]);
  if (exists) {
    const m = await cfg.db.one(`select 1 from sm_org_members where org_id = $1 and user_id = $2 and deleted_at is null and role in ('owner','admin')`, [orgId, user.id]);
    if (!m) throw forbidden("این سازمان در فضای ابری متعلق به حساب دیگری است");
    return c.json({ ok: true, existed: true });
  }
  await cfg.db.tx(async (tx) => {
    await lockOrg(tx, orgId);
    await tx.query("set local itsm.applying = 'on'");
    const def = BY_ENTITY.get("org")!;
    await writeAggregate(tx, def, { entity: "org", id: orgId, base_rev: 0, row: { ...input.org, created_by: user.id }, children: {} }, orgId, "incoming-yields");
    await tx.query(`insert into sm_org_members (id, org_id, user_id, role, origin) values ($1, $2, $3, 'owner', 'cloud') on conflict (org_id, user_id) do nothing`, [uuidv7(), orgId, user.id]);
  });
  return c.json({ ok: true, existed: false });
});

const pushSchema = z.object({
  org_id: z.string(),
  device_id: z.string().uuid(),
  protocol: z.number().int(),
  aggregates: z.array(z.object({
    entity: z.string(),
    id: z.string().uuid(),
    base_rev: z.number().int().min(0),
    row: z.record(z.string(), z.unknown()),
    children: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
  })).max(500),
});

/**
 * A Windows app of another sync protocol is told to update — on push and on pull alike, before anything is read or
 * written. Protocol 16 changed the pull's wire format (snapshot cursors): a 1.1.0-beta app (protocol 15, which sends no
 * protocol with its pulls and numeric cursors) would misread its pages, so it gets this answer instead of any page.
 */
const OUTDATED = "نسخه‌ی برنامه‌ی ویندوز با سرور هم‌خوان نیست؛ برنامه را به‌روز کنید";

syncRoutes.post("/push", async (c) => {
  const input = await body(c, pushSchema);
  if (input.protocol !== SYNC_PROTOCOL) throw bad(OUTDATED);
  const ctx = await orgCtx(c, input.org_id);
  // a demo person's push is demo work (docs/DEMO_FA.md): recorded with the pack and removed with it
  if (ctx.user.prefs?.demo_org === ctx.org.id) return inDemoScope(ctx.org.id, () => pushAs(c, input, ctx));
  return pushAs(c, input, ctx);
});

async function pushAs(c: C, input: z.infer<typeof pushSchema>, ctx: Ctx) {
  const results: { entity: string; id: string; status: "ok" | "conflict" | "error" | "skipped"; rev?: number; message?: string; renumbered?: unknown; aggregate?: WireAggregate }[] = [];
  // apply order, then the modules' own (a ledger after the record it traces, in its own sequence): a Windows app sends its
  // outbox in whatever order it reads it; a module judging a row may look at the push's other rows (setPushBatch)
  const list = [...input.aggregates].sort(comparePush);
  setPushBatch(ctx, list);
  // privilege changes made on a Windows app are security events, as on the members page
  const memberEvents: { kind: string; user_id: string; data: Record<string, unknown> }[] = [];
  const memberEvent = (was: StoredMember | null, next: MemberGrant & { live: boolean }) => {
    const changes: Record<string, unknown> = {};
    if (!was || was.deleted_at) return { kind: "member_added", user_id: next.user_id, data: { role: next.role, via: "sync" } };
    if (was.role !== next.role) changes.role = [was.role, next.role];
    if (!sameGrant({ ...was, role: next.role }, next)) changes.overrides = [was.overrides ?? {}, next.overrides ?? {}];
    if (was.is_active !== next.live) changes.is_active = [was.is_active, next.live];
    return { kind: "member_changed", user_id: next.user_id, data: { changes, via: "sync" } };
  };
  await ctx.write(async (tx) => {
    await tx.query("set local itsm.applying = 'on'");
    for (const agg of list as WireAggregate[]) {
      const def = BY_ENTITY.get(agg.entity);
      if (!def) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: "نوع داده‌ی ناشناخته" });
        continue;
      }
      // engine rows are judged by the access provider (checkEnginePush), not by an area level
      const need = def.engine ? true : def.entity === "org" ? ctx.can("settings", "full") : def.entity === "member" ? ctx.can("users", "edit") : ctx.can(def.area, "edit");
      if (!need) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: "دسترسی ویرایش این بخش را ندارید" });
        continue;
      }
      if (def.entity === "org" ? agg.id !== ctx.org.id : agg.row.org_id != null && agg.row.org_id !== ctx.org.id) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: "سازمان نامعتبر" });
        continue;
      }
      if (def.entity === "member") {
        const u = await tx.one(`select 1 from sm_users where id = $1`, [agg.row.user_id]);
        if (!u) {
          results.push({ entity: agg.entity, id: agg.id, status: "skipped", message: "کاربر محلی در فضای ابری حساب ندارد" });
          continue;
        }
      }
      // locked until the push commits (the upsert below locks it anyway, this only takes the lock earlier): a web write of
      // the same row in flight finishes first, so the stale check, the module's rules and the write all judge the
      // version this push replaces — never a copy that a concurrent write is about to change (lost as «ok»)
      const existing = await tx.one<{ org_id: string; rev: number; updated_at: string }>(`select org_id, rev, updated_at from ${ident(def.table)} where id = $1 for update`, [agg.id]);
      if (existing && existing.org_id !== ctx.org.id) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: "شناسه متعلق به سازمان دیگری است" });
        continue;
      }
      // changed since the Windows app read it: another revision (transaction ids are not in commit order, so a
      // newer copy may carry a smaller one — only equality says "unchanged")
      if (existing && Number(existing.rev) !== Number(agg.base_rev) && new Date(existing.updated_at).getTime() > new Date(String(agg.row.updated_at ?? 0)).getTime()) {
        // the cloud copy wins; hand it back, since the desktop may already have pulled past it.
        // Checked before the members' rules: an outdated row is not written, so it is not judged
        // either (refusing it would leave the desktop with its outdated copy for good). An engine
        // row goes back exactly as a pull would send it to this account — and a row it may not
        // read is not handed back at all
        if (def.engine) {
          const stored = await tx.query<Record<string, unknown>>(`select * from ${ident(def.table)} where id = $1 and org_id = $2`, [agg.id, ctx.org.id]);
          const seen = await replicaRows(tx, ctx, def, stored);
          if (!seen.aggregates.length) {
            results.push({ entity: agg.entity, id: agg.id, status: "skipped", message: "این مورد در دسترس شما نیست" });
            continue;
          }
          results.push({ entity: agg.entity, id: agg.id, status: "conflict", rev: existing.rev, aggregate: seen.aggregates[0] });
          continue;
        }
        const [winner] = await readAggregates(tx, def, [agg.id]);
        results.push({ entity: agg.entity, id: agg.id, status: "conflict", rev: existing.rev, aggregate: winner });
        continue;
      }
      // a module's own rules for a pushed aggregate (the same rules its routes apply); the engine's for its rows
      const engineState: { prev?: Record<string, unknown> | null } = {};
      const ruled = def.engine ? await checkEnginePush(tx, ctx, def, agg, engineState) : await pushRules.get(def.entity)?.(tx, ctx, agg, existing);
      if (ruled) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: ruled });
        continue;
      }
      let memberChange: { was: StoredMember | null; next: MemberGrant & { live: boolean } } | null = null;
      if (def.entity === "member") {
        // the members page's rules (routes/org.ts): owners only by owners, nobody changes themselves
        // or grants above their own access, and the organisation keeps an active owner
        const was = existing
          ? await tx.one<StoredMember>(`select user_id, role, overrides, is_active, deleted_at from sm_org_members where id = $1`, [agg.id])
          : null;
        const next = {
          user_id: String(agg.row.user_id ?? ""),
          role: String(agg.row.role ?? "viewer") as Role,
          overrides: jsonObject(agg.row.overrides),
          live: agg.row.is_active !== false && agg.row.deleted_at == null,
        };
        // a membership stays with its account, also when a removed one comes back
        if (was && next.user_id && was.user_id !== next.user_id) {
          results.push({ entity: agg.entity, id: agg.id, status: "error", message: "عضویت به حساب دیگری منتقل نمی‌شود" });
          continue;
        }
        const wasLive = !!was && was.is_active && !was.deleted_at;
        const before = was && !was.deleted_at ? { user_id: was.user_id, role: was.role, overrides: was.overrides } : null;
        const unchanged = !!was && wasLive === next.live && sameGrant(was, next) && was.user_id === next.user_id;
        const refusal = unchanged
          ? (was!.role === "owner" && ctx.member.role !== "owner" ? OWNER_ONLY_MESSAGE : null)
          : memberChangeProblem(ctx, before, next.live ? next : null);
        if (refusal) {
          results.push({ entity: agg.entity, id: agg.id, status: "error", message: refusal });
          continue;
        }
        if (wasLive && was!.role === "owner" && (!next.live || next.role !== "owner")) {
          // the active owners locked (id order, as the members page does): a demotion of another owner in flight
          // finishes first and is not counted, so two of them never leave the organisation without an owner
          const owners = await lockActiveOwners(tx, ctx.org.id);
          if (!owners.some((id) => id !== agg.id)) {
            results.push({ entity: agg.entity, id: agg.id, status: "error", message: "سازمان باید دست‌کم یک مالک فعال داشته باشد" });
            continue;
          }
        }
        if (!unchanged) memberChange = { was, next };
      }
      try {
        const r = await writeAggregate(tx, def, { ...agg, row: { ...agg.row, origin: input.device_id } }, ctx.org.id, "incoming-yields");
        if (def.engine) await afterEnginePush(tx, ctx, def, agg, engineState);
        const now = await tx.one<{ rev: number }>(`select rev from ${ident(def.table)} where id = $1`, [agg.id]);
        results.push({ entity: agg.entity, id: agg.id, status: "ok", rev: now?.rev, renumbered: r.renumbered });
        if (memberChange) memberEvents.push(memberEvent(memberChange.was, memberChange.next));
      } catch (e) {
        // a deadlock or serialization failure aborted the whole push: it is answered 503 and the app pushes again
        if (isTransientDbError(e)) throw e;
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: String((e as Error).message ?? e).slice(0, 300) });
      }
    }
  });
  for (const e of memberEvents) {
    const email = (await ctx.db.one<{ email: string }>(`select email from sm_users where id = $1`, [e.user_id]))?.email ?? null;
    const event: SecurityEventInput = { kind: e.kind, user_id: e.user_id, email, org_id: ctx.org.id, ...requestMeta(c), data: { ...e.data, by: ctx.user.id, by_name: ctx.user.full_name } };
    await securityEvent(ctx.db, event);
  }
  await ctx.db.query(`update sm_devices set last_push_at = now() where id = $1 and org_id = $2 and user_id = $3`, [input.device_id, ctx.org.id, ctx.user.id]);
  return c.json({ results, head: snapText(await currentSnap(ctx.db)) });
}

const BAD_CURSOR = "نشانگر همگام‌سازی معتبر نیست؛ همگام‌سازی از آغاز انجام می‌شود";

/** What one pull page reads: the synced aggregates, then the members' accounts (index of the last source). */
type Source = { def: AggregateDef } | { users: true };

/**
 * One page of a pull (docs/spec/ENGINE.md §13). A pull session reads the delta between the snapshot of the Windows
 * app's last complete pull (`since`; none: everything) and the session's own snapshot (`snap`, taken by its first page),
 * in (revision, id) order a page at a time (`after`). Every statement keeps to that window, so a row written again
 * after `snap` is left to the next session (its new revision is not visible in `snap`), never sent twice or half-changed.
 */
syncRoutes.get("/pull", async (c) => {
  const query = c.req.query();
  // every pull names its protocol (apps before 16 send none): anything else is told to update, never served a page
  if (Number(query.protocol) !== SYNC_PROTOCOL) throw bad(OUTDATED);
  const ctx = await orgCtx(c, query.org_id ?? "");
  const since = parseSnap(query.since);
  const snapIn = parseSnap(query.snap);
  const after = parseAfter(query.after);
  const clientEpoch = query.epoch;
  if ((query.since && !since) || (query.snap && !snapIn) || (query.after && !after)) throw bad(BAD_CURSOR);
  const log = ctx.cfg.log;
  // the database went back in transaction ids (restored into another cluster): every Windows app reads everything again
  await checkXidRegression(ctx.db, { log: (m) => log.warn(m) }).catch(() => undefined);
  const before = await currentSnap(ctx.db);
  const regressed = [since, snapIn].some((s) => !!s && s.xmax > before.xmax);
  if (regressed) {
    // this app reads everything again; the database's high-water mark decides whether every organisation's epoch moves
    // (once per regression — a bump per app would make every other app read everything again for each of them)
    log.warn("sync cursor ahead of the database: reading everything again", { org: ctx.org.id, cursor: snapText((snapIn ?? since)!), next: before.xmax });
    await checkXidRegression(ctx.db, { force: true, log: (m) => log.warn(m) }).catch(() => undefined);
  }
  // the access environment and the schema are read once for the page (cached on the context)
  await condEnv(ctx);
  await orgSchema(ctx);
  const share = [ctx.org.id, ctx.user.id, ctx.can("users", "view"), false, ctx.can("users", "full"), ctx.member.role === "owner"];
  const page = await (async () => {
    const q = ctx.db;
    const cur = await currentSnap(q);
    const state = await orgSyncState(q, ctx.org.id);
    const epoch = `${state.epoch}.${await scopeEpoch(q, ctx.org.id, ctx.user.id)}`;
    const started = !!(since || snapIn || after);
    // what this member may read changed, the database was restored, or tombstones this app never saw were removed
    // for good: everything again from the start
    // (purged tombstones are sequential archive batches: the newest one visible in the cursor means all of them were)
    const missedPurge = !!since && state.purged > 0 && !visibleIn(state.purged, since);
    if (started && (clientEpoch !== epoch || regressed || missedPurge)) {
      return { reset: true as const, epoch, head: snapText(cur) };
    }
    const snap = snapIn ?? cur;
    const sources: Source[] = [...AGGREGATES.map((def) => ({ def })), { users: true as const }];
    // The page's candidates: the first PULL_PAGE rows of each source in the window after the position, in (rev, id)
    // order. Short statements of SOURCES_PER_STATEMENT sources each (an index probe per table): every statement sees a
    // newer snapshot than `snap`, and the window keeps only versions written by transactions visible in `snap` — a row
    // written again since is left to the next session. No long transaction holding locks on every table.
    const cands: (After & { src: number })[] = [];
    for (let from = 0; from < sources.length; from += SOURCES_PER_STATEMENT) {
      const params: unknown[] = [ctx.org.id];
      const delta = deltaSql("t", since, snap, params);
      const past = afterSql("t", after, params);
      const branches = sources.slice(from, from + SOURCES_PER_STATEMENT).map((s, k) => {
        const table = "users" in s ? "sm_users" : ident(s.def.table);
        const owner = "users" in s ? `t.id in (select user_id from sm_org_members where org_id = $1)` : `${s.def.table === "sm_orgs" ? "t.id" : "t.org_id"} = $1`;
        return `(select ${from + k}::int as src, t.rev, t.id from ${table} t where ${owner} and ${delta} and ${past} order by t.rev, t.id limit ${PULL_PAGE})`;
      });
      const found = await q.query<{ src: number; rev: number; id: string }>(branches.join("\nunion all\n"), params);
      for (const r of found) cands.push({ src: Number(r.src), rev: Number(r.rev), id: String(r.id).toLowerCase() });
    }
    // a source that filled its PULL_PAGE may have more: the page never goes past its last row
    let bound: After | null = null;
    const perSource = new Map<number, (After & { src: number })[]>();
    for (const c of cands) {
      const list = perSource.get(c.src);
      if (list) list.push(c);
      else perSource.set(c.src, [c]);
    }
    for (const list of perSource.values()) {
      if (list.length < PULL_PAGE) continue;
      const last = list.reduce((m, x) => (compareKey(x, m) > 0 ? x : m));
      if (!bound || compareKey(last, bound) < 0) bound = last;
    }
    // the page: the first PULL_PAGE rows in (rev, id) order, never past the last row of a source that had more
    cands.sort(compareKey);
    const within = bound ? cands.filter((x) => compareKey(x, bound!) <= 0) : cands;
    const rows = within.slice(0, PULL_PAGE);
    const more = within.length > rows.length || !!bound;
    const aggregates: WireAggregate[] = [];
    const tombstones: { entity: string; id: string }[] = [];
    const bySource = new Map<number, string[]>();
    for (const r of rows) {
      const list = bySource.get(r.src);
      if (list) list.push(r.id);
      else bySource.set(r.src, [r.id]);
    }
    // the rows themselves, still inside the window (a version written since the candidates were read is not sent)
    const windowOf = (alias: string, first: number) => {
      const params: unknown[] = Array.from({ length: first - 1 });
      const where = deltaSql(alias, since, snap, params);
      return { where, params: params.slice(first - 1) };
    };
    let userIds: string[] = [];
    for (const [i, ids] of bySource) {
      const s = sources[i];
      if ("users" in s) {
        userIds = ids;
        continue;
      }
      if (s.def.engine) {
        const w = windowOf("r", 3);
        const stored = await q.query<Record<string, unknown>>(
          `select * from ${ident(s.def.table)} r where r.id = any($1::uuid[]) and r.org_id = $2 and ${w.where}`,
          [pgArray(ids), ctx.org.id, ...w.params],
        );
        const part = await replicaRows(q, ctx, s.def, stored);
        aggregates.push(...part.aggregates);
        tombstones.push(...part.tombstones);
      } else aggregates.push(...(await readAggregates(q, s.def, ids, windowOf("r", 2))));
    }
    // The members' accounts come along so that they can sign in on the desktop. A password hash
    // only goes where the caller could set that password anyway — the rule of «reset password» on
    // the members page: their own account; for a member who manages users, the accounts this
    // organisation made that work for it alone (an owner's only to an owner; never a platform admin's).
    // Anyone else signs in on that desktop through the cloud (`password_withheld`), and contact
    // details of other members need the right to see users. Members in this page bring their account
    // along even when the account itself did not change (an existing account added to the organisation later).
    const joined = aggregates.filter((a) => a.entity === "member").map((a) => String(a.row.user_id ?? "")).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    const wanted = [...new Set([...userIds, ...joined])];
    const users = wanted.length
      ? await q.query<Record<string, unknown>>(
        `select ${USER_COLS} from sm_users u ${SHARE_JOIN}
         where u.id = any($7::uuid[]) and u.id in (select user_id from sm_org_members where org_id = $1)`,
        [...share, pgArray(wanted)],
      )
      : [];
    const last = rows[rows.length - 1];
    return {
      reset: false as const,
      epoch,
      head: snapText(cur),
      snap,
      aggregates,
      tombstones,
      users,
      more,
      after: more && last ? { rev: last.rev, id: last.id } : null,
    };
  })();
  if (page.reset) {
    return c.json({ aggregates: [], tombstones: [], users: [], cursor: "", snap: null, after: null, head: page.head, has_more: true, reset: true, epoch: page.epoch });
  }
  if (query.device_id && /^[0-9a-f-]{36}$/i.test(query.device_id)) {
    await ctx.db.query(`update sm_devices set last_pull_at = now(), cursor = $2 where id = $1 and org_id = $3 and user_id = $4`, [
      query.device_id,
      page.more ? (since?.xmin ?? 0) : page.snap.xmin,
      ctx.org.id,
      ctx.user.id,
    ]);
  }
  return c.json({
    aggregates: page.aggregates,
    tombstones: page.tombstones,
    users: page.users,
    // the cursor to keep: the session's snapshot once it is complete, the previous one until then
    cursor: page.more ? (since ? snapText(since) : "") : snapText(page.snap),
    snap: snapText(page.snap),
    after: page.after ? afterText(page.after) : null,
    // a session that started from nothing reads everything there is (the Windows app drops what it did not receive)
    full: !since,
    head: page.head,
    has_more: page.more,
    epoch: page.epoch,
  });
});

const USER_COLS = `u.id, u.email, u.full_name, case when u.id = $2 or $3::boolean then u.mobile end as mobile,
    case when s.ok then u.password_hash end as password_hash, not s.ok as password_withheld,
    u.disabled, u.prefs, u.rev, u.created_at, u.updated_at`;
const SHARE_JOIN = `cross join lateral (select (u.id = $2 or $4::boolean or ($5::boolean and not u.is_platform_admin
      and ${CREATED_HERE_SQL("$1", "u.id")}
      and not exists (select 1 from sm_org_members o where o.user_id = u.id and o.org_id <> $1 and o.deleted_at is null)
      and ($6::boolean or not exists (select 1 from sm_org_members m where m.user_id = u.id and m.org_id = $1 and m.role = 'owner' and m.deleted_at is null)))) as ok) s`;
