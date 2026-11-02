// Data policy: what leaves the business for a model. "masked" (default) hides national ids,
// mobiles, card numbers, IBANs, passport numbers and addresses in tool outputs and prompts;
// "aggregates" also hides the names of people and parties; "full" sends everything as is.
// Fields are recognised by their key first (tools name them) and by pattern in free text.
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
const NAME_KEY = /^(party|party_name|customer|customer_name|supplier|supplier_name|counterparty|counterparty_name|full_name|person|person_name|payee|payer|drawer|holder|owner_name|beneficiary|sender|receiver|contact|contact_name|first_name|last_name|father_name|member|user_name|created_by_name)$/i;
const PARTY_TYPES = new Set(["party", "person", "customer", "supplier", "member", "user"]);

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
      const isParty = PARTY_TYPES.has(String(o.type ?? o.kind ?? "")) || /party|customer|supplier/i.test(key);
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
