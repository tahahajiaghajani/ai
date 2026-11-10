// Scanner imports (SEC-014): Nessus / Tenable, Qualys and OpenVAS / Greenbone exports in CSV, XML or JSON become one
// normalised list of findings — host (IP, host name, FQDN), port, CVEs (or the scanner's own check id when a finding
// has none), title, severity, CVSS score and vector, solution and evidence. Informational results are skipped.
// The server matches hosts to CIs, de-duplicates per (asset, vulnerability) and reconciles with what is stored.
// A small tolerant XML reader is included (no dependency). Imported by the UI too (a preview before importing).
import { parseCsv } from "../cmdb/logic";
import { cvesIn, severityToCvss } from "./logic";

export type ScannerKind = "nessus" | "qualys" | "openvas" | "generic";
export type ScanFormat = "csv" | "xml" | "json";

export const SCANNER_LABELS: Record<ScannerKind, string> = { nessus: "Nessus / Tenable", qualys: "Qualys", openvas: "OpenVAS / Greenbone", generic: "قالب عمومی" };

export interface ScanFinding {
  /** the host as the scanner named it (IP or name) */
  host: string;
  ip: string | null;
  hostname: string | null;
  fqdn: string | null;
  port: number | null;
  protocol: string | null;
  cves: string[];
  /** the scanner's check id: Nessus plugin, Qualys QID, OpenVAS NVT OID */
  plugin: string | null;
  title: string;
  severity: string | null;
  cvss: number | null;
  cvss_vector: string | null;
  solution: string | null;
  description: string | null;
  proof: string | null;
}

export interface ScanParse {
  scanner: ScannerKind;
  format: ScanFormat;
  findings: ScanFinding[];
  /** informational results and rows without a host */
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// A tolerant XML reader

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** the element's own text (CDATA included), not its descendants' */
  text: string;
}

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });

/**
 * Limits of the XML reader — far beyond any scanner export, short of what a crafted file could make the server do:
 * nesting depth, elements, attributes per element, and wall time (the reader runs on the request's event loop).
 */
export const XML_LIMITS = { depth: 256, elements: 1_000_000, attrs: 200, budgetMs: 15_000 };

const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13;

/** The attributes of a start tag (`s` from `from` on), in one pass: `name = "value"` or `name = 'value'`. */
function readAttrs(s: string, from: number, out: Record<string, string>): void {
  const n = s.length;
  let i = from;
  let count = 0;
  while (i < n && count < XML_LIMITS.attrs) {
    while (i < n && isSpace(s.charCodeAt(i))) i++;
    const start = i;
    while (i < n && !isSpace(s.charCodeAt(i)) && s[i] !== "=") i++;
    const name = s.slice(start, i);
    while (i < n && isSpace(s.charCodeAt(i))) i++;
    if (s[i] !== "=") {
      if (i === start) i++;
      continue; // a name without a value
    }
    i++;
    while (i < n && isSpace(s.charCodeAt(i))) i++;
    const q = s[i];
    if (q === '"' || q === "'") {
      const e = s.indexOf(q, i + 1);
      if (e < 0) break;
      if (name) {
        out[name] = decodeEntities(s.slice(i + 1, e));
        count++;
      }
      i = e + 1;
    } else while (i < n && !isSpace(s.charCodeAt(i))) i++; // an unquoted value is not XML: skipped
  }
}

/**
 * Parse an XML document into a tree (namespaces kept in names; mismatched end tags close up to their match). Linear in
 * the input: open elements are indexed by name (an end tag finds its match without walking the stack) and attributes
 * are read in one pass. Throws past `XML_LIMITS`.
 */
