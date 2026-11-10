// Record engine tables between a Windows app and the cloud: a generic table (todo) with its journal, history,
// attachments and links travels both ways; numbers created on both sides are renumbered on the clash; pushed rows
// are validated by the engine and produce events on the cloud; attachment contents travel lazily (down) and after
// the push (up); secrets never travel; a record that leaves the linked account's scope is deleted from the desktop
// by a tombstone, and a moved scope epoch makes the desktop read everything again.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeServer, Client } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import { registerTable } from "@shared/tables";
import type { DesktopBridge, ServerConfig } from "@server/context";
import { quietLog } from "./helpers";
import { defaultProvider, setAccessProvider, type AccessProvider } from "@server/access/provider";
import { bumpScopeEpoch, scopeEpoch, systemCtx, updateIn, openSecret } from "@server/engine";
import { upload, raw, PNG } from "./engine-helpers";
import type { Db } from "@server/db";

// a synchronised table with a secret (each runtime seals its own)
registerTable({
  key: "vault",
  table: "sm_vaults",
  label: "گاوصندوق",
  plural: "گاوصندوق‌ها",
  icon: "lock",
  module: "core",
  area: "work",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true },
    { name: "token", label: "کلید", type: "secret" },
    // kept out of Windows-app replicas (FieldDef.noSync)
    { name: "note", label: "یادداشت حساس", type: "string", noSync: true },
  ],
  scope: {},
});

const EMAIL = "engine-sync@example.com";
const PASSWORD = "sync-pass-1405";

/** Hides todos tagged "secret" (and the custom field u_cost) from members on the cloud only (the desktop runs the default rules). */
let hideSecret = true;
let hideCost = false;
const cloudOnly: AccessProvider = {
  ...defaultProvider,
  name: "cloud-scope",
  visibleFields(ctx, def) {
    if (!hideCost || def.key !== "todo" || ctx.cfg.mode !== "cloud" || ctx.actor === "system") return null;
    return new Set(def.fields.map((f) => f.name).filter((n) => n !== "u_cost"));
  },
  readWhere(ctx, def, alias, params) {
    const base = defaultProvider.readWhere(ctx, def, alias, params);
    if (!hideSecret || def.key !== "todo" || ctx.cfg.mode !== "cloud" || ctx.actor === "system") return base;
    return `(${base}) and not coalesce(${alias}.tags ? 'secret', false)`;
  },
};

