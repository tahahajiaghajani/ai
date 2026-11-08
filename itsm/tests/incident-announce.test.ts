// Outage announcements (INC-043): who keeps them (their group or a manager, never a requester), what reaches whom on
// GET /incident/announcements (everyone, agents only, groups, unit trees, people; drafts and windows not on air),
// the war room's draft from an incident, and their end with the incident's resolution or their window (the sweep).
import { describe, it, expect, beforeAll } from "vitest";
import { world, backdate, type World } from "./incident-helpers";
import { sweep } from "@server/modules/incident";

let w: World;
const titles = async (who: "agent" | "other" | "req" | "req2" | "mim") => ((await w.p[who].client.get(`${w.P}/incident/announcements`)).items as { title: string }[]).map((a) => a.title);
const make = async (data: Record<string, unknown>, as: "agent" | "mim" = "agent") => (await w.p[as].client.post(`${w.P}/r/announcement`, { kind: "outage", body: "متن اطلاعیه", ...data })).row;
const publish = async (id: string, as: "agent" | "mim" = "agent") => (await w.p[as].client.post(`${w.P}/r/announcement/${id}/transition`, { to: "published" })).row;

beforeAll(async () => {
  w = await world();
});

describe("keeping announcements", () => {
  it("is for the owning group or a manager, never a requester", async () => {
    await w.p.req.client.post(`${w.P}/r/announcement`, { title: "اطلاعیهٔ من", body: "x" }, 403);
    await w.p.agent.client.post(`${w.P}/r/announcement`, { title: "بدون گروه", body: "x" }, 403);
    await w.p.agent.client.post(`${w.P}/r/announcement`, { title: "گروه دیگر", body: "x", assignment_group_id: w.g.network }, 403);
    const a = await make({ title: "اطلاعیهٔ میز", assignment_group_id: w.g.desk });
    expect([a.state, a.audience, a.owner_id]).toEqual(["draft", "everyone", w.p.agent.userId]);
    await make({ title: "اطلاعیهٔ همگانی مدیر" }, "mim");
    // the requester never reads the table itself
    await w.p.req.client.get(`${w.P}/r/announcement/${a.id}`, 404);
  });

  it("checks the window and the audience", async () => {
    const r = await w.p.agent.client.post(`${w.P}/r/announcement`, { title: "بازهٔ نادرست", body: "x", assignment_group_id: w.g.desk, starts_at: "2026-11-10T10:00:00Z", ends_at: "2026-11-10T09:00:00Z" }, 400);
    expect(r.error.details?.fields?.ends_at ?? JSON.stringify(r.error)).toContain("پس از آغاز");
    const t = await w.p.agent.client.post(`${w.P}/r/announcement`, { title: "بی‌مخاطب", body: "x", assignment_group_id: w.g.desk, audience: "targeted" }, 400);
    expect(JSON.stringify(t.error)).toContain("دست‌کم یک گروه");
    const past = await make({ title: "گذشته", assignment_group_id: w.g.desk, ends_at: new Date(Date.now() - 3600_000).toISOString() });
    await w.p.agent.client.post(`${w.P}/r/announcement/${past.id}/transition`, { to: "published" }, 400);
  });
});

