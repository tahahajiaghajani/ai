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
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";

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
  return makeCtx(cfg, user, org, member);
}

syncRoutes.get("/status", async (c) => {
  const ctx = await orgCtx(c, c.req.query("org_id") ?? "");
  const head = await ctx.db.one<{ rev: number }>(`select rev from tz_org_sync where org_id = $1`, [ctx.org.id]);
  return c.json({ protocol: SYNC_PROTOCOL, head: head?.rev ?? 0, server_time: new Date().toISOString() });
});

syncRoutes.post("/register", async (c) => {
  const input = await body(c, z.object({ org_id: z.string(), device_id: z.string().uuid().optional(), name: z.string().max(120), platform: z.string().max(40).optional(), app_version: z.string().max(40).optional() }));
  const ctx = await orgCtx(c, input.org_id);
  const id = input.device_id ?? uuidv7();
  await ctx.db.query(
    `insert into tz_devices (id, org_id, user_id, name, platform, app_version) values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set name = excluded.name, platform = excluded.platform, app_version = excluded.app_version, revoked_at = null`,
    [id, ctx.org.id, ctx.user.id, input.name, input.platform ?? null, input.app_version ?? null],
  );
  return c.json({ device_id: id, protocol: SYNC_PROTOCOL });
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
  const results: { entity: string; id: string; status: "ok" | "conflict" | "error" | "skipped"; rev?: number; message?: string; renumbered?: unknown }[] = [];
  const list = [...input.aggregates].sort((a, b) => (BY_ENTITY.get(a.entity)?.order ?? 99) - (BY_ENTITY.get(b.entity)?.order ?? 99));
  await ctx.write(async (tx) => {
    await tx.query("set local taraz.applying = 'on'");
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
      if (def.entity === "org" && agg.id !== ctx.org.id) {
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
        results.push({ entity: agg.entity, id: agg.id, status: "conflict", rev: existing.rev });
        continue;
      }
      try {
        const r = await writeAggregate(tx, def, { ...agg, row: { ...agg.row, origin: input.device_id } }, ctx.org.id, "incoming-yields");
        const now = await tx.one<{ rev: number }>(`select rev from ${ident(def.table)} where id = $1`, [agg.id]);
        results.push({ entity: agg.entity, id: agg.id, status: "ok", rev: now?.rev, renumbered: r.renumbered });
      } catch (e) {
        results.push({ entity: agg.entity, id: agg.id, status: "error", message: String((e as Error).message ?? e).slice(0, 300) });
      }
    }
  });
  await ctx.db.query(`update tz_devices set last_push_at = now() where id = $1`, [input.device_id]);
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
  const users = await ctx.db.query<{ rev: number }>(
    `select id, email, full_name, mobile, password_hash, disabled, prefs, rev, created_at, updated_at from tz_users
     where rev > $2 and id in (select user_id from tz_org_members where org_id = $1) order by rev limit 500`,
    [ctx.org.id, userCursor],
  );
  if (q.device_id) await ctx.db.query(`update tz_devices set last_pull_at = now(), cursor = $2 where id = $1`, [q.device_id, upto]);
  return c.json({
    aggregates,
    users,
    cursor: upto,
    user_cursor: users.length ? Math.max(...users.map((u) => Number(u.rev))) : userCursor,
    head,
    has_more: upto < head,
  });
});
