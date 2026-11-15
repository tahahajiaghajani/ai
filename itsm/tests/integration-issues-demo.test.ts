// Jira/GitHub issue sync and the demo pack (docs/DEMO_FA.md: nothing of the demo pack leaves the system): an issue is
// never made from — nor linked to — a demo record, by anyone, on either tool; a demo record's comments never go to an
// issue (neither from the record's event nor from a comment job already queued), and its issue is not read again. The
// guards are `demoQuiet` in src/server/modules/integration/issues.ts (linkIssue, refreshRef, onComment, pushComment);
// each refusal here sends nothing at all.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeServer, Client, signupWithOrg, quietLog } from "./helpers";
import { tick, enqueue } from "@server/jobs";
import { aiNet } from "@server/modules/ai/net";
import { createIn, systemCtx } from "@server/engine";
import { inDemoScope } from "@server/db/scope";
import { pgArray, type Db } from "@server/db";
import type { ServerConfig } from "@server/context";

interface Sent {
  url: string;
  method: string;
  body: string;
}

const sent: Sent[] = [];
const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? "GET";
  sent.push({ url, method, body: typeof init?.body === "string" ? init.body : "" });
  if (url === "https://api.github.com/repos/acme/app/issues" && method === "POST") return Response.json({ number: 12, id: 9001, html_url: "https://github.com/acme/app/issues/12", state: "open" });
  if (url.startsWith("https://api.github.com/repos/acme/app/issues/")) return Response.json({ number: 12, id: 9001, html_url: "https://github.com/acme/app/issues/12", state: "open" });
  if (url === "https://jira.example.com/rest/api/3/issue" && method === "POST") return Response.json({ key: "OPS-7", id: "10007" });
  if (url.startsWith("https://jira.example.com/rest/api/3/issue/")) return Response.json({ key: "OPS-7", id: "10007", fields: { status: { name: "To Do", statusCategory: { key: "new" } } } });
  return Response.json({ id: 1 });
}) as typeof fetch;

