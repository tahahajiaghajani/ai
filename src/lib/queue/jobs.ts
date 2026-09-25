import "server-only";
import { db, must } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { Job, JobKind, Provider } from "@/lib/types";

export const PROVIDER_OF: Record<JobKind, Provider> = {
  prework: "gemini",
  knowledge: "gemini",
  optimize: "gemini",
  graphify: "gemini",
  main: "claude",
  upgrade: "claude",
};

export async function enqueueJob(input: {
  kind: JobKind;
  task_id?: string | null;
  upgrade_id?: string | null;
  payload?: Record<string, unknown>;
  priority?: number;
  created_by?: string | null;
  run_after?: Date;
}): Promise<Job> {
  const row = must(
    await db()
      .from("jobs")
      .insert({
        kind: input.kind,
        provider: PROVIDER_OF[input.kind],
        task_id: input.task_id ?? null,
        upgrade_id: input.upgrade_id ?? null,
        payload: input.payload ?? {},
        priority: input.priority ?? 50,
        created_by: input.created_by ?? null,
        run_after: (input.run_after ?? new Date()).toISOString(),
      })
      .select("*")
      .single<Job>(),
    "ثبت کار در صف",
  );
  return row;
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

/** Human-friendly queue position for queued jobs of a provider (1-based). */
export async function queuePositions(provider: Provider): Promise<Map<string, number>> {
  const { data } = await db()
    .from("jobs")
    .select("id, task_id, priority, created_at")
    .eq("provider", provider)
    .eq("status", "queued")
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });
  const map = new Map<string, number>();
  (data ?? []).forEach((j, i) => map.set(j.id as string, i + 1));
  return map;
}