describe("what reaches whom", () => {
  it("drafts are not on air; published ones reach their audience only", async () => {
    const all = await make({ title: "قطعی اینترنت ساختمان مرکزی", assignment_group_id: w.g.desk });
    expect(await titles("req")).not.toContain("قطعی اینترنت ساختمان مرکزی");
    const on = await publish(all.id);
    expect(on.published_by).toBe(w.p.agent.userId);
    expect(on.starts_at).toBeTruthy();
    for (const who of ["req", "req2", "agent", "other"] as const) expect(await titles(who)).toContain("قطعی اینترنت ساختمان مرکزی");

    await publish((await make({ title: "فقط کارشناسان: فایروال", assignment_group_id: w.g.desk, audience: "agents" })).id);
    expect(await titles("agent")).toContain("فقط کارشناسان: فایروال");
    expect(await titles("other")).toContain("فقط کارشناسان: فایروال");
    expect(await titles("req")).not.toContain("فقط کارشناسان: فایروال");

    await publish((await make({ title: "برای گروه شبکه", assignment_group_id: w.g.desk, audience: "targeted", groups: [w.g.network], users: [w.p.req2.userId] })).id);
    expect(await titles("other")).toContain("برای گروه شبکه");
    expect(await titles("req2")).toContain("برای گروه شبکه");
    expect(await titles("agent")).not.toContain("برای گروه شبکه");
    expect(await titles("req")).not.toContain("برای گروه شبکه");

    // a future window is not on air yet
    await publish((await make({ title: "نگهداری فردا", kind: "maintenance", assignment_group_id: w.g.desk, starts_at: new Date(Date.now() + 86400_000).toISOString() })).id);
    expect(await titles("req")).not.toContain("نگهداری فردا");
  });

  it("a unit reaches the people of the units below it", async () => {
    const parent = (await w.o.post(`${w.P}/r/org_unit`, { name: "معاونت فنی" })).row.id;
    const child = (await w.o.post(`${w.P}/r/org_unit`, { name: "ادارهٔ شبکه", parent_id: parent })).row.id;
    await w.o.put(`${w.P}/access/members/${w.p.req.userId}`, { org_unit_id: child });
    await publish((await make({ title: "برای معاونت فنی", assignment_group_id: w.g.desk, audience: "targeted", units: [parent] })).id);
    expect(await titles("req")).toContain("برای معاونت فنی");
    expect(await titles("req2")).not.toContain("برای معاونت فنی");
  });
});

describe("announcements of incidents", () => {
  it("the war room drafts one from the incident; it ends with the resolution", async () => {
    const inc = await w.incident({ short_description: "قطعی سامانهٔ حقوق و دستمزد", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, business_impact: "پرداخت حقوق این ماه ممکن است دیر شود." });
    await w.p.req.client.post(`${w.P}/incident/${inc.id}/announcement`, {}, 403);
    await w.p.other.client.post(`${w.P}/incident/${inc.id}/announcement`, {}, 403);
    const first = await w.p.agent.client.post(`${w.P}/incident/${inc.id}/announcement`, {});
    expect(first.created).toBe(true);
    expect([first.row.incident_id, first.row.assignment_group_id, first.row.end_with_incident, first.row.state]).toEqual([inc.id, w.g.desk, true, "draft"]);
    expect(first.row.body).toContain("پرداخت حقوق");
    const again = await w.p.agent.client.post(`${w.P}/incident/${inc.id}/announcement`, {});
    expect([again.created, again.row.id]).toEqual([false, first.row.id]);
    await publish(first.row.id);
    // the incident is named to those who may read it
    const forCaller = (await w.p.req.client.get(`${w.P}/incident/announcements`)).items.find((a: any) => a.id === first.row.id);
    expect(forCaller.incident.number).toBe(inc.number);
    const forOther = (await w.p.req2.client.get(`${w.P}/incident/announcements`)).items.find((a: any) => a.id === first.row.id);
    expect(forOther.incident).toBeNull();

    await w.p.agent.client.post(`${w.P}/r/incident/${inc.id}/transition`, { to: "resolved", data: { close_code: "solved", close_notes: "سرور پایگاه داده راه‌اندازی شد" } });
    await w.drain();
    const ended = (await w.o.get(`${w.P}/r/announcement/${first.row.id}`)).row;
    expect(ended.state).toBe("ended");
    expect(ended.ended_at).toBeTruthy();
    expect(await titles("req")).not.toContain(first.row.title);
  });

  it("the sweep ends announcements whose window is over", async () => {
    const a = await publish((await make({ title: "کندی موقت ایمیل", kind: "degradation", assignment_group_id: w.g.desk, ends_at: new Date(Date.now() + 3600_000).toISOString() })).id);
    await backdate(w.e, "sm_announcements", a.id, "ends_at", 1);
    const r = await sweep(w.sys);
    expect(r.ended).toBeGreaterThanOrEqual(1);
    expect((await w.o.get(`${w.P}/r/announcement/${a.id}`)).row.state).toBe("ended");
  });
});
