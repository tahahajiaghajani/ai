// Hooks of enterprise service management (same transaction as the write):
//   · configuration (departments, services, journey templates and their activities): the delegated administrators
//     are copied onto every row (`dept_admins`, the rows the role «مدیر خدمات واحد» owns); only an ESM administrator
//     or the department's own administrators define its services and templates; a template's activities move its
//     version
//   · department cases (ESM-001/003/006/007/011): the department comes from the service (or the table's default) and
//     its workspace is stamped on the case — never taken from people, so a secure workspace really is deny-by-default;
//     a case moves to another department only by «انتقال» (the trusted route); the service's defaults (priority,
//     category, confidentiality, masked notifications, who may file for whom); the neutral display title of sensitive
//     cases; who may watch a case of a secure department; HR subjects; legal privilege; separation of duties on
//     purchases; the routing group (after the write, as the system: the access model's assignment rule is about what
//     a person may route, not the department's own intake)
//   · HR tasks, profiles and employee-relations notes: the HR workspace, the evidence a task needs before it is done
// A Windows app's push runs no `beforeWrite`: the derived columns are recomputed by `derivePush`, the guards by
// `pushGuard`.
import { ESM_CASE_TABLES, CASE_TABLE_KIND, isEsmCaseTable } from "@shared/tables/esm";
import { caseTitle } from "@shared/esm/logic";
import type { Ctx } from "../../context";
import type { Tx } from "../../db";
import { isSystemCtx, onBeforeCommit, orgSchema, pushGuard, registerHooks, updateIn, validationError, type PushArgs, type WriteArgs } from "../../engine";
import { forbidden } from "../../http/errors";
import {
  administersDepartment, administersEsm, defaultDepartment, departmentById, esmConfig, hrStaff, hrWorksGroup, ids, isSecureWorkspace, isUuid, liveRow, liveRows,
  mayWorkRecord, sysOf, workspaceMembersOf, eqAll, type Row,
} from "./common";

/** Tables of department records stamped with their department's workspace. */
export const DEPT_TABLES = [...ESM_CASE_TABLES, "hse_event"];

// ----- configuration -------------------------------------------------------------------------------------------------

const adminsOf = (dept: Row | null): string[] => (dept ? ids([...((dept.admins as string[]) ?? []), dept.manager_id]) : []);

async function adminsCopy(tx: Tx, ctx: Ctx, table: string, next: Row): Promise<Row> {
  const sys = sysOf(ctx);
  if (table === "esm_department") return { dept_admins: adminsOf(next) };
  if (table === "journey_template_activity") {
    const t = isUuid(next.template_id) ? await liveRow(tx, sys, "journey_template", next.template_id) : null;
    return { dept_admins: ids(t?.dept_admins ?? []) };
  }
  return { dept_admins: adminsOf(await departmentById(tx, ctx, next.department_id)) };
}

/**
 * The administrators copied onto a department's services and templates, put in step at commit under the department's
 * key — queued by a change of the department's administrators and by a new (or moved) service or template: whichever
 * commits second re-reads the department and its rows after the other, so a row made while the administrators change
 * never keeps the old ones (the templates pass theirs on to their activities).
 */
function adminsInStep(tx: Tx, ctx: Ctx, deptId: unknown): void {
  if (!isUuid(deptId)) return;
  onBeforeCommit(tx, `esm.dept_admins:${deptId}`, async () => {
    const sys = sysOf(ctx);
    const admins = adminsOf(await departmentById(tx, ctx, deptId));
    const key = (xs: unknown) => ids((xs as string[]) ?? []).sort().join(",");
    for (const t of ["esm_service", "journey_template"]) {
      for (const r of await liveRows(tx, sys, t, eqAll({ department_id: deptId }), { limit: 2000 })) {
        if (key(r.dept_admins) !== key(admins)) await updateIn(tx, sys, t, String(r.id), { dept_admins: admins }, { trusted: true, keepVersion: true });
      }
    }
  });
}

