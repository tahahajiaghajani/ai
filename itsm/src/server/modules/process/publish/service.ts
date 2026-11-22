// The process designer's services (design F §3.5 «Publish», §6.1, §6.7, §8.4, package F4c):
//   · a new process, its detail and its autosaved draft (with the validator's problems: the forms of the draft, the
//     fields, positions, groups, people and automations it names) — `process_design` read / create / write;
//   · «انتشار»: `process_design` approve and a recent proof of identity (the route's `needRecentAuthOf`). Validation
//     must show no error and every form, field and position must exist and be active; then ONE transaction writes the
//     version (graph, step settings, the form snapshot of F2's `publishForms`, starters, title, requester view, access
//     settings, publisher, note and the diff), the process's status and current version, and the access settings onto
//     every case of the process (F4b's `propagateAccess`), with an entry in «گزارش رویدادها»;
//   · «بازنشسته‌کردن» (approve and re-authentication): new cases are refused, open ones finish on their version;
//   · «نسخه‌ها» with their diffs, and «بازگرداندن به پیش‌نویس» from any version (write).
// Publishing happens where cases advance (the web version, the server edition, a standalone Windows app): a linked
// Windows app may draft, but a version is written only by the authority.
import type { FlowProblem } from "@shared/flows/types";
import { hasProcessErrors, validateProcess } from "@shared/process/validate";
import { assigneeProblems, type AssigneeFacts } from "@shared/process/assignees";
import { formStepOf, processSteps, type ProcessGraph } from "@shared/process/graph";
import { readSnapshot, snapshotFields, type FormsSnapshot } from "@shared/forms/snapshot";
import { faDigits } from "@shared/format";
import type { Ctx } from "../../../context";
import { pgArray, type Queryable } from "../../../db";
import { AppError, bad, conflict, forbidden, notFound } from "../../../http/errors";
import { create, createIn, get, isSystemCtx, systemCtx, update, updateIn } from "../../../engine";
import { enqueue } from "../../../jobs";
import { audit } from "../../data/crud";
import { designGrant } from "../../fields/grants";
import { loadFormsSnapshot, publishForms } from "../../forms";
import { assigneeFactsFor } from "../../positions";
import { propagateAccess } from "../access";
import { processesRunHere } from "../engine";
import { isId, loadVersionInfo, peopleNames, type VersionInfo } from "../engine/store";
import { caseManagers } from "../timers/timer";
import { demoPeople, isDemoRow } from "../../../db/scope";
import { cleanDraft, draftRules, graphForms, MAX_DRAFT_BYTES, type ProcessDraft } from "./draft";
import { versionDiff, type DiffNames, type PublishDiff, type VersionLike } from "./diff";

export const PUBLISH_REFUSAL = "انتشار با مسئول انتشار است";
export const CONNECTION_NEEDED = "این کار به اتصال نیاز دارد";
/** The seeding job of the workflows' notification rules (./../api/notices.ts) — queued by the first publish. */
export const SEED_JOB = "process.seed";

// ----- who may ----------------------------------------------------------------------------------------------------

export interface DesignRights {
  read: boolean;
  write: boolean;
  create: boolean;
  publish: boolean;
}

/** The caller's rights in «طراحی فرم و گردش‌کار» (the system: everything). */
export async function designRights(ctx: Ctx): Promise<DesignRights> {
  if (isSystemCtx(ctx)) return { read: true, write: true, create: true, publish: true };
  const g = await designGrant(ctx);
  if (!g) return { read: false, write: false, create: false, publish: false };
  return { read: g.read !== "none", write: g.write !== "none", create: !!g.create, publish: !!g.approve };
}

export async function needDesignRead(ctx: Ctx): Promise<DesignRights> {
  const r = await designRights(ctx);
  if (!r.read) throw forbidden("به «گردش‌کارها»ی سازمان دسترسی ندارید");
  return r;
}

