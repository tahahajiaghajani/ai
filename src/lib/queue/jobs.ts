import "server-only";
import { db, must } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { Job, JobKind, Lane } from "@/lib/types";

const DEFAULT_LANE: Record<JobKind, Lane> = {
  prework: "llm",
  main: "llm",
  knowledge: "llm",
  index: "llm",
  optimize: "llm",
  import: "system",
  graphify: "external",
  upgrade: "external",
};

export async function enqueueJob(input: {
  kind: JobKind;
  owner_id: string | null;
  lane?: Lane;
  connection_id?: string | null;
  task_id?: string | null;
  upgrade_id?: string | null;
  project_id?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  created_by?: string | null;
  run_after?: Date;
}): Promise<Job> {
  return must(
    await db()
      .from("jobs")
      .insert({
        kind: input.kind,
        lane: input.lane ?? DEFAULT_LANE[input.kind],
        owner_id: input.owner_id,
        connection_id: input.connection_id ?? null,
        task_id: input.task_id ?? null,
        upgrade_id: input.upgrade_id ?? null,
        project_id: input.project_id ?? null,
        payload: input.payload ?? {},
        priority: input.priority ?? 50,
        created_by: input.created_by ?? null,
        run_after: (input.run_after ?? new Date()).toISOString(),
      })
      .select("*")
      .single<Job>(),
    "ثبت کار در صف",
  );
}

export async function activeJobs(taskId: string): Promise<Job[]> {
  const { data } = await db().from("jobs").select("*").eq("task_id", taskId).in("status", ["queued", "running"]);
  return (data ?? []) as Job[];
}

/**
 * Wake the worker immediately instead of waiting for the next pg_cron tick.
 * Fire-and-forget: the tick endpoint answers 202 right away.
 */
export async function kickWorker(origin?: string) {
  const base = origin || env.appUrl;
  if (!base || !env.cronSecret) return;
  try {
    await fetch(`${base}/api/worker/tick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.cronSecret}`, "x-kick": "1" },
      signal: AbortSignal.timeout(2_500),
      cache: "no-store",
    });
  } catch {
    /* the cron tick will pick it up */
  }
}

/** Human-friendly queue position of each queued job of a user in a lane (1-based). */
export async function queuePositions(ownerId: string | null, lane: Lane): Promise<Map<string, number>> {
  let q = db().from("jobs").select("id").eq("lane", lane).eq("status", "queued");
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data } = await q.order("priority", { ascending: false }).order("created_at", { ascending: true });
  const map = new Map<string, number>();
  (data ?? []).forEach((j, i) => map.set(j.id as string, i + 1));
  return map;
}
