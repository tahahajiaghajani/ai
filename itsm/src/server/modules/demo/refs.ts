// The purge's reference catalogue (docs/DEMO_FA.md «حذف کامل», release 1.1.5): every place a row of the organisation can
// name another row, and the role that decides what «حذف داده‌های نمایشی» does when the named row goes. The purge removes
// the pack and what cannot stand without it, keeps and cleans what was built on top of it, and leaves nothing that names a
// removed row (the post-purge verifier, `verify.ts`):
//
//   parent       the row exists for the named one (a required reference, `scope.parent`, `PARENTS`, a requester or
//                beneficiary field naming a pack person): it was recorded on demo data — deleted with it (class B)
//   pointer      an optional reference or a list member: cleared (the list loses the id); routing pointers (assignee,
//                group, owner, manager…) are cleared through the engine, whose hooks route the record again (class D)
//   restriction  an allow-list or scope where empty means «everyone» / «every record» (portal audiences, a catalogue's
//                «در دسترس برای», an SLA definition's service): never widened — the row is deactivated when its list
//                empties or its scope goes (class C)
//   producer     JSON that writes ids into other rows (business rule actions, SLA breach actions, flow steps, inbound
//                defaults, field defaults): the action or value goes; a definition left empty is deactivated (class C)
//   assignment   who works a workflow (process drafts' rules, starters, managers; forms' library fields): pruned, the
//                designer shows what is left to fix; published versions are never rewritten (class C)
//   anchor       the access anchors unit_id / domain_id: recomputed with the engine's derivation (class E)
//   approval     an approval of a real record asked of a removed person: its round is planned again (class D)
//   trail        history, journal, audit, sign-ins and authorship stamps: kept, shown as removed (class F)
//   snapshot     immutable snapshots (a published workflow or flow version): kept as published (class F)
//
// Conditions are pruned by meaning, not by text: a clause that compares with a removed id can never hold again (no live
// row names a removed row once the purge is done), so `eq`/`in`/`contains`/`changes_*` of only removed ids are false and
// `ne`/`nin`/`ncontains` true; the boolean structure is simplified and a condition that can no longer hold makes its
// definition meaningless (deactivated). Nothing a condition selects widens. Pure: shared by the purge, its preview and
// the tests (`tests/demo-refs-registry.test.ts` fails when a json or conditions field, or an id column, has no decision).
import type { FieldDef, TableDef } from "@shared/model/types";
import { FIELD_TYPES, refTarget } from "@shared/model/types";
import type { Cond, Leaf } from "@shared/model/conditions";
import { ALWAYS, NEVER } from "@shared/model/conditions";
import { cleanRecipients, hasRecipients } from "@shared/notify";

export type RefRole = "parent" | "pointer" | "restriction" | "producer" | "assignment" | "anchor" | "approval" | "trail" | "snapshot";

export const UUID_RE_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID = new RegExp(`^${UUID_RE_SRC}$`, "i");
const UUID_ANY = new RegExp(UUID_RE_SRC, "gi");
const UUID_SOME = new RegExp(UUID_RE_SRC, "i");
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Every uuid that occurs anywhere in a value (lower case). */
export function uuidsIn(v: unknown): string[] {
  const text = typeof v === "string" ? v : JSON.stringify(v ?? null);
  return [...new Set((text.match(UUID_ANY) ?? []).map((s) => s.toLowerCase()))];
}

/**
 * What the purge removes, as the handlers ask it: removed rows by id (any table), positions by key or id, library fields
 * and table custom fields by name. Built per chunk of rows from the registry (`sm_demo_rows`) and the plan's names.
 */
export interface Gone {
  /** a removed row of any table (a person, a group, a unit, a record…) */
  id(id: string): boolean;
  /** a removed position, by key or id */
  position(keyOrId: string): boolean;
  /** a removed library field (`field_def`), by name: forms and workflow drafts name library fields */
  libraryField(name: string): boolean;
  /** a field removed from a table (a pack library field attached to it): conditions on that table name it */
  tableField?(table: string, name: string): boolean;
}

const lc = (s: string) => s.toLowerCase();
const goneId = (gone: Gone, v: unknown) => isUuid(v) && gone.id(lc(v));
const hasGone = (gone: Gone, v: unknown) => uuidsIn(v).some((id) => gone.id(id));

// ---------------------------------------------------------------------------------------------------------------
// Generic JSON: removed ids leave lists and objects

/** Marker of a value that goes (a removed id, or a string naming one). */
const DROP = Symbol("drop");

/**
 * Remove every removed id from a JSON value: list members that are (or name) a removed id leave the list — an object
 * entry whose `id` is one goes whole (a share, a pinned record) — object members whose value is (or names) a removed id
 * leave the object, and so do members keyed by a removed id. Strings that merely contain a removed id (a link, a
 * template) go as well: nothing names a removed row afterwards.
 */
export function pruneIds(value: unknown, gone: Gone): { value: unknown; changed: boolean } {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!UUID_SOME.test(v)) return v;
      if (hasGone(gone, v)) {
        changed = true;
        return DROP;
      }
      return v;
    }
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const x of v) {
        // an entry that is about a removed row (its `id` names it: a share, a pinned record) goes whole
        if (x && typeof x === "object" && !Array.isArray(x) && goneId(gone, (x as { id?: unknown }).id)) {
          changed = true;
          continue;
        }
        const y = walk(x);
        if (y !== DROP) out.push(y);
      }
      return out;
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (isUuid(k) && gone.id(lc(k))) {
          changed = true;
          continue;
        }
        const y = walk(x);
        if (y !== DROP) out[k] = y;
      }
      return out;
    }
    return v;
  };
  const out = walk(value);
  return { value: out === DROP ? null : out, changed };
}

// ---------------------------------------------------------------------------------------------------------------
// Conditions: pruned by meaning

type Tri = Cond | true | false;

/** A leaf on a field that no longer exists: its value is empty everywhere (positive operators false, negative ones true). */
function emptyLeaf(op: string): boolean {
  return op === "ne" || op === "nin" || op === "ncontains" || op === "empty";
}

const POSITIVE_ONE = new Set(["eq", "contains", "changes_to", "changes_from", "starts", "ends", "lt", "lte", "gt", "gte", "between", "relative"]);

