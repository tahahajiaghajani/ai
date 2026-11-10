// Reading the text of an uploaded document, page by page: PDF (unpdf: the text layer of each page), Word .docx (mammoth:
// headings and lists kept as markdown), Excel .xlsx and CSV (read-excel-file: one "page" per sheet, rows as table
// lines), plain text, Markdown and HTML (tags stripped, headings kept). A PDF without a text layer or an image is
// "scanned": its text needs a vision model (ingestion asks one when the organisation has it). The parsers load on
// first use, so the web version's cold start does not carry them.

export interface ParsedPage {
  page: number;
  text: string;
}

export interface ParsedFile {
  kind: "text" | "scanned" | "image" | "unsupported";
  pages: ParsedPage[];
  /** why nothing could be read (unsupported or broken files), Persian */
  problem?: string;
}

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** What kind of file this is, from the sniffed type and the name. */
export function fileKind(name: string, mime: string): "pdf" | "docx" | "xlsx" | "csv" | "html" | "text" | "image" | "other" {
  const ext = (name.toLowerCase().match(/\.([a-z0-9]{1,6})$/)?.[1] ?? "").trim();
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (IMAGE_MIMES.has(mime) || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (mime === DOCX || ext === "docx") return "docx";
  if (mime === XLSX || ext === "xlsx") return "xlsx";
  if (ext === "csv" || mime === "text/csv") return "csv";
  if (ext === "html" || ext === "htm" || mime === "text/html") return "html";
  if (["txt", "md", "markdown", "log", "json", "xml", "yaml", "yml", "ini", "conf"].includes(ext) || mime.startsWith("text/")) return "text";
  return "other";
}

/** UTF-8 (or UTF-16 with a byte-order mark) text of a file. */
export function decodeText(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data.subarray(2));
  return new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
}

/** HTML → text with markdown headings and list markers (scripts and styles dropped, entities decoded). */
export function htmlToText(html: string): string {
  const ent: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", zwnj: "‌", rlm: "", lrm: "" };
  return html
    .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t.replace(/<[^>]+>/g, " ").trim()}\n\n`)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<(br|\/p|\/div|\/tr|\/table|\/ul|\/ol|\/section|\/article|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ent[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** CSV lines → rows (quotes, commas and semicolons). */
export function parseCsv(text: string): string[][] {
  const delim = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Rows of a sheet as markdown table lines (the first row as the header), at most 5000 rows. */
function tableText(rows: unknown[][]): string {
  const cell = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\|/g, "/").replace(/\s+/g, " ").trim();
  return rows
    .slice(0, 5000)
    .filter((r) => r.some((v) => cell(v)))
    .map((r) => `| ${r.map(cell).join(" | ")} |`)
    .join("\n");
}

const MIN_TEXT = 20;

/** The pages of a file (see the header). */
export async function parseFile(name: string, mime: string, data: Uint8Array): Promise<ParsedFile> {
  const kind = fileKind(name, mime);
  try {
    switch (kind) {
      case "pdf": {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(data));
        const r = await extractText(pdf, { mergePages: false });
        const pages = (r.text as string[]).map((t, i) => ({ page: i + 1, text: String(t ?? "").trim() }));
        const chars = pages.reduce((n, p) => n + p.text.replace(/\s/g, "").length, 0);
        // a scan: (almost) no text layer
        if (chars < Math.max(MIN_TEXT, pages.length * 10)) return { kind: "scanned", pages: pages.map((p) => ({ ...p, text: "" })) };
        return { kind: "text", pages };
      }
      case "image":
        return { kind: "image", pages: [{ page: 1, text: "" }] };
      case "docx": {
        const mammoth = (await import("mammoth")).default;
        const r = await mammoth.convertToHtml({ buffer: Buffer.from(data) });
        const text = htmlToText(r.value);
        return text.length >= 1 ? { kind: "text", pages: [{ page: 1, text }] } : { kind: "unsupported", pages: [], problem: "متنی در این سند Word پیدا نشد" };
      }
      case "xlsx": {
        const readXlsxFile = (await import("read-excel-file/node")).default;
        const sheets = await readXlsxFile(Buffer.from(data));
        const pages = sheets.map((s, i) => ({ page: i + 1, text: `## ${s.sheet}\n\n${tableText(s.data as unknown[][])}` })).filter((p) => p.text.length > 6);
        return pages.length ? { kind: "text", pages } : { kind: "unsupported", pages: [], problem: "این کاربرگ خالی است" };
      }
      case "csv": {
        const rows = parseCsv(decodeText(data));
        return rows.length ? { kind: "text", pages: [{ page: 1, text: tableText(rows) }] } : { kind: "unsupported", pages: [], problem: "این فایل CSV خالی است" };
      }
      case "html":
        return { kind: "text", pages: [{ page: 1, text: htmlToText(decodeText(data)) }] };
      case "text": {
        const text = decodeText(data);
        // long plain texts become pages of ~6000 characters at paragraph breaks (page anchors for citations)
        const pages: ParsedPage[] = [];
        let cur = "";
        for (const para of text.split(/\n{2,}/)) {
          if (cur && cur.length + para.length > 6000) {
            pages.push({ page: pages.length + 1, text: cur.trim() });
            cur = "";
          }
          cur += `${para}\n\n`;
        }
        if (cur.trim()) pages.push({ page: pages.length + 1, text: cur.trim() });
        return pages.length ? { kind: "text", pages } : { kind: "unsupported", pages: [], problem: "فایل متنی خالی است" };
      }
      default:
        return { kind: "unsupported", pages: [], problem: "این نوع فایل خوانده نمی‌شود؛ PDF، Word (docx)، Excel (xlsx)، CSV، متن، Markdown، HTML یا تصویر بفرستید" };
    }
  } catch (e) {
    return { kind: "unsupported", pages: [], problem: `فایل خوانده نشد: ${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
}
