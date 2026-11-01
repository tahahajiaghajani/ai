// Reads the first sheet of an .xlsx file or a .csv file into rows of text cells — without any
// library: an .xlsx is a zip of XML parts; entries are inflated with the platform's
// DecompressionStream (browsers, Electron and Node 22 all have it).

export type SheetRows = string[][];

// ---------------------------------------------------------------- zip

interface ZipEntry {
  name: string;
  method: number;
  size: number;
  offset: number;
}

function zipEntries(buf: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("فایل اکسل معتبر نیست (فقط ‎.xlsx‎ پشتیبانی می‌شود)");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, ZipEntry>();
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    out.set(name.replace(/\\/g, "/").replace(/^\//, ""), { name, method, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zipText(buf: Uint8Array, entries: Map<string, ZipEntry>, name: string): Promise<string | null> {
  const e = entries.get(name);
  if (!e) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(e.offset, true) !== 0x04034b50) return null;
  const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true);
  const raw = buf.subarray(start, start + e.size);
  const bytes = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw) : null;
  if (!bytes) throw new Error("فشرده‌سازی این فایل پشتیبانی نمی‌شود");
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- xml bits

function unescapeXml(s: string): string {
  return s
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e];
    });
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** Text of all <t> runs (rich text included, phonetic hints excluded). */
function runsText(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of clean.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
}

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cleanNumber(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (/^-?\d+$/.test(v)) return v; // integers stay exact (long codes)
  return String(Number(n.toPrecision(15)));
}

// ---------------------------------------------------------------- xlsx

export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<{ sheet: string; rows: SheetRows }> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const entries = zipEntries(buf);
  const workbook = (await zipText(buf, entries, "xl/workbook.xml")) ?? "";
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
  const sheetAttrs = firstSheet ? attrs(firstSheet[1]) : {};
  let path: string | null = null;
  const rid = sheetAttrs["r:id"];
  if (rid) {
    const rels = (await zipText(buf, entries, "xl/_rels/workbook.xml.rels")) ?? "";
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const a = attrs(m[1]);
      if (a.Id === rid && a.Target) path = a.Target.startsWith("/") ? a.Target.slice(1) : `xl/${a.Target.replace(/^\.\//, "")}`;
    }
  }
  if (!path || !entries.has(path)) path = [...entries.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0] ?? null;
  if (!path) throw new Error("برگه‌ای در این فایل پیدا نشد");
  const shared: string[] = [];
  const ss = await zipText(buf, entries, "xl/sharedStrings.xml");
  if (ss) for (const m of ss.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(m[1] ? runsText(m[1]) : "");
  const xml = (await zipText(buf, entries, path)) ?? "";
  const rows: SheetRows = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const ra = attrs(rm[1]);
    const r = ra.r ? Number(ra.r) - 1 : nextRow;
    nextRow = r + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = attrs(cm[1]);
      const c = ca.r ? colIndex(ca.r) : nextCol;
      nextCol = c + 1;
      const inner = cm[2] ?? "";
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = "";
      switch (ca.t) {
        case "s":
          text = shared[Number(v)] ?? "";
          break;
        case "inlineStr":
          text = runsText(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
          break;
        case "b":
          text = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
          break;
        case "e":
          text = "";
          break;
        case "str":
        case "d":
          text = v !== undefined ? unescapeXml(v) : "";
          break;
        default:
          text = v !== undefined ? cleanNumber(unescapeXml(v)) : "";
      }
      while (cells.length < c) cells.push("");
      cells[c] = text;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = cells;
  }
  return { sheet: sheetAttrs.name ? unescapeXml(sheetAttrs.name) : "Sheet1", rows };
}

// ---------------------------------------------------------------- csv

export function decodeText(data: ArrayBuffer | Uint8Array): string {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // Excel on Persian Windows saves CSV as Windows-1256
    text = new TextDecoder("windows-1256").decode(buf);
  }
  return text.replace(/^﻿/, "");
}

export function parseCsv(text: string): SheetRows {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: SheetRows = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** First sheet of an .xlsx/.csv file; empty trailing rows removed. */
export async function readSpreadsheet(name: string, data: ArrayBuffer | Uint8Array): Promise<{ sheet: string; rows: SheetRows }> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xls")) throw new Error("قالب قدیمی ‎.xls‎ پشتیبانی نمی‌شود؛ فایل را در اکسل با قالب ‎.xlsx‎ ذخیره کنید");
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const out = isZip ? await readXlsx(bytes) : { sheet: name.replace(/\.[^.]+$/, ""), rows: parseCsv(decodeText(bytes)) };
  const rows = out.rows.map((r) => r.map((c) => (c ?? "").trim()));
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  return { sheet: out.sheet, rows };
}
