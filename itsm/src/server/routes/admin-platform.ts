// The platform owner's console additions (mounted in routes/admin.ts under /api/admin, behind requireUser +
// requireAdmin — and checked again here): plans and limits, organisations' plans and usage, feature flags,
// announcements, the job monitor, backups, version and upgrade status, the audit log of every organisation and the
// AI model catalogue. No route here returns an organisation's records; backups are files for the platform owner only.
import { csvCell } from "@shared/csv";
import { z } from "zod";
import type { MiddlewareHandler } from "hono";
import { router, body, type C, type Env } from "../http/hono";
import { forbidden, notFound } from "../http/errors";
import { AI_PRESETS } from "@shared/ai/presets";
import {
  auditAll, deleteAnnouncement, deleteFlag, deletePlan, jobAction, jobSummary, listAnnouncements, listFlags, listJobs, listPlans, orgUsage, publishAnnouncement,
  saveAnnouncement, saveFlag, savePlan, setOrgPlan, tickNow, versionStatus,
} from "../modules/admin/platform";
import { createBackup, deleteBackup, downloadBackup, listBackups, restoreBackup, verifyBackupAs } from "../modules/admin/backup";
import { requestMeta } from "../modules/platform/security";
import { contentDisposition } from "../engine";

const onlyPlatform: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get("user")?.is_platform_admin) throw forbidden("این بخش فقط برای مدیر سامانه است");
  await next();
};

export const platformConsoleRoutes = router();
platformConsoleRoutes.use("*", onlyPlatform);

const isId = (s: string | undefined) => !!s && /^[0-9a-f-]{36}$/i.test(s);
const id = (s: string | undefined, what = "مورد") => {
  if (!isId(s)) throw notFound(`${what} پیدا نشد`);
  return s!.toLowerCase();
};
const qs = (v: string | undefined) => (v ?? "").trim() || null;

// ---------------------------------------------------------------- plans and limits

const limitsSchema = z.record(z.string(), z.union([z.number().int().min(0), z.null()]));

platformConsoleRoutes.get("/plans", async (c) => c.json(await listPlans(c.get("cfg"))));

platformConsoleRoutes.put("/plans/:key", async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().trim().min(2, "نام طرح را وارد کنید").max(80),
      description: z.string().trim().max(500).nullish(),
      limits: limitsSchema,
      features: z.array(z.string().max(41)).max(100).optional(),
      sort_order: z.number().int().min(0).max(10000).optional(),
      is_default: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
  );
  return c.json({ plan: await savePlan(c.get("cfg"), c.get("user"), c.req.param("key"), input) });
});

platformConsoleRoutes.delete("/plans/:key", async (c) => {
  await deletePlan(c.get("cfg"), c.get("user"), c.req.param("key"));
  return c.json({ ok: true });
});

platformConsoleRoutes.get("/orgs/:id/plan", async (c) => c.json(await orgUsage(c.get("cfg"), id(c.req.param("id"), "سازمان"))));

platformConsoleRoutes.put("/orgs/:id/plan", async (c) => {
  const input = await body(c, z.object({ plan: z.string().trim().min(1).max(31), overrides: limitsSchema.optional() }));
  return c.json(await setOrgPlan(c.get("cfg"), c.get("user"), id(c.req.param("id"), "سازمان"), input));
});

/** Every organisation with its plan and what it uses (the plans page). */
platformConsoleRoutes.get("/usage", async (c) => {
  const cfg = c.get("cfg");
  const orgs = await cfg.db.query<{ id: string; name: string }>(`select id, name from sm_orgs where deleted_at is null order by created_at limit 500`);
  const out = [];
  for (const o of orgs) out.push({ ...(await orgUsage(cfg, o.id)), name: o.name });
  return c.json({ orgs: out });
});

// ---------------------------------------------------------------- feature flags

platformConsoleRoutes.get("/flags", async (c) => c.json(await listFlags(c.get("cfg"))));

platformConsoleRoutes.put("/flags/:key", async (c) => {
  const input = await body(
    c,
    z.object({
      label: z.string().trim().min(2).max(120),
      description: z.string().trim().max(500).nullish(),
      stage: z.enum(["off", "beta", "on"]),
      percent: z.number().int().min(0).max(100).optional(),
      plans: z.array(z.string().max(31)).max(50).optional(),
      orgs_on: z.array(z.string()).max(1000).optional(),
      orgs_off: z.array(z.string()).max(1000).optional(),
      tenant_toggle: z.boolean().optional(),
    }),
  );
  return c.json({ flag: await saveFlag(c.get("cfg"), c.get("user"), c.req.param("key"), input) });
});

