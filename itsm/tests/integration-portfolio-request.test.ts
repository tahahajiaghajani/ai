// The service portfolio with the request catalogue, on real rows (SPF-011, SPF-014): a catalogue item bound to a
// service offering is listed for and orderable by the people the portfolio entitles to the offering only (an offering
// open to a group; a customer agreement of a unit), and every requested item keeps the entitlement it was ordered
// under — the offering, its service, the basis and the covering agreements — so a later change of the offering's
// audience does not rewrite history. The service's owner reads the requested items of their service.
import { beforeAll, describe, expect, it } from "vitest";
import { requestKit, type RequestKit, type Who } from "./request-helpers";

let k: RequestKit;
let P = "";
let insider: Who;
let outsider: Who;
let unitMember: Who;
let owner: Who;
let svc: Record<string, any>;
let vip: Record<string, any>;
let item: Record<string, any>;
let group = "";

const ANSWERS = { device: "company", os: "windows", end_date: "2030-01-01", reason: "کار از راه دور" };

beforeAll(async () => {
  k = await requestKit();
  P = k.P;
  const o = k.o.owner;
  await o.post(`${P}/cmdb/seed`, {});
  await o.post(`${P}/service_portfolio/seed`, {});
  insider = await k.person("vpn-insider@example.com", { roles: ["requester"] });
  outsider = await k.person("vpn-outsider@example.com", { roles: ["requester"] });
  unitMember = await k.person("vpn-unit@example.com", { roles: ["requester"] });
  owner = await k.person("vpn-owner@example.com", { roles: ["agent"] });
  group = (await o.post(`${P}/r/group`, { name: "کارکنان دورکار", types: ["assignment"] })).row.id;
  await k.addToGroup(group, [insider.userId]);
  // a live service with an offering only for the remote workers' group
  svc = (await o.post(`${P}/r/service`, { name: "دسترسی از راه دور", service_type: "technical", description: "VPN سازمانی", owner_id: owner.userId })).row;
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "approved" });
  vip = (await o.post(`${P}/r/service_offering`, { name: "VPN دورکاری", service_id: svc.id, entitled_everyone: false, entitled_groups: [group] })).row;
  await o.post(`${P}/r/service_offering/${vip.id}/transition`, { to: "active" });
  await o.post(`${P}/r/service/${svc.id}/transition`, { to: "live" });
  // a customer agreement of a unit covers the service for that unit's members
  const unit = (await o.post(`${P}/r/org_unit`, { name: "واحد فروش" })).row.id;
  await o.put(`${P}/access/members/${unitMember.userId}`, { org_unit_id: unit });
  await o.post(`${P}/r/service_agreement`, { name: "توافق فروش", service_id: svc.id, customer_unit_id: unit, status: "active" });
  // the catalogue item is the offering's
  item = await k.item("vpn_access");
  await o.patch(`${P}/r/catalog_item/${item.id}`, { offering_id: vip.id });
  await k.drain();
}, 240_000);

describe("catalogue items bound to a service offering", () => {
  it("are listed only for the people entitled to the offering", async () => {
    const codes = async (who: Who) => (await who.client.get(`${P}/request/catalog`)).items.map((i: any) => i.code);
    expect(await codes(insider)).toContain("vpn_access");
    expect(await codes(unitMember)).toContain("vpn_access");
    expect(await codes(outsider)).not.toContain("vpn_access");
    await outsider.client.get(`${P}/request/catalog/items/${item.id}`, 404);
    // other items stay where they were
    expect(await codes(outsider)).toContain("password_reset");
  });

  it("are refused to others on every path (ordering and the generic API)", async () => {
    const e = await outsider.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: ANSWERS }] }, 400);
    expect(e.error.message).toContain("در دسترس نیست");
    await outsider.client.post(`${P}/r/request_item`, { cat_item_id: item.id, answers: ANSWERS }, 400);
  });

  it("keep the entitlement on each requested item: the offering, its service and the basis", async () => {
    const a = await insider.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: ANSWERS }] });
    const ritm = await k.ritm(a.items[0].id);
    expect(ritm.offering_id).toBe(vip.id);
    expect(ritm.service_id).toBe(svc.id);
    expect(ritm.entitlement).toMatchObject({ offering_id: vip.id, service_id: svc.id, entitled: true, basis: "open", agreements: [] });
    const b = await unitMember.client.post(`${P}/request/order`, { lines: [{ item_id: item.id, answers: ANSWERS }] });
    const viaAgreement = await k.ritm(b.items[0].id);
    expect(viaAgreement.entitlement).toMatchObject({ entitled: true, basis: "agreement" });
    expect(viaAgreement.entitlement.agreements.map((g: any) => g.name)).toEqual(["توافق فروش"]);
    // a person cannot write the snapshot
    const mine = (await insider.client.get(`${P}/r/request_item/${a.items[0].id}`)).row;
    await insider.client.patch(`${P}/r/request_item/${mine.id}`, { entitlement: { entitled: false }, version: mine.version });
    expect((await k.ritm(a.items[0].id)).entitlement.entitled).toBe(true);
    // the service owner reads the requested items of their service (roles in context)
    expect((await owner.client.get(`${P}/r/request_item/${a.items[0].id}`)).row.id).toBe(a.items[0].id);
  });
});
