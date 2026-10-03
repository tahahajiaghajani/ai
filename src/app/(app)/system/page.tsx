import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { getSystemSettings } from "@/lib/settings";
import { SystemClient, type LaneRow } from "./system-client";

export const metadata = { title: "سیستم و سرویس‌ها" };

/** Owner only: the shared Vercel / Supabase parts, the scheduler, worker lanes and registration. */
export default async function SystemPage() {
  await requireOwner();
  const [settings, lanes, users, conns] = await Promise.all([
    getSystemSettings(true),
    db().from("worker_lanes").select("*").order("lane"),
    db().from("profiles").select("id, status, mode"),
    db().from("user_connections").select("user_id, kind"),
  ]);
  const people = (users.data ?? []) as { id: string; status: string; mode: string }[];
  const c = (conns.data ?? []) as { user_id: string; kind: string }[];
  return (
    <SystemClient
      settings={settings}
      lanes={(lanes.data ?? []) as LaneRow[]}
      info={{ appUrl: env.appUrl, budget: Math.round(env.workerBudgetMs / 1000), appRepo: env.githubToken ? `${env.githubOwner || "?"}/${env.githubAppRepo}` : null }}
      stats={{
        users: people.filter((p) => p.status === "active").length,
        pending: people.filter((p) => p.status === "pending").length,
        full: people.filter((p) => p.status === "active" && p.mode === "full").length,
        withAi: new Set(c.filter((x) => x.kind === "ai").map((x) => x.user_id)).size,
        withGithub: new Set(c.filter((x) => x.kind === "github").map((x) => x.user_id)).size,
      }}
    />
  );
}
