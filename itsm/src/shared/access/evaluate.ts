// The in-memory form of the access policy: whether a subject may read, change or delete one row, why, which fields
// they see and which transitions they may take. The server compiles the SAME rules into SQL
// (src/server/access/predicate.ts) and the parity tests (tests/access-parity.test.ts) prove both agree on random
// organisations; single-row checks (canWrite, canDelete, explain) use this form. docs/spec/ACCESS.md § Evaluation.
// Imported by the UI: keep it free of server imports.
import type { FieldGroup, TableDef, Transition } from "../model/types";
import { grantIn, SCOPE_LABELS, type Effective, type FullGrant, type Scope } from "./model";
import { areaLabel } from "./areas";

/** Who is asking, resolved once per request (src/server/access/subject.ts builds it). */
export interface Subject {
  orgId: string;
  userId: string;
  /** a member, a platform administrator's support session, or the platform itself (jobs, flows) */
  kind: "user" | "support" | "system";
  eff: Effective;
  /** groups whose records the subject reads: member, lead and observer memberships, plus the groups below groups they lead */
  groups: string[];
  /** groups whose records the subject may change (observers excluded) */
  writeGroups: string[];
  /** groups the subject leads */
  ledGroups: string[];
  unitId: string | null;
  /** the subject's unit and every unit below it */
  unitTree: string[];
  /** units the subject manages, with everything below them (department heads read their people's records) */
  managedTree: string[];
  /** people whose manager (or manager's manager) the subject is */
  reportees: string[];
  /** out-of-office members who named the subject their delegate (the subject works their assigned records) */
  delegators: string[];
  /** the organisation separates domains */
  domainSeparation: boolean;
  domainId: string | null;
  /** the subject's domain and the domains below it */
  domainTree: string[];
  /** workspaces the subject belongs to (explicitly or through a group) */
  workspaces: string[];
  /** the organisation's secure workspaces (only their members read their records) */
  secureWorkspaces: string[];
  /** the organisation's restricted groups (only their members read the records assigned to them) */
  restrictedGroups: string[];
}

export type Row = Record<string, unknown>;

/** The columns of a table the access model reads (from `def.scope`, with defaults). */
export interface ScopeColumns {
  /** own user fields (a scalar user or an array of users) */
  own: { name: string; array: boolean }[];
  /** requester-side own fields, in priority order */
  requester: { name: string; array: boolean }[];
  /** own fields that are not requester-side (the assignee) */
  assignee: { name: string; array: boolean }[];
  /** read-only participants named on the row (`scope.readers`): they read it, never change it */
  readers: { name: string; array: boolean }[];
  watchers: string | null;
  group: string | null;
  unit: string;
  domain: string;
  workspace: string;
  confidential: boolean;
  confidentialGroup: FieldGroup;
  accessList: string | null;
  public: boolean;
  requesterWritable: string[] | null;
  requesterTransitions: { from?: string[]; to: string }[] | null;
  /** parent-scoped rows: the reference field naming the parent and the parent's table (`scope.parent`) */
  parent: { field: string; table: string } | null;
}

const columns = new WeakMap<TableDef, ScopeColumns>();

