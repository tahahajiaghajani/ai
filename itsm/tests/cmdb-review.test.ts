// Regressions of the CMDB review: imports reconcile only CIs the importer may change; copies of CI data (baselines,
// de-duplication tasks) follow the readability of the CIs they copy; configuration control asks for a real
// authorising change; redundancy groups and certification tasks stay with the CIs their writer may change; the health
// pass closes only its own findings; serials typed with Persian digits are identified; the map's class filter does
// not reveal hidden neighbours.
import { beforeAll, describe, expect, it } from "vitest";
import { cmdbWorld, type CmdbWorld } from "./cmdb-helpers";
import type { Client } from "./helpers";

let w: CmdbWorld;
let soc: string;
const R = (t: string, id?: string) => `${w.P}/r/${t}${id ? `/${id}` : ""}`;
const C = (p: string) => `${w.P}/cmdb${p}`;
const as = (k: keyof CmdbWorld["p"]): Client => w.p[k].client;
const relsOf = async (who: Client, parent: string) => (await who.post(`${R("ci_rel")}/query`, { filter: { f: "parent_id", op: "eq", v: parent }, fields: ["type", "child_id", "valid_to"] })).rows;

beforeAll(async () => {
  w = await cmdbWorld();
  // a restricted group: only its members (am) read its CIs
  soc = (await w.o.post(R("group"), { name: "SOC", types: ["assignment"], restricted: true })).row.id;
  await w.o.post(`${w.P}/access/groups/${soc}/members`, { user_ids: [w.p.am.userId] });
  await w.drain();
}, 120_000);

describe("imports change only what the importer may change", () => {
  it("does not reconcile another group's CI, its ownership or its relationships", async () => {
    const victim = await w.ci({ name: "infra-ire-victim", class: "server", serial_number: "VER-1", manufacturer: "HP", support_group_id: w.g.infra, owned_by: w.p.am.userId, change_approval_group_id: w.g.infra });
    const other = await w.ci({ name: "infra-ire-other", class: "server", serial_number: "VER-2", support_group_id: w.g.infra });
    await as("am2").patch(R("ci", victim.id), { os: "Debian" }, 403);
    const item = { class: "server", values: { serial_number: "VER-1", manufacturer: "HP", support_group_id: w.g.network, owned_by: w.p.am2.userId, change_approval_group_id: w.g.network }, relations: [{ type: "depends_on", ci_id: other.id }] };
    // «ثبت دستی» is not an import source (it would beat hand-set values)
    const manual = (await w.o.post(`${R("cmdb_data_source")}/query`, { filter: { f: "kind", op: "eq", v: "manual" }, fields: ["name"] })).rows[0];
    await as("am2").post(C("/ire/items"), { source_id: manual.id, items: [item] }, 403);
    await as("am2").post(C("/import/runs"), { name: "ورود", source_id: manual.id }, 403);
    for (const dry of [true, false]) {
      const r = await as("am2").post(C("/ire/items"), { items: [item], dry_run: dry });
      expect(r.results[0]).toMatchObject({ action: "error", ci_id: null });
      expect(r.updated).toBe(0);
      expect(r.relations.created).toBe(0);
    }
    const after = (await w.o.get(R("ci", victim.id))).row;
    expect(after).toMatchObject({ owned_by: w.p.am.userId, support_group_id: w.g.infra, change_approval_group_id: w.g.infra });
    expect((await relsOf(w.o, victim.id)).filter((r: any) => r.child_id === other.id)).toHaveLength(0);
  });

  it("names no CI the importer cannot read, and relates new CIs only to readable ones", async () => {
    const hidden = await w.ci({ name: "fw-soc-hidden", class: "server", serial_number: "SOC-IRE-1", manufacturer: "Cisco", support_group_id: soc }, as("am"));
    await as("am2").get(R("ci", hidden.id), 404);
    const r = await as("am2").post(C("/ire/items"), { items: [{ class: "server", values: { serial_number: "SOC-IRE-1", manufacturer: "Cisco", os: "IOS" } }] });
    expect(r.results[0]).toMatchObject({ action: "error", ci_id: null, number: null });
    expect(JSON.stringify(r)).not.toContain("fw-soc-hidden");
    expect(JSON.stringify(r)).not.toContain(hidden.number);
    expect((await as("am").get(R("ci", hidden.id))).row.os ?? null).toBeNull();
    // a new CI of the importer may depend on what they read, never on a CI hidden from them
    const n = await as("am2").post(C("/ire/items"), { items: [{ class: "server", values: { name: "net-ire-new", serial_number: "NET-IRE-1", support_group_id: w.g.network }, relations: [{ type: "depends_on", ci_id: hidden.id }] }] });
    expect(n.results[0].action).toBe("created");
    expect(n.relations).toMatchObject({ created: 0, failed: 1 });
    expect(await relsOf(as("am"), n.results[0].ci_id)).toHaveLength(0);
  });

  it("updates the importer's own CIs but leaves their ownership to people", async () => {
    // brought in by an import (no value set by hand): only the anchor rule keeps its owner and group
    const mine = (await w.o.post(C("/ire/items"), { items: [{ class: "server", values: { name: "infra-ire-mine", serial_number: "MINE-1", manufacturer: "Dell", support_group_id: w.g.infra, owned_by: w.p.am.userId } }] })).results[0];
    const r = await as("am").post(C("/ire/items"), { items: [{ class: "server", values: { serial_number: "MINE-1", manufacturer: "Dell", ram_mb: 4096, owned_by: w.p.am2.userId, support_group_id: w.g.network } }] });
    expect(r.results[0]).toMatchObject({ action: "updated", ci_id: mine.ci_id });
    expect(r.results[0].skipped).toEqual(expect.arrayContaining(["owned_by", "support_group_id"]));
    expect((await w.o.get(R("ci", mine.ci_id))).row).toMatchObject({ ram_mb: 4096, owned_by: w.p.am.userId, support_group_id: w.g.infra });
    // an administrator's import still sets them (on a value no person set by hand)
    const first = await w.o.post(C("/ire/items"), { items: [{ class: "server", values: { name: "infra-ire-adm", serial_number: "ADM-1", manufacturer: "Dell" } }] });
    const admin = await w.o.post(C("/ire/items"), { items: [{ class: "server", values: { serial_number: "ADM-1", manufacturer: "Dell", owned_by: w.p.am2.userId } }] });
    expect(admin.results[0]).toMatchObject({ action: "updated", ci_id: first.results[0].ci_id });
    expect(admin.results[0].changed).toContain("owned_by");
  });
});

