// The flows API and its permissions: publishing (validation, versions, immutability), activation, who may make a
// flow act as the system or another member, who sees runs and their data, manual runs, inbound webhooks with their
// key, and the catalog trigger's hook.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { E, N, flowsKit, graph, line, type FlowsKit } from "./flows-helpers";
import { startCatalogFlows } from "@server/modules/flows";
import type { Client } from "./helpers";

describe("flows API", () => {
  let o: EngineOrg;
  let k: FlowsKit;
  let editor: { client: Client; userId: string };
  let reader: { client: Client; userId: string };
  let agent: { client: Client; userId: string };

  beforeAll(async () => {
    o = await engineOrg();
    k = flowsKit(o);
    const role = (key: string, name: string, grants: Record<string, unknown>) =>
      o.owner.put(`${k.P}/access/roles/${key}`, { name, persona: "agent", grants, field_groups: ["internal"], contains: [], workspaces: "member", domains: "own" });
    await role("flow_editor", "ویراستار گردش‌کار", { flows: { read: "all", create: true, write: "all" }, work: { read: "all", create: true, write: "all" } });
    await role("flow_reader", "بینندهٔ گردش‌کار", { flows: { read: "all" } });
    editor = await o.member("member");
    reader = await o.member("member");
    agent = await o.member("member");
    await o.owner.put(`${k.P}/access/members/${editor.userId}`, { roles: ["flow_editor"] });
    await o.owner.put(`${k.P}/access/members/${reader.userId}`, { roles: ["flow_reader"] });
  });

  it("publishes only a sound draft, as an immutable version that snapshots trigger and graph", async () => {
    const id = await k.flow({}, line(N("u", "update_record", {})));
    const refused = await o.owner.post(`${k.P}/flows/${id}/publish`, {}, 400);
    expect(refused.error.details.problems.some((p: any) => p.node === "u" && p.field === "values")).toBe(true);
    const cur = await o.owner.get(`${k.P}/r/flow/${id}`);
    expect(cur.row.dirty).toBe(true);
    expect(cur.row.version_no).toBeNull();
    await o.owner.patch(`${k.P}/r/flow/${id}`, { active: true, version: cur.row.version }, 400);
    const fixed = line(N("u", "update_record", { values: { priority: "2" } }));
    await o.owner.patch(`${k.P}/r/flow/${id}`, { graph: fixed, version: cur.row.version });
    const pub = await o.owner.post(`${k.P}/flows/${id}/publish`, { note: "نخستین" });
    expect(pub.version.version_no).toBe(1);
    const flow = await o.owner.get(`${k.P}/r/flow/${id}`);
    expect([flow.row.version_no, flow.row.version_id, flow.row.dirty]).toEqual([1, pub.version.id, false]);
    const v = await o.owner.get(`${k.P}/r/flow_version/${pub.version.id}`);
    expect(v.row.trigger).toMatchObject({ kind: "manual", table: "todo", run_as: "trigger_user" });
    expect(v.row.graph.nodes.map((n: any) => n.id)).toEqual(["trigger", "u"]);
    expect(v.row.note).toBe("نخستین");
    await o.owner.patch(`${k.P}/r/flow_version/${pub.version.id}`, { note: "دستکاری", version: v.row.version }, 400);
    await o.owner.del(`${k.P}/r/flow_version/${pub.version.id}?version=${v.row.version}`, 400);
    await o.owner.post(`${k.P}/r/flow_version`, { flow_id: id, version_no: 9 }, 400);
    // a stale publish is refused
    await o.owner.post(`${k.P}/flows/${id}/publish`, { version: 1 }, 409);
  });

  it("validates an unsaved graph and checks trigger settings when they are saved", async () => {
    const id = await k.flow({}, line());
    const r = await o.owner.post(`${k.P}/flows/${id}/validate`, { graph: graph([N("a", "set_vars", {})], [E("trigger", "a"), E("a", "trigger")]) });
    expect(r.problems.filter((p: any) => p.level === "error").length).toBeGreaterThan(1);
    await o.owner.post(`${k.P}/r/flow`, { name: "خودارجاع", trigger: "record", trigger_table: "flow", trigger_events: ["updated"] }, 400);
    await o.owner.post(`${k.P}/r/flow`, { name: "فیلد ناموجود", trigger: "record", trigger_table: "todo", trigger_events: ["updated"], trigger_fields: ["nope"] }, 400);
    await o.owner.post(`${k.P}/r/flow`, { name: "زمان بد", trigger: "schedule", schedule: { kind: "daily", time: "x" } }, 400);
    await o.owner.post(`${k.P}/r/flow`, { name: "طرح بد", graph: { nodes: "x" } }, 400);
  });

  it("lets only flow administrators make a flow act as the system or as another member", async () => {
    const c = editor.client;
    const mine = await c.post(`${k.P}/r/flow`, { name: "ویراستار ۱", trigger: "manual", run_as: "trigger_user" });
    await c.post(`${k.P}/r/flow`, { name: "ویراستار ۲", trigger: "manual", run_as: "system" }, 403);
    await c.post(`${k.P}/r/flow`, { name: "ویراستار ۳", trigger: "manual", run_as: "user", run_as_user: o.ownerId }, 403);
    await c.post(`${k.P}/r/flow`, { name: "ویراستار ۴", trigger: "manual", run_as: "user", run_as_user: editor.userId });
    await c.patch(`${k.P}/r/flow/${mine.row.id}`, { run_as: "system", version: mine.row.version }, 403);
    // the owner (a flow administrator) may
    await o.owner.patch(`${k.P}/r/flow/${mine.row.id}`, { run_as: "system", version: mine.row.version });
  });

  it("shows runs to those who read the flow, and their data only to who may see the record behind them", async () => {
    const id = await k.live({ trigger: "manual" }, line(N("c", "add_comment", { body: "دیده شد {{trigger.record.short_description}}" })));
    const t = await k.todo({ short_description: "محرمانه" });
    const run = (await o.owner.post(`${k.P}/flows/${id}/run`, { table: "todo", record_id: t.id })).run.id;
    await k.drain();
    const own = await k.detail(run);
    expect(own.context.trigger.record.short_description).toBe("محرمانه");
    expect(own.steps[1].input.body).toBe("دیده شد محرمانه");
    // flow_reader reads flows but no records: the run without its data
    const seen = await k.detail(run, reader.client);
    expect(seen.run.state).toBe("completed");
    expect(seen.context).toBeNull();
    expect(seen.steps.every((s: any) => s.input === null && s.output === null)).toBe(true);
    expect(seen.can_cancel).toBe(false);
    expect((await reader.client.get(`${k.P}/flows/runs?flow=${id}`)).runs).toHaveLength(1);
    // an agent without a flows grant sees no runs at all
    expect((await agent.client.get(`${k.P}/flows/runs`)).runs).toHaveLength(0);
    await agent.client.get(`${k.P}/flows/runs/${run}`, 404);
  });

  it("starts manual runs for readers only on manual flows acting as them", async () => {
    const mine = await k.live({ trigger: "manual" }, line(N("v", "set_vars", { vars: [{ name: "who", value: "{{trigger.actor}}" }] })));
    const r = await reader.client.post(`${k.P}/flows/${mine}/run`, {});
    expect(r.run.state).toBe("completed");
    expect(r.run.run_as).toBe(reader.userId);
    const sys = await k.live({ trigger: "manual", run_as: "system" }, line(N("v", "set_vars", { vars: [{ name: "x", value: 1 }] })));
    await reader.client.post(`${k.P}/flows/${sys}/run`, {}, 403);
    await reader.client.post(`${k.P}/flows/${mine}/test`, {}, 403);
    await k.activate(mine, false);
    await o.owner.post(`${k.P}/flows/${mine}/run`, {}, 409);
  });

  it("starts webhook flows with their key only, carrying body and query without the key", async () => {
    const id = await k.live({ trigger: "webhook" }, line(N("v", "set_vars", { vars: [{ name: "alert", value: "{{trigger.body.alert.title}}" }, { name: "src", value: "{{trigger.query.source}}" }] })));
    await reader.client.post(`${k.P}/flows/${id}/webhook-token`, {}, 403);
    const { token, path } = await o.owner.post(`${k.P}/flows/${id}/webhook-token`, {});
    expect(path).toBe(`/api/hooks/flows/${id}`);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect((await o.owner.get(`${k.P}/r/flow/${id}`)).row.webhook_token).toMatchObject({ secret: true });
    const hook = (headers: Record<string, string>, q = "") =>
      o.app.fetch(new Request(`http://local.test${path}${q}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ alert: { title: "دیسک پر شد" } }) }));
    expect((await hook({})).status).toBe(401);
    expect((await hook({ authorization: "Bearer wrong" })).status).toBe(401);
    const ok = await hook({ authorization: `Bearer ${token}` }, "?source=zabbix");
    expect(ok.status).toBe(202);
    const { run } = (await ok.json()) as { run: string };
    expect((await hook({ "x-flow-token": token })).status).toBe(202);
    expect((await hook({}, `?token=${encodeURIComponent(token)}`)).status).toBe(202);
    await k.drain();
    const d = await k.detail(run);
    expect(d.run.trigger_kind).toBe("webhook");
    expect(d.context.vars).toEqual({ alert: "دیسک پر شد", src: "zabbix" });
    expect(JSON.stringify(d.context.trigger)).not.toContain(token);
    // other flows and inactive ones do not answer
    const manual = await k.live({ trigger: "manual" }, line());
    expect((await o.app.fetch(new Request(`http://local.test/api/hooks/flows/${manual}`, { method: "POST", headers: { authorization: `Bearer ${token}` } }))).status).toBe(404);
    await k.activate(id, false);
    expect((await hook({ authorization: `Bearer ${token}` })).status).toBe(404);
  });

  it("starts the flows of a catalog item from the catalog module's hook", async () => {
    const id = await k.live({ trigger: "catalog", catalog_item: "laptop" }, line(N("v", "set_vars", { vars: [{ name: "model", value: "{{trigger.inputs.model}}" }] })));
    const t = await k.todo();
    const runs = await o.db.tx((tx) => startCatalogFlows(tx, o.org, { item: "laptop", table: "todo", id: t.id, actorId: o.ownerId, inputs: { model: "X1" } }));
    expect(runs).toHaveLength(1);
    expect(await o.db.tx((tx) => startCatalogFlows(tx, o.org, { item: "phone" }))).toEqual([]);
    await k.drain();
    const d = await k.detail(runs[0]);
    expect(d.run.flow_id).toBe(id);
    expect(d.context.vars.model).toBe("X1");
    expect(d.context.trigger.record.id).toBe(t.id);
  });

  it("describes the installed services and skills for the designer", async () => {
    const c = await o.owner.get(`${k.P}/flows/catalog`);
    expect(c.services).toEqual({ notify: false, approval: false, ai_skill: false });
    expect(c.limits.steps).toBe(1000);
  });
});
