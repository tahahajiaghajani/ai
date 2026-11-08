// HTTP API of service requests and the catalogue (docs/modules/request_FA.md «API»), under /api/o/:org/request. The
// catalogue's definition and the records themselves are also served by the generic engine API (/r/catalog_item,
// /r/request_item…); these routes are the special operations. Every handler checks access through the provider (the
// services do: entitlement, ordering for others, the caller's read and write access to records) and validates input.
//   ordering    GET /catalog · GET /catalog/items/:id · POST /catalog/items/:id/check · POST /guides/:id/expand ·
//               GET|PATCH /cart · POST /cart/lines · PATCH|DELETE /cart/lines/:id · POST /cart/checkout · POST /order
//   records     GET /answers/:table/:id · PUT /items/:id/answers · POST /items/:id/reveal · POST /items/:id/info ·
//               GET /items/:id/reorder · POST /items/:id/change-item · POST /items/:id/convert · GET /items/:id/progress
//   builder     GET /builder/:id · POST /builder/:id/publish · POST /builder/:id/approval · POST /builder/:id/approval/bind ·
//               POST /builder/:id/flow · POST /builder/:id/copy · GET /builder/:id/audience
//   other       GET /dashboard · GET /config · POST /seed · POST /ai/generate · POST /ai/prefill
import { z } from "zod";
import { tableDef } from "@shared/tables";
import { checkAnswers, isEmptyAnswer } from "@shared/request/form";
import { router, body, query } from "../http/hono";
import { AppError, forbidden } from "../http/errors";
import { access } from "../access/provider";
import { condEnv } from "../engine";
import {
  addLine, answersView, audienceCheck, bindApprovalRule, bindExistingRule, browse, cartView, changeItem, checkItem, checkoutCart, convertToIncident, copyItem, createFlow,
  definition, editAnswers, expandGuide, itemForm, placeOrder, progress, promptSafe, publishItem, removeLine, reorder, requestAi, requestAiCapabilities, requestConfig,
  requestDashboard, requestInfo, revealSecret, seedRequestDefaults, updateCart, updateLine, versionSchema,
} from "../modules/request";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ معتبر نیست (YYYY-MM-DD)");
const ANSWERS = z.record(z.string(), z.unknown()).optional();
const id = (c: { req: { param: (k: string) => string } }, k = "id") => UUID.parse(c.req.param(k));

const LINE = z.object({
  item_id: UUID,
  answers: ANSWERS,
  quantity: z.number().int().min(1).max(1000).optional(),
  requested_for: UUID.nullish(),
  requested_for_list: z.array(UUID).max(100).nullish(),
  guide_id: UUID.nullish(),
  version_id: UUID.nullish(),
});
const HEADER = {
  requested_for: UUID.nullish(),
  needed_by: DATE.nullish(),
  location_id: UUID.nullish(),
  cost_center_id: UUID.nullish(),
  instructions: z.string().max(20000).nullish(),
  channel: z.enum(["portal", "phone", "email", "chat", "walk_in", "assistant", "api"]).nullish(),
  guides: z.array(z.object({ id: UUID, answers: ANSWERS })).max(10).optional(),
};

const notAvailable = () => new AppError(501, "not_available", "این قابلیت هوش مصنوعی هنوز در این سامانه فعال نیست");

export const requestRoutes = router();

// ----- ordering ------------------------------------------------------------------------------------------------

requestRoutes.get("/catalog", async (c) => {
  const q = query(c, z.object({ q: z.string().max(200).optional(), catalog: UUID.optional(), category: UUID.optional(), for: UUID.optional(), ids: z.string().max(4000).optional() }));
  return c.json(await browse(c.get("ctx"), { q: q.q, catalog: q.catalog, category: q.category, for: q.for, ids: q.ids ? q.ids.split(",").filter(Boolean) : undefined }));
});

requestRoutes.get("/catalog/items/:id", async (c) => {
  const q = query(c, z.object({ for: UUID.optional() }));
  return c.json(await itemForm(c.get("ctx"), id(c), { for: q.for }));
});

