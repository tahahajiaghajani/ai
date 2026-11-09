// Department cases across departments:
//   · routing (ESM-009): the employee need not know which department owns their need — services ranked for what
//     they wrote, only of live departments and only those whose audience (HR criteria on the employment profile)
//     includes them
//   · transfer (ESM-009): an agent moves a case to another department — the same table re-keyed to the new
//     department's workspace, or a new case of the other department's type with the fields mapped, both linked
//     («منتقل‌شده از/به») and noted in both histories; the old case closes
//   · cross-department child work (ESM-010): one case spawns cases in other departments (each with its own OLA and
//     access, created for the agent so the employee follows only the parent); the parent counts its open children and
//     carries on when the last one is done
//   · the requester's answer to «منتظر اطلاعات» moves the case on; resolved cases close after the configured days
//   · the department's home (signature screen): its queues and figures as the caller reads them
import { evaluate, type Cond } from "@shared/model/conditions";
import { stateCategory } from "@shared/model/task";
import { rankServices } from "@shared/esm/logic";
import { tableDef } from "@shared/tables";
import { CASE_TABLE_OPTIONS, isEsmCaseTable } from "@shared/tables/esm";
import type { Ctx } from "../../context";
import type { Queryable, Tx } from "../../db";
import { addJournalIn, addLinkIn, aggregate, condEnv, createIn, get, list, orgSchema, transitionIn, updateIn, validationError } from "../../engine";
import { bad, forbidden, notFound } from "../../http/errors";
import { DEPT_TABLES } from "./hooks";
import { administersDepartment, departmentById, departments, esmConfig, isUuid, liveRow, liveRows, mayWriteRecord, myDepartments, sysOf, type Row } from "./common";

const OPEN = ["new", "active", "waiting"];

/** Does the person's employment profile fall in the service's audience (no audience: everyone)? */
export async function inAudience(q: Queryable, ctx: Ctx, audience: unknown, userId: string): Promise<boolean> {
  if (!audience || typeof audience !== "object" || !Object.keys(audience as object).length) return true;
  const sys = sysOf(ctx);
  const [profile] = await liveRows(q, sys, "hr_profile", { and: [{ f: "user_id", op: "eq", v: userId }] }, { limit: 1 });
  const schema = await orgSchema(sys, q);
  try {
    return evaluate(audience as Cond, profile ?? {}, await condEnv(sys), schema.def("hr_profile") ?? tableDef("hr_profile")!, schema.lookup);
  } catch {
    return false;
  }
}

/** The services of live departments shown in the portal that `userId` may use. */
export async function servicesFor(q: Queryable, ctx: Ctx, userId: string): Promise<{ services: Row[]; departments: Row[] }> {
  const sys = sysOf(ctx);
  const depts = (await departments(q, ctx)).filter((d) => d.status === "live" && d.portal_visible !== false);
  const ids = new Set(depts.map((d) => String(d.id)));
  const all = (await liveRows(q, sys, "esm_service", { and: [{ f: "active", op: "eq", v: true }] }, { order: "t.sort_order, t.name", limit: 2000 })).filter((s) => ids.has(String(s.department_id)));
  const services: Row[] = [];
  for (const s of all) if (await inAudience(q, ctx, s.audience, userId)) services.push(s);
  return { services, departments: depts };
}

/** Services ranked for a sentence, with their departments (ESM-009). */
export async function routeText(ctx: Ctx, text: string): Promise<Row> {
  const t = String(text ?? "").trim().slice(0, 500);
  if (!t) return { matches: [] };
  const { services, departments: depts } = await servicesFor(ctx.db, ctx, ctx.user.id);
  const byId = new Map(depts.map((d) => [String(d.id), d]));
  const ranked = rankServices(t, services.map((s) => ({ ...(s as Row), id: String(s.id), name: String(s.name), department_id: String(s.department_id), keywords: (s.keywords as string[]) ?? [] }) as Row & { id: string; name: string; department_id: string; keywords: string[] }), 6);
  return {
    matches: ranked.map(({ service: s, score }) => ({
      score, service: { id: s.id, name: s.name, category: s.category ?? null, description: s.description ?? null, case_table: s.case_table, catalog_item_id: s.catalog_item_id ?? null, icon: s.icon ?? null },
      department: { id: s.department_id, name: byId.get(String(s.department_id))?.name ?? "", key: byId.get(String(s.department_id))?.key ?? "" },
    })),
  };
}

