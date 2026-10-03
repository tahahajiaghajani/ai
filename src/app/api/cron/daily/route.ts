import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/supabase/admin";
import type { ConnectionStateRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily maintenance: forget expired model blocks and pauses of users' AI connections. */
async function daily() {
  const { data } = await db().from("connection_state").select("*");
  const now = Date.now();
  for (const s of (data ?? []) as ConnectionStateRow[]) {
    const models = Object.fromEntries(Object.entries(s.models ?? {}).filter(([, v]) => v.blocked_until && new Date(v.blocked_until).getTime() > now));
    const pauseOver = s.paused_until && new Date(s.paused_until).getTime() < now;
    if (Object.keys(models).length !== Object.keys(s.models ?? {}).length || pauseOver) {
      await db()
        .from("connection_state")
        .update({ models, ...(pauseOver ? { paused_until: null, pause_reason: null } : {}) })
        .eq("connection_id", s.connection_id);
    }
  }
}

async function handle(req: NextRequest) {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  after(async () => {
    try {
      await daily();
    } catch (err) {
      console.error("daily failed", err);
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
