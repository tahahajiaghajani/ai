// /api/admin/ai — platform AI policy and usage across businesses (never keys, prompts or
// conversations). Mounted by ./admin.ts behind the platform-admin check.
import { router, body } from "../http/hono";
import { platformAudit } from "../modules/platform/audit";
import { adminOverview } from "../modules/ai/admin";
import { loadPolicy, policyPatchSchema, savePolicy } from "../modules/ai/settings";

export const aiAdminRoutes = router();

aiAdminRoutes.get("/overview", async (c) => c.json(await adminOverview(c.get("cfg"))));

aiAdminRoutes.get("/policy", async (c) => c.json({ policy: await loadPolicy(c.get("cfg")) }));

aiAdminRoutes.put("/policy", async (c) => {
  const cfg = c.get("cfg");
  const patch = await body(c, policyPatchSchema);
  const before = await loadPolicy(cfg);
  const policy = await savePolicy(cfg, patch);
  const changes: string[] = [];
  if (before.kill_switch !== policy.kill_switch) changes.push(policy.kill_switch ? "هوش مصنوعی برای همهٔ کسب‌وکارها خاموش شد" : "هوش مصنوعی برای همهٔ کسب‌وکارها روشن شد");
  if (JSON.stringify(before.disabled_orgs) !== JSON.stringify(policy.disabled_orgs)) changes.push("فهرست کسب‌وکارهای بدون هوش مصنوعی تغییر کرد");
  if (JSON.stringify(before.allowed_presets) !== JSON.stringify(policy.allowed_presets) || JSON.stringify(before.allowed_protocols) !== JSON.stringify(policy.allowed_protocols)) changes.push("سرویس‌های مجاز تغییر کرد");
  if (before.default_monthly_cap_usd !== policy.default_monthly_cap_usd) changes.push("سقف ماهانهٔ پیش‌فرض تغییر کرد");
  await platformAudit(cfg.db, cfg, c.get("user"), {
    action: "ai_policy",
    entity: "ai_policy",
    summary: changes.join("؛ ") || "سیاست هوش مصنوعی ذخیره شد",
    data: { kill_switch: policy.kill_switch, disabled_orgs: policy.disabled_orgs.length, allowed_presets: policy.allowed_presets, allowed_protocols: policy.allowed_protocols, default_monthly_cap_usd: policy.default_monthly_cap_usd },
  });
  return c.json({ policy });
});