function pruneLeaf(l: Leaf, gone: Gone, table: string | null): Tri | Leaf {
  const path = typeof l.f === "string" ? l.f : "";
  const head = path.split(".")[0];
  if (head && ((table && gone.tableField?.(table, head)) || (head.startsWith("u_") && gone.libraryField(head) && !table))) return emptyLeaf(l.op);
  if (l.v === undefined || !hasGone(gone, l.v)) return l;
  if (l.op === "in" || l.op === "nin") {
    const list = (Array.isArray(l.v) ? l.v : [l.v]).filter((x) => !hasGone(gone, x));
    if (list.length) return { ...l, v: list };
    return l.op === "nin";
  }
  if (l.op === "ne" || l.op === "ncontains") return true;
  if (POSITIVE_ONE.has(l.op)) return false;
  // an operator that takes no value but carries one naming a removed row: the value is dropped
  const { v: _v, ...rest } = l;
  return rest as Leaf;
}

function pruneTri(c: unknown, gone: Gone, table: string | null): Tri | unknown {
  if (!c || typeof c !== "object" || Array.isArray(c)) return c;
  const o = c as Record<string, unknown>;
  if (Array.isArray(o.and)) {
    const xs = o.and.map((x) => pruneTri(x, gone, table));
    if (xs.some((x) => x === false)) return false;
    const rest = xs.filter((x) => x !== true) as Cond[];
    if (!rest.length) return o.and.length ? true : c;
    return { ...o, and: rest } as Cond;
  }
  if (Array.isArray(o.or)) {
    const xs = o.or.map((x) => pruneTri(x, gone, table));
    if (xs.some((x) => x === true)) return true;
    const rest = xs.filter((x) => x !== false) as Cond[];
    if (!rest.length) return o.or.length ? false : c;
    return { ...o, or: rest } as Cond;
  }
  if ("not" in o) {
    const x = pruneTri(o.not, gone, table);
    if (x === true) return false;
    if (x === false) return true;
    return { ...o, not: x } as Cond;
  }
  if (typeof o.f === "string" && typeof o.op === "string") return pruneLeaf(o as unknown as Leaf, gone, table);
  return c;
}

export interface CondResult {
  /** the condition as stored now (`ALWAYS` / `NEVER` for the constants it came down to) */
  value: unknown;
  changed: boolean;
  /** it can no longer hold for any row (it held for some before) */
  never: boolean;
}

/** Prune a condition (`table`: the table it is about, for the fields removed from that table). */
export function pruneCond(raw: unknown, gone: Gone, table: string | null = null): CondResult {
  if (raw === null || raw === undefined || typeof raw !== "object") return { value: raw, changed: false, never: false };
  const before = JSON.stringify(raw);
  const t = pruneTri(raw, gone, table);
  const value = t === true ? { ...ALWAYS, and: [] } : t === false ? { ...NEVER, or: [] } : t;
  const changed = JSON.stringify(value) !== before;
  const wasNever = Array.isArray((raw as { or?: unknown[] }).or) && !(raw as { or: unknown[] }).or.length;
  return { value, changed, never: t === false && !wasNever };
}

// ---------------------------------------------------------------------------------------------------------------
// Handlers of JSON columns

export interface HandlerArgs {
  gone: Gone;
  /** the whole row (a condition's table is often another column of it) */
  row: Record<string, unknown>;
  /** the table of the row (its key) */
  table: string;
}

export interface HandlerResult {
  value: unknown;
  changed: boolean;
  /** the definition lost its meaning: deactivated (or, without an «فعال» flag, removed) */
  dead?: boolean;
  /** what was taken out, in Persian, for the purge's report and the definition's audit line */
  note?: string;
}

export type Handler = (value: unknown, a: HandlerArgs) => HandlerResult;

const idsHandler: Handler = (value, a) => pruneIds(value, a.gone);

/** A conditions column about `tableOf(row)`; `deadOnNever`: the row means nothing once it can no longer hold. */
const condHandler =
  (tableOf: (row: Record<string, unknown>, own: string) => string | null, deadOnNever = true, nullOnNever = false): Handler =>
  (value, a) => {
    const r = pruneCond(value, a.gone, tableOf(a.row, a.table));
    if (!r.changed) return { value, changed: false };
    if (r.never && nullOnNever) return { value: null, changed: true, note: "شرطی که به دادهٔ نمایشی اشاره می‌کرد برداشته شد" };
    return { value: r.value, changed: true, dead: deadOnNever && r.never, note: r.never ? "شرط آن فقط دادهٔ نمایشی را می‌گرفت" : "بخش‌هایی از شرط که دادهٔ نمایشی را نام می‌برد برداشته شد" };
  };
const ofTableKey = (row: Record<string, unknown>) => (typeof row.table_key === "string" ? row.table_key : null);
const ofOwn = (_row: Record<string, unknown>, own: string) => own;
const ofNone = () => null;

/** A list of assignee rules (a workflow step's, a fallback, starters): rules naming removed rows go. */
export function pruneRules(raw: unknown, gone: Gone): { rules: unknown[]; changed: boolean } {
  const list = Array.isArray(raw) ? raw : [];
  let changed = false;
  const out: unknown[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") {
      out.push(r);
      continue;
    }
    const x = { ...(r as Record<string, unknown>) };
    let drop = false;
    // «فقط این افراد»: a members filter emptied by the purge would widen the rule to every holder — the rule goes
    if (Array.isArray(x.members) && x.members.length) {
      const kept = x.members.filter((m) => !goneId(gone, m));
      if (kept.length !== x.members.length) {
        changed = true;
        if (!kept.length) drop = true;
        else x.members = kept;
      }
    }
    switch (x.kind) {
      case "position":
        if ((typeof x.position === "string" && gone.position(x.position)) || goneId(gone, x.unit) || (typeof x.unitField === "string" && gone.libraryField(x.unitField))) drop = true;
        break;
      case "group":
        if (goneId(gone, x.group)) drop = true;
        break;
      case "users": {
        const users = (Array.isArray(x.users) ? x.users : []).filter((u) => !goneId(gone, u));
        if (users.length !== (Array.isArray(x.users) ? x.users.length : 0)) {
          changed = true;
          if (!users.length) drop = true;
          else x.users = users;
        }
        break;
      }
      case "field":
        if (typeof x.field === "string" && gone.libraryField(x.field)) drop = true;
        break;
      case "unit_head":
        if (typeof x.unitField === "string" && gone.libraryField(x.unitField)) drop = true;
        break;
      default:
        if (hasGone(gone, x)) drop = true;
    }
    if (drop) {
      changed = true;
      continue;
    }
    out.push(x);
  }
  return { rules: out, changed };
}

