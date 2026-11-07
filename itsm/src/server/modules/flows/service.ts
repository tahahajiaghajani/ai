// What the flows API does (src/server/routes/flows.ts; docs/spec/services/flows.md §10). Flows themselves are engine
// records (read and written through the engine with the caller's ctx, so the access provider decides); runs are
// shown to whoever may read their flow, and their data (trigger record, step inputs and outputs) only to flow
// administrators, the member who started the run, and those who may read the record it started with.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Ctx, ServerConfig } from "../../context";
import { createIn, get, orgSchema, openSecret, update, updateIn } from "../../engine";
import { readableIds } from "../../access";
import { AppError, bad, conflict, forbidden, notFound, unauthorized } from "../../http/errors";
import { pgArray } from "../../db";
import {
  FLOW_LIMITS, cleanGraph, hasErrors, triggerProblems, validateGraph,
  type FlowGraph, type FlowProblem, type FlowRunDetail, type FlowRunView, type FlowWaitView, type RunState, type TriggerConfig,
} from "@shared/flows";
import { scheduleProblem } from "@shared/flows";
import { cancelRun, executeRun, resumeFlowWait, startRun } from "./executor";
import { flowsGrant, publishing } from "./hooks";
import { flowSkills, serviceInstalled } from "./registry";
import { loadRun, loadVersion, runView, stepView, stepsOf, waitsOf, type RunRow } from "./store";
import { resolveRunAs } from "./triggers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How long a manual or test run executes inside the request before the job queue takes over. */
const INLINE_MS = 3000;

/** The trigger settings of a flow record (what publishing snapshots). */
export function triggerOf(row: Record<string, unknown>): TriggerConfig {
  return {
    kind: (row.trigger as TriggerConfig["kind"]) ?? "manual",
    table: (row.trigger_table as string) || null,
    events: Array.isArray(row.trigger_events) ? (row.trigger_events as TriggerConfig["events"]) : [],
    fields: Array.isArray(row.trigger_fields) ? (row.trigger_fields as string[]) : [],
    condition: row.trigger_condition ?? null,
    schedule: (row.schedule as TriggerConfig["schedule"]) ?? null,
    catalog_item: (row.catalog_item as string) || null,
    run_as: (row.run_as as TriggerConfig["run_as"]) ?? "trigger_user",
    run_as_user: (row.run_as_user as string) || null,
  };
}

async function fieldsLookup(ctx: Ctx) {
  const schema = await orgSchema(ctx);
  return (table: string) => {
    const def = schema.def(table);
    if (!def || def.virtual) return undefined;
    return def.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, readonly: f.readonly, system: f.system }));
  };
}

