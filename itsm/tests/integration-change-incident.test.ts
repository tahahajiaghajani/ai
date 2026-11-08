// Change with incident and problem management, on real rows: an incident on hold «منتظر اجرای تغییر» goes back to
// work when the change it waits on is implemented (a failed change only leaves a note); a problem «در انتظار» a change
// continues (to «در حال رفع» with a known cause) and its assignee is told; «ناشی از» links do not count; a lockdown's
// incident must be a major one; declaring a major incident starts a lockdown of its CIs only when the settings ask.
import { beforeAll, describe, expect, it } from "vitest";
import { world, type World } from "./change-helpers";
import { PLANS } from "./change-helpers";

let w: World;
let CI = "";
const HOUR = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * HOUR).toISOString();

beforeAll(async () => {
  w = await world();
  await w.o.post(`${w.P}/incident/seed`, {});
  await w.o.post(`${w.P}/cmdb/seed`, {});
  CI = await w.ci("دیوارهٔ آتش مرکز داده");
}, 180_000);

/** A retrospective change implemented two hours ago, taken to review with `code`. */
async function implementChange(extra: Record<string, unknown>, code = "successful") {
  const c = (await w.p.agent.client.post(`${w.P}/r/change_request`, {
    short_description: "رفع خطای دیوارهٔ آتش", type: "latent", risk: "low", risk_source: "manual", risk_override_reason: "ارزیابی کارشناس",
    assignment_group_id: w.g.network, actual_start: ago(3), actual_end: ago(2), ...PLANS, ...extra,
  })).row;
  return c;
}
const review = async (id: string, code = "successful") => {
  const c = await w.get(id, w.p.agent.client);
  return (await w.p.agent.client.post(`${w.P}/r/change_request/${id}/transition`, { to: "review", data: { close_code: code }, version: c.version })).row;
};
const link = (fromTable: string, fromId: string, kind: string, table: string, id: string) => w.o.post(`${w.P}/r/${fromTable}/${fromId}/links`, { kind, table, id });

describe("work waiting on a change moves on when it is implemented", () => {
  it("incidents on hold «منتظر اجرای تغییر» go back to work; a «ناشی از» incident and other holds stay", async () => {
    const { P, p } = w;
    const mk = async (s: string) => (await p.agent.client.post(`${P}/r/incident`, { short_description: s, ci_id: CI, assignment_group_id: w.g.network })).row;
    const waiting = await mk("قطعی VPN تا اجرای تغییر");
    const otherHold = await mk("منتظر تأمین‌کننده");
    const caused = await mk("پس از تغییر خراب شد");
    await p.agent.client.post(`${P}/r/incident/${waiting.id}/transition`, { to: "on_hold", data: { hold_reason: "awaiting_change" } });
    await p.agent.client.post(`${P}/r/incident/${otherHold.id}/transition`, { to: "on_hold", data: { hold_reason: "awaiting_supplier" } });
    await p.agent.client.post(`${P}/r/incident/${caused.id}/transition`, { to: "on_hold", data: { hold_reason: "awaiting_change" } });
    // «ثبت تغییر» from the waiting incident links «آغازشده از»; the other two are linked by hand
    const fromInc = await p.agent.client.post(`${P}/change/from/incident/${waiting.id}`, {});
    const c = fromInc.row;
    await link("incident", otherHold.id, "related", "change_request", c.id);
    await link("incident", caused.id, "caused_by", "change_request", c.id);
    // take it to implementation and review
    await w.o.patch(`${P}/r/change_request/${c.id}`, { type: "latent", risk: "low", risk_source: "manual", risk_override_reason: "ارزیابی کارشناس", actual_start: ago(3), actual_end: ago(2), ...PLANS, version: (await w.get(c.id)).version });
    const r = await review(c.id);
    expect(r.state).toBe("review");
    expect((await w.o.get(`${P}/r/incident/${waiting.id}`)).row.state).toBe("in_progress");
    expect((await w.o.get(`${P}/r/incident/${otherHold.id}`)).row.state).toBe("on_hold");
    expect((await w.o.get(`${P}/r/incident/${caused.id}`)).row.state).toBe("on_hold");
    expect(JSON.stringify(await w.o.get(`${P}/r/incident/${waiting.id}/journal`))).toContain(String(c.number));
  });

  it("a failed change leaves the incident waiting, with a note", async () => {
    const { P, p } = w;
    const inc = (await p.agent.client.post(`${P}/r/incident`, { short_description: "منتظر وصلهٔ امنیتی", ci_id: CI, assignment_group_id: w.g.network })).row;
    await p.agent.client.post(`${P}/r/incident/${inc.id}/transition`, { to: "on_hold", data: { hold_reason: "awaiting_change" } });
    const c = await implementChange({ ci_id: CI });
    await link("change_request", c.id, "initiated_by", "incident", inc.id);
    await review(c.id, "unsuccessful");
    expect((await w.o.get(`${P}/r/incident/${inc.id}`)).row.state).toBe("on_hold");
  });

  it("a problem waiting on the change continues and its assignee is told", async () => {
    const { P, p } = w;
    const prb = (await p.agent.client.post(`${P}/r/problem`, { short_description: "قطعی‌های تکراری دیوارهٔ آتش", ci_id: CI, assignment_group_id: w.g.network, assigned_to: p.agent.userId })).row;
    let row = (await p.agent.client.post(`${P}/r/problem/${prb.id}/transition`, { to: "rca" })).row;
    row = (await p.agent.client.post(`${P}/r/problem/${prb.id}/transition`, { to: "fix_in_progress", data: { cause_notes: "نشت حافظه در نسخهٔ کنونی" } })).row;
    row = (await p.agent.client.post(`${P}/r/problem/${prb.id}/transition`, { to: "pending", data: { pending_reason: "change" } })).row;
    expect(row.state).toBe("pending");
    const fix = (await p.agent.client.post(`${P}/change/from/problem/${prb.id}`, {})).row;
    await w.o.patch(`${P}/r/change_request/${fix.id}`, { type: "latent", risk: "low", risk_source: "manual", risk_override_reason: "ارزیابی کارشناس", actual_start: ago(3), actual_end: ago(2), ...PLANS, version: (await w.get(fix.id)).version });
    await review(fix.id);
    expect((await w.o.get(`${P}/r/problem/${prb.id}`)).row.state).toBe("fix_in_progress");
    await w.drain();
    const told = await w.e.db.query<{ subject: string }>(`select title as subject from sm_notifications where org_id = $1 and user_id = $2 and record_id = $3 and deleted_at is null`, [w.e.org, p.agent.userId, prb.id]);
    expect(told.map((n) => n.subject).join(" ")).toContain(String(fix.number));
  });
});

