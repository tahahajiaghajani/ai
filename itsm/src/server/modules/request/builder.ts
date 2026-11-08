// The catalogue builder's server side (REQ-010, REQ-011, REQ-013, REQ-024, REQ-026): an item's draft with its
// problems, versions, guide rules and the flows and approval rules it may use; an approval rule bound to the item
// (condition «قاعدهٔ تأیید = این قاعده» on requested items, so it applies exactly to the items that name it); a draft
// fulfilment flow bound to the item's code; copying an item with its questions, policies, tasks and guide rules; and
// «چه کسی می‌تواند سفارش دهد» for one person (preview as a persona).
import type { FormSchema } from "@shared/request/form";
import { hasErrors, validateGraph } from "@shared/flows";
import type { Cond } from "@shared/model/conditions";
import type { Ctx } from "../../context";
import { bad, forbidden, notFound } from "../../http/errors";
import { createIn, get, updateIn, validationError } from "../../engine";
import { tableDef } from "@shared/tables";
import { allowed, eqAll, isUuid, liveRow, liveRows, sysOf, type Row } from "./common";
import { draftSchema, itemFor, schemaProblems, type DefinitionProblem } from "./definition";
import { catalogIndex, categoryChain, entitlementFor, memberFacts, onBehalfRefusal } from "./entitlement";
import { displayOf } from "./fulfil";

/** The condition that binds an approval rule to the requested items whose item names it. */
export const boundCondition = (ruleId: string): Cond => ({ f: "approval_rule_id", op: "eq", v: ruleId });

const mentionsRule = (cond: unknown, ruleId: string): boolean => JSON.stringify(cond ?? null).includes(ruleId) && JSON.stringify(cond ?? null).includes("approval_rule_id");

export interface Definition {
  item: Row;
  can_write: boolean;
  schema: FormSchema;
  problems: DefinitionProblem[];
  versions: { id: string; version_no: number; note: string | null; created_by: string | null; created_at: string }[];
  guide_rules: Row[];
  flows: { id: string; name: string; trigger: string; catalog_item: string | null; active: boolean; version_no: number | null; bound: boolean }[];
  approval_rules: { id: string; name: string; active: boolean; bound: boolean }[];
  display: Record<string, string>;
}

/** Everything the builder shows about an item (the caller must read it; `can_write` says whether they may edit). */
export async function definition(ctx: Ctx, id: string): Promise<Definition> {
  const { row, canWrite } = await itemFor(ctx, id);
  const q = ctx.db;
  const sys = sysOf(ctx);
  const full = (await liveRow(q, sys, "catalog_item", id))!;
  const schema = await draftSchema(q, ctx, full);
  const guideRules = full.type === "order_guide" ? await liveRows(q, sys, "order_guide_rule", eqAll({ guide_id: id }), { order: "t.sort_order, t.created_at" }) : [];
  const problems = schemaProblems(schema, { guideRules: full.type === "order_guide" ? guideRules.filter((r) => r.active !== false).length : undefined });
  const rules = await liveRows(q, sys, "approval_rule", eqAll({ table_key: "request_item" }), { order: "t.name" });
  if (full.approval_rule_id) {
    const rule = rules.find((r) => r.id === full.approval_rule_id);
    if (!rule) problems.push({ level: "error", message: "قاعدهٔ تأیید این قلم پیدا نشد یا برای اقلام درخواست‌شده نیست" });
    else if (!mentionsRule(rule.condition, String(rule.id))) problems.push({ level: "warning", message: `شرط قاعدهٔ تأیید «${rule.name}» به این قلم بسته نیست؛ ممکن است برای اقلام دیگر هم اعمال شود یا اصلاً اعمال نشود` });
    else if (rule.active === false) problems.push({ level: "warning", message: `قاعدهٔ تأیید «${rule.name}» غیرفعال است؛ سفارش‌ها بی‌تأیید انجام می‌شوند` });
  }
  const flows = await liveRows(q, sys, "flow", { f: "trigger", op: "in", v: ["catalog", "manual"] }, { order: "t.name" });
  if (full.flow_id && !flows.some((f) => f.id === full.flow_id)) problems.push({ level: "error", message: "گردش‌کار انجام این قلم پیدا نشد" });
  const own = flows.find((f) => f.id === full.flow_id);
  if (own && (!own.active || !own.version_id)) problems.push({ level: "warning", message: `گردش‌کار «${own.name}» ${own.version_id ? "غیرفعال" : "منتشرنشده"} است؛ قلم بدون آن انجام می‌شود` });
  const versions = await liveRows(q, sys, "catalog_item_version", eqAll({ item_id: id }), { order: "t.version_no desc", limit: 50 });
  return {
    item: row,
    can_write: canWrite,
    schema,
    problems,
    versions: versions.map((v) => ({ id: String(v.id), version_no: Number(v.version_no), note: (v.note as string) ?? null, created_by: (v.created_by as string) ?? null, created_at: String(v.created_at) })),
    guide_rules: guideRules,
    flows: flows.map((f) => ({
      id: String(f.id), name: String(f.name), trigger: String(f.trigger), catalog_item: (f.catalog_item as string) ?? null, active: !!f.active,
      version_no: f.version_no === null || f.version_no === undefined ? null : Number(f.version_no),
      bound: f.id === full.flow_id || (f.trigger === "catalog" && !!full.code && f.catalog_item === full.code),
    })),
    approval_rules: rules.map((r) => ({ id: String(r.id), name: String(r.name), active: r.active !== false, bound: mentionsRule(r.condition, String(r.id)) })),
    display: await displayOf(q, ctx, versions.map((v) => ["user", v.created_by] as [string, unknown])),
  };
}

