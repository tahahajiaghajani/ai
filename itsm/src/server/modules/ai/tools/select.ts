// Tool retrieval (docs/spec/AI.md §11.8): of the generated record tools a member may use (hundreds — four or more per
// readable table), a turn is offered only the few that fit the page and the question, so that small local models keep
// their context for the answer. Tables are ranked by the page's record or list (always first), a record number in the
// question (its prefix), keywords of the table's labels and field labels (Persian-normalised, plural and possessive
// endings trimmed) and the local embedder's similarity; the operations follow the question's verbs (read always; drafts
// only when it asks for a change, batches when it says «همه»). Tools used earlier in the conversation stay offered, so
// a follow-up («حالا همه را ببند») finds them. Nothing here widens access: the catalogue holds only tools the member
// may use (./records.ts) and every call checks again.
import type { AiPageContext } from "@shared/ai/types";
import { tableDef } from "@shared/tables";
import { cosine, localEmbed } from "../rag/local-embed";
import { faNorm } from "./common";
import type { RecordOp, ToolEntry } from "./records";

export interface SelectInput {
  question: string;
  context?: AiPageContext | null;
  /** tool names already called in this conversation */
  used?: string[];
}

/** Default number of generated tools offered in one turn (the platform's and modules' own tools come on top). */
export const TOOLS_PER_TURN = 18;
const MAX_TABLES = 3;

const STOP = new Set(
  "the a an of to in on for and or is are be with my me all any how what which who when where that this these those from by at as it its show list find give please را از به در با که این آن برای یک تا هم و یا است هست بود شده شد می من ما شما همه همهٔ چند چه کدام کی کجا بده کن کنید بکن نشان لطفا لطفاً".split(" "),
);

/** Words of a text, normalised: Persian letters and digits, endings «ها/های/هایی/ان/ی» and the ezafe trimmed. */
export function words(text: string): string[] {
  return faNorm(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.replace(/(هایی|های|ها|ات)$/u, "").replace(/ٔ$/u, ""))
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Same word, or one a longer form of the other (4+ letters: «باز» is not «بازبینی»). */
const match = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

const WRITE = /(ببند|بسته کن|حل کن|لغو|بازگشا|ثبت کن|بساز|ایجاد|اضافه|تغییر|عوض|ویرایش|اختصاص|محول|ارجاع|بفرست|یادداشت|پاسخ بده|بنویس|پیوند|وصل|ادغام|close|resolve|cancel|reopen|create|open a|add|update|change|set|assign|move|edit|note|comment|reply|link|mark)/iu;
const BATCH = /(همه|همهٔ|تمام|گروهی|یکجا|دسته‌جمعی|\ball\b|\bevery\b|\bbulk\b)/iu;
const COUNT = /(چند|تعداد|آمار|نمودار|روند|میانگین|مجموع|درصد|سهم|how many|count|chart|trend|average|total|percent)/iu;
const HISTORY = /(تاریخچه|سابقه|کی تغییر|چه کسی|یادداشت‌ها|history|who changed|timeline)/iu;

const vecCache = new Map<string, number[]>();
function vec(text: string): number[] {
  let v = vecCache.get(text);
  if (!v) {
    v = localEmbed(text);
    if (vecCache.size > 2000) vecCache.clear();
    vecCache.set(text, v);
  }
  return v;
}

/** The table a page is about: its record, or a record list at `r/<table>` (module paths name it in the record). */
export function contextTable(ctx: AiPageContext | null | undefined): string | null {
  if (ctx?.record?.type && tableDef(ctx.record.type)) return ctx.record.type;
  if (ctx?.list?.table && tableDef(ctx.list.table)) return ctx.list.table;
  const m = /^r\/([a-z][a-z0-9_]*)(?:\/|$)/.exec(ctx?.path ?? "");
  return m && tableDef(m[1]) ? m[1] : null;
}

/** Record numbers in a question («INC0001234») → the tables whose prefix they carry. */
function numberedTables(question: string, tables: string[]): string[] {
  const prefixes = [...question.toUpperCase().matchAll(/\b([A-Z]{2,6})\d{3,}\b/g)].map((m) => m[1]);
  if (!prefixes.length) return [];
  return tables.filter((t) => {
    const p = tableDef(t)?.numbered?.prefix;
    return !!p && prefixes.includes(p.toUpperCase());
  });
}

/** The generated tools to offer this turn (see the file's head). */
export function selectRecordTools(entries: ToolEntry[], q: SelectInput, opts: { max?: number } = {}): ToolEntry[] {
  const max = opts.max ?? TOOLS_PER_TURN;
  if (!entries.length || max <= 0) return [];
  const text = q.question ?? "";
  const qWords = words(text);
  const qVec = text.trim() ? vec(faNorm(text)) : null;
  const byTable = new Map<string, ToolEntry[]>();
  for (const e of entries) if (e.table) byTable.set(e.table, [...(byTable.get(e.table) ?? []), e]);
  const tables = [...byTable.keys()];
  const ctxTable = contextTable(q.context);
  const numbered = new Set(numberedTables(text, tables));
  const scored = tables.map((t) => {
    const def = tableDef(t)!;
    let score = 0;
    if (t === ctxTable) score += 100;
    if (numbered.has(t)) score += 60;
    const head = words(`${def.label} ${def.plural} ${t.replace(/_/g, " ")}`);
    const tail = words((byTable.get(t)![0]?.terms ?? "").slice(0, 2000));
    for (const w of qWords) {
      if (head.some((h) => h === w)) score += 8;
      else if (head.some((h) => match(h, w))) score += 5;
      else if (tail.some((h) => match(h, w))) score += 1.5;
    }
    // how much of the table's own name the question covers («رخداد» fits «رخدادها» better than «بازبینی رخداد»)
    const label = words(def.label);
    if (label.length) score += (10 * label.filter((l) => qWords.some((w) => match(l, w))).length) / label.length;
    if (qVec) score += 10 * Math.max(0, cosine(qVec, vec(faNorm(`${def.label} ${def.plural} ${def.description ?? ""}`))));
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score || a.t.localeCompare(b.t));
  const best = scored[0]?.score ?? 0;
  // a table is offered when it clearly fits (keywords or the page), not for the embedder's noise alone
  const chosen = scored.filter((s, i) => i < MAX_TABLES && s.score >= Math.max(4, best * 0.4)).map((s) => s.t);

  const write = WRITE.test(text);
  const batch = write && BATCH.test(text);
  const ops = new Set<RecordOp>(["search", "get"]);
  if (COUNT.test(text) || !write) ops.add("aggregate");
  if (HISTORY.test(text) || (ctxTable && !write)) ops.add("history");
  if (write) for (const o of ["create", "update", "transition", "journal", "link"] as RecordOp[]) ops.add(o);
  if (batch) ops.add("batch");

  const used = new Set(q.used ?? []);
  const out: ToolEntry[] = [];
  const add = (e: ToolEntry | undefined) => {
    if (e && out.length < max && !out.includes(e)) out.push(e);
  };
  // tools of this conversation first (follow-ups), then the chosen tables' operations in the order of their rank
  for (const e of entries) if (used.has(e.name)) add(e);
  for (const t of chosen) for (const e of byTable.get(t) ?? []) if (e.op && ops.has(e.op)) add(e);
  if (write) for (const e of entries) if (!e.table && e.op && ops.has(e.op)) add(e);
  return out;
}
