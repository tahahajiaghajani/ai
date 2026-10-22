import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Daily Vercel cron (vercel.json): one tiny read so the free Supabase project is never paused
 * for inactivity. When CRON_SECRET is set, Vercel sends it as a Bearer token and nothing else may call this.
 */
export async function GET(req: Request) {
  const secret = env.cronSecret;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const headers = { "cache-control": "no-store" };
  const c = db();
  if (!c) return Response.json({ ok: false, reason: "db_missing" }, { headers });
  const { error } = await c.from("pars_settings").select("key", { count: "exact", head: true });
  if (error) console.error("[keepalive]", error.message);
  return Response.json({ ok: !error }, { status: error ? 500 : 200, headers });
}
