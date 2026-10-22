import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { DEFAULT_KNOWLEDGE } from "@/lib/knowledge-default";
import type { KnowledgeEntry } from "@/lib/retrieval";

export interface KnowledgeRow {
  id: string;
  title: string;
  body: string;
  tags: string[] | null;
  pinned: boolean;
  enabled: boolean;
  sort: number;
  updated_at: string;
}

export function toEntry(r: KnowledgeRow): KnowledgeEntry {
  return { id: r.id, title: r.title, body: r.body, tags: r.tags ?? [], pinned: r.pinned, enabled: r.enabled, sort: r.sort };
}

export async function listKnowledgeRows(): Promise<KnowledgeRow[] | null> {
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from("pars_knowledge").select("*").order("sort").order("created_at");
  if (error) return null;
  return data as KnowledgeRow[];
}

async function loadKnowledge(): Promise<{ entries: KnowledgeEntry[]; source: "db" | "default" }> {
  const rows = await listKnowledgeRows();
  if (rows && rows.length) return { entries: rows.map(toEntry), source: "db" };
  return { entries: DEFAULT_KNOWLEDGE, source: "default" };
}

/** Knowledge used by the assistant (database, or the starter set while the database is empty). */
export const getKnowledge = unstable_cache(loadKnowledge, ["pars-knowledge-v1"], { tags: ["knowledge"], revalidate: 300 });
