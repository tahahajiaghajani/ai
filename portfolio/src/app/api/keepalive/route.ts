import { db } from "@/lib/db";
import { env } from "@/lib/env";

/** Daily cron (vercel.json): one tiny query so the free Supabase project never pauses for inactivity. */
export async function GET(req: Request) {
  if (env.cronSecret && req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const c = db();
  if (!c) return Response.json({ ok: true, db: false });
  const { error } = await c.from("portfolio_rate_limits").select("key", { head: true, count: "exact" }).limit(1);
  return Response.json({ ok: !error, db: true }, { headers: { "cache-control": "no-store" } });
}
