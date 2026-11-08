// The approver grant (docs/spec/ACCESS.md §6–7): whoever has or had an approval on a record reads that record — a
// requester-role member asked to approve a change (no role in the change area at all) or a requester-role manager
// approving a staff member's catalogue item — and nothing more: no other rows, no lists of the area, no hidden fields,
// no internal journal entries, no writes, no module routes; field groups and confidentiality still apply.
import { describe, it, expect, beforeAll } from "vitest";
import { world, type World } from "./change-helpers";
import { requestKit, type RequestKit, type Who } from "./request-helpers";

const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });

describe("the approver grant on changes (a requester with no role in the change area)", () => {
  let w: World;
  let change: Record<string, any>;
  let other: Record<string, any>;

  beforeAll(async () => {
    w = await world();
    change = await w.change(manual("moderate"));
    // the estimate is in the financial field group (the change manager's), set by the owner
    await w.o.patch(`${w.P}/r/change_request/${change.id}`, { planned_cost: "125000000" });
    other = await w.change(manual("moderate"));
    await w.move(change.id, ["assess", "authorize"]);
    await w.move(other.id, ["assess", "authorize"]);
  }, 180_000);

  it("reads nothing before an approval names them", async () => {
    const { P, p } = w;
    await p.req.client.get(`${P}/r/change_request/${change.id}`, 404);
    await p.req.client.get(`${P}/meta/tables/change_request`, 403);
    const tables = (await p.req.client.get(`${P}/meta/tables`)).tables as { key: string }[];
    expect(tables.some((t) => t.key === "change_request")).toBe(false);
  });

  it("reads the record they are asked to approve, as a participant, with the field groups of their roles", async () => {
    const { P, o, p } = w;
    await o.post(`${P}/approvals/record/change_request/${change.id}/request`, { users: [p.req.userId] });
    await o.post(`${P}/r/change_request/${change.id}/journal`, { kind: "work_note", body: "یادداشت داخلی کارشناسان" });
    await o.post(`${P}/r/change_request/${change.id}/journal`, { kind: "comment", body: "توضیح عمومی" });
    const r = await p.req.client.get(`${P}/r/change_request/${change.id}`);
    expect(r.row.id).toBe(change.id);
    expect(r.meta.reach).toBe("participant");
    expect(r.meta.canWrite).toBe(false);
    expect(r.meta.transitions).toEqual([]);
    // the financial field group of the agents' roles is not theirs
    expect("planned_cost" in r.row).toBe(false);
    const meta = await p.req.client.get(`${P}/meta/tables/change_request`);
    expect(meta.table.can).toMatchObject({ read: true, create: false, participant: true });
    expect(meta.table.fields.some((f: any) => f.name === "planned_cost")).toBe(false);
    const tables = (await p.req.client.get(`${P}/meta/tables`)).tables as { key: string; can: { participant?: boolean } }[];
    expect(tables.find((t) => t.key === "change_request")?.can.participant).toBe(true);
    // the journal without internal entries
    const journal = (await p.req.client.get(`${P}/r/change_request/${change.id}/journal`)).entries as { body: string; visibility: string }[];
    expect(journal.some((e) => e.body === "توضیح عمومی")).toBe(true);
    expect(journal.some((e) => e.visibility === "internal")).toBe(false);
    // the approvals panel of the record answers them
    const panel = await p.req.client.get(`${P}/approvals/record/change_request/${change.id}`);
    expect(panel.approvals.some((a: any) => a.approver_id === p.req.userId && a.can_decide)).toBe(true);
    // and «درخواست تأیید» reaches them, rendered from what they may read
    await w.drain();
    const inbox = (await p.req.client.get(`${P}/notify/inbox`)).items as { record_id: string; event: string; body: string }[];
    const asked = inbox.find((x) => x.record_id === change.id && x.event === "approval_requested");
    expect(asked).toBeTruthy();
    expect(asked!.body).not.toContain("125000000");
  });

  it("does not reveal other rows, lists, aggregates, children, writes or the module's routes", async () => {
    const { P, p } = w;
    await p.req.client.get(`${P}/r/change_request/${other.id}`, 404);
    await p.req.client.post(`${P}/r/change_request/query`, {}, 403);
    await p.req.client.get(`${P}/r/change_request`, 403);
    await p.req.client.post(`${P}/r/change_request/agg`, { metrics: [{ fn: "count" }] }, 403);
    await p.req.client.patch(`${P}/r/change_request/${change.id}`, { short_description: "تغییر من" }, 403);
    await p.req.client.post(`${P}/r/change_request/${change.id}/transition`, { to: "scheduled" }, 403);
    await p.req.client.get(`${P}/change/meta`, 403);
    await p.req.client.get(`${P}/change/dashboard`, 403);
    // the change's tasks are not part of the grant
    const task = await w.o.post(`${P}/r/change_task`, { change_id: change.id, short_description: "کار تغییر" });
    await p.req.client.get(`${P}/r/change_task/${task.row.id}`, 404);
  });

  it("keeps reading after deciding (had an approval); never through another person's", async () => {
    const { P, p } = w;
    const mine = (await p.req.client.get(`${P}/approvals/mine?scope=pending`)).approvals.find((a: any) => a.record_id === change.id);
    expect(mine).toBeTruthy();
    await p.req.client.post(`${P}/approvals/${mine.id}/decide`, { decision: "approved" });
    await w.drain();
    const r = await p.req.client.get(`${P}/r/change_request/${change.id}`);
    expect(r.meta.reach).toBe("participant");
    // still only that change
    await p.req.client.get(`${P}/r/change_request/${other.id}`, 404);
  });
});

