// HTTP API of the discovery module under /api/o/:org/discovery (design A §4, §15; docs/modules/discovery_FA.md «API»).
// Connector records themselves are also served by the generic engine API (/r/discovery_connector…) under the same
// connector guard; these routes are what the console, the connector page, the wizard and the reconciliation queue need
// beyond it. Every handler checks the caller's rights before anything leaves the server (service.ts); the Windows app
// answers none of them: «منبع‌های داده و وضعیت پایش روی سرور اجرا و دیده می‌شوند» (§14.7).
//
//   GET    /meta                                  edition, rights, the kinds offered here, the words
//   GET    /connectors                            the console's cards
//   POST   /connectors                            create (the engine, the guard)
//   GET    /connectors/:id                        the record, its card, the caller's rights over it
//   PATCH  /connectors/:id                        change (the engine, the guard)
//   DELETE /connectors/:id                        soft delete (the guard: the source goes inactive, items gone)
//   POST   /connectors/:id/test                   «آزمودن اتصال»
//   POST   /connectors/:id/preview                «پیش‌نمایش» (a draft mapping/options/class/policy may be tried)
//   POST   /connectors/:id/run                    «اجرای اکنون»
//   POST   /connectors/:id/reapply                «اعمال دوباره روی همه»
//   POST   /connectors/:id/cancel                 «لغو» the running pass
//   POST   /connectors/:id/approve-directory      an integrations administrator's approval (§14.8)
//   GET    /connectors/:id/runs                   passes, newest first
//   GET    /connectors/:id/items                  items (state, search)
//   POST   /runs/:id/accept                       «پذیرش اندازهٔ تازه»
//   GET    /queue?tab=unmatched|duplicate|error|mismatch|no_asset     «صف آشتی» («بی‌دارایی» with its roll-up per connector)
//   POST   /items/:id/create                      «ساخت پیکربندی»
//   POST   /items/:id/link        { ci_id }       «پیوند به…»
//   POST   /items/:id/ignore                      «نادیده گرفتن»
//   POST   /items/:id/mismatch/dismiss            «نادیده گرفتن» of the differences with the asset register
//   POST   /items/:id/mismatch/apply  { field }   «به‌روزرسانی دارایی با مقدار ابزار»
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { create, remove, update } from "../engine";
import {
  acceptSize, applyMismatchAs, approveDirectory, cancelPass, connectorCards, connectorItems, connectorPage, connectorRuns, createCiFor, discoveryMeta,
  dismissMismatchAs, ignoreItem, linkItem, previewAs, QUEUE_TABS, reconcileQueue, refuseDesktop, runNow, testConnection, needReader,
} from "../modules/discovery/service";
import { MAX_PREVIEW_ROWS } from "../modules/discovery/runner";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const record = z.record(z.string(), z.unknown());
const paging = { page: z.coerce.number().int().min(1).max(100_000).optional(), size: z.coerce.number().int().min(1).max(500).optional() };

export const discoveryRoutes = router();

// the Windows app neither runs nor shows connectors (§14.7)
discoveryRoutes.use("*", async (c, next) => {
  refuseDesktop(c.get("ctx"));
  await next();
});

discoveryRoutes.get("/meta", async (c) => c.json(await discoveryMeta(c.get("ctx"))));

// ---------------------------------------------------------------------------------------------------------------
// Connectors

discoveryRoutes.get("/connectors", async (c) => c.json({ connectors: await connectorCards(c.get("ctx")) }));

discoveryRoutes.post("/connectors", async (c) => {
  const ctx = c.get("ctx");
  await needReader(ctx);
  return c.json(await create(ctx, "discovery_connector", await body(c, record)), 201);
});

discoveryRoutes.get("/connectors/:id", async (c) => c.json(await connectorPage(c.get("ctx"), id(c.req.param("id")))));

discoveryRoutes.patch("/connectors/:id", async (c) => {
  const ctx = c.get("ctx");
  await needReader(ctx);
  const input = await body(c, record);
  const version = typeof input.version === "number" ? input.version : undefined;
  delete input.version;
  return c.json(await update(ctx, "discovery_connector", id(c.req.param("id")), input, version !== undefined ? { version } : {}));
});

