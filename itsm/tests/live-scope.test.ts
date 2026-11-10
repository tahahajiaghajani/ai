// «زنده» with a scope (src/server/live-scope.ts, src/ui/lib/live.ts): a screen names the tables and records it shows
// and hears only which of them changed — and never anything the member may not read: rows of other people, records
// of a secure workspace they are outside of, internal notes without the «internal» field group, links to records
// they may not read, tables they may not open. The screen-side scope logic is pure and tested here too.
import { describe, it, expect, beforeAll } from "vitest";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import type { Client } from "./helpers";
import { addJournal, addLink, create, fromDb, systemCtx, update } from "@server/engine";
import { prepareSubject, subjectOf } from "@server/access";
import { rowReadable } from "@server/access/itsm";
import { registerTable, tableDef } from "@shared/tables";
import type { Ctx } from "@server/context";
import { MAX_RECORDS, registerLiveTables, scopeOf, screenScope, touched } from "@ui/lib/live";

registerTable({
  key: "lv_ticket",
  table: "sm_lv_tickets",
  label: "تیکت زنده",
  plural: "تیکت‌های زنده",
  icon: "ticket",
  module: "test",
  area: "work",
  extends: "task",
  numbered: { prefix: "LVT", pad: 5 },
  display: "short_description",
  fields: [],
  features: { links: true },
  scope: {},
});

type Who = { client: Client; userId: string };
let e: EngineOrg;
let P = "";
let sys: Ctx;
let agent: Who; // agent of the IT group, IT workspace only
let hr: Who; // agent of the secure HR workspace
let req: Who; // a requester: own records only
let other: Who; // another requester
const ws = { it: "", hr: "" };
const g = { it: "", hr: "" };

const ticket = async (data: Record<string, unknown>) => (await create(sys, "lv_ticket", { short_description: "تیکت", ...data })).row as { id: string; version: number };

/** A pulse question as the shell asks it. */
async function ask(who: Who, q: { since?: string | null; t?: string[]; r?: string[] }): Promise<{ pulse: string; changed?: string[] }> {
  const qs = new URLSearchParams();
  if (q.since) qs.set("since", q.since);
  if (q.t?.length) qs.set("t", q.t.join(","));
  if (q.r?.length) qs.set("r", q.r.join(","));
  return who.client.get(`${P}/pulse${qs.size ? `?${qs}` : ""}`);
}
/** The token now (an unscoped look). */
const token = async (who: Who) => (await ask(who, {})).pulse;

beforeAll(async () => {
  e = await engineOrg();
  P = `/o/${e.org}`;
  const o = e.owner;
  ws.it = (await o.post(`${P}/r/workspace`, { key: "it", name: "فناوری اطلاعات", is_default: true })).row.id;
  ws.hr = (await o.post(`${P}/r/workspace`, { key: "hr", name: "منابع انسانی", secure: true })).row.id;
  agent = await e.member("member", "lv-agent@example.com");
  hr = await e.member("member", "lv-hr@example.com");
  req = await e.member("member", "lv-req@example.com");
  other = await e.member("member", "lv-other@example.com");
  g.it = (await o.post(`${P}/r/group`, { name: "پشتیبانی فنی", workspace_id: ws.it })).row.id;
  g.hr = (await o.post(`${P}/r/group`, { name: "پرونده‌های کارکنان", workspace_id: ws.hr })).row.id;
  await o.post(`${P}/access/groups/${g.it}/members`, { user_ids: [agent.userId] });
  await o.post(`${P}/access/groups/${g.hr}/members`, { user_ids: [hr.userId] });
  await o.put(`${P}/access/members/${agent.userId}`, { roles: ["agent"], persona: "agent" });
  await o.put(`${P}/access/members/${hr.userId}`, { roles: ["hr_agent"], persona: "agent", workspaces: [ws.hr] });
  await o.put(`${P}/access/members/${req.userId}`, { roles: ["requester"], persona: "requester" });
  await o.put(`${P}/access/members/${other.userId}`, { roles: ["requester"], persona: "requester" });
  sys = await systemCtx(e.cfg, e.org);
});