async function configBefore(w: WriteArgs): Promise<void> {
  const { ctx, tx, def, next, prev, op } = w;
  if (op === "delete") {
    if (!isSystemCtx(ctx) && def.key === "esm_department" && !(await administersEsm(tx, ctx))) throw forbidden("حذف واحد با مدیر خدمات سازمانی است");
    return;
  }
  Object.assign(next, await adminsCopy(tx, ctx, def.key, next));
  if ((def.key === "esm_service" || def.key === "journey_template") && (op === "create" || w.changed.has("department_id"))) adminsInStep(tx, ctx, next.department_id);
  if (isSystemCtx(ctx) || w.trusted) return;
  if (def.key === "esm_department") {
    // a department is defined, re-pointed or handed new administrators only by the ESM administrator; its own
    // administrators keep its portal section, intro, defaults and live state
    const reserved = ["key", "kind", "dept_workspace_id", "admins", "manager_id", "case_table"];
    if ((op === "create" || reserved.some((f) => w.changed.has(f))) && !(await administersEsm(tx, ctx))) {
      throw forbidden("تعریف واحد، فضای کاری و مدیران آن با مدیر خدمات سازمانی است");
    }
    return;
  }
  // services, templates and their activities: the department's own administrators (or the ESM administrator)
  const deptId = def.key === "journey_template_activity" ? (await liveRow(tx, sysOf(ctx), "journey_template", next.template_id))?.department_id : next.department_id;
  const dept = await departmentById(tx, ctx, deptId);
  if (!(await administersDepartment(tx, ctx, dept))) throw forbidden(dept ? `تعریف خدمت‌ها و سفرهای «${dept.name}» با مدیران همان واحد است` : "این تعریف فقط با مدیر خدمات سازمانی است");
  if (prev && w.changed.has("department_id") && !(await administersDepartment(tx, ctx, await departmentById(tx, ctx, prev.department_id)))) {
    throw forbidden("انتقال تعریف از واحد دیگری ممکن نیست");
  }
}

async function configAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { ctx, tx, def, row, op } = w;
  const sys = sysOf(ctx);
  // the new administrators reach the department's services and templates (and the templates' activities) at commit
  if (def.key === "esm_department" && op !== "delete" && (w.changed.has("admins") || w.changed.has("manager_id"))) adminsInStep(tx, ctx, row.id);
  if (def.key === "journey_template" && op !== "delete" && w.changed.has("department_id")) {
    for (const a of await liveRows(tx, sys, "journey_template_activity", eqAll({ template_id: row.id }), { limit: 2000 })) {
      await updateIn(tx, sys, "journey_template_activity", String(a.id), { dept_admins: ids(row.dept_admins) }, { trusted: true, keepVersion: true });
    }
  }
  if (def.key === "journey_template" && op !== "delete" && w.changed.has("dept_admins") && !w.changed.has("department_id")) {
    for (const a of await liveRows(tx, sys, "journey_template_activity", eqAll({ template_id: row.id }), { limit: 2000 })) {
      await updateIn(tx, sys, "journey_template_activity", String(a.id), { dept_admins: ids(row.dept_admins) }, { trusted: true, keepVersion: true });
    }
  }
  if (def.key === "journey_template_activity") {
    // a changed activity is a new version of the template; journeys started before keep the plan they were given
    const tid = String(row.template_id ?? w.prev?.template_id ?? "");
    if (isUuid(tid)) {
      onBeforeCommit(tx, `esm.template_version:${tid}`, async () => {
        const t = await liveRow(tx, sys, "journey_template", tid);
        if (t) await updateIn(tx, sys, "journey_template", tid, { template_version: Number(t.template_version ?? 1) + 1 }, { trusted: true, keepVersion: true });
      });
    }
  }
}

// ----- department cases ----------------------------------------------------------------------------------------------