/** A workflow's draft: rules, fallbacks, escalations, «اعلان» recipients, forms, fields, starters and managers. */
export const processDraftHandler: Handler = (value, a) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, changed: false };
  const d = structuredClone(value) as Record<string, any>;
  let changed = false;
  const notes = new Set<string>();
  const rules = (raw: unknown, what: string) => {
    const r = pruneRules(raw, a.gone);
    if (r.changed) {
      changed = true;
      notes.add(what);
    }
    return r.rules;
  };
  const nodes: any[] = Array.isArray(d.graph?.nodes) ? d.graph.nodes : [];
  for (const n of nodes) {
    const c = n?.config;
    if (!c || typeof c !== "object") continue;
    if (n.type === "form_step") {
      if (Array.isArray(c.assignees)) c.assignees = rules(c.assignees, "قاعده‌های انجام‌دهندهٔ مرحله‌ها");
      if (Array.isArray(c.fallback)) c.fallback = rules(c.fallback, "جایگزین‌های مرحله‌ها");
      if (Array.isArray(c.escalate))
        for (const e of c.escalate) if (e && Array.isArray(e.rules)) e.rules = rules(e.rules, "ارجاع‌های تشدید");
      if (typeof c.form === "string" && goneId(a.gone, c.form)) {
        c.form = null;
        changed = true;
        notes.add("فرم مرحله");
      }
      const rf = c.rights?.fields;
      if (rf && typeof rf === "object")
        for (const k of Object.keys(rf))
          if (a.gone.libraryField(k)) {
            delete rf[k];
            changed = true;
            notes.add("فیلدهای حذف‌شده از حق‌های مرحله");
          }
    } else if (n.type === "notify" && Array.isArray(c.to)) c.to = rules(c.to, "گیرندگان اعلان");
    else if (n.type === "set_values" && c.values && typeof c.values === "object") {
      for (const k of Object.keys(c.values))
        if (a.gone.libraryField(k)) {
          delete c.values[k];
          changed = true;
          notes.add("مقدارهای «تعیین مقدار»");
        }
    } else if (n.type === "subflow" && goneId(a.gone, c.flow)) {
      c.flow = null;
      changed = true;
      notes.add("جریان خودکار");
    }
    // whatever else of the node names a removed row (a branch's value, a set value)
    const rest = pruneIds(c, a.gone);
    if (rest.changed) {
      n.config = rest.value;
      changed = true;
      notes.add("مقدارهایی که دادهٔ نمایشی را نام می‌برد");
    }
  }
  if (Array.isArray(d.starters) && d.starters.length) {
    d.starters = rules(d.starters, "آغازکنندگان");
    // no starter left would mean «everyone may start»: a rule that names nobody keeps it closed until it is reviewed
    // (the designer asks for at least one person)
    if (!d.starters.length) d.starters = [{ kind: "users", users: [] }];
  }
  for (const k of ["managers", "manager_groups"] as const) {
    if (!Array.isArray(d[k])) continue;
    const kept = d[k].filter((x: unknown) => !goneId(a.gone, x));
    if (kept.length !== d[k].length) {
      d[k] = kept;
      changed = true;
      notes.add("مسئولان");
    }
  }
  if (Array.isArray(d.requester_view)) {
    const kept = d.requester_view.filter((x: unknown) => !(typeof x === "string" && a.gone.libraryField(x)));
    if (kept.length !== d.requester_view.length) {
      d.requester_view = kept;
      changed = true;
      notes.add("آنچه درخواست‌دهنده می‌بیند");
    }
  }
  const rest = pruneIds(d, a.gone);
  if (rest.changed) changed = true;
  return { value: rest.value, changed, note: changed ? `از پیش‌نویس برداشته شد: ${[...notes].join("، ") || "ارجاع به دادهٔ نمایشی"}` : undefined };
};

/** A form's layout: library fields that went leave it; «نمایش وقتی…» conditions on them are pruned by meaning. */
export const formLayoutHandler: Handler = (value, a) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value, changed: false };
  const l = structuredClone(value) as Record<string, any>;
  let changed = false;
  const removed: string[] = [];
  for (const tab of Array.isArray(l.tabs) ? l.tabs : [])
    for (const sec of Array.isArray(tab?.sections) ? tab.sections : []) {
      if (!Array.isArray(sec?.items)) continue;
      const items: unknown[] = [];
      for (const it of sec.items) {
        if (it && typeof it === "object" && typeof it.field === "string" && a.gone.libraryField(it.field)) {
          removed.push(it.field);
          changed = true;
          continue;
        }
        if (it && typeof it === "object" && it.showIf) {
          const r = pruneCond(it.showIf, { ...a.gone, tableField: undefined, libraryField: (n) => a.gone.libraryField(n) }, null);
          if (r.changed) {
            changed = true;
            // «نمایش وقتی» that always holds now is no condition at all; one that never holds keeps the field hidden
            if (r.value && typeof r.value === "object" && Array.isArray((r.value as { and?: unknown[] }).and) && !(r.value as { and: unknown[] }).and.length) delete it.showIf;
            else it.showIf = r.value;
          }
        }
        items.push(it);
      }
      sec.items = items;
    }
  const rest = pruneIds(l, a.gone);
  return { value: rest.value, changed: changed || rest.changed, note: removed.length ? `فیلدهای نمایشی از فرم برداشته شد: ${[...new Set(removed)].join("، ")}` : changed ? "شرط‌های نمایش فرم بازبینی شد" : undefined };
};

/** The library fields a form uses (kept by the form's hook): the removed ones leave the list. */
const nameListHandler: Handler = (value, a) => {
  if (!Array.isArray(value)) return { value, changed: false };
  const kept = value.filter((x) => !(typeof x === "string" && a.gone.libraryField(x)));
  return kept.length === value.length ? { value, changed: false } : { value: kept, changed: true };
};