/**
 * A new approval rule for the item (levels from the builder, default the requester's manager), bound to the
 * requested items that name it, and set as the item's rule. The caller needs the right to create approval rules.
 */
export async function bindApprovalRule(ctx: Ctx, id: string, input: { name?: string; mode?: string; levels?: unknown; expire_after?: number | null; remind_every?: number | null }): Promise<Row> {
  const { row } = await itemFor(ctx, id, true);
  const def = tableDef("approval_rule");
  if (!def || !(await allowed(ctx, "approval_rule", "create"))) throw forbidden("اجازهٔ ساختن قاعدهٔ تأیید را ندارید");
  const levels = Array.isArray(input.levels) && input.levels.length ? input.levels : [{ name: "مدیر درخواست‌کننده", sources: [{ kind: "manager" }], rule: "any" }];
  return ctx.write(async (tx) => {
    const rule = await createIn(tx, ctx, "approval_rule", {
      name: (input.name?.trim() || `تأیید «${row.name}»`).slice(0, 120),
      table_key: "request_item",
      mode: input.mode === "parallel" ? "parallel" : "sequential",
      levels,
      ...(input.expire_after ? { expire_after: input.expire_after } : {}),
      ...(input.remind_every ? { remind_every: input.remind_every } : {}),
      active: true,
      description: `تأیید سفارش‌های «${row.name}» (${row.code})`,
    });
    const bound = await updateIn(tx, ctx, "approval_rule", String(rule.id), { condition: boundCondition(String(rule.id)) });
    await updateIn(tx, ctx, "catalog_item", id, { approval_rule_id: rule.id });
    return bound;
  });
}

/** Bind an existing approval rule to the requested items that name it (its condition becomes the binding). */
export async function bindExistingRule(ctx: Ctx, id: string, ruleId: string): Promise<Row> {
  await itemFor(ctx, id, true);
  if (!isUuid(ruleId)) throw notFound("قاعدهٔ تأیید پیدا نشد");
  const rule = (await get(ctx, "approval_rule", ruleId)).row as Row;
  if (rule.table_key !== "request_item") throw validationError({ approval_rule_id: "این قاعده برای اقلام درخواست‌شده نیست" });
  return ctx.write(async (tx) => {
    if (!mentionsRule(rule.condition, ruleId)) {
      const cond = rule.condition && Object.keys(rule.condition as object).length ? { and: [rule.condition as Cond, boundCondition(ruleId)] } : boundCondition(ruleId);
      await updateIn(tx, ctx, "approval_rule", ruleId, { condition: cond });
    }
    return updateIn(tx, ctx, "catalog_item", id, { approval_rule_id: ruleId });
  });
}