async function needDesignWrite(ctx: Ctx): Promise<void> {
  if (!(await designRights(ctx)).write) throw forbidden("ویرایش گردش‌کارها دسترسی «طراحی فرم و گردش‌کار» می‌خواهد");
}

async function needPublish(ctx: Ctx): Promise<void> {
  if (!(await designRights(ctx)).publish) throw forbidden(PUBLISH_REFUSAL);
}

async function needAuthority(ctx: Ctx): Promise<void> {
  if (!(await processesRunHere(ctx.cfg, ctx.org.id))) throw conflict(CONNECTION_NEEDED);
}

// ----- rows -------------------------------------------------------------------------------------------------------

export interface ProcessRow {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  category: string | null;
  description: string | null;
  draft: unknown;
  status: string;
  version_no: number | null;
  current_version_id: string | null;
  published_at: string | null;
  published_by: string | null;
  updated_at: string | null;
  version: number;
}

/** The process (by id or key), after the caller's own read of it through the record engine (404 otherwise). */
async function processRow(ctx: Ctx, ref: string, q: Queryable = ctx.db, lock = false): Promise<ProcessRow> {
  const r = String(ref ?? "").trim();
  const row = await q.one<ProcessRow>(
    `select id, key, name, icon, category, description, draft, status, version_no, current_version_id, published_at, published_by, updated_at, version
     from sm_processes where org_id = $1 and deleted_at is null and ${isId(r) ? "id = $2::uuid" : "key = $2"}${lock ? " for update" : ""}`,
    [ctx.org.id, isId(r) ? r.toLowerCase() : r],
  );
  if (!row) throw notFound("گردش‌کار پیدا نشد");
  if (!isSystemCtx(ctx) && !lock) await get(ctx, "process", row.id);
  return row;
}

async function groupNames(q: Queryable, orgId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(isId))];
  if (!wanted.length) return new Map();
  const rows = await q.query<{ id: string; name: string }>(`select id, name from sm_groups where org_id = $1 and id = any($2::uuid[])`, [orgId, pgArray(wanted)]);
  return new Map(rows.map((r) => [String(r.id), String(r.name)]));
}

/** What the steps' people rules of `graphs` name: people, groups, positions and units (the diff says them by name). */
function ruleRefs(graphs: (ProcessGraph | null | undefined)[]): { users: string[]; groups: string[]; positions: string[]; units: string[] } {
  const out = { users: [] as string[], groups: [] as string[], positions: [] as string[], units: [] as string[] };
  for (const g of graphs) {
    for (const n of g?.nodes ?? []) {
      if (n.type !== "form_step") continue;
      const s = formStepOf(n.config);
      for (const r of [...s.assignees, ...(s.fallback ?? [])]) {
        if (r.kind === "users") out.users.push(...r.users);
        if ("members" in r && r.members) out.users.push(...r.members);
        if (r.kind === "group") out.groups.push(r.group);
        if (r.kind === "position") {
          out.positions.push(r.position);
          if (r.unit) out.units.push(r.unit);
        }
      }
    }
  }
  return out;
}

async function diffNames(q: Queryable, orgId: string, users: readonly string[], groups: readonly string[], graphs: (ProcessGraph | null | undefined)[] = []): Promise<DiffNames & { display: Record<string, string> }> {
  const refs = ruleRefs(graphs);
  const [u, g] = await Promise.all([peopleNames(q, [...users, ...refs.users]), groupNames(q, orgId, [...groups, ...refs.groups])]);
  const keys = [...new Set(refs.positions)];
  const positions = keys.length
    ? await q.query<{ id: string; key: string; name: string }>(`select id::text as id, key, name from sm_positions where org_id = $1 and (key = any($2::text[]) or id::text = any($2::text[]))`, [orgId, pgArray(keys)])
    : [];
  const unitIds = [...new Set(refs.units.filter(isId))];
  const units = unitIds.length ? await q.query<{ id: string; name: string }>(`select id::text as id, name from sm_org_units where org_id = $1 and id = any($2::uuid[])`, [orgId, pgArray(unitIds)]) : [];
  const display = Object.fromEntries([...peopleOnly(u, users), ...groupsOnly(g, groups)]);
  return {
    user: (id) => u.get(id) ?? "—",
    group: (id) => g.get(id) ?? "—",
    position: (key) => positions.find((p) => p.key === key || p.id === key.toLowerCase())?.name ?? key,
    unit: (id) => units.find((x) => x.id === id.toLowerCase())?.name ?? "—",
    display,
  };
}