/** Every problem of a flow's trigger and graph (the draft, or `graph` when given). */
export async function flowProblems(ctx: Ctx, row: Record<string, unknown>, graph?: unknown, testTable?: string | null): Promise<FlowProblem[]> {
  const trigger = triggerOf(row);
  // a test run with a record of a table stands in for the trigger's record
  if (testTable && !trigger.table) trigger.table = testTable;
  const fieldsOf = await fieldsLookup(ctx);
  const problems = [...triggerProblems(trigger, { fieldsOf }), ...validateGraph(graph ?? row.graph, { trigger, fieldsOf })];
  if (trigger.kind === "schedule") {
    const p = scheduleProblem(trigger.schedule);
    if (p) problems.push({ level: "error", message: p, field: "schedule" });
  }
  // references the graph makes to other configuration
  const g = cleanGraph(graph ?? row.graph);
  const connections = [...new Set(g.nodes.filter((n) => n.type === "call_http").map((n) => String(n.config.connection ?? "")).filter((x) => UUID.test(x)))];
  if (connections.length) {
    const found = await ctx.db.query<{ id: string }>(`select id from sm_flow_connections where org_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [ctx.org.id, pgArray(connections)]);
    for (const n of g.nodes) {
      const c = String(n.config.connection ?? "");
      if (n.type === "call_http" && UUID.test(c) && !found.some((f) => f.id === c.toLowerCase())) problems.push({ level: "error", node: n.id, field: "connection", message: "اتصال این گام پیدا نشد" });
    }
  }
  for (const n of g.nodes) {
    if (n.type === "subflow" && String(n.config.flow ?? "") === String(row.id ?? "")) problems.push({ level: "error", node: n.id, field: "flow", message: "گردش‌کار نمی‌تواند خودش را اجرا کند" });
  }
  return problems;
}

async function flowFor(ctx: Ctx, id: string, write = false): Promise<{ row: Record<string, any>; canWrite: boolean }> {
  if (!UUID.test(id)) throw notFound("گردش‌کار پیدا نشد");
  const r = await get(ctx, "flow", id);
  const canWrite = !!r.meta?.canWrite;
  if (write && !canWrite) throw forbidden("اجازهٔ تغییر این گردش‌کار را ندارید");
  return { row: r.row as Record<string, any>, canWrite };
}

/** Publish the draft as a new version (refused while the validator finds errors). */
export async function publishFlow(ctx: Ctx, id: string, input: { note?: string | null; version?: number | null }): Promise<{ version: { id: string; version_no: number }; problems: FlowProblem[] }> {
  const { row } = await flowFor(ctx, id, true);
  if (input.version !== undefined && input.version !== null && Number(row.version) !== Number(input.version)) {
    throw new AppError(409, "version_conflict", "این گردش‌کار را کس دیگری در این فاصله تغییر داده است؛ آن را دوباره باز کنید", { version: row.version });
  }
  const problems = await flowProblems(ctx, row);
  if (hasErrors(problems)) throw bad("گردش‌کار ایراد دارد و منتشر نشد", { problems });
  const trigger = triggerOf(row);
  const graph = cleanGraph(row.graph);
  const version = await ctx.write(async (tx) => {
    const last = await tx.one<{ n: number }>(`select coalesce(max(version_no), 0)::int as n from sm_flow_versions where org_id = $1 and flow_id = $2`, [ctx.org.id, id]);
    const no = (last?.n ?? 0) + 1;
    publishing.add(tx);
    const v = await createIn(tx, ctx, "flow_version", { flow_id: id, version_no: no, title: `${row.name} — نسخهٔ ${no}`.slice(0, 200), note: (input.note ?? "").trim().slice(0, 300) || null, trigger, graph }, { trusted: true });
    await updateIn(tx, ctx, "flow", id, { version_id: v.id, version_no: no, published_at: new Date().toISOString(), dirty: false }, { trusted: true, version: input.version ?? undefined });
    return { id: String(v.id), version_no: no };
  });
  return { version, problems };
}

/** A fresh webhook key (returned once; the record keeps it sealed). */
export async function newWebhookToken(ctx: Ctx, id: string): Promise<{ token: string; path: string }> {
  await flowFor(ctx, id, true);
  const token = randomBytes(24).toString("base64url");
  await update(ctx, "flow", id, { webhook_token: token });
  return { token, path: `/api/hooks/flows/${id}` };
}

async function recordFor(ctx: Ctx, table: unknown, id: unknown): Promise<{ table: string; id: string; number: string | null } | null> {
  if (!table && !id) return null;
  if (typeof table !== "string" || typeof id !== "string" || !UUID.test(id)) throw bad("رکورد آزمایشی معتبر نیست");
  const r = await get(ctx, table, id);
  return { table, id: id.toLowerCase(), number: (r.row.number as string) ?? null };
}

/** Run the draft (or `graph`) now as the caller — a real run with real effects, marked as a test. */
export async function testRun(ctx: Ctx, id: string, input: { table?: string | null; record_id?: string | null; graph?: unknown; inputs?: Record<string, unknown> }): Promise<string> {
  const { row } = await flowFor(ctx, id, true);
  const graph = input.graph === undefined || input.graph === null ? row.graph : input.graph;
  const record = await recordFor(ctx, input.table ?? null, input.record_id ?? null);
  const problems = (await flowProblems(ctx, row, graph, record?.table)).filter((p) => p.field !== "schedule" && p.field !== "catalog_item");
  if (hasErrors(problems)) throw bad("گردش‌کار ایراد دارد و اجرا نشد", { problems });
  const runId = await ctx.db.tx((tx) =>
    startRun(tx, {
      orgId: ctx.org.id,
      flow: { id, name: String(row.name ?? "") },
      version: { id: null, no: null },
      graph: cleanGraph(graph),
      trigger: { kind: "test", table: record?.table ?? null, id: record?.id ?? null, number: record?.number ?? null, event: "test", actor: ctx.user.id, inputs: input.inputs ?? {} },
      actorId: ctx.user.id,
      runAs: { kind: "user", userId: ctx.user.id },
      depth: 0,
      test: true,
    }),
  );
  await executeRun(ctx.cfg, runId, { deadline: Date.now() + INLINE_MS });
  return runId;
}

/** Start the published flow now («اجرای دستی»), optionally with a record and inputs. */
export async function manualRun(ctx: Ctx, id: string, input: { table?: string | null; record_id?: string | null; inputs?: Record<string, unknown> }): Promise<string> {
  const { row, canWrite } = await flowFor(ctx, id);
  if (!row.active) throw conflict("این گردش‌کار غیرفعال است");
  const version = row.version_id ? await loadVersion(ctx.db, ctx.org.id, row.version_id) : null;
  if (!version) throw conflict("این گردش‌کار هنوز منتشر نشده است");
  const t = version.trigger;
  // starting a run that acts as someone else (or on a flow that is not a manual one) is for those who may change it
  if (!canWrite && (t.kind !== "manual" || t.run_as !== "trigger_user")) throw forbidden("اجازهٔ اجرای این گردش‌کار را ندارید");
  const record = await recordFor(ctx, input.table ?? null, input.record_id ?? null);
  const publisher = await ctx.db.one<{ created_by: string | null }>(`select created_by from sm_flow_versions where id = $1`, [version.id]);
  const runId = await ctx.db.tx((tx) =>
    startRun(tx, {
      orgId: ctx.org.id,
      flow: { id, name: String(row.name ?? "") },
      version: { id: version.id, no: version.version_no },
      trigger: { kind: "manual", table: record?.table ?? null, id: record?.id ?? null, number: record?.number ?? null, actor: ctx.user.id, inputs: input.inputs ?? {} },
      actorId: ctx.user.id,
      runAs: resolveRunAs(t, ctx.user.id, publisher?.created_by ?? null),
      depth: 0,
    }),
  );
  await executeRun(ctx.cfg, runId, { deadline: Date.now() + INLINE_MS });
  return runId;
}

// ----- runs -----------------------------------------------------------------------------------------------------

async function readableFlowIds(ctx: Ctx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  return readableIds(ctx, "flow", ids);
}

export async function listRuns(ctx: Ctx, p: { flow?: string; state?: string; test?: boolean; page?: number; size?: number }): Promise<{ runs: FlowRunView[]; total: number; page: number; size: number }> {
  const page = Math.max(1, Math.trunc(p.page ?? 1));
  const size = Math.min(Math.max(Math.trunc(p.size ?? 50), 1), 200);
  const candidates = p.flow
    ? [p.flow]
    : (await ctx.db.query<{ flow_id: string }>(`select distinct flow_id from sm_flow_runs where org_id = $1`, [ctx.org.id])).map((r) => r.flow_id);
  const flows = [...(await readableFlowIds(ctx, candidates.filter((x) => UUID.test(x))))];
  if (!flows.length) return { runs: [], total: 0, page, size };
  const params: unknown[] = [ctx.org.id, pgArray(flows)];
  const where = ["org_id = $1", "flow_id = any($2::uuid[])"];
  if (p.state) {
    params.push(p.state);
    where.push(`state = $${params.length}`);
  }
  if (p.test !== undefined) {
    params.push(p.test);
    where.push(`test = $${params.length}`);
  }
  const total = await ctx.db.one<{ n: number }>(`select count(*)::int as n from sm_flow_runs where ${where.join(" and ")}`, params);
  const rows = await ctx.db.query<RunRow>(
    `select id, org_id, flow_id, flow_name, version_id, version_no, state, test, trigger_kind, trigger_table, trigger_record_id, actor_id, run_as, run_as_kind,
            depth, parent_run_id, current_nodes, steps_count, error, started_at, ended_at
     from sm_flow_runs where ${where.join(" and ")} order by started_at desc, id desc limit ${size} offset ${(page - 1) * size}`,
    params,
  );
  return { runs: rows.map(runView), total: total?.n ?? 0, page, size };
}

async function runFor(ctx: Ctx, runId: string): Promise<RunRow> {
  const run = await loadRun(ctx.db, runId);
  if (!run || run.org_id !== ctx.org.id || !(await readableFlowIds(ctx, [run.flow_id])).size) throw notFound("اجرا پیدا نشد");
  return run;
}

async function seesRunData(ctx: Ctx, run: RunRow): Promise<boolean> {
  if ((await flowsGrant(ctx)).admin) return true;
  if (run.actor_id === ctx.user.id) return true;
  if (run.trigger_table && run.trigger_record_id) return (await readableIds(ctx, run.trigger_table, [run.trigger_record_id]).catch(() => new Set<string>())).size > 0;
  return false;
}

async function canCancel(ctx: Ctx, run: RunRow): Promise<boolean> {
  if (!["running", "waiting"].includes(run.state)) return false;
  if (run.actor_id === ctx.user.id && (run.test || run.trigger_kind === "manual")) return true;
  const r = await get(ctx, "flow", run.flow_id).catch(() => null);
  return !!r?.meta?.canWrite;
}

const BUILTIN_APPROVAL = "approval:flow:";

export async function runDetail(ctx: Ctx, runId: string): Promise<FlowRunDetail> {
  const run = await runFor(ctx, runId);
  const sees = await seesRunData(ctx, run);
  const steps = (await stepsOf(ctx.db, run.id)).map(stepView).map((s) => (sees ? s : { ...s, input: null, output: null }));
  const waits: FlowWaitView[] = (await waitsOf(ctx.db, run.id)).map((w) => {
    const builtin = w.kind === "approval" && String(w.key ?? "").startsWith(BUILTIN_APPROVAL);
    const approvers: string[] = Array.isArray(w.data?.approvers) ? w.data.approvers : [];
    const decided = Array.isArray(w.data?.decisions) && w.data.decisions.some((d: { by?: string }) => d?.by === ctx.user.id);
    const data = sees ? w.data ?? {} : { title: w.data?.title ?? null, approvers };
    return { id: w.id, node_id: w.node_id, kind: w.kind, due_at: w.due_at ? new Date(String(w.due_at)).toISOString() : null, data, can_decide: builtin && !w.result && approvers.includes(ctx.user.id) && !decided };
  });
  const graph = run.graph ?? (run.version_id ? (await loadVersion(ctx.db, ctx.org.id, run.version_id))?.graph ?? null : null);
  const context = sees ? (run.context as Record<string, unknown>) : null;
  return { run: runView(run), steps, waits, context, graph: graph as FlowGraph | null, can_cancel: await canCancel(ctx, run) };
}

export async function cancelFlowRun(ctx: Ctx, runId: string): Promise<{ ok: true; state: RunState }> {
  const run = await runFor(ctx, runId);
  if (!(await canCancel(ctx, run))) throw forbidden("اجازهٔ لغو این اجرا را ندارید");
  await cancelRun(ctx.cfg, run.id, `لغو به دست ${ctx.user.full_name || ctx.user.email}`);
  return { ok: true, state: (await loadRun(ctx.db, run.id))?.state ?? "canceled" };
}

/**
 * A decision on the built-in approval (until the approvals service replaces it): one of the approvers approves or
 * rejects; rule «any» resolves on the first decision, «all» on the first rejection or the last approval.
 */
export async function decideWait(ctx: Ctx, waitId: string, input: { decision: "approve" | "reject"; comment?: string | null }): Promise<{ ok: true; final: "approved" | "rejected" | null }> {
  if (!UUID.test(waitId)) throw notFound("درخواست تأیید پیدا نشد");
  return ctx.db.tx(async (tx) => {
    const w = await tx.one<{ id: string; org_id: string; run_id: string; kind: string; key: string | null; data: Record<string, any>; result: unknown }>(
      `select id, org_id, run_id, kind, key, data, result from sm_flow_waits where id = $1 for update`,
      [waitId],
    );
    if (!w || w.org_id !== ctx.org.id || w.kind !== "approval" || !String(w.key ?? "").startsWith(BUILTIN_APPROVAL)) throw notFound("درخواست تأیید پیدا نشد");
    if (w.result) throw conflict("دربارهٔ این درخواست پیش‌تر تصمیم گرفته شده است");
    const approvers: string[] = Array.isArray(w.data?.approvers) ? w.data.approvers : [];
    if (!approvers.includes(ctx.user.id)) throw forbidden("شما تأییدکنندهٔ این درخواست نیستید");
    const decisions: { by: string; decision: string; comment: string; at: string }[] = Array.isArray(w.data?.decisions) ? w.data.decisions : [];
    if (decisions.some((d) => d.by === ctx.user.id)) throw conflict("شما پیش‌تر تصمیم خود را ثبت کرده‌اید");
    const decision = input.decision === "approve" ? "approved" : "rejected";
    const comment = String(input.comment ?? "").trim().slice(0, 2000);
    decisions.push({ by: ctx.user.id, decision, comment, at: new Date().toISOString() });
    const approved = decisions.filter((d) => d.decision === "approved").length;
    const final: "approved" | "rejected" | null =
      w.data?.rule === "all" ? (decision === "rejected" ? "rejected" : approved >= approvers.length ? "approved" : null) : decision;
    await tx.query(`update sm_flow_waits set data = $2::jsonb where id = $1`, [w.id, JSON.stringify({ ...w.data, decisions })]);
    if (final) await resumeFlowWait(tx, ctx.org.id, String(w.key), { decision: final, port: final, by: ctx.user.id, comment, decisions });
    return { ok: true as const, final };
  });
}

/** What the designer needs besides the shared node catalogue: installed services and AI skills. */
export function flowCatalog() {
  return {
    skills: flowSkills().map((s) => ({ key: s.key, label: s.label, description: s.description ?? null, inputs: s.inputs ?? [] })),
    services: { notify: serviceInstalled("notify"), approval: serviceInstalled("approval"), ai_skill: flowSkills().length > 0 },
    limits: FLOW_LIMITS,
  };
}

// ----- inbound webhooks -----------------------------------------------------------------------------------------

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Start a webhook flow (POST /api/hooks/flows/:id, the key as Bearer, X-Flow-Token or ?token=). Unknown, inactive or
 * non-webhook flows answer 404, a wrong key 401.
 */
export async function webhookRun(cfg: ServerConfig, flowId: string, token: string | null, payload: { body: unknown; query: Record<string, string>; headers: Record<string, string> }): Promise<{ run: string; org: string }> {
  if (!UUID.test(flowId)) throw notFound("گردش‌کار پیدا نشد");
  const f = await cfg.db.one<{ id: string; org_id: string; name: string; active: boolean; webhook_token: string | null; version_id: string | null }>(
    `select id, org_id, name, active, webhook_token, version_id from sm_flows where id = $1 and deleted_at is null`,
    [flowId.toLowerCase()],
  );
  const version = f?.version_id ? await loadVersion(cfg.db, f.org_id, f.version_id) : null;
  if (!f || !f.active || !version || version.trigger?.kind !== "webhook") throw notFound("گردش‌کار پیدا نشد");
  let expected: string | null = null;
  try {
    expected = f.webhook_token ? openSecret(cfg.secret, f.org_id, "flow", "webhook_token", f.id, f.webhook_token) : null;
  } catch {
    expected = null;
  }
  if (!expected || !token || !timingSafeEqual(digest(expected), digest(token))) throw unauthorized("کلید وب‌هوک معتبر نیست");
  const publisher = await cfg.db.one<{ created_by: string | null }>(`select created_by from sm_flow_versions where id = $1`, [version.id]);
  const run = await cfg.db.tx((tx) =>
    startRun(tx, {
      orgId: f.org_id,
      flow: { id: f.id, name: f.name },
      version: { id: version.id, no: version.version_no },
      trigger: { kind: "webhook", body: payload.body, query: payload.query, headers: payload.headers },
      actorId: null,
      runAs: resolveRunAs(version.trigger, null, publisher?.created_by ?? null),
      depth: 0,
    }),
  );
  return { run, org: f.org_id };
}
