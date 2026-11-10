// /api/o/:org/admin — the tenant administration console (docs/modules/admin_FA.md): home and set-up checklist, features,
// branding, member import, the access matrix and explanations, the studio (custom tables and fields, versions,
// packages, drafts from Persian), import sets, data exports, system logs, jobs, seats and notices. Every route checks
// the caller's access (membership areas through ctx.need, the access model through the services) and works only on the
// caller's organisation.
import { z } from "zod";
import { router, body } from "../http/hono";
import { bad, notFound } from "../http/errors";
import { STUDIO_TYPES } from "@shared/admin/studio";
import { consoleHome, markStep, setFeature, saveBrand, brandOf, systemLogs, orgJobAction, licences, activeNotices, publishNotice, createNotice, type LogKind } from "../modules/admin/tenant";
import { featureStates } from "../modules/admin/common";
import { importMembers } from "../modules/admin/members";
import { explainFor, memberMatrix, roleMatrix, whoCanRead } from "../modules/admin/access-matrix";
import { createCustomTable, deleteCustomTable, exportPackage, importPackage, publishTable, restoreVersion, saveFields, studioOverview, fieldsOf, needStudio } from "../modules/admin/studio";
import { analyzeImport, runImport, suggestImport } from "../modules/admin/imports";
import { requestExport } from "../modules/admin/exports";
import { draftFields } from "../modules/admin/ai";
import { isAiUnavailable, runSkill } from "../modules/ai/skills/runtime";
import { draftFromText } from "@shared/admin/studio";
import { seedAdminDefaults } from "../modules/admin";

export const adminTenantRoutes = router();

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const uuid = (s: string | undefined, what = "مورد") => {
  const r = UUID.safeParse(s ?? "");
  if (!r.success) throw notFound(`${what} پیدا نشد`);
  return r.data.toLowerCase();
};

// ---------------------------------------------------------------- home, set-up, features, branding

adminTenantRoutes.get("/home", async (c) => c.json(await consoleHome(c.get("ctx"))));

adminTenantRoutes.put("/onboarding/:key", async (c) => {
  const input = await body(c, z.object({ done: z.boolean() }));
  return c.json({ onboarding: await markStep(c.get("ctx"), c.req.param("key"), input.done) });
});

adminTenantRoutes.get("/features", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "view");
  return c.json({ features: await featureStates(ctx.db, ctx.org.id, ctx.cfg.mode) });
});

adminTenantRoutes.put("/features/:key", async (c) => {
  const input = await body(c, z.object({ enabled: z.boolean() }));
  return c.json({ features: await setFeature(c.get("ctx"), c.req.param("key"), input.enabled) });
});

adminTenantRoutes.get("/branding", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "view");
  return c.json({ brand: brandOf(ctx.org.settings), logo: (ctx.org as { logo?: string | null }).logo ?? null });
});

adminTenantRoutes.put("/branding", async (c) => {
  const input = await body(
    c,
    z.object({
      accent: z.string().max(20).nullish(),
      portal_title: z.string().max(80).nullish(),
      login_message: z.string().max(500).nullish(),
      email_footer: z.string().max(1000).nullish(),
      support_email: z.union([z.literal(""), z.string().email("ایمیل پشتیبانی معتبر نیست")]).nullish(),
      logo: z.string().max(400_000).nullish(),
    }),
  );
  return c.json(await saveBrand(c.get("ctx"), input));
});

// ---------------------------------------------------------------- members

adminTenantRoutes.post("/members/import", async (c) => {
  const input = await body(
    c,
    z.object({
      rows: z
        .array(
          z.object({
            email: z.string().max(200),
            name: z.string().max(200),
            title: z.string().max(120).nullish(),
            phone: z.string().max(40).nullish(),
            unit: z.string().max(150).nullish(),
            manager: z.string().max(200).nullish(),
            groups: z.array(z.string().max(150)).max(30).optional(),
          }),
        )
        .max(2000),
      dry_run: z.boolean().default(true),
      membership_role: z.enum(["member", "viewer"]).default("viewer"),
      role: z.string().max(41).nullish(),
      create_units: z.boolean().optional(),
    }),
  );
  return c.json(await importMembers(c.get("ctx"), input.rows, { dryRun: input.dry_run, membershipRole: input.membership_role, role: input.role || null, createUnits: !!input.create_units }));
});

// ---------------------------------------------------------------- access matrix

