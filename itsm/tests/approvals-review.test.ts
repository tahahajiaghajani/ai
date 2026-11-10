// Regressions of the approvals review (docs/spec/services/sla.md): withdrawing approvals is for the area's approvers or
// whoever asked for an ad-hoc round — never a requester on their own record or an implementer — and a withdrawn round
// never counts as an approval; a re-run of the rules that leaves nothing open moves the record on; the approver grant
// counts only delegations of the record's own organisation.
import { beforeAll, describe, expect, it } from "vitest";
import { requestKit, type RequestKit, type Who } from "./request-helpers";
import { world as changeWorld, type World as ChangeWorld } from "./change-helpers";

describe("approvals review: requested items", () => {
  let k: RequestKit;
  let P = "";
  let manager: Who;
  let requester: Who;
  let buyer: Who;
  const order = async (answers: Record<string, unknown>) => {
    const laptop = await k.item("new_laptop");
    const r = await requester.client.post(`${P}/request/order`, { lines: [{ item_id: laptop.id, answers }] });
    return String(r.items[0].id);
  };

  beforeAll(async () => {
    k = await requestKit();
    P = k.P;
    manager = await k.person("rv-manager@example.com");
    requester = await k.person("rv-user@example.com", { roles: ["requester"], manager: manager.userId });
    buyer = await k.person("rv-buyer@example.com");
    await k.addToGroup(await k.group("تدارکات فناوری"), [buyer.userId]);
  }, 120_000);

  it("a requester cannot withdraw the approvals of their own item, and a withdrawal never approves it", async () => {
    const id = await order({ model: "standard", os: "windows", reason: "کارمند جدید" });
    expect((await k.ritm(id)).state).toBe("awaiting_approval");
    await requester.client.post(`${P}/approvals/record/request_item/${id}/cancel`, {}, 403);
    expect((await k.ritm(id)).state).toBe("awaiting_approval");
    expect((await k.approvals(id)).some((a) => a.state === "requested")).toBe(true);
    // the owner (the area's approve right) withdraws them: the item does not go to fulfilment for that
    await k.o.owner.post(`${P}/approvals/record/request_item/${id}/cancel`, {});
    await k.drain();
    const row = await k.ritm(id);
    expect(row.state).toBe("awaiting_approval");
    expect(row.fulfilment ?? null).not.toBe("flow");
  });

  it("answers edited while waiting re-run the rules; when nothing is left to decide the item moves on", async () => {
    const id = await order({ model: "standard", os: "windows", reason: "کارمند جدید" });
    expect((await k.ritm(id)).state).toBe("awaiting_approval");
    // every rule of the item now approves a dearer laptop by itself (as the edit below makes it)
    const ruleRows = await k.o.db.query<{ id: string }>(`select id from sm_approval_rules where org_id = $1 and table_key = 'request_item' and deleted_at is null`, [k.o.org]);
    expect(ruleRows.length).toBeGreaterThan(0);
    for (const r of ruleRows) await k.o.owner.patch(`${P}/r/approval_rule/${r.id}`, { auto_approve: { f: "price", op: "gt", v: "700000000" } });
    await requester.client.put(`${P}/request/items/${id}/answers`, { answers: { model: "performance", ram: "32", os: "windows", reason: "پروژهٔ تازه" } });
    await k.drain();
    const row = await k.ritm(id);
    expect(row.approval).toBe("approved");
    expect(row.state).not.toBe("awaiting_approval"); // never left waiting with nothing to decide
    expect(row.state).toBe("in_fulfilment");
  });
});

describe("approvals review: changes and delegations", () => {
  let w: ChangeWorld;
  const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });

  beforeAll(async () => {
    w = await changeWorld();
  }, 180_000);

  it("the implementer cannot withdraw the change manager's approval to get the change scheduled", async () => {
    const c = await w.change(manual("moderate"));
    await w.move(c.id, ["assess", "authorize"]);
    expect((await w.o.get(`${w.P}/r/change_request/${c.id}`)).row.state).toBe("authorize");
    await w.p.agent.client.post(`${w.P}/approvals/record/change_request/${c.id}/cancel`, {}, 403);
    const row = (await w.o.get(`${w.P}/r/change_request/${c.id}`)).row;
    expect(row.state).toBe("authorize");
    expect(row.authorized_at ?? null).toBeNull();
    // the change manager withdraws them: the change goes back to be assessed, never forward
    await w.p.cm.client.post(`${w.P}/approvals/record/change_request/${c.id}/cancel`, {});
    const back = (await w.o.get(`${w.P}/r/change_request/${c.id}`)).row;
    expect(back.state).toBe("assess");
    expect(back.authorized_at ?? null).toBeNull();
  });

  it("a delegation made in another organisation never lets the delegate read this one's records", async () => {
    const c = await w.change(manual("moderate"));
    await w.move(c.id, ["assess", "authorize"]);
    // the requester is asked to approve here; a requester with nothing to do with the change is their delegate — in
    // another organisation
    await w.o.post(`${w.P}/approvals/record/change_request/${c.id}/request`, { users: [w.p.req.userId] });
    const deleg = await w.e.member("member", "rv-delegate@example.com");
    await w.o.put(`${w.P}/access/members/${deleg.userId}`, { roles: ["requester"], persona: "requester" });
    await deleg.client.get(`${w.P}/r/change_request/${c.id}`, 404);
    const orgB = (await w.o.post(`/orgs`, { name: "سازمان دوم" })).id as string;
    for (const email of [(await w.e.db.one<{ email: string }>(`select email from sm_users where id = $1`, [w.p.req.userId]))!.email, "rv-delegate@example.com"]) {
      await w.o.post(`/o/${orgB}/members`, { email, full_name: "همکار", role: "member" });
    }
    await w.e.db.query(
      `insert into sm_delegations (id, org_id, from_user, to_user, starts_at, scopes, active) values (gen_random_uuid(), $1, $2, $3, now() - interval '1 hour', '["approvals"]'::jsonb, true)`,
      [orgB, w.p.req.userId, deleg.userId],
    );
    await deleg.client.get(`${w.P}/r/change_request/${c.id}`, 404);
    // the same delegation in this organisation does grant it (the check is not vacuous)
    await w.e.db.query(
      `insert into sm_delegations (id, org_id, from_user, to_user, starts_at, scopes, active) values (gen_random_uuid(), $1, $2, $3, now() - interval '1 hour', '["approvals"]'::jsonb, true)`,
      [w.e.org, w.p.req.userId, deleg.userId],
    );
    expect((await deleg.client.get(`${w.P}/r/change_request/${c.id}`)).row.id).toBe(c.id);
  });
});
