// What a publish changes (design F §3.5 «Publish», §8.4 «انتشار»/«نسخه‌ها», package F4c): a short Persian summary of the
// new version against the current one — steps added and removed, each step's people (1.1.5: what changed in them —
// «انجام‌دهندگان «مرحلهٔ فرم»، کجا: واحد درخواست‌دهنده ← همه‌جا», the position, the group, the people chosen, the
// exclusions, «اگر کسی پیدا نشد»), form, rights («حقوق فیلد "مبلغ" در "تأیید رئیس شعبه" تغییر کرد»), quorum and
// times, the path, the forms' layouts and shared lists, the starters, the title and what the requester sees — and,
// apart, the access settings: «مسئولان: + علی احمدی»، «گروه‌های مسئول: − …»، «محرمانه: روشن». The publisher reads it
// before re-authenticating; the version keeps it (`diff`), and «نسخه‌ها» shows it.
import type { Right } from "@shared/forms/layout";
import { layoutHash, type FormsSnapshot } from "@shared/forms/snapshot";
import { faDigits } from "@shared/format";
import { formStepOf, processNodeLabel, type FormStep, type ProcessGraph, type ProcessNode } from "@shared/process/graph";
import { ASSIGNEE_KIND_LABELS, IF_NOBODY_LABELS, POSITION_WHERE_LABELS, ifNobodyOf, type AssigneeRule } from "@shared/process/assignees";
import { UNIT_KINDS } from "@shared/tables/access";

/** The parts of a version (or of a draft about to become one) the summary compares. */
export interface VersionLike {
  name: string;
  graph: ProcessGraph;
  forms: FormsSnapshot | null;
  starters: AssigneeRule[];
  title_template: string | null;
  requester_view: string[];
  managers: string[];
  manager_groups: string[];
  confidential: boolean;
}

export interface PublishDiff {
  /** the process's first version */
  first: boolean;
  /** what changed in the process itself */
  changes: string[];
  /** what changed in who reads and manages its cases */
  access: string[];
}

