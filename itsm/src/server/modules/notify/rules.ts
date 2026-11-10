// Notification rules: the organisation's rows of `notification_rule` plus the built-in rules every organisation
// starts with (in code, like the built-in roles: a row whose `builtin` names one replaces it — to switch it off, change
// its channels or recipients). A rule matches a record event when the event is the rule's, the table is the rule's
// (built-ins: every table that has what they need) and its condition holds on the record as the event left it —
// `changed` / `changes_to` / `changes_from` compare with the values before the change, rebuilt from the event.
import type { Cond, CondEnv } from "@shared/model/conditions";
import { condPaths, evaluate, validateCond } from "@shared/model/conditions";
import type { TableDef } from "@shared/model/types";
import { STATE_CATEGORIES } from "@shared/model/types";
import { scopeColumns } from "@shared/access";
import { tableDef } from "@shared/tables";
import { NOTIFY_TABLE_KEYS } from "@shared/tables/notify";
import {
  cleanRecipients, customKind, eventsOf, hasRecipients, NOTIFY_CHANNELS, NOTIFY_EVENTS, parseTemplate,
  type NotifyChannel, type NotifyEvent, type RecipientSpec, type RuleGroupMode,
} from "@shared/notify";
import type { Ctx } from "../../context";
import type { RecordEvent } from "../../engine";
import { systemRows } from "./common";

export interface RuleDef {
  /** row id, or "builtin:<key>" for a built-in nobody replaced */
  key: string;
  id: string | null;
  builtin: string | null;
  name: string;
  /** a table key, or "*" (built-ins: every table that has what the rule needs) */
  table: string;
  event: NotifyEvent;
  custom_event: string | null;
  entry_kinds: string[];
  condition: Cond | null;
  recipients: RecipientSpec;
  notify_actor: boolean;
  /** large groups among the recipients: as each group decides (`group`), every member, or leads and managers */
  large_groups: RuleGroupMode;
  channels: NotifyChannel[];
  targets: string[];
  template_id: string | null;
  digest: boolean;
  mandatory: boolean;
  active: boolean;
  description?: string | null;
}

/** What a queued delivery keeps of its rule (later edits do not change what is already on its way). */
export interface RuleSnap {
  key: string;
  name: string;
  event: NotifyEvent;
  channels: NotifyChannel[];
  targets: string[];
  template_id: string | null;
  digest: boolean;
  mandatory: boolean;
}

export const snapOf = (r: RuleDef): RuleSnap => ({
  key: r.key,
  name: r.name,
  event: r.event,
  channels: r.channels,
  targets: r.targets,
  template_id: r.template_id,
  digest: r.digest,
  mandatory: r.mandatory,
});

interface Builtin {
  rule: Omit<RuleDef, "key" | "id" | "table" | "active" | "custom_event" | "notify_actor" | "large_groups" | "targets" | "template_id" | "digest" | "mandatory" | "condition"> & {
    condition?: (def: TableDef) => Cond | null;
    mandatory?: boolean;
  };
  /** the tables it applies to */
  applies: (def: TableDef) => boolean;
  /** an extra test on the event (state categories, …) */
  when?: (e: RecordEvent) => boolean;
}

const has = (def: TableDef, name: string) => def.fields.some((f) => f.name === name);
const groupField = (def: TableDef) => scopeColumns(def).group;
const journal = (def: TableDef) => !!def.features?.journal;
const DONE = ["resolved", "closed", "canceled"];