describe("a service's owners read its records within the record's restrictions", () => {
  it("reads linked incidents, never one of a restricted group they are outside", async () => {
    const svc = (await w.o.post(R("service"), { name: "خدمت حقوق و دستمزد", service_type: "business", description: "x", owner_id: w.p.req.userId })).row;
    const open = (await as("am").post(R("incident"), { short_description: "کندی سامانهٔ حقوق", assignment_group_id: w.g.infra, service_id: svc.id })).row;
    const plain = (await as("am").post(R("incident"), { short_description: "کندی سامانهٔ دیگر", assignment_group_id: w.g.infra })).row;
    const secret = (await as("am").post(R("incident"), { short_description: "نفوذ به سامانهٔ حقوق", assignment_group_id: soc, service_id: svc.id })).row;
    // a requester reads their own records only: the service role is what lets them read the linked one
    expect((await as("req").get(R("incident", open.id))).row.id).toBe(open.id);
    await as("req").get(R("incident", plain.id), 404);
    await as("req").get(R("incident", secret.id), 404);
    const listed = (await as("req").post(`${R("incident")}/query`, { filter: { f: "service_id", op: "eq", v: svc.id }, fields: ["number"] })).rows.map((r: any) => r.id);
    expect(listed).toContain(open.id);
    expect(listed).not.toContain(secret.id);
    // the access checker explains it the same way
    const why = await w.o.post(`${w.P}/access/check`, { user_id: w.p.req.userId, table: "incident", record_id: open.id });
    expect(why.record).toMatchObject({ sql_read: true, explanation: { read: true, via: "participant" } });
  });

  it("lets only portfolio managers name themselves owner or product owner", async () => {
    const svc = (await w.o.post(R("service"), { name: "خدمت ایمیل سازمانی", service_type: "business", description: "x", owner_id: w.p.cm.userId, relationship_manager_id: w.p.so.userId })).row;
    await as("so").patch(R("service", svc.id), { product_owner_id: w.p.so.userId }, 403);
    await as("so").patch(R("service", svc.id), { owner_id: w.p.so.userId }, 403);
    // naming someone else is a writer's call; a portfolio manager names anyone
    expect((await as("so").patch(R("service", svc.id), { product_owner_id: w.p.agent.userId })).row.product_owner_id).toBe(w.p.agent.userId);
    expect((await w.o.patch(R("service", svc.id), { product_owner_id: w.p.so.userId })).row.product_owner_id).toBe(w.p.so.userId);
  });
});