const MAPPED = ["short_description", "description", "requested_for", "caller_id", "priority", "urgency", "impact", "location_id", "channel"];

/** Move a case to another department (ESM-009): re-key it, or hand it over as a new case of that department's type. */
export async function transferCase(ctx: Ctx, table: string, id: string, input: { department_id?: unknown; service_id?: unknown; note?: unknown }): Promise<Row> {
  if (!isEsmCaseTable(table)) throw notFound("این نوع رکورد پروندهٔ واحد نیست");
  const note = String(input.note ?? "").trim().slice(0, 2000);
  if (!note) throw validationError({ note: "دلیل انتقال را بنویسید" });
  return ctx.write(async (tx) => {
    const sys = sysOf(ctx);
    if (!(await mayWriteRecord(tx, ctx, table, id))) throw forbidden("پرونده را کسی منتقل می‌کند که روی آن کار می‌کند");
    const row = await liveRow(tx, sys, table, id);
    if (!row) throw notFound("پرونده پیدا نشد");
    if (!OPEN.includes(String(stateCategory(tableDef(table)?.states, row.state)))) throw bad("پروندهٔ بسته منتقل نمی‌شود");
    const dept = await departmentById(tx, ctx, input.department_id);
    if (!dept || dept.status === "retired") throw validationError({ department_id: "واحد مقصد پیدا نشد" });
    const service = isUuid(input.service_id) ? await liveRow(tx, sys, "esm_service", input.service_id) : null;
    if (service && service.department_id !== dept.id) throw validationError({ service_id: "این خدمت از واحد مقصد نیست" });
    const target = String(service?.case_table ?? dept.case_table ?? table);
    if (!isEsmCaseTable(target)) throw validationError({ department_id: "نوع پروندهٔ واحد مقصد معتبر نیست" });
    const fromDept = await departmentById(tx, ctx, row.department_id);
    const line = `از «${fromDept?.name ?? "واحد پیشین"}» به «${dept.name}» منتقل شد: ${note}`;
    const actor = sysOf(ctx, ctx.user.id);
    if (target === table) {
      if (row.department_id === dept.id && (!service || service.id === row.dept_service_id)) throw bad("پرونده همین حالا در این واحد است");
      await updateIn(tx, actor, table, id, { department_id: dept.id, dept_service_id: service?.id ?? null, assignment_group_id: service?.group_id ?? dept.default_group_id ?? null, assigned_to: null }, { trusted: true });
      await addJournalIn(tx, actor, tableDef(table)!, row, { kind: "system", body: line }, { trusted: true });
      return { table, id, number: row.number ?? null, moved: true };
    }
    const values: Row = { department_id: dept.id, dept_service_id: service?.id ?? null };
    const tdef = tableDef(target)!;
    for (const f of MAPPED) if (row[f] !== undefined && row[f] !== null && tdef.fields.some((x) => x.name === f)) values[f] = row[f];
    values.description = `${row.description ?? ""}\n\n— منتقل‌شده از ${row.number ?? ""}: ${note}`.trim();
    const made = await createIn(tx, actor, target, values, { trusted: true });
    await addLinkIn(tx, actor, target, String(made.id), { kind: "esm_transfer", table, id, note });
    await addJournalIn(tx, actor, tableDef(table)!, row, { kind: "system", body: `${line} — پروندهٔ تازه: ${made.number ?? ""}` }, { trusted: true });
    await transitionIn(tx, actor, table, id, "closed_incomplete", { close_notes: `منتقل شد به «${dept.name}» (${made.number ?? ""}): ${note}`.slice(0, 2000) }, { trusted: true });
    return { table: target, id: String(made.id), number: made.number ?? null, moved: false };
  });
}