requestRoutes.post("/catalog/items/:id/check", async (c) => {
  const input = await body(c, z.object({ answers: ANSWERS, quantity: z.number().int().min(1).max(1000).optional(), for: UUID.nullish() }));
  return c.json(await checkItem(c.get("ctx"), id(c), { answers: input.answers, quantity: input.quantity, for: input.for }));
});

requestRoutes.post("/guides/:id/expand", async (c) => {
  const input = await body(c, z.object({ answers: ANSWERS, for: UUID.nullish() }));
  return c.json(await expandGuide(c.get("ctx"), id(c), { answers: input.answers, for: input.for }));
});

requestRoutes.get("/cart", async (c) => c.json(await cartView(c.get("ctx"))));

requestRoutes.patch("/cart", async (c) => {
  const input = await body(c, z.object({ requested_for: UUID.nullish(), location_id: UUID.nullish(), needed_by: DATE.nullish(), cost_center_id: UUID.nullish(), instructions: z.string().max(2000).nullish() }));
  await updateCart(c.get("ctx"), input);
  return c.json(await cartView(c.get("ctx")));
});

requestRoutes.post("/cart/lines", async (c) => {
  const input = await body(c, LINE.extend({ saved: z.boolean().optional() }));
  const line = await addLine(c.get("ctx"), input);
  return c.json({ line, cart: await cartView(c.get("ctx")) });
});

requestRoutes.patch("/cart/lines/:id", async (c) => {
  const input = await body(c, LINE.partial().extend({ saved: z.boolean().optional() }));
  const line = await updateLine(c.get("ctx"), id(c), input);
  return c.json({ line, cart: await cartView(c.get("ctx")) });
});

requestRoutes.delete("/cart/lines/:id", async (c) => {
  await removeLine(c.get("ctx"), id(c));
  return c.json({ cart: await cartView(c.get("ctx")) });
});

requestRoutes.post("/cart/checkout", async (c) => {
  const input = await body(c, z.object(HEADER));
  return c.json(await checkoutCart(c.get("ctx"), input));
});

requestRoutes.post("/order", async (c) => {
  const input = await body(c, z.object({ ...HEADER, lines: z.array(LINE).min(1).max(50) }));
  return c.json(await placeOrder(c.get("ctx"), input));
});

// ----- records -------------------------------------------------------------------------------------------------

requestRoutes.get("/answers/:table/:id", async (c) => {
  const table = z.enum(["request_item", "request_task"]).parse(c.req.param("table"));
  return c.json(await answersView(c.get("ctx"), table, id(c)));
});

requestRoutes.put("/items/:id/answers", async (c) => {
  const input = await body(c, z.object({ answers: ANSWERS, version: z.number().int().nullish() }));
  return c.json(await editAnswers(c.get("ctx"), id(c), input));
});

requestRoutes.post("/items/:id/reveal", async (c) => {
  const input = await body(c, z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/) }));
  return c.json(await revealSecret(c.get("ctx"), id(c), input.name));
});

requestRoutes.post("/items/:id/info", async (c) => {
  const input = await body(c, z.object({ message: z.string().max(20000) }));
  return c.json({ row: await requestInfo(c.get("ctx"), id(c), input) });
});

requestRoutes.get("/items/:id/reorder", async (c) => c.json(await reorder(c.get("ctx"), id(c))));

requestRoutes.post("/items/:id/change-item", async (c) => {
  const input = await body(c, z.object({ item_id: UUID, force: z.boolean().optional() }));
  return c.json({ row: await changeItem(c.get("ctx"), id(c), input) });
});

requestRoutes.post("/items/:id/convert", async (c) => {
  const input = await body(c, z.object({ note: z.string().max(4000).optional() }));
  return c.json(await convertToIncident(c.get("ctx"), id(c), input));
});

requestRoutes.get("/items/:id/progress", async (c) => c.json(await progress(c.get("ctx"), id(c))));

// ----- builder -------------------------------------------------------------------------------------------------

