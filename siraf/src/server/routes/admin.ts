// /api/admin — the platform owner's view (PLATFORM_ADMIN_EMAILS): users, businesses and database size.
import { z } from "zod";
import type { MiddlewareHandler } from "hono";
import { router, body, requireUser, type Env } from "../http/hono";
import { bad, forbidden } from "../http/errors";
import { likeContains } from "../db";

const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get("user")?.is_platform_admin) throw forbidden("این بخش فقط برای مدیر سامانه است");
  await next();
};

export const adminRoutes = router();
adminRoutes.use("*", requireUser, requireAdmin);

adminRoutes.get("/stats", async (c) => {
  const db = c.get("cfg").db;
  const s = await db.one<Record<string, number>>(
    `select (select count(*)::int from tz_users) as users,
            (select count(*)::int from tz_users where disabled) as disabled_users,
            (select count(*)::int from tz_orgs where deleted_at is null) as orgs,
            (select count(*)::int from tz_sessions where revoked_at is null and expires_at > now() and last_seen_at > now() - interval '7 days') as active_sessions,
            (select count(*)::int from tz_devices) as devices,
            (select count(*)::int from tz_vouchers where deleted_at is null) as vouchers,
            pg_database_size(current_database())::bigint as db_bytes`,
  );
  return c.json({ stats: s });
});

adminRoutes.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const params: unknown[] = [];
  let where = "";
  if (q) {
    params.push(likeContains(q));
    where = `where u.email ilike $1 or u.full_name ilike $1 or u.mobile ilike $1`;
  }
  const rows = await c.get("cfg").db.query(
    `select u.id, u.email, u.full_name, u.mobile, u.is_platform_admin, u.disabled, u.created_at,
            (select max(s.last_seen_at) from tz_sessions s where s.user_id = u.id) as last_seen_at,
            (select count(*)::int from tz_org_members m where m.user_id = u.id and m.deleted_at is null and m.is_active) as orgs
     from tz_users u ${where} order by u.created_at desc limit 300`,
    params,
  );
  return c.json({ users: rows });
});

adminRoutes.patch("/users/:id", async (c) => {
  const db = c.get("cfg").db;
  const id = c.req.param("id");
  const input = await body(c, z.object({ disabled: z.boolean() }));
  if (id === c.get("user").id) throw bad("حساب خودتان را نمی‌توانید غیرفعال کنید");
  await db.tx(async (tx) => {
    // tz_user_touch gives the row a new revision so linked Windows apps receive the change
    await tx.query(`update tz_users set disabled = $2 where id = $1`, [id, input.disabled]);
    if (input.disabled) await tx.query(`update tz_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [id]);
  });
  return c.json({ ok: true });
});

adminRoutes.get("/orgs", async (c) => {
  const rows = await c.get("cfg").db.query(
    `select o.id, o.name, o.business_kind, o.modules, o.created_at,
            (select count(*)::int from tz_org_members m where m.org_id = o.id and m.deleted_at is null and m.is_active) as members,
            (select count(*)::int from tz_vouchers v where v.org_id = o.id and v.deleted_at is null) as vouchers,
            (select count(*)::int from tz_invoices i where i.org_id = o.id and i.deleted_at is null) as invoices,
            (select max(v.updated_at) from tz_vouchers v where v.org_id = o.id) as last_activity
     from tz_orgs o where o.deleted_at is null order by o.created_at desc limit 500`,
  );
  return c.json({ orgs: rows });
});