/** An approval rule's levels: removed people and groups leave the sources; a level left without sources ends the rule. */
export const approvalLevelsHandler: Handler = (value, a) => {
  if (!Array.isArray(value)) return pruneIds(value, a.gone);
  let changed = false;
  let dead = false;
  const levels = value.map((lv) => {
    if (!lv || typeof lv !== "object") return lv;
    const l = { ...(lv as Record<string, any>) };
    const sources: unknown[] = [];
    for (const s of Array.isArray(l.sources) ? l.sources : []) {
      if (s?.kind === "users" || s?.kind === "groups") {
        const k = s.kind === "users" ? "users" : "groups";
        const list = (Array.isArray(s[k]) ? s[k] : []).filter((x: unknown) => !goneId(a.gone, x));
        if (list.length !== (Array.isArray(s[k]) ? s[k].length : 0)) changed = true;
        if (list.length) sources.push({ ...s, [k]: list });
        else changed = true;
        continue;
      }
      const p = pruneIds(s, a.gone);
      if (p.changed) changed = true;
      sources.push(p.value);
    }
    if (Array.isArray(l.sources) && l.sources.length && !sources.length) dead = true;
    l.sources = sources;
    return l;
  });
  return { value: levels, changed, dead, note: dead ? "سطحی از تأییدکنندگان فقط افراد یا گروه‌های نمایشی داشت" : changed ? "تأییدکنندگان نمایشی از سطح‌ها برداشته شدند" : undefined };
};

/** A notification rule's recipients: removed people and groups go; a rule left with nobody ends. */
export const recipientsHandler: Handler = (value, a) => {
  const before = cleanRecipients(value);
  const p = pruneIds(value, a.gone);
  if (!p.changed) return { value, changed: false };
  const after = cleanRecipients(p.value);
  const dead = hasRecipients(before) && !hasRecipients(after);
  return { value: p.value, changed: true, dead, note: dead ? "گیرندگان آن فقط افراد یا گروه‌های نمایشی بودند" : "گیرندگان نمایشی برداشته شدند" };
};

/** Actions that write values (business rules, UI policies, SLA breaches): an action that would write a removed row goes. */
export const actionsHandler: Handler = (value, a) => {
  if (!Array.isArray(value)) return pruneIds(value, a.gone);
  let changed = false;
  const out: unknown[] = [];
  for (const x of value) {
    if (!x || typeof x !== "object") {
      out.push(x);
      continue;
    }
    const act = x as Record<string, unknown>;
    // a «set» / «reassign» of a removed row, or an action whose only target was one, goes whole
    if (hasGone(a.gone, act.value) || hasGone(a.gone, act.group_id) || hasGone(a.gone, act.user_id) || hasGone(a.gone, act.to) || hasGone(a.gone, act.group) || hasGone(a.gone, act.user)) {
      changed = true;
      continue;
    }
    const p = pruneIds(act, a.gone);
    if (p.changed) {
      changed = true;
      const v = p.value as Record<string, unknown>;
      // a watcher action left with nobody and no field does nothing
      if (v.type === "watcher" && !(Array.isArray(v.users) && v.users.length) && !v.field) continue;
      out.push(v);
    } else out.push(act);
  }
  const dead = changed && value.length > 0 && !out.length;
  return { value: out, changed, dead, note: dead ? "همهٔ اقدام‌های آن دادهٔ نمایشی را می‌نوشت" : changed ? "اقدام‌هایی که دادهٔ نمایشی را می‌نوشت برداشته شد" : undefined };
};

/** A flow's trigger condition (about its trigger table): one that can no longer hold stops the flow (it never runs always). */
const flowTriggerHandler: Handler = (value, a) =>
  condHandler((row) => (typeof row.trigger_table === "string" ? row.trigger_table : null))(value, a);

/** A flow's draft graph: values naming removed rows go; a flow that ran them is deactivated (it no longer does what it did). */
export const flowGraphHandler: Handler = (value, a) => {
  const p = pruneIds(value, a.gone);
  return p.changed ? { value: p.value, changed: true, dead: true, note: "گام‌هایی از جریان دادهٔ نمایشی را می‌نوشت یا نام می‌برد" } : { value, changed: false };
};

/** A field's validation: a «فیلتر رکورد» naming removed rows is cleared (the task's rule: defaults and refFilters clear). */
export const fieldValidationHandler: Handler = (value, a) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return pruneIds(value, a.gone);
  const v = { ...(value as Record<string, unknown>) };
  let changed = false;
  if (v.refFilter !== undefined && hasGone(a.gone, v.refFilter)) {
    delete v.refFilter;
    changed = true;
  }
  const p = pruneIds(v, a.gone);
  return { value: p.value, changed: changed || p.changed, note: changed || p.changed ? "فیلتر رکوردی که به دادهٔ نمایشی اشاره می‌کرد پاک شد" : undefined };
};

/** A field's default value (text): a removed row is no default. */
export const textIdHandler: Handler = (value, a) => (typeof value === "string" && hasGone(a.gone, value) ? { value: null, changed: true, note: "مقدار پیش‌فرضی که دادهٔ نمایشی بود پاک شد" } : { value, changed: false });

/** A table field's row options (`custom_field.options`: the library field's snapshot, the form arrangement, the lifecycle). */
export const customFieldOptionsHandler: Handler = (value, a) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return pruneIds(value, a.gone);
  const o = structuredClone(value) as Record<string, any>;
  let changed = false;
  if (o.field && typeof o.field === "object") {
    if (o.field.default !== undefined && hasGone(a.gone, o.field.default)) {
      delete o.field.default;
      changed = true;
    }
    if (o.field.refFilter !== undefined && hasGone(a.gone, o.field.refFilter)) {
      delete o.field.refFilter;
      changed = true;
    }
  }
  // the form arrangement (`_form`): fields that left the table leave its sections
  for (const tab of Array.isArray(o.tabs) ? o.tabs : [])
    for (const sec of Array.isArray(tab?.sections) ? tab.sections : [])
      if (Array.isArray(sec?.fields)) {
        const kept = sec.fields.filter((f: unknown) => !(typeof f === "string" && (a.gone.libraryField(f) || a.gone.tableField?.(String(a.row.table_key ?? ""), f))));
        if (kept.length !== sec.fields.length) {
          sec.fields = kept;
          changed = true;
        }
      }
  const p = pruneIds(o, a.gone);
  return { value: p.value, changed: changed || p.changed };
};