export interface DiffNames {
  user(id: string): string;
  group(id: string): string;
  /** a position's name by its key (or id); its key when unknown */
  position?(key: string): string;
  /** a unit's name by its id */
  unit?(id: string): string;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const RIGHT_ORDER: Right[] = ["hidden", "read", "edit", "required"];

function fieldLabel(name: string, ...snaps: (FormsSnapshot | null)[]): string {
  for (const s of snaps) if (s?.fields[name]?.label) return s.fields[name].label;
  return name;
}

function people(before: readonly string[], after: readonly string[], name: (id: string) => string, title: string): string[] {
  const was = new Set(before);
  const now = new Set(after);
  const added = after.filter((x) => !was.has(x)).map(name);
  const removed = before.filter((x) => !now.has(x)).map(name);
  const out: string[] = [];
  if (added.length) out.push(`${title}: + ${added.join("، ")}`);
  if (removed.length) out.push(`${title}: − ${removed.join("، ")}`);
  return out;
}

const kindText = (k: unknown) => UNIT_KINDS.find((o) => o.value === k)?.label ?? String(k ?? "");

/** Where a position rule takes its holders from, in words («نزدیک‌ترین واحد بالادست درخواست‌دهنده (شعبه)»). */
function whereText(r: Extract<AssigneeRule, { kind: "position" }>, names: DiffNames): string {
  const base = POSITION_WHERE_LABELS[r.where] ?? String(r.where);
  if (r.where === "unit" && r.unit) return `${base} «${names.unit?.(r.unit) ?? "—"}»`;
  if (r.where === "unit_field" && r.unitField) return `${base} (${r.unitField})`;
  if (r.where === "requester_unit_up" && r.unitKind) return `${base} (${kindText(r.unitKind)})`;
  return base;
}

/** A rule in a few words («نقش سازمانی «رئیس شعبه»»، «گروه «امور مالی»»…). */
function ruleText(r: AssigneeRule, names: DiffNames): string {
  const kind = ASSIGNEE_KIND_LABELS[r.kind] ?? r.kind;
  switch (r.kind) {
    case "position":
      return `${kind} «${names.position?.(r.position) ?? r.position}»`;
    case "group":
      return `${kind} «${names.group(r.group)}»${r.leadsOnly ? " (فقط سرپرستان)" : ""}`;
    case "role":
      return `${kind} «${r.role}»`;
    case "users":
      return `${kind} (${r.users.map(names.user).join("، ")})`;
    case "manager":
      return `${kind} ${r.of === "previous_actor" ? "انجام‌دهندهٔ قبلی" : "درخواست‌دهنده"}${r.depth && r.depth > 1 ? ` (${faDigits(r.depth)} سطح)` : ""}`;
    case "field":
      return `${kind} «${r.field}»`;
    default:
      return kind;
  }
}

/** «همهٔ دارندگان» / «فقط ۲ نفر» and who joined or left a members filter. */
function membersChange(was: string[] | undefined, now: string[] | undefined, names: DiffNames): string | null {
  const a = was ?? [];
  const b = now ?? [];
  if (same([...a].sort(), [...b].sort())) return null;
  if (!a.length) return `افراد: همهٔ دارندگان ← فقط ${b.map(names.user).join("، ")}`;
  if (!b.length) return `افراد: فقط ${a.map(names.user).join("، ")} ← همهٔ دارندگان`;
  const added = b.filter((x) => !a.includes(x)).map(names.user);
  const removed = a.filter((x) => !b.includes(x)).map(names.user);
  return `افراد: ${[added.length ? `+ ${added.join("، ")}` : "", removed.length ? `− ${removed.join("، ")}` : ""].filter(Boolean).join(" ")}`;
}

/** What changed in one rule kept at the same place (null: nothing). */
function ruleChange(a: AssigneeRule, b: AssigneeRule, names: DiffNames): string[] {
  if (same(a, b)) return [];
  if (a.kind !== b.kind) return [`${ruleText(a, names)} ← ${ruleText(b, names)}`];
  const out: string[] = [];
  switch (b.kind) {
    case "position": {
      const p = a as Extract<AssigneeRule, { kind: "position" }>;
      if (p.position !== b.position) out.push(`نقش سازمانی: «${names.position?.(p.position) ?? p.position}» ← «${names.position?.(b.position) ?? b.position}»`);
      if (whereText(p, names) !== whereText(b, names)) out.push(`کجا: ${whereText(p, names)} ← ${whereText(b, names)}`);
      const m = membersChange(p.members, b.members, names);
      if (m) out.push(m);
      break;
    }
    case "group": {
      const g = a as Extract<AssigneeRule, { kind: "group" }>;
      if (g.group !== b.group) out.push(`گروه: «${names.group(g.group)}» ← «${names.group(b.group)}»`);
      if (!!g.leadsOnly !== !!b.leadsOnly) out.push(b.leadsOnly ? "فقط سرپرستان گروه" : "همهٔ اعضای گروه");
      const m = membersChange(g.members, b.members, names);
      if (m) out.push(m);
      break;
    }
    case "role": {
      const r = a as Extract<AssigneeRule, { kind: "role" }>;
      if (r.role !== b.role) out.push(`نقش دسترسی: «${r.role}» ← «${b.role}»`);
      const m = membersChange(r.members, b.members, names);
      if (m) out.push(m);
      break;
    }
    case "users": {
      const u = a as Extract<AssigneeRule, { kind: "users" }>;
      const added = b.users.filter((x) => !u.users.includes(x)).map(names.user);
      const removed = u.users.filter((x) => !b.users.includes(x)).map(names.user);
      out.push(`افراد مشخص: ${[added.length ? `+ ${added.join("، ")}` : "", removed.length ? `− ${removed.join("، ")}` : ""].filter(Boolean).join(" ")}`);
      break;
    }
    default:
      out.push(`${ruleText(a, names)} ← ${ruleText(b, names)}`);
  }
  return out.length ? out : [`${ruleText(a, names)} تغییر کرد`];
}

const EXCLUDE_WORDS = (x: string, labelOf: (id: string) => string) =>
  x === "requester" ? "درخواست‌دهنده" : x === "earlier_actors" ? "انجام‌دهندگان مرحله‌های پیشین" : x.startsWith("step:") ? `انجام‌دهندگان «${labelOf(x.slice(5))}»` : x;

/** What changed in a step's people, line by line («انجام‌دهندگان «…»، کجا: …»). */
function peopleChanges(was: FormStep, now: FormStep, label: string, names: DiffNames, labelOf: (id: string) => string): string[] {
  const out: string[] = [];
  const say = (what: string) => out.push(`انجام‌دهندگان «${label}»، ${what}`);
  const list = (fallback: boolean) => (fallback ? "قاعدهٔ جایگزین" : "قاعده");
  for (const [fallback, a, b] of [[false, was.assignees, now.assignees], [true, was.fallback ?? [], now.fallback ?? []]] as const) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const r1 = a[i];
      const r2 = b[i];
      const where = fallback ? "قاعدهٔ جایگزین: " : "";
      if (!r1 && r2) say(`${list(fallback)} تازه: ${ruleText(r2, names)}`);
      else if (r1 && !r2) say(`${list(fallback)} «${ruleText(r1, names)}» برداشته شد`);
      else if (r1 && r2) for (const c of ruleChange(r1, r2, names)) say(`${where}${c}`);
    }
  }
  const ex = (s: FormStep) => [...(s.exclude ?? (s.action === "approve" ? ["requester"] : []))].map((x) => EXCLUDE_WORDS(x, labelOf)).sort();
  if (!same(ex(was), ex(now))) say(`کنار گذاشته‌ها: ${ex(was).join("، ") || "هیچ‌کس"} ← ${ex(now).join("، ") || "هیچ‌کس"}`);
  if (ifNobodyOf(was) !== ifNobodyOf(now)) say(`اگر کسی پیدا نشد: ${IF_NOBODY_LABELS[ifNobodyOf(was)]} ← ${IF_NOBODY_LABELS[ifNobodyOf(now)]}`);
  if (!out.length && !same([was.assignees, was.fallback ?? [], was.exclude ?? null, was.ifNobody ?? null], [now.assignees, now.fallback ?? [], now.exclude ?? null, now.ifNobody ?? null])) {
    out.push(`انجام‌دهندگان «${label}» تغییر کرد`);
  }
  return out;
}

