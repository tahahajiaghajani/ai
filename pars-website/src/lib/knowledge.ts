import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { DEFAULT_KNOWLEDGE } from "@/lib/knowledge-default";
import type { KnowledgeEntry } from "@/lib/retrieval";
import { getSettings } from "@/lib/settings";
import type { SiteContent } from "@/lib/settings-types";

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

/** `null` when Supabase is not configured; throws on a read error. */
async function readKnowledgeRows(): Promise<KnowledgeRow[] | null> {
  const c = db();
  if (!c) return null;
  const { data, error } = await c.from("pars_knowledge").select("*").order("sort").order("created_at");
  if (error) throw new Error(`knowledge_read_failed: ${error.message}`);
  return (data ?? []) as KnowledgeRow[];
}

/** For the admin page: `null` when the database is missing or unreadable. */
export async function listKnowledgeRows(): Promise<KnowledgeRow[] | null> {
  return readKnowledgeRows().catch(() => null);
}

type Knowledge = { entries: KnowledgeEntry[]; source: "db" | "default" };

const STARTER: Knowledge = { entries: DEFAULT_KNOWLEDGE, source: "default" };

async function loadKnowledge(): Promise<Knowledge> {
  const rows = await readKnowledgeRows();
  return rows && rows.length ? { entries: rows.map(toEntry), source: "db" } : STARTER;
}

const cachedKnowledge = unstable_cache(loadKnowledge, ["pars-knowledge-v1"], { tags: ["knowledge"], revalidate: 300 });

export const CONTACT_ENTRY_ID = "site-contact";

/** Contact facts built from the admin-managed site settings, so the assistant always matches the contact section. */
export function contactEntry(c: SiteContent["contact"]): KnowledgeEntry {
  const hours = [c.hoursFa, c.hoursEn].filter(Boolean).join(" / ");
  const lines = [
    c.addressFa && `- نشانی: ${c.addressFa}`,
    c.addressEn && `- Address: ${c.addressEn}`,
    c.phones.length > 0 && `- تلفن: ${c.phones.join(" و ")}`,
    c.email && `- ایمیل: ${c.email}`,
    hours && `- ساعات کاری: ${hours}`,
  ].filter(Boolean);
  return {
    id: CONTACT_ENTRY_ID,
    title: "اطلاعات تماس (از تنظیمات سایت)",
    body: lines.join("\n"),
    tags: ["تماس", "تلفن", "آدرس", "نشانی", "ایمیل", "ساعات کاری", "contact", "phone", "address", "hours"],
    pinned: true,
    enabled: true,
    sort: 15,
  };
}

async function storedKnowledge(): Promise<Knowledge> {
  try {
    return await cachedKnowledge();
  } catch (e) {
    console.error("[knowledge]", e);
    return STARTER;
  }
}

/**
 * Knowledge used by the assistant (database, or the starter set while the database is empty), plus the live
 * contact entry. A failed read is never cached: a stale entry keeps being served, or this call alone uses the starter set.
 */
export async function getKnowledge(): Promise<Knowledge> {
  const [k, { site }] = await Promise.all([storedKnowledge(), getSettings()]);
  return { ...k, entries: [...k.entries, contactEntry(site.contact)] };
}
