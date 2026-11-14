// The discovery module's two other routers (design A §4, §12, §15):
//
//   /api/v1/discovery (the push API, an integration user's key through `apiAuth`: per-key rate limit, IP allow-list,
//   sm_int_log; push.ts checks the connector's push user, the scope and that the connector is active)
//     POST /:connector/batches            a batch of records (≤ 1 MB, ≤ 500), a snapshot part, a problem set → 202
//                                         (the same batch id again → 200 with the stored outcome, `duplicate`)
//     GET  /:connector/batches/:batch     the batch's state and counts
//     POST /:connector/status             statuses only (≤ 1 000 items; ≤ 200 answered at once, more queued → 202)
//
//   /api/o/:org/discovery (signed-in people; the engine's read rules of the CI and the asset, status.ts)
//     GET  /status?chip=&q=&page=&size=   the board «وضعیت پایش»
//     GET  /panel/:table/:id              the side panel «منبع‌ها و وضعیت پایش» of a CI or an asset
// The Windows app answers none of them (§14.7).
import { z } from "zod";
import { router, query, type C } from "../http/hono";
import { bad } from "../http/errors";
import { apiAuth } from "../modules/integration/api";
import { batchStatus, PUSH_LIMITS, PUSH_MESSAGES, receiveBatch, receiveStatus } from "../modules/discovery/push";
import { BOARD_CHIPS, statusBoard, statusPanel } from "../modules/discovery/status";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();

/** A JSON body of at most 1 MB (the push API's limit), parsed. */
async function jsonBody(c: C): Promise<unknown> {
  if (Number(c.req.header("content-length") ?? 0) > PUSH_LIMITS.bytes) throw bad(PUSH_MESSAGES.tooLarge);
  const raw = await c.req.text();
  if (Buffer.byteLength(raw, "utf8") > PUSH_LIMITS.bytes) throw bad(PUSH_MESSAGES.tooLarge);
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw bad(PUSH_MESSAGES.json);
  }
}

export const discoveryApiRoutes = router();

discoveryApiRoutes.use("*", apiAuth);

discoveryApiRoutes.post("/:connector/batches", async (c) => {
  const r = await receiveBatch(c.get("apiCaller"), id(c.req.param("connector")), await jsonBody(c), c.req.header("idempotency-key"));
  return c.json(r.body, r.status);
});

discoveryApiRoutes.get("/:connector/batches/:batch", async (c) => c.json(await batchStatus(c.get("apiCaller"), id(c.req.param("connector")), String(c.req.param("batch") ?? "").slice(0, 200))));

discoveryApiRoutes.post("/:connector/status", async (c) => {
  const r = await receiveStatus(c.get("apiCaller"), id(c.req.param("connector")), await jsonBody(c));
  return c.json(r.body, r.status);
});

export const discoveryStatusRoutes = router();

discoveryStatusRoutes.get("/status", async (c) => {
  const qp = query(c, z.object({ chip: z.enum(BOARD_CHIPS).optional(), q: z.string().max(200).optional(), page: z.coerce.number().int().min(1).max(1000).optional(), size: z.coerce.number().int().min(1).max(200).optional() }));
  return c.json(await statusBoard(c.get("ctx"), qp));
});

discoveryStatusRoutes.get("/panel/:table/:id", async (c) => {
  const table = z.enum(["ci", "asset"]).parse(c.req.param("table"));
  return c.json(await statusPanel(c.get("ctx"), table, id(c.req.param("id"))));
});
