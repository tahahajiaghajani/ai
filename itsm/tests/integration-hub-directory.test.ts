// LDAP / Active Directory synchronisation against a small in-test LDAP server (bind, paged search), always previewed
// before it is applied, never granting a role silently; and SCIM provisioning (Microsoft Entra ID's requests) with a
// dry run, the approving administrator's access, switched-off people instead of deleted ones and mapped groups only.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { Client } from "./helpers";
import { tick } from "@server/jobs";
import { berInt, berStr, encodeFilter, intOf, readTlv, seq, strOf, type BerNode } from "@server/modules/integration/ldap";
import { cnOf, entryFromLdap, groupMatches, planDirectorySync, AD_ATTRS } from "@shared/integration/directory";
import { parseScimFilter, patchGroup, patchUser, userFromScim } from "@shared/integration/scim";

const PAGED = "1.2.840.113556.1.4.319";
const IT = "CN=IT Support,OU=Groups,DC=corp,DC=ir";

interface Person {
  dn: string;
  attrs: Record<string, string[]>;
}

/** A tiny LDAP server: simple bind (password «pw») and a paged search over `people` (two entries a page). */
function fakeLdap(people: () => Person[]): Promise<{ port: number; close: () => void; binds: string[] }> {
  const binds: string[] = [];
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const r = readTlv(buf);
        if (!r) return;
        buf = buf.subarray(r.end);
        const [idNode, op, controls] = r.node.children;
        const id = intOf(idNode);
        if (op.tag === 0x60) {
          const [, name, auth] = op.children;
          binds.push(strOf(name));
          const ok = auth.value.toString() === "pw";
          sock.write(seq(0x30, berInt(id), seq(0x61, berInt(ok ? 0 : 49, 0x0a), berStr(""), berStr(ok ? "" : "invalid credentials"))));
        } else if (op.tag === 0x63) {
          let cookie = "";
          for (const ctl of (controls as BerNode | undefined)?.children ?? []) {
            const value = ctl.children.find((x) => x.tag === 0x04 && strOf(x) !== PAGED);
            if (value) cookie = strOf(readTlv(value.value)!.node.children[1]);
          }
          const all = people();
          const page = cookie === "" ? all.slice(0, 2) : all.slice(2);
          for (const p of page) {
            const attrs = Object.entries(p.attrs).map(([k, vals]) => seq(0x30, berStr(k), seq(0x31, ...vals.map((v) => berStr(v)))));
            sock.write(seq(0x30, berInt(id), seq(0x64, berStr(p.dn), seq(0x30, ...attrs))));
          }
          const next = cookie === "" && all.length > 2 ? "page2" : "";
          sock.write(seq(0x30, berInt(id), seq(0x65, berInt(0, 0x0a), berStr(""), berStr("")), seq(0xa0, seq(0x30, berStr(PAGED), berStr(seq(0x30, berInt(0), berStr(next)))))));
        } else if (op.tag === 0x42) {
          sock.end();
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close(), binds })));
}

const person = (cn: string, mail: string | null, extra: Record<string, string[]> = {}): Person => ({
  dn: `CN=${cn},OU=Staff,DC=corp,DC=ir`,
  attrs: { displayName: [cn], ...(mail ? { mail: [mail] } : {}), userAccountControl: ["512"], ...extra },
});