/** A directory's group mapping: a mapping into a removed group, unit, workspace or position goes (it would grant it). */
export const groupMapHandler: Handler = (value, a) => {
  if (!Array.isArray(value)) return pruneIds(value, a.gone);
  const kept = value.filter((m) => !hasGone(a.gone, m));
  return kept.length === value.length ? { value, changed: false } : { value: kept, changed: true, note: "نگاشت گروه‌های فهرست راهنما به دادهٔ نمایشی برداشته شد" };
};

// ---------------------------------------------------------------------------------------------------------------
// The decision of every json and conditions field

/**
 * What the purge does with a json / conditions field:
 *   "ids"      removed ids leave it (`pruneIds`)
 *   "cond"     a condition about the row's own table (dead when it can no longer hold)
 *   "cond:tk"  a condition about the table the row's `table_key` names
 *   "cond:opt" an optional condition whose absence means «never» (one that can no longer hold is dropped: auto-approval,
 *              pause, stop, cancel)
 *   "cond:narrow" a condition whose absence would mean «always» (a record filter, when a question or an activity
 *              applies, when a guide adds an item): one that can no longer hold is kept as «never», never dropped
 *   "none"     holds no ids (counts, labels, settings of the table itself)
 *   "keep"     a snapshot or trail: never rewritten (allowed to name removed rows: `verify.ts`)
 *   Handler    the field's own handler
 */
export type JsonDecision = "ids" | "cond" | "cond:tk" | "cond:opt" | "cond:tk-opt" | "cond:narrow" | "cond:tk-narrow" | "none" | "keep" | Handler;

