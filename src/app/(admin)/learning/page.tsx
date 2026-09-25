import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { AGENT_LABELS, DEFAULT_PROMPTS, type AgentKey } from "@/lib/ai/prompts";
import { LearningClient } from "./learning-client";

export const metadata = { title: "یادگیری و پرامپت‌ها" };

export default async function LearningPage() {
  await requireAdmin();
  const [prompts, feedback, knowledge] = await Promise.all([
    db().from("agent_prompts").select("*").order("version", { ascending: false }),
    db().from("feedback").select("agent, rating, comment, created_at").order("created_at", { ascending: false }).limit(300),
    db().from("knowledge_items").select("id", { count: "exact", head: true }),
  ]);
  const agents = (Object.keys(AGENT_LABELS) as AgentKey[]).map((key) => ({ key, label: AGENT_LABELS[key], defaultPrompt: DEFAULT_PROMPTS[key] }));
  return (
    <LearningClient
      agents={agents}
      versions={(prompts.data ?? []) as { id: string; agent: AgentKey; version: number; content: string; is_active: boolean; source: string; rationale: string | null; created_at: string }[]}
      feedback={(feedback.data ?? []) as { agent: string; rating: number; comment: string | null; created_at: string }[]}
      knowledgeCount={knowledge.count ?? 0}
    />
  );
}
