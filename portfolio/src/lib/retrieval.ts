/**
 * Lightweight retrieval over the knowledge base (pure, no server imports).
 * Small knowledge bases go to the model whole (most accurate); larger ones are ranked with
 * BM25 over Persian-normalised tokens and packed into a character budget.
 */

export interface KnowledgeEntry {
  id: string;
  title: string;
  body: string;
  tags: string[];
  /** always sent to the model (identity, contact, rules) */
  pinned: boolean;
  enabled: boolean;
  sort: number;
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalize(text: string): string {
  return text
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ةۀ]/g, "ه")
    .replace(/[أإٱ]/g, "ا")
    .replace(/ؤ/g, "و")
    .replace(/[ً-ٰٟـ]/g, "") // harakat + tatweel
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/‌/g, " ") // ZWNJ separates suffixes: پروژه‌ها → پروژه ها
    .toLowerCase();
}

const STOP = new Set(
  (
    "از به با در و که این آن را برای یک تا هم می ها های ای است هست بود شود کند کرد چه چی چطور چگونه آیا من ما شما او " +
    "اند ام ایم اید دارد دارید داریم کنید کنم کنیم شده شد باید هر یا اگر بر نیز همه ولی اما پس چون درباره مورد " +
    "the a an of to in and or is are be for on with what how do does you your we our it this that can about me i"
  ).split(" "),
);

/** light suffix stripping so «پروژه‌های» and «پروژه» meet */
function stem(t: string): string {
  if (/^[a-z0-9.+#-]+$/.test(t)) return t.replace(/(ing|es|s)$/, "") || t;
  for (const suf of ["هایی", "های", "ها", "ترین", "تر", "ان", "ات", "ی"]) {
    if (t.length > suf.length + 2 && t.endsWith(suf)) return t.slice(0, -suf.length);
  }
  return t;
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}.+#]+/u)
    .map((t) => t.replace(/^[.+#]+|[.]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(stem);
}

export function entryText(e: KnowledgeEntry): string {
  return `### ${e.title}\n${e.body.trim()}`;
}

export function rank(entries: KnowledgeEntry[], query: string): { entry: KnowledgeEntry; score: number }[] {
  const q = [...new Set(tokenize(query))];
  const docs = entries.map((e) => {
    // title and tags count twice
    const toks = [...tokenize(e.title), ...tokenize(e.title), ...e.tags.flatMap((t) => tokenize(t)), ...e.tags.flatMap((t) => tokenize(t)), ...tokenize(e.body)];
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { entry: e, tf, len: toks.length };
  });
  const N = docs.length || 1;
  const avg = docs.reduce((s, d) => s + d.len, 0) / N || 1;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, docs.filter((d) => d.tf.has(t)).length);
  const k1 = 1.2;
  const b = 0.75;
  return docs
    .map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t) ?? 0;
        if (!f) continue;
        const n = df.get(t) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg));
      }
      return { entry: d.entry, score };
    })
    .sort((a, b2) => b2.score - a.score);
}

/**
 * Picks the knowledge to send: everything when it fits in `budget` characters, otherwise pinned
 * entries plus the best-ranked ones for the conversation.
 */
export function selectKnowledge(all: KnowledgeEntry[], query: string, budget = 28000): KnowledgeEntry[] {
  const entries = all.filter((e) => e.enabled).sort((a, b) => a.sort - b.sort);
  const total = entries.reduce((s, e) => s + entryText(e).length + 2, 0);
  if (total <= budget) return entries;
  const picked: KnowledgeEntry[] = [];
  let used = 0;
  for (const e of entries.filter((x) => x.pinned)) {
    picked.push(e);
    used += entryText(e).length + 2;
  }
  for (const { entry, score } of rank(entries.filter((x) => !x.pinned), query)) {
    if (score <= 0 && picked.length > 3) break;
    const len = entryText(entry).length + 2;
    if (used + len > budget) continue;
    picked.push(entry);
    used += len;
  }
  return picked.sort((a, b) => a.sort - b.sort);
}