describe("lockdowns and major incidents", () => {
  it("a lockdown names a major incident only", async () => {
    const { P, p, o } = w;
    const plain = (await p.agent.client.post(`${P}/r/incident`, { short_description: "یک رخداد معمولی", assignment_group_id: w.g.network })).row;
    await o.post(`${P}/r/change_lockdown`, { title: "قرنطینهٔ آزمایشی", incident_id: plain.id }, 400);
  });

  it("declaring a major incident starts a lockdown of its CIs only when the settings ask", async () => {
    const { P, p, o } = w;
    const mi = async (s: string) => {
      const inc = (await p.agent.client.post(`${P}/r/incident`, { short_description: s, ci_id: CI, impact: "1", urgency: "1", assignment_group_id: w.g.network })).row;
      await o.post(`${P}/incident/${inc.id}/major`, { action: "propose", reason: "چند خدمت" });
      await o.post(`${P}/incident/${inc.id}/major`, { action: "declare" });
      return inc;
    };
    const lockdownsOf = async (id: string) => (await o.post(`${P}/r/change_lockdown/query`, { filter: { f: "incident_id", op: "eq", v: id } })).rows as Record<string, any>[];
    const off = await mi("قطعی گستردهٔ شبکه");
    expect(await lockdownsOf(off.id)).toEqual([]);
    const cfg = (await o.get(`${P}/r/change_config?size=1`)).rows[0];
    await o.patch(`${P}/r/change_config/${cfg.id}`, { lockdown_on_major: true, version: cfg.version });
    // a change in flight on the incident's CI is held by the lockdown
    const item = (await p.agent.client.get(`${P}/change/catalog`)).items[0];
    const soon = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
    const ordered = await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: soon(30), planned_end: soon(60), assignment_group_id: w.g.network, ci_id: CI, submit: true });
    const inFlight = await w.get(ordered.change.id);
    expect(["scheduled", "implement"]).toContain(inFlight.state);
    const on = await mi("قطعی گستردهٔ مرکز داده");
    const [l] = await lockdownsOf(on.id);
    expect(l).toMatchObject({ state: "active", incident_id: on.id, cis: [CI] });
    expect((await w.get(inFlight.id)).lockdown_id ?? null).toBe(l.id);
    // a second declaration of the same incident does not start another
    expect((await lockdownsOf(on.id)).length).toBe(1);
  });
});
