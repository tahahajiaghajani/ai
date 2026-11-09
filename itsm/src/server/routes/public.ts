// /api/public — the sign-in-free API: only what a module publishes on purpose (the status page an organisation
// published by a secret link; next, public knowledge). Every request is rate limited per client (PUBLIC_LIMIT), GETs
// may be read from any origin, nothing is indexed by search engines, and no route opens a member's context: a handler
// resolves its own published token to an organisation and reads as the system, then returns a projection of what was
// published (never record ids, numbers or people). Modules add their endpoints here (`publicRoutes.get("/<thing>/:key"
// …)`); the page people see is a sign-in-free SPA page at /p/… (`ModuleUi.publicRoutes`, docs/spec/UI_RECORDS.md).
import { router } from "../http/hono";
import { rateLimit, type RateLimitOptions } from "../http/ratelimit";

/** The budget of a client on the sign-in-free routes: 120 requests a minute (a page polls every minute or two). */
export const PUBLIC_LIMIT: RateLimitOptions = { name: "public", limit: 120, windowMs: 60_000 };

export const publicRoutes = router();

const exempt: { method: string; path: RegExp }[] = [];

/**
 * Leave a keyed endpoint out of the per-client budget: machines (a monitoring tool, a pipeline) send it many requests
 * from one address, and the endpoint limits each key itself (an event source's own `rate_limit`) and the requests
 * whose key is wrong per client.
 */
export function exemptFromPublicLimit(method: string, path: RegExp): void {
  exempt.push({ method: method.toUpperCase(), path });
}

const publicLimit = rateLimit(PUBLIC_LIMIT);
publicRoutes.use("*", (c, next) => (exempt.some((e) => e.method === c.req.method && e.path.test(c.req.path)) ? next() : publicLimit(c, next)));
publicRoutes.use("*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex");
  if (c.req.method === "GET") c.header("Access-Control-Allow-Origin", "*");
});
