// Data policy: what leaves the organisation for a model. "masked" (default) hides national ids, mobiles, card
// numbers, IBANs, passport numbers and addresses in tool outputs and prompts; "aggregates" also hides the names of
// people; "full" sends everything as is. Fields are recognised by their key first (tools name them) and by pattern
// in free text.
import type { AiDataPolicy } from "@shared/ai/types";
import { isCardNumber, isNationalId } from "@shared/validate";

const DIGIT = "[0-9۰-۹٠-٩]";
const toLatin = (s: string) => s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));

/** «***1234»: only the last four characters stay. */
export function maskValue(v: string): string {
  const s = toLatin(String(v)).replace(/[\s-]/g, "");
  return s.length <= 4 ? "***" : `***${s.slice(-4)}`;
}

const MOBILE_RE = new RegExp(`(?<!${DIGIT})(?:\\+?98|0098|[0۰])?[9۹]${DIGIT}{9}(?!${DIGIT})`, "g");
const IBAN_RE = new RegExp(`\\bIR[\\s-]?(?:${DIGIT}[\\s-]?){23}${DIGIT}`, "gi");
const CARD_RE = new RegExp(`(?<!${DIGIT})${DIGIT}{4}[\\s-]?${DIGIT}{4}[\\s-]?${DIGIT}{4}[\\s-]?${DIGIT}{4}(?!${DIGIT})`, "g");
const NID_RE = new RegExp(`(?<!${DIGIT})${DIGIT}{10}(?!${DIGIT})`, "g");
const PASSPORT_RE = /(?<![A-Za-z0-9])[A-Z][0-9]{8}(?![A-Za-z0-9])/g;

/** Mask personal identifiers inside free text (prompts, notes, tool strings). */
export function maskText(text: string): string {
  return String(text ?? "")
    .replace(IBAN_RE, (m) => maskValue(m))
    .replace(CARD_RE, (m) => (isCardNumber(toLatin(m).replace(/[\s-]/g, "")) ? maskValue(m) : m))
    .replace(MOBILE_RE, (m) => maskValue(m))
    .replace(NID_RE, (m) => (isNationalId(toLatin(m)) ? maskValue(m) : m))
    .replace(PASSPORT_RE, (m) => maskValue(m));
}

const SENSITIVE_KEY = /(^|_)(national_?id|nid|melli|mobile|phone|tel|telephone|fax|card(_no|_number)?|iban|sheba|passport(_no)?|postal(_code)?|zip|address|birth(_date)?|id_card)($|_)/i;
const NAME_KEY = /^(party|party_name|customer|customer_name|supplier|supplier_name|counterparty|counterparty_name|full_name|person|person_name|payee|payer|drawer|holder|owner_name|beneficiary|sender|receiver|contact|contact_name|first_name|last_name|father_name|member|member_name|user_name|created_by_name|requester|requester_name|caller|caller_name|reporter|reporter_name|assignee|assignee_name|agent|agent_name|approver|approver_name|technician|author|author_name|employee|employee_name)$/i;
const PARTY_TYPES = new Set(["party", "person", "customer", "supplier", "member", "user", "requester", "contact", "employee", "agent"]);

/** Apply the data policy to a JSON value (a copy is returned). */
export function redactValue(value: unknown, policy: AiDataPolicy): unknown {
  if (policy === "full") return value;
  const walk = (v: unknown, key: string, parentIsParty: boolean): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") {
      if (SENSITIVE_KEY.test(key)) return /address/i.test(key) ? "[پنهان]" : maskValue(v);
      if (policy === "aggregates" && (NAME_KEY.test(key) || (parentIsParty && /^(name|label|title)$/i.test(key)))) return "[نام پنهان]";
      return maskText(v);
    }
    if (typeof v === "number") return SENSITIVE_KEY.test(key) ? maskValue(String(v)) : v;
    if (Array.isArray(v)) return v.map((x) => walk(x, key, parentIsParty));
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      // a person's row: typed as one, under a person-like key, or carrying a person's id (members, requesters…)
      const isParty =
        PARTY_TYPES.has(String(o.type ?? o.kind ?? "")) || /party|customer|supplier|requester|assignee|member|employee/i.test(key) || "party_id" in o || "party_code" in o || "user_id" in o;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) out[k] = walk(x, k, isParty);
      return out;
    }
    return v;
  };
  return walk(value, "", false);
}

