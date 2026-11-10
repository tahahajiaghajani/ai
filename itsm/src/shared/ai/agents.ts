// Contracts of the AI agents (docs/spec/AI.md §11.8, catalogue AI-074…077, AI-154/157/166/167): an agent is a goal and
// instructions in Persian, a subset of tools, triggers, a principal (a service member whose ITSM roles the administrator
// chooses), an autonomy level, budgets and guardrails. Runs advance one model turn per job and are visible to AI
// administrators step by step. Shared by the server and the agent studio. Client-safe: no server imports.
import type { AiProposal } from "./types";
import type { SkillEventKind, SkillTier } from "./skills";

export type AgentTrigger = "manual" | "event" | "schedule" | "conversation";
export type AgentAutonomy = "suggest" | "approve" | "auto";
export type AgentRunStatus = "queued" | "running" | "done" | "failed" | "stopped" | "budget" | "skipped";
export type AgentRunTrigger = AgentTrigger | "test";

export const AGENT_TRIGGERS: Record<AgentTrigger, string> = {
  manual: "به خواست یک کارشناس",
  event: "رویداد رکورد",
  schedule: "زمان‌بندی",
  conversation: "از گفتگو با دستیار",
};

export const AGENT_AUTONOMY: Record<AgentAutonomy, { label: string; about: string }> = {
  suggest: { label: "فقط پیشنهاد", about: "هر کاری که عامل بخواهد بکند، پیشنهادی روی رکورد می‌شود که کسانی که رکورد را می‌بینند اعمالش می‌کنند." },
  approve: { label: "اقدام پس از تأیید", about: "پیشنهادها به تأییدکنندهٔ تعیین‌شده (یا گروه رکورد) فرستاده می‌شود و فقط با تأیید یک انسان اجرا می‌شود." },
  auto: { label: "اقدام خودکار در کارهای کم‌خطر مجاز", about: "فقط کارهایی که در فهرست مجاز آمده‌اند با دسترسی خود عامل بی‌درنگ انجام و ثبت می‌شوند؛ بقیه پیشنهاد می‌مانند." },
};

export const AGENT_RUN_STATUS: Record<AgentRunStatus, { label: string; color: "gray" | "blue" | "green" | "red" | "orange" | "gold" }> = {
  queued: { label: "در صف", color: "gray" },
  running: { label: "در حال اجرا", color: "blue" },
  done: { label: "پایان یافت", color: "green" },
  failed: { label: "ناموفق", color: "red" },
  stopped: { label: "متوقف شد", color: "orange" },
  budget: { label: "سقف بودجه", color: "gold" },
  skipped: { label: "اجرا نشد", color: "gray" },
};

export const AGENT_RUN_TRIGGERS: Record<AgentRunTrigger, string> = { ...AGENT_TRIGGERS, test: "آزمایش (بی‌اثر)" };

/** Kinds of auto-applicable actions: a field update, an internal note or a link. A public reply, a state change, a new record or a batch never apply on their own. */
export const AUTO_ACTION_HINT = "draft_update_<جدول>:<فیلد> · draft_journal_entry:work_note · draft_link_records";

/** Defaults of an agent's budgets. */
export const AGENT_BUDGET_DEFAULTS = { max_steps: 8, max_tokens: 60_000, max_actions: 5, daily_runs: 50 } as const;

/** An agent's configuration as the studio edits it (the server keeps it in its `ai_agent` row). */
export interface AgentConfig {
  id: string | null;
  key: string;
  name: string;
  description: string;
  module: string;
  builtin: boolean;
  base_key: string | null;
  enabled: boolean;
  goal: string;
  tables: string[];
  triggers: AgentTrigger[];
  events: SkillEventKind[];
  condition: unknown;
  schedule_minutes: number | null;
  schedule_filter: unknown;
  /** allowed tools: names or patterns (`get_*`, `search_incident`, `skill:incident.triage`) */
  tools: string[];
  autonomy: AgentAutonomy;
  auto_actions: string[];
  approvers: string[];
  approver_group_id: string | null;
  tier: SkillTier;
  max_steps: number;
  max_tokens: number;
  max_actions: number;
  daily_runs: number;
  forbidden_tables: string[];
  forbidden_fields: string[];
  forbidden_states: string[];
  /** roles that may start it by hand or from a conversation (empty: whoever may use AI and read the record) */
  roles: string[];
  /** field groups whose values may reach its model (never ai_private) */
  field_groups: string[];
  principal_id: string | null;
}

export type AgentConfigPatch = Partial<Omit<AgentConfig, "id" | "key" | "module" | "builtin" | "base_key" | "principal_id">>;