export const JSON_FIELDS: Record<string, Record<string, JsonDecision>> = {
  account_health: { factors: "none" },
  account_review: { pack: "ids" },
  admin_config: { onboarding: "ids", flags: "none" },
  ai_agent: { condition: "cond:tk", schedule_filter: "cond:tk" },
  ai_agent_run: { proposals: "ids", steps: "ids", state: "ids" },
  ai_skill: { condition: "cond:tk", schedule_filter: "cond:tk" },
  ai_skill_eval: { cases: "ids", last_results: "ids" },
  ai_skill_run: { params: "ids", output_json: "ids", citations: "ids", clearance: "ids" },
  ai_skill_version: { output_schema: "none" },
  alert: { severity_history: "none", flips: "none" },
  alert_group: { probable_causes: "ids" },
  alert_incident_rule: { condition: "cond:tk" },
  alert_route: { condition: "cond:tk" },
  analytics_dashboard: { layout: "ids", filters: "ids", shares: "ids" },
  analytics_indicator: { parts: "ids", score_shares: "ids" },
  analytics_report: { spec: "ids", shares: "ids" },
  analytics_schedule: { schedule: "ids" },
  analytics_score: { parts: "ids", ids: "ids" },
  approval_rule: { condition: "cond:tk", levels: approvalLevelsHandler, auto_approve: "cond:tk-opt" },
  artifact: { sbom: "none" },
  asset: { attributes: "ids", reminded: "none" },
  assignment_rule: { condition: "cond:tk" },
  bia: { impacts: "ids" },
  branch_attestation: { exceptions: "ids" },
  business_rule: { condition: "cond:tk", actions: actionsHandler },
  cab: { agenda_condition: "cond:tk" },
  cab_agenda_item: { votes: "ids" },
  calendar: { hours: "none" },
  capacity_record: { samples: "none" },
  catalog_audience: { condition: "cond:tk" },
  catalog_item: { field_map: "ids" },
  catalog_item_version: { schema: "ids" },
  catalog_task_template: { condition: "cond:tk" },
  catalog_ui_policy: { condition: "cond:tk", actions: actionsHandler },
  catalog_variable: { choices: "ids", ref_filter: "cond:narrow" },
  change_gate: { evidence: "ids" },
  change_lockdown: { scope_condition: "cond:tk" },
  change_model: { requirements: "ids", locks: "ids" },
  change_request: { risk_answers: "ids", risk_factors: "none" },
  change_risk_question: { options: "none", condition: "cond:tk-narrow" },
  change_template: { tasks: "ids" },
  change_window: { scope_condition: "cond:tk" },
  ci: { attrs: "ids", health: "none", attr_meta: "ids" },
  ci_baseline: { items: "ids" },
  ci_cert_campaign: { condition: "cond:tk" },
  ci_class: { attrs: "none", rel_rules: "none" },
  ci_group: { condition: "cond:tk" },
  ci_identification_rule: { entries: "none" },
  ci_impact_sim: { result: "ids" },
  ci_rel_suggestion: { evidence: "ids" },
  cmdb_config: { cert_warn_days: "none" },
  cmdb_data_source: { mapping: "ids" },
  cmdb_dedup_task: { merge_journal: "ids" },
  cmdb_import_run: { results: "ids" },
  cmdb_map: { positions: "ids" },
  cmdb_policy: { condition: "cond:tk" },
  cmdb_query: { condition: "cond:tk", steps: "ids" },
  cmdb_rule: { scope_condition: "cond:tk", check_condition: "cond:tk", required_rel: "ids" },
  contract: { reminder_days: "none", reminded: "none" },
  contract_guarantee: { reminded: "none" },
  contract_obligation: { reminded: "none" },
  correlation_rule: { condition: "cond:tk" },
  custom_field: { options: customFieldOptionsHandler },
  customer_account: { health_factors: "none" },
  customer_case: { entitlement_snapshot: "ids" },
  customer_notice: { evidence: "ids" },
  data_export: { stats: "none" },
  dev_event: { result: "ids", payload: "ids" },
  devops_connection: { env_map: "ids" },
  directory_source: { attr_map: "none", group_map: groupMapHandler },
  discovery_batch: { result: "ids" },
  discovery_connector: { options: "ids", mapping: "ids", device_status_map: "none" },
  discovery_item: { data: "ids", mismatch: "ids" },
  discovery_run: { cursor: "ids", warnings: "ids" },
  discovery_state: { signals: "ids" },
  esm_service: { audience: "cond" },
  event: { decision: "ids", payload: "ids" },
  event_rule: { condition: "cond:tk" },
  event_source: { mapping: "ids", severity_map: "none" },
  exercise: { step_log: "ids" },
  field_def: { options: "ids", validation: fieldValidationHandler },
  field_type: { validation: fieldValidationHandler, display: "none", options: "ids" },
  flow: { trigger_condition: flowTriggerHandler, schedule: "ids", graph: flowGraphHandler },
  flow_connection: { headers: "none" },
  flow_version: { trigger: "keep", graph: "keep" },
  form: { layout: formLayoutHandler, fields: nameListHandler },
  grc_csf_profile: { items: "ids" },
  grc_risk_matrix: { likelihood_labels: "none", impact_labels: "none", cells: "none" },
  import_set: { headers: "none", sample: "ids", stats: "none" },
  inbound_endpoint: { mapping: "ids", defaults: actionsLikeDefaults() },
  incident: { timeline: "ids" },
  incident_period_review: { stats: "ids" },
  incident_template: { tasks: "ids" },
  itam_config: { warranty_reminders: "none" },
  journey_activity: { condition: "cond:tk-narrow", order_answers: "ids" },
  journey_template_activity: { condition: "cond:tk-narrow", order_answers: "ids" },
  kb_article: { ai_provenance: "ids" },
  kb_config: { aqi_items: "none" },
  kb_decision_tree: { nodes: "ids" },
  kb_gap: { samples: "ids" },
  kb_quality_review: { results: "ids" },
  kb_template: { sections: "none" },
  kb_version: { ai_provenance: "ids", checks: "ids" },
  license_entitlement: { reminded: "none" },
  license_position: { detail: "ids" },
  notification_channel: { sms_headers: "none" },
  notification_pref: { optouts: "ids" },
  notification_rule: { condition: "cond:tk", recipients: recipientsHandler },
  order_guide_rule: { condition: "cond:narrow" },
  portal: { layout: "ids", published_layout: "ids" },
  portal_channel_identity: { options: "ids" },
  priority_matrix: { cells: "none" },
  problem: { rca: "ids", shared: "ids" },
  problem_template: { tasks: "ids" },
  process: { draft: processDraftHandler },
  process_case: { current_steps: "ids", open_rounds: "none", progress: "ids", data: "ids" },
  process_draft: { values: "ids" },
  process_submission: { values: "ids" },
  process_version: { graph: "keep", steps: "keep", forms: "keep", starters: "keep", diff: "keep" },
  project: { health_reasons: "ids" },
  release: { risk_factors: "none" },
  release_check: { condition: "cond:tk" },
  release_config: { dora_definitions: "ids" },
  release_decision: { snapshot: "keep" },
  release_note: { sources: "ids" },
  release_template: { tasks: "ids" },
  request_cart_line: { answers: "ids" },
  request_item: { answers: "ids", private_answers: "ids", entitlement: "ids" },
  request_task: { checklist: "ids" },
  role: { grants: "ids" },
  saas_subscription: { reminded: "none" },
  schedule: { spec: "ids", template: "ids" },
  sec_config: { sir_weights: "none" },
  sec_evidence: { custody_log: "keep" },
  sec_observable: { enrichment: "ids" },
  sec_playbook: { steps: "ids" },
  sec_reg_clock: { deadlines: "none" },
  sec_reg_regime: { stages: "none" },
  sec_scan_import: { errors: "none" },
  sec_vuln_item: { risk_factors: "none" },
  service_design_package: { readiness: "ids" },
  service_score_fact: { components: "ids" },
  sla_definition: {
    durations: "none", start_condition: "cond:tk", pause_condition: "cond:tk-opt", stop_condition: "cond:tk-opt", reset_condition: "cond:tk-opt", cancel_condition: "cond:tk-opt",
    warn_percents: "none", breach_actions: actionsHandler,
  },
  slm_review: { pack: "ids" },
  slm_target: { credit_tiers: "none" },
  slm_template_target: { credit_tiers: "none" },
  slm_xla_policy: { condition: "cond:tk" },
  slm_xla_score: { drivers: "ids" },
  status_report: { metrics: "ids" },
  studio_version: { snapshot: "keep" },
  supplier_config: { default_reminders: "none" },
  supplier_scorecard: { metrics: "ids" },
  survey_response: { answers: "ids" },
  survey_trigger: { condition: "cond:tk" },
  technician: { skills: "none", certifications: "none" },
  transform_map: { rules: "ids" },
  ui_policy: { condition: "cond:tk", actions: actionsHandler },
  va_conversation: { slots: "ids" },
  va_message: { cards: "ids" },
  view: { filter: "cond:tk", columns: "none" },
  webhook_subscription: { condition: "cond:tk" },
  wo_task: { checklist: "none", checklist_answers: "ids" },
  wo_task_template: { checklist: "none", parts: "ids" },
};

/** Defaults an endpoint writes into every record it makes (`{ field: value }`): a removed row is no default. */
function actionsLikeDefaults(): Handler {
  return (value, a) => {
    const p = pruneIds(value, a.gone);
    return p.changed ? { value: p.value, changed: true, note: "مقدارهای پیش‌فرضی که دادهٔ نمایشی بود برداشته شد" } : { value, changed: false };
  };
}

/** The handler of a json / conditions field (null: holds no ids, or never rewritten). */
export function jsonHandler(table: string, field: FieldDef): Handler | null {
  const d = JSON_FIELDS[table]?.[field.name];
  const decision: JsonDecision | undefined = d ?? (field.type === "conditions" ? "cond" : undefined);
  if (!decision || decision === "none" || decision === "keep") return null;
  if (typeof decision === "function") return decision;
  if (decision === "ids") return idsHandler;
  if (decision === "cond") return condHandler(ofOwn);
  if (decision === "cond:tk") return condHandler((row, own) => ofTableKey(row) ?? own);
  if (decision === "cond:opt") return condHandler(ofOwn, false, true);
  if (decision === "cond:tk-opt") return condHandler((row, own) => ofTableKey(row) ?? own, false, true);
  if (decision === "cond:narrow") return condHandler(ofNone, false, false);
  if (decision === "cond:tk-narrow") return condHandler((row, own) => ofTableKey(row) ?? own, false, false);
  return null;
}

/** Is the field kept as it is (a snapshot or trail)? */
export const jsonKept = (table: string, field: string): boolean => JSON_FIELDS[table]?.[field] === "keep";