/** The service, department and workspace a department record belongs to (the department's workspace, always). */
async function placeOf(tx: Tx, ctx: Ctx, table: string, next: Row, prev: Row | null): Promise<{ service: Row | null; dept: Row | null }> {
  const sys = sysOf(ctx);
  let service: Row | null = null;
  if (isUuid(next.dept_service_id)) {
    service = await liveRow(tx, sys, "esm_service", next.dept_service_id);
    if (!service) throw validationError({ dept_service_id: "این خدمت پیدا نشد" });
    if (service.case_table !== table) throw validationError({ dept_service_id: `خدمت «${service.name}» پروندهٔ نوع دیگری می‌سازد` });
  }
  const changedService = !prev || prev.dept_service_id !== next.dept_service_id;
  const deptId = (changedService && service?.department_id) || next.department_id || prev?.department_id || service?.department_id || null;
  const dept = (await departmentById(tx, ctx, deptId)) ?? (await defaultDepartment(tx, ctx, table));
  if (service && dept && service.department_id !== dept.id) throw validationError({ dept_service_id: `خدمت «${service.name}» از واحد دیگری است؛ برای جابه‌جایی پرونده «انتقال به واحد دیگر» را به کار ببرید` });
  return { service, dept };
}

async function caseBefore(w: WriteArgs): Promise<void> {
  const { ctx, tx, def, next, prev, op } = w;
  if (op === "delete") return;
  const { service, dept } = await placeOf(tx, ctx, def.key, next, prev);
  // the workspace is the department's — a person never sets or moves it, not by naming another department's service
  // either (a move is «انتقال», a trusted write; a Windows app's push is held to the same rule)
  if (prev && !w.trusted && !isSystemCtx(ctx)) {
    const edited = (w.changed.has("workspace_id") || w.changed.has("department_id")) && (next.workspace_id !== prev.workspace_id || next.department_id !== prev.department_id);
    const elsewhere = !!dept && isUuid(prev.department_id) && String(dept.id) !== String(prev.department_id);
    if (edited || elsewhere) throw forbidden("پرونده با «انتقال به واحد دیگر» به واحد دیگری می‌رود");
  }
  if (dept) {
    next.department_id = dept.id;
    next.workspace_id = dept.dept_workspace_id ?? null;
  }
  const isNew = op === "create";
  const given = (f: string) => !!w.input?.has(f);
  if (service && (isNew || w.changed.has("dept_service_id"))) {
    if (service.active === false && !w.trusted) throw validationError({ dept_service_id: `خدمت «${service.name}» فعال نیست` });
    if (service.priority && !given("priority")) next.priority = String(service.priority);
    if (service.case_category && !next.category) {
      const options = (await orgSchema(ctx, tx)).choices(`${def.key}.category`);
      if (options.some((o) => o.value === service.case_category)) next.category = service.case_category;
    }
    if (def.fields.some((f) => f.name === "confidential") && service.confidential && !given("confidential")) next.confidential = true;
    if (def.key === "hr_case" && !given("subject_visible")) next.subject_visible = service.subject_visible !== false;
    // who may file for whom (ESM-006): the access model already limits requesters to themselves and their people
    if (isNew && !w.trusted && !isSystemCtx(ctx)) {
      const forWhom = String(next.requested_for ?? "");
      if (isUuid(forWhom) && forWhom !== ctx.user.id && service.on_behalf === "self") throw validationError({ requested_for: `«${service.name}» را هر کس فقط برای خودش ثبت می‌کند` });
    }
  }
  // masked notifications follow the service or the department (a read-only flag people never set)
  if (isNew || w.changed.has("dept_service_id")) next.sensitive = !!(service?.sensitive || dept?.sensitive);
  const cfg = await esmConfig(tx, ctx);
  next.title = caseTitle(next.short_description, !!next.sensitive, cfg.masked_title);
  if (def.key === "hr_case") {
    next.subject_readers = next.subject_visible !== false && isUuid(next.subject_person_id) ? [String(next.subject_person_id).toLowerCase()] : [];
    if (next.confidentiality && next.confidentiality !== "normal") next.confidential = true;
  }
  if (def.key === "legal_request" && next.privileged) next.confidential = true;
  if (def.key === "purchase_request" && isUuid(next.receiver_id) && [next.requested_for, next.caller_id, next.opened_by].map((x) => String(x ?? "")).includes(String(next.receiver_id))) {
    throw validationError({ receiver_id: "تحویل‌گیرنده نباید همان درخواست‌کننده باشد (تفکیک وظایف)" });
  }
  // a secure department's case is followed only by its members and the case's own people
  if (dept && !isSystemCtx(ctx) && !w.trusted && (w.changed.has("watch_list") || w.changed.has("access_list")) && (await isSecureWorkspace(tx, ctx, dept.dept_workspace_id))) {
    const own = new Set(ids([next.caller_id, next.requested_for, next.opened_by, next.assigned_to, next.subject_person_id]));
    const before = new Set(ids([...((prev?.watch_list as string[]) ?? []), ...((prev?.access_list as string[]) ?? [])]));
    const added = ids([...((next.watch_list as string[]) ?? []), ...((next.access_list as string[]) ?? [])]).filter((u) => !before.has(u) && !own.has(u));
    if (added.length) {
      const members = await workspaceMembersOf(tx, ctx, String(dept.dept_workspace_id), added);
      if (added.some((u) => !members.has(u))) throw forbidden(`پرونده‌های «${dept.name}» را فقط اعضای همین واحد پیگیری می‌کنند`);
    }
  }
}

