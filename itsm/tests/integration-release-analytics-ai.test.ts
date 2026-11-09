// Release, DevOps and projects, analytics and the AI agents together (merged after each was tested alone): the
// assistant's generated tools follow each member's access to the new tables; the aggregate tool and the report engine
// count and bucket (Jalali) the same rows; the DORA metrics are analytics indicators that agree with the release
// module's own DORA view; a conversation's report opens in the designer; proposals on records follow one visibility
// and decide rule (skills, the assistant's record tools, agents); an agent's service member is found by membership;
// Windows pushes of the new tables are held to the modules' rules; runtime-only tables are never reported on; the
// release and project skills reach the record AI panel with the field groups their notes need.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { world, type World } from "./release-helpers";
import type { Client } from "./helpers";
import { memberCtx } from "@server/access";
import { access } from "@server/access/provider";
import { create, orgSchema } from "@server/engine";
import { toolCatalog } from "@server/modules/ai/tools";
import type { ToolRuntime } from "@server/modules/ai/tools/registry";
import { recordProposals, storeProposal } from "@server/modules/ai/actions";
import { isServiceEmail, principalOf, setPrincipal } from "@server/modules/ai/skills/principal";
import { resolveSkill } from "@server/modules/ai/skills";
import { runReport } from "@server/modules/analytics/query";
import { settledVerdict } from "@server/modules/sla";
import { designerPath } from "@server/modules/analytics/ai";
import { tableDef, physicalTables } from "@shared/tables";
import { BUILTIN_KEYS } from "@shared/access/builtins";
import { LIBRARY_DASHBOARDS } from "@shared/analytics/library";
import { isNever } from "@shared/model/conditions";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { safePath } from "../src/ui/ai/markdown/links";
import type { Ctx } from "@server/context";

const rt: ToolRuntime = { today: "2026-11-08", dataPolicy: "full", putData: async () => "ref_test_1" };
const NEW_MODULES = new Set(["release", "devops", "project", "analytics"]);
const before = process.env.ITSM_AI_FAKE;

type Result = { entity: string; id: string; status: string; message?: string };
async function push(c: Client, org: string, aggregates: { entity: string; id: string; base_rev: number; row: Record<string, unknown> }[]): Promise<Result[]> {
  return (await c.post(`/sync/push`, { org_id: org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates })).results as Result[];
}