adminTenantRoutes.get("/access/matrix", async (c) => {
  const ctx = c.get("ctx");
  const user = c.req.query("user");
  const role = c.req.query("role");
  if (user) return c.json(await memberMatrix(ctx, uuid(user, "عضو")));
  if (role) return c.json(await roleMatrix(ctx, role));
  throw bad("عضو یا نقش را انتخاب کنید");
});

adminTenantRoutes.get("/access/who", async (c) => {
  const table = c.req.query("table") ?? "";
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table)) throw bad("جدول معتبر نیست");
  return c.json(await whoCanRead(c.get("ctx"), table, uuid(c.req.query("id"), "رکورد")));
});

adminTenantRoutes.post("/access/explain", async (c) => {
  const input = await body(c, z.object({ user_id: UUID, table: z.string().min(1).max(63), record_id: UUID.nullish() }));
  return c.json(await explainFor(c.get("ctx"), input));
});

// ---------------------------------------------------------------- studio

const optionSchema = z.object({ value: z.string().min(1).max(80), label: z.string().max(120), color: z.string().max(20).optional(), order: z.number().optional(), active: z.boolean().optional() });
const fieldSchema = z.object({
  name: z.string().regex(/^u_[a-z0-9_]{1,40}$/, "نام فنی فیلد باید با u_ شروع شود"),
  label: z.string().trim().min(1).max(80),
  type: z.enum(STUDIO_TYPES as [string, ...string[]]),
  choices: z.string().max(80).nullish(),
  options: z.array(optionSchema).max(200).nullish(),
  ref: z.string().max(63).nullish(),
  required: z.boolean().optional(),
  list: z.boolean().optional(),
  search: z.boolean().optional(),
  filter: z.boolean().optional(),
  help: z.string().max(300).nullish(),
  section: z.string().max(80).nullish(),
  max_length: z.number().int().min(1).max(100000).nullish(),
  sort_order: z.number().int().nullish(),
});

adminTenantRoutes.get("/studio", async (c) => c.json(await studioOverview(c.get("ctx"))));

adminTenantRoutes.post("/studio/tables", async (c) => {
  const input = await body(
    c,
    z.object({
      label: z.string().trim().min(2, "نام جدول را وارد کنید").max(60),
      plural: z.string().trim().max(70).nullish(),
      description: z.string().max(2000).nullish(),
      icon: z.string().max(40).nullish(),
      code: z.string().max(30).nullish(),
      fields: z.array(fieldSchema).max(120).optional(),
    }),
  );
  return c.json(await createCustomTable(c.get("ctx"), input as Parameters<typeof createCustomTable>[1]));
});

adminTenantRoutes.get("/studio/fields/:table", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "edit");
  return c.json({ fields: await fieldsOf(ctx.db, ctx, c.req.param("table")) });
});

adminTenantRoutes.put("/studio/fields/:table", async (c) => {
  const input = await body(c, z.object({ fields: z.array(fieldSchema).max(120) }));
  return c.json(await saveFields(c.get("ctx"), c.req.param("table"), input.fields as Parameters<typeof saveFields>[2]));
});

adminTenantRoutes.delete("/studio/tables/:slot", async (c) => {
  await deleteCustomTable(c.get("ctx"), c.req.param("slot"));
  return c.json({ ok: true });
});

adminTenantRoutes.post("/studio/tables/:slot/publish", async (c) => {
  const input = await body(c, z.object({ note: z.string().max(300).nullish() }));
  return c.json({ version: await publishTable(c.get("ctx"), c.req.param("slot"), input.note ?? null) });
});

adminTenantRoutes.post("/studio/versions/:id/restore", async (c) => c.json(await restoreVersion(c.get("ctx"), uuid(c.req.param("id"), "نسخه"))));