/** A draft fulfilment flow bound to the item's code (one task for the item's group), opened in the designer next. */
export async function createFlow(ctx: Ctx, id: string): Promise<Row> {
  const { row } = await itemFor(ctx, id, true);
  const def = tableDef("flow");
  if (!def || !(await allowed(ctx, "flow", "create"))) throw forbidden("اجازهٔ ساختن گردش‌کار را ندارید");
  const graph = fulfilmentGraph([{ title: "انجام {{trigger.record.short_description}}", group: (row.fulfilment_group_id as string) ?? null }]);
  if (hasErrors(validateGraph(graph, { trigger: { kind: "catalog", table: "request_item", run_as: "trigger_user" } }))) throw bad("طرح پیش‌فرض گردش‌کار معتبر نیست");
  return ctx.write(async (tx) => {
    let name = `انجام: ${row.name}`.slice(0, 110);
    const same = await liveRows(tx, sysOf(ctx), "flow", eqAll({ name }), { limit: 1 });
    if (same.length) name = `${name} (${row.code})`.slice(0, 120);
    const flow = await createIn(tx, ctx, "flow", {
      name, active: false, description: `انجام سفارش‌های «${row.name}»`, trigger: "catalog", trigger_table: "request_item",
      catalog_item: row.code, run_as: "trigger_user", graph,
    });
    await updateIn(tx, ctx, "catalog_item", id, { flow_id: flow.id });
    return flow;
  });
}

export interface TaskStep {
  title: string;
  group?: string | null;
  instructions?: string | null;
  requester_visible?: boolean;
  /** create the task only when this answer (by name) is truthy / equals `equals` */
  when?: { answer: string; equals?: string } | null;
}

/**
 * A fulfilment graph: one «ساخت رکورد» step per task, each after the previous one (the task waits for the one before
 * it: `depends_on`); the module delivers the item once the tasks are done and the run ended. A step with `when` sits
 * behind a branch on the answers (`{{trigger.inputs.<name>}}`) whose «نه» path skips it; both paths flow on into the
 * next step. Optional: a notification to the requester, and delivery by the flow itself (zero-touch items).
 */
export function fulfilmentGraph(steps: TaskStep[], extra: { notify?: { subject: string; body: string } | null; deliver?: boolean } = {}) {
  const nodes: Row[] = [{ id: "trigger", type: "trigger", config: {}, position: { x: 0, y: 0 } }];
  const edges: Row[] = [];
  let frontier: [string, string][] = [["trigger", "out"]];
  let lastTask: string | null = null;
  let y = 120;
  const enter = (target: string) => {
    for (const [source, port] of frontier) edges.push({ id: `${source}-${port}-${target}`, source, target, ...(port !== "out" ? { port } : {}) });
  };
  const add = (node: Row) => {
    nodes.push({ ...node, position: { x: 0, y } });
    y += 120;
  };
  steps.forEach((s, i) => {
    const id = `t${i + 1}`;
    const label = s.title.replace(/\{\{.*?\}\}/g, "").trim().slice(0, 60) || `وظیفهٔ ${i + 1}`;
    const task = { id, type: "create_record", label, config: { table: "request_task", values: taskValues(s, i, lastTask) } };
    if (s.when) {
      const b = `b${i + 1}`;
      add({ id: b, type: "branch", label: `اگر «${s.when.answer}»`, config: { mode: "data", match: "all", rules: [{ left: `{{trigger.inputs.${s.when.answer}}}`, op: s.when.equals !== undefined ? "eq" : "nempty", right: s.when.equals ?? "" }] } });
      enter(b);
      add(task);
      edges.push({ id: `${b}-yes-${id}`, source: b, target: id, port: "yes" });
      frontier = [[id, "out"], [b, "no"]];
    } else {
      add(task);
      enter(id);
      frontier = [[id, "out"]];
      lastTask = id;
    }
  });
  if (extra.notify) {
    add({ id: "n1", type: "notify", label: "اطلاع به درخواست‌کننده", config: { to: { fields: ["requested_for"] }, table: "request_item", record: "{{trigger.id}}", subject: extra.notify.subject, body: extra.notify.body } });
    enter("n1");
    frontier = [["n1", "out"]];
  }
  if (extra.deliver) {
    add({ id: "d1", type: "update_record", label: "تحویل", config: { table: "request_item", record: "{{trigger.id}}", values: { state: "delivered" } } });
    enter("d1");
    frontier = [["d1", "out"]];
  }
  add({ id: "end", type: "end", config: { outcome: "completed" } });
  enter("end");
  return { nodes, edges, layout: { direction: "TB" } };
}