async function caseAfter(w: WriteArgs & { row: Row }): Promise<void> {
  const { ctx, tx, def, row, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  // routing: the service's group, else the department's default group — as the department's intake
  if (!row.assignment_group_id && (op === "create" || w.changed.has("dept_service_id"))) {
    const service = isUuid(row.dept_service_id) ? await liveRow(tx, sys, "esm_service", row.dept_service_id) : null;
    const dept = await departmentById(tx, ctx, row.department_id);
    const group = service?.group_id ?? dept?.default_group_id ?? null;
    if (group) await updateIn(tx, sys, def.key, String(row.id), { assignment_group_id: group }, { trusted: true, keepVersion: true });
  }
}

/**
 * Derived columns of a pushed case (the cloud's own, never the push's): a stored case keeps its department and
 * workspace (only the trusted «انتقال» moves a case); a new one gets its service's or table's department; masking
 * and confidentiality follow the service, the department, HR confidentiality and legal privilege.
 */
async function caseOnPush(p: PushArgs): Promise<Row> {
  const { tx, ctx, def, next, prev } = p;
  const sys = sysOf(ctx);
  const serviceChanged = !prev || String(prev.dept_service_id ?? "") !== String(next.dept_service_id ?? "");
  const service = isUuid(next.dept_service_id) ? await liveRow(tx, sys, "esm_service", next.dept_service_id) : null;
  let dept: Row | null;
  if (prev) dept = await departmentById(tx, ctx, prev.department_id);
  else dept = await placeOf(tx, ctx, def.key, next, null).then((x) => x.dept).catch(() => defaultDepartment(tx, ctx, def.key));
  const cfg = await esmConfig(tx, ctx);
  const out: Row = prev
    ? { department_id: prev.department_id ?? null, workspace_id: prev.workspace_id ?? null }
    : { department_id: dept?.id ?? null, workspace_id: dept?.dept_workspace_id ?? null };
  out.sensitive = prev && !serviceChanged ? !!prev.sensitive : !!(service?.sensitive || dept?.sensitive);
  if (def.fields.some((f) => f.name === "confidential")) {
    out.confidential =
      !!next.confidential || (serviceChanged && !!service?.confidential) || (def.key === "hr_case" && !!next.confidentiality && next.confidentiality !== "normal") || (def.key === "legal_request" && !!next.privileged);
  }
  out.title = caseTitle(next.short_description, !!out.sensitive, cfg.masked_title);
  if (def.key === "hr_case") out.subject_readers = next.subject_visible !== false && isUuid(next.subject_person_id) ? [String(next.subject_person_id)] : [];
  return out;
}

// ----- HR tasks, profiles, notes ------------------------------------------------------------------------------------

/** The HR department's workspace (null when the organisation has none yet). */
async function hrWorkspace(tx: Tx, ctx: Ctx): Promise<string | null> {
  return ((await defaultDepartment(tx, ctx, "hr_case"))?.dept_workspace_id as string) ?? null;
}

/** What an HR task is, whose it is and where it points: HR sets them; the person who does it fills it in and finishes it. */
const HR_TASK_LOCKED = ["type", "hr_case_id", "journey_id", "document_url", "assigned_to"];

async function hrTaskBefore(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, prev, op } = w;
  if (op === "delete") return;
  const sys = sysOf(ctx);
  const person = !w.trusted && !isSystemCtx(ctx);
  if (prev && person && HR_TASK_LOCKED.some((f) => w.changed.has(f)) && !(await hrStaff(tx, ctx))) {
    throw forbidden("نوع، انجام‌دهنده، پرونده، سفر یا سند کار منابع انسانی را فقط کارشناسان منابع انسانی تغییر می‌دهند");
  }
  if (op === "create" || w.changed.has("hr_case_id") || w.changed.has("journey_id")) {
    const parent = isUuid(next.hr_case_id) ? await liveRow(tx, sys, "hr_case", next.hr_case_id) : isUuid(next.journey_id) ? await liveRow(tx, sys, "journey", next.journey_id) : null;
    if (person) {
      if (parent) {
        // a task on someone's case or journey is given by someone who works it (its requester only follows it)
        if (!(await mayWorkRecord(tx, ctx, isUuid(next.hr_case_id) ? "hr_case" : "journey", parent.id))) throw forbidden("کار منابع انسانی را کسی می‌دهد که پرونده یا سفر را پیگیری می‌کند");
      } else if (!(await hrWorksGroup(tx, ctx, next.assignment_group_id))) {
        throw forbidden("کار منابع انسانی بی پرونده یا سفر را فقط کارشناسان منابع انسانی همان گروه می‌دهند");
      }
    }
    next.workspace_id = parent?.workspace_id ?? (await hrWorkspace(tx, ctx));
    if (parent && !next.assignment_group_id) next.assignment_group_id = parent.assignment_group_id ?? null;
    if (parent && isUuid(next.journey_id)) next.case_readers = ids([parent.subject_person_id, parent.manager_id]);
  } else if (prev) next.workspace_id = prev.workspace_id;
  if (w.transition?.to === "done" || (op === "update" && w.changed.has("state") && next.state === "done")) {
    next.done_at = new Date().toISOString();
    if (next.signed_name && !prev?.signed_at) next.signed_at = new Date().toISOString();
  }
}