export function parseXml(src: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  // the stack positions of the open elements of each name, innermost last
  const open = new Map<string, number[]>();
  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      const node = stack.pop()!;
      const at = open.get(node.name);
      if (at) {
        at.pop();
        if (!at.length) open.delete(node.name);
      }
    }
  };
  const started = Date.now();
  let elements = 0;
  let steps = 0;
  let i = 0;
  const n = src.length;
  while (i < n) {
    if ((++steps & 1023) === 0 && Date.now() - started > XML_LIMITS.budgetMs) throw new Error("پرونده بیش از حد پیچیده است");
    const lt = src.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt < 0) {
      top.text += decodeEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      i = e < 0 ? n : e + 3;
    } else if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt + 9);
      top.text += src.slice(lt + 9, e < 0 ? n : e);
      i = e < 0 ? n : e + 3;
    } else if (src.startsWith("<?", lt)) {
      const e = src.indexOf("?>", lt + 2);
      i = e < 0 ? n : e + 2;
    } else if (src.startsWith("<!", lt)) {
      const e = src.indexOf(">", lt + 2);
      i = e < 0 ? n : e + 1;
    } else if (src[lt + 1] === "/") {
      const e = src.indexOf(">", lt + 2);
      const name = src.slice(lt + 2, e < 0 ? n : e).trim();
      i = e < 0 ? n : e + 1;
      // close up to the innermost open element of that name; an end tag without one is dropped
      const at = open.get(name);
      if (at?.length) closeTo(at[at.length - 1]);
    } else {
      // a start tag: find its end outside quoted attribute values
      let j = lt + 1;
      let quote = "";
      while (j < n) {
        const ch = src[j];
        if (quote) {
          if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") break;
        j++;
      }
      const body = src.slice(lt + 1, j);
      i = j + 1;
      const selfClosing = body.endsWith("/");
      const inner = selfClosing ? body.slice(0, -1) : body;
      const m = /^[^\s/>]+/.exec(inner);
      if (!m) continue;
      if (++elements > XML_LIMITS.elements) throw new Error("پرونده بیش از حد عنصر دارد");
      const node: XNode = { name: m[0], attrs: {}, children: [], text: "" };
      readAttrs(inner, m[0].length, node.attrs);
      top.children.push(node);
      if (!selfClosing) {
        if (stack.length > XML_LIMITS.depth) throw new Error("پرونده بیش از حد تودرتو است");
        const at = open.get(node.name);
        if (at) at.push(stack.length);
        else open.set(node.name, [stack.length]);
        stack.push(node);
      }
    }
  }
  return root;
}

