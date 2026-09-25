import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { KnowledgeClient } from "./knowledge-client";
import type { KnowledgeRow } from "@/lib/types";

export const metadata = { title: "پایگاه دانش" };

export default async function KnowledgePage() {
  await requireAdmin();
  const [items, total] = await Promise.all([
    db().from("knowledge_items").select("id, content, metadata, use_count, score, created_at").order("created_at", { ascending: false }).limit(120),
    db().from("knowledge_items").select("id", { count: "exact", head: true }),
  ]);
  const owner = env.githubOwner;
  return (
    <KnowledgeClient
      initial={(items.data ?? []) as KnowledgeRow[]}
      total={total.count ?? 0}
      repoUrl={owner ? `https://github.com/${owner}/${env.githubWorkspaceRepo}/tree/main/knowledge` : null}
    />
  );
}