function taskValues(s: TaskStep, i: number, after: string | null): Row {
  const v: Row = {
    request_item_id: "{{trigger.id}}",
    short_description: s.title,
    sort_order: String((i + 1) * 10),
  };
  if (s.group) v.assignment_group_id = s.group;
  if (s.instructions) v.instructions = s.instructions;
  if (s.requester_visible) v.requester_visible = "true";
  if (after) v.depends_on = `{{steps.${after}.output.id}}`;
  return v;
}

/** Copy an item as a draft with its questions, policies, task templates and guide rules. */
export async function copyItem(ctx: Ctx, id: string): Promise<Row> {
  const { row } = await itemFor(ctx, id);
  if (!(await allowed(ctx, "catalog_item", "create"))) throw forbidden("اجازهٔ ساختن قلم کاتالوگ را ندارید");
  const sys = sysOf(ctx);
  const src = (await liveRow(ctx.db, sys, "catalog_item", id))!;
  const skip = new Set(["id", "version", "number", "code", "state", "version_no", "version_id", "published_at", "dirty", "sle_p50", "sle_p85", "sle_p95", "sle_samples", "orders_90d", "created_at", "created_by", "updated_at", "updated_by", "domain_id", "unit_id"]);
  const values: Row = {};
  for (const f of tableDef("catalog_item")!.fields) if (!skip.has(f.name) && !f.system && src[f.name] !== undefined) values[f.name] = src[f.name];
  values.name = `${row.name} (رونوشت)`.slice(0, 120);
  return ctx.write(async (tx) => {
    const copy = await createIn(tx, ctx, "catalog_item", values);
    const children: [string, string][] = [["catalog_variable", "item_id"], ["catalog_ui_policy", "item_id"], ["catalog_task_template", "item_id"], ["order_guide_rule", "guide_id"]];
    for (const [table, field] of children) {
      const def = tableDef(table)!;
      for (const r of await liveRows(tx, sys, table, eqAll({ [field]: id }))) {
        const v: Row = {};
        for (const f of def.fields) if (!f.system && !f.base && r[f.name] !== undefined) v[f.name] = r[f.name];
        v[field] = copy.id;
        await createIn(tx, ctx, table, v);
      }
    }
    return copy;
  });
}

/** May `userId` order the item, and why not (the builder's «پیش‌نمایش برای یک شخص»). */
export async function audienceCheck(ctx: Ctx, id: string, userId: string): Promise<{ can_order: boolean; reasons: string[]; facts: { groups: number; unit: string | null; location: string | null; roles: string[]; persona: string | null; vip: boolean } | null }> {
  await itemFor(ctx, id);
  if (!isUuid(userId)) throw validationError({ user_id: "شخص را انتخاب کنید" });
  const q = ctx.db;
  const sys = sysOf(ctx);
  const item = (await liveRow(q, sys, "catalog_item", id))!;
  const facts = await memberFacts(q, ctx, userId);
  const reasons: string[] = [];
  if (!facts) reasons.push("این شخص عضو فعال سازمان نیست");
  if (item.state !== "published") reasons.push("قلم هنوز منتشر نشده یا بازنشسته است");
  const ent = await entitlementFor(q, ctx, userId);
  const index = await catalogIndex(q, ctx);
  const catalog = index.catalogs.get(String(item.catalog_id));
  if (!catalog || catalog.active === false) reasons.push("کاتالوگ قلم فعال نیست");
  else if (!ent.allowsLevel(catalog)) reasons.push(`مخاطبان کاتالوگ «${catalog.name}» این شخص را در بر نمی‌گیرند`);
  for (const c of categoryChain(index, item.category_id as string | null)) {
    if (c.active === false) reasons.push(`دستهٔ «${c.name}» غیرفعال است`);
    else if (!ent.allowsLevel(c)) reasons.push(`مخاطبان دستهٔ «${c.name}» این شخص را در بر نمی‌گیرند`);
  }
  if (!ent.allowsLevel(item)) reasons.push("مخاطبان خود قلم این شخص را در بر نمی‌گیرند");
  if (userId !== ctx.user.id) {
    const why = await onBehalfRefusal(q, ctx, { on_behalf: item.on_behalf as string }, userId);
    if (why) reasons.push(`شما نمی‌توانید برای او سفارش دهید: ${why}`);
  }
  return {
    can_order: !reasons.length,
    reasons,
    facts: facts ? { groups: facts.groups.length, unit: facts.unitPath[0] ?? null, location: facts.locationPath[0] ?? null, roles: facts.roles, persona: facts.persona, vip: facts.vip } : null,
  };
}