export function scopeColumns(def: TableDef): ScopeColumns {
  let c = columns.get(def);
  if (c) return c;
  const s = def.scope ?? {};
  const field = (name: string) => def.fields.find((f) => f.name === name);
  const userField = (name: string) => {
    const f = field(name);
    return f && (f.type === "user" || f.type === "users") ? { name, array: f.type === "users" } : null;
  };
  const list = (names: string[]) => names.map(userField).filter((x): x is { name: string; array: boolean } => !!x);
  const requesterNames = s.requester ?? (s.own ?? []).filter((n) => n !== "assigned_to");
  // requester-side fields count as own even when a table lists them only under `requester`
  const own = list([...new Set([...(s.own ?? []), ...requesterNames])]);
  const requester = list(requesterNames);
  const assignee = own.filter((f) => !requesterNames.includes(f.name));
  const readers = list((s.readers ?? []).filter((n) => !own.some((f) => f.name === n)));
  const groupField = s.group && field(s.group) ? s.group : null;
  const confidential = !!def.features?.confidential;
  const parentField = s.parent ? field(s.parent) : undefined;
  if (s.parent && !(parentField && parentField.type === "ref" && parentField.ref && parentField.ref !== "$self")) {
    throw new Error(`${def.key}: scope.parent «${s.parent}» must be a reference field to another table`);
  }
  c = {
    own,
    requester,
    assignee,
    readers,
    watchers: s.watchers && field(s.watchers) ? s.watchers : null,
    group: groupField,
    unit: s.unit ?? "unit_id",
    domain: s.domain ?? "domain_id",
    workspace: s.workspace ?? "workspace_id",
    confidential,
    confidentialGroup: s.confidentialGroup ?? (def.area === "hr" ? "hr" : "security"),
    accessList: confidential && field("access_list") ? "access_list" : null,
    public: !!s.public,
    requesterWritable: s.requesterWritable ?? null,
    requesterTransitions: s.requesterTransitions ?? (s.requesterWritable ? [] : null),
    parent: parentField ? { field: parentField.name, table: parentField.ref! } : null,
  };
  columns.set(def, c);
  return c;
}

const holds = (v: unknown, who: string): boolean => (Array.isArray(v) ? v.includes(who) : v === who);
const holdsAny = (v: unknown, set: readonly string[]): boolean =>
  set.length > 0 && (Array.isArray(v) ? v.some((x) => set.includes(x as string)) : typeof v === "string" && set.includes(v));
const idOf = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Secure workspaces the subject is not a member of / restricted groups they are not in. */
export const secureOutside = (s: Subject) => s.secureWorkspaces.filter((w) => !s.workspaces.includes(w));
export const restrictedOutside = (s: Subject) => s.restrictedGroups.filter((g) => !s.groups.includes(g));

// ----- the rule's parts (each mirrored by a SQL term in src/server/access/predicate.ts) ---------------------------

export function domainOk(s: Subject, c: ScopeColumns, row: Row): boolean {
  if (!s.domainSeparation || s.eff.domainsAll) return true;
  const d = idOf(row[c.domain]);
  return d === null || s.domainTree.includes(d);
}

export function hasGroup(s: Subject, g: FieldGroup): boolean {
  return s.kind === "system" || s.eff.fieldGroups.includes(g);
}

/** The confidentiality rule; readers pass it for reading only (naming someone a reader never lets them write). */
export function confidentialOk(s: Subject, c: ScopeColumns, row: Row, write = false): boolean {
  if (!c.confidential || row.confidential !== true || hasGroup(s, c.confidentialGroup)) return true;
  if (c.group && holdsAny(row[c.group], s.groups)) return true;
  if ([...c.assignee, ...c.requester, ...(write ? [] : c.readers)].some((f) => holds(row[f.name], s.userId))) return true;
  return !!c.accessList && holds(row[c.accessList], s.userId);
}

/** The own (or readers) field that names the subject, the watch list, or an assignee field of a delegator. */
export function ownMatch(s: Subject, c: ScopeColumns, row: Row): string | null {
  for (const f of c.own) if (holds(row[f.name], s.userId)) return f.name;
  for (const f of c.readers) if (holds(row[f.name], s.userId)) return f.name;
  if (c.watchers && holds(row[c.watchers], s.userId)) return c.watchers;
  for (const f of c.assignee) if (holdsAny(row[f.name], s.delegators)) return `${f.name}:delegate`;
  return null;
}

const assigneeOwn = (s: Subject, c: ScopeColumns, row: Row) => c.assignee.some((f) => holds(row[f.name], s.userId) || holdsAny(row[f.name], s.delegators));
const requesterOwn = (s: Subject, c: ScopeColumns, row: Row) => c.requester.some((f) => holds(row[f.name], s.userId));

/**
 * Does `scope` reach the row? Scopes are cumulative — each reaches what the narrower ones reach — so the most
 * permissive of a subject's grants never sees less: group = the group field holds one of the subject's groups;
 * unit = group ∨ the subject's unit; unit_tree = group ∨ the subject's unit subtree; domain = group ∨ unit subtree ∨
 * the subject's domain subtree (or no domain; everything when the organisation does not separate domains); all.
 * (`own` is not a scope term: own records are matched by `ownMatch`.)
 */