/** The built-in rules (keys are stable: an organisation's row replaces one by its key). */
export const BUILTINS: Builtin[] = [
  {
    rule: {
      builtin: "assigned_to_me",
      name: "ارجاع به کارشناس",
      event: "assigned",
      entry_kinds: [],
      recipients: { assignee: true },
      channels: ["in_app", "email"],
      condition: () => ({ and: [{ f: "assigned_to", op: "changed" }, { f: "assigned_to", op: "nempty" }] }),
      description: "به کسی که رکورد به او ارجاع شد",
    },
    applies: (def) => has(def, "assigned_to"),
  },
  {
    rule: {
      builtin: "assigned_to_group",
      name: "ارجاع به گروه",
      event: "assigned",
      entry_kinds: [],
      recipients: { assignment_group: true },
      channels: ["in_app"],
      condition: (def) => {
        const g = groupField(def)!;
        return { and: [{ f: g, op: "changed" }, { f: g, op: "nempty" }, ...(has(def, "assigned_to") ? [{ f: "assigned_to", op: "empty" } as Cond] : [])] };
      },
      description: "به اعضای گروهی که رکورد بی‌کارشناس به آن ارجاع شد",
    },
    applies: (def) => !!groupField(def),
  },
  {
    rule: {
      builtin: "comment_to_people",
      name: "پاسخ تازه",
      event: "commented",
      entry_kinds: ["comment", "email_in"],
      recipients: { requester: true, assignee: true, watchers: true },
      channels: ["in_app", "email"],
      description: "به درخواست‌کننده، کارشناس و پیگیری‌کنندگان",
    },
    applies: journal,
  },
  {
    rule: {
      builtin: "work_note_to_team",
      name: "یادداشت داخلی تازه",
      event: "commented",
      entry_kinds: ["work_note"],
      recipients: { assignee: true, watchers: true },
      channels: ["in_app"],
      description: "به کارشناس و پیگیری‌کنندگانی که یادداشت‌های داخلی را می‌بینند",
    },
    applies: journal,
  },
  {
    rule: {
      builtin: "done_to_requester",
      name: "حل یا بسته شدن",
      event: "state_changed",
      entry_kinds: [],
      recipients: { requester: true },
      channels: ["in_app", "email"],
      description: "به درخواست‌کننده، وقتی رکورد حل، بسته یا لغو می‌شود",
    },
    applies: (def) => !!def.states,
    when: (e) => !!e.to_category && DONE.includes(e.to_category) && !DONE.includes(String(e.from_category ?? "")),
  },
  {
    rule: {
      builtin: "mentioned",
      name: "نام بردن (@)",
      event: "mentioned",
      entry_kinds: [],
      recipients: { mentioned: true },
      channels: ["in_app", "email"],
      description: "به کسی که در پاسخ یا یادداشتی از او نام برده شد (اگر آن را می‌بیند)",
    },
    applies: journal,
  },
  {
    rule: {
      builtin: "sla_warning",
      name: "هشدار موعد",
      event: "sla_warning",
      entry_kinds: [],
      recipients: { assignee: true, event_users: true },
      channels: ["in_app", "email"],
    },
    applies: () => true,
  },
  {
    rule: {
      builtin: "sla_breach",
      name: "گذشتن موعد",
      event: "sla_breach",
      entry_kinds: [],
      recipients: { assignee: true, group_manager: true, event_users: true },
      channels: ["in_app", "email"],
    },
    applies: () => true,
  },
  {
    rule: {
      builtin: "approval_requested",
      name: "درخواست تأیید",
      event: "approval_requested",
      entry_kinds: [],
      recipients: { event_users: true },
      channels: ["in_app", "email"],
    },
    applies: () => true,
  },
  {
    rule: {
      builtin: "approval_decided",
      name: "نتیجهٔ تأیید",
      event: "approval_decided",
      entry_kinds: [],
      recipients: { requester: true, event_users: true },
      channels: ["in_app", "email"],
    },
    applies: () => true,
  },
];

export const BUILTIN_KEYS = new Set(BUILTINS.map((b) => b.rule.builtin!));

/** A built-in as a rule (its condition for one table, or none). */
export function builtinRule(b: Builtin, def?: TableDef): RuleDef {
  return {
    ...b.rule,
    key: `builtin:${b.rule.builtin}`,
    id: null,
    table: "*",
    custom_event: null,
    notify_actor: false,
    large_groups: "group",
    targets: [],
    template_id: null,
    digest: true,
    mandatory: b.rule.mandatory ?? false,
    active: true,
    condition: def && b.rule.condition ? b.rule.condition(def) : null,
  };
}