describe("issue sync never takes a demo record outside", () => {
  let app: Awaited<ReturnType<typeof makeServer>>["app"];
  let db: Db;
  let cfg: ServerConfig;
  let owner: Client;
  let org: string;
  let P: string;
  let github: string;
  let jira: string;
  let demoTodo: string;
  const lookup = aiNet.lookup;

  const drain = async () => {
    for (let i = 0; i < 30; i++) {
      // the hub's own jobs now (a retry waits with backoff); the modules' sweeps keep their schedule
      await db.query(`update sm_jobs set run_at = now() where status = 'queued' and kind like 'integration.%'`);
      const r = await tick(cfg, { budgetMs: 30_000 });
      if (!r.ran && !r.more) break;
    }
  };
  const refsOf = (record: string) => db.query(`select id from sm_external_refs where org_id = $1 and record_id = $2`, [org, record]);

  beforeAll(async () => {
    aiNet.lookup = async () => ["93.184.216.34"];
    ({ app, db } = await makeServer({ config: { fetch: fakeFetch } }));
    cfg = { mode: "cloud", db, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch: fakeFetch };
    owner = new Client(app);
    org = await signupWithOrg(owner);
    P = `/o/${org}`;
    const iu = (await owner.post(`${P}/r/integration_user`, { name: "ابزار توسعه" })).row;
    await owner.put(`${P}/integration/users/${iu.id}/roles`, { roles: ["service_desk_manager"] });
    const connect = async (row: Record<string, unknown>) => {
      const conn = (await owner.post(`${P}/r/issue_connection`, { principal_id: iu.id, tables: ["todo"], sync_comments: "all", ...row })).row;
      const cur = await owner.get(`${P}/r/issue_connection/${conn.id}`);
      await owner.patch(`${P}/r/issue_connection/${conn.id}`, { token: "tool-token", version: cur.row.version });
      return String(conn.id);
    };
    github = await connect({ name: "مخزن برنامه", kind: "github", repo: "acme/app" });
    jira = await connect({ name: "پروژهٔ عملیات", kind: "jira", base_url: "https://jira.example.com", project_key: "OPS", auth_user: "bot@example.com" });
    // a record of the demo pack, written the way the loader writes (the system, inside the pack's scope)
    await db.query(`insert into sm_demo_packs (org_id, state, size, progress, counters) values ($1, 'loaded', 'small', '{}'::jsonb, '{}'::jsonb)`, [org]);
    const sys = await systemCtx(cfg, org);
    demoTodo = await inDemoScope(org, () => sys.write(async (tx) => String((await createIn(tx, sys, "todo", { short_description: "قطعی سوئیچ کارت (نمایشی)", description: "شرح نمایشی بانک آفتاب" }, { trusted: true })).id)));
    expect(await db.one(`select 1 from sm_demo_rows where org_id = $1 and row_id = $2`, [org, demoTodo])).toBeTruthy();
    await drain();
  }, 300_000);
  afterAll(() => {
    aiNet.lookup = lookup;
  });

  it("makes no issue from a demo record and links none to it, on GitHub or Jira", async () => {
    sent.length = 0;
    for (const connection_id of [github, jira]) {
      const made = await owner.post(`${P}/integration/issues/link`, { connection_id, table: "todo", record_id: demoTodo }, 409);
      expect(made.error.message).toContain("نمایشی");
      // nor a link to an issue that already exists (reading it would name the record's issue to the tool)
      await owner.post(`${P}/integration/issues/link`, { connection_id, table: "todo", record_id: demoTodo, remote_key: connection_id === github ? "#5" : "OPS-5" }, 409);
    }
    expect(sent).toEqual([]);
    expect(await refsOf(demoTodo)).toEqual([]);
    // the same request for a real record makes the issue (the refusal is the demo record's, not the set-up's)
    const real = (await owner.post(`${P}/r/todo`, { short_description: "خطای واقعی ورود" })).row;
    await owner.post(`${P}/integration/issues/link`, { connection_id: jira, table: "todo", record_id: real.id });
    expect(sent.some((s) => s.url === "https://jira.example.com/rest/api/3/issue" && s.method === "POST" && s.body.includes("خطای واقعی ورود"))).toBe(true);
  });

  it("posts no comment of a demo record to its issue and reads its issue no more", async () => {
    // a record linked to an issue that then belongs to the pack (a link made before the pack's rules, say)
    const todo = (await owner.post(`${P}/r/todo`, { short_description: "رکوردی که نمایشی شد" })).row;
    const { ref } = await owner.post(`${P}/integration/issues/link`, { connection_id: github, table: "todo", record_id: todo.id });
    await db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_todos')`, [org, todo.id]);
    sent.length = 0;
    // a public reply and an internal note (the connection sends both): the record event queues nothing
    await owner.post(`${P}/r/todo/${todo.id}/journal`, { kind: "comment", body: "پاسخ عمومی رکورد نمایشی" });
    await owner.post(`${P}/r/todo/${todo.id}/journal`, { kind: "work_note", body: "یادداشت داخلی رکورد نمایشی" });
    await drain();
    const notes = (await db.query<{ id: string }>(`select id from sm_journal where record_id = $1 and body like '%رکورد نمایشی'`, [todo.id])).map((r) => r.id);
    expect(notes).toHaveLength(2);
    expect(await db.one(`select 1 from sm_jobs where org_id = $1 and kind = 'integration.issue.comment' and payload ->> 'entry' = any($2::text[])`, [org, pgArray(notes)])).toBeNull();
    // a comment job queued before the record joined the pack sends nothing either
    const entry = await db.one<{ id: string }>(`select id from sm_journal where record_id = $1 and kind = 'comment' order by created_at desc limit 1`, [todo.id]);
    await db.tx((tx) => enqueue(tx, { kind: "integration.issue.comment", orgId: org, payload: { table: "todo", id: todo.id, entry: entry!.id }, maxAttempts: 1 }));
    await drain();
    // and its issue is not read again
    await owner.post(`${P}/integration/issues/refs/${ref.id}/refresh`, {}, 409);
    expect(sent).toEqual([]);
  });
});