export function scopeMatch(s: Subject, c: ScopeColumns, row: Row, scope: Scope, write = false): boolean {
  if (scope === "all") return true;
  if (scope === "none" || scope === "own") return false;
  if (c.group && holdsAny(row[c.group], write ? s.writeGroups : s.groups)) return true;
  if (scope === "group") return false;
  const u = idOf(row[c.unit]);
  if (scope === "unit") return u !== null && u === s.unitId;
  if (u !== null && s.unitTree.includes(u)) return true;
  if (scope === "unit_tree") return false;
  if (!s.domainSeparation) return true;
  const d = idOf(row[c.domain]);
  return d === null || s.domainTree.includes(d);
}

export function workspaceOk(s: Subject, c: ScopeColumns, row: Row): boolean {
  const w = idOf(row[c.workspace]);
  if (w === null) return true;
  if (s.eff.workspacesAll) return !secureOutside(s).includes(w);
  return s.workspaces.includes(w);
}

export function secureOk(s: Subject, c: ScopeColumns, row: Row): boolean {
  const w = idOf(row[c.workspace]);
  return w === null || !secureOutside(s).includes(w);
}

export function restrictedOk(s: Subject, c: ScopeColumns, row: Row): boolean {
  if (!c.group) return true;
  const g = idOf(row[c.group]);
  return g === null || !restrictedOutside(s).includes(g);
}

/** Department heads (their units' subtrees) and line managers (their reportees) read their people's records. */
export function requesterSideMatch(s: Subject, c: ScopeColumns, row: Row): boolean {
  if (!c.requester.length) return false;
  const u = idOf(row[c.unit]);
  if (u !== null && s.managedTree.includes(u)) return true;
  return c.requester.some((f) => holdsAny(row[f.name], s.reportees));
}

// ----- decisions --------------------------------------------------------------------------------------------------

export interface RowExtra {
  /** the subject is a participant through a registered source of reach `scoped` (checked in SQL) */
  participant?: boolean;
  /**
   * the subject is a participant through a source of reach `grant` (has or had an approval on the record, owns a
   * service it names…): a read grant of its own, limited to that row (checked in SQL)
   */
  granted?: boolean;
  /**
   * … through a bounded source of reach `scoped` / `grant` (a service's owners): within secure workspaces and
   * restricted groups only (ACCESS §6, §15.5: a role in context that the record does not name passes no restriction)
   */
  boundedParticipant?: boolean;
  boundedGranted?: boolean;
  /**
   * parent-scoped rows (`scope.parent`): the subject may read the row's parent (checked in SQL with the parent's own
   * rule). Unset counts as not readable: a row with a parent is never read without the parent's answer.
   */
  parentReadable?: boolean;
}

/** Does the parent rule of a parent-scoped row hold (no parent named, or the parent is readable)? */
export function parentOk(c: ScopeColumns, row: Row, extra: RowExtra): boolean {
  if (!c.parent) return true;
  return idOf(row[c.parent.field]) === null || !!extra.parentReadable;
}

/** May `s` read `row` of `def`? */
export function canReadRow(s: Subject, def: TableDef, row: Row, extra: RowExtra = {}): boolean {
  if (s.kind === "system") return true;
  if (row.org_id !== undefined && row.org_id !== s.orgId) return false;
  if (def.virtual) return true;
  const g = grantIn(s.eff, def.area);
  const c = scopeColumns(def);
  // a parent-scoped row: only those who read its parent (whatever else opens the row)
  if (!parentOk(c, row, extra)) return false;
  // the participant grant (approvers…): no role reads the area, the record names the subject; restrictions hold
  if (g.read === "none") {
    if (!domainOk(s, c, row) || !confidentialOk(s, c, row)) return false;
    return !!extra.granted || (!!extra.boundedGranted && secureOk(s, c, row) && restrictedOk(s, c, row));
  }
  if (c.public) return true;
  if (!domainOk(s, c, row) || !confidentialOk(s, c, row)) return false;
  if (ownMatch(s, c, row) || extra.participant || extra.granted) return true;
  if (scopeMatch(s, c, row, g.read) && workspaceOk(s, c, row) && restrictedOk(s, c, row)) return true;
  return (requesterSideMatch(s, c, row) || !!extra.boundedParticipant || !!extra.boundedGranted) && secureOk(s, c, row) && restrictedOk(s, c, row);
}