describe("record engine synchronisation", () => {
  let cloudDb: Db;
  let deskDb: Db;
  let web: Client;
  let local: Client;
  let client: SyncClient;
  let org = "";
  let cloudCfg: ServerConfig;
  let cloudApp: { fetch: (r: Request) => Response | Promise<Response> };
  let deskApp: { fetch: (r: Request) => Response | Promise<Response> };
  let restore: () => void;

  beforeAll(async () => {
    restore = setAccessProvider(cloudOnly);
    const cloudSrv = await makeServer({ mode: "cloud" });
    cloudDb = cloudSrv.db;
    cloudApp = cloudSrv.app;
    cloudCfg = { mode: "cloud", db: cloudDb, secret: "test-secret", allowSignup: true, platformAdmins: [], origin: "cloud", log: quietLog, fetch };
    const bridge = { notifyLocalWrite() {}, fetchBlob: (o: string, a: string) => client.fetchBlob(o, a) } as unknown as DesktopBridge;
    const deskSrv = await makeServer({ mode: "desktop", config: { desktop: bridge, secret: "desktop-secret" } });
    deskDb = deskSrv.db;
    deskApp = deskSrv.app;
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => cloudSrv.app.fetch(new Request(String(u), init))) as typeof fetch;
    web = new Client(cloudSrv.app, "http://cloud.test");
    await web.post("/auth/signup", { email: EMAIL, password: PASSWORD, full_name: "مالک ابری" });
    org = (await web.post<{ id: string }>("/orgs", { name: "سازمان هم‌گام", timezone: "Asia/Tehran" })).id;
    // before the desktop exists: a record with a comment and an attachment, and a secret
    const a = (await web.post(`/o/${org}/r/todo`, { short_description: "ابری ۱", tags: ["شبکه"] })).row;
    await web.post(`/o/${org}/r/todo/${a.id}/journal`, { body: "پاسخ ابری" });
    await upload(cloudSrv.app, web, `/o/${org}/r/todo/${a.id}/attachments`, "screen.png", PNG);
    await web.post(`/o/${org}/r/vault`, { name: "SMTP", token: "smtp-password-123" });
    client = new SyncClient({ db: deskDb, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
    await client.link({ url: "http://cloud.test", email: EMAIL, password: PASSWORD, orgId: org, direction: "download" });
    local = new Client(deskSrv.app, "http://desk.test");
    await local.post("/auth/login", { email: EMAIL, password: PASSWORD });
  });
  afterAll(() => restore());

  const todos = async (db: Db) =>
    (await db.query<{ number: string; short_description: string; state: string }>(`select number, short_description, state from sm_todos where org_id = $1 and deleted_at is null order by no`, [org])).map((r) => `${r.number} ${r.short_description} ${r.state}`);

  it("downloads records with their journal, history and attachment metadata; contents come on first use", async () => {
    expect(await todos(deskDb)).toEqual(["TODO0000001 ابری ۱ new"]);
    const r = (await local.get(`/o/${org}/r/todo`)).rows[0];
    expect((await local.get(`/o/${org}/r/todo/${r.id}/journal`)).entries.map((x: { body: string }) => x.body)).toEqual(["پاسخ ابری"]);
    expect((await local.get(`/o/${org}/r/todo/${r.id}/history`)).entries.length).toBeGreaterThan(2);
    const atts = (await local.get(`/o/${org}/r/todo/${r.id}/attachments`)).attachments;
    expect(atts.map((x: { name: string }) => x.name)).toEqual(["screen.png"]);
    expect(await deskDb.one(`select 1 from sm_blobs`)).toBeNull();
    const dl = await raw(deskApp, local, `/o/${org}/attachments/${atts[0].id}/content`);
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PNG);
    expect(await deskDb.one(`select 1 from sm_blobs`)).toBeTruthy(); // kept for next time
  });

  it("keeps fields marked noSync out of the Windows app's replica: never pulled, never emptied by a push, cleared after upload", async () => {
    const made = (await web.post(`/o/${org}/r/vault`, { name: "حساس", note: "فقط روی وب" })).row;
    await client.syncNow();
    expect(await deskDb.one(`select name, note from sm_vaults where id = $1`, [made.id])).toEqual({ name: "حساس", note: null });
    // a change on the Windows app does not empty it on the web version
    await local.patch(`/o/${org}/r/vault/${made.id}`, { name: "حساس ۲" });
    await client.syncNow();
    expect(await cloudDb.one(`select name, note from sm_vaults where id = $1`, [made.id])).toEqual({ name: "حساس ۲", note: "فقط روی وب" });
    // typed on the Windows app: it reaches the web version, then leaves this computer
    const here = (await local.post(`/o/${org}/r/vault`, { name: "محلی", note: "تایپ‌شده در ویندوز" })).row;
    await client.syncNow();
    expect((await cloudDb.one<{ note: string }>(`select note from sm_vaults where id = $1`, [here.id]))?.note).toBe("تایپ‌شده در ویندوز");
    expect((await deskDb.one<{ note: string | null }>(`select note from sm_vaults where id = $1`, [here.id]))?.note).toBeNull();
  });

  it("never moves secrets: each runtime keeps its own", async () => {
    const v = await deskDb.one<{ id: string; name: string; token: string | null }>(`select id, name, token from sm_vaults where org_id = $1`, [org]);
    expect(v).toMatchObject({ name: "SMTP", token: null });
    await local.patch(`/o/${org}/r/vault/${v!.id}`, { name: "SMTP اصلی" });
    await client.syncNow();
    const c = await cloudDb.one<{ name: string; token: string }>(`select name, token from sm_vaults where id = $1`, [v!.id]);
    expect(c!.name).toBe("SMTP اصلی");
    expect(openSecret("test-secret", org, "vault", "token", v!.id, c!.token)).toBe("smtp-password-123");
    expect((await web.get(`/o/${org}/r/vault/${v!.id}`)).row.token).toEqual({ secret: true, hint: "…-123" });
  });

  it("renumbers a record created on both sides with the same number", async () => {
    const offline = (await local.post(`/o/${org}/r/todo`, { short_description: "ویندوزی" })).row;
    expect(offline.number).toBe("TODO0000002");
    await local.post(`/o/${org}/r/todo/${offline.id}/journal`, { kind: "work_note", body: "یادداشت ویندوز" });
    const pic = await (await upload(deskApp, local, `/o/${org}/r/todo/${offline.id}/attachments`, "desk.png", new Uint8Array([...PNG, 1]))).json();
    const online = (await web.post(`/o/${org}/r/todo`, { short_description: "ابری ۲" })).row;
    expect(online.number).toBe("TODO0000002");
    const state = await client.syncNow();
    expect(state.last_error).toBeNull();
    expect(await todos(cloudDb)).toEqual(["TODO0000001 ابری ۱ new", "TODO0000002 ابری ۲ new", "TODO0000003 ویندوزی new"]);
    expect(await todos(deskDb)).toEqual(await todos(cloudDb));
    // the desktop's journal entry and attachment arrived, and so did the attachment's content
    const j = await web.get(`/o/${org}/r/todo/${offline.id}/journal`);
    expect(j.entries.map((x: { body: string; visibility: string }) => [x.body, x.visibility])).toEqual([["یادداشت ویندوز", "internal"]]);
    const dl = await raw(cloudApp, web, `/o/${org}/attachments/${pic.attachment.id}/content`);
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(new Uint8Array([...PNG, 1]));
    // the next number on each side continues after the highest one
    expect((await local.post(`/o/${org}/r/todo`, { short_description: "بعدی" })).row.number).toBe("TODO0000004");
    await client.syncNow();
  });

  it("applies pushed changes with the engine's rules and events", async () => {
    const id = (await deskDb.one<{ id: string }>(`select id from sm_todos where short_description = 'ویندوزی'`))!.id;
    await local.post(`/o/${org}/r/todo/${id}/transition`, { to: "in_progress" });
    await client.syncNow();
    expect((await web.get(`/o/${org}/r/todo/${id}`)).row.state).toBe("in_progress");
    const ev = await cloudDb.query<{ kind: string; payload: Record<string, unknown> }>(`select kind, payload from sm_jobs where org_id = $1 and payload->>'id' = $2 order by created_at`, [org, id]);
    expect(ev.map((x) => x.kind)).toEqual(expect.arrayContaining(["record.created", "record.state_changed"]));
    expect(ev.find((x) => x.kind === "record.state_changed")!.payload).toMatchObject({ from: "new", to: "in_progress", via: "sync" });
    // a value the engine refuses stays on the desktop with the refusal as its error
    await deskDb.query(`update sm_todos set priority = '9' where id = $1`, [id]);
    await client.syncNow();
    expect((await web.get(`/o/${org}/r/todo/${id}`)).row.priority).toBe("4");
    const failed = await deskDb.one<{ attempts: number; last_error: string }>(`select attempts, last_error from sm_outbox where entity = 'todo' and id = $1`, [id]);
    expect(failed).toMatchObject({ attempts: 1, last_error: "«9» از گزینه‌های «اولویت» نیست" });
    await deskDb.query(`update sm_todos set priority = '2' where id = $1`, [id]);
    await client.syncNow();
    expect((await web.get(`/o/${org}/r/todo/${id}`)).row.priority).toBe("2");
  });

  it("keeps the cloud's values of fields the account may not see when it pushes a record", async () => {
    await web.post(`/o/${org}/r/custom_field`, { table_key: "todo", name: "u_cost", label: "هزینه", type: "money" });
    const id = (await web.post(`/o/${org}/r/todo`, { short_description: "هزینه‌دار" })).row.id;
    const sys = await systemCtx(cloudCfg, org);
    await sys.write((tx) => updateIn(tx, sys, "todo", id, { u_cost: "500" }));
    hideCost = true;
    try {
      await client.syncNow();
      const desk = await deskDb.one<{ custom: Record<string, unknown> }>(`select custom from sm_todos where id = $1`, [id]);
      expect(desk!.custom).toEqual({}); // never sent to this account
      await local.patch(`/o/${org}/r/todo/${id}`, { short_description: "هزینه‌دار (ویرایش ویندوز)" });
      await client.syncNow();
      const cloud = await cloudDb.one<{ short_description: string; custom: Record<string, unknown> }>(`select short_description, custom from sm_todos where id = $1`, [id]);
      expect(cloud).toEqual({ short_description: "هزینه‌دار (ویرایش ویندوز)", custom: { u_cost: "500" } });
    } finally {
      hideCost = false;
    }
  });

  it("deletes from the desktop what the account may no longer read, and brings it back after a scope change", async () => {
    const first = (await cloudDb.one<{ id: string }>(`select id from sm_todos where no = 1 and org_id = $1`, [org]))!.id;
    // someone moves the record out of the account's scope (here: tags it «secret»)
    const sys = await systemCtx(cloudCfg, org);
    await sys.write((tx) => updateIn(tx, sys, "todo", first, { tags: ["secret"] }));
    await client.syncNow();
    expect(await todos(deskDb)).not.toContain("TODO0000001 ابری ۱ new");
    for (const t of ["sm_journal", "sm_history", "sm_attachments"]) {
      expect((await deskDb.one<{ n: number }>(`select count(*)::int as n from ${t} where record_id = $1`, [first]))!.n, t).toBe(0);
    }
    // the screenshot's content went with it (the other attachment's content stays)
    expect((await deskDb.query<{ size: number }>(`select size from sm_blobs order by size`)).map((b) => Number(b.size))).toEqual([PNG.byteLength + 1]);
    // the scope widens again (another rule, a new group…): the epoch moves and the desktop reads everything again
    hideSecret = false;
    await bumpScopeEpoch(cloudDb, org, (await web.get("/auth/me")).user.id);
    await client.syncNow();
    expect(await todos(deskDb)).toContain("TODO0000001 ابری ۱ new");
    expect((await deskDb.one<{ n: number }>(`select count(*)::int as n from sm_journal where record_id = $1`, [first]))!.n).toBe(1);
    const cloudEpoch = await scopeEpoch(cloudDb, org, (await web.get("/auth/me")).user.id);
    expect(cloudEpoch).toBe(2); // 1 when the membership was made, 2 after the bump
    // the pull's epoch is the organisation's sync epoch and the member's scope epoch (SYNC_PROTOCOL 15)
    const orgEpoch = Number((await cloudDb.one<{ epoch: number }>(`select epoch from sm_org_sync where org_id = $1`, [org]))?.epoch ?? 0);
    expect(await deskDb.one<{ value: string }>(`select value from sm_kv where key = 'sync.epoch'`)).toMatchObject({ value: `${orgEpoch}.${cloudEpoch}` });
  });
});