describe("LDAP / Active Directory synchronisation", () => {
  let e: EngineOrg;
  let P: string;
  let ldap: Awaited<ReturnType<typeof fakeLdap>>;
  let people: Person[];
  let src: { id: string };
  let itGroup: string;

  beforeAll(async () => {
    people = [
      person("Ali Rezaei", "ali@corp.ir", { title: ["کارشناس شبکه"], department: ["فناوری اطلاعات"], memberOf: [IT], manager: ["CN=Maryam Kazemi,OU=Staff,DC=corp,DC=ir"] }),
      person("Maryam Kazemi", "maryam@corp.ir", { department: ["فناوری اطلاعات"] }),
      person("Reza Ahmadi", "reza@corp.ir", { department: ["مالی"] }),
      person("No Mail", null),
    ];
    ldap = await fakeLdap(() => people);
    e = await engineOrg({ mode: "desktop" });
    P = `/o/${e.org}`;
    itGroup = (await e.owner.post(`${P}/r/group`, { name: "پشتیبانی فناوری", types: ["assignment"] })).row.id;
    src = (
      await e.owner.post(`${P}/r/directory_source`, {
        name: "اکتیو دایرکتوری دفتر مرکزی",
        kind: "ldap",
        mode: "apply",
        ldap_url: `ldap://127.0.0.1:${ldap.port}`,
        bind_dn: "CN=svc-itsm,OU=Service,DC=corp,DC=ir",
        bind_password: "pw",
        base_dn: "DC=corp,DC=ir",
        unit_from: "department",
        group_map: [{ source: IT, group_id: itGroup, role: "agent" }],
      })
    ).row;
  });
  afterAll(() => ldap.close());

  const members = async () => ((await e.owner.get(`${P}/members`)).members as { user_id: string; email: string; is_active: boolean; role: string }[]);
  const roles = async (email: string) => {
    const m = (await e.owner.get(`${P}/access/members`)).members as { email: string; roles: string[]; user_id: string }[];
    return m.find((x) => x.email === email)!;
  };

  it("tests the connection (bind and a paged search)", async () => {
    const t = await e.owner.post(`${P}/integration/directory/${src.id}/test`);
    expect(t).toMatchObject({ ok: true, count: 4 });
    expect(ldap.binds).toContain("CN=svc-itsm,OU=Service,DC=corp,DC=ir");
  });

  it("previews without writing anything", async () => {
    const before = (await members()).length;
    const p = await e.owner.post(`${P}/integration/directory/${src.id}/preview`);
    expect(p.stats).toMatchObject({ create: 3, skipped: 1, units: 2, role_grants: 1, group_adds: 1 });
    expect(p.plan.create.find((c: { email: string }) => c.email === "ali@corp.ir").roles).toEqual(["requester"]);
    expect(p.plan.role_grants[0]).toMatchObject({ email: "ali@corp.ir", role: "agent" });
    expect((await members()).length).toBe(before);
  });

  it("applies the previewed plan; mapped roles wait for the administrator's confirmation", async () => {
    const p = await e.owner.post(`${P}/integration/directory/${src.id}/preview`);
    const r = await e.owner.post(`${P}/integration/directory/${src.id}/apply`, { run_id: p.run_id, roles: false });
    expect(r).toMatchObject({ created: 3, roles_granted: 0, roles_pending: 1, units: 2 });
    const ali = await roles("ali@corp.ir");
    expect(ali.roles).toEqual(["requester"]);
    const detail = await e.owner.get(`${P}/access/members/${ali.user_id}`);
    const maryam = await roles("maryam@corp.ir");
    expect(detail.profile.manager_id).toBe(maryam.user_id);
    expect(detail.profile.title).toBe("کارشناس شبکه");
    const groupMembers = (await e.owner.get(`${P}/r/group_member?filter=${encodeURIComponent(JSON.stringify({ f: "group_id", op: "eq", v: itGroup }))}`)).rows;
    expect(groupMembers.map((g: { user_id: string }) => g.user_id)).toContain(ali.user_id);
    // confirmed: the mapped role is granted
    const p2 = await e.owner.post(`${P}/integration/directory/${src.id}/preview`);
    expect(p2.stats.create).toBe(0);
    await e.owner.post(`${P}/integration/directory/${src.id}/apply`, { run_id: p2.run_id, roles: true });
    expect((await roles("ali@corp.ir")).roles.sort()).toEqual(["agent", "requester"]);
  });

  it("switches off people disabled in or removed from the directory — only the ones it manages", async () => {
    const manual = await e.member("member", "manual@corp.ir");
    people = people.map((p) => (p.attrs.mail?.[0] === "reza@corp.ir" ? { ...p, attrs: { ...p.attrs, userAccountControl: ["514"] } } : p)).filter((p) => p.attrs.mail?.[0] !== "maryam@corp.ir");
    const p = await e.owner.post(`${P}/integration/directory/${src.id}/preview`);
    expect(p.plan.deactivate.map((d: { email: string }) => d.email).sort()).toEqual(["maryam@corp.ir", "reza@corp.ir"]);
    await e.owner.post(`${P}/integration/directory/${src.id}/apply`, { run_id: p.run_id, roles: false });
    const all = await members();
    expect(all.find((m) => m.email === "reza@corp.ir")!.is_active).toBe(false);
    expect(all.find((m) => m.email === "maryam@corp.ir")!.is_active).toBe(false);
    expect(all.find((m) => m.user_id === manual.userId)!.is_active).toBe(true);
  });

  it("refuses wrong credentials, a preview-only source and members without the right", async () => {
    const bad = (await e.owner.post(`${P}/r/directory_source`, { name: "گذرواژهٔ نادرست", kind: "ldap", ldap_url: `ldap://127.0.0.1:${ldap.port}`, bind_dn: "CN=x", bind_password: "nope", base_dn: "DC=corp,DC=ir" })).row;
    const r = await e.owner.req("POST", `${P}/integration/directory/${bad.id}/preview`, {}, 400);
    expect(r.error.message).toContain("گذرواژه");
    const p = await e.owner.req("POST", `${P}/integration/directory/${src.id}/preview`, {});
    const cur = await e.owner.get(`${P}/r/directory_source/${src.id}`);
    await e.owner.patch(`${P}/r/directory_source/${src.id}`, { mode: "preview", version: cur.row.version });
    await e.owner.req("POST", `${P}/integration/directory/${src.id}/apply`, { run_id: p.run_id }, 409);
    const m = await e.member("member", "someone@corp.ir");
    await m.client.req("POST", `${P}/integration/directory/${src.id}/preview`, {}, 403);
  });

  it("encodes filters and maps entries (pure)", () => {
    expect(encodeFilter("(&(objectClass=user)(!(mail=*))(cn=Ali*))")[0]).toBe(0xa0);
    expect(() => encodeFilter("(&(objectClass=user)")).toThrow();
    expect(cnOf(IT)).toBe("IT Support");
    expect(groupMatches(IT, "it support")).toBe(true);
    const entry = entryFromLdap("CN=X,DC=a", { mail: ["X@A.IR"], displayName: ["X"], userAccountControl: ["514"] }, AD_ATTRS);
    expect(entry).toMatchObject({ email: "x@a.ir", active: false });
    const plan = planDirectorySync({ entries: [entry], members: [], links: {}, mappings: [], units: [], options: { default_role: null, deactivate_missing: true, unit_from: "none", auto_roles: false } });
    expect(plan.skipped[0].reason).toContain("غیرفعال");
  });
});

