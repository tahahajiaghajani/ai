// Rules of records between a Windows app and the cloud (docs/spec/services/sla.md §5): the rules travel down like
// any configuration; the runtime where the person acted runs the rules with side effects (a work note here) and the
// other side applies the synchronised result without running them again; a pushed row is still validated against
// the organisation's UI policies on the cloud, so a write that bypassed them on the Windows app does not land.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, quietLog } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import type { DesktopBridge } from "@server/context";
import type { Db } from "@server/db";

const EMAIL = "sla-sync@example.com";
const PASSWORD = "sla-sync-pass-1405";

describe("rules between a Windows app and the cloud", () => {
  let cloudDb: Db;
  let deskDb: Db;
  let web: Client;
  let local: Client;
  let client: SyncClient;
  let org = "";

  const notes = async (c: Client, id: string) =>
    (await c.get(`/o/${org}/r/todo/${id}/journal`)).entries.filter((x: { kind: string }) => x.kind === "work_note").map((x: { body: string }) => x.body);

  beforeAll(async () => {
    const cloudSrv = await makeServer({ mode: "cloud" });
    cloudDb = cloudSrv.db;
    const bridge = { notifyLocalWrite() {}, fetchBlob: (o: string, a: string) => client.fetchBlob(o, a) } as unknown as DesktopBridge;
    const deskSrv = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
    deskDb = deskSrv.db;
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => cloudSrv.app.fetch(new Request(String(u), init))) as typeof fetch;
    web = new Client(cloudSrv.app, "http://cloud.test");
    await web.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
    org = (await web.post<{ id: string }>("/orgs", { name: "سازمان قواعد", timezone: "Asia/Tehran" })).id;
    await web.post(`/o/${org}/r/business_rule`, { name: "یادداشت ثبت", table_key: "todo", timing: "after", events: ["insert"], actions: [{ type: "work_note", body: "قاعده اجرا شد" }] });
    await web.post(`/o/${org}/r/ui_policy`, { name: "شرح کار فوری", table_key: "todo", condition: { f: "priority", op: "eq", v: "1" }, actions: [{ field: "description", mandatory: true }] });
    client = new SyncClient({ db: deskDb, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
    await client.link({ url: "http://cloud.test", email: EMAIL, password: PASSWORD, orgId: org, direction: "download" });
    local = new Client(deskSrv.app, "http://desk.test");
    await local.post("/auth/login", { email: EMAIL, password: PASSWORD });
  });

  it("runs a rule with side effects once, where the person acted", async () => {
    // on the Windows app: the rule ran there; the cloud receives the note, it does not write a second one
    const desk = (await local.post(`/o/${org}/r/todo`, { short_description: "ثبت در ویندوز" })).row;
    expect(await notes(local, desk.id)).toEqual(["قاعده اجرا شد"]);
    await client.syncNow();
    expect(await notes(web, desk.id)).toEqual(["قاعده اجرا شد"]);

    // on the cloud: the same in the other direction
    const cloud = (await web.post(`/o/${org}/r/todo`, { short_description: "ثبت در وب" })).row;
    expect(await notes(web, cloud.id)).toEqual(["قاعده اجرا شد"]);
    await client.syncNow();
    expect(await notes(local, cloud.id)).toEqual(["قاعده اجرا شد"]);
  });

  it("validates a pushed row against the organisation's UI policies", async () => {
    // the Windows app applies the policy to its own writes …
    const refused = await local.post(`/o/${org}/r/todo`, { short_description: "فوری", priority: "1" }, 400);
    expect(refused.error.details.fields.description).toBeTruthy();
    // … and a change that bypassed it there is refused by the cloud
    const row = (await local.post(`/o/${org}/r/todo`, { short_description: "معمولی", priority: "3" })).row;
    await client.syncNow();
    await deskDb.query(`update sm_todos set priority = '1' where id = $1`, [row.id]);
    await client.syncNow();
    expect((await web.get(`/o/${org}/r/todo/${row.id}`)).row.priority).toBe("3");
    const failed = await deskDb.one<{ attempts: number; last_error: string }>(`select attempts, last_error from sm_outbox where entity = 'todo' and id = $1`, [row.id]);
    expect(failed!.last_error).toContain("را وارد کنید");
    // with the field filled the push lands
    await deskDb.query(`update sm_todos set description = 'شرح کار فوری' where id = $1`, [row.id]);
    await client.syncNow();
    expect((await web.get(`/o/${org}/r/todo/${row.id}`)).row).toMatchObject({ priority: "1", description: "شرح کار فوری" });
    expect(await cloudDb.one<{ n: number }>(`select count(*)::int as n from sm_todos where org_id = $1 and id = $2`, [org, row.id])).toEqual({ n: 1 });
  });
});