requestRoutes.get("/builder/:id", async (c) => c.json(await definition(c.get("ctx"), id(c))));

requestRoutes.post("/builder/:id/publish", async (c) => {
  const input = await body(c, z.object({ note: z.string().max(300).nullish(), version: z.number().int().nullish() }));
  return c.json(await publishItem(c.get("ctx"), id(c), input));
});

requestRoutes.post("/builder/:id/approval", async (c) => {
  const input = await body(c, z.object({ name: z.string().max(120).optional(), mode: z.enum(["sequential", "parallel"]).optional(), levels: z.array(z.unknown()).max(10).optional(), expire_after: z.number().int().min(0).nullish(), remind_every: z.number().int().min(0).nullish() }));
  return c.json({ rule: await bindApprovalRule(c.get("ctx"), id(c), input) });
});

requestRoutes.post("/builder/:id/approval/bind", async (c) => {
  const input = await body(c, z.object({ rule_id: UUID }));
  return c.json({ item: await bindExistingRule(c.get("ctx"), id(c), input.rule_id) });
});

requestRoutes.post("/builder/:id/flow", async (c) => c.json({ flow: await createFlow(c.get("ctx"), id(c)) }));

requestRoutes.post("/builder/:id/copy", async (c) => c.json({ item: await copyItem(c.get("ctx"), id(c)) }));

requestRoutes.get("/builder/:id/audience", async (c) => {
  const q = query(c, z.object({ user: UUID }));
  return c.json(await audienceCheck(c.get("ctx"), id(c), q.user));
});

// ----- other ---------------------------------------------------------------------------------------------------

requestRoutes.get("/dashboard", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(1).max(365).optional() }));
  return c.json(await requestDashboard(c.get("ctx"), { days: q.days }));
});

requestRoutes.get("/config", async (c) => {
  const ctx = c.get("ctx");
  const cfg = await requestConfig(ctx.db, ctx);
  return c.json({ config: cfg, ai: requestAiCapabilities(), can_admin: access().canCreate(ctx, tableDef("catalog_item")!) });
});

requestRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ force: z.boolean().optional() }));
  if (!access().canCreate(ctx, tableDef("catalog")!) || !access().canCreate(ctx, tableDef("catalog_item")!)) throw forbidden("افزودن پیش‌فرض‌های کاتالوگ با مدیر کاتالوگ است");
  return c.json(await seedRequestDefaults(ctx.cfg, ctx.org.id, { force: input.force ?? true }));
});

requestRoutes.post("/ai/generate", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ text: z.string().min(3).max(8000), catalog_id: UUID.nullish() }));
  if (!access().canCreate(ctx, tableDef("catalog_item")!)) throw forbidden("اجازهٔ ساختن قلم کاتالوگ را ندارید");
  const ai = requestAi();
  if (!ai.generateItem) throw notAvailable();
  return c.json({ draft: await ai.generateItem(ctx, { text: input.text, catalogId: input.catalog_id ?? null }) });
});

requestRoutes.post("/ai/prefill", async (c) => {
  const ctx = c.get("ctx");
  const input = await body(c, z.object({ item_id: UUID, text: z.string().min(3).max(8000) }));
  const ai = requestAi();
  if (!ai.prefill) throw notAvailable();
  const form = await itemForm(ctx, input.item_id);
  const full = (await versionSchema(ctx.db, ctx, form.version_id)) ?? form.schema;
  const safe = promptSafe(full, {});
  const out = await ai.prefill(ctx, { itemId: input.item_id, schema: safe.schema, text: input.text });
  // only answers the form knows, checked like any answers; «complete» when every required answer is there
  const checked = checkAnswers(full, out.answers ?? {}, { mode: "order", env: await condEnv(ctx) });
  const missing = Object.keys(checked.errors).filter((k) => isEmptyAnswer((out.answers ?? {})[k]));
  return c.json({ answers: checked.answers, confidence: out.confidence ?? {}, complete: Object.keys(checked.errors).length === 0, missing });
});
