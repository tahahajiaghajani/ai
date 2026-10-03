import { requireFull } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { DEFAULT_PROMPTS } from "@/lib/ai/prompts";
import { getAgents, SYSTEM_AGENT_LABELS } from "@/lib/workflow/registry";
import { LearningClient } from "./learning-client";

export const metadata = { title: "یادگیری" };

export default async function LearningPage(props: PageProps<"/learning">) {
  const me = await requireFull();
  const { agent } = await props.searchParams;
  const [prompts, feedback, projects, registry] = await Promise.all([
    db().from("agent_prompts").select("*").eq("user_id", me.id).order("version", { ascending: false }),
    db().from("feedback").select("agent, rating, comment, created_at").eq("created_by", me.id).order("created_at", { ascending: false }).limit(300),
    db().from("projects").select("id", { count: "exact", head: true }).eq("owner_id", me.id),
    getAgents(me.id),
  ]);
  // every workflow agent (built-in and custom) plus the system ones
  const agents = [
    ...registry.filter((a) => a.type !== "coder" || a.prompt).map((a) => ({ key: a.id, label: a.name, defaultPrompt: a.prompt })),
    ...Object.entries(SYSTEM_AGENT_LABELS).map(([key, label]) => ({ key, label, defaultPrompt: DEFAULT_PROMPTS[key as keyof typeof DEFAULT_PROMPTS] ?? "" })),
  ];
  return (
    <LearningClient
      agents={agents}
      initialAgent={typeof agent === "string" ? agent : undefined}
      versions={(prompts.data ?? []) as { id: string; agent: string; version: number; content: string; is_active: boolean; source: string; rationale: string | null; created_at: string }[]}
      feedback={(feedback.data ?? []) as { agent: string; rating: number; comment: string | null; created_at: string }[]}
      projectCount={projects.count ?? 0}
    />
  );
}