/** The names the answer's `display` carried before (the managers and the publisher, the manager groups). */
const peopleOnly = (m: Map<string, string>, ids: readonly string[]) => [...m].filter(([k]) => ids.includes(k));
const groupsOnly = (m: Map<string, string>, ids: readonly string[]) => [...m].filter(([k]) => ids.includes(k));

const asVersionLike = (name: string, d: ProcessDraft, forms: FormsSnapshot | null): VersionLike => ({
  name, graph: d.graph, forms, starters: d.starters, title_template: d.title_template, requester_view: d.requester_view,
  managers: d.managers, manager_groups: d.manager_groups, confidential: d.confidential,
});

const versionLike = (v: VersionInfo): VersionLike => ({
  name: v.name, graph: v.graph, forms: v.forms, starters: v.starters, title_template: v.title_template, requester_view: v.requester_view,
  managers: v.managers, manager_groups: v.manager_groups, confidential: v.confidential,
});

// ----- validation -------------------------------------------------------------------------------------------------

export interface DraftCheck {
  problems: FlowProblem[];
  snapshot: FormsSnapshot;
}

/**
 * The demo pack's people among the managers a draft names — by name, or as members of its manager groups — when the
 * process is the organisation's own (a process of the pack's is managed by the pack's people): their names, and whether
 * they are all of its managers. Null: none.
 */
async function demoManagersOf(ctx: Ctx, processId: string | null, d: ProcessDraft): Promise<{ names: string[]; all: boolean } | null> {
  if (!processId || (!d.managers.length && !d.manager_groups.length) || (await isDemoRow(ctx.db, ctx.org.id, processId))) return null;
  const everyone = await caseManagers(ctx.db, { org_id: ctx.org.id, managers: d.managers, manager_groups: d.manager_groups });
  const pack = await demoPeople(ctx.db, ctx.org.id, everyone);
  if (!pack.size) return null;
  const names = await peopleNames(ctx.db, [...pack]);
  return { names: [...pack].map((u) => names.get(u) ?? "—").sort((a, b) => a.localeCompare(b, "fa")), all: everyone.every((u) => pack.has(u.toLowerCase())) };
}

/**
 * Every problem of a draft against the organisation as it is now (errors block a publish). Reads outside any
 * transaction. `processId`: the draft's process (the demo pack's people among its managers are warned of).
 */