/** Apply the data policy to a text the user typed (names stay: the person wrote them). */
export function redactPrompt(text: string, policy: AiDataPolicy): string {
  return policy === "full" ? text : maskText(text);
}

/**
 * Apply the data policy inside the `<data name="…">` blocks of a feature prompt (narrative.ts
 * dataBlock): each block is JSON on one line, so it is parsed and redacted like tool output
 * (names hidden under "aggregates"); the rest of the prompt is left to redactPrompt.
 */
const DATA_BLOCK_RE = /<data name="([^"\n]*)">\n([^\n]*)\n<\/data>/g;
export function redactDataBlocks(text: string, policy: AiDataPolicy): string {
  if (policy === "full") return text;
  return String(text ?? "").replace(DATA_BLOCK_RE, (whole, name: string, json: string) => {
    try {
      return `<data name="${name}">\n${JSON.stringify(redactValue(JSON.parse(json), policy))}\n</data>`;
    } catch {
      return `<data name="${name}">\n${maskText(json)}\n</data>`;
    }
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "aggregates": known names (e.g. the labels of party references) replaced inside a free text —
 * whole words only, so «علی» never touches «فعلی» (a zero-width non-joiner counts as part of the word).
 */
export function hideNames(text: string, names: (string | null | undefined)[]): string {
  let out = String(text ?? "");
  for (const n of [...new Set(names.map((x) => String(x ?? "").trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}\u200c])${escapeRe(n)}(?![\\p{L}\\p{M}\\p{N}\u200c])`, "gu"), "[نام پنهان]");
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page the person is on, as sent to the model: identifiers masked; under "aggregates" no record label or page title of a record. */
export function redactPage<T extends { title?: string; record?: { type: string; id: string; label?: string } | null; report?: { key: string; params?: Record<string, unknown> } | null }>(
  page: T,
  policy: AiDataPolicy,
): T {
  if (policy === "full") return page;
  const out = { ...page };
  if (out.record) out.record = { ...out.record, label: policy === "aggregates" ? undefined : out.record.label ? maskText(out.record.label) : undefined };
  if (out.title) out.title = policy === "aggregates" && page.record ? undefined : maskText(out.title);
  // report filters are mostly record ids (member=<uuid>): an id is no personal data and the tools
  // take it, so it stays; any other value goes through the policy as tool output does
  if (out.report) {
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.report.params ?? {})) params[k] = typeof v === "string" && UUID_RE.test(v) ? v : (redactValue({ [k]: v }, policy) as Record<string, unknown>)[k];
    out.report = { ...out.report, params };
  }
  return out;
}

/**
 * The `<context>` block at the start of an assistant question (prompts.ts contextBlock) under a
 * policy: the member's name only under "masked"/"full", the page as redactPage leaves it. Used
 * where the block was written under another policy (a Windows app relaying through the web version).
 */
const CONTEXT_RE = /<context>\n([^\n]*)\n<\/context>/g;
export function redactContextBlock(text: string, policy: AiDataPolicy): string {
  if (policy === "full") return text;
  return String(text ?? "").replace(CONTEXT_RE, (whole, json: string) => {
    try {
      const o = JSON.parse(json) as Record<string, unknown>;
      const member = o.member as { name?: unknown; role?: unknown } | undefined;
      if (member && typeof member === "object") o.member = policy === "aggregates" ? { role: member.role } : { ...member, ...(typeof member.name === "string" ? { name: maskText(member.name) } : {}) };
      if (o.current_page && typeof o.current_page === "object") {
        const page = redactPage(o.current_page as Parameters<typeof redactPage>[0], policy) as Record<string, unknown>;
        o.current_page = Object.fromEntries(Object.entries(page).filter(([, v]) => v !== undefined));
      }
      return `<context>\n${JSON.stringify(o)}\n</context>`;
    } catch {
      return `<context>\n${maskText(json)}\n</context>`;
    }
  });
}

/** A tool result as sent to the model (JSON text) under a policy; text that is not JSON is masked. */
export function redactToolContent(content: string, policy: AiDataPolicy): string {
  if (policy === "full") return content;
  try {
    return JSON.stringify(redactValue(JSON.parse(content), policy));
  } catch {
    return maskText(content);
  }
}
