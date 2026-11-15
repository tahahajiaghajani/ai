// What a publish changes (design F §3.5 «Publish», §8.4 «انتشار»/«نسخه‌ها», package F4c): a short Persian summary of the
// new version against the current one — steps added and removed, each step's people, form, rights («حقوق فیلد "مبلغ" در
// "تأیید رئیس شعبه" تغییر کرد»), quorum and times, the path, the forms' layouts and shared lists, the starters, the
// title and what the requester sees — and, apart, the access settings: «مسئولان: + علی احمدی»، «گروه‌های مسئول: − …»،
// «محرمانه: روشن». The publisher reads it before re-authenticating; the version keeps it (`diff`), and «نسخه‌ها» shows it.
import type { Right } from "@shared/forms/layout";
import { layoutHash, type FormsSnapshot } from "@shared/forms/snapshot";
import { faDigits } from "@shared/format";
import { formStepOf, processNodeLabel, type ProcessGraph, type ProcessNode } from "@shared/process/graph";
import type { AssigneeRule } from "@shared/process/assignees";

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

/** The step changes between two form-step nodes of the same id. */
function stepChanges(a: ProcessNode, b: ProcessNode, prev: VersionLike, next: VersionLike): string[] {
  const out: string[] = [];
  const label = processNodeLabel(b);
  const was = formStepOf(a.config);
  const now = formStepOf(b.config);
  if (processNodeLabel(a) !== label) out.push(`نام مرحلهٔ «${processNodeLabel(a)}» به «${label}» تغییر کرد`);
  if (was.action !== now.action) out.push(`نوع مرحلهٔ «${label}» تغییر کرد`);
  if (!same([was.assignees, was.fallback ?? [], was.exclude ?? null, was.ifNobody ?? null], [now.assignees, now.fallback ?? [], now.exclude ?? null, now.ifNobody ?? null])) {
    out.push(`انجام‌دهندگان «${label}» تغییر کرد`);
  }
  if (was.form !== now.form) out.push(`فرم مرحلهٔ «${label}» تغییر کرد`);
  if (was.rights.default !== now.rights.default) out.push(`حقوق پیش‌فرض فیلدها در «${label}» تغییر کرد`);
  const names = [...new Set([...Object.keys(was.rights.fields), ...Object.keys(now.rights.fields)])].sort();
  for (const n of names) {
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
  for (const [k, n] of b) if (a.has(k)) changes.push(...stepChanges(a.get(k)!, n, prev, next));
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