export async function checkDraft(ctx: Ctx, d: ProcessDraft, processId: string | null = null): Promise<DraftCheck> {
  const formIds = graphForms(d.graph);
  const { snapshot, problems: formProblems } = await loadFormsSnapshot(ctx.db, ctx, formIds);
  const fields = snapshotFields(snapshot);
  const fieldFacts: Record<string, { type: string; ref?: string | null; label?: string | null }> = {};
  for (const [name, f] of fields) fieldFacts[name] = { type: f.type, ref: f.ref ?? null, label: f.label };
  const facts: AssigneeFacts = await assigneeFactsFor(ctx, { assignees: draftRules(d) }, fieldFacts);
  const flowIds = d.graph.nodes.filter((n) => n.type === "subflow" && typeof n.config?.flow === "string" && isId(n.config.flow)).map((n) => String(n.config.flow));
  const flows = flowIds.length
    ? new Map(
        (await ctx.db.query<{ id: string; name: string; version_id: string | null }>(`select id, name, version_id from sm_flows where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [ctx.org.id, pgArray(flowIds)])).map(
          (f) => [String(f.id), { name: String(f.name), published: !!f.version_id }],
        ),
      )
    : new Map<string, { name: string; published: boolean }>();
  const problems: FlowProblem[] = validateProcess(d.graph, {
    forms: (id) => snapshot.forms[id],
    fields,
    assigneeFacts: facts,
    titleTemplate: d.title_template,
    flow: (id) => flows.get(id.toLowerCase()) ?? null,
    demoManagers: await demoManagersOf(ctx, processId, d),
  });
  for (const m of formProblems) problems.push({ level: "error", message: m });
  // no starters: every member may start
  if (d.starters.length) for (const p of assigneeProblems({ assignees: d.starters }, facts)) problems.push({ level: "error", message: `آغازکنندگان: ${p.message}`, field: "starters" });
  for (const k of d.requester_view) if (!fields.has(k)) problems.push({ level: "error", message: `فیلد «${k}» در فرم‌های این گردش‌کار نیست`, field: "requester_view" });
  if (d.managers.length) {
    const live = new Set(
      (await ctx.db.query<{ user_id: string }>(`select user_id from sm_org_members where org_id = $1 and user_id = any($2::uuid[]) and is_active and deleted_at is null`, [ctx.org.id, pgArray(d.managers)])).map((r) => String(r.user_id)),
    );
    if (d.managers.some((u) => !live.has(u))) problems.push({ level: "error", message: "یکی از مسئولان این گردش‌کار دیگر عضو فعال سازمان نیست", field: "managers" });
  }
  if (d.manager_groups.length) {
    const groups = await ctx.db.query<{ id: string; active: boolean | null }>(`select id, active from sm_groups where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [ctx.org.id, pgArray(d.manager_groups)]);
    if (groups.length !== d.manager_groups.length || groups.some((g) => g.active === false)) problems.push({ level: "error", message: "یکی از گروه‌های مسئول پیدا نشد یا غیرفعال است", field: "manager_groups" });
  }
  if (!d.managers.length && !d.manager_groups.length) {
    // the administrators a case without managers falls to do not read a confidential one: its notices would reach nobody
    if (d.confidential) problems.push({ level: "error", message: "گردش‌کار محرمانه دست‌کم یک مسئول می‌خواهد", field: "managers" });
    else problems.push({ level: "warning", message: "این گردش‌کار مسئولی ندارد؛ پرونده‌های متوقف به مدیران سازمان سپرده می‌شوند", field: "managers" });
  }
  return { problems, snapshot };
}

// ----- the designer's reads and writes ----------------------------------------------------------------------------

export interface ProcessDetail {
  process: Omit<ProcessRow, "draft">;
  draft: ProcessDraft;
  problems: FlowProblem[];
  /** the draft differs from the published version */
  unpublished: boolean;
  open_cases: number;
  can: DesignRights;
  display: Record<string, string>;
}

const OPEN = ["active", "waiting", "attention"];

/** The designer's view of a process: its draft, the draft's problems, and what the caller may do. */
export async function processDetail(ctx: Ctx, ref: string): Promise<ProcessDetail> {
  const can = await needDesignRead(ctx);
  const row = await processRow(ctx, ref);
  const draft = cleanDraft(row.draft);
  const check = await checkDraft(ctx, draft, row.id);
  const current = row.current_version_id ? await loadVersionInfo(ctx.db, ctx.org.id, row.current_version_id) : null;
  const names = await diffNames(ctx.db, ctx.org.id, [...draft.managers, ...(row.published_by ? [row.published_by] : [])], draft.manager_groups, [draft.graph, current?.graph]);
  const diff = current ? versionDiff(versionLike(current), asVersionLike(row.name, draft, check.snapshot), names) : null;
  const open = await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1 and process_id = $2 and deleted_at is null and state = any($3::text[])`, [ctx.org.id, row.id, pgArray(OPEN)]);
  const { draft: _d, ...process } = row;
  return {
    process,
    draft,
    problems: check.problems,
    unpublished: !current || !!diff?.access.length || !diff?.changes.every((c) => c === "تغییری نسبت به نسخهٔ پیشین ندارد"),
    open_cases: open?.n ?? 0,
    can,
    display: names.display,
  };
}

export interface NewProcess {
  name: string;
  key: string;
  icon?: string | null;
  category?: string | null;
  description?: string | null;
  draft?: unknown;
}

/** «گردش‌کار تازه»: a process with an empty (or given) draft, created as the caller. */
export async function createProcess(ctx: Ctx, input: NewProcess): Promise<ProcessDetail> {
  const r = await designRights(ctx);
  if (!r.create && !r.write) throw forbidden("ساخت گردش‌کار دسترسی «طراحی فرم و گردش‌کار» می‌خواهد");
  const draft = cleanDraft(input.draft ?? defaultDraft());
  const made = await create(ctx, "process", {
    name: input.name, key: input.key, icon: input.icon ?? null, category: input.category ?? null, description: input.description ?? null, draft,
  });
  return processDetail(ctx, String(made.row.id));
}

/** A new draft: «آغاز» and «ثبت درخواست» by the requester, joined. */
export function defaultDraft(): ProcessDraft {
  return {
    graph: {
      nodes: [
        { id: "start", type: "trigger", config: {} },
        { id: "request", type: "form_step", config: { action: "fill", start: true, form: null, rights: { default: "edit", fields: {} }, assignees: [{ kind: "requester" }] }, label: "ثبت درخواست" },
      ],
      edges: [{ id: "start.out.request", source: "start", target: "request" }],
    } as unknown as ProcessGraph,
    starters: [],
    title_template: null,
    requester_view: [],
    managers: [],
    manager_groups: [],
    confidential: false,
  };
}

export interface DraftInput {
  draft: unknown;
  name?: string;
  icon?: string | null;
  category?: string | null;
  description?: string | null;
  /** the row's version the designer edited (a concurrent save is refused) */
  version?: number;
}

/** The designer's autosave: the draft (and the process's name, icon, category or description). */
export async function saveDraft(ctx: Ctx, ref: string, input: DraftInput): Promise<ProcessDetail> {
  await needDesignWrite(ctx);
  const row = await processRow(ctx, ref);
  const draft = cleanDraft(input.draft);
  if (JSON.stringify(draft).length > MAX_DRAFT_BYTES) throw bad("پیش‌نویس این گردش‌کار بیش از اندازه بزرگ است");
  const values: Record<string, unknown> = { draft };
  for (const k of ["name", "icon", "category", "description"] as const) if (input[k] !== undefined) values[k] = input[k];
  // the version the designer edited: a save over someone else's is refused (409 version_conflict), as the record API does
  await update(ctx, "process", row.id, values, input.version !== undefined ? { version: input.version } : {});
  return processDetail(ctx, row.id);
}

export interface DiffPreview {
  diff: PublishDiff;
  problems: FlowProblem[];
  can_publish: boolean;
  next_version: number;
  display: Record<string, string>;
}

/** What «انتشار» would publish: the diff against the current version and the draft's problems. */
export async function publishPreview(ctx: Ctx, ref: string): Promise<DiffPreview> {
  const can = await needDesignRead(ctx);
  const row = await processRow(ctx, ref);
  const draft = cleanDraft(row.draft);
  const check = await checkDraft(ctx, draft, row.id);
  const current = row.current_version_id ? await loadVersionInfo(ctx.db, ctx.org.id, row.current_version_id) : null;
  const names = await diffNames(ctx.db, ctx.org.id, [...draft.managers, ...(current?.managers ?? [])], [...draft.manager_groups, ...(current?.manager_groups ?? [])], [draft.graph, current?.graph]);
  return {
    diff: versionDiff(current ? versionLike(current) : null, asVersionLike(row.name, draft, check.snapshot), names),
    problems: check.problems,
    can_publish: can.publish && !hasProcessErrors(check.problems),
    next_version: (Number(row.version_no) || 0) + 1,
    display: names.display,
  };
}

export interface PublishResult {
  version: { id: string; version_no: number; published_at: string };
  diff: PublishDiff;
  /** how many cases of the process took the new access settings */
  propagated: number;
  message: string;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Refused with the draft's errors (400, `details.problems`). */
const invalid = (problems: FlowProblem[]) =>
  new AppError(400, "invalid_process", `گردش‌کار پیش از انتشار ${faDigits(problems.filter((p) => p.level === "error").length)} ایراد دارد`, { problems });

/** «انتشار»: the draft becomes the process's next version (see the header). The route asks for re-authentication. */
export async function publishProcess(ctx: Ctx, ref: string, input: { note?: string | null } = {}): Promise<PublishResult> {
  await needPublish(ctx);
  await needAuthority(ctx);
  const row = await processRow(ctx, ref);
  const draft = cleanDraft(row.draft);
  const check = await checkDraft(ctx, draft, row.id);
  if (hasProcessErrors(check.problems)) throw invalid(check.problems);
  const current = row.current_version_id ? await loadVersionInfo(ctx.db, ctx.org.id, row.current_version_id) : null;
  const names = await diffNames(ctx.db, ctx.org.id, [...draft.managers, ...(current?.managers ?? [])], [...draft.manager_groups, ...(current?.manager_groups ?? [])], [draft.graph, current?.graph]);
  const formIds = graphForms(draft.graph);
  const note = String(input.note ?? "").trim().slice(0, 300) || null;
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  const by = isSystemCtx(ctx) ? null : ctx.user.id;
  return sys.write(async (tx) => {
    const locked = await processRow(sys, row.id, tx, true);
    // the draft or the published version changed while it was being checked: the publisher looks again
    if (Number(locked.version) !== Number(row.version) || locked.current_version_id !== row.current_version_id) throw conflict("گردش‌کار هم‌زمان تغییر کرد؛ تغییرها را ببینید و دوباره منتشر کنید");
    const forms = await publishForms(tx, ctx, formIds);
    if (forms.problems.length) throw invalid(forms.problems.map((m) => ({ level: "error" as const, message: m })));
    const diff = versionDiff(current ? versionLike(current) : null, asVersionLike(row.name, draft, forms.snapshot), names);
    const last = await tx.one<{ n: number }>(`select coalesce(max(version_no), 0)::int as n from sm_process_versions where org_id = $1 and process_id = $2`, [ctx.org.id, row.id]);
    const no = Math.max(Number(last?.n ?? 0), Number(row.version_no) || 0) + 1;
    const now = iso(Date.now());
    const version = await createIn(
      tx,
      sys,
      "process_version",
      {
        process_id: row.id, name: row.name, version_no: no, graph: draft.graph, steps: processSteps(draft.graph), forms: forms.snapshot, starters: draft.starters,
        title_template: draft.title_template, requester_view: draft.requester_view, managers: draft.managers, manager_groups: draft.manager_groups,
        confidential: draft.confidential, published_by: by, published_at: now, note, diff,
      },
      { trusted: true },
    );
    await updateIn(tx, sys, "process", row.id, { status: "published", current_version_id: version.id, version_no: no, published_at: now, published_by: by }, { trusted: true, keepVersion: true });
    const propagated = await propagateAccess(tx, ctx.org.id, row.id, { managers: draft.managers, manager_groups: draft.manager_groups, confidential: draft.confidential });
    if (!isSystemCtx(ctx)) await audit(tx, ctx, "process.publish", "process", row.id, `انتشار «${row.name}» نسخهٔ ${faDigits(no)}`, { version: version.id, version_no: no, note, diff });
    // the workflows' notification rules: seeded once per organisation (the job does nothing when they are)
    await enqueue(tx, { kind: SEED_JOB, orgId: ctx.org.id, dedupeKey: SEED_JOB, maxAttempts: 5 });
    return {
      version: { id: String(version.id), version_no: no, published_at: now },
      diff,
      propagated,
      message: `نسخهٔ ${faDigits(no)} منتشر شد؛ پرونده‌های تازه با آن آغاز می‌شوند`,
    };
  });
}

/** «بازنشسته‌کردن»: no new case; the open ones finish on their version. */
export async function retireProcess(ctx: Ctx, ref: string, input: { note?: string | null } = {}): Promise<{ status: string; open_cases: number; message: string }> {
  await needPublish(ctx);
  await needAuthority(ctx);
  const row = await processRow(ctx, ref);
  const sys = await systemCtx(ctx.cfg, ctx.org.id);
  return sys.write(async (tx) => {
    const locked = await processRow(sys, row.id, tx, true);
    if (locked.status !== "published") throw conflict(locked.status === "retired" ? "این گردش‌کار پیش‌تر بازنشسته شده است" : "گردش‌کاری که منتشر نشده است بازنشسته نمی‌شود");
    await updateIn(tx, sys, "process", row.id, { status: "retired" }, { trusted: true, keepVersion: true });
    const open = await tx.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1 and process_id = $2 and deleted_at is null and state = any($3::text[])`, [ctx.org.id, row.id, pgArray(OPEN)]);
    const note = String(input.note ?? "").trim().slice(0, 300);
    if (!isSystemCtx(ctx)) await audit(tx, ctx, "process.retire", "process", row.id, `بازنشسته‌کردن «${row.name}»`, { note: note || null, open_cases: open?.n ?? 0 });
    const n = open?.n ?? 0;
    return { status: "retired", open_cases: n, message: n ? `گردش‌کار بازنشسته شد؛ ${faDigits(n)} پروندهٔ باز با نسخهٔ خود به پایان می‌رسد` : "گردش‌کار بازنشسته شد" };
  });
}

