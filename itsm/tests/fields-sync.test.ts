// F1 — the field library on a Windows app (design F §3.1, §7.3; review F1-14): a desktop linked to the web version
// pulls the organisation's field types, its library fields and the custom_field rows that attach them (library_id,
// form_hidden, required_for, and the field's definition the row carries in options.field), and its own engine builds
// the same field: from the library rows where the account reads «طراحی فرم و گردش‌کار», from the row's own copy where
// it does not (a member without ITSM roles reads «تنظیمات» by their membership, not the library). The desktop validates
// the field's rules and the organisation's requirement as the web version does, pushes values back, and a later change
// of the library reaches both kinds of desktop.
import { describe, it, expect, beforeAll } from "vitest";
import { makeServer, Client, quietLog } from "./helpers";
import { SyncClient } from "@local/sync-client";
import { defaultConfig } from "@local/config";
import type { DesktopBridge } from "@server/context";
import type { Db } from "@server/db";
import type { FieldDef, TableDef } from "@shared/model/types";

const OWNER = { email: "fields-sync-owner@example.com", password: "owner-pass-1405" };
const AGENT = { email: "fields-sync-agent@example.com", password: "agent-pass-1405" };

type Msg = { error: { details?: { fields?: Record<string, string> } } };
interface Desk {
  db: Db;
  client: SyncClient;
  local: Client;
}

