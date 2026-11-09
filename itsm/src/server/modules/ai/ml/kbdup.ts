// Knowledge articles that say the same thing in other words (catalogue KM duplicates; docs/spec/AI.md §13.4). The
// knowledge module's nightly pass compares the WORDS of published articles (shingles); this pass compares their MEANING
// with the organisation's embedding model — the vectors the AI index already holds for every article's chunks, so no
// model is called here — and proposes the pairs of one base at or above the model row's `threshold_show` as
// `kb_duplicate` rows with method «معنایی» (the knowledge staff review them exactly like the others). Without an
// embedding model (local vectors only, which do not understand meaning) it proposes nothing.
import { tableDef } from "@shared/tables";
import type { Ctx } from "../../../context";
import { createIn } from "../../../engine";
import { liveRows } from "../../incident/common";
import { activeEmbedder } from "../rag/embed";
import { parseVector, storeBackend } from "../rag/store";
import { dot } from "./core/cluster";

export const KB_DUPLICATE_KEY = "duplicate:kb_article";
const STATES = ["published", "pending_retirement"];

export interface KbDuplicateRun {
  articles: number;
  pairs: number;
  /** why nothing could be compared (no embedding model, no knowledge module) */
  note: string | null;
}

function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n > 0 ? v.map((x) => x / n) : v;
}

/** Propose the semantic duplicates of the organisation's published articles (as the system). */
export async function semanticKbDuplicates(sys: Ctx, threshold: number): Promise<KbDuplicateRun> {
  if (!tableDef("kb_article") || !tableDef("kb_duplicate")) return { articles: 0, pairs: 0, note: "مدیریت دانش در این برنامه نیست" };
  const emb = await activeEmbedder(sys);
  if (!emb) return { articles: 0, pairs: 0, note: "مدل بردارسازی تنظیم نشده است؛ مقاله‌های تکراری فقط با مقایسهٔ متن پیدا می‌شوند" };
  const arts = await liveRows(sys.db, sys, "kb_article", { f: "state", op: "in", v: STATES }, { limit: 5000 });
  if (arts.length < 2) return { articles: arts.length, pairs: 0, note: null };
  // one vector per article: the mean of its chunks' vectors of the organisation's current model
  const b = await storeBackend(sys.db);
  const col = b.kind === "pgvector" ? "vec_v::text" : "vec";
  const chunks = await sys.db.query<{ record_id: string; vec: unknown }>(
    `select record_id, ${col} as vec from sm_ai_chunks where org_id = $1 and table_key = 'kb_article' and kind = 'chunk' and vec_key = $2`,
    [sys.org.id, emb.key],
  );
  const sums = new Map<string, number[]>();
  for (const c of chunks) {
    const v = parseVector(c.vec);
    if (!v?.length) continue;
    const s = sums.get(c.record_id);
    if (!s) sums.set(c.record_id, unit(v));
    else if (s.length === v.length) {
      const u = unit(v);
      for (let i = 0; i < s.length; i++) s[i] += u[i];
    }
  }
  const byBase = new Map<string, { id: string; v: number[] }[]>();
  for (const a of arts) {
    const s = sums.get(String(a.id));
    if (!s) continue;
    const list = byBase.get(String(a.base_id)) ?? [];
    list.push({ id: String(a.id), v: unit(s) });
    byBase.set(String(a.base_id), list);
  }
  const known = new Set((await liveRows(sys.db, sys, "kb_duplicate", null, { limit: 10_000 })).map((d) => String(d.pair_key)));
  let pairs = 0;
  for (const list of byBase.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].v.length !== list[j].v.length) continue;
        const s = Math.round(dot(list[i].v, list[j].v) * 1e4) / 1e4;
        if (s < threshold) continue;
        const [a, c] = [list[i].id, list[j].id].sort();
        if (known.has(`${a}:${c}`)) continue;
        known.add(`${a}:${c}`);
        await sys.write((tx) => createIn(tx, sys, "kb_duplicate", { article_a: a, article_b: c, similarity: Math.min(100, Math.round(s * 100)), method: "semantic" }, { trusted: true }));
        pairs++;
        if (pairs >= 200) return { articles: arts.length, pairs, note: null };
      }
    }
  }
  return { articles: arts.length, pairs, note: null };
}
