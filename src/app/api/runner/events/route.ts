import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase/admin";
import { runnerAuthorized } from "@/lib/runner-auth";
import { ingestRunnerEvents, type RunnerEvent } from "@/lib/claude/ingest";
import { logEvent } from "@/lib/events";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  job_id?: string;
  events?: RunnerEvent[];
  /** push notifications from the workspace repo (manual edits in Claude / GitHub) */
  push?: { commits?: { message: string; url?: string; author?: string }[]; files?: string[]; ref?: string };
}

export async function POST(req: NextRequest) {
  if (!runnerAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.push) {
    await handlePush(body.push);
    return NextResponse.json({ ok: true });
  }

  if (!body.job_id || !Array.isArray(body.events)) return NextResponse.json({ error: "job_id and events required" }, { status: 400 });
  const { data: job } = await db().from("jobs").select("*").eq("id", body.job_id).maybeSingle<Job>();
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status === "cancelled") return NextResponse.json({ ok: false, cancelled: true });

  await ingestRunnerEvents(job, body.events.slice(0, 500));
  return NextResponse.json({ ok: true });
}

/** Commits made outside the app (e.g. manual work in Claude Code) are attached to their task's log. */
async function handlePush(push: NonNullable<Body["push"]>) {
  const files = push.files ?? [];
  const roots = [...new Set(files.map((f) => f.split("/").slice(0, 2).join("/")).filter((p) => p.startsWith("tasks/")))];
  for (const path of roots) {
    const { data: task } = await db().from("tasks").select("id, code").eq("github_path", path).is("parent_id", null).maybeSingle();
    if (!task) continue;
    const changed = files.filter((f) => f.startsWith(`${path}/`));
    await logEvent({
      task_id: task.id as string,
      source: "github",
      kind: "commit",
      title: `تغییر دستی در GitHub: ${changed.length} فایل (${push.commits?.[0]?.message?.split("\n")[0] ?? "commit"})`,
      detail: changed.slice(0, 40).join("\n"),
      data: { url: push.commits?.[0]?.url, author: push.commits?.[0]?.author },
    });
  }
}