/** A case of another department working for this one (ESM-010); the parent's requester keeps following the parent. */
export async function childCase(ctx: Ctx, table: string, id: string, input: { department_id?: unknown; service_id?: unknown; short_description?: unknown; description?: unknown }): Promise<Row> {
  if (!isEsmCaseTable(table)) throw notFound("این نوع رکورد پروندهٔ واحد نیست");
  const title = String(input.short_description ?? "").trim().slice(0, 200);
  if (!title) throw validationError({ short_description: "عنوان کار را بنویسید" });
  return ctx.write(async (tx) => {
    const sys = sysOf(ctx);
    if (!(await mayWriteRecord(tx, ctx, table, id))) throw forbidden("کار واحد دیگر را کسی می‌سازد که روی پرونده کار می‌کند");
    const parent = await liveRow(tx, sys, table, id);
    if (!parent) throw notFound("پرونده پیدا نشد");
    const dept = await departmentById(tx, ctx, input.department_id);
    if (!dept || dept.status === "retired") throw validationError({ department_id: "واحد مقصد پیدا نشد" });
    const service = isUuid(input.service_id) ? await liveRow(tx, sys, "esm_service", input.service_id) : null;
    if (service && service.department_id !== dept.id) throw validationError({ service_id: "این خدمت از واحد مقصد نیست" });
    const target = String(service?.case_table ?? dept.case_table);
    if (!isEsmCaseTable(target)) throw validationError({ department_id: "نوع پروندهٔ واحد مقصد معتبر نیست" });
    const actor = sysOf(ctx, ctx.user.id);
    const child = await createIn(tx, actor, target, {
      short_description: title, description: `${String(input.description ?? "").trim()}\n\nبرای پروندهٔ ${parent.number ?? ""}`.trim(),
      caller_id: ctx.user.id, requested_for: ctx.user.id, department_id: dept.id, dept_service_id: service?.id ?? null, priority: parent.priority ?? null,
    }, { trusted: true });
    await addLinkIn(tx, actor, target, String(child.id), { kind: "esm_child", table, id });
    await rollupChildrenIn(tx, ctx, table, id);
    return { table: target, id: String(child.id), number: child.number ?? null };
  });
}

/** Count a case's open children in other departments; when the last one is done, the parent carries on. */
export async function rollupChildrenIn(tx: Tx, ctx: Ctx, table: string, id: string): Promise<{ total: number; open: number }> {
  const sys = sysOf(ctx);
  const links = await tx.query<{ from_table: string; from_id: string }>(`select from_table, from_id from sm_links where org_id = $1 and kind = 'esm_child' and to_table = $2 and to_id = $3 and deleted_at is null`, [ctx.org.id, table, id]);
  let open = 0;
  for (const l of links) {
    const r = await liveRow(tx, sys, l.from_table, l.from_id);
    if (r && OPEN.includes(String(stateCategory(tableDef(l.from_table)?.states, r.state)))) open++;
  }
  const parent = await liveRow(tx, sys, table, id);
  if (!parent) return { total: links.length, open };
  const before = Number(parent.child_open ?? 0);
  if (Number(parent.child_total ?? 0) !== links.length || before !== open) {
    await updateIn(tx, sys, table, id, { child_total: links.length, child_open: open }, { trusted: true, keepVersion: true });
  }
  if (before > 0 && open === 0 && links.length > 0) {
    await addJournalIn(tx, sys, tableDef(table)!, parent, { kind: "system", body: "همهٔ کارهای واحدهای دیگر برای این پرونده انجام شد" }, { trusted: true });
    if (parent.state === "awaiting_third_party") await transitionIn(tx, sys, table, id, "in_progress", {}, { trusted: true });
  }
  return { total: links.length, open };
}

