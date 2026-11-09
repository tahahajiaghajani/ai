// /api/o/:org/ai/agents — AI agents (contracts: src/shared/ai/agents.ts; docs/spec/AI.md §11.8). The studio needs ai:full
// (the principal's roles: an owner); members start agents they may start (ai:view, the agent's roles, the record read)
// and see their own starts. Proposals of agents are listed by GET /ai/actions?inbox=1 (./ai.ts). Mounted in ./modules.ts.
import { z } from "zod";
import { router, body, query, errorResponse, type C } from "../http/hono";
import {
  agentRun, agentToolOptions, agentsAdminView, agentsForRecord, createAgent, deleteAgent, listAgentRuns, patchAgent, resetAgent, saveAgentPrincipal, setAgentsSwitch,
  startAgent, stopAgentRun, testAgent,
} from "../modules/ai/agents";

export const agentRoutes = router();

agentRoutes.onError(errorResponse);

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const KEY = z.string().regex(/^[a-z][a-z0-9_.]{1,79}$/, "کلید عامل معتبر نیست");
const TABLE = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, "جدول معتبر نیست");
const NAME = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
const key = (c: C) => KEY.parse(c.req.param("key"));

// ---------------------------------------------------------------- members

agentRoutes.get("/agents/for", async (c) => {
  const q = query(c, z.object({ table: TABLE.optional() }));
  return c.json({ agents: await agentsForRecord(c.get("ctx"), q.table ?? null, "manual") });
});

agentRoutes.post("/agents/:key/start", async (c) => {
  const p = await body(c, z.object({ table: TABLE.nullish(), id: UUID.nullish() }));
  return c.json(await startAgent(c.get("ctx"), key(c), { table: p.table ?? null, id: p.id?.toLowerCase() ?? null, how: "manual" }));
});

agentRoutes.get("/agents/runs", async (c) => {
  const q = query(c, z.object({ agent: KEY.optional(), status: z.string().max(20).optional(), table: TABLE.optional(), id: UUID.optional(), limit: z.coerce.number().int().min(1).max(200).optional() }));
  return c.json({ runs: await listAgentRuns(c.get("ctx"), { agent: q.agent ?? null, status: q.status ?? null, table: q.table ?? null, id: q.id?.toLowerCase() ?? null, limit: q.limit }) });
});

agentRoutes.get("/agents/runs/:id", async (c) => c.json({ run: await agentRun(c.get("ctx"), UUID.parse(c.req.param("id")).toLowerCase()) }));

// ---------------------------------------------------------------- the studio (ai:full)

agentRoutes.get("/agents/admin", async (c) => c.json(await agentsAdminView(c.get("ctx"))));

agentRoutes.put("/agents/admin/switch", async (c) => {
  const p = await body(c, z.object({ on: z.boolean() }));
  return c.json(await setAgentsSwitch(c.get("ctx"), p.on));
});

agentRoutes.post("/agents/admin", async (c) => {
  const p = await body(c, z.object({ key: KEY, name: z.string().trim().min(2).max(120), from: KEY.nullish() }));
  return c.json({ agent: await createAgent(c.get("ctx"), { key: p.key, name: p.name, from: p.from ?? null }) });
});

const cond = z.record(z.string(), z.unknown()).nullable();
const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().max(2000),
    enabled: z.boolean(),
    goal: z.string().trim().min(10, "هدف و دستورالعمل عامل را بنویسید").max(20_000),
    tables: z.array(TABLE).max(40),
    triggers: z.array(z.enum(["manual", "event", "schedule", "conversation"])).max(4),
    events: z.array(z.enum(["created", "updated", "assigned", "state_changed", "commented"])).max(5),
    condition: cond,
    schedule_minutes: z.number().int().min(15).max(10_080).nullable(),
    schedule_filter: cond,
    tools: z.array(z.string().max(90)).max(80),
    autonomy: z.enum(["suggest", "approve", "auto"]),
    auto_actions: z.array(z.string().max(140)).max(40),
    approvers: z.array(UUID).max(20),
    approver_group_id: UUID.nullable(),
    tier: z.enum(["fast", "standard", "reasoning"]),
    max_steps: z.number().int().min(1).max(40),
    max_tokens: z.number().int().min(1000).max(2_000_000),
    max_actions: z.number().int().min(0).max(200),
    daily_runs: z.number().int().min(1).max(100_000),
    forbidden_tables: z.array(TABLE).max(80),
    forbidden_fields: z.array(z.string().regex(/^([a-z][a-z0-9_]{0,62}\.)?[a-z][a-z0-9_]{0,62}$/)).max(80),
    forbidden_states: z.array(z.string().regex(/^([a-z][a-z0-9_]{0,62}:)?[a-z][a-z0-9_]{0,40}$/)).max(40),
    roles: z.array(NAME).max(40),
    field_groups: z.array(z.enum(["internal", "financial", "personal", "security", "hr", "admin"])).max(6),
  })
  .partial();

agentRoutes.patch("/agents/admin/:key", async (c) => c.json({ agent: await patchAgent(c.get("ctx"), key(c), await body(c, patchSchema)) }));

agentRoutes.delete("/agents/admin/:key", async (c) => c.json(await deleteAgent(c.get("ctx"), key(c))));

agentRoutes.post("/agents/admin/:key/reset", async (c) => c.json({ agent: await resetAgent(c.get("ctx"), key(c)) }));

agentRoutes.post("/agents/admin/:key/principal", async (c) => {
  const p = await body(c, z.object({ roles: z.array(NAME).max(20), active: z.boolean().optional() }));
  return c.json({ agent: await saveAgentPrincipal(c.get("ctx"), key(c), p) });
});

agentRoutes.get("/agents/admin/:key/tools", async (c) => c.json({ tools: await agentToolOptions(c.get("ctx"), key(c)) }));

agentRoutes.post("/agents/admin/:key/test", async (c) => {
  const p = await body(c, z.object({ table: TABLE.nullish(), id: UUID.nullish() }));
  return c.json(await testAgent(c.get("ctx"), key(c), { table: p.table ?? null, id: p.id?.toLowerCase() ?? null }));
});

agentRoutes.post("/agents/runs/:id/stop", async (c) => c.json({ run: await stopAgentRun(c.get("ctx"), UUID.parse(c.req.param("id")).toLowerCase()) }));