// ---------------------------------------------------------------------------------------------------------------
// Reference columns of engine tables

/** Optional references that are the row's parent: the row goes with the named row (class B). */
export const PARENTS: Record<string, readonly string[]> = {
  // a case of a demo process or version, its tasks, submissions and drafts (whoever wrote them: the organisation's
  // timer, a real manager's «ارجاع», a real person's submission)
  process_case: ["process_id", "version_id"],
  process_task: ["case_id", "process_id", "version_id"],
  process_submission: ["task_id", "process_id", "version_id"],
  process_draft: ["task_id", "process_id"],
  // a holder whose unit is a pack unit holds a role in the pack's organisation chart
  position_holder: ["org_unit_id"],
  // a pack library field attached to a real table: the attachment goes, and the values stored under its name with it
  custom_field: ["library_id"],
  // a requested item of a demo request, a task of a demo request
  request_item: ["request_id"],
  request_task: ["request_id"],
  // an approval round a demo rule planned
  approval: ["rule_id"],
};

/** Text columns that hold ids (`string` fields), with their role. */
export const ID_TEXT: Record<string, Record<string, RefRole>> = {
  process_submission: { case_id: "parent" },
  field_def: { default_value: "producer" },
  // the state of a removed CI or asset, a subscription to a removed article, a cost line of a removed record, a
  // knowledge task about a removed record: they exist for it
  discovery_state: { target_id: "parent" },
  kb_subscription: { target_id: "parent" },
  cost_entry: { source_id: "parent" },
  kb_task: { source_id: "parent" },
  // where a kept record came from, what it made or shows: the link is cleared
  change_request: { origin_id: "pointer" },
  ci_impact_sim: { linked_id: "pointer" },
  kb_article: { source_id: "pointer" },
  request_item: { produced_id: "pointer" },
  va_conversation: { handoff_id: "pointer" },
  ai_skill_run: { proposal_id: "pointer" },
  process_case: { run_ref: "pointer" },
  portal: { logo_id: "pointer" },
  wo_task: { signature_id: "pointer" },
  work_order: { asset_ref: "pointer" },
  install_base_item: { asset_ref: "pointer" },
};

/**
 * Text fields whose name looks like an id but that hold no row of the organisation: keys, ids in other systems (a
 * monitoring tool, a pipeline, a messenger, a bank's terminals), files and the platform's own announcements. The
 * registry test asks every `…_id` / `…_ref` text field to be here or in `ID_TEXT` (or a column the purge reads by name).
 */
export const FOREIGN_TEXT = new Set([
  "asset.terminal_id", "asset.merchant_id", "change_gate.run_ref", "change_request.external_ref", "ci.bios_uuid", "ci.cloud_resource_id",
  "contract.vendor_ref", "custom_field.ref", "deployment.external_id", "dev_build.external_id", "dev_event.delivery_id", "dev_pipeline.external_id",
  "dev_repository.external_id", "discovery_batch.batch_id", "discovery_batch.key_id", "discovery_batch.snapshot_id", "discovery_collector.machine_id",
  "discovery_item.external_id", "doc_document.file_id", "external_ref.remote_id", "finance_case.payment_ref", "hr_profile.national_id", "incident.external_ref",
  "notification_channel.chat_id", "portal_channel_identity.external_id", "portal_channel_identity.conversation_id", "position_holder.source_ref",
  "reservation.series_id", "saas_account.external_id", "sec_vuln_item.scanner_ref", "sec_vulnerability.cve_id", "service_agreement.contract_ref",
  "slm_review.event_ref", "supplier.national_id", "system_notice.announcement_id",
]);

/** Text columns the purge reads by name on every table (`purge.ts` `derivedConds`): what the row is about. */
export const ABOUT_COLUMNS = ["record_id", "ref_id", "entity_id", "doc_id", "from_id", "to_id"] as const;

/**
 * Requester and beneficiary fields: a real row whose person is a pack person is the pack's (class B) — a real incident
 * the owner filed for a pack caller, a case requested for a pack person, a delegation to one.
 */
export const BENEFICIARY = new Set(["caller_id", "requested_for", "requested_by", "submitted_by", "user_id", "from_user", "to_user", "respondent_id", "requester_id", "on_behalf_of"]);

/** Allow-lists where nobody named means everyone (one audience per entry: its lists together). */
export const RESTRICTION_SETS: Record<string, readonly (readonly string[])[]> = {
  portal_link: [["aud_units", "aud_groups", "aud_locations", "aud_users"]],
  portal_topic: [["aud_units", "aud_groups", "aud_locations", "aud_users"]],
  survey: [["aud_units", "aud_groups", "aud_locations", "aud_users"]],
  catalog: [["available_for"]],
  catalog_item: [["available_for"]],
};

/** Scopes where an empty value means every record: a definition scoped to a removed row ends (never applies org-wide). */
export const RESTRICTION_SCALARS: Record<string, readonly string[]> = {
  sla_definition: ["service_id", "customer_unit_id"],
};

/** Snapshot tables: never rewritten (a published workflow version, a flow version). */
export const SNAPSHOT_TABLES = new Set(["process_version", "flow_version"]);

/** Assignment-rule targets: a rule that routed to a removed group or person ends (it would route to nobody). */
export const PRODUCER_REFS: Record<string, readonly string[]> = {
  assignment_rule: ["group_id", "user_id"],
  // a flow that ran as a removed person would run as whoever triggers it: it is stopped instead
  flow: ["run_as_user"],
};

export interface FieldRef {
  name: string;
  /** stored in the row's `custom` jsonb */
  custom: boolean;
  /** a jsonb list of ids */
  array: boolean;
  target: string | null;
  role: RefRole;
  type: FieldDef["type"];
}

const isRefField = (f: FieldDef) => FIELD_TYPES[f.type]?.family === "ref";