/** The parents of a child case (its «کار واحد دیگر برای» links). */
export async function parentsOf(q: Queryable, orgId: string, table: string, id: string): Promise<{ table: string; id: string }[]> {
  const rows = await q.query<{ to_table: string; to_id: string }>(`select to_table, to_id from sm_links where org_id = $1 and kind = 'esm_child' and from_table = $2 and from_id = $3 and deleted_at is null`, [orgId, table, id]);
  return rows.map((r) => ({ table: r.to_table, id: r.to_id }));
}

/** Resolved cases left unconfirmed close after the configured days (their requester was told when they were resolved). */
export async function autoCloseIn(tx: Tx, ctx: Ctx, limit = 200): Promise<number> {
  const sys = sysOf(ctx);
  const cfg = await esmConfig(tx, ctx);
  const before = new Date(Date.now() - Math.max(1, cfg.auto_close_days) * 86_400_000).toISOString();
  let n = 0;
  for (const table of DEPT_TABLES) {
    const rows = await liveRows(tx, sys, table, { and: [{ f: "state", op: "eq", v: "resolved" }, { f: "resolved_at", op: "lt", v: before }] }, { limit });
    for (const r of rows) {
      await transitionIn(tx, sys, table, String(r.id), "closed_complete", {}, { trusted: true });
      await addJournalIn(tx, sys, tableDef(table)!, r, { kind: "system", body: `پس از ${cfg.auto_close_days} روز بی‌پاسخ، پرونده بسته شد` }, { trusted: true });
      n++;
    }
  }
  return n;
}

// ----- the department's home (signature screen) -------------------------------------------------------------------------

const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await f();
  } catch {
    return fallback;
  }
};

