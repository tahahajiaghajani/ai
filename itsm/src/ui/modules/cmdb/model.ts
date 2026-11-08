// Pure logic of the configuration management screens (tests/cmdb-ui.test.ts): the layered layout of dependency maps
// (dagre; the dependent CI sits above what it depends on, services on top, hardware at the bottom when a relationship
// has no side), colours by class family and impact severity, the import wizard's column guesses and batches, and the
// class-attribute form's coercion.
import dagre from "@dagrejs/dagre";
import type { MapEdge, MapNode, MapResult } from "@shared/cmdb/api";
import { CLASS_FAMILIES, type AttrDef, type ClassFamily } from "@shared/cmdb/classes";
import { familyLayer, severityLabel } from "@shared/cmdb/logic";
import { COLOR_TOKENS } from "../../records/model/colors";

export const MAP_NODE_W = 228;
export const MAP_NODE_H = 66;
export const MAP_GHOST_W = 132;
export const MAP_GHOST_H = 40;

export type MapDirection = "TB" | "RL";

/** The edge as the layout draws it: from the dependent CI to the one it depends on. */
export function orientEdge(e: MapEdge, nodes: Map<string, MapNode>): { from: string; to: string } {
  if (e.dependent === "source") return { from: e.source, to: e.target };
  if (e.dependent === "target") return { from: e.target, to: e.source };
  const a = familyLayer(nodes.get(e.source)?.family);
  const b = familyLayer(nodes.get(e.target)?.family);
  return a <= b ? { from: e.source, to: e.target } : { from: e.target, to: e.source };
}

/** Positions (top-left corners) of the map's nodes, layered with dagre. */
export function layoutMap(map: Pick<MapResult, "nodes" | "edges">, direction: MapDirection = "TB"): Map<string, { x: number; y: number; w: number; h: number }> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: direction === "TB" ? 28 : 18, ranksep: direction === "TB" ? 70 : 90, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  for (const n of map.nodes) {
    const ghost = !!n.restricted;
    g.setNode(n.id, { width: ghost ? MAP_GHOST_W : MAP_NODE_W, height: ghost ? MAP_GHOST_H : MAP_NODE_H });
  }
  for (const e of map.edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    const { from, to } = orientEdge(e, byId);
    g.setEdge(from, to, { weight: e.propagates ? 2 : 1, minlen: 1 }, e.id);
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const n of map.nodes) {
    const p = g.node(n.id) as { x: number; y: number; width: number; height: number } | undefined;
    if (!p) continue;
    // React Flow works left to right; a right-to-left layout mirrors x so the roots sit on the reader's right
    const x = direction === "RL" ? -p.x : p.x;
    out.set(n.id, { x: Math.round(x - p.width / 2), y: Math.round(p.y - p.height / 2), w: p.width, h: p.height });
  }
  return out;
}

/** The token colour of a class family. */
export const familyColor = (f: ClassFamily | undefined | null) => COLOR_TOKENS[CLASS_FAMILIES[f ?? "logical"]?.color ?? "gray"];
export const familyLabel = (f: ClassFamily | undefined | null) => CLASS_FAMILIES[f ?? "logical"]?.label ?? "منطقی";

/** The tone and colour of an impact severity (0–1). */
export function severityStyle(s: number | null | undefined, absorbed?: boolean): { tone: "danger" | "warning" | "neutral" | "in"; color: string; label: string } {
  if (s === null || s === undefined) return { tone: "neutral", color: "var(--ds-line-3)", label: "" };
  if (absorbed) return { tone: "in", color: "var(--ds-in)", label: "جذب‌شده با افزونگی" };
  const l = severityLabel(s);
  if (l.key === "down") return { tone: "danger", color: "var(--ds-danger)", label: l.label };
  if (l.key === "major") return { tone: "warning", color: "var(--ds-warning)", label: l.label };
  if (l.key === "degraded") return { tone: "warning", color: "var(--ds-chart-2)", label: l.label };
  return { tone: "in", color: "var(--ds-in)", label: l.label };
}

/** Counts of a map by family (the legend). */
export function familyCounts(nodes: MapNode[]): { family: ClassFamily; label: string; count: number }[] {
  const m = new Map<ClassFamily, number>();
  for (const n of nodes) if (!n.restricted && n.family) m.set(n.family, (m.get(n.family) ?? 0) + 1);
  return [...m].map(([family, count]) => ({ family, label: familyLabel(family), count })).sort((a, b) => familyLayer(a.family) - familyLayer(b.family));
}

/** The sum of a node's overlay counts (open work on it). */
export const overlayTotal = (n: MapNode) => Object.values(n.overlay ?? {}).reduce((a, b) => a + (Number(b) || 0), 0);

// ---------------------------------------------------------------------------------------------------------------
// Import wizard

/** A target of the import mapping: a CI field, a class attribute (`attrs.x`), the class, or a relationship. */
export interface ImportTarget {
  value: string;
  label: string;
  group: "field" | "attr" | "special";
}