describe("release, analytics and AI together", () => {
  let w: World;
  let ctxOf: (userId: string) => Promise<Ctx>;
  const toolNames = async (ctx: Ctx) => {
    const { registered, generated } = await toolCatalog(ctx, { proposals: true });
    return new Set([...registered.map((t) => t.name), ...generated.map((e) => e.name)]);
  };

  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await world();
    await w.o.post(`${w.P}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
    await w.o.post(`${w.P}/analytics/seed`, {});
    await w.drain();
    ctxOf = (userId) => memberCtx(w.e.cfg, w.e.org, userId);
  }, 240_000);

  afterAll(() => {
    if (before === undefined) delete process.env.ITSM_AI_FAKE;
    else process.env.ITSM_AI_FAKE = before;
  });

  it("the assistant's generated tools cover the new tables exactly as far as each member may read and write them", async () => {
    const tables = physicalTables().filter((t) => NEW_MODULES.has(String(t.module)));
    expect(tables.length).toBeGreaterThan(20);
    for (const who of ["rm", "dev", "req", "auditor"] as const) {
      const ctx = await ctxOf(w.p[who].userId);
      const schema = await orgSchema(ctx);
      const names = await toolNames(ctx);
      for (const t of tables) {
        const def = schema.def(t.key)!;
        expect([who, t.key, names.has(`search_${t.key}`.slice(0, 64))]).toEqual([who, t.key, access().canReadTable(ctx, def)]);
      }
      // tables only their module writes never get drafts
      for (const t of ["analytics_score", "analytics_delivery", "analytics_config", "dev_event", "dev_commit", "dev_build", "change_gate", "release_decision"]) {
        expect(names.has(`draft_create_${t}`) || names.has(`draft_update_${t}`) || names.has(`draft_batch_${t}`)).toBe(false);
      }
    }
    const rm = await toolNames(await ctxOf(w.p.rm.userId));
    expect(rm.has("search_release") && rm.has("draft_update_release") && rm.has("aggregate_deployment") && rm.has("analytics_report")).toBe(true);
    const req = await toolNames(await ctxOf(w.p.req.userId));
    expect(req.has("search_release") || req.has("search_deployment") || req.has("draft_update_release")).toBe(false);
    const auditor = await toolNames(await ctxOf(w.p.auditor.userId));
    expect(auditor.has("search_release")).toBe(true);
    expect(auditor.has("draft_update_release")).toBe(false);
  });

  it("the aggregate tool and the analytics engine count the same rows in the same Jalali buckets, as the caller", async () => {
    await w.release({ short_description: "انتشار تیم الف" });
    await w.release({ short_description: "انتشار تیم ب", version_name: "2.5.0" });
    await w.release({ short_description: "انتشار گروه دیگر", assignment_group_id: w.g.others }, w.o);
    for (const who of ["dev", "rm", "auditor"] as const) {
      const ctx = await ctxOf(w.p[who].userId);
      const tool = (await toolCatalog(ctx, { proposals: false })).generated.find((e) => e.name === "aggregate_release")!.build();
      const viaTool = (await tool.run(ctx, { group_by: [{ field: "created_at", bucket: "month" }, { field: "state" }] }, rt)).data as { rows: { label: string; count: number }[]; totals: Record<string, number> };
      const report = await runReport(ctx, { v: 1, table: "release", measures: [{ fn: "count" }], dims: [{ field: "created_at", bucket: "month" }, { field: "state" }], viz: "table" });
      const listed = (await w.p[who].client.post(`${w.P}/r/release/query`, { filter: null, size: 1, total: true })).total as number;
      expect([who, Number(viaTool.totals.count ?? 0)]).toEqual([who, listed]);
      expect([who, report.total_n]).toEqual([who, listed]);
      const fromTool = Object.fromEntries(viaTool.rows.map((r) => [r.label, Number(r.count)]));
      const fromReport = Object.fromEntries(report.rows.filter((r) => r.n > 0).map((r) => [r.labels.join(" / "), r.n]));
      expect(fromTool).toEqual(fromReport);
    }
    // a requester reads no release: no tool, and the report engine refuses the table as well
    const req = await ctxOf(w.p.req.userId);
    expect((await toolCatalog(req, { proposals: false })).generated.some((e) => e.name === "aggregate_release")).toBe(false);
    await expect(runReport(req, { v: 1, table: "release", measures: [{ fn: "count" }], dims: [], viz: "score" })).rejects.toThrow();
  });

  it("the DORA metrics are seeded indicators that agree with the release module's DORA view", async () => {
    const keys = ((await w.o.get(`${w.P}/r/analytics_indicator?size=200`)).rows as { key: string }[]).map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(["devops.deployment_frequency", "devops.lead_time", "devops.change_failure_rate", "devops.time_to_restore", "release.on_time", "release.emergency_share"]));
    const dash = ((await w.o.get(`${w.P}/r/analytics_dashboard?size=50`)).rows as { name: string }[]).map((d) => d.name);
    expect(dash).toContain("داشبورد انتشار و دواپس");
    // four production deployments that finished minutes ago: three succeeded (one of them later caused an incident),
    // one failed and was restored
    const table = tableDef("deployment")!.table;
    const now = Date.now();
    const iso = (ms: number) => new Date(now - ms).toISOString();
    const rows = [
      { state: "succeeded", change_failure: false, first: 3 * 3600_000, restored: null },
      { state: "succeeded", change_failure: false, first: 5 * 3600_000, restored: null },
      { state: "succeeded", change_failure: true, first: 2 * 3600_000, restored: 60_000 },
      { state: "failed", change_failure: true, first: null, restored: 30_000 },
    ];
    for (const r of rows) {
      const dep = await create(w.sys, "deployment", { environment_id: w.env.staging, artifact_version: "9.9.9", assignment_group_id: w.g.team });
      await w.e.db.query(
        `update ${table} set is_production = true, state = $2, actual_end = $3, first_commit_at = $4, lead_time = $5, change_failure = $6, restored_at = $7 where id = $1`,
        [dep.row.id, r.state, iso(120_000), r.first ? iso(r.first) : null, r.first && r.state === "succeeded" ? Math.round((r.first - 120_000) / 1000) : null, r.change_failure, r.restored ? iso(r.restored) : null],
      );
    }
    const dora = await w.p.rm.client.get(`${w.P}/devops/dora?days=30`);
    expect(dora.overall.deployments).toBe(4);
    const card = (await w.p.rm.client.get(`${w.P}/analytics/scorecard?practice=release`)).items as { key?: string; name: string; current: { value: number | null } }[];
    const value = (name: string) => card.find((i) => i.name === name)?.current.value ?? null;
    expect(value("نرخ شکست تغییر (DORA)")).toBeCloseTo(dora.overall.change_failure_rate.pct, 1);
    expect(value("زمان تحویل تغییر (DORA)")).toBeCloseTo(dora.overall.lead_time.p50, -1);
    expect(value("زمان بازیابی خدمت (DORA)")).toBeCloseTo(dora.overall.recovery.p50, -1);
    // the requester reads no deployment: the same indicator counts nothing for them
    const theirs = (await w.p.req.client.get(`${w.P}/analytics/scorecard?practice=release`, undefined).catch(() => ({ items: [] }))).items as { name: string; current: { value: number | null } }[];
    expect(theirs.find((i) => i.name === "نرخ شکست تغییر (DORA)")?.current.value ?? null).toBeNull();
  });

  it("a report computed in a conversation opens in the designer, ready to save", async () => {
    const ctx = await ctxOf(w.p.rm.userId);
    const tool = (await toolCatalog(ctx, { proposals: false })).registered.find((t) => t.name === "analytics_report")!;
    const res = await tool.run(ctx, { table: "deployment", measure: "count", group_by: [{ field: "state" }] }, rt);
    const ref = res.refs?.[0];
    expect(ref?.path).toBeTruthy();
    const path = safePath(ref!.path);
    expect(path).toBe(ref!.path);
    const spec = JSON.parse(new URLSearchParams(path!.split("?")[1]).get("spec")!);
    expect(spec).toMatchObject({ table: "deployment", measures: [{ fn: "count" }], dims: [{ field: "state" }] });
    expect(designerPath({ ...spec, filter: { f: "short_description", op: "contains", v: "x".repeat(5000) } }, "بلند")).toBeNull();
  });

  it("an assistant's draft is its author's; an agent's draft is seen by those it is routed to and those who work its record", async () => {
    const rel = await w.release({ short_description: "انتشار برای پیشنهاد" });
    const dev = await ctxOf(w.p.dev.userId);
    const proposal = (routing?: Parameters<typeof storeProposal>[1]["routing"]) =>
      storeProposal(dev, {
        threadId: null, messageId: null, callId: `c-${uuidv7()}`, tool: "draft_update_release", routing,
        proposal: {
          kind: "record.update", title_fa: "تغییر انتشار", summary_fa: "عنوان تازه", area: "ai", level: "view", preview: [],
          payload: { table: "release", id: rel.id, data: { short_description: "عنوان تازهٔ انتشار" }, snapshot: { short_description: rel.short_description } },
          record: { table: "release", id: String(rel.id), fields: ["short_description"] },
        },
      });
    const p = await proposal();
    expect(p.can_decide).toBe(true);
    const seen = async (who: "rm" | "auditor" | "req" | "other" | "dev", id = p.id) => (await recordProposals(await ctxOf(w.p[who].userId), "release", String(rel.id))).find((x) => x.id === id);
    // a draft of a member's own conversation: what their conversation read shaped it — theirs alone
    expect((await seen("dev"))?.can_decide).toBe(true);
    expect(await seen("rm")).toBeUndefined();
    expect(await seen("auditor")).toBeUndefined();
    expect(await seen("req")).toBeUndefined();
    await w.p.auditor.client.post(`${w.P}/ai/actions/${p.id}/confirm`, {}, 404);
    // an agent's proposal routed only to the release engineer: the release manager (who works the release) sees it but
    // does not decide it; the auditor, who only reads the release, does not see it
    const routed = await proposal({ agent: { id: uuidv7(), key: "release.helper", name: "دستیار انتشار", run_id: null }, users: [w.p.dev.userId], only: true });
    expect((await seen("rm", routed.id))?.can_decide).toBe(false);
    expect((await seen("dev", routed.id))?.can_decide).toBe(true);
    expect(await seen("auditor", routed.id)).toBeUndefined();
    expect(await seen("req", routed.id)).toBeUndefined();
  });

  it("an agent's service member has a random reserved address and is found by its membership, never adopted", async () => {
    const owner = await ctxOf(w.e.ownerId);
    const agent = await setPrincipal(owner, { roles: ["auditor"], name: "عامل: بازبین انتشار" }, "release.reviewer");
    const assistant = await setPrincipal(owner, { roles: ["auditor"] });
    expect(agent.user_id).toBeTruthy();
    expect(agent.user_id).not.toBe(assistant.user_id);
    const emails = await w.e.db.query<{ id: string; email: string }>(`select id, email from sm_users where id = any($1::uuid[])`, [`{${agent.user_id},${assistant.user_id}}`]);
    for (const e of emails) expect(isServiceEmail(e.email)).toBe(true);
    expect(emails.find((e) => e.id === agent.user_id)!.email).toMatch(/^ai-agent\+[0-9a-f]{10}\.[0-9a-f-]{36}@service\.invalid$/);
    expect((await principalOf(w.e.db, w.e.org, "release.reviewer")).user_id).toBe(agent.user_id);
    expect((await principalOf(w.e.db, w.e.org, "another.agent")).user_id).toBeNull();
    // the same again keeps the same member
    expect((await setPrincipal(owner, { roles: ["auditor"] }, "release.reviewer")).user_id).toBe(agent.user_id);
    // an account that can sign in with an address of another agent's prefix is never taken for that agent
    const prefix = emails.find((e) => e.id === agent.user_id)!.email.split(".")[0];
    const fake = uuidv7();
    await w.e.db.query(`insert into sm_users (id, email, full_name, password_hash) values ($1, $2, 'جعلی', 'x')`, [fake, `${prefix}.${uuidv7()}@service.invalid`]);
    await w.e.db.query(`insert into sm_org_members (id, org_id, user_id, role, is_active) values ($1, $2, $3, 'member', true)`, [uuidv7(), w.e.org, fake]);
    expect((await principalOf(w.e.db, w.e.org, "release.reviewer")).user_id).toBe(agent.user_id);
    await expect(setPrincipal(owner, { roles: ["auditor"] }, "release.reviewer")).rejects.toThrow(/حساب خدمت/);
    await w.e.db.query(`update sm_org_members set deleted_at = now() where user_id = $1`, [fake]);
  });

  it("Windows pushes of the new tables are held to the modules' rules", async () => {
    // machine data: never from a person's Windows app
    const ev = uuidv7();
    const r1 = (await push(w.p.rm.client, w.e.org, [{ entity: "dev_event", id: ev, base_rev: 0, row: { id: ev, org_id: w.e.org, kind: "build", payload: {}, received_at: new Date().toISOString(), updated_at: new Date().toISOString() } }]))[0];
    expect(r1.status).toBe("error");
    // a definition only the release manager writes
    const tpl = uuidv7();
    const r2 = (await push(w.p.dev.client, w.e.org, [{ entity: "release_template", id: tpl, base_rev: 0, row: { id: tpl, org_id: w.e.org, name: "الگوی جعلی", type: "minor", active: true, updated_at: new Date().toISOString() } }]))[0];
    expect(r2.status).toBe("error");
    // a task copies who reaches it from its release, never from the push
    const rel = await w.release({ short_description: "انتشار با کار" });
    const stored = (await w.e.db.one<{ release_manager_id: string | null }>(`select release_manager_id from ${tableDef("release")!.table} where id = $1`, [rel.id]))!;
    const task = (await w.p.dev.client.post(`${w.P}/r/release_task`, { release_id: rel.id, short_description: "آماده‌سازی", assignment_group_id: w.g.team })).row;
    const t = tableDef("release_task")!.table;
    const r = (await w.e.db.one<Record<string, unknown>>(`select * from ${t} where id = $1`, [task.id]))!;
    const row = { ...JSON.parse(JSON.stringify(r)), release_manager_id: w.p.other.userId, short_description: "آماده‌سازی محیط", updated_at: new Date(Date.now() + 5_000).toISOString() };
    const r3 = (await push(w.p.dev.client, w.e.org, [{ entity: "release_task", id: String(task.id), base_rev: Number(r.rev), row }]))[0];
    expect(r3.status).toBe("ok");
    const after = (await w.e.db.one<{ release_manager_id: string | null; short_description: string }>(`select release_manager_id, short_description from ${t} where id = $1`, [task.id]))!;
    expect(after.short_description).toBe("آماده‌سازی محیط");
    expect(after.release_manager_id).toBe(stored.release_manager_id);
    // a report's compiled readers come from its sharing, never from the push
    const rep = (await w.o.post(`${w.P}/r/analytics_report`, { name: "استقرارهای من", table_key: "deployment", spec: { v: 1, table: "deployment", measures: [{ fn: "count" }], dims: [], viz: "score" } })).row;
    const at = tableDef("analytics_report")!.table;
    const rr = (await w.e.db.one<Record<string, unknown>>(`select * from ${at} where id = $1`, [rep.id]))!;
    const forged = { ...JSON.parse(JSON.stringify(rr)), r_users: [w.p.req.userId], r_all: true, description: "از ویندوز", updated_at: new Date(Date.now() + 5_000).toISOString() };
    expect((await push(w.o, w.e.org, [{ entity: "analytics_report", id: String(rep.id), base_rev: Number(rr.rev), row: forged }]))[0].status).toBe("ok");
    const now = (await w.e.db.one<{ r_users: string[]; r_all: boolean; description: string }>(`select r_users, r_all, description from ${at} where id = $1`, [rep.id]))!;
    expect(now.description).toBe("از ویندوز");
    expect(now.r_users ?? []).not.toContain(w.p.req.userId);
    expect(now.r_all).toBe(false);
    // sharing pushed by the owner is compiled in the push itself
    const rr2 = (await w.e.db.one<Record<string, unknown>>(`select * from ${at} where id = $1`, [rep.id]))!;
    const shared = { ...JSON.parse(JSON.stringify(rr2)), shares: [{ kind: "user", id: w.p.auditor.userId, right: "view" }], updated_at: new Date(Date.now() + 10_000).toISOString() };
    expect((await push(w.o, w.e.org, [{ entity: "analytics_report", id: String(rep.id), base_rev: Number(rr2.rev), row: shared }]))[0].status).toBe("ok");
    expect((await w.e.db.one<{ r_users: string[] }>(`select r_users from ${at} where id = $1`, [rep.id]))!.r_users).toContain(w.p.auditor.userId);
  });

  it("runtime-only tables are closed to the record API and to reports (rowAccess NEVER)", async () => {
    const def = tableDef("ai_agent_run")!;
    expect(isNever(def.rowAccess?.read)).toBe(true);
    expect(((await w.o.get(`${w.P}/r/ai_agent_run?size=5`).catch(() => ({ rows: [] }))).rows ?? []).length).toBe(0);
    const meta = await w.o.get(`${w.P}/analytics/meta`);
    expect((meta.tables as { key: string }[]).some((t) => t.key === "ai_agent_run")).toBe(false);
    await w.o.post(`${w.P}/analytics/run`, { spec: { v: 1, table: "ai_agent_run", measures: [{ fn: "count" }], dims: [], viz: "score" } }, 400);
  });

  it("the release and project skills reach the record AI panel, with the field groups their notes need", async () => {
    const rel = await w.release({ short_description: "انتشار برای پنل هوش مصنوعی" });
    const panel = await w.p.rm.client.get(`${w.P}/ai/skills/for/release/${rel.id}`);
    const keys = (panel.skills as { key: string }[]).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["release.notes", "release.briefing"]));
    const owner = await ctxOf(w.e.ownerId);
    for (const k of ["release.briefing", "project.status_summary"]) expect((await resolveSkill(owner, k)).cfg.field_groups).toContain("internal");
  });

  it("the seeded dashboards share only with roles that exist (built in, or the release module's)", async () => {
    const builtin = new Set(BUILTIN_KEYS);
    const seeded = new Set(((await w.o.get(`${w.P}/access/roles`).catch(() => ({ roles: [] }))).roles ?? []).map((r: { key: string }) => r.key));
    for (const d of LIBRARY_DASHBOARDS) for (const s of d.shares) expect([d.key, s.id, builtin.has(String(s.id)) || seeded.has(String(s.id))]).toEqual([d.key, s.id, true]);
    // the change dashboard reaches the release manager
    const dash = ((await w.p.rm.client.get(`${w.P}/r/analytics_dashboard?size=50`)).rows as { name: string }[]).map((d) => d.name);
    expect(dash).toEqual(expect.arrayContaining(["داشبورد مدیریت تغییر", "داشبورد انتشار و دواپس"]));
  });

  it("release go/no-go, project gates and deployment gates read a settled round the same way (a re-run is never a rejection)", () => {
    expect(settledVerdict({ outcome: "approved", aggregate: "approved" })).toBe("approved");
    expect(settledVerdict({ outcome: "rejected", aggregate: "rejected" })).toBe("rejected");
    // a re-run of the rules that left nothing open: approved or nothing asks any more — never a rejection
    expect(settledVerdict({ outcome: "replanned", aggregate: "approved" })).toBe("approved");
    expect(settledVerdict({ outcome: "replanned", aggregate: "not_requested" })).toBe("approved");
    expect(settledVerdict({ outcome: "replanned", aggregate: "rejected" })).toBe("rejected");
    // a withdrawal never approves; a round approved while another rule's round is open waits
    expect(settledVerdict({ outcome: "canceled", aggregate: "approved" })).toBeNull();
    expect(settledVerdict({ outcome: "approved", aggregate: "requested" })).toBeNull();
  });
});