/** A department's workspace home: its case tables' queues and figures, services, journeys and knowledge — as the caller reads them. */
export async function departmentHome(ctx: Ctx, key: string): Promise<Row> {
  const all = await departments(ctx.db, ctx);
  const dept = all.find((d) => d.key === key || d.id === key);
  if (!dept) throw notFound("واحد پیدا نشد");
  const mine = await myDepartments(ctx.db, ctx);
  const admin = await administersDepartment(ctx.db, ctx, dept);
  if (!admin && !mine.some((d) => d.id === dept.id)) throw forbidden(`عضو فضای کاری «${dept.name}» نیستید`);
  const sys = sysOf(ctx);
  const services = await liveRows(ctx.db, sys, "esm_service", { and: [{ f: "department_id", op: "eq", v: dept.id }] }, { order: "t.sort_order, t.name", limit: 500 });
  const tables = [...new Set([String(dept.case_table), ...services.map((s) => String(s.case_table)), ...(dept.kind === "facilities" ? ["hse_event"] : [])])].filter((t) => DEPT_TABLES.includes(t));
  const inDept: Cond = { f: "department_id", op: "eq", v: dept.id };
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const queues: Row[] = [];
  for (const table of tables) {
    const def = tableDef(table)!;
    const states = await safe(() => aggregate(ctx, table, { filter: inDept, groupBy: ["state"], metrics: [{ fn: "count" }] }), null);
    if (!states) continue;
    const byState = Object.fromEntries(states.rows.map((r) => [String(r.keys[0]), Number(r.values.count ?? 0)]));
    const count = (cats: string[]) => Object.entries(byState).filter(([s]) => cats.includes(String(stateCategory(def.states, s)))).reduce((n, [, c]) => n + c, 0);
    const now = new Date().toISOString();
    const [unassigned, mineOpen, breached, created, resolved, csat] = await Promise.all([
      safe(async () => (await list(ctx, table, { filter: { and: [inDept, { f: "active", op: "eq", v: true }, { f: "assigned_to", op: "empty" }] }, size: 1, fields: ["number"] })).total ?? 0, 0),
      safe(async () => (await list(ctx, table, { filter: { and: [inDept, { f: "active", op: "eq", v: true }, { f: "assigned_to", op: "is_me" }] }, size: 1, fields: ["number"] })).total ?? 0, 0),
      safe(async () => (await list(ctx, table, { filter: { and: [inDept, { f: "active", op: "eq", v: true }, { f: "sla_due", op: "lt", v: now }] }, size: 1, fields: ["number"] })).total ?? 0, 0),
      safe(async () => (await list(ctx, table, { filter: { and: [inDept, { f: "opened_at", op: "gte", v: since }] }, size: 1, fields: ["number"] })).total ?? 0, 0),
      safe(async () => (await list(ctx, table, { filter: { and: [inDept, { f: "resolved_at", op: "gte", v: since }] }, size: 1, fields: ["number"] })).total ?? 0, 0),
      safe(async () => {
        const a = await aggregate(ctx, table, { filter: { and: [inDept, { f: "satisfaction", op: "nempty" }] }, metrics: [{ fn: "avg", field: "satisfaction" }, { fn: "count" }] });
        return { avg: a.totals?.["avg:satisfaction"] ?? null, n: Number(a.totals?.count ?? 0) };
      }, { avg: null as unknown, n: 0 }),
    ]);
    const recent = await safe(async () => (await list(ctx, table, { filter: { and: [inDept, { f: "active", op: "eq", v: true }] }, sort: "-updated_at", size: 8, fields: ["number", "short_description", "title", "state", "priority", "assigned_to", "sla_due", "dept_service_id"] })), null);
    queues.push({
      table, label: def.plural, icon: def.icon,
      open: count(OPEN), new: count(["new"]), waiting: count(["waiting"]), unassigned, mine: mineOpen, breached, created_30d: created, resolved_30d: resolved,
      csat: csat.avg === null || csat.avg === undefined ? null : Number(csat.avg), csat_n: csat.n,
      recent: recent?.rows ?? [], display: recent?.display ?? {},
    });
  }
  const journeys = dept.kind === "hr"
    ? await safe(async () => {
        const r = await list(ctx, "journey", { filter: { f: "state", op: "in", v: ["planned", "active", "waiting"] }, sort: "anchor_date", size: 8, fields: ["number", "name", "type", "state", "anchor_date", "progress", "day_one_ready", "activities_overdue"] });
        return { total: r.total ?? r.rows.length, rows: r.rows, display: r.display };
      }, null)
    : null;
  const kb = isUuid(dept.kb_base_id) ? await safe(async () => (await list(ctx, "kb_article", { filter: { f: "base_id", op: "eq", v: dept.kb_base_id }, size: 1, fields: ["number"] })).total ?? 0, null) : null;
  return {
    department: { id: dept.id, key: dept.key, name: dept.name, kind: dept.kind, status: dept.status, icon: dept.icon ?? null, color: dept.color ?? null, intro: dept.intro ?? null, catalog_id: dept.catalog_id ?? null, kb_base_id: dept.kb_base_id ?? null, case_table: dept.case_table, workspace_id: dept.dept_workspace_id },
    admin,
    queues,
    services: services.map((s) => ({ id: s.id, name: s.name, category: s.category ?? null, case_table: s.case_table, active: s.active !== false, catalog_item_id: s.catalog_item_id ?? null })),
    journeys,
    kb_articles: kb,
    case_tables: CASE_TABLE_OPTIONS.filter((o) => tables.includes(o.value)),
  };
}

/** My departments and the cases I opened in each (the «میز واحدها» list and the portal). */
export async function myOpenCases(ctx: Ctx): Promise<Row[]> {
  const out: Row[] = [];
  for (const table of DEPT_TABLES) {
    const r = await safe(() => list(ctx, table, { filter: { and: [{ or: [{ f: "requested_for", op: "is_me" }, { f: "caller_id", op: "is_me" }] }, { f: "active", op: "eq", v: true }] }, sort: "-updated_at", size: 50, fields: ["number", "title", "state", "department_id", "updated_at", "sla_due"] }), null);
    if (r) for (const row of r.rows) out.push({ ...row, table, table_label: tableDef(table)?.label ?? table, department: r.display[String(row.department_id)] ?? null });
  }
  return out.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export { get };