describe("the approver grant on requested items (requester-role approvers)", () => {
  let k: RequestKit;
  let P = "";
  let boss: Who;
  let staff: Who;
  let colleague: Who;
  let stranger: Who;
  let item = "";
  let unrelated = "";

  beforeAll(async () => {
    k = await requestKit();
    P = k.P;
    boss = await k.person("approver-boss@example.com", { roles: ["requester"] });
    staff = await k.person("approver-staff@example.com", { roles: ["requester"], manager: boss.userId });
    colleague = await k.person("approver-colleague@example.com", { roles: ["requester"] });
    stranger = await k.person("approver-stranger@example.com", { roles: ["requester"] });
    const mailbox = await k.item("mailbox");
    item = (await staff.client.post(`${P}/request/order`, { lines: [{ item_id: mailbox.id, answers: { mailbox_type: "personal" } }] })).items[0].id;
    const other = await k.item("other_request");
    unrelated = (await staff.client.post(`${P}/request/order`, { lines: [{ item_id: other.id, answers: { subject: "میز", details: "طبقهٔ ۲" } }] })).items[0].id;
    await k.drain();
  }, 180_000);

  it("the line manager approves their staff member's item and keeps reading it", async () => {
    const pending = (await boss.client.get(`${P}/approvals/mine?scope=pending`)).approvals.find((a: any) => a.record_id === item);
    expect(pending).toBeTruthy();
    expect((await boss.client.get(`${P}/r/request_item/${item}`)).row.id).toBe(item);
    await boss.client.post(`${P}/approvals/${pending.id}/decide`, { decision: "approved" });
    await k.drain();
    const after = await boss.client.get(`${P}/r/request_item/${item}`);
    expect(after.row.id).toBe(item);
    expect(after.meta.canWrite).toBe(false);
    // the personal field group is not a requester's
    expect("private_answers" in after.row).toBe(false);
  });

  it("a requester asked to approve reads that item while asked and after deciding — and nothing else", async () => {
    await colleague.client.get(`${P}/r/request_item/${unrelated}`, 404);
    await k.o.owner.post(`${P}/approvals/record/request_item/${unrelated}/request`, { users: [colleague.userId] });
    expect((await colleague.client.get(`${P}/r/request_item/${unrelated}`)).row.id).toBe(unrelated);
    const pending = (await colleague.client.get(`${P}/approvals/mine?scope=pending`)).approvals.find((a: any) => a.record_id === unrelated);
    await colleague.client.post(`${P}/approvals/${pending.id}/decide`, { decision: "rejected", comment: "لازم نیست" });
    await k.drain();
    const after = await colleague.client.get(`${P}/r/request_item/${unrelated}`);
    expect(after.meta.canWrite).toBe(false);
    // the other item of the same person, and their order header, are not part of the grant
    await colleague.client.get(`${P}/r/request_item/${item}`, 404);
    await colleague.client.get(`${P}/r/request/${after.row.request_id}`, 404);
    const list = await colleague.client.get(`${P}/r/request_item`);
    expect(list.rows.map((r: any) => r.id)).toEqual([unrelated]);
    await stranger.client.get(`${P}/r/request_item/${unrelated}`, 404);
  });
});