adminTenantRoutes.get("/studio/export", async (c) => {
  const slots = (c.req.query("slots") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const pkg = await exportPackage(c.get("ctx"), { slots, builtins: c.req.query("builtins") !== "0" });
  return c.json(pkg);
});

adminTenantRoutes.post("/studio/import", async (c) => {
  const input = await body(c, z.object({ package: z.unknown(), dry_run: z.boolean().default(true) }));
  return c.json(await importPackage(c.get("ctx"), input.package, { dryRun: input.dry_run }));
});

/** A table drafted from a Persian description (the AI skill, or the rule-based draft without a model). */
adminTenantRoutes.post("/studio/draft", async (c) => {
  const ctx = c.get("ctx");
  await needStudio(ctx);
  const input = await body(c, z.object({ description: z.string().trim().min(5, "شرح جدول را بنویسید").max(2000) }));
  let draft = draftFromText(input.description);
  let ai = false;
  let model: string | null = null;
  try {
    const r = await runSkill(ctx, "admin.studio_draft", { params: { description: input.description } }, { ephemeral: true });
    const j = r.json as { label?: string; plural?: string | null; description?: string | null; fields?: { label: string; type: string; options?: string[] | null; required?: boolean | null }[] } | null;
    if (j?.label && Array.isArray(j.fields) && !r.fallback) {
      draft = { label: j.label, plural: j.plural || `${j.label}‌ها`, description: j.description ?? input.description, icon: draft.icon, fields: draftFields({ label: j.label, fields: j.fields }) };
      ai = true;
      model = r.model;
    }
  } catch (e) {
    if (!isAiUnavailable(e)) throw e;
  }
  return c.json({ draft, ai, model });
});

// ---------------------------------------------------------------- import sets

adminTenantRoutes.post("/imports/suggest", async (c) => {
  const input = await body(c, z.object({ table: z.string().min(1).max(63), headers: z.array(z.string().max(200)).max(200), sample: z.array(z.record(z.string(), z.string())).max(5).default([]) }));
  return c.json(await suggestImport(c.get("ctx"), input.table, input.headers, input.sample));
});

adminTenantRoutes.post("/imports/:id/analyze", async (c) => c.json(await analyzeImport(c.get("ctx"), uuid(c.req.param("id"), "مجموعهٔ ورود"))));

adminTenantRoutes.post("/imports/:id/run", async (c) => {
  const input = await body(c, z.object({ dry_run: z.boolean().default(true) }));
  return c.json(await runImport(c.get("ctx"), uuid(c.req.param("id"), "مجموعهٔ ورود"), { dryRun: input.dry_run }));
});

// ---------------------------------------------------------------- exports

adminTenantRoutes.post("/exports", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "edit");
  const input = await body(
    c,
    z.object({ title: z.string().max(160).nullish(), tables: z.array(z.string().max(63)).min(1, "دست‌کم یک جدول انتخاب کنید").max(40), format: z.enum(["json", "csv", "xlsx"]).default("json"), include_journal: z.boolean().optional() }),
  );
  return c.json({ export: await requestExport(ctx, input) });
});

// ---------------------------------------------------------------- logs, jobs, seats, notices, defaults

adminTenantRoutes.get("/logs", async (c) => {
  const kind = (c.req.query("kind") ?? "jobs") as LogKind;
  if (!["jobs", "notifications", "flows", "integrations", "security"].includes(kind)) throw bad("نوع گزارش شناخته نیست");
  return c.json(await systemLogs(c.get("ctx"), kind, { status: c.req.query("status") || null, q: c.req.query("q") || null, before: c.req.query("before") || null }));
});

adminTenantRoutes.post("/jobs/:id/retry", async (c) => c.json(await orgJobAction(c.get("ctx"), uuid(c.req.param("id"), "کار"), "retry")));
adminTenantRoutes.post("/jobs/:id/cancel", async (c) => c.json(await orgJobAction(c.get("ctx"), uuid(c.req.param("id"), "کار"), "cancel")));

adminTenantRoutes.get("/licences", async (c) => c.json(await licences(c.get("ctx"))));

/** Notices in force — for every member (the bell links here). */
adminTenantRoutes.get("/notices/active", async (c) => c.json({ notices: await activeNotices(c.get("ctx")) }));

adminTenantRoutes.post("/notices", async (c) => {
  const input = await body(
    c,
    z.object({
      title: z.string().trim().min(3, "عنوان اطلاعیه را وارد کنید").max(160),
      body: z.string().max(10_000).optional(),
      severity: z.enum(["info", "warning", "critical", "maintenance"]).default("info"),
      starts_at: z.string().max(40).nullish(),
      ends_at: z.string().max(40).nullish(),
      publish: z.boolean().optional(),
    }),
  );
  return c.json({ notice: await createNotice(c.get("ctx"), input) });
});

adminTenantRoutes.post("/notices/:id/publish", async (c) => c.json(await publishNotice(c.get("ctx"), uuid(c.req.param("id"), "اطلاعیه"))));

/** «افزودن پیش‌فرض‌ها»: re-add the console's defaults that were deleted. */
adminTenantRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "full");
  return c.json(await seedAdminDefaults(ctx.cfg, ctx.org.id, { force: true }));
});