/**
 * How `s` may change `row`: "full" (every writable field), "requester" (only the table's requesterWritable fields:
 * the subject reaches the record only as its requester) or null. `op: "delete"` asks about deleting (requesters of
 * tables with a requester whitelist never delete).
 */
export function writeMode(s: Subject, def: TableDef, row: Row, op: "write" | "delete" = "write"): "full" | "requester" | null {
  if (s.kind === "system") return "full";
  if (row.org_id !== undefined && row.org_id !== s.orgId) return null;
  if (def.virtual) return null;
  const g = grantIn(s.eff, def.area);
  const scope = op === "write" ? g.write : g.delete;
  if (scope === "none") return null;
  const c = scopeColumns(def);
  if (!domainOk(s, c, row) || !confidentialOk(s, c, row, true)) return null;
  if (assigneeOwn(s, c, row)) return "full";
  if (scopeMatch(s, c, row, scope, true) && workspaceOk(s, c, row) && restrictedOk(s, c, row)) return "full";
  if (requesterOwn(s, c, row)) {
    if (!c.requesterWritable) return "full";
    return op === "write" ? "requester" : null;
  }
  return null;
}

/** May `s` take transition `t` on `row` (beyond being allowed to change it)? */
export function canTransitionRow(s: Subject, def: TableDef, row: Row, t: Transition): boolean {
  if (s.kind === "system") return true;
  const mode = writeMode(s, def, row);
  if (!mode) return false;
  if (mode === "requester") {
    const c = scopeColumns(def);
    const state = String(row[def.states?.field ?? "state"] ?? "");
    if (!(c.requesterTransitions ?? []).some((r) => r.to === t.to && (!r.from || r.from.includes(state)))) return false;
  }
  if (t.roles) {
    if (t.roles.roles?.length && !t.roles.roles.some((k) => s.eff.roles.includes(k))) return false;
    const g = grantIn(s.eff, t.roles.area);
    if (t.roles.level === "full" && !g.approve) return false;
    if (t.roles.level === "edit" && (mode !== "full" || g.write === "none")) return false;
    if (t.roles.level === "view" && g.read === "none") return false;
  }
  return true;
}

/** Fields of `def` the subject may not see (their field group is not among the subject's). */
export function hiddenFields(s: Subject, def: TableDef): string[] {
  if (s.kind === "system") return [];
  return def.fields.filter((f) => f.group && !s.eff.fieldGroups.includes(f.group)).map((f) => f.name);
}

/**
 * What a nav item, a space or a palette search needs of the member's ITSM access to be offered (the server still
 * checks every route): an area, an operation (default read) and, for read / write / delete, the least scope
 * (default own) — `{ area: "request", scope: "group" }` is a fulfilment queue, `{ area: "catalog", op: "create" }`
 * the catalogue's definitions, `{ area: "change" }` the change space.
 */
export interface AccessGate {
  area: string;
  op?: "read" | "create" | "write" | "delete" | "approve" | "admin";
  scope?: Scope;
  /** also a field group (a screen that filters or sorts on the group's fields: the server refuses those without it) */
  fieldGroup?: string;
}

/**
 * Does a member with `grants` (per area, from the shell's access) and `fieldGroups` pass `gate`? Without grants (an
 * older server), yes; without field groups (an older server), a gate's field group is not asked.
 */
export function gateAllows(grants: Readonly<Record<string, FullGrant>> | null | undefined, gate: AccessGate, fieldGroups?: readonly string[] | null): boolean {
  if (!grants) return true;
  if (gate.fieldGroup && fieldGroups && !fieldGroups.includes(gate.fieldGroup)) return false;
  const g = grants[gate.area] ?? grants["*"];
  if (!g) return false;
  const op = gate.op ?? "read";
  if (op === "create" || op === "approve" || op === "admin") return !!g[op];
  return SCOPE_ORDER.indexOf(g[op]) >= SCOPE_ORDER.indexOf(gate.scope ?? "own");
}

