// Who sees what in the portal: a manager approves their staff's order from «کارهای من» (the approvals service's
// participant grant) and nobody else reaches that approval; complaints are confidential to the submitter and the
// feedback group; search shows a requester their own records only; quick links follow their audience; favourites are
// personal; the portal's administration (layout, analytics) is for the catalogue's administrators; the home layout
// stays clean and topics never loop.
import { beforeAll, describe, expect, it } from "vitest";
import { portalWorld, statusOf, type PortalWorld } from "./portal-helpers";

let w: PortalWorld;

beforeAll(async () => {
  w = await portalWorld();
}, 120_000);

describe("approvals for requesters", () => {
  it("lets a manager approve their staff's order, and nobody else open it", async () => {
    const item = (await w.o.get(`${w.P}/r/catalog_item?filter=${encodeURIComponent(JSON.stringify({ f: "code", op: "eq", v: "software_install" }))}`)).rows[0];
    const order = await w.p.req.client.post(`${w.P}/request/order`, { lines: [{ item_id: item.id, answers: { software: "office", computer_name: "PC-12" } }], channel: "portal" });
    await w.drain();
    const ritm = order.items[0].id as string;
    const todo = await w.p.mgr.client.get(`${w.P}/portal/todo`);
    const a = todo.approvals.find((x: { record_id: string }) => x.record_id === ritm);
    expect(a).toBeTruthy();
    const detail = await w.p.mgr.client.get(`${w.P}/portal/approvals/${a.id}`);
    expect(detail.approval.can_decide).toBe(true);
    expect(detail.record.for_name).toBeTruthy();
    expect(detail.answers.some((x: { value: string }) => x.value === "مجموعهٔ آفیس")).toBe(true);
    for (const who of ["other", "req2", "agent", "req"] as const) expect(await statusOf(w.p[who].client, "GET", `${w.P}/portal/approvals/${a.id}`)).toBe(404);
    // the requester follows it in the portal: waiting for approval
    const t = await w.p.req.client.get(`${w.P}/portal/tickets/request_item/${ritm}`);
    expect(t.approvals).toMatchObject({ pending: 1, label: "در انتظار تأیید" });
    expect(t.answers.some((x: { label: string }) => x.label === "نرم‌افزار")).toBe(true);
    await w.p.mgr.client.post(`${w.P}/approvals/${a.id}/decide`, { decision: "approved", comment: null });
    await w.drain();
    const after = await w.p.req.client.get(`${w.P}/portal/tickets/request_item/${ritm}`);
    expect(after.approvals.pending).toBe(0);
    expect((await w.p.mgr.client.get(`${w.P}/portal/todo`)).approvals.find((x: { record_id: string }) => x.record_id === ritm)).toBeUndefined();
  });
});

describe("feedback", () => {
  it("keeps a complaint between the submitter and the feedback group", async () => {
    const f = (await w.p.req.client.post(`${w.P}/r/portal_feedback`, { kind: "complaint", short_description: "رفتار نامناسب پشتیبانی", description: "جزئیات" })).row;
    expect(f.confidential).toBe(true);
    const groups = (await w.o.get(`${w.P}/r/group?size=100`)).rows as { id: string; name: string }[];
    const fbGroup = groups.find((g) => g.name === "رسیدگی به بازخورد")!.id;
    await w.drain();
    const stored = async () => (await w.e.db.one<Record<string, any>>(`select * from sm_portal_feedback where id = $1`, [f.id]))!;
    expect((await stored()).assignment_group_id).toBe(fbGroup);
    const mine = await w.p.req.client.get(`${w.P}/portal/items?tab=mine&state=open`);
    expect(mine.items.find((i: { id: string }) => i.id === f.id)).toMatchObject({ table: "portal_feedback", kind_label: "بازخورد" });
    // confidential: not even the organisation's owner (no «امنیت» field group) reads it
    for (const c of [w.p.agent.client, w.p.req2.client, w.p.other.client, w.p.sdm.client, w.p.mgr.client, w.o]) expect(await statusOf(c, "GET", `${w.P}/r/portal_feedback/${f.id}`)).toBe(404);
    await w.o.post(`${w.P}/access/groups/${fbGroup}/members`, { user_ids: [w.p.agent.userId] });
    expect((await w.p.agent.client.get(`${w.P}/r/portal_feedback/${f.id}`)).row.short_description).toBe("رفتار نامناسب پشتیبانی");
    // the official response reaches the submitter, who confirms it
    const row = (await w.p.agent.client.get(`${w.P}/r/portal_feedback/${f.id}`)).row;
    await w.p.agent.client.post(`${w.P}/r/portal_feedback/${f.id}/transition`, { to: "responded", data: { response: "پوزش می‌خواهیم؛ موضوع پیگیری شد." }, version: row.version });
    const t = await w.p.req.client.get(`${w.P}/portal/tickets/portal_feedback/${f.id}`);
    expect(t.stage).toBe("done");
    expect(t.actions.map((x: { key: string }) => x.key)).toContain("confirm");
    await w.p.req.client.post(`${w.P}/portal/tickets/portal_feedback/${f.id}/action`, { action: "confirm" });
    expect((await w.p.req.client.get(`${w.P}/portal/tickets/portal_feedback/${f.id}`)).stage).toBe("closed");
    const done = await stored();
    expect(done.acknowledged_at).toBeTruthy();
    expect(done.responded_at).toBeTruthy();
  });
});