export interface VersionRow {
  id: string;
  version_no: number;
  name: string;
  note: string | null;
  published_by: string | null;
  published_at: string | null;
  confidential: boolean;
  diff: PublishDiff | null;
  current: boolean;
}

/** «نسخه‌ها»: every version of the process, newest first, with its diff. */
export async function processVersions(ctx: Ctx, ref: string): Promise<{ versions: VersionRow[]; display: Record<string, string> }> {
  await needDesignRead(ctx);
  const row = await processRow(ctx, ref);
  const rows = await ctx.db.query<Omit<VersionRow, "current">>(
    `select id, version_no, name, note, published_by, published_at, confidential, diff from sm_process_versions
     where org_id = $1 and process_id = $2 and deleted_at is null order by version_no desc`,
    [ctx.org.id, row.id],
  );
  const names = await peopleNames(ctx.db, rows.map((r) => r.published_by));
  return {
    versions: rows.map((r) => ({ ...r, version_no: Number(r.version_no), confidential: r.confidential === true, diff: (r.diff as PublishDiff | null) ?? null, current: r.id === row.current_version_id })),
    display: Object.fromEntries(names),
  };
}

/** «بازگرداندن به پیش‌نویس»: a version's graph and settings become the draft (the published version does not change). */
export async function restoreVersion(ctx: Ctx, ref: string, versionId: string): Promise<ProcessDetail> {
  await needDesignWrite(ctx);
  const row = await processRow(ctx, ref);
  const v = await loadVersionInfo(ctx.db, ctx.org.id, versionId);
  if (!v || v.process_id !== row.id) throw notFound("این نسخه پیدا نشد");
  const draft: ProcessDraft = {
    graph: v.graph, starters: v.starters, title_template: v.title_template, requester_view: v.requester_view,
    managers: v.managers, manager_groups: v.manager_groups, confidential: v.confidential,
  };
  await update(ctx, "process", row.id, { draft: cleanDraft(draft) });
  return processDetail(ctx, row.id);
}

/** Snapshot of the forms of a version as stored (null: none). */
export const versionForms = (raw: unknown): FormsSnapshot | null => readSnapshot(raw);