/** The step changes between two form-step nodes of the same id. */
function stepChanges(a: ProcessNode, b: ProcessNode, prev: VersionLike, next: VersionLike, names: DiffNames): string[] {
  const out: string[] = [];
  const label = processNodeLabel(b);
  const was = formStepOf(a.config);
  const now = formStepOf(b.config);
  if (processNodeLabel(a) !== label) out.push(`نام مرحلهٔ «${processNodeLabel(a)}» به «${label}» تغییر کرد`);
  if (was.action !== now.action) out.push(`نوع مرحلهٔ «${label}» تغییر کرد`);
  const labelOf = (id: string) => {
    const n = next.graph.nodes.find((x) => x.id === id) ?? prev.graph.nodes.find((x) => x.id === id);
    return n ? processNodeLabel(n) : id;
  };
  out.push(...peopleChanges(was, now, label, names, labelOf));
  if (was.form !== now.form) out.push(`فرم مرحلهٔ «${label}» تغییر کرد`);
  if (was.rights.default !== now.rights.default) out.push(`حقوق پیش‌فرض فیلدها در «${label}» تغییر کرد`);
  const fields = [...new Set([...Object.keys(was.rights.fields), ...Object.keys(now.rights.fields)])].sort();
  for (const n of fields) {
    const r1 = was.rights.fields[n] ?? was.rights.default;
    const r2 = now.rights.fields[n] ?? now.rights.default;
    if (r1 !== r2 && RIGHT_ORDER.includes(r2)) out.push(`حقوق فیلد «${fieldLabel(n, next.forms, prev.forms)}» در «${label}» تغییر کرد`);
  }
  if (!same([was.quorum ?? null, was.threshold ?? null], [now.quorum ?? null, now.threshold ?? null])) out.push(`قاعدهٔ تأیید «${label}» تغییر کرد`);
  if (!same([was.due ?? null, was.business ?? null, was.remind_every ?? null, was.escalate ?? []], [now.due ?? null, now.business ?? null, now.remind_every ?? null, now.escalate ?? []])) {
    out.push(`مهلت، یادآوری یا تشدید «${label}» تغییر کرد`);
  }
  if ((was.returnTo ?? "actor") !== (now.returnTo ?? "actor")) out.push(`بازگشت «${label}» تغییر کرد`);
  return out;
}

