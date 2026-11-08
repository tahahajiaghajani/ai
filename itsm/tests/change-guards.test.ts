// Change enablement — what keeps a change's authorization honest (review findings): a change is standard only from the
// catalogue and a model of another type or without authorization is a change manager's choice; the module's
// definitions (models, windows, CABs, questions, lockdowns) are the change managers'; the author does not pick the
// approvers (a change manager named on the change is one, its CAB an active board); manual authorization is the change
// managers', never by the change's own people.
import { describe, expect, it, beforeAll } from "vitest";
import { at, world, type World } from "./change-helpers";

let w: World;
const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });
const FREE = ["new", "scheduled", "implement", "review", "closed", "canceled"];

beforeAll(async () => {
  w = await world();
}, 120_000);

describe("standard changes and models", () => {
  it("a person's change becomes standard only from the catalogue: no type switch, no standard model, no /from, no copy", async () => {
    const { P, p, o } = w;
    const c = await w.change(manual("high"));
    expect(c.cab_required).toBe(true);
    const row = await w.get(c.id, p.agent.client);
    const byType = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { type: "standard", version: row.version }, 400);
    expect(byType.error.details.fields.type).toContain("کاتالوگ");
    const std = (await o.get(`${P}/r/change_model?size=20`)).rows.find((m: any) => m.type === "standard");
    const byModel = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { model_id: std.id, version: row.version }, 400);
    expect(byModel.error.details.fields.type).toContain("کاتالوگ");
    await p.agent.client.post(`${P}/r/change_request`, { short_description: "تغییر ساده", type: "standard", assignment_group_id: w.g.network, planned_start: at(5), planned_end: at(5, 10) }, 400);
    await p.agent.client.post(`${P}/change/from/change_request/${c.id}`, { type: "standard" }, 400);
    const still = await w.get(c.id);
    expect(still.type).toBe("normal");
    expect(still.model_states).toContain("authorize");

    // a standard change from the catalogue; its copy is a new order of the same published template, which it keeps
    const items = (await p.agent.client.get(`${P}/change/catalog`)).items as any[];
    const dns = items.find((x) => x.name.includes("DNS"));
    const tls = items.find((x) => x.name.includes("TLS"));
    const ordered = (await p.agent.client.post(`${P}/change/catalog/${dns.id}/order`, { planned_start: at(3), planned_end: at(3, 10), assignment_group_id: w.g.network })).change;
    expect(ordered.type).toBe("standard");
    const [copy] = (await p.agent.client.post(`${P}/change/records/${ordered.id}/copy`, {})).changes;
    const copied = await w.get(copy.id, p.agent.client);
    expect(copied.type).toBe("standard");
    expect(copied.template_id).toBe(dns.id);
    const swap = await p.agent.client.patch(`${P}/r/change_request/${copied.id}`, { template_id: tls.id, version: copied.version }, 400);
    expect(swap.error.details.fields.template_id).toBeTruthy();
    // once the template is suspended, a copy is a normal change that needs authorization
    await o.post(`${P}/r/change_template/${dns.id}/transition`, { to: "suspended" });
    const [later] = (await p.agent.client.post(`${P}/change/records/${ordered.id}/copy`, {})).changes;
    const normal = await w.get(later.id);
    expect(normal.type).toBe("normal");
    expect(normal.model_states).toContain("authorize");
    await o.post(`${P}/r/change_template/${dns.id}/transition`, { to: "published" });
  });

  it("a model of another type or without authorization is the change managers' choice", async () => {
    const { P, p, o } = w;
    const models = (await o.get(`${P}/r/change_model?size=20`)).rows as any[];
    const emergency = models.find((m) => m.type === "emergency");
    const quick = (await p.cm.client.post(`${P}/r/change_model`, { name: "عادی بی‌تأیید (آزمون)", type: "normal", sort_order: 900, states: FREE })).row;
    const c = await w.change(manual("high"));
    let row = await w.get(c.id, p.agent.client);
    const other = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { model_id: emergency.id, version: row.version }, 400);
    expect(other.error.details.fields.model_id).toContain("اضطراری");
    const free = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { model_id: quick.id, version: row.version }, 400);
    expect(free.error.details.fields.model_id).toContain("در انتظار تأیید");
    // the type itself may change (its default model follows)
    row = (await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { type: "emergency", version: row.version })).row;
    expect(row.model_id).toBe(emergency.id);
    // a change manager may pick the model without authorization
    const cmRow = await w.get(c.id, p.cm.client);
    const picked = (await p.cm.client.patch(`${P}/r/change_request/${c.id}`, { type: "normal", model_id: quick.id, version: cmRow.version })).row;
    expect(picked.model_states).not.toContain("authorize");
    await p.cm.client.patch(`${P}/r/change_model/${quick.id}`, { active: false, version: quick.version });
  });
});

