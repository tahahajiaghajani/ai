import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase/admin";
import { mayAccessJob, runnerCaller } from "@/lib/runner-auth";
import { ingestRunnerEvents, type RunnerEvent } from "@/lib/claude/ingest";
import { logEvent } from "@/lib/events";
import type { Job } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Body {
  job_id?: string;
  events?: RunnerEvent[];
  /** push notifications from the workspace repo (manual edits in Claude Code / GitHub) */
  push?: { commits?: { message: string; url?: string; author?: string }[]; files?: string[]; ref?: string };
}

export async function POST(req: NextRequest) {
  const caller = runnerCaller(req);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.push) {
    if (caller.kind === "user") await handlePush(caller.userId, body.push);
    return NextResponse.json({ ok: true });
  }

  if (!body.job_id || !Array.isArray(body.events)) return NextResponse.json({ error: "job_id and events required" }, { status: 400 });
  const { data: job } = await db().from("jobs").select("*").eq("id", body.job_id).maybeSingle<Job>();
  if (!job || !mayAccessJob(caller, job)) return NextResponse.json({ error: "job not found" }, { status: 404 });
  if (job.status === "cancelled") return NextResponse.json({ ok: false, cancelled: true });

  await ingestRunnerEvents(job, body.events.slice(0, 500));
  return NextResponse.json({ ok: true });
}

/** Commits made outside the app (manual work in Claude Code or on GitHub) show up in the project's activity. */
async function handlePush(userId: string, push: NonNullable<Body["push"]>) {
  const files = push.files ?? [];
  const roots = [...new Set(files.map((f) => f.split("/").slice(0, 2).join("/")).filter((p) => p.startsWith("projects/") || p.startsWith("tasks/")))];
  for (const path of roots) {
    const changed = files.filter((f) => f.startsWith(`${path}/`));
    const base = {
      source: "github" as const,
      kind: "commit" as const,
      title: `تغییر دستی در GitHub: ${changed.length} فایل (${push.commits?.[0]?.message?.split("\n")[0] ?? "commit"})`,
      detail: changed.slice(0, 40).join("\n"),
      data: { url: push.commits?.[0]?.url, author: push.commits?.[0]?.author },
    };
    if (path.startsWith("projects/")) {
      const { data: project } = await db().from("projects").select("id").eq("owner_id", userId).eq("root_path", path).maybeSingle();
      if (project) await logEvent({ ...base, project_id: project.id as string });
    } else {
      const { data: task } = await db().from("tasks").select("id").eq("assignee_id", userId).eq("github_path", path).is("parent_id", null).maybeSingle();
      if (task) await logEvent({ ...base, task_id: task.id as string });
    }
  }
}
