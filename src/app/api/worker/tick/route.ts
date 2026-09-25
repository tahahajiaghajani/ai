import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runTick } from "@/lib/queue/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  return !!env.cronSecret && header === `Bearer ${env.cronSecret}`;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const chain = Number(req.headers.get("x-chain") ?? "0");
  const origin = req.nextUrl.origin;

  // Answer immediately (pg_net / Vercel cron must not wait); the work continues via after().
  after(async () => {
    try {
      const report = await runTick();
      if (report.more && chain < 60) {
        await fetch(`${origin}/api/worker/tick`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.cronSecret}`, "x-chain": String(chain + 1) },
          signal: AbortSignal.timeout(3_000),
          cache: "no-store",
        }).catch(() => undefined);
      }
    } catch (err) {
      console.error("tick failed", err);
    }
  });
  return NextResponse.json({ accepted: true, chain }, { status: 202 });
}

export const POST = handle;
export const GET = handle;
