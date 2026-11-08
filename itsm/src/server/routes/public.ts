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

publicRoutes.use("*", rateLimit(PUBLIC_LIMIT));
publicRoutes.use("*", async (c, next) => {
  await next();
  c.header("X-Robots-Tag", "noindex");
  if (c.req.method === "GET") c.header("Access-Control-Allow-Origin", "*");
});