/** A stored rule row as a rule. */
export function rowRule(r: Record<string, any>): RuleDef {
  const channels = (Array.isArray(r.channels) ? r.channels : []).filter((c: string) => c in NOTIFY_CHANNELS) as NotifyChannel[];
  return {
    key: String(r.id),
    id: String(r.id),
    builtin: r.builtin ? String(r.builtin) : null,
    name: String(r.name ?? ""),
    table: String(r.table_key ?? ""),
    event: (r.event in NOTIFY_EVENTS ? r.event : "updated") as NotifyEvent,
    custom_event: r.custom_event ? String(r.custom_event) : null,
    entry_kinds: Array.isArray(r.entry_kinds) ? r.entry_kinds.map(String) : [],
    condition: r.condition && typeof r.condition === "object" && Object.keys(r.condition).length ? (r.condition as Cond) : null,
    recipients: cleanRecipients(r.recipients),
    notify_actor: !!r.notify_actor,
    large_groups: r.large_groups === "members" || r.large_groups === "leads" ? r.large_groups : "group",
    channels: channels.length ? channels : ["in_app"],
    targets: Array.isArray(r.targets) ? r.targets.map(String) : [],
    template_id: r.template_id ? String(r.template_id) : null,
    digest: r.digest !== false,
    mandatory: !!r.mandatory,
    active: r.active !== false,
    description: r.description ?? null,
  };
}

// ----- loading (cached per organisation, dropped when a rule changes) ------------------------------------------------

const cache = new Map<string, { at: number; rows: RuleDef[] }>();
const TTL = 30_000;

