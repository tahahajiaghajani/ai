// /api/o/:org/demo — the demo pack of the organisation (docs/DEMO_FA.md): its status, load (with a size), the
// pre-purge report and «حذف کامل داده‌های نمایشی» (typed confirmation + the platform's re-authentication gate). Only the
// organisation's administrators (`settings` full) reach it; the status line of the banner is open to every member.
import { z } from "zod";
import { router, body } from "../http/hono";
import { bad } from "../http/errors";
import { needRecentAuthOf } from "../auth/policy";
import { demoStatus, finalizeDemo, purgePreview, startDemoLoad, startDemoPurge } from "../modules/demo";

export const demoRoutes = router();

/** The phrase the administrator types to confirm the purge. */
export const PURGE_PHRASE = "حذف کامل";

demoRoutes.get("/banner", async (c) => {
  const ctx = c.get("ctx");
  const s = await demoStatus(ctx.db, ctx.org.id);
  return c.json({ active: s.state !== "none", state: s.state, bank: s.bank });
});

demoRoutes.get("/", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "full");
  return c.json(await demoStatus(ctx.db, ctx.org.id, { secrets: true }));
});

demoRoutes.post("/load", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "full");
  const input = await body(c, z.object({ size: z.enum(["small", "medium", "large"]), force: z.boolean().optional() }));
  needRecentAuthOf(c, ctx);
  // the audit line «داده‌های نمایشی بارگذاری شد» is written when the load ends (counts only)
  return c.json(await startDemoLoad(ctx, input));
});

demoRoutes.get("/report", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "full");
  return c.json(await purgePreview(ctx));
});

demoRoutes.post("/purge", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "full");
  const input = await body(c, z.object({ confirm: z.string() }));
  if (input.confirm.trim() !== PURGE_PHRASE) throw bad(`برای تأیید، عبارت «${PURGE_PHRASE}» را بنویسید`);
  needRecentAuthOf(c, ctx);
  return c.json(await startDemoPurge(ctx));
});

demoRoutes.post("/finalize", async (c) => {
  const ctx = c.get("ctx");
  ctx.need("settings", "full");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  needRecentAuthOf(c, ctx);
  return c.json(await finalizeDemo(ctx.cfg, ctx.org.id, { force: !!input.force }));
});
