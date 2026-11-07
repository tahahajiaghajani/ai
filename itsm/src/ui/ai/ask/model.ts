// Pure logic of the cited-answer UI (AskPanel, the documents viewer, «نمایه و بازیابی»): citation markers as links,
// which paragraphs of a page a cited passage covers, labels of the index's states, and what the library accepts.
// No React here (tests/ai-rag-ui.test.ts).
import type { AiCitation, AiDocStatus, AiRagStatus } from "@shared/ai/rag";
import { searchForm } from "@shared/ai/text";
import { safePath } from "../markdown/links";

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const faNum = (n: number | string) => String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** «[2]» markers of an answer as Markdown links `cite:2` (only numbers that are citations; others stay text). */
export function linkCitations(answer: string, citations: Pick<AiCitation, "n">[]): string {
  const known = new Set(citations.map((c) => c.n));
  return answer.replace(/\[(\d{1,2})\](?!\()/g, (m, n: string) => (known.has(Number(n)) ? `[[${faNum(n)}]](cite:${n})` : m));
}

/** The in-app path a `cite:n` link opens (null: not a citation of this answer, or not a safe path). */
export function citationHref(href: string, citations: Pick<AiCitation, "n" | "path">[]): string | null {
  const m = /^cite:(\d{1,2})$/.exec(href.trim());
  if (!m) return null;
  const c = citations.find((x) => x.n === Number(m[1]));
  return c ? safePath(c.path) : null;
}

/** How a citation is labelled: «رخداد INC0000012 · ص ۳». */
export function citationLabel(c: Pick<AiCitation, "table_label" | "number" | "page" | "page_end" | "field_label">): string {
  const parts = [c.number ? `${c.table_label} ${c.number}` : c.table_label];
  if (c.page) parts.push(c.page_end && c.page_end !== c.page ? `ص ${faNum(c.page)}–${faNum(c.page_end)}` : `ص ${faNum(c.page)}`);
  else if (c.field_label) parts.push(c.field_label);
  return parts.join(" · ");
}

/**
 * Indices of the paragraphs of a page that a cited passage covers: a paragraph is marked when most of its words are in
 * the passage (Persian typing differences ignored).
 */
export function coveredParagraphs(page: string, passage: string): number[] {
  const hay = ` ${searchForm(passage)} `;
  const out: number[] = [];
  page.split(/\n{2,}/).forEach((para, i) => {
    const words = searchForm(para).split(" ").filter((w) => w.length > 1);
    if (!words.length) return;
    const hits = words.filter((w) => hay.includes(` ${w} `)).length;
    if (hits / words.length >= 0.6) out.push(i);
  });
  return out;
}

/** Paragraphs of a page (as the viewer shows them). */
export const paragraphs = (page: string): string[] => page.split(/\n{2,}/);

export const DOC_STATUS_TONE: Record<AiDocStatus, "neutral" | "warning" | "danger" | null> = {
  ingesting: "neutral",
  ready: null,
  needs_ocr: "warning",
  failed: "danger",
};

/** Files the library takes (the server reads them; anything else fails with a reason). */
export const DOC_ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.html,.htm,.png,.jpg,.jpeg,.webp,.gif,.json,.xml,.log";

/** Is a file name one the library reads? */
export function acceptedFile(name: string): boolean {
  const ext = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  return !!ext && DOC_ACCEPT.split(",").includes(`.${ext}`);
}

/** «پایه» or the model's name: what the admin page says about the quality of retrieval. */
export function qualityLabel(s: Pick<AiRagStatus, "embedder">): string {
  return s.embedder.quality === "provider" ? `مدل بردارسازی ${s.embedder.model ?? ""}`.trim() : "بردارساز داخلی (کیفیت پایه)";
}

/** The vector backend in Persian. */
export function backendLabel(s: Pick<AiRagStatus, "backend">): string {
  return s.backend.kind === "pgvector" ? `pgvector ${s.backend.version ?? ""}`.trim() : "آرایه‌های عددی در برنامه (بدون pgvector)";
}

/** Persian names of the index's runs. */
export function runLabel(kind: string): string {
  if (kind === "backfill") return "بازسازی کامل";
  if (kind.startsWith("backfill:")) return "بازسازی یک جدول";
  if (kind === "reconcile") return "تطبیق شبانه";
  return kind;
}

const STAT_LABEL: Record<string, string> = {
  indexed: "نمایه‌شده",
  unchanged: "بی‌تغییر",
  removed: "حذف از نمایه",
  empty: "بی‌متن",
  error: "خطا",
  skipped: "ردشده",
  chunks: "قطعه",
  checked: "بررسی‌شده",
  rekeyed: "جابه‌جایی دسترسی",
  unknown: "جدول ناشناخته",
};

/** A run's numbers in Persian («نمایه‌شده: ۱۲، قطعه: ۴۰»). */
export function runStats(stats: Record<string, number>): string {
  return Object.entries(stats)
    .filter(([, v]) => v)
    .map(([k, v]) => `${STAT_LABEL[k] ?? k}: ${faNum(v)}`)
    .join("، ");
}
