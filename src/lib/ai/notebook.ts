import "server-only";
import { db } from "@/lib/supabase/admin";
import { KNOWLEDGE_KINDS } from "@/lib/ai/knowledge";
import { formatJalali } from "@/lib/jalali";
import type { KnowledgeRow } from "@/lib/types";

/**
 * NotebookLM (consumer) has no public API, so the knowledge base is exported as a small set of
 * consolidated Markdown sources (one per kind) — ideal for "Add source" in NotebookLM and kept
 * in the workspace repo under knowledge/notebooklm/.
 */
export async function buildNotebookPack(): Promise<{ name: string; content: string }[]> {
  const rows: KnowledgeRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db()
      .from("knowledge_items")
      .select("id, content, metadata, use_count, score, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    rows.push(...((data ?? []) as KnowledgeRow[]));
    if (!data || data.length < 1000) break;
  }

  // Re-assemble chunked items (title "x (1/3)") into whole documents.
  const docs = new Map<string, { kind: string; title: string; parts: string[]; task?: string; created: string; uses: number }>();
  for (const r of rows) {
    const kind = r.metadata.kind ?? "document";
    const title = (r.metadata.title ?? "بدون عنوان").replace(/\s\(\d+\/\d+\)$/, "");
    const key = `${kind}|${r.metadata.task_code ?? ""}|${title}`;
    const doc = docs.get(key) ?? { kind, title, parts: [], task: r.metadata.task_code, created: r.created_at, uses: 0 };
    doc.parts.push(r.content);
    doc.uses += r.use_count;
    docs.set(key, doc);
  }

  const byKind = new Map<string, typeof docs extends Map<string, infer V> ? V[] : never>();
  for (const d of docs.values()) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);

  const files: { name: string; content: string }[] = [];
  const index: string[] = [
    "# پایگاه دانش TaskFlow AI — بسته‌ی NotebookLM",
    "",
    `به‌روزرسانی: ${formatJalali(new Date(), { withTime: true })}`,
    "",
    "| منبع | تعداد موارد |",
    "|---|---|",
  ];
  for (const [kind, list] of byKind) {
    const label = KNOWLEDGE_KINDS[kind] ?? kind;
    const body = list
      .sort((a, b) => b.uses - a.uses)
      .map((d) => `## ${d.title}\n\n_نوع: ${label}${d.task ? ` — تسک ${d.task}` : ""} — ${formatJalali(d.created)}_\n\n${d.parts.join("\n\n")}`)
      .join("\n\n---\n\n");
    files.push({ name: `${kind}.md`, content: `# ${label}\n\n${body}\n` });
    index.push(`| ${kind}.md — ${label} | ${list.length} |`);
  }
  files.unshift({ name: "INDEX.md", content: `${index.join("\n")}\n` });
  return files;
}