discoveryRoutes.delete("/connectors/:id", async (c) => {
  const ctx = c.get("ctx");
  await needReader(ctx);
  return c.json(await remove(ctx, "discovery_connector", id(c.req.param("id"))));
});

discoveryRoutes.post("/connectors/:id/test", async (c) => c.json(await testConnection(c.get("ctx"), id(c.req.param("id")))));

const draft = z.object({
  mapping: z.record(z.string().max(120), z.string().max(500)).optional(),
  options: record.optional(),
  default_class: z.string().max(63).nullish(),
  create_policy: z.enum(["create", "review", "match_only"]).optional(),
});

discoveryRoutes.post("/connectors/:id/preview", async (c) => {
  const input = await body(c, z.object({ draft: draft.optional(), limit: z.number().int().min(1).max(MAX_PREVIEW_ROWS).optional() }));
  return c.json(await previewAs(c.get("ctx"), id(c.req.param("id")), input.draft ?? {}, input.limit));
});

discoveryRoutes.post("/connectors/:id/run", async (c) => c.json(await runNow(c.get("ctx"), id(c.req.param("id")))));
discoveryRoutes.post("/connectors/:id/reapply", async (c) => c.json(await runNow(c.get("ctx"), id(c.req.param("id")), { reapply: true })));
discoveryRoutes.post("/connectors/:id/cancel", async (c) => c.json(await cancelPass(c.get("ctx"), id(c.req.param("id")))));
discoveryRoutes.post("/connectors/:id/approve-directory", async (c) => c.json(await approveDirectory(c.get("ctx"), id(c.req.param("id")))));

discoveryRoutes.get("/connectors/:id/runs", async (c) => {
  const qp = query(c, z.object({ lane: z.enum(["inventory", "status", "push", "preview"]).optional(), ...paging }));
  return c.json(await connectorRuns(c.get("ctx"), id(c.req.param("id")), qp));
});

discoveryRoutes.get("/connectors/:id/items", async (c) => {
  const qp = query(c, z.object({ state: z.enum(["linked", "unmatched", "duplicate", "ignored", "gone", "error", "pending"]).optional(), q: z.string().max(200).optional(), ...paging }));
  return c.json(await connectorItems(c.get("ctx"), id(c.req.param("id")), qp));
});

discoveryRoutes.post("/runs/:id/accept", async (c) => c.json(await acceptSize(c.get("ctx"), id(c.req.param("id")))));

// ---------------------------------------------------------------------------------------------------------------
// The reconciliation queue

discoveryRoutes.get("/queue", async (c) => {
  const qp = query(c, z.object({ tab: z.enum(QUEUE_TABS).default("unmatched"), connector: UUID.optional(), q: z.string().max(200).optional(), ...paging }));
  return c.json(await reconcileQueue(c.get("ctx"), qp));
});

discoveryRoutes.post("/items/:id/create", async (c) => c.json(await createCiFor(c.get("ctx"), id(c.req.param("id")))));

discoveryRoutes.post("/items/:id/link", async (c) => {
  const input = await body(c, z.object({ ci_id: UUID }));
  return c.json(await linkItem(c.get("ctx"), id(c.req.param("id")), input.ci_id.toLowerCase()));
});

discoveryRoutes.post("/items/:id/ignore", async (c) => c.json(await ignoreItem(c.get("ctx"), id(c.req.param("id")))));
discoveryRoutes.post("/items/:id/mismatch/dismiss", async (c) => c.json(await dismissMismatchAs(c.get("ctx"), id(c.req.param("id")))));

discoveryRoutes.post("/items/:id/mismatch/apply", async (c) => {
  const input = await body(c, z.object({ field: z.enum(["assigned_to", "location_id", "asset_tag", "serial_number"]) }));
  return c.json(await applyMismatchAs(c.get("ctx"), id(c.req.param("id")), input.field));
});