platformConsoleRoutes.delete("/flags/:key", async (c) => {
  await deleteFlag(c.get("cfg"), c.get("user"), c.req.param("key"));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- announcements

const announcementSchema = z.object({
  title: z.string().trim().min(3, "عنوان اطلاعیه را وارد کنید").max(160),
  body: z.string().max(10_000).optional(),
  severity: z.enum(["info", "warning", "critical", "maintenance"]),
  audience: z.enum(["all", "orgs", "plans"]),
  org_ids: z.array(z.string()).max(1000).optional(),
  plans: z.array(z.string().max(31)).max(50).optional(),
  starts_at: z.string().datetime({ offset: true }).nullish(),
  ends_at: z.string().datetime({ offset: true }).nullish(),
});

platformConsoleRoutes.get("/announcements", async (c) => c.json(await listAnnouncements(c.get("cfg"))));

platformConsoleRoutes.post("/announcements", async (c) => {
  const input = await body(c, announcementSchema.extend({ publish: z.boolean().optional() }));
  const a = await saveAnnouncement(c.get("cfg"), c.get("user"), null, input);
  const published = input.publish ? await publishAnnouncement(c.get("cfg"), c.get("user"), a.id) : null;
  return c.json({ announcement: a, published });
});

platformConsoleRoutes.patch("/announcements/:id", async (c) => {
  const input = await body(c, announcementSchema);
  return c.json({ announcement: await saveAnnouncement(c.get("cfg"), c.get("user"), id(c.req.param("id"), "اطلاعیه"), input) });
});

platformConsoleRoutes.post("/announcements/:id/publish", async (c) => c.json(await publishAnnouncement(c.get("cfg"), c.get("user"), id(c.req.param("id"), "اطلاعیه"))));

platformConsoleRoutes.delete("/announcements/:id", async (c) => {
  await deleteAnnouncement(c.get("cfg"), c.get("user"), id(c.req.param("id"), "اطلاعیه"));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- jobs

platformConsoleRoutes.get("/jobs/summary", async (c) => c.json(await jobSummary(c.get("cfg"), isId(c.req.query("org")) ? c.req.query("org")! : null)));

platformConsoleRoutes.get("/jobs", async (c) =>
  c.json(await listJobs(c.get("cfg"), { status: qs(c.req.query("status")), kind: qs(c.req.query("kind")), org: isId(c.req.query("org")) ? c.req.query("org")! : null, limit: 200 })),
);

platformConsoleRoutes.post("/jobs/:id/retry", async (c) => c.json(await jobAction(c.get("cfg"), c.get("user"), id(c.req.param("id"), "کار"), "retry")));
platformConsoleRoutes.post("/jobs/:id/cancel", async (c) => c.json(await jobAction(c.get("cfg"), c.get("user"), id(c.req.param("id"), "کار"), "cancel")));
platformConsoleRoutes.post("/jobs/tick", async (c) => c.json(await tickNow(c.get("cfg"))));

// ---------------------------------------------------------------- backups

platformConsoleRoutes.get("/backups", async (c) => c.json({ backups: await listBackups(c.get("cfg").db, isId(c.req.query("org")) ? c.req.query("org")! : null) }));

platformConsoleRoutes.post("/backups", async (c) => {
  const input = await body(c, z.object({ org_id: z.string(), note: z.string().trim().max(300).nullish() }));
  return c.json({ backup: await createBackup(c.get("cfg"), c.get("user"), id(input.org_id, "سازمان"), input.note || null) });
});

platformConsoleRoutes.get("/backups/:id/download", async (c) => {
  // audited: the platform's audit and the organisation's security log record who took the file
  const f = await downloadBackup(c.get("cfg"), c.get("user"), id(c.req.param("id"), "پشتیبان"), requestMeta(c));
  return new Response(Buffer.from(f.data), {
    headers: { "content-type": "application/gzip", "content-disposition": contentDisposition(f.name), "x-content-sha256": f.sha256, "cache-control": "no-store" },
  });
});

platformConsoleRoutes.post("/backups/:id/verify", async (c) => c.json(await verifyBackupAs(c.get("cfg"), c.get("user"), id(c.req.param("id"), "پشتیبان"), requestMeta(c))));

platformConsoleRoutes.post("/backups/:id/restore", async (c) => c.json(await restoreBackup(c.get("cfg"), c.get("user"), id(c.req.param("id"), "پشتیبان"))));

platformConsoleRoutes.delete("/backups/:id", async (c) => {
  await deleteBackup(c.get("cfg"), c.get("user"), id(c.req.param("id"), "پشتیبان"));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- version, audit of every organisation, AI models

platformConsoleRoutes.get("/version", async (c) => c.json(await versionStatus(c.get("cfg"))));

const auditFilters = (c: C) => ({
  org: isId(c.req.query("org")) ? c.req.query("org")! : null,
  actor: qs(c.req.query("actor")),
  q: qs(c.req.query("q")),
  action: qs(c.req.query("action")),
  before: c.req.query("before") && !Number.isNaN(Date.parse(c.req.query("before")!)) ? c.req.query("before")! : null,
});

platformConsoleRoutes.get("/audit-all", async (c) => c.json(await auditAll(c.get("cfg"), { ...auditFilters(c), limit: 100 })));

platformConsoleRoutes.get("/audit-all.csv", async (c) => {
  const { rows } = await auditAll(c.get("cfg"), { ...auditFilters(c), limit: 1000 });
  // organisation and people names are their own text: formula-safe (a name «=cmd|…» stays text in Excel)
  const cell = (v: unknown) => csvCell(v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v));
  const head = ["زمان", "سازمان", "انجام‌دهنده", "گونه", "کار", "شرح"];
  const lines = [head.join(","), ...(rows as Record<string, unknown>[]).map((r) => [r.at, r.org_name, r.actor_name, r.actor_kind, r.action, r.summary].map(cell).join(","))];
  return new Response(`﻿${lines.join("\r\n")}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": contentDisposition("audit.csv"), "cache-control": "no-store" } });
});

/** The model catalogue the platform offers (providers, regions, models per tier, embeddings) — the AI presets. */
platformConsoleRoutes.get("/models", async (c) =>
  c.json({
    providers: AI_PRESETS.filter((p) => !p.test_only).map((p) => ({
      id: p.id,
      label: p.label,
      protocol: p.protocol,
      region: p.region,
      runtimes: p.runtimes,
      models: p.models,
      suggested: p.suggested,
      embed: p.embed ?? null,
      media: p.media,
      badge: p.badge ?? null,
    })),
  }),
);