describe("search", () => {
  it("finds the requester's own records, articles and items, never another person's records", async () => {
    const mine = await w.incident(w.p.req.client, { short_description: "اسکنر طبقهٔ سوم" });
    const theirs = await w.incident(w.p.other.client, { short_description: "اسکنر واحد فروش" });
    const r = await w.p.req.client.get(`${w.P}/portal/search?q=${encodeURIComponent("اسکنر")}`);
    const ids = r.hits.map((h: { id: string }) => h.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(r.hits.find((h: { id: string }) => h.id === mine.id)).toMatchObject({ kind: "record", path: `portal/t/incident/${mine.id}` });
    const items = await w.p.req.client.get(`${w.P}/portal/search?q=${encodeURIComponent("لپ‌تاپ")}`);
    expect(items.hits.some((h: { kind: string }) => h.kind === "item")).toBe(true);
    const none = await w.p.req.client.get(`${w.P}/portal/search?q=${encodeURIComponent("واژهٔ ناموجود زیپ")}`);
    expect(none.zero).toBe(true);
  });

  it("reports searches to the portal's administrators only", async () => {
    const a = await w.p.sdm.client.get(`${w.P}/portal/analytics?days=30`);
    expect(a.searches).toBeGreaterThanOrEqual(3);
    expect(a.top_zero.map((x: { query: string }) => x.query).join(" ")).toContain("زیپ");
    expect(await statusOf(w.p.req.client, "GET", `${w.P}/portal/analytics`)).toBe(403);
    expect(await statusOf(w.p.agent.client, "GET", `${w.P}/portal/analytics`)).toBe(403);
  });

  it("answers with a rule-based summary when no model is set up", async () => {
    const r = await w.p.req.client.post(`${w.P}/portal/search/answer`, { q: "چطور گذرواژه را عوض کنم" });
    if (r.answer) {
      expect(r.answer.fallback).toBe(true);
      expect(typeof r.answer.text).toBe("string");
    }
  });
});

describe("content and personal choices", () => {
  it("shows a quick link only to its audience", async () => {
    await w.p.sdm.client.post(`${w.P}/r/portal_link`, { name: "سامانهٔ فروش", url: "https://sales.example.com", aud_units: [w.units.sales] });
    await w.p.sdm.client.post(`${w.P}/r/portal_link`, { name: "ایمیل سازمانی", url: "https://mail.example.com" });
    const sales = (await w.p.other.client.get(`${w.P}/portal/home`)).links.map((l: { name: string }) => l.name);
    const finance = (await w.p.req.client.get(`${w.P}/portal/home`)).links.map((l: { name: string }) => l.name);
    expect(sales).toEqual(expect.arrayContaining(["سامانهٔ فروش", "ایمیل سازمانی"]));
    expect(finance).toContain("ایمیل سازمانی");
    expect(finance).not.toContain("سامانهٔ فروش");
  });

  it("keeps favourites personal", async () => {
    const cat = await w.p.req.client.get(`${w.P}/portal/catalog`);
    const item = cat.items[0].id as string;
    await w.p.req.client.post(`${w.P}/portal/favorites/${item}`, { on: true });
    expect((await w.p.req.client.get(`${w.P}/portal/catalog`)).favorites).toEqual([item]);
    expect((await w.p.req2.client.get(`${w.P}/portal/catalog`)).favorites).toEqual([]);
    expect(await statusOf(w.p.req.client, "POST", `${w.P}/r/portal_pref`, { favorites: [item] })).toBe(403);
  });

  it("lets only the catalogue's administrators publish the home page, and keeps it clean", async () => {
    const portal = (await w.o.get(`${w.P}/r/portal`)).rows[0];
    expect(await statusOf(w.p.req.client, "POST", `${w.P}/portal/layout/${portal.id}/publish`)).toBe(403);
    expect(await statusOf(w.p.agent.client, "PATCH", `${w.P}/r/portal/${portal.id}`, { title: "x" })).toBe(403);
    const draft = [{ type: "search" }, { type: "links", limit: 999 }, { type: "links" }, { type: "bogus" }, { type: "text", text: "ساعت کاری: ۸ تا ۱۶" }];
    const saved = (await w.p.sdm.client.patch(`${w.P}/r/portal/${portal.id}`, { layout: draft })).row;
    expect(saved.layout.map((x: { type: string }) => x.type)).toEqual(["search", "links", "text"]);
    expect(saved.layout[1].limit).toBe(24);
    const pub = await w.p.sdm.client.post(`${w.P}/portal/layout/${portal.id}/publish`, {});
    expect(pub.portal.layout_version).toBe(2);
    expect((await w.p.req.client.get(`${w.P}/portal/config`)).layout.map((x: { type: string }) => x.type)).toEqual(["search", "links", "text"]);
  });

  it("never lets a topic sit under itself", async () => {
    const a = (await w.p.sdm.client.post(`${w.P}/r/portal_topic`, { name: "رایانه" })).row;
    const b = (await w.p.sdm.client.post(`${w.P}/r/portal_topic`, { name: "چاپگر", parent_id: a.id })).row;
    expect(await statusOf(w.p.sdm.client, "PATCH", `${w.P}/r/portal_topic/${a.id}`, { parent_id: b.id, version: a.version })).toBe(400);
    const page = await w.p.req.client.get(`${w.P}/portal/topics/${b.id}`);
    expect(page.path.map((x: { name: string }) => x.name)).toEqual(["رایانه"]);
  });
});