/** One step of a run, as the studio shows it. */
export interface AgentStep {
  n: number;
  at: string;
  kind: "model" | "tool" | "note";
  text?: string | null;
  tool?: string | null;
  input?: unknown;
  ok?: boolean;
  summary?: string | null;
  /** a proposal it made (or would have made, in a test) */
  proposal_id?: string | null;
  proposal?: { title_fa: string; kind: string; applied: boolean; dry: boolean; preview?: { label: string; value: string }[] } | null;
  error?: string | null;
}

export interface AgentRunView {
  id: string;
  agent_id: string | null;
  agent_key: string;
  agent_name: string;
  trigger: AgentRunTrigger;
  why: string | null;
  started_by: { id: string; name: string | null } | null;
  principal: { id: string; name: string | null } | null;
  table: string | null;
  record_id: string | null;
  record_number: string | null;
  status: AgentRunStatus;
  dry_run: boolean;
  steps: AgentStep[];
  step_count: number;
  tool_calls: number;
  actions: number;
  applied: number;
  proposals: string[];
  tokens_in: number;
  tokens_out: number;
  cost_usd: string | null;
  outcome: string | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface AgentPrincipalView {
  user_id: string | null;
  name: string | null;
  roles: string[];
  active: boolean;
}

export interface AgentAdminItem extends AgentConfig {
  principal: AgentPrincipalView;
  runs_today: number;
  last_run: { id: string; status: AgentRunStatus; at: string | null } | null;
  open_proposals: number;
}

export interface AgentAdminView {
  agents: AgentAdminItem[];
  /** the organisation's kill switch for every agent (AI settings «عامل‌ها») */
  agents_on: boolean;
  roles: { key: string; name: string }[];
  ai: { ok: boolean; message_fa?: string };
}

/** A tool an agent may be given (the studio's tool picker). */
export interface AgentToolOption {
  name: string;
  title_fa: string;
  kind: "read" | "propose" | "meta";
  table: string | null;
  /** the principal may use it now (its roles read / write the table) */
  available: boolean;
}

/** The test console: what the administrator and the agent's principal each read, and the dry run's steps. */
export interface AgentTestResult {
  admin: AgentAccessView;
  principal: AgentAccessView | null;
  run: AgentRunView | null;
  /** why the dry run could not start (no principal, no model, a record the principal cannot read…) */
  problem: string | null;
}

export interface AgentAccessView {
  name: string;
  /** the record as this person reads it: labels → values (null: they cannot read it) */
  record: Record<string, string> | null;
  tools: number;
  writes: number;
}

/** What a member may start on a record (the record's «هوش مصنوعی» panel, the assistant). */
export interface AgentCard {
  key: string;
  name: string;
  description: string;
  autonomy: AgentAutonomy;
}

export interface AgentStartResult {
  run_id: string | null;
  status: AgentRunStatus;
  message_fa: string;
}

/** Proposals of an agent (the inbox «پیشنهادهای هوش مصنوعی»). */
export type AgentProposal = AiProposal;

// ---------------------------------------------------------------- pure rules (the server enforces them; the studio shows them)

/** An agent key: lowercase Latin letter first, then letters, digits, «.» and «_». */
export const isAgentKey = (k: string) => /^[a-z][a-z0-9_.]{1,79}$/.test(k);

/** The tool name of a skill an agent may call («skill:incident.triage» → «skill_incident_triage»). */
export const skillToolName = (key: string) => `skill_${key.replace(/[^a-z0-9_]/g, "_")}`.slice(0, 64);

/** A pattern of the allowed-tools list: a tool name, a prefix with «*» (`get_*`, `draft_*_incident` is not), or `skill:<key>`. */
export function toolPatternProblem(p: string): string | null {
  if (/^skill:[a-z][a-z0-9_.]{0,79}$/.test(p)) return null;
  if (/^[a-z][a-z0-9_]{0,63}\*?$/.test(p) || p === "*") return null;
  return `«${p}» نام یا الگوی ابزار نیست (نمونه: get_incident، search_*، skill:incident.triage)`;
}

/** Is the tool `name` (or the skill `skillKey`) among the allowed patterns? */
export function toolAllowed(patterns: readonly string[], name: string, skillKey?: string | null): boolean {
  // a skill is allowed only by name (`skill:<key>`), never by a wildcard
  if (skillKey) return patterns.includes(`skill:${skillKey}`);
  for (const p of patterns) {
    if (p.endsWith("*") && !p.startsWith("skill:") && name.startsWith(p.slice(0, -1))) return true;
    if (p === name) return true;
  }
  return false;
}

export interface AgentGuardrails {
  forbidden_tables: readonly string[];
  forbidden_fields: readonly string[];
  forbidden_states: readonly string[];
}

export const tableForbidden = (g: AgentGuardrails, table: string | null | undefined) => !!table && g.forbidden_tables.includes(table);
/** `field` or `table.field` */
export const fieldForbidden = (g: AgentGuardrails, table: string, field: string) => g.forbidden_fields.includes(field) || g.forbidden_fields.includes(`${table}.${field}`);
/** `state` or `table:state` */
export const stateForbidden = (g: AgentGuardrails, table: string, state: string) => g.forbidden_states.includes(state) || g.forbidden_states.includes(`${table}:${state}`);

type Payload = Record<string, unknown>;
const obj = (v: unknown): Payload => (v && typeof v === "object" && !Array.isArray(v) ? (v as Payload) : {});

/**
 * Why a proposal breaks the agent's guardrails (Persian), or null. Checked on the proposal's stored payload — what would
 * really be written — not on the model's words: the tables it writes or links, the fields it sets, the state it moves to.
 */
export function guardrailProblem(g: AgentGuardrails, p: { kind: string; payload: unknown }): string | null {
  const pl = obj(p.payload);
  const table = typeof pl.table === "string" ? pl.table : null;
  if (tableForbidden(g, table)) return `جدول «${table}» برای این عامل ممنوع است`;
  if (typeof pl.to_table === "string" && tableForbidden(g, pl.to_table)) return `جدول «${pl.to_table}» برای این عامل ممنوع است`;
  if (table) {
    for (const f of Object.keys(obj(pl.data))) if (fieldForbidden(g, table, f)) return `فیلد «${f}» برای این عامل ممنوع است`;
    if (typeof pl.to === "string" && stateForbidden(g, table, pl.to)) return `بردن رکورد به وضعیت «${pl.to}» برای این عامل ممنوع است`;
  }
  return null;
}

/**
 * May the agent apply this proposal itself (autonomy «اقدام خودکار»)? Only what the whitelist names: a change of the
 * listed fields of a table (`draft_update_<table>:<field>`, every field of the change listed), an internal note
 * (`draft_journal_entry:work_note`) or a link (`draft_link_records`). A new record, a state change, a public reply or a
 * batch never applies without a person.
 */
export function autoApplicable(whitelist: readonly string[], p: { kind: string; payload: unknown }): boolean {
  const pl = obj(p.payload);
  const table = typeof pl.table === "string" ? pl.table : "";
  if (p.kind === "record.update") {
    const fields = Object.keys(obj(pl.data));
    return !!table && fields.length > 0 && fields.every((f) => whitelist.includes(`draft_update_${table}:${f}`));
  }
  if (p.kind === "record.journal") return pl.kind === "work_note" && whitelist.includes("draft_journal_entry:work_note");
  if (p.kind === "record.link") return whitelist.includes("draft_link_records");
  return false;
}

/** A whitelist entry the server accepts. */
export function autoActionProblem(a: string): string | null {
  if (/^draft_update_[a-z][a-z0-9_]{0,62}:[a-z][a-z0-9_]{0,62}$/.test(a) || a === "draft_journal_entry:work_note" || a === "draft_link_records") return null;
  if (a === "draft_journal_entry:comment") return "پاسخ عمومی به درخواست‌کننده هرگز خودکار فرستاده نمی‌شود";
  return `«${a}» از کارهای کم‌خطر مجاز نیست (draft_update_<جدول>:<فیلد>، draft_journal_entry:work_note، draft_link_records)`;
}

/** Problems of an agent's configuration, in Persian (the hook refuses a write with any). */
export function agentConfigProblems(c: Partial<AgentConfig>): string[] {
  const out: string[] = [];
  const triggers = c.triggers ?? [];
  if (c.key !== undefined && !isAgentKey(String(c.key))) out.push("کلید عامل باید با حرف لاتین کوچک شروع شود و فقط حرف، رقم، نقطه و _ داشته باشد");
  if (c.goal !== undefined && String(c.goal).trim().length < 10) out.push("هدف و دستورالعمل عامل را بنویسید");
  if (triggers.includes("event") && !(c.events ?? []).length) out.push("برای آغاز با رویداد، دست‌کم یک رویداد را برگزینید");
  if (triggers.includes("event") && !(c.tables ?? []).length) out.push("برای آغاز با رویداد، جدول‌ها را برگزینید");
  if (triggers.includes("schedule") && !c.schedule_minutes) out.push("برای اجرای زمان‌بندی‌شده بازهٔ اجرا (دقیقه) را بنویسید");
  for (const t of c.tools ?? []) {
    const p = toolPatternProblem(t);
    if (p) out.push(p);
  }
  for (const a of c.auto_actions ?? []) {
    const p = autoActionProblem(a);
    if (p) out.push(p);
  }
  if ((c.auto_actions ?? []).length && c.autonomy && c.autonomy !== "auto") out.push("کارهای کم‌خطر مجاز فقط در «اقدام خودکار» به کار می‌آیند");
  if ((c.field_groups ?? []).some((g) => g === ("ai_private" as never))) out.push("گروه «ai_private» هرگز به مدل نمی‌رسد");
  return out;
}