describe("library fields on a Windows app", () => {
  let cloudApp: { fetch: (r: Request) => Response | Promise<Response> };
  let web: Client;
  let org = "";
  let P = "";
  let libId = "";
  let typeId = "";
  const desks = {} as Record<"owner" | "agent", Desk>;

  async function link(who: typeof OWNER): Promise<Desk> {
    const desk = await makeServer({ mode: "desktop", config: { desktop: { notifyLocalWrite() {}, fetchBlob: async () => null } as unknown as DesktopBridge, secret: "desktop-secret" } });
    const cloudFetch = (async (u: RequestInfo | URL, init?: RequestInit) => cloudApp.fetch(new Request(String(u), init))) as typeof fetch;
    const client = new SyncClient({ db: desk.db, config: defaultConfig(), save() {}, log: quietLog, fetch: cloudFetch });
    await client.link({ url: "http://cloud.test", ...who, orgId: org, direction: "download" });
    const local = new Client(desk.app, "http://desk.test");
    await local.post("/auth/login", who);
    return { db: desk.db, client, local };
  }

  const fieldOn = async (c: Client, name: string) => ((await c.get(`/o/${org}/meta/tables/todo`)).table as TableDef).fields.find((f) => f.name === name) as FieldDef | undefined;

  beforeAll(async () => {
    const cloud = await makeServer();
    cloudApp = cloud.app;
    web = new Client(cloud.app, "http://cloud.test");
    await web.post("/auth/signup", { ...OWNER, full_name: "مالک" });
    org = (await web.post<{ id: string }>("/orgs", { name: "سازمان کتابخانهٔ فیلدها", timezone: "Asia/Tehran" })).id;
    P = `/o/${org}`;
    // a member without ITSM roles: «تنظیمات» by the membership's level, nothing in «طراحی فرم و گردش‌کار»
    await web.post(`${P}/members`, { ...AGENT, full_name: "کارشناس شعبه", role: "member" });
    // the library: an organisation type, a field of it attached to todo and required for agents, «مجرای دریافت» hidden
    typeId = (await web.post(`${P}/fields/types`, { key: "u_six_digits", name: "شش رقم", base: "string", validation: { pattern: "^\\d{6}$", patternMessage: "شش رقم" } }, 201)).row.id;
    libId = (await web.post(`${P}/fields/library`, { name: "u_personnel", label: "کد پرسنلی", type: "u_six_digits", help: "کد شش‌رقمی کارمند" }, 201)).row.id;
    await web.post(`${P}/fields/attach`, { table: "todo", field: libId, required: true, required_for: "agents" }, 201);
    await web.put(`${P}/forms/system/todo/overrides`, { fields: { channel: { form_hidden: true } } });
    desks.owner = await link(OWNER);
    desks.agent = await link(AGENT);
  }, 600_000);

  it("brings the attaching row with its new columns and the definition it carries, to every desktop", async () => {
    for (const d of [desks.owner, desks.agent]) {
      const row = await d.db.one<{ library_id: string; required: boolean; required_for: string; form_hidden: boolean; options: { field?: FieldDef } }>(
        `select library_id, required, required_for, form_hidden, options from sm_custom_fields where org_id = $1 and table_key = 'todo' and name = 'u_personnel' and deleted_at is null`,
        [org],
      );
      expect(row).toMatchObject({ library_id: libId, required: true, required_for: "agents", form_hidden: false });
      expect(row!.options.field).toMatchObject({ name: "u_personnel", label: "کد پرسنلی", type: "string", pattern: "^\\d{6}$", library: "u_personnel" });
      expect(await d.db.one(`select form_hidden from sm_custom_fields where org_id = $1 and table_key = 'todo' and name = 'channel' and deleted_at is null`, [org])).toEqual({ form_hidden: true });
    }
  });

  it("builds the field from the library rows where the account reads the library", async () => {
    const d = desks.owner;
    expect((await d.db.query<{ name: string }>(`select name from sm_field_defs where org_id = $1`, [org])).map((r) => r.name)).toEqual(["u_personnel"]);
    expect((await d.db.query<{ key: string }>(`select key from sm_field_types where org_id = $1`, [org])).map((r) => r.key)).toEqual(["u_six_digits"]);
    const want = { label: "کد پرسنلی", help: "کد شش‌رقمی کارمند", type: "string", pattern: "^\\d{6}$", patternMessage: "شش رقم", library: "u_personnel", custom: true, formRequired: "agents", required: true };
    expect(await fieldOn(d.local, "u_personnel")).toMatchObject(want);
    expect((await fieldOn(d.local, "channel"))?.formHidden).toBe(true);
    // the row's own copy is not what it reads: a stale copy changes nothing while the library rows are there
    await d.db.query(
      `update sm_custom_fields set options = jsonb_set(options, '{field,label}', '"نسخهٔ کهنه"'), updated_at = now() + interval '1 second' where org_id = $1 and name = 'u_personnel'`,
      [org],
    );
    expect((await fieldOn(d.local, "u_personnel"))?.label).toBe("کد پرسنلی");
  });

  it("builds it from the row's own copy where the account does not read the library", async () => {
    const d = desks.agent;
    expect(await d.db.query(`select 1 from sm_field_defs where org_id = $1`, [org])).toEqual([]);
    expect(await d.db.query(`select 1 from sm_field_types where org_id = $1`, [org])).toEqual([]);
    expect(await fieldOn(d.local, "u_personnel")).toMatchObject({ label: "کد پرسنلی", help: "کد شش‌رقمی کارمند", type: "string", pattern: "^\\d{6}$", patternMessage: "شش رقم", library: "u_personnel", custom: true, formRequired: "agents", required: true });
    expect((await fieldOn(d.local, "channel"))?.formHidden).toBe(true);
  });

  it("validates the field and the requirement on the desktop, and pushes the value to the web version", async () => {
    for (const d of [desks.owner, desks.agent]) {
      expect(((await d.local.post(`/o/${org}/r/todo`, { short_description: "کد کوتاه", u_personnel: "12" }, 400)) as Msg).error.details?.fields?.u_personnel).toBe("«کد پرسنلی»: شش رقم");
      expect(((await d.local.post(`/o/${org}/r/todo`, { short_description: "بی کد" }, 400)) as Msg).error.details?.fields).toEqual({ u_personnel: "«کد پرسنلی» را وارد کنید" });
    }
    const made = (await desks.agent.local.post(`/o/${org}/r/todo`, { short_description: "ثبت در ویندوز", u_personnel: "۱۲۳۴۵۶" })).row;
    const state = await desks.agent.client.syncNow();
    expect(state.last_error).toBeNull();
    expect((await web.get(`${P}/r/todo/${made.id}`)).row).toMatchObject({ short_description: "ثبت در ویندوز", u_personnel: "۱۲۳۴۵۶" });
  });

  it("follows a change of the library or its type on both kinds of desktop", async () => {
    await web.patch(`${P}/fields/library/${libId}`, { label: "شمارهٔ پرسنلی" });
    await web.patch(`${P}/fields/types/${typeId}`, { validation: { pattern: "^9\\d{5}$", patternMessage: "با ۹ آغاز می‌شود" } });
    for (const d of [desks.owner, desks.agent]) {
      expect((await d.client.syncNow()).last_error).toBeNull();
      expect(await fieldOn(d.local, "u_personnel")).toMatchObject({ label: "شمارهٔ پرسنلی", pattern: "^9\\d{5}$", patternMessage: "با ۹ آغاز می‌شود" });
      expect(((await d.local.post(`/o/${org}/r/todo`, { short_description: "کد کهنه", u_personnel: "123456" }, 400)) as Msg).error.details?.fields?.u_personnel).toBe("«شمارهٔ پرسنلی»: با ۹ آغاز می‌شود");
    }
  });
});