describe("the module's definitions", () => {
  it("agents and team leads define no models, windows, CABs, questions or lockdowns; change managers do", async () => {
    const { P, p, o } = w;
    const model = { name: "مدل پیش‌فرض بی‌تأیید", type: "normal", is_default: true, sort_order: 0, states: FREE };
    await p.agent.client.post(`${P}/r/change_model`, model, 403);
    await p.mgr.client.post(`${P}/r/change_model`, model, 403);
    await p.agent.client.post(`${P}/r/change_lockdown`, { title: "قرنطینهٔ همهٔ تغییرها" }, 403);
    // the window's group is the agent's own: the table's scope would let them write it
    await p.agent.client.post(`${P}/r/change_window`, { name: "ممنوعیت سراسری", kind: "blackout", enforcement: "block", start_at: at(1, 0), end_at: at(40, 0), owner_group_id: w.g.network }, 403);
    await p.agent.client.post(`${P}/r/cab`, { name: "هیئت یک‌نفره", kind: "change", manager_id: p.agent.userId, members: [p.other.userId] }, 403);
    await p.agent.client.post(`${P}/r/change_risk_question`, { question: "آیا تغییر ساده است؟", kind: "yes_no", weight: 10 }, 403);
    await p.agent.client.post(`${P}/change/windows/from-holidays`, { year: 1405 }, 403);
    // nothing changed for everyone else: a new change still takes the seeded default model with its authorization
    const c = await w.change(manual("very_high"));
    expect(c.model_states).toContain("authorize");
    expect((await o.get(`${P}/r/change_lockdown?size=5`)).rows.length).toBe(0);
    // a change manager defines them
    const q = (await p.cm.client.post(`${P}/r/change_risk_question`, { question: "آیا پشتیبان تازه دارید؟ (آزمون)", kind: "yes_no", weight: 1, active: false })).row;
    expect(q.id).toBeTruthy();
    const cab = (await p.cm.client.post(`${P}/r/cab`, { name: "هیئت شبکه (آزمون)", kind: "network", active: false, members: [p.cab1.userId] })).row;
    expect(cab.id).toBeTruthy();
  });
});

describe("approvers", () => {
  it("a change manager named on the change must be one; its CAB must be an active board of its kind", async () => {
    const { P, p, o, e } = w;
    const named = await p.agent.client.post(`${P}/r/change_request`, { short_description: "ارتقای سوئیچ", type: "normal", assignment_group_id: w.g.network, planned_start: at(12), planned_end: at(12, 11), ...manual("moderate"), change_manager_id: p.other.userId }, 400);
    expect(named.error.details.fields.change_manager_id).toContain("مدیران تغییر");
    const idle = (await o.post(`${P}/r/cab`, { name: "هیئت غیرفعال (آزمون)", kind: "change", active: false, members: [p.other.userId] })).row;
    const c = await w.change(manual("very_high"));
    const row = await w.get(c.id, p.agent.client);
    const board = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { cab_id: idle.id, version: row.version }, 400);
    expect(board.error.details.fields.cab_id).toBeTruthy();
    // stored anyway (an import, an older row): the approver sources pass over both
    await e.db.query("update sm_change_requests set cab_id = $2 where id = $1", [c.id, idle.id]);
    await w.move(c.id, ["assess", "authorize"]);
    const cabApprovers = (await w.approvals(c.id)).map((a) => a.approver_id).sort();
    expect(cabApprovers).toEqual([p.cab1.userId, p.cab2.userId, p.cab3.userId].sort());
    const m = await w.change(manual("moderate"));
    await e.db.query("update sm_change_requests set change_manager_id = $2 where id = $1", [m.id, p.other.userId]);
    await w.move(m.id, ["assess", "authorize"]);
    expect((await w.approvals(m.id)).map((a) => a.approver_id)).toEqual([p.cm.userId]);
    // a real change manager named on the change is asked
    const ok = await w.change({ ...manual("moderate"), change_manager_id: p.cm.userId });
    expect(ok.change_manager_id).toBe(p.cm.userId);
  });
});