describe("SCIM provisioning (Microsoft Entra ID)", () => {
  let e: EngineOrg;
  let P: string;
  let src: { id: string };
  let token: string;
  let itGroup: string;
  const scim = (method: string, path: string, body?: unknown, t = token) =>
    e.app.fetch(new Request(`http://local.test/api/v1/scim/${src.id}${path}`, { method, headers: { authorization: `Bearer ${t}`, "content-type": "application/scim+json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  const json = async (r: Response | Promise<Response>) => (await r).json();

  beforeAll(async () => {
    e = await engineOrg();
    P = `/o/${e.org}`;
    // SCIM is in the enterprise plan: the platform owner (the first account) moves the organisation onto it
    await e.owner.put(`/admin/orgs/${e.org}/plan`, { plan: "enterprise" });
    itGroup = (await e.owner.post(`${P}/r/group`, { name: "مدیران فناوری", types: ["assignment"] })).row.id;
    src = (await e.owner.post(`${P}/r/directory_source`, { name: "Entra ID", kind: "scim", mode: "preview", group_map: [{ source: "IT Admins", group_id: itGroup, role: "agent" }] })).row;
    token = (await e.owner.post(`${P}/integration/secret`, { table: "directory_source", id: src.id })).secret;
  });

  const user = { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: "sara@corp.ir", externalId: "aad-1", displayName: "سارا محمدی", title: "کارشناس", emails: [{ value: "sara@corp.ir", primary: true }], active: true };

  it("answers but changes nothing in the dry run, and records what it would do", async () => {
    const r = await scim("POST", "/Users", user);
    expect(r.status).toBe(201);
    expect(((await e.owner.get(`${P}/members`)).members as { email: string }[]).some((m) => m.email === "sara@corp.ir")).toBe(false);
    expect((await json(scim("GET", `/Users?filter=${encodeURIComponent('userName eq "sara@corp.ir"')}`))).totalResults).toBe(0);
    const runs = await e.owner.get(`${P}/integration/directory/${src.id}/runs`);
    const run = await e.owner.get(`${P}/integration/directory/runs/${runs.runs[0].id}`);
    expect(run.run.plan.items[0]).toMatchObject({ op: "create_user", email: "sara@corp.ir", dry_run: true });
    expect((await scim("GET", "/Users", undefined, "wrong")).status).toBe(401);
  });

  it("provisions people as the approving administrator; never deletes; maps groups without granting roles silently", async () => {
    await e.owner.post(`${P}/integration/directory/${src.id}/approve`);
    const cur = await e.owner.get(`${P}/r/directory_source/${src.id}`);
    await e.owner.patch(`${P}/r/directory_source/${src.id}`, { mode: "apply", version: cur.row.version });
    const created = await json(scim("POST", "/Users", user));
    expect(created).toMatchObject({ userName: "sara@corp.ir", active: true });
    const found = await json(scim("GET", `/Users?filter=${encodeURIComponent('userName eq "sara@corp.ir"')}`));
    expect(found.Resources[0].id).toBe(created.id);
    const access = ((await e.owner.get(`${P}/access/members`)).members as { email: string; roles: string[] }[]).find((m) => m.email === "sara@corp.ir")!;
    expect(access.roles).toEqual(["requester"]);
    // a group the provider pushes, mapped to an ITSM group with a role: membership yes, role only after confirmation
    const g = await json(scim("POST", "/Groups", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "IT Admins" }));
    expect((await scim("PATCH", `/Groups/${g.id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "add", path: "members", value: [{ value: created.id }] }] })).status).toBe(204);
    const gm = (await e.owner.get(`${P}/r/group_member?filter=${encodeURIComponent(JSON.stringify({ f: "group_id", op: "eq", v: itGroup }))}`)).rows;
    expect(gm.map((x: { user_id: string }) => x.user_id)).toContain(created.id);
    expect(((await e.owner.get(`${P}/access/members`)).members as { email: string; roles: string[] }[]).find((m) => m.email === "sara@corp.ir")!.roles).toEqual(["requester"]);
    // switched off, then «deleted»: the membership stays, inactive
    const off = await json(scim("PATCH", `/Users/${created.id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] }));
    expect(off.active).toBe(false);
    expect((await scim("DELETE", `/Users/${created.id}`)).status).toBe(204);
    const m = ((await e.owner.get(`${P}/members`)).members as { email: string; is_active: boolean }[]).find((x) => x.email === "sara@corp.ir")!;
    expect(m.is_active).toBe(false);
    const sp = await json(scim("GET", "/ServiceProviderConfig"));
    expect(sp.patch.supported).toBe(true);
  });

  it("never adds people silently to a group whose membership grants roles or a secure workspace", async () => {
    // an HR group carries its role and its secure workspace (ESM's departments): membership there is a role grant
    const ws = (await e.owner.post(`${P}/r/workspace`, { key: "hr_scim", name: "منابع انسانی آزمون", secure: true })).row.id;
    const hrGroup = (await e.owner.post(`${P}/r/group`, { name: "کارشناسان منابع انسانی آزمون", types: ["assignment"], roles: ["hr_agent"], workspace_id: ws })).row.id;
    const cur = await e.owner.get(`${P}/r/directory_source/${src.id}`);
    await e.owner.patch(`${P}/r/directory_source/${src.id}`, { group_map: [...(cur.row.group_map ?? []), { source: "HR Staff", group_id: hrGroup, role: null }], version: cur.row.version });
    const reza = await json(scim("POST", "/Users", { ...user, userName: "reza@corp.ir", externalId: "aad-2", displayName: "رضا", emails: [{ value: "reza@corp.ir", primary: true }] }));
    const g = await json(scim("POST", "/Groups", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"], displayName: "HR Staff" }));
    expect((await scim("PATCH", `/Groups/${g.id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "add", path: "members", value: [{ value: reza.id }] }] })).status).toBe(204);
    const members = (await e.owner.get(`${P}/r/group_member?filter=${encodeURIComponent(JSON.stringify({ f: "group_id", op: "eq", v: hrGroup }))}`)).rows as { user_id: string }[];
    expect(members.map((x) => x.user_id)).not.toContain(reza.id);
    // with automatic roles on the source, the same push adds them
    const now = await e.owner.get(`${P}/r/directory_source/${src.id}`);
    await e.owner.patch(`${P}/r/directory_source/${src.id}`, { auto_roles: true, version: now.row.version });
    expect((await scim("PATCH", `/Groups/${g.id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "add", path: "members", value: [{ value: reza.id }] }] })).status).toBe(204);
    const after = (await e.owner.get(`${P}/r/group_member?filter=${encodeURIComponent(JSON.stringify({ f: "group_id", op: "eq", v: hrGroup }))}`)).rows as { user_id: string }[];
    expect(after.map((x) => x.user_id)).toContain(reza.id);
  });

  it("parses Entra ID's filters and patches (pure)", () => {
    expect(parseScimFilter('userName eq "a@b.ir"')).toEqual({ attr: "username", value: "a@b.ir" });
    expect(parseScimFilter("userName sw a")).toBeNull();
    const u = userFromScim(user);
    expect(patchUser(u, [{ op: "Replace", path: "active", value: "False" }]).active).toBe(false);
    expect(patchUser(u, [{ op: "replace", value: { displayName: "سارا م." } }]).name).toBe("سارا م.");
    expect(patchGroup([{ op: "remove", path: 'members[value eq "u1"]' }, { op: "add", path: "members", value: [{ value: "u2" }] }])).toMatchObject({ add: ["u2"], remove: ["u1"] });
  });
});

// keep the job queue quiet between suites
afterAll(async () => undefined);
void tick;
