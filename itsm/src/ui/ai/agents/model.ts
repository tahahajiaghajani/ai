// Pure logic of the agent studio (tests/ai-agents-ui.test.ts): agents grouped by module, the tool picker's groups and
// the allowed-tools list it edits (exact names kept beside the administrator's wildcard patterns), and how a run's
// steps read.
import type { AgentAdminItem, AgentRunStatus, AgentStep, AgentToolOption } from "@shared/ai/agents";
import { AGENT_RUN_STATUS, toolAllowed } from "@shared/ai/agents";
import { tableDef } from "@shared/tables";
import { normalizeFa } from "../../lib/fa";

const MODULE_LABEL: Record<string, string> = {
  incident: "رخداد و پشتیبانی",
  problem: "مشکل",
  change: "تغییر",
  request: "درخواست خدمت",
  knowledge: "دانش",
  cmdb: "پیکربندی",
  ai: "عامل‌های سازمان",
};

export interface AgentGroup {
  module: string;
  label: string;
  items: AgentAdminItem[];
}

/** Agents by module (the organisation's own last), filtered by a search over names, descriptions and keys. */
export function groupAgents(agents: AgentAdminItem[], search: string): AgentGroup[] {
  const q = normalizeFa(search.trim());
  const hit = (a: AgentAdminItem) => !q || normalizeFa(`${a.name} ${a.description} ${a.key}`).includes(q);
  const by = new Map<string, AgentAdminItem[]>();
  for (const a of agents.filter(hit)) by.set(a.module, [...(by.get(a.module) ?? []), a]);
  return [...by.entries()]
    .map(([module, items]) => ({ module, label: MODULE_LABEL[module] ?? module, items: items.sort((x, y) => x.name.localeCompare(y.name, "fa")) }))
    .sort((a, b) => (a.module === "ai" ? 1 : 0) - (b.module === "ai" ? 1 : 0) || a.label.localeCompare(b.label, "fa"));
}

export interface ToolGroup {
  key: string;
  label: string;
  tools: (AgentToolOption & { checked: boolean; viaPattern: boolean })[];
}

/** The picker's groups: the tools of each table, then the platform's tools and the skills; checked = allowed now. */
export function toolGroups(options: AgentToolOption[], patterns: string[]): ToolGroup[] {
  const exact = new Set(patterns);
  const groups = new Map<string, ToolGroup>();
  for (const o of options) {
    const skill = o.name.startsWith("skill:") ? o.name.slice(6) : null;
    const key = skill ? "skills" : (o.table ?? "platform");
    const label = skill ? "مهارت‌ها" : o.table ? (tableDef(o.table)?.plural ?? o.table) : "ابزارهای عمومی";
    const checked = skill ? exact.has(o.name) : toolAllowed(patterns, o.name);
    const g = groups.get(key) ?? { key, label, tools: [] };
    g.tools.push({ ...o, checked, viaPattern: checked && !exact.has(o.name) });
    groups.set(key, g);
  }
  const rank = (k: string) => (k === "platform" ? 1 : k === "skills" ? 2 : 0);
  return [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "fa"));
}

/** The allowed-tools list with one tool switched on or off (its exact name; wildcard patterns stay as written). */
export function togglePattern(patterns: string[], name: string, on: boolean): string[] {
  const rest = patterns.filter((p) => p !== name);
  return on ? [...rest, name] : rest;
}

export function principalText(p: AgentAdminItem["principal"], roleNames: Map<string, string>): string {
  if (!p.user_id) return "بی‌هویت";
  if (!p.active) return "هویت خاموش";
  return p.roles.length ? p.roles.map((r) => roleNames.get(r) ?? r).join("، ") : "بی‌نقش";
}

export const runStatusLabel = (s: AgentRunStatus) => AGENT_RUN_STATUS[s]?.label ?? s;

/** One step as a line of the run's timeline. */
export function stepLine(s: AgentStep): { kind: "model" | "tool" | "note"; title: string; detail: string | null; tone: "ok" | "bad" | "neutral" } {
  if (s.kind === "model") return { kind: "model", title: "مدل", detail: s.text ?? null, tone: s.ok === false ? "bad" : "neutral" };
  if (s.kind === "note") return { kind: "note", title: "یادداشت اجرا", detail: s.error ?? s.text ?? null, tone: "bad" };
  const p = s.proposal;
  const title = p ? `${s.tool}: ${p.title_fa}` : String(s.tool ?? "ابزار");
  const state = p ? (p.dry ? "آزمایشی (چیزی ثبت نشد)" : p.applied ? "اعمال شد" : "پیشنهاد شد") : null;
  return { kind: "tool", title, detail: s.error ?? [state, s.summary].filter(Boolean).join(" · ") ?? null, tone: s.ok === false ? "bad" : "ok" };
}