const SCOPE_ORDER: Scope[] = ["none", "own", "group", "unit", "unit_tree", "domain", "all"];

/** The subject's grant in the table's area. */
export const tableGrant = (s: Subject, def: TableDef): FullGrant => grantIn(s.eff, def.area);

// ----- explanation («بررسی دسترسی») ----------------------------------------------------------------------------

export interface ExplainLayer {
  key: "tenant" | "grant" | "public" | "domain" | "confidential" | "parent" | "own" | "participant" | "scope" | "workspace" | "restricted" | "requester_side";
  label: string;
  /** passed, failed, or not applicable (null) */
  ok: boolean | null;
  detail: string;
}

export interface RowExplanation {
  read: boolean;
  write: "full" | "requester" | null;
  delete: boolean;
  /** what made it readable */
  via: "system" | "public" | "own" | "participant" | "scope" | "requester_side" | null;
  layers: ExplainLayer[];
}

/** Every layer of the read rule with pass/fail and a Persian reason, plus the write and delete decisions. */
export function explainRow(s: Subject, def: TableDef, row: Row, extra: RowExtra = {}): RowExplanation {
  const layers: ExplainLayer[] = [];
  const read = canReadRow(s, def, row, extra);
  const write = writeMode(s, def, row);
  const del = writeMode(s, def, row, "delete") === "full";
  if (s.kind === "system") return { read, write, delete: del, via: "system", layers: [{ key: "tenant", label: "سامانه", ok: true, detail: "سامانه در سازمان خود به همه چیز دسترسی دارد" }] };
  const c = scopeColumns(def);
  const g = grantIn(s.eff, def.area);
  const tenant = row.org_id === undefined || row.org_id === s.orgId;
  layers.push({ key: "tenant", label: "سازمان", ok: tenant, detail: tenant ? "رکورد از همین سازمان است" : "رکورد از سازمان دیگری است" });
  layers.push({
    key: "grant",
    label: "مجوز نقش‌ها",
    ok: g.read !== "none",
    detail:
      g.read === "none"
        ? `هیچ‌یک از نقش‌ها در «${areaLabel(def.area)}» اجازهٔ مشاهده نمی‌دهد`
        : `مشاهده: «${SCOPE_LABELS[g.read]}»، ویرایش: «${SCOPE_LABELS[g.write]}»، حذف: «${SCOPE_LABELS[g.delete]}»`,
  });
  if (c.public) layers.push({ key: "public", label: "دادهٔ مرجع", ok: true, detail: "همهٔ اعضا این جدول را می‌بینند" });
  const dOk = domainOk(s, c, row);
  layers.push({
    key: "domain",
    label: "دامنه",
    ok: !s.domainSeparation ? null : dOk,
    detail: !s.domainSeparation
      ? "جداسازی دامنه‌ها خاموش است"
      : s.eff.domainsAll
        ? "نقش‌ها همهٔ دامنه‌ها را می‌بینند"
        : dOk
          ? "رکورد در دامنهٔ کاربر یا بدون دامنه است"
          : "رکورد در دامنهٔ دیگری است",
  });
  const isConf = c.confidential && row.confidential === true;
  const cOk = confidentialOk(s, c, row);
  layers.push({
    key: "confidential",
    label: "محرمانگی",
    ok: isConf ? cOk : null,
    detail: !isConf
      ? "رکورد محرمانه نیست"
      : cOk
        ? "کاربر عضو گروه، کارشناس، درخواست‌دهنده، در فهرست دسترسی یا دارای گروه فیلد لازم است"
        : "رکورد محرمانه است و کاربر جزو کسانی نیست که آن را می‌بینند",
  });
  if (c.parent) {
    const named = idOf(row[c.parent.field]) !== null;
    const pOk = parentOk(c, row, extra);
    const label = def.fields.find((f) => f.name === c.parent!.field)?.label ?? c.parent.field;
    layers.push({
      key: "parent",
      label: "رکورد اصلی",
      ok: named ? pOk : null,
      detail: !named ? `«${label}» خالی است؛ قاعدهٔ خود ردیف کافی است` : pOk ? `کاربر «${label}» این ردیف را می‌بیند` : `کاربر «${label}» این ردیف را نمی‌بیند؛ ردیف‌های آن را هم نمی‌بیند`,
    });
  }
  const own = ownMatch(s, c, row);
  const fieldLabel = (n: string) => def.fields.find((f) => f.name === n.replace(/:delegate$/, ""))?.label ?? n;
  layers.push({
    key: "own",
    label: "مالکیت یا مشارکت",
    ok: c.own.length || c.readers.length || c.watchers ? !!own : null,
    detail: own ? (own.endsWith(":delegate") ? `جانشین کسی است که «${fieldLabel(own)}» این رکورد است` : `کاربر «${fieldLabel(own)}» این رکورد است`) : "کاربر در فیلدهای مالکیت این رکورد نیست",
  });
  if (extra.participant !== undefined || extra.granted !== undefined) {
    const p = !!extra.participant || !!extra.granted;
    layers.push({
      key: "participant",
      label: "مشارکت",
      ok: p,
      detail: extra.granted
        ? "کاربر تأییدکنندهٔ این رکورد است یا بوده؛ این مشارکت به‌تنهایی خواندن همین رکورد را می‌دهد"
        : extra.participant
          ? "کاربر در مشارکتی روی این رکورد است"
          : "مشارکتی در کار نیست",
    });
  }
  if (extra.boundedParticipant !== undefined || extra.boundedGranted !== undefined) {
    const b = !!extra.boundedParticipant || !!extra.boundedGranted;
    layers.push({ key: "participant", label: "نقش در خدمت", ok: b, detail: b ? "کاربر نقشی در خدمت این رکورد دارد (جز در فضای کاری امن یا گروه محدودی که عضو آن نیست)" : "کاربر نقشی در خدمت این رکورد ندارد" });
  }
  const sOk = scopeMatch(s, c, row, g.read);
  layers.push({ key: "scope", label: "دامنهٔ دید نقش", ok: g.read === "none" || g.read === "own" ? null : sOk, detail: `دامنهٔ «${SCOPE_LABELS[g.read]}» ${sOk ? "این رکورد را در بر می‌گیرد" : "این رکورد را در بر نمی‌گیرد"}` });
  const wOk = workspaceOk(s, c, row);
  layers.push({
    key: "workspace",
    label: "فضای کاری",
    ok: row[c.workspace] ? wOk : null,
    detail: !row[c.workspace] ? "رکورد فضای کاری ندارد (عمومی است)" : wOk ? "کاربر به فضای کاری این رکورد دسترسی دارد" : "رکورد در فضای کاری‌ای است که کاربر عضو آن نیست (یا فضای کاری امن است)",
  });
  const rOk = restrictedOk(s, c, row);
  layers.push({ key: "restricted", label: "گروه محدود", ok: c.group && row[c.group] && s.restrictedGroups.includes(String(row[c.group])) ? rOk : null, detail: rOk ? "محدودیت گروه مانع نیست" : "رکورد به گروهی محدود ارجاع شده که کاربر عضو آن نیست" });
  const rs = requesterSideMatch(s, c, row);
  layers.push({ key: "requester_side", label: "مدیر واحد یا مدیر مستقیم", ok: c.requester.length ? rs : null, detail: rs ? "رکورد از آنِ یکی از افراد واحد یا زیردستان کاربر است" : "رکورد از آنِ افراد زیر نظر کاربر نیست" });
  let via: RowExplanation["via"] = null;
  if (read) {
    if (g.read === "none") via = "participant";
    else if (c.public) via = "public";
    else if (own) via = "own";
    else if (extra.participant || extra.granted) via = "participant";
    else if (sOk && wOk && rOk) via = "scope";
    else if (rs) via = "requester_side";
    else via = "participant";
  }
  return { read, write, delete: del, via, layers };
}
