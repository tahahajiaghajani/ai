// /api/local — desktop-only endpoints (backups, LAN mode, cloud link, sync status).
// Only mounted when the app runs inside the Windows application.
import { z } from "zod";
import { router, body, requireUser } from "../http/hono";
import { AppError, bad, forbidden } from "../http/errors";
import type { C } from "../http/hono";

export const localRoutes = router();

/** Before anyone has an account (first start) the setup screens may link to the cloud. */
async function bootstrap(c: C): Promise<boolean> {
  const n = await c.get("cfg").db.one<{ n: number }>(`select count(*)::int as n from sm_users`);
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
  const r = await c.get("cfg").db.one(`select 1 from sm_org_members where user_id = $1 and role in ('owner','admin') and is_active and deleted_at is null limit 1`, [u.id]);
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
  // only a copy from the backups list: an arbitrary path on the computer is not a backup
  const known = (await bridge(c).listBackups()).some((b) => b.file === file);
  if (!known) throw bad("این فایل در فهرست نسخه‌های پشتیبان نیست");
  await bridge(c).restoreBackup(file);
  return c.json({ ok: true, restart: true });
});

/** Settings of the installation; a wrong value here (a port «abc», «keep: x») breaks the next start or deletes backups. */
const settingsSchema = z.object({
  lan: z.object({
    enabled: z.boolean().optional(),
    port: z.coerce.number().int("پورت باید عدد صحیح باشد").min(1024, "پورت باید بین ۱۰۲۴ و ۶۵۵۳۵ باشد").max(65535, "پورت باید بین ۱۰۲۴ و ۶۵۵۳۵ باشد").optional(),
  }).strict().optional(),
  backups: z.object({
    dir: z.string().trim().min(1).max(500).nullable().optional(),
    auto: z.boolean().optional(),
    keep: z.coerce.number().int().min(1).max(1000).optional(),
    every_hours: z.coerce.number().min(1).max(24 * 7).optional(),
  }).strict().optional(),
  cloud: z.object({ auto_sync: z.boolean().optional() }).strict().optional(),
});

localRoutes.get("/settings", async (c) => {
  await needAdmin(c);
  return c.json(await bridge(c).getSettings());
});
localRoutes.patch("/settings", async (c) => {
  await needAdmin(c);
  const patch = await body(c, settingsSchema);
  return c.json(await bridge(c).setSettings(patch));
});

localRoutes.get("/sync", async (c) => c.json(await bridge(c).syncStatus()));
localRoutes.post("/sync", async (c) => c.json(await bridge(c).syncNow()));

/**
 * A call to the cloud from the setup screens: what the cloud or the network answered becomes a Persian 4xx/502 the page
 * shows as it is — never an unexplained 500. A refused sign-in says what to do: an account made here does not exist on
 * the server until someone makes it there (the cloud never takes accounts from a Windows app).
 */
async function cloudCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    const status = (e as { status?: number }).status;
    const message = String((e as Error)?.message ?? e);
    if (status === 401) throw new AppError(400, "cloud_refused", `${message} — این ایمیل و رمز در نسخهٔ وب پذیرفته نشد. حساب این برنامه به‌خودی‌خود روی سرور ساخته نمی‌شود: ابتدا در نسخهٔ وب با همین ایمیل حساب بسازید (یا اگر ساخته‌اید، رمز همان را وارد کنید)`);
    if (status && status >= 400 && status < 500) throw new AppError(400, "cloud_refused", message);
    throw new AppError(502, "cloud_unreachable", status ? `${message} (پاسخ ${status} از نسخهٔ وب)` : message);
  }
}

localRoutes.post("/cloud/orgs", async (c) => {
  await needAdmin(c);
  const input = await body(c, z.object({ url: z.string().url("نشانی معتبر نیست"), email: z.string().email("ایمیل معتبر نیست"), password: z.string().min(1) }));
  return c.json(await cloudCall(() => bridge(c).cloudOrgs(input)));
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
  return c.json(await cloudCall(() => bridge(c).link({ url: input.url, email: input.email, password: input.password, orgId: input.org_id, direction: input.direction })));
});
localRoutes.post("/cloud/unlink", async (c) => {
  await needAdmin(c);
  await bridge(c).unlink();
  return c.json({ ok: true });
});
