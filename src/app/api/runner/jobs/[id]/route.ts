import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase/admin";
import { mayAccessJob, runnerCaller } from "@/lib/runner-auth";
import { buildRunnerSpec } from "@/lib/claude/spec";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/runner/jobs/[id]">) {
  const caller = runnerCaller(req);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const { data: job } = await db().from("jobs").select("*").eq("id", id).maybeSingle<Job>();
  if (!job || !mayAccessJob(caller, job)) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status !== "running") return NextResponse.json({ error: `job is ${job.status}`, cancelled: job.status === "cancelled" }, { status: 409 });
  try {
    return NextResponse.json(await buildRunnerSpec(job));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