/** Skipping, failing or reopening HR work is HR's (the person who must do it cannot excuse themselves). */
export async function hrStaffOnly(w: WriteArgs): Promise<string | null> {
  if (w.trusted || isSystemCtx(w.ctx)) return null;
  return (await hrStaff(w.tx, w.ctx)) ? null : `«${w.transition?.label ?? "این گام"}» با کارشناسان منابع انسانی است`;
}

async function hrTaskDone(w: WriteArgs): Promise<string | null> {
  const { next, tx, ctx } = w;
  switch (next.type) {
    case "sign":
      return String(next.signed_name ?? "").trim().length >= 3 ? null : "برای امضای سند نام کامل خود را در «نام امضاکننده» بنویسید";
    case "acknowledge":
      return next.acknowledged === true ? null : "«خواندم و پذیرفتم» را بزنید";
    case "form":
    case "survey":
      return String(next.response ?? "").trim() ? null : "پاسخ را بنویسید";
    case "upload": {
      const n = await tx.one<{ n: string | number }>(`select count(*) as n from sm_attachments where org_id = $1 and table_key = 'hr_task' and record_id = $2 and deleted_at is null`, [ctx.org.id, String(next.id)]);
      return Number(n?.n ?? 0) > 0 ? null : "مدرک را پیوست کنید";
    }
    default:
      return null;
  }
}

async function profileBefore(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, op } = w;
  if (op === "delete") return;
  if (op === "create" || w.changed.has("user_id")) {
    const u = isUuid(next.user_id) ? await tx.one<{ name: string }>(`select coalesce(nullif(full_name, ''), email) as name from sm_users where id = $1`, [String(next.user_id)]) : null;
    next.name = u?.name ?? null;
  }
  next.workspace_id = await hrWorkspace(tx, ctx);
  if (!next.hr_group_id) next.hr_group_id = ((await defaultDepartment(tx, ctx, "hr_case"))?.default_group_id as string) ?? null;
}

