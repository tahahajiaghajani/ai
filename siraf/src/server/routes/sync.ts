// /api/sync — the cloud side of desktop synchronisation.
//
// push: the desktop sends aggregates it changed (with the revision it last saw). Each one is
//       applied in the organisation's write lock; when the cloud copy changed since and is newer,
//       the cloud wins ("conflict") and the desktop receives it with the next pull.
// pull: everything of the organisation with a revision above the desktop's cursor, a window at
//       a time. Revisions are handed out in commit order, so a cursor never skips a row.
import { z } from "zod";
import { router, body, requireUser, type C } from "../http/hono";
import { bad, forbidden, notFound } from "../http/errors";
import { makeCtx, lockOrg, type MemberRow, type OrgRow, type Ctx } from "../context";
import { AGGREGATES, BY_ENTITY, type WireAggregate } from "../sync/registry";
import { readAggregates, writeAggregate } from "../sync/apply";
import { ident } from "../db/sql";
import { pgArray } from "../db";
import { afterStockChange } from "../modules/goods/stock";
import { orgStatus, statusError } from "../modules/platform/org-admin";
import { CREATED_HERE_SQL, memberChangeProblem, OWNER_ONLY_MESSAGE, sameGrant, type MemberGrant } from "../modules/platform/members";
import { requestMeta, securityEvent, type SecurityEventInput } from "../modules/platform/security";
import type { Area, Level, Role } from "@shared/permissions";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";

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

/** documents whose stock moves carry moving-average costs */
const COSTED = new Set(["invoice", "stock_doc"]);

export const syncRoutes = router();
syncRoutes.use("*", requireUser);

const WINDOW = 1000;

async function orgCtx(c: C, orgId: string): Promise<Ctx> {
  const cfg = c.get("cfg");
  const user = c.get("user");
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw bad("شناسه‌ی سازمان معتبر نیست");
  const org = await cfg.db.one<OrgRow>(`select * from tz_orgs where id = $1 and deleted_at is null`, [orgId]);
  if (!org) throw notFound("کسب‌وکار در فضای ابری پیدا نشد");
  const member = await cfg.db.one<MemberRow>(
    `select id, org_id, user_id, role, overrides, is_active from tz_org_members where org_id = $1 and user_id = $2 and deleted_at is null`,
    [orgId, user.id],
  );
  if (!member || !member.is_active) throw forbidden("شما عضو این کسب‌وکار نیستید");
  const status = await orgStatus(cfg.db, orgId);
  if (status.status === "suspended") throw statusError(status);
  return makeCtx(cfg, user, org, member, { status });
}

syncRoutes.get("/status", async (c) => {
  const ctx = await orgCtx(c, c.req.query("org_id") ?? "");
  const head = await ctx.db.one<{ rev: number }>(`select rev from tz_org_sync where org_id = $1`, [ctx.org.id]);
  return c.json({ protocol: SYNC_PROTOCOL, head: head?.rev ?? 0, server_time: new Date().toISOString() });
});