describe("the scoped pulse", () => {
  it("answers the token alone without a scope, and nothing on a first look", async () => {
    const plain = await ask(agent, {});
    expect(plain.pulse).toMatch(/^w\d+$/);
    expect(plain.changed).toBeUndefined();
    expect(await ask(agent, { t: ["lv_ticket"] })).toMatchObject({ changed: [] });
  });

  it("names a table only when a row the member may read changed — never one of a secure workspace they are outside of", async () => {
    let since = await token(agent);
    await ticket({ caller_id: other.userId, assignment_group_id: g.it, workspace_id: ws.it });
    expect((await ask(agent, { since, t: ["lv_ticket"] })).changed).toEqual(["lv_ticket"]);
    since = await token(agent);
    const hrSince = await token(hr);
    await ticket({ caller_id: other.userId, assignment_group_id: g.hr, workspace_id: ws.hr });
    // the organisation's token moved, but nothing the agent may read did
    const a = await ask(agent, { since, t: ["lv_ticket"] });
    expect(a.pulse).not.toBe(since);
    expect(a.changed).toEqual([]);
    expect((await ask(hr, { since: hrSince, t: ["lv_ticket"] })).changed).toEqual(["lv_ticket"]);
  });

  it("tells a requester about their own records only", async () => {
    let since = await token(req);
    await ticket({ caller_id: other.userId });
    expect((await ask(req, { since, t: ["lv_ticket"] })).changed).toEqual([]);
    since = await token(req);
    await ticket({ caller_id: req.userId });
    expect((await ask(req, { since, t: ["lv_ticket"] })).changed).toEqual(["lv_ticket"]);
  });

  it("never answers about a table the member may not open", async () => {
    const since = await token(req);
    await e.owner.post(`${P}/r/notification_rule`, { name: "قانون آزمون", table_key: "lv_ticket", event: "created", recipients: { assignee: true }, channels: ["in_app"] });
    expect((await ask(req, { since, t: ["notification_rule"] })).changed).toEqual([]);
    expect((await ask(agent, { since: await token(agent), t: ["no_such_table", "x;drop"] })).changed).toEqual([]);
  });

  it("names a record only when it is readable and it or what its page shows changed", async () => {
    const mine = await ticket({ caller_id: req.userId });
    const theirs = await ticket({ caller_id: other.userId });
    const ref = (id: string) => `lv_ticket:${id}`;
    let since = await token(req);
    await update(sys, "lv_ticket", mine.id, { short_description: "تغییر من" });
    await update(sys, "lv_ticket", theirs.id, { short_description: "تغییر دیگری" });
    // an id the requester may not read is never named back, even when it changed
    expect((await ask(req, { since, r: [ref(mine.id), ref(theirs.id)] })).changed).toEqual([ref(mine.id)]);
    since = await token(req);
    expect((await ask(req, { since, r: [ref(theirs.id)] })).changed).toEqual([]);
  });

  it("signals an internal note only to members holding the «internal» field group", async () => {
    // the requester's record, worked by the IT group: both read it
    const shared = await ticket({ caller_id: req.userId, assignment_group_id: g.it, workspace_id: ws.it });
    const ref = `lv_ticket:${shared.id}`;
    let since = await token(req);
    let agentSince = await token(agent);
    await addJournal(sys, "lv_ticket", shared.id, { kind: "comment", body: "پاسخ" });
    expect((await ask(req, { since, r: [ref] })).changed).toEqual([ref]);
    expect((await ask(agent, { since: agentSince, r: [ref] })).changed).toEqual([ref]);
    since = await token(req);
    agentSince = await token(agent);
    await addJournal(sys, "lv_ticket", shared.id, { kind: "work_note", body: "یادداشت داخلی" });
    expect((await ask(req, { since, r: [ref] })).changed).toEqual([]);
    expect((await ask(agent, { since: agentSince, r: [ref] })).changed).toEqual([ref]);
  });

  it("counts a new link only when the other record is readable too", async () => {
    const a = await ticket({ caller_id: other.userId, assignment_group_id: g.it, workspace_id: ws.it });
    const b = await ticket({ caller_id: other.userId, assignment_group_id: g.it, workspace_id: ws.it });
    const secret = await ticket({ caller_id: other.userId, assignment_group_id: g.hr, workspace_id: ws.hr });
    let since = await token(agent);
    await addLink(sys, "lv_ticket", a.id, { kind: "related", table: "lv_ticket", id: secret.id });
    expect((await ask(agent, { since, r: [`lv_ticket:${a.id}`] })).changed).toEqual([]);
    since = await token(agent);
    await addLink(sys, "lv_ticket", a.id, { kind: "related", table: "lv_ticket", id: b.id });
    expect((await ask(agent, { since, r: [`lv_ticket:${a.id}`] })).changed).toEqual([`lv_ticket:${a.id}`]);
  });

  it("ignores malformed scopes and tokens", async () => {
    const since = await token(agent);
    await ticket({ caller_id: other.userId, assignment_group_id: g.it, workspace_id: ws.it });
    expect((await ask(agent, { since: "garbage", t: ["lv_ticket"] })).changed).toEqual([]);
    expect((await ask(agent, { since, r: ["lv_ticket:not-a-uuid", "lv_ticket"] })).changed).toEqual([]);
  });

  it("names exactly the changed records the access rule lets each member read (SQL = JS parity)", async () => {
    const def = tableDef("lv_ticket")!;
    const rows = [
      await ticket({ caller_id: req.userId }),
      await ticket({ caller_id: other.userId }),
      await ticket({ caller_id: other.userId, assignment_group_id: g.it, workspace_id: ws.it }),
      await ticket({ caller_id: req.userId, assignment_group_id: g.it, workspace_id: ws.it }),
      await ticket({ caller_id: other.userId, assignment_group_id: g.hr, workspace_id: ws.hr }),
      await ticket({ caller_id: req.userId, assignment_group_id: g.hr, workspace_id: ws.hr }),
    ];
    const refs = rows.map((r) => `lv_ticket:${r.id}`);
    for (const who of [agent, hr, req, other]) {
      const since = await token(who);
      for (const r of rows) await update(sys, "lv_ticket", r.id, { short_description: `دور ${who.userId.slice(-4)}` });
      const ctx = await e.ctxOf(who.userId);
      await prepareSubject(ctx);
      const s = subjectOf(ctx);
      const stored = await e.db.query<Record<string, unknown>>(`select * from sm_lv_tickets where id = any($1::uuid[])`, [`{${rows.map((r) => r.id).join(",")}}`]);
      const js = refs.filter((ref) => rowReadable(s, def, fromDb(def, stored.find((x) => `lv_ticket:${x.id}` === ref)!)));
      expect((await ask(who, { since, r: refs })).changed, who.userId).toEqual(js);
      // and the table is named exactly when one of them is readable
      expect((await ask(who, { since, t: ["lv_ticket"] })).changed).toEqual(js.length ? ["lv_ticket"] : []);
    }
  });
});