const local = (name: string) => name.replace(/^.*:/, "");
export const kids = (n: XNode | undefined, name: string) => (n ? n.children.filter((c) => local(c.name) === name) : []);
export const kid = (n: XNode | undefined, name: string) => (n ? n.children.find((c) => local(c.name) === name) : undefined);
export const txt = (n: XNode | undefined) => (n ? n.text.trim() : "");
/** Every descendant named `name` (depth first). */
export function findAll(n: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of n.children) {
    if (local(c.name) === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

const num = (v: unknown): number | null => {
  const m = /-?\d+(\.\d+)?/.exec(String(v ?? ""));
  const x = m ? Number(m[0]) : NaN;
  return Number.isFinite(x) ? x : null;
};
const clean = (v: unknown, max = 4000): string | null => {
  const s = String(v ?? "").replace(/\r/g, "").trim();
  return s ? s.slice(0, max) : null;
};
const isIp = (v: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || (/^[0-9a-f:]+$/i.test(v) && v.includes(":"));

function finding(p: Partial<ScanFinding> & { host?: string | null; title?: string | null }): ScanFinding | null {
  const host = clean(p.host ?? p.ip ?? p.fqdn ?? p.hostname, 255);
  if (!host) return null;
  const ip = p.ip ? clean(p.ip, 64) : isIp(host) ? host : null;
  const fqdn = p.fqdn ? clean(p.fqdn, 255) : !isIp(host) && host.includes(".") ? host.toLowerCase() : null;
  const hostname = p.hostname ? clean(p.hostname, 120) : !isIp(host) ? host.split(".")[0].toLowerCase() : null;
  return {
    host,
    ip,
    hostname,
    fqdn,
    port: p.port !== null && p.port !== undefined && Number(p.port) > 0 ? Math.round(Number(p.port)) : null,
    protocol: clean(p.protocol, 10)?.toLowerCase() ?? null,
    cves: [...new Set((p.cves ?? []).map((c) => c.toUpperCase()))],
    plugin: clean(p.plugin, 120),
    title: clean(p.title, 300) ?? "یافتهٔ بی‌عنوان",
    severity: clean(p.severity, 30),
    cvss: p.cvss ?? null,
    cvss_vector: clean(p.cvss_vector, 200),
    solution: clean(p.solution),
    description: clean(p.description),
    proof: clean(p.proof, 2000),
  };
}

/** The keys a finding is stored under: its CVEs, else the scanner's check («QID-38173», «NESSUS-97833»). */
export function vulnKeys(f: ScanFinding, scanner: ScannerKind): string[] {
  if (f.cves.length) return f.cves;
  if (f.plugin) return [`${scanner === "qualys" ? "QID" : scanner === "openvas" ? "OID" : scanner === "nessus" ? "NESSUS" : "CHECK"}-${f.plugin}`.toUpperCase()];
  return [`CHECK-${f.title.slice(0, 60).replace(/\s+/g, "_").toUpperCase()}`];
}

const INFO = new Set(["0", "none", "info", "informational", "log", "debug", "false positive"]);
const isInfo = (sev: unknown, cvss: number | null) => (cvss !== null ? cvss <= 0 && INFO.has(String(sev ?? "0").trim().toLowerCase()) : INFO.has(String(sev ?? "").trim().toLowerCase()));

// ---------------------------------------------------------------------------------------------------------------
// Nessus

function nessusXml(doc: XNode, out: ScanParse): void {
  for (const h of findAll(doc, "ReportHost")) {
    const props = new Map(kids(kid(h, "HostProperties"), "tag").map((t) => [t.attrs.name, txt(t)]));
    const ip = props.get("host-ip") || (isIp(h.attrs.name ?? "") ? h.attrs.name : null);
    for (const it of kids(h, "ReportItem")) {
      const sev = it.attrs.severity ?? "0";
      const cvss = num(txt(kid(it, "cvss3_base_score"))) ?? num(txt(kid(it, "cvss_base_score")));
      if (sev === "0") {
        out.skipped++;
        continue;
      }
      const f = finding({
        host: h.attrs.name,
        ip,
        fqdn: props.get("host-fqdn") || null,
        hostname: props.get("hostname") || props.get("netbios-name") || null,
        port: num(it.attrs.port),
        protocol: it.attrs.protocol,
        cves: kids(it, "cve").map(txt).filter(Boolean),
        plugin: it.attrs.pluginID,
        title: it.attrs.pluginName || txt(kid(it, "plugin_name")),
        severity: ["info", "low", "medium", "high", "critical"][Number(sev)] ?? sev,
        cvss: cvss ?? severityToCvss(sev),
        cvss_vector: txt(kid(it, "cvss3_vector")) || txt(kid(it, "cvss_vector")) || null,
        solution: txt(kid(it, "solution")),
        description: txt(kid(it, "synopsis")) || txt(kid(it, "description")),
        proof: txt(kid(it, "plugin_output")),
      });
      if (f) out.findings.push(f);
      else out.skipped++;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Qualys

function qualysXml(doc: XNode, out: ScanParse): void {
  // scan reports: <IP value name><VULNS|PRACTICES><CAT port protocol><VULN number severity>
  for (const ipNode of findAll(doc, "IP").filter((n) => n.attrs.value)) {
    for (const section of [...kids(ipNode, "VULNS"), ...kids(ipNode, "PRACTICES")]) {
      for (const cat of kids(section, "CAT")) {
        for (const v of kids(cat, "VULN")) {
          const cves = [...findAll(v, "ID").map(txt), ...cvesIn(v.attrs.cveid)].filter((x) => /^CVE-/i.test(x));
          const cvss = num(txt(kid(v, "CVSS3_BASE"))) ?? num(txt(kid(v, "CVSS_BASE")));
          const f = finding({
            host: ipNode.attrs.value,
            ip: ipNode.attrs.value,
            fqdn: ipNode.attrs.name && ipNode.attrs.name.includes(".") ? ipNode.attrs.name : null,
            hostname: ipNode.attrs.name || null,
            port: num(cat.attrs.port),
            protocol: cat.attrs.protocol,
            cves,
            plugin: v.attrs.number,
            title: txt(kid(v, "TITLE")),
            severity: v.attrs.severity,
            cvss: cvss ?? severityToCvss(v.attrs.severity),
            solution: txt(kid(v, "SOLUTION")),
            description: txt(kid(v, "DIAGNOSIS")) || txt(kid(v, "THREAT")),
            proof: txt(kid(v, "RESULT")),
          });
          if (f) out.findings.push(f);
          else out.skipped++;
        }
      }
    }
    out.skipped += kids(ipNode, "INFOS").reduce((s, x) => s + findAll(x, "INFO").length, 0);
  }
  // host detections (VM API): <HOST><IP/><DNS/><DETECTION_LIST><DETECTION><QID/><TYPE/><SEVERITY/>
  for (const h of findAll(doc, "HOST")) {
    const ip = txt(kid(h, "IP"));
    if (!ip && !txt(kid(h, "DNS"))) continue;
    for (const d of findAll(h, "DETECTION")) {
      if (/^info/i.test(txt(kid(d, "TYPE")))) {
        out.skipped++;
        continue;
      }
      const sev = txt(kid(d, "SEVERITY"));
      const f = finding({
        host: ip || txt(kid(h, "DNS")),
        ip: ip || null,
        fqdn: txt(kid(h, "DNS")) || null,
        hostname: txt(kid(h, "NETBIOS")) || null,
        port: num(txt(kid(d, "PORT"))),
        protocol: txt(kid(d, "PROTOCOL")) || null,
        cves: cvesIn(txt(kid(d, "RESULTS"))),
        plugin: txt(kid(d, "QID")),
        title: `QID ${txt(kid(d, "QID"))}`,
        severity: sev,
        cvss: severityToCvss(sev),
        proof: txt(kid(d, "RESULTS")),
      });
      if (f) out.findings.push(f);
      else out.skipped++;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// OpenVAS / Greenbone

function openvasXml(doc: XNode, out: ScanParse): void {
  for (const r of findAll(doc, "result").filter((x) => kid(x, "nvt"))) {
    const nvt = kid(r, "nvt")!;
    const sevText = txt(kid(r, "severity"));
    const threat = txt(kid(r, "threat"));
    const cvss = num(sevText) ?? num(txt(kid(nvt, "cvss_base")));
    if (/^(log|debug|none|false positive)$/i.test(threat) || (cvss !== null && cvss <= 0)) {
      out.skipped++;
      continue;
    }
    const hostNode = kid(r, "host");
    const tags = new Map(txt(kid(nvt, "tags")).split("|").map((p) => [p.split("=")[0], p.slice(p.indexOf("=") + 1)] as [string, string]));
    const refs = findAll(nvt, "ref").filter((x) => (x.attrs.type ?? "").toLowerCase() === "cve").map((x) => x.attrs.id);
    const [port, protocol] = txt(kid(r, "port")).split("/");
    const f = finding({
      host: txt(hostNode),
      ip: txt(hostNode),
      hostname: txt(kid(hostNode, "hostname")) || null,
      port: num(port),
      protocol: protocol || null,
      cves: [...refs, ...cvesIn(txt(kid(nvt, "cve")))].filter((x) => /^CVE-/i.test(x ?? "")),
      plugin: nvt.attrs.oid,
      title: txt(kid(nvt, "name")) || txt(kid(r, "name")),
      severity: threat || null,
      cvss,
      cvss_vector: tags.get("cvss_base_vector") || null,
      solution: txt(kid(nvt, "solution")) || tags.get("solution") || null,
      description: tags.get("summary") || txt(kid(r, "description")),
      proof: txt(kid(r, "description")),
    });
    if (f) out.findings.push(f);
    else out.skipped++;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// CSV

type CsvRow = Record<string, string>;
const col = (r: CsvRow, ...names: string[]) => {
  for (const n of names) {
    const k = Object.keys(r).find((x) => x.trim().toLowerCase() === n.toLowerCase());
    if (k !== undefined && String(r[k] ?? "").trim() !== "") return String(r[k]).trim();
  }
  return "";
};

function csvRows(text: string, marker: (cells: string[]) => boolean): CsvRow[] {
  const rows = parseCsv(text, ",");
  const at = rows.findIndex((cells) => marker(cells.map((c) => c.trim().toLowerCase())));
  if (at < 0) return [];
  const header = rows[at].map((h) => h.trim());
  return rows.slice(at + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

function nessusCsv(text: string, out: ScanParse): void {
  for (const r of csvRows(text, (c) => c.includes("plugin id") && c.includes("host"))) {
    const risk = col(r, "Risk", "Severity");
    const cvss = num(col(r, "CVSS v3.0 Base Score", "CVSS v3 Base Score", "CVSS v4.0 Base Score", "CVSS v2.0 Base Score", "CVSS"));
    if (!risk || /^none$/i.test(risk) || isInfo(risk, cvss)) {
      out.skipped++;
      continue;
    }
    const f = finding({ host: col(r, "Host", "IP Address"), fqdn: col(r, "FQDN") || null, port: num(col(r, "Port")), protocol: col(r, "Protocol"), cves: cvesIn(col(r, "CVE")), plugin: col(r, "Plugin ID"), title: col(r, "Name", "Plugin Name"), severity: risk, cvss: cvss ?? severityToCvss(risk), solution: col(r, "Solution"), description: col(r, "Synopsis", "Description"), proof: col(r, "Plugin Output") });
    if (f) out.findings.push(f);
    else out.skipped++;
  }
}

function qualysCsv(text: string, out: ScanParse): void {
  for (const r of csvRows(text, (c) => c.includes("qid") && c.includes("ip"))) {
    const type = col(r, "Type");
    if (/^ig$|^info/i.test(type)) {
      out.skipped++;
      continue;
    }
    const sev = col(r, "Severity");
    const cvss = num(col(r, "CVSS3.1 Base", "CVSS3 Base", "CVSS Base"));
    const f = finding({ host: col(r, "IP"), ip: col(r, "IP") || null, fqdn: col(r, "FQDN", "DNS") || null, hostname: col(r, "NetBIOS") || null, port: num(col(r, "Port")), protocol: col(r, "Protocol"), cves: cvesIn(col(r, "CVE ID", "CVE")), plugin: col(r, "QID"), title: col(r, "Title"), severity: sev, cvss: cvss ?? severityToCvss(sev), solution: col(r, "Solution"), description: col(r, "Threat"), proof: col(r, "Results") });
    if (f) out.findings.push(f);
    else out.skipped++;
  }
}

function openvasCsv(text: string, out: ScanParse): void {
  for (const r of csvRows(text, (c) => c.includes("nvt oid") || (c.includes("nvt name") && c.includes("ip")))) {
    const sev = col(r, "Severity");
    const cvss = num(col(r, "CVSS"));
    if ((cvss !== null && cvss <= 0) || /^(log|none)$/i.test(sev)) {
      out.skipped++;
      continue;
    }
    const f = finding({ host: col(r, "IP"), ip: col(r, "IP") || null, hostname: col(r, "Hostname") || null, port: num(col(r, "Port")), protocol: col(r, "Port Protocol"), cves: cvesIn(col(r, "CVEs")), plugin: col(r, "NVT OID"), title: col(r, "NVT Name"), severity: sev, cvss, solution: col(r, "Solution"), description: col(r, "Summary"), proof: col(r, "Specific Result") });
    if (f) out.findings.push(f);
    else out.skipped++;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// JSON (a generic list, or Tenable / Nessus API exports)

const pick = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), o);
const first = (o: unknown, ...paths: string[]) => {
  for (const p of paths) {
    const v = pick(o, p);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

function jsonFindings(doc: unknown, out: ScanParse): void {
  const list = Array.isArray(doc) ? doc : (first(doc, "findings", "vulnerabilities", "results", "items", "data") as unknown[] | null) ?? [];
  if (!Array.isArray(list)) {
    out.errors.push("در پرونده فهرستی از یافته‌ها پیدا نشد (findings، vulnerabilities یا results)");
    return;
  }
  for (const x of list) {
    const sev = first(x, "severity", "risk", "risk_factor", "plugin.risk_factor");
    const cvss = num(first(x, "cvss", "cvss3", "cvss_score", "cvss3_base_score", "cvss_base_score", "plugin.cvss3_base_score", "plugin.cvss_base_score"));
    if (isInfo(sev, cvss)) {
      out.skipped++;
      continue;
    }
    const cveRaw = first(x, "cves", "cve", "cve_ids", "plugin.cve");
    const cves = Array.isArray(cveRaw) ? cveRaw.map(String).flatMap((c) => cvesIn(c)) : cvesIn(cveRaw);
    const portRaw = first(x, "port.port", "port");
    const f = finding({
      host: String(first(x, "host", "ip", "ip_address", "asset.ipv4", "asset.fqdn", "asset.hostname", "hostname") ?? ""),
      ip: (first(x, "ip", "ip_address", "asset.ipv4") as string | null) ?? null,
      fqdn: (first(x, "fqdn", "asset.fqdn") as string | null) ?? null,
      hostname: (first(x, "hostname", "asset.hostname", "netbios") as string | null) ?? null,
      port: num(typeof portRaw === "object" ? null : portRaw),
      protocol: (first(x, "protocol", "port.protocol") as string | null) ?? null,
      cves,
      plugin: String(first(x, "plugin_id", "pluginID", "qid", "oid", "plugin.id") ?? "") || null,
      title: String(first(x, "title", "name", "plugin_name", "plugin.name") ?? ""),
      severity: sev === null ? null : String(sev),
      cvss: cvss ?? severityToCvss(sev),
      cvss_vector: (first(x, "cvss_vector", "cvss3_vector", "plugin.cvss3_vector") as string | null) ?? null,
      solution: (first(x, "solution", "plugin.solution", "remediation") as string | null) ?? null,
      description: (first(x, "description", "synopsis", "plugin.synopsis", "plugin.description") as string | null) ?? null,
      proof: (first(x, "output", "proof", "evidence", "plugin_output") as string | null) ?? null,
    });
    if (f) out.findings.push(f);
    else out.skipped++;
  }
}

// ---------------------------------------------------------------------------------------------------------------

export function detectFormat(text: string): ScanFormat {
  const head = text.replace(/^﻿/, "").trimStart()[0];
  return head === "<" ? "xml" : head === "{" || head === "[" ? "json" : "csv";
}

export function detectScanner(text: string, format: ScanFormat): ScannerKind {
  const head = text.slice(0, 20_000);
  if (format === "xml") {
    if (/<NessusClientData/i.test(head)) return "nessus";
    if (/<(ASSET_DATA_REPORT|SCAN\b|HOST_LIST_VM_DETECTION_OUTPUT|HOST_LIST_OUTPUT)/.test(head) || /<IP\s+value=/.test(head)) return "qualys";
    if (/<report\b/i.test(head) && /<nvt\b/i.test(text.slice(0, 200_000))) return "openvas";
    return "generic";
  }
  if (format === "csv") {
    const lower = head.toLowerCase();
    if (lower.includes("plugin id")) return "nessus";
    if (lower.includes("nvt oid") || lower.includes("nvt name")) return "openvas";
    if (lower.includes("qid")) return "qualys";
  }
  if (format === "json" && /"plugin"\s*:|"pluginID"|"plugin_id"/.test(head)) return "nessus";
  return "generic";
}

/** Read a scanner's export into findings. Unknown layouts produce an error, never a guess. */
export function parseScan(text: string, opts: { scanner?: ScannerKind | null; format?: ScanFormat | null } = {}): ScanParse {
  const src = String(text ?? "").replace(/^﻿/, "");
  const format = opts.format ?? detectFormat(src);
  const scanner = opts.scanner ?? detectScanner(src, format);
  const out: ScanParse = { scanner, format, findings: [], skipped: 0, errors: [] };
  try {
    if (format === "json") jsonFindings(JSON.parse(src), out);
    else if (format === "xml") {
      const doc = parseXml(src);
      if (scanner === "nessus") nessusXml(doc, out);
      else if (scanner === "qualys") qualysXml(doc, out);
      else if (scanner === "openvas") openvasXml(doc, out);
      else out.errors.push("قالب XML شناخته نشد (Nessus، Qualys یا OpenVAS)");
    } else if (scanner === "nessus") nessusCsv(src, out);
    else if (scanner === "qualys") qualysCsv(src, out);
    else if (scanner === "openvas") openvasCsv(src, out);
    else out.errors.push("ستون‌های CSV شناخته نشد (Plugin ID، QID یا NVT OID لازم است)");
  } catch (e) {
    out.errors.push(format === "json" ? "پرونده JSON معتبر نیست" : `خواندن پرونده ممکن نشد: ${(e as Error).message}`.slice(0, 300));
  }
  return out;
}
