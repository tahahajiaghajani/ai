// Change enablement — the CAB: the next meeting of a CAB with its people and the agenda of changes waiting for it,
// one-click votes that are the member's own approvals (majority authorizes, a rejection needs a reason and sends the
// change back), the chair's decisions (defer, more information), separation of duties for the coordinator, the pack,
// minutes drafted from the decisions and sent when the meeting ends.
import { describe, expect, it, beforeAll } from "vitest";
import { world, type World } from "./change-helpers";

let w: World;
let cabId: string;
let meeting: Record<string, any>;
const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });
const itemOf = async (changeId: string) => (await w.p.cab1.client.get(`${w.P}/change/cab/workbench?meeting=${meeting.id}`)).items.find((i: any) => i.change_id === changeId);

beforeAll(async () => {
  w = await world();
  cabId = (await w.o.get(`${w.P}/r/cab?size=10`)).rows.find((c: any) => c.kind === "change").id;
}, 120_000);

describe("meetings and the agenda", () => {
  it("a waiting high-risk change joins the next meeting's agenda", async () => {
    const { P, p } = w;
    const c = await w.change(manual("high"));
    await w.move(c.id, ["assess", "authorize"]);
    expect((await w.get(c.id)).cab_id).toBe(cabId);
    const r = await p.cm.client.post(`${P}/change/cab/${cabId}/next`, {});
    meeting = r.meeting;
    expect(meeting.state).toBe("planned");
    expect(meeting.attendees.sort()).toEqual([p.cab1.userId, p.cab2.userId, p.cab3.userId].sort());
    const again = await p.cm.client.post(`${P}/change/cab/${cabId}/next`, {});
    expect(again.meeting.id).toBe(meeting.id);
    const wb = await p.cab1.client.get(`${P}/change/cab/workbench`);
    expect(wb.meeting.id).toBe(meeting.id);
    expect(wb.items.map((i: any) => i.change_id)).toContain(c.id);
    expect(wb.votes[c.id].my_approval).toBeTruthy();
    expect(wb.can_manage).toBe(false);
    const changed = await w.get(c.id);
    expect(changed.cab_meeting_id).toBe(meeting.id);
    expect(changed.status_reason).toBe("awaiting_cab");
  });

  it("members vote with one click; the majority authorizes the change", async () => {
    const { P, p } = w;
    const c = (await w.p.cab1.client.get(`${P}/change/cab/workbench?meeting=${meeting.id}`)).items[0];
    const first = await p.cab1.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${c.id}/decide`, { decision: "approved" });
    expect(first.item.decision).toBe("voting");
    expect(first.item.votes.approved).toBe(1);
    await p.cab1.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${c.id}/decide`, { decision: "approved" }, 403);
    const second = await p.cab2.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${c.id}/decide`, { decision: "approved" });
    expect(second.item.decision).toBe("approved");
    const change = await w.get(String(c.change_id));
    expect(change.state).toBe("scheduled");
    expect(change.cab_recommendation).toBe("approved");
  });

  it("a rejection needs a reason; once the majority can no longer approve, the change goes back to the draft", async () => {
    const { P, p } = w;
    const c = await w.change(manual("very_high"));
    await w.move(c.id, ["assess", "authorize"]);
    await p.cm.client.post(`${P}/change/cab/meetings/${meeting.id}/refresh`, {});
    const item = await itemOf(c.id);
    expect(item).toBeTruthy();
    const e = await p.cab3.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${item.id}/decide`, { decision: "rejected" }, 400);
    expect(e.error.details.fields.comment).toBeTruthy();
    // a majority rule: one «no» of three still leaves two possible approvals
    const one = await p.cab3.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${item.id}/decide`, { decision: "rejected", comment: "برنامهٔ بازگشت آزموده نشده است" });
    expect(one.item.decision).toBe("voting");
    const r = await p.cab1.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${item.id}/decide`, { decision: "rejected", comment: "هم‌زمان با بستن ماه مالی است" });
    expect(r.item.decision).toBe("rejected");
    const back = await w.get(c.id);
    expect(back.state).toBe("new");
    expect(back.status_reason).toBe("rejected");
  });

  it("the chair defers or asks for more information; members cannot", async () => {
    const { P, p } = w;
    const c = await w.change(manual("high"));
    await w.move(c.id, ["assess", "authorize"]);
    await p.cm.client.post(`${P}/change/cab/meetings/${meeting.id}/refresh`, {});
    const item = await itemOf(c.id);
    await p.cab1.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${item.id}/decide`, { decision: "deferred" }, 403);
    const deferred = await p.cm.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${item.id}/decide`, { decision: "deferred" });
    expect(deferred.item.decision).toBe("deferred");
    expect((await w.get(c.id)).cab_recommendation).toBe("deferred");
    await p.cm.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${item.id}/decide`, { decision: "info_requested" }, 400);
    await p.cm.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${item.id}/decide`, { decision: "info_requested", comment: "زمان قطعی را دقیق کنید" });
    const notes = (await w.o.get(`${P}/r/change_request/${c.id}/journal?kinds=work_note`)).entries;
    expect(notes.some((n: any) => String(n.body).includes("زمان قطعی را دقیق کنید"))).toBe(true);
  });

  it("the coordinator of a change is not among its CAB approvers", async () => {
    const { P, p } = w;
    const c = await w.change({ ...manual("high"), change_owner_id: p.cab3.userId });
    await w.move(c.id, ["assess", "authorize"]);
    const approvers = (await w.approvals(c.id)).map((a) => a.approver_id).sort();
    expect(approvers).toEqual([p.cab1.userId, p.cab2.userId].sort());
    void P;
  });
});

describe("pack, minutes and the end of the meeting", () => {
  it("drafts the pack and minutes, ends the meeting and sends the minutes to its people", async () => {
    const { P, p } = w;
    const pack = await p.cab1.client.get(`${P}/change/cab/meetings/${meeting.id}/pack`);
    expect(pack.markdown).toContain("بستهٔ جلسه");
    expect(pack.ai).toBe(false);
    const draft = await p.cm.client.get(`${P}/change/cab/meetings/${meeting.id}/minutes`);
    expect(draft.text).toContain("صورت‌جلسه");
    expect(draft.text).toContain("تأیید شد");
    const m = (await p.cm.client.get(`${P}/r/cab_meeting/${meeting.id}`)).row;
    await p.cab1.client.post(`${P}/change/cab/meetings/${meeting.id}/complete`, { minutes: draft.text, version: m.version }, 403);
    const done = await p.cm.client.post(`${P}/change/cab/meetings/${meeting.id}/complete`, { minutes: draft.text, version: m.version });
    expect(done.meeting.state).toBe("completed");
    expect(done.meeting.minutes_sent_at).toBeTruthy();
    const items = (await p.cm.client.get(`${P}/change/cab/workbench?meeting=${meeting.id}`)).items;
    expect(items.every((i: any) => !["pending", "voting"].includes(i.decision))).toBe(true);
    await w.drain();
    const inbox = (await p.cab2.client.get(`${P}/r/notification?size=50`)).rows;
    expect(inbox.some((n: any) => String(n.title).includes("صورت‌جلسهٔ"))).toBe(true);
    await p.cm.client.post(`${P}/change/cab/meetings/${meeting.id}/items/${items[0].id}/decide`, { decision: "deferred" }, 409);
  });
});