/** The summary of `next` against `prev` (null: the first version). */
export function versionDiff(prev: VersionLike | null, next: VersionLike, names: DiffNames): PublishDiff {
  const access: string[] = [];
  if (!prev) {
    if (next.managers.length) access.push(`مسئولان: + ${next.managers.map(names.user).join("، ")}`);
    if (next.manager_groups.length) access.push(`گروه‌های مسئول: + ${next.manager_groups.map(names.group).join("، ")}`);
    if (next.confidential) access.push("محرمانه: روشن");
    return { first: true, changes: ["نخستین نسخهٔ این گردش‌کار"], access };
  }
  const changes: string[] = [];
  if (prev.name !== next.name) changes.push(`نام گردش‌کار به «${next.name}» تغییر کرد`);
  const steps = (g: ProcessGraph) => new Map(g.nodes.filter((n) => n.type === "form_step").map((n) => [n.id, n]));
  const a = steps(prev.graph);
  const b = steps(next.graph);
  const added = [...b.keys()].filter((k) => !a.has(k));
  const removed = [...a.keys()].filter((k) => !b.has(k));
  if (added.length === 1) changes.push(`مرحلهٔ «${processNodeLabel(b.get(added[0])!)}» افزوده شد`);
  else if (added.length) changes.push(`${faDigits(added.length)} مرحله افزوده شد`);
  if (removed.length === 1) changes.push(`مرحلهٔ «${processNodeLabel(a.get(removed[0])!)}» حذف شد`);
  else if (removed.length) changes.push(`${faDigits(removed.length)} مرحله حذف شد`);
  for (const [k, n] of b) if (a.has(k)) changes.push(...stepChanges(a.get(k)!, n, prev, next, names));
  // the path: the other nodes and the edges
  const rest = (g: ProcessGraph) =>
    JSON.stringify([
      g.nodes.filter((n) => n.type !== "form_step").map((n) => [n.id, n.type, n.label ?? null, n.config ?? {}]).sort(),
      g.edges.map((e) => [e.source, e.port ?? "out", e.target]).sort(),
    ]);
  if (rest(prev.graph) !== rest(next.graph)) changes.push("مسیر گردش‌کار (شرط‌ها، شاخه‌ها یا پیوندها) تغییر کرد");
  // the forms' layouts and the shared lists they resolved
  for (const [id, f] of Object.entries(next.forms?.forms ?? {})) {
    const old = prev.forms?.forms[id];
    if (old && layoutHash(old.layout) !== layoutHash(f.layout)) changes.push(`فرم «${f.name}» تغییر کرد`);
  }
  for (const [key, l] of Object.entries(next.forms?.lists ?? {})) {
    const old = prev.forms?.lists[key];
    if (old && old.hash !== l.hash) changes.push(`گزینه‌های فهرست «${key}» تغییر کرد`);
  }
  if (!same(prev.starters, next.starters)) changes.push("آغازکنندگان تغییر کرد");
  if ((prev.title_template ?? "") !== (next.title_template ?? "")) changes.push("الگوی عنوان پرونده‌ها تغییر کرد");
  if (!same([...prev.requester_view].sort(), [...next.requester_view].sort())) changes.push("آنچه درخواست‌دهنده می‌بیند تغییر کرد");
  access.push(...people(prev.managers, next.managers, names.user, "مسئولان"));
  access.push(...people(prev.manager_groups, next.manager_groups, names.group, "گروه‌های مسئول"));
  if (prev.confidential !== next.confidential) access.push(`محرمانه: ${next.confidential ? "روشن" : "خاموش"}`);
  if (!changes.length && !access.length) changes.push("تغییری نسبت به نسخهٔ پیشین ندارد");
  return { first: false, changes, access };
}