async function noteBefore(w: WriteArgs): Promise<void> {
  const { ctx, tx, next, op, prev } = w;
  if (op === "delete") {
    if (prev?.legal_hold && !isSystemCtx(ctx)) throw forbidden("یادداشت زیر نگهداری قانونی حذف نمی‌شود");
    return;
  }
  const sys = sysOf(ctx);
  const hrCase = await liveRow(tx, sys, "hr_case", next.hr_case_id);
  if (!hrCase) throw validationError({ hr_case_id: "پرونده پیدا نشد" });
  if (op === "create" && !w.trusted && !isSystemCtx(ctx) && !(await mayWorkRecord(tx, ctx, "hr_case", hrCase.id))) throw forbidden("یادداشت روابط کار را کسی می‌نویسد که پرونده را پیگیری می‌کند");
  if (op === "create" && !isSystemCtx(ctx)) next.author_id = ctx.user.id;
  if (prev?.legal_hold && w.changed.has("body") && !isSystemCtx(ctx)) throw forbidden("یادداشت زیر نگهداری قانونی تغییر نمی‌کند");
  next.workspace_id = hrCase.workspace_id ?? null;
}

/**
 * Separation of duties on purchases (ESM-041): the approvals service keeps the requester side and the assignee from
 * approving; the receiver of the goods is kept from deciding here (a decision of theirs is refused, another approver
 * of the level decides).
 */
async function purchaseDecision(w: WriteArgs): Promise<void> {
  const { next, prev, op, tx, ctx } = w;
  if (op !== "update" || !prev || next.table_key !== "purchase_request" || !w.changed.has("state") || !["approved", "rejected"].includes(String(next.state)) || !isUuid(next.decided_by)) return;
  const rec = await liveRow(tx, sysOf(ctx), "purchase_request", next.record_id);
  if (rec?.receiver_id && String(rec.receiver_id) === String(next.decided_by)) throw forbidden("تحویل‌گیرندهٔ خرید آن را تأیید یا رد نمی‌کند (تفکیک وظایف)");
}

// ----- install --------------------------------------------------------------------------------------------------------

export function installEsmHooks(): (() => void)[] {
  const offs: (() => void)[] = [];
  for (const t of ["esm_department", "esm_service", "journey_template", "journey_template_activity"]) {
    offs.push(registerHooks(t, { beforeWrite: configBefore, afterWrite: configAfter, derivePush: (p) => adminsCopy(p.tx, p.ctx, p.def.key, p.next), validatePush: pushGuard(configBefore) }));
  }
  for (const t of DEPT_TABLES) {
    // a Windows app's push keeps the department (derivePush) and is held to the API's rules: no move by another
    // department's service, active services only, who may file for whom, separation of duties on purchases, a
    // secure department's watchers
    offs.push(registerHooks(t, { beforeWrite: caseBefore, afterWrite: caseAfter, derivePush: caseOnPush, validatePush: pushGuard(caseBefore) }));
  }
  offs.push(
    registerHooks("hr_task", { beforeWrite: hrTaskBefore, validatePush: pushGuard(hrTaskBefore), guards: { hr_task_done: hrTaskDone, hr_staff: hrStaffOnly } }),
    registerHooks("hr_profile", { beforeWrite: profileBefore }),
    registerHooks("approval", { beforeWrite: purchaseDecision }),
    registerHooks("hr_case_note", { beforeWrite: noteBefore, validatePush: pushGuard(async (w) => { if (w.prev?.legal_hold && w.changed.has("body")) throw forbidden("یادداشت زیر نگهداری قانونی تغییر نمی‌کند"); }) }),
  );
  return offs;
}

/** The department kind of a case table (for routes that need it). */
export const kindOfTable = (table: string): string | null => (isEsmCaseTable(table) || table === "hse_event" ? CASE_TABLE_KIND[table] ?? null : null);