describe("risk and conflicts", () => {
  const CI = "61616161-6161-4161-8161-616161616161";

  it("a person does not set the risk's source: «template» is the template's, and a lower risk by hand needs its reason", async () => {
    const { P, p } = w;
    const c = await w.change({ impact: "1", outage_expected: true, outage_minutes: 120 });
    expect(c.risk_source).toBe("calculated");
    expect(c.risk_calculated).not.toBe("low");
    let row = await w.get(c.id, p.agent.client);
    const e = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { risk: "low", risk_source: "template", version: row.version }, 400);
    expect(e.error.details.fields.risk_override_reason).toBeTruthy();
    row = await w.get(c.id, p.agent.client);
    expect(row.risk_source).toBe("calculated");
    expect(row.risk).toBe(row.risk_calculated);
    const byHand = (await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { risk: "low", risk_source: "template", risk_override_reason: "بازه‌ای کوتاه در شب", version: row.version })).row;
    expect(byHand.risk_source).toBe("manual");
    expect(byHand.risk).toBe("low");
  });

  it("answering only the favourable questions does not lower the risk; approval waits for the mandatory answers", async () => {
    const { P, p } = w;
    const c = await w.change({ impact: "1", outage_expected: true, outage_minutes: 120 });
    const v = await p.agent.client.get(`${P}/change/records/${c.id}/risk`);
    expect(v.result.questionnaire.score).toBeNull();
    const first = v.questions.find((q: any) => q.kind !== "number");
    const best = first.options.reduce((a: any, b: any) => (b.score < a.score ? b : a)).value;
    const part = await p.agent.client.put(`${P}/change/records/${c.id}/risk`, { answers: { [first.id]: best }, version: v.version });
    expect(part.result.score).toBeGreaterThanOrEqual(v.result.score);
    const assessed = await w.move(c.id, ["assess"]);
    const refused = await p.agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "authorize", version: assessed.version }, 409);
    expect(refused.error.message).toContain("پرسش‌نامهٔ ریسک");
    const all = Object.fromEntries(v.questions.map((q: any) => [q.id, q.kind === "number" ? 0 : q.options[0].value]));
    const done = await p.agent.client.put(`${P}/change/records/${c.id}/risk`, { answers: all, version: assessed.version });
    expect(done.result.questionnaire.missing.length).toBe(0);
    expect((await w.move(c.id, ["authorize"])).state).toBe("authorize");
  });

  it("leaving a change out of conflict detection is the change managers' call; the other change keeps its conflict", async () => {
    const { P, p } = w;
    const a = await w.change({ ...manual("moderate"), affected_cis: [CI], planned_start: at(30, 8), planned_end: at(30, 10) });
    await w.move(a.id, ["assess"]);
    const b = await w.change({ ...manual("moderate"), affected_cis: [CI], planned_start: at(30, 9), planned_end: at(30, 11), assignment_group_id: w.g.servers }, p.other.client);
    expect(b.conflict_count).toBe(1);
    const mine = await w.get(a.id, p.agent.client);
    const refused = await p.agent.client.patch(`${P}/r/change_request/${a.id}`, { exclude_conflicts: true, version: mine.version }, 400);
    expect(refused.error.details.fields.exclude_conflicts).toBeTruthy();
    const cm = await w.get(a.id, p.cm.client);
    const excluded = (await p.cm.client.patch(`${P}/r/change_request/${a.id}`, { exclude_conflicts: true, version: cm.version })).row;
    expect(excluded.conflict_count).toBe(0);
    await w.drain();
    const other = await w.get(b.id);
    expect(other.conflict_status).toBe("conflict");
    expect(other.conflict_count).toBe(1);
  });
});

describe("manual authorization", () => {
  it("is not for team leads, and never for the change's own requester, implementer or coordinator", async () => {
    const { P, p, o } = w;
    // a team lead of the implementing group holds the change area's approve right there (the last test of the file)
    await o.post(`${P}/access/groups/${w.g.network}/members`, { user_ids: [p.mgr.userId] });
    const c = await w.change(manual("high"));
    const row = await w.move(c.id, ["assess", "authorize"]);
    const lead = await w.get(c.id, p.mgr.client);
    expect(lead.version).toBe(row.version);
    await p.mgr.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "scheduled", version: row.version }, 403);
    expect((await w.approvals(c.id)).every((a) => a.state === "requested")).toBe(true);
    // the change manager opened and coordinates this one: someone else authorizes it
    const own = await w.change({ ...manual("high"), change_owner_id: p.cm.userId }, p.cm.client);
    const waiting = await w.move(own.id, ["assess", "authorize"], p.cm.client);
    const refused = await p.cm.client.post(`${P}/r/change_request/${own.id}/transition`, { to: "scheduled", version: waiting.version }, 409);
    expect(refused.error.message).toContain("خودتان");
    expect((await w.get(own.id)).state).toBe("authorize");
  });
});
