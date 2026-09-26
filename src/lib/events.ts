import "server-only";
import { after } from "next/server";
import { db } from "@/lib/supabase/admin";
import type { EventKind, EventSource } from "@/lib/types";

export interface LogInput {
  task_id?: string | null;
  upgrade_id?: string | null;
  job_id?: string | null;
  source?: EventSource;
  kind?: EventKind;
  title: string;
  detail?: string | null;
  data?: Record<string, unknown> | null;
  visibility?: "internal" | "requester";
  actor_id?: string | null;
}

const MAX_DETAIL = 12_000;

/**
 * Runs a non-critical write (activity log, notification) after the response has been sent, so a
 * button press does not wait for it. Outside a request (tests, scripts) it just runs in the background.
 */
export function background(fn: () => Promise<unknown>) {
  const run = () => fn().catch((err) => console.error("background", err));
  try {
    after(run);
  } catch {
    void run();
  }
}

function normalize(e: LogInput) {
  return {
    task_id: e.task_id ?? null,
    upgrade_id: e.upgrade_id ?? null,
    job_id: e.job_id ?? null,
    source: e.source ?? "system",
    kind: e.kind ?? "log",
    title: e.title.slice(0, 500),
    detail: e.detail ? e.detail.slice(0, MAX_DETAIL) : null,
    data: e.data ?? null,
    visibility: e.visibility ?? "internal",
    actor_id: e.actor_id ?? null,
  };
}

/** Append one or more entries to the live log. Never throws (logging must not break work). */
export async function logEvents(events: LogInput[]) {
  if (!events.length) return;
  try {
    const { error } = await db().from("task_events").insert(events.map(normalize));
    if (error) console.error("logEvents", error.message);
  } catch (err) {
    console.error("logEvents", err);
  }
}

export async function logEvent(e: LogInput) {
  await logEvents([e]);
}

/** In-app notification; written after the response (see `background`). */
export async function notify(userId: string | null | undefined, n: { title: string; body?: string; link?: string; task_id?: string | null }) {
  if (!userId) return;
  background(async () => {
    const { error } = await db().from("notifications").insert({
      user_id: userId,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      task_id: n.task_id ?? null,
    });
    if (error) console.error("notify", error.message);
  });
}

export async function notifyAdmins(n: { title: string; body?: string; link?: string; task_id?: string | null }) {
  background(async () => {
    const { data } = await db().from("profiles").select("id").eq("role", "admin").eq("status", "active");
    await Promise.all((data ?? []).map((a) => notify(a.id, n)));
  });
}