/** The reference fields of an (effective) table definition with their roles. */
export function fieldRefs(def: TableDef): FieldRef[] {
  const out: FieldRef[] = [];
  const restricted = new Set((RESTRICTION_SETS[def.key] ?? []).flat());
  const scalars = new Set(RESTRICTION_SCALARS[def.key] ?? []);
  const producers = new Set(PRODUCER_REFS[def.key] ?? []);
  const parents = new Set(PARENTS[def.key] ?? []);
  for (const f of def.fields) {
    if (f.base || !isRefField(f)) continue;
    const array = !!FIELD_TYPES[f.type].array;
    const person = f.type === "user" || f.type === "users";
    let role: RefRole = "pointer";
    if (SNAPSHOT_TABLES.has(def.key)) role = "snapshot";
    else if (f.required || def.scope?.parent === f.name || parents.has(f.name) || (person && !array && BENEFICIARY.has(f.name))) role = "parent";
    else if (restricted.has(f.name) || scalars.has(f.name)) role = "restriction";
    else if (producers.has(f.name)) role = "producer";
    else if (def.key === "approval" && (f.name === "approver_id" || f.name === "group_id" || f.name === "delegated_from")) role = "approval";
    out.push({ name: f.name, custom: !!f.custom, array, target: refTarget(f, def.key), role, type: f.type });
  }
  return out;
}

/** Fields whose clearing routes the record again (its assignee, its group, its owners): counted as «re-routed». */
export function routingFields(def: TableDef): Set<string> {
  const out = new Set<string>();
  if (def.scope?.group) out.add(def.scope.group);
  for (const n of def.scope?.own ?? []) if (!BENEFICIARY.has(n)) out.add(n);
  for (const f of def.fields) if (/^(assigned_to|assignment_group_id|owner_id|owner_group_id|support_group_id|manager_id|delegate_id|fulfilment_group_id|managed_by|owned_by)$/.test(f.name)) out.add(f.name);
  return out;
}

/** Base columns and what they are: the access anchors are recomputed, a workspace that went takes its records along. */
export const BASE_REFS: Record<string, RefRole> = {
  unit_id: "anchor",
  domain_id: "anchor",
  workspace_id: "parent",
  created_by: "trail",
  updated_by: "trail",
};

// ---------------------------------------------------------------------------------------------------------------
// Platform tables (no engine definition) and the verifier's allowances

/**
 * Platform tables whose json names what the row is about: a row naming a removed row in it is derived from demo data
 * (deleted with it), like a row whose uuid columns name one. Runs, logs and proposals of the platform.
 */
export const PLATFORM_JSON_DERIVES: Record<string, readonly string[]> = {
  sm_ai_actions: ["payload", "preview", "result", "outcome"],
  sm_ai_data_refs: ["rows", "meta"],
  sm_ai_messages: ["parts", "native"],
  sm_ai_tool_calls: ["input"],
  sm_ai_threads: ["context"],
  sm_ai_predictions: ["why", "alternatives"],
  // insights and trained models that name demo rows (a contributing record, a predicted group) were made from demo
  // data: they go and are computed again from what is left
  sm_ai_insights: ["refs", "scope", "drivers"],
  sm_ai_models: ["params", "metrics", "baseline", "history", "inputs"],
  // a finished run is a log; a run still going is kept (`PLATFORM_JSON_DERIVE_WHEN`) and loses the ids instead
  sm_flow_runs: ["context", "graph", "runtime"],
  sm_flow_run_steps: ["input", "output"],
  sm_notification_log: ["payload"],
  sm_email_messages: ["data", "refs"],
  sm_integration_events: ["payload", "result"],
  sm_kb_events: ["data"],
  sm_portal_events: ["data"],
  sm_survey_held: ["payload"],
  sm_directory_runs: ["plan", "stats"],
};

/** Rows of a `PLATFORM_JSON_DERIVES` table that only derive under a condition (SQL on the row aliased `x`). */
export const PLATFORM_JSON_DERIVE_WHEN: Record<string, string> = {
  sm_flow_runs: "x.ended_at is not null",
};

/** Platform json the verifier allows to name removed rows: the graph a run still going runs (its version's snapshot). */
export const PLATFORM_KEPT: Record<string, readonly string[]> = {
  sm_flow_runs: ["graph"],
};

/**
 * Platform json that holds no row of the organisation (or whose row goes with an id column the purge reads): the
 * registry test asks every jsonb column of a platform table to be here, derived, pruned or a trail.
 */
export const PLATFORM_JSON_NONE: Record<string, readonly string[]> = {
  sm_ai_clusters: ["sims"],
  sm_ai_connections: ["available_models", "embed", "last_error", "models"],
  sm_ai_insights: ["numbers"],
  sm_ai_messages: ["usage"],
  sm_ai_rag_runs: ["stats"],
  sm_demo_packs: ["counters", "counts", "options", "progress", "report"],
  sm_demo_saved: ["data"],
  sm_demo_touched: ["after", "before"],
  // a job about demo data is removed by its payload (`purge.ts` `derivedConds`), never pruned
  sm_jobs: ["payload"],
  sm_orgs: ["modules"],
};

/** Platform settings whose json may name a removed row: the ids leave it (the row stays). */
export const PLATFORM_JSON_PRUNES: Record<string, readonly string[]> = {
  // a run still going and its waits (their run is removed with demo data otherwise: `run_id`)
  sm_flow_runs: ["context", "runtime"],
  sm_flow_waits: ["data", "result"],
  sm_orgs: ["settings"],
  sm_ai_settings: ["settings"],
  sm_org_admin: ["limits"],
  sm_notify_state: ["data"],
  sm_integrations: ["config"],
  sm_api_keys: ["scopes", "table_scopes"],
  sm_org_members: ["overrides"],
  sm_directory_links: ["granted"],
};

/** Tables whose rows are the trail (history, journal, audit, sign-ins): kept as facts, even naming removed rows. */
export const TRAIL_TABLE_NAMES = new Set(["sm_history", "sm_journal", "sm_audit", "sm_security_events"]);

/**
 * Columns the verifier allows to name removed rows: authorship stamps (who wrote a real row is a fact) and the json
 * kept as published or as a trail (`"keep"` above). Physical table name → columns.
 */
export function keptColumns(defs: Iterable<TableDef>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const d of defs) {
    const cols = new Set(["created_by", "updated_by"]);
    for (const [name, dec] of Object.entries(JSON_FIELDS[d.key] ?? {})) if (dec === "keep") cols.add(name);
    if (SNAPSHOT_TABLES.has(d.key)) for (const f of d.fields) cols.add(f.name);
    out.set(d.table, cols);
  }
  return out;
}