syncRoutes.post("/register", async (c) => {
  const input = await body(c, z.object({ org_id: z.string(), device_id: z.string().uuid().optional(), name: z.string().max(120), platform: z.string().max(40).optional(), app_version: z.string().max(40).optional() }));
  const ctx = await orgCtx(c, input.org_id);
  // A device id is no secret (it rides along as the origin of synced rows): an id registered by
  // another account or for another business gets a fresh one instead of taking that record over.
  const save = (id: string) =>
    ctx.db.one<{ id: string }>(
      `insert into tz_devices (id, org_id, user_id, name, platform, app_version) values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set name = excluded.name, platform = excluded.platform, app_version = excluded.app_version, revoked_at = null
       where tz_devices.org_id = excluded.org_id and tz_devices.user_id = excluded.user_id
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
  const exists = await cfg.db.one<{ id: string }>(`select id from tz_orgs where id = $1`, [orgId]);
  if (exists) {
    const m = await cfg.db.one(`select 1 from tz_org_members where org_id = $1 and user_id = $2 and deleted_at is null and role in ('owner','admin')`, [orgId, user.id]);
    if (!m) throw forbidden("این کسب‌وکار در فضای ابری متعلق به حساب دیگری است");
    return c.json({ ok: true, existed: true });
  }
  await cfg.db.tx(async (tx) => {
    await lockOrg(tx, orgId);
    await tx.query("set local taraz.applying = 'on'");
    const def = BY_ENTITY.get("org")!;
    await writeAggregate(tx, def, { entity: "org", id: orgId, base_rev: 0, row: { ...input.org, created_by: user.id }, children: {} }, orgId, "incoming-yields");
    await tx.query(`insert into tz_org_members (id, org_id, user_id, role, origin) values ($1, $2, $3, 'owner', 'cloud') on conflict (org_id, user_id) do nothing`, [uuidv7(), orgId, user.id]);
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

syncRoutes.post("/push", async (c) => {
  const input = await body(c, pushSchema);
  if (input.protocol !== SYNC_PROTOCOL) throw bad("نسخه‌ی برنامه‌ی ویندوز با سرور هم‌خوان نیست؛ برنامه را به‌روز کنید");
  const ctx = await orgCtx(c, input.org_id);
  const results: { entity: string; id: string; status: "ok" | "conflict" | "error" | "skipped"; rev?: number; message?: string; renumbered?: unknown; aggregate?: WireAggregate }[] = [];
  const list = [...input.aggregates].sort((a, b) => (BY_ENTITY.get(a.entity)?.order ?? 99) - (BY_ENTITY.get(b.entity)?.order ?? 99));
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
    await tx.query("set local taraz.applying = 'on'");
    // stock moves of costed documents before and after they are replaced (see recompute below)
    const touches: { item_id: string; date: string }[] = [];
    const movesOf = (id: string) =>
      tx.query<{ item_id: string; date: string }>(
        `select item_id, min(date) as date from tz_stock_moves where org_id = $1 and source_id = $2 group by item_id`,
        [ctx.org.id, id],
      );
    for (const agg of list as WireAggregate[]) {
      const def = BY_ENTITY.get(agg.entity);
      if (!def) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: "نوع داده‌ی ناشناخته" });
        continue;
      }
      const need = def.entity === "org" ? ctx.can("settings", "full") : def.entity === "member" ? ctx.can("users", "edit") : ctx.can(def.area, "edit");
      if (!need) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: "دسترسی ویرایش این بخش را ندارید" });
        continue;
      }
      if (def.entity === "org" ? agg.id !== ctx.org.id : agg.row.org_id != null && agg.row.org_id !== ctx.org.id) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: "سازمان نامعتبر" });
        continue;
      }
      if (def.entity === "member") {
        const u = await tx.one(`select 1 from tz_users where id = $1`, [agg.row.user_id]);
        if (!u) {
          results.push({ entity: agg.entity, id: agg.id, status: "skipped", message: "کاربر محلی در فضای ابری حساب ندارد" });
          continue;
        }
      }
      const existing = await tx.one<{ org_id: string; rev: number; updated_at: string }>(`select org_id, rev, updated_at from ${ident(def.table)} where id = $1`, [agg.id]);
      if (existing && existing.org_id !== ctx.org.id) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: "شناسه متعلق به سازمان دیگری است" });
        continue;
      }
      if (existing && existing.rev > agg.base_rev && new Date(existing.updated_at).getTime() > new Date(String(agg.row.updated_at ?? 0)).getTime()) {
        // the cloud copy wins; hand it back, since the desktop may already have pulled past it.
        // Checked before the members' rules: an outdated row is not written, so it is not judged
        // either (refusing it would leave the desktop with its outdated copy for good)
        const [winner] = await readAggregates(tx, def, [agg.id]);
        results.push({ entity: agg.entity, id: agg.id, status: "conflict", rev: existing.rev, aggregate: winner });
        continue;
      }
      // fiscal years: the year-end rules of routes/org.ts hold for a Windows app too — closing needs
      // accounting:full, reopening is the owner's (or a manager's), and the closing and opening
      // vouchers of a closed year are never changed or removed (reopening the year removes them;
      // its fiscal_year row comes first in the batch, see the order in the registry)
      if (def.entity === "fiscal_year" && existing) {
        const stored = await tx.one<{ status: string }>(`select status from tz_fiscal_years where id = $1`, [agg.id]);
        const incoming = String(agg.row.status ?? stored?.status ?? "");
        if (stored?.status === "closed" && incoming !== "closed" && ctx.member.role !== "owner" && ctx.member.role !== "admin") {
          results.push({ entity: agg.entity, id: agg.id, status: "error", message: "باز کردن دوبارهٔ سال مالی بسته با مالک کسب‌وکار است" });
          continue;
        }
        if (stored?.status !== "closed" && incoming === "closed" && !ctx.can("accounting", "full")) {
          results.push({ entity: agg.entity, id: agg.id, status: "error", message: "بستن سال مالی به دسترسی کامل حسابداری نیاز دارد" });
          continue;
        }
      }
      if (def.entity === "voucher" && existing) {
        const v = await tx.one<{ total_debit: string; total_credit: string; deleted_at: string | null }>(
          `select v.total_debit, v.total_credit, v.deleted_at from tz_vouchers v join tz_fiscal_years f on f.id = v.source_id
           where v.id = $1 and v.source_type in ('closing', 'opening') and f.status = 'closed'`,
          [agg.id],
        );
        const same = (a: unknown, b: unknown) => a != null && b != null && String(a) !== "" && Number(a) === Number(b);
        if (v && !v.deleted_at && (agg.row.deleted_at != null || !same(agg.row.total_debit, v.total_debit) || !same(agg.row.total_credit, v.total_credit))) {
          results.push({ entity: agg.entity, id: agg.id, status: "error", message: "اسناد اختتامیه و افتتاحیهٔ سال مالی بسته تغییر نمی‌کنند؛ برای تغییر، سال را دوباره باز کنید" });
          continue;
        }
      }
      let memberChange: { was: StoredMember | null; next: MemberGrant & { live: boolean } } | null = null;
      if (def.entity === "member") {
        // the members page's rules (routes/org.ts): owners only by owners, nobody changes themselves
        // or grants above their own access, and the business keeps an active owner
        const was = existing
          ? await tx.one<StoredMember>(`select user_id, role, overrides, is_active, deleted_at from tz_org_members where id = $1`, [agg.id])
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
          const others = await tx.one<{ n: number }>(
            `select count(*)::int as n from tz_org_members where org_id = $1 and id <> $2 and role = 'owner' and is_active and deleted_at is null`,
            [ctx.org.id, agg.id],
          );
          if (!others?.n) {
            results.push({ entity: agg.entity, id: agg.id, status: "error", message: "کسب‌وکار باید دست‌کم یک مالک فعال داشته باشد" });
            continue;
          }
        }
        if (!unchanged) memberChange = { was, next };
      }
      try {
        const costed = COSTED.has(def.entity);
        if (costed) touches.push(...(await movesOf(agg.id)));
        const r = await writeAggregate(tx, def, { ...agg, row: { ...agg.row, origin: input.device_id } }, ctx.org.id, "incoming-yields");
        if (costed) touches.push(...(await movesOf(agg.id)));
        const now = await tx.one<{ rev: number }>(`select rev from ${ident(def.table)} where id = $1`, [agg.id]);
        results.push({ entity: agg.entity, id: agg.id, status: "ok", rev: now?.rev, renumbered: r.renumbered });
        if (memberChange) memberEvents.push(memberEvent(memberChange.was, memberChange.next));
      } catch (e) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: String((e as Error).message ?? e).slice(0, 300) });
      }
    }
    // A document made offline (often back-dated) changes the moving-average cost of later sales
    // here; recompute them like a local edit would. The new costs get revisions and flow back to
    // every device. A failure must not block the upload: costs can be recomputed later.
    if (touches.length) {
      await tx.query("set local taraz.applying = 'off'");
      await tx.query("savepoint tz_recost");
      try {
        const goods = await tx.query<{ id: string }>(`select id from tz_items where org_id = $1 and kind = 'goods' and id = any($2::uuid[])`, [ctx.org.id, pgArray([...new Set(touches.map((t) => t.item_id))])]);
        const keep = new Set(goods.map((g) => g.id));
        const mine = touches.filter((t) => keep.has(t.item_id));
        if (mine.length) await afterStockChange(tx, ctx, mine, undefined, { checkNegative: false });
        await tx.query("release savepoint tz_recost");
      } catch (e) {
        await tx.query("rollback to savepoint tz_recost");
        ctx.cfg.log.warn("cost recompute after push failed", String((e as Error).message ?? e));
      }
    }
  });
  for (const e of memberEvents) {
    const email = (await ctx.db.one<{ email: string }>(`select email from tz_users where id = $1`, [e.user_id]))?.email ?? null;
    const event: SecurityEventInput = { kind: e.kind, user_id: e.user_id, email, org_id: ctx.org.id, ...requestMeta(c), data: { ...e.data, by: ctx.user.id, by_name: ctx.user.full_name } };
    await securityEvent(ctx.db, event);
  }
  await ctx.db.query(`update tz_devices set last_push_at = now() where id = $1 and org_id = $2 and user_id = $3`, [input.device_id, ctx.org.id, ctx.user.id]);
  const head = await ctx.db.one<{ rev: number }>(`select rev from tz_org_sync where org_id = $1`, [ctx.org.id]);
  return c.json({ results, head: head?.rev ?? 0 });
});

syncRoutes.get("/pull", async (c) => {
  const q = c.req.query();
  const ctx = await orgCtx(c, q.org_id ?? "");
  const cursor = Math.max(0, Number(q.cursor ?? 0) || 0);
  const userCursor = Math.max(0, Number(q.user_cursor ?? 0) || 0);
  const head = (await ctx.db.one<{ rev: number }>(`select rev from tz_org_sync where org_id = $1`, [ctx.org.id]))?.rev ?? 0;
  const upto = Math.min(cursor + WINDOW, head);
  const aggregates: WireAggregate[] = [];
  if (upto > cursor) {
    for (const def of AGGREGATES) {
      const ids = (await ctx.db.query<{ id: string }>(
        `select id from ${ident(def.table)} where ${def.table === "tz_orgs" ? "id" : "org_id"} = $1 and rev > $2 and rev <= $3 order by rev`,
        [ctx.org.id, cursor, upto],
      )).map((r) => r.id);
      if (ids.length) aggregates.push(...(await readAggregates(ctx.db, def, ids)));
    }
  }
  // The members' accounts come along so that they can sign in on the desktop. A password hash
  // only goes where the caller could set that password anyway — the rule of «reset password» on
  // the members page: their own account; for a member who manages users, the accounts this
  // business made that work for it alone (an owner's only to an owner; never a platform admin's).
  // Anyone else signs in on that desktop through the cloud (`password_withheld`), and contact
  // details of other members need the right to see users.
  const share = [ctx.org.id, ctx.user.id, ctx.can("users", "view"), false, ctx.can("users", "full"), ctx.member.role === "owner"];
  const userCols = `u.id, u.email, u.full_name, case when u.id = $2 or $3::boolean then u.mobile end as mobile,
    case when s.ok then u.password_hash end as password_hash, not s.ok as password_withheld,
    u.disabled, u.prefs, u.rev, u.created_at, u.updated_at`;
  const shareJoin = `cross join lateral (select (u.id = $2 or $4::boolean or ($5::boolean and not u.is_platform_admin
      and ${CREATED_HERE_SQL("$1", "u.id")}
      and not exists (select 1 from tz_org_members o where o.user_id = u.id and o.org_id <> $1 and o.deleted_at is null)
      and ($6::boolean or not exists (select 1 from tz_org_members m where m.user_id = u.id and m.org_id = $1 and m.role = 'owner' and m.deleted_at is null)))) as ok) s`;
  const users = await ctx.db.query<{ id: string; rev: number }>(
    `select ${userCols} from tz_users u ${shareJoin}
     where u.rev > $7 and u.id in (select user_id from tz_org_members where org_id = $1) order by u.rev limit 500`,
    [...share, userCursor],
  );
  // members in this window bring their account along even when its revision is below the user
  // cursor (an existing account added to the organisation later)
  const joined = upto > cursor
    ? await ctx.db.query<{ id: string; rev: number }>(
      `select ${userCols} from tz_users u ${shareJoin}
       where u.id in (select user_id from tz_org_members where org_id = $1 and rev > $7 and rev <= $8)`,
      [...share, cursor, upto],
    )
    : [];
  const userCursorNext = users.length ? Math.max(...users.map((u) => Number(u.rev))) : userCursor;
  const seen = new Set(users.map((u) => u.id));
  for (const u of joined) if (!seen.has(u.id)) users.push(u);
  if (q.device_id && /^[0-9a-f-]{36}$/i.test(q.device_id)) {
    await ctx.db.query(`update tz_devices set last_pull_at = now(), cursor = $2 where id = $1 and org_id = $3 and user_id = $4`, [q.device_id, upto, ctx.org.id, ctx.user.id]);
  }
  return c.json({
    aggregates,
    users,
    cursor: upto,
    user_cursor: userCursorNext,
    head,
    has_more: upto < head,
  });
});