describe("what a screen asks about (src/ui/lib/live.ts)", () => {
  const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
  it("reads lists and records from the engine's query keys and modules' keys from their declarations", () => {
    expect(scopeOf(["records", "org", "incident", { page: 1 }])).toEqual({ tables: ["incident"], records: [] });
    expect(scopeOf(["records-agg", "org", "incident"])).toEqual({ tables: ["incident"], records: [] });
    expect(scopeOf(["record", "org", "incident", id.toUpperCase()])).toEqual({ tables: [], records: [`incident:${id}`] });
    expect(scopeOf(["record-activity", "org", "incident", id])).toEqual({ tables: [], records: [`incident:${id}`] });
    registerLiveTables("lv-bell", ["notification"]);
    expect(scopeOf(["lv-bell", "org"])).toEqual({ tables: ["notification"], records: [] });
    // a module key stands for the module's tables; an unknown key is left to its own interval
    expect(scopeOf(["incident", "org", "templates"], (m) => (m === "incident" ? ["incident", "incident_task"] : []))).toEqual({ tables: ["incident", "incident_task"], records: [] });
    expect(scopeOf(["members"], () => [])).toBeNull();
    registerLiveTables("lv-counts", ["incident", "module:change"]);
    expect(scopeOf(["lv-counts"], (m) => (m === "change" ? ["change_request"] : []))).toEqual({ tables: ["incident", "change_request"], records: [] });
  });

  it("merges a screen's views and asks about at most MAX_RECORDS records by id (the rest by table)", () => {
    const many = Array.from({ length: MAX_RECORDS + 2 }, (_, i) => ({ tables: [], records: [`problem:${id.slice(0, -2)}${String(i).padStart(2, "0")}`] }));
    const s = screenScope([{ tables: ["incident"], records: [] }, null, ...many]);
    expect(s.records).toHaveLength(MAX_RECORDS);
    expect(s.tables).toEqual(["incident", "problem"]);
  });

  it("refreshes a view only when what it shows changed", () => {
    const changed = new Set(["incident", `problem:${id}`]);
    expect(touched({ tables: ["incident"], records: [] }, changed)).toBe(true);
    expect(touched({ tables: ["change_request"], records: [] }, changed)).toBe(false);
    expect(touched({ tables: [], records: [`problem:${id}`] }, changed)).toBe(true);
    expect(touched({ tables: [], records: [`incident:${id}`] }, changed)).toBe(true);
    expect(touched({ tables: [], records: [`request:${id}`] }, changed)).toBe(false);
    expect(touched(null, changed)).toBe(false);
  });
});