const SYNONYMS: Record<string, string[]> = {
  name: ["name", "نام", "عنوان", "title", "ci", "displayname", "display_name"],
  serial_number: ["serial", "serialnumber", "serial_number", "سریال", "شماره سریال", "شمارهٔ سریال", "sn"],
  asset_tag: ["asset", "assettag", "asset_tag", "برچسب", "برچسب دارایی", "اموال", "شماره اموال"],
  hostname: ["host", "hostname", "computername", "computer", "نام میزبان", "نام رایانه"],
  fqdn: ["fqdn", "dns", "dnsname"],
  ip_address: ["ip", "ipaddress", "ip_address", "نشانی ip", "آی پی"],
  mac_address: ["mac", "macaddress", "mac_address"],
  manufacturer: ["manufacturer", "vendor", "make", "سازنده", "برند"],
  model_name: ["model", "modelname", "model_name", "مدل"],
  os: ["os", "operatingsystem", "operating_system", "سیستم عامل", "سیستم‌عامل"],
  os_version: ["osversion", "os_version", "نسخه سیستم عامل"],
  sw_version: ["version", "نسخه"],
  environment: ["environment", "env", "محیط"],
  class: ["class", "type", "ci_class", "کلاس", "نوع"],
  description: ["description", "شرح", "توضیح"],
  cpu_count: ["cpu", "cpus", "cpucount", "cores", "پردازنده"],
  ram_mb: ["ram", "memory", "rammb", "ram_mb", "حافظه"],
  disk_gb: ["disk", "storage", "diskgb", "disk_gb", "دیسک"],
  bios_uuid: ["uuid", "biosuuid", "bios_uuid", "smbiosuuid"],
  cloud_resource_id: ["resourceid", "resource_id", "arn", "instanceid", "instance_id"],
  url: ["url", "link", "نشانی"],
  expires_at: ["expires", "expiry", "expiration", "notafter", "انقضا", "تاریخ انقضا"],
};

const squash = (s: string) => s.toLowerCase().replace(/[\s_\-.‌]+/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک");

/** A guess of each column's target from its header (exact names first, then synonyms; class attributes by name or label). */
export function guessMapping(headers: string[], targets: ImportTarget[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const byName = new Map(targets.map((t) => [squash(t.value.replace(/^attrs\./, "")), t.value]));
  const byLabel = new Map(targets.map((t) => [squash(t.label), t.value]));
  for (const h of headers) {
    const k = squash(h);
    let hit = byName.get(k) ?? byLabel.get(k);
    if (!hit) {
      for (const [field, words] of Object.entries(SYNONYMS)) {
        if (words.some((w) => squash(w) === k) && targets.some((t) => t.value === field)) {
          hit = field;
          break;
        }
      }
    }
    if (hit && !used.has(hit)) {
      out[h] = hit;
      used.add(hit);
    } else out[h] = "";
  }
  return out;
}

/** Rows in batches of `size` (the import posts one batch at a time). */
export function batches<T>(rows: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Does the mapping identify CIs (a name, or an identifier the reconciliation engine matches on)? */
export function mappingProblems(mapping: Record<string, string>, defaultClass: string | null): string[] {
  const targets = new Set(Object.values(mapping).filter(Boolean));
  const problems: string[] = [];
  if (!targets.has("name") && !["serial_number", "hostname", "fqdn", "bios_uuid", "asset_tag", "cloud_resource_id", "mac_address"].some((t) => targets.has(t))) problems.push("ستونی برای نام یا یکی از شناسه‌ها (سریال، نام میزبان، شناسهٔ BIOS…) انتخاب کنید");
  if (!defaultClass && !targets.has("class")) problems.push("کلاس پیش‌فرض را انتخاب کنید یا ستونی را به «کلاس» نگاشت کنید");
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Class attributes on a CI

/** A form value → the stored value of an attribute (numbers, booleans, lists; empty → null). */
export function coerceAttr(a: AttrDef, v: unknown): unknown {
  if (v === undefined || v === null || v === "") return null;
  switch (a.type) {
    case "int": {
      const n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : null;
    }
    case "decimal": {
      const n = Number(v);
      return Number.isFinite(n) ? String(v) : null;
    }
    case "bool":
      return v === true || v === "true";
    case "multichoice":
    case "tags":
      return Array.isArray(v) ? v.map(String).filter(Boolean) : String(v).split(/[،,]/).map((x) => x.trim()).filter(Boolean);
    default:
      return typeof v === "string" ? v.trim() || null : v;
  }
}

/** The attribute values to save: every class attribute coerced, values of attributes the class no longer has kept. */
export function attrsToSave(attrs: AttrDef[], current: Record<string, unknown>, edits: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...current };
  for (const a of attrs) if (a.name in edits) out[a.name] = coerceAttr(a, edits[a.name]);
  for (const [k, v] of Object.entries(out)) if (v === null) delete out[k];
  return out;
}

/** Required attributes still empty. */
export function missingAttrs(attrs: AttrDef[], values: Record<string, unknown>): string[] {
  return attrs.filter((a) => a.required && (values[a.name] === undefined || values[a.name] === null || values[a.name] === "" || (Array.isArray(values[a.name]) && !(values[a.name] as unknown[]).length))).map((a) => a.label);
}

/** An org-relative list address with a filter (the record list reads `?filter=<condition>`). */
export const listWith = (path: string, cond: unknown) => `${path}?filter=${encodeURIComponent(JSON.stringify(cond))}`;