export function invalidateRules(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/** The organisation's stored rules (active or not). */
export async function storedRules(sys: Ctx): Promise<RuleDef[]> {
  const hit = cache.get(sys.org.id);
  if (hit && Date.now() - hit.at < TTL) return hit.rows;
  const rows = (await systemRows(sys, "notification_rule")).map(rowRule);
  cache.set(sys.org.id, { at: Date.now(), rows });
  return rows;
}

/** Every rule that may apply to an event of `def`: stored rules of its table and the built-ins nobody replaced. */
export async function candidateRules(sys: Ctx, def: TableDef, e: RecordEvent): Promise<RuleDef[]> {
  if (NOTIFY_TABLE_KEYS.has(def.key)) return [];
  const events = new Set<NotifyEvent>(eventsOf(e.kind));
  const stored = await storedRules(sys);
  const replaced = new Set(stored.filter((r) => r.builtin).map((r) => r.builtin!));
  const out: RuleDef[] = [];
  for (const r of stored) {
    if (!r.active) continue;
    if (r.builtin) {
      // a replaced built-in keeps applying where the built-in applies, with the organisation's settings
      const b = BUILTINS.find((x) => x.rule.builtin === r.builtin);
      if (!b || !b.applies(def) || (b.when && !b.when(e)) || !events.has(r.event)) continue;
      out.push({ ...r, table: def.key, condition: r.condition ?? (b.rule.condition ? b.rule.condition(def) : null) });
      continue;
    }
    if (r.table !== def.key) continue;
    if (r.event === "custom" ? !r.custom_event || customKind(r.custom_event) !== e.kind : !events.has(r.event)) continue;
    out.push(r);
  }
  for (const b of BUILTINS) {
    if (replaced.has(b.rule.builtin!) || !events.has(b.rule.event) || !b.applies(def) || (b.when && !b.when(e))) continue;
    out.push(builtinRule(b, def));
  }
  return out;
}

// ----- matching -----------------------------------------------------------------------------------------------------

/** A value we do not know (a long text that changed): never equal to anything, so `changed` holds. */
const UNKNOWN = Object.freeze({ unknown: true });

/**
 * The record as the event left it (`next`: the current row with the event's new values laid over it, so a later
 * change does not decide) and before it (`prev`: null for a new record).
 */
export function eventRows(def: TableDef, row: Record<string, unknown>, e: RecordEvent): { next: Record<string, unknown>; prev: Record<string, unknown> | null } {
  const next = { ...row };
  const prev = { ...row };
  for (const [f, c] of Object.entries(e.changes ?? {})) {
    next[f] = c.to;
    prev[f] = c.from;
  }
  for (const f of e.changed ?? []) if (!e.changes || !(f in e.changes)) prev[f] = UNKNOWN;
  const sf = def.states?.field;
  if (sf && e.kind === "record.state_changed") {
    if (e.to !== undefined) next[sf] = e.to;
    if (e.from !== undefined) prev[sf] = e.from;
  }
  if (e.assigned_to) {
    next.assigned_to = e.assigned_to.to;
    prev.assigned_to = e.assigned_to.from;
  }
  const g = groupField(def);
  if (g && e.assignment_group) {
    next[g] = e.assignment_group.to;
    prev[g] = e.assignment_group.from;
  }
  return { next, prev: e.kind === "record.created" ? null : prev };
}

/** Paths of a condition that walk into other records (their values are loaded before evaluating). */
export const walkPaths = (c: Cond | null): string[] => [...condPaths(c)].filter((p) => p.includes("."));

/** Does the rule hold for this event? (`entryKind`: the journal entry of a commented event) */
export function ruleHolds(rule: RuleDef, def: TableDef, rows: { next: Record<string, unknown>; prev: Record<string, unknown> | null }, env: CondEnv, entryKind: string | null): boolean {
  if ((rule.event === "commented" || rule.event === "mentioned") && rule.entry_kinds.length && (!entryKind || !rule.entry_kinds.includes(entryKind))) return false;
  if (!rule.condition) return true;
  return evaluate(rule.condition, rows.next, { ...env, prev: rows.prev }, def);
}

/** Journal kinds that count as «commented» (system, approval and AI entries do not notify). */
export const COMMENT_KINDS = new Set(["comment", "work_note", "email_in"]);

// ----- validation of stored rows (a hook of notification_rule) ----------------------------------------------------------

/** Persian problems of a rule row, by field (empty when it is fine). */
export function ruleProblems(row: Record<string, any>, lookup: (key: string) => TableDef | undefined = tableDef): Record<string, string> {
  const out: Record<string, string> = {};
  const builtin = row.builtin ? String(row.builtin) : null;
  if (builtin && !BUILTIN_KEYS.has(builtin)) out.builtin = "قانون پیش‌فرضی با این نام وجود ندارد";
  const key = String(row.table_key ?? "");
  const def = key === "*" ? undefined : lookup(key);
  if (!builtin) {
    if (!def || def.virtual) out.table_key = `جدول «${key}» وجود ندارد`;
    else if (NOTIFY_TABLE_KEYS.has(def.key)) out.table_key = "قانون اعلان برای جدول‌های خود اعلان‌ها ساخته نمی‌شود";
  }
  if (row.event === "custom" && !/^[a-z][a-z0-9_.]{1,79}$/.test(String(row.custom_event ?? "").replace(/^record\./, ""))) {
    out.custom_event = "نام رویداد سفارشی را با حروف لاتین کوچک بنویسید (مثلاً major_declared)";
  }
  if (row.condition && typeof row.condition === "object" && Object.keys(row.condition).length) {
    if (!def) out.condition = "برای شرط، جدول را مشخص کنید";
    else {
      const p = validateCond(row.condition, def, { rules: true, lookup });
      if (p) out.condition = p;
    }
  }
  const rec = cleanRecipients(row.recipients);
  if (!hasRecipients(rec)) out.recipients = "دست‌کم یک گیرنده انتخاب کنید";
  if (def && rec.fields?.length) {
    const bad = rec.fields.filter((n) => {
      const f = def.fields.find((x) => x.name === n);
      return !f || !["user", "users", "group"].includes(f.type);
    });
    if (bad.length) out.recipients = `«${bad.join("، ")}» فیلد کاربر یا گروه نیست`;
  }
  const channels = Array.isArray(row.channels) ? row.channels : [];
  if (!channels.length) out.channels = "دست‌کم یک راه ارسال انتخاب کنید";
  if (channels.includes("webhook") && !(Array.isArray(row.targets) && row.targets.length)) out.targets = "برای ارسال به پیام‌رسان یا وب‌هوک، کانال را انتخاب کنید";
  return out;
}

/** Persian problem of a template row's placeholders (null when it reads fine). */
export function templateProblem(row: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ["subject", "body", "short_text"] as const) {
    const p = parseTemplate(row[f]).error;
    if (p) out[f] = p;
  }
  return out;
}

/** Labels of the state categories (for the change list and default templates). */
export const categoryLabel = (c: string | null | undefined) => (c && c in STATE_CATEGORIES ? STATE_CATEGORIES[c as keyof typeof STATE_CATEGORIES].label : "");
