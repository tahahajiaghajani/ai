// /api/local — desktop-only endpoints (backups, LAN mode, cloud link, sync status).
// Only mounted when the app runs inside the Windows application.
import { z } from "zod";
import { router, body, requireUser } from "../http/hono";
import { forbidden } from "../http/errors";
import type { C } from "../http/hono";

export const localRoutes = router();

/** Before anyone has an account (first start) the setup screens may link to the cloud. */
async function bootstrap(c: C): Promise<boolean> {
  const n = await c.get("cfg").db.one<{ n: number }>(`select count(*)::int as n from tz_users`);
  return (n?.n ?? 0) === 0;
}

localRoutes.use("*", async (c, next) => {
  if (await bootstrap(c)) {
    c.set("bootstrap" as never, true as never);
    return next();
  }
  return requireUser(c, next);
});

function bridge(c: C) {
  const b = c.get("cfg").desktop;
  if (!b) throw forbidden("این بخش فقط در نسخه‌ی ویندوزی است");
  return b;
}

async function isAdmin(c: C) {
  if (c.get("bootstrap" as never)) return true;
  const u = c.get("user");
  if (u.is_platform_admin) return true;
  const r = await c.get("cfg").db.one(`select 1 from tz_org_members where user_id = $1 and role in ('owner','admin') and is_active and deleted_at is null limit 1`, [u.id]);
  return !!r;
}

async function needAdmin(c: C) {
  if (!(await isAdmin(c))) throw forbidden("فقط مالک یا مدیر به این تنظیمات دسترسی دارد");
}

localRoutes.get("/info", async (c) => c.json(await bridge(c).info()));

localRoutes.get("/backups", async (c) => {
  await needAdmin(c);
  return c.json({ backups: await bridge(c).listBackups() });
});
localRoutes.post("/backups", async (c) => {
  await needAdmin(c);
  return c.json(await bridge(c).backupNow());
});
localRoutes.post("/backups/restore", async (c) => {
  await needAdmin(c);
  const { file } = await body(c, z.object({ file: z.string().min(1) }));
  await bridge(c).restoreBackup(file);
  return c.json({ ok: true, restart: true });
});

localRoutes.get("/settings", async (c) => {
  await needAdmin(c);
  return c.json(await bridge(c).getSettings());
});
localRoutes.patch("/settings", async (c) => {
  await needAdmin(c);
  const patch = await body(c, z.record(z.string(), z.unknown()));
  return c.json(await bridge(c).setSettings(patch));
});

localRoutes.get("/sync", async (c) => c.json(await bridge(c).syncStatus()));
localRoutes.post("/sync", async (c) => c.json(await bridge(c).syncNow()));

localRoutes.post("/cloud/orgs", async (c) => {
  await needAdmin(c);
  const input = await body(c, z.object({ url: z.string().url("نشانی معتبر نیست"), email: z.string().email("ایمیل معتبر نیست"), password: z.string().min(1) }));
  return c.json(await bridge(c).cloudOrgs(input));
});
localRoutes.post("/cloud/link", async (c) => {
  await needAdmin(c);
  const input = await body(c, z.object({
    url: z.string().url("نشانی معتبر نیست"),
    email: z.string().email("ایمیل معتبر نیست"),
    password: z.string().min(1),
    org_id: z.string().uuid().optional(),
    direction: z.enum(["download", "upload"]),
  }));
  return c.json(await bridge(c).link({ url: input.url, email: input.email, password: input.password, orgId: input.org_id, direction: input.direction }));
});
localRoutes.post("/cloud/unlink", async (c) => {
  await needAdmin(c);
  await bridge(c).unlink();
  return c.json({ ok: true });
});
