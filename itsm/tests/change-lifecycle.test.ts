// Change enablement: the lifecycle of every model (normal, emergency, standard, retrospective), the authorization
// cycle through the approvals service (risk-based rules, CAB majority, rejection back to the draft), requirements and
// locks, re-authorization, holds, tasks in dependency order, the post-implementation review and closure.
import { describe, expect, it, beforeAll } from "vitest";
import { at, world, type World } from "./change-helpers";

let w: World;
beforeAll(async () => {
  w = await world();
}, 120_000);

const manual = (risk: string) => ({ risk, risk_source: "manual", risk_override_reason: "ارزیابی کارشناس" });

describe("change models and the seed", () => {
  it("seeds models, questions, CABs, rules, windows and the standard catalogue once", async () => {
    const { P, o } = w;
    const models = (await o.get(`${P}/r/change_model?size=20`)).rows;
    expect(models.map((m: any) => m.type).sort()).toEqual(["emergency", "latent", "normal", "standard"]);
    expect((await o.get(`${P}/r/change_risk_question?size=50`)).rows.length).toBeGreaterThanOrEqual(6);
    expect((await o.get(`${P}/r/cab?size=10`)).rows.length).toBe(2);
    expect((await o.get(`${P}/r/approval_rule?size=50`)).rows.filter((r: any) => r.table_key === "change_request").length).toBe(4);
    expect((await o.get(`${P}/r/change_window?size=50`)).rows.length).toBe(3);
    const catalogue = await o.get(`${P}/change/catalog`);
    expect(catalogue.items.length).toBe(4);
    const again = await o.post(`${P}/change/seed`, {});
    expect(again.skipped).toBe(true);
    const forced = await o.post(`${P}/change/seed`, { force: true });
    expect(Object.values(forced.created).reduce((a: number, b) => a + Number(b), 0)).toBe(0);
  });

  it("the CAB decides by a strict majority; an organisation seeded before gets that upgrade and nothing else", async () => {
    const { P, o, e } = w;
    const id = (await o.get(`${P}/r/approval_rule?size=50`)).rows.find((r: any) => r.table_key === "change_request" && r.name.includes("هیئت CAB")).id;
    const ruleOf = async () => (await o.get(`${P}/r/approval_rule/${id}`)).row;
    const rule = await ruleOf();
    expect(rule.levels[0].threshold).toBe(51);
    // as seeded by the first version: the CAB rule at 50 %, and a window the organisation removed since
    await e.db.query("update sm_approval_rules set levels = $2::jsonb where id = $1", [rule.id, JSON.stringify([{ ...rule.levels[0], threshold: 50 }])]);
    await e.db.query("update sm_change_configs set seeded = 1 where org_id = $1", [e.org]);
    const windows = (await o.get(`${P}/r/change_window?size=50`)).rows;
    const fiscal = windows.find((x: any) => x.name.includes("سال مالی"));
    await o.del(`${P}/r/change_window/${fiscal.id}`);
    const upgraded = await o.post(`${P}/change/seed`, {});
    expect(upgraded.skipped).toBe(false);
    expect(upgraded.created).toEqual({ approval_rule_upgraded: 1 });
    expect((await ruleOf()).levels[0].threshold).toBe(51);
    expect((await o.get(`${P}/r/change_window?size=50`)).rows.length).toBe(windows.length - 1);
    expect((await o.post(`${P}/change/seed`, {})).skipped).toBe(true);
  });

  it("a new change takes its type's default model, the lifecycle, a calculated risk and a conflict check", async () => {
    const c = await w.change();
    expect(c.number).toMatch(/^CHG\d{7}$/);
    expect(c.model_id).toBeTruthy();
    expect(c.risk_source).toBe("calculated");
    expect(["low", "moderate", "high", "very_high"]).toContain(c.risk);
    expect(typeof c.risk_score).toBe("number");
    expect(c.conflict_status).toBe("none");
    const meta = (await w.o.get(`${w.P}/r/change_request/${c.id}`)).meta;
    expect(meta.change.lifecycle).toEqual(["new", "assess", "authorize", "scheduled", "implement", "review", "closed", "canceled"]);
  });
});

describe("normal change", () => {
  it("must pass assessment before approval and needs what each state requires", async () => {
    const { P, p } = w;
    const c = await w.change({ implementation_plan: "" });
    const skip = await p.agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "authorize", version: c.version }, 409);
    expect(skip.error.message).toContain("ارزیابی");
    const a = await w.move(c.id, ["assess"]);
    const missing = await p.agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "authorize", version: a.version }, 409);
    expect(missing.error.message).toContain("برنامهٔ اجرا");
  });

  it("moderate risk: the change manager authorizes and the change is scheduled at once", async () => {
    const { P, p } = w;
    const c = await w.change(manual("moderate"));
    const r = await w.move(c.id, ["assess", "authorize"]);
    expect(r.state).toBe("authorize");
    expect(r.approval).toBe("requested");
    const list = await w.approvals(c.id);
    expect(list.map((a) => a.approver_id)).toEqual([p.cm.userId]);
    await p.cm.client.post(`${P}/approvals/${list[0].id}/decide`, { decision: "approved" });
    const after = await w.get(c.id);
    expect(after.state).toBe("scheduled");
    expect(after.approval).toBe("approved");
    expect(after.authorized_at).toBeTruthy();
    expect(after.submitted_at).toBeTruthy();
  });

  it("high risk goes to the CAB; a majority approves", async () => {
    const { P, p } = w;
    const c = await w.change(manual("high"));
    const r = await w.move(c.id, ["assess", "authorize"]);
    expect(r.cab_required).toBe(true);
    expect(r.cab_id).toBeTruthy();
    const list = await w.approvals(c.id);
    expect(list.map((a) => a.approver_id).sort()).toEqual([p.cab1.userId, p.cab2.userId, p.cab3.userId].sort());
    await p.cab1.client.post(`${P}/approvals/${list.find((a) => a.approver_id === p.cab1.userId)!.id}/decide`, { decision: "approved" });
    expect((await w.get(c.id)).state).toBe("authorize");
    await p.cab2.client.post(`${P}/approvals/${list.find((a) => a.approver_id === p.cab2.userId)!.id}/decide`, { decision: "approved" });
    expect((await w.get(c.id)).state).toBe("scheduled");
  });

  it("a rejection sends the change back to the draft; resubmitting asks again", async () => {
    const { P, p } = w;
    const c = await w.change(manual("moderate"));
    await w.move(c.id, ["assess", "authorize"]);
    const [a] = await w.approvals(c.id);
    await p.cm.client.post(`${P}/approvals/${a.id}/decide`, { decision: "rejected", comment: "برنامهٔ بازگشت ناقص است" });
    const back = await w.get(c.id);
    expect(back.state).toBe("new");
    expect(back.status_reason).toBe("rejected");
    expect(back.approval).toBe("rejected");
    const again = await w.move(c.id, ["assess", "authorize"]);
    expect(again.approval).toBe("requested");
    const open = (await w.approvals(c.id)).filter((x) => x.state === "requested");
    expect(open.length).toBe(1);
    await p.cm.client.post(`${P}/approvals/${open[0].id}/decide`, { decision: "approved" });
    expect((await w.get(c.id)).state).toBe("scheduled");
  });

  it("locks what was planned once implementation starts, and re-authorizes edits of an authorized schedule", async () => {
    const { P, p } = w;
    const c = await w.change(manual("moderate"));
    await w.move(c.id, ["assess", "authorize"]);
    const [a] = await w.approvals(c.id);
    await p.cm.client.post(`${P}/approvals/${a.id}/decide`, { decision: "approved" });
    let row = await w.get(c.id, p.agent.client);
    row = (await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { planned_end: at(12, 12), version: row.version })).row;
    const now = await w.get(c.id);
    expect(now.state).toBe("authorize");
    expect(now.approval).toBe("requested");
    const reopen = (await w.approvals(c.id)).filter((x) => x.state === "requested");
    await p.cm.client.post(`${P}/approvals/${reopen[0].id}/decide`, { decision: "approved" });
    const impl = await w.move(c.id, ["implement"]);
    expect(impl.actual_start).toBeTruthy();
    const locked = await p.agent.client.patch(`${P}/r/change_request/${c.id}`, { planned_start: at(13), version: impl.version }, 400);
    expect(locked.error.details.fields.planned_start).toContain("تغییر نمی‌کند");
  });
});

describe("tasks, review and closure", () => {
  it("tasks wait for implementation, follow their dependencies and hold up the review", async () => {
    const { P, p } = w;
    const c = await w.change(manual("moderate"));
    const t1 = (await p.agent.client.post(`${P}/r/change_task`, { change_id: c.id, short_description: "پشتیبان‌گیری", task_type: "implementation", sort_order: 10 })).row;
    const t2 = (await p.agent.client.post(`${P}/r/change_task`, { change_id: c.id, short_description: "ارتقا", task_type: "implementation", sort_order: 20, depends_on: [t1.id] })).row;
    expect(t1.state).toBe("pending");
    expect(t1.change_owner_id).toBe(p.agent.userId);
    const early = await p.agent.client.post(`${P}/r/change_task/${t1.id}/transition`, { to: "in_progress" }, 409);
    expect(early.error.message).toContain("پس از شروع اجرا");
    await w.move(c.id, ["assess", "authorize"]);
    const [a] = await w.approvals(c.id);
    await p.cm.client.post(`${P}/approvals/${a.id}/decide`, { decision: "approved" });
    await w.move(c.id, ["implement"]);
    expect((await p.agent.client.get(`${P}/r/change_task/${t1.id}`)).row.state).toBe("open");
    expect((await p.agent.client.get(`${P}/r/change_task/${t2.id}`)).row.state).toBe("pending");
    const r = await w.get(c.id, p.agent.client);
    const blocked = await p.agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "review", data: { close_code: "successful" }, version: r.version }, 409);
    expect(blocked.error.message).toContain("هنوز باز است");
    await p.agent.client.post(`${P}/r/change_task/${t1.id}/transition`, { to: "closed_complete" });
    expect((await p.agent.client.get(`${P}/r/change_task/${t2.id}`)).row.state).toBe("open");
    await p.agent.client.post(`${P}/r/change_task/${t2.id}/transition`, { to: "closed_complete" });
    const done = await w.move(c.id, ["review"], p.agent.client, { close_code: "successful" });
    expect(done.actual_end).toBeTruthy();
    expect(done.duration_actual).toBeGreaterThanOrEqual(0);
    const closed = await w.move(c.id, ["closed"], p.agent.client, { close_notes: "بدون مشکل اجرا شد" });
    expect(closed.state).toBe("closed");
  });
});

describe("emergency change", () => {
  it("is authorized by the ECAB, completes its documentation after implementation and cannot close before its review", async () => {
    const { P, p } = w;
    const c = await w.change({ type: "emergency", implementation_plan: "", backout_plan: "", test_plan: "", planned_start: null, planned_end: null });
    expect(c.cab_required).toBe(true);
    expect(c.is_late).toBe(false);
    await w.move(c.id, ["authorize"]);
    const list = await w.approvals(c.id);
    expect(list.map((x) => x.approver_id)).toContain(p.cm.userId);
    await p.cm.client.post(`${P}/approvals/${list.find((x) => x.approver_id === p.cm.userId)!.id}/decide`, { decision: "approved" });
    let row = await w.get(c.id, p.agent.client);
    expect(row.state).toBe("implement");
    const early = await p.agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "review", data: { close_code: "successful" }, version: row.version }, 409);
    expect(early.error.message).toContain("برنامهٔ اجرا");
    row = (await p.agent.client.patch(`${P}/r/change_request/${c.id}`, {
      implementation_plan: "اجرای اصلاح فوری روی دیوارهٔ آتش و بررسی ترافیک خدمت‌ها", backout_plan: "بازگرداندن قاعدهٔ پیشین", test_plan: "بررسی ترافیک",
      planned_start: at(-1), planned_end: at(-1, 10), version: row.version,
    })).row;
    row = await w.move(c.id, ["review"], p.agent.client, { close_code: "successful" });
    expect(row.pir_required).toBe(true);
    expect(row.pir_id).toBeTruthy();
    const refused = await p.agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "closed", data: { close_notes: "انجام شد" }, version: row.version }, 409);
    expect(refused.error.message).toContain("بازبینی پس از اجرا");
    const pir = (await w.o.get(`${P}/r/change_pir/${row.pir_id}`)).row;
    expect(pir.reason).toBe("policy");
    expect(pir.timeline_md).toContain("اجرای واقعی");
    await w.o.post(`${P}/r/change_pir/${pir.id}/transition`, { to: "completed", data: { objectives_met: "yes", lessons: "پایش زودتر هشدار دهد" } });
    const closed = await w.move(c.id, ["closed"], p.agent.client, { close_notes: "اصلاح فوری انجام شد" });
    expect(closed.state).toBe("closed");
    expect(closed.lessons).toContain("پایش");
  });
});

describe("standard and retrospective changes", () => {
  it("a standard change from the catalogue is pre-authorized and brings its tasks", async () => {
    const { P, p } = w;
    const item = (await p.agent.client.get(`${P}/change/catalog`)).items.find((x: any) => x.name.includes("DNS"));
    const r = await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: at(3), planned_end: at(3, 10), assignment_group_id: w.g.network, submit: true });
    expect(r.warning).toBeNull();
    expect(r.change.type).toBe("standard");
    expect(r.change.state).toBe("scheduled");
    expect(r.change.risk).toBe("low");
    expect(r.change.risk_source).toBe("template");
    expect(r.change.authorized_at).toBeTruthy();
    const tasks = (await p.agent.client.get(`${P}/r/change_task?filter=${encodeURIComponent(JSON.stringify({ f: "change_id", op: "eq", v: r.change.id }))}`)).rows;
    expect(tasks.length).toBe(2);
    const tpl = (await p.agent.client.get(`${P}/r/change_template/${item.id}`)).row;
    expect(tpl.usage_count).toBe(1);
  });

  it("a standard change cannot run longer than its template allows", async () => {
    const { P, p } = w;
    const item = (await p.agent.client.get(`${P}/change/catalog`)).items.find((x: any) => x.name.includes("DNS"));
    const e = await p.agent.client.post(`${P}/change/catalog/${item.id}/order`, { planned_start: at(3), planned_end: at(3, 18) }, 400);
    expect(e.error.details.fields.planned_end).toContain("حداکثر");
  });

  it("a retrospective change goes from the draft to the review with its actual times", async () => {
    const c = await w.change({ type: "latent", actual_start: at(-2), actual_end: at(-2, 10), discovered_by: "audit" });
    expect(c.retrospective).toBe(true);
    const r = await w.move(c.id, ["review"], w.p.agent.client, { close_code: "successful" });
    expect(r.state).toBe("review");
    expect(r.is_late).toBe(false);
  });
});

describe("holds", () => {
  it("a held change does not move forward until resumed", async () => {
    const { P, p } = w;
    const c = await w.change(manual("moderate"));
    await p.agent.client.post(`${P}/change/records/${c.id}/hold`, { reason: "vendor", note: "منتظر قطعه" });
    const held = await w.get(c.id, p.agent.client);
    expect(held.on_hold).toBe(true);
    expect(held.on_hold_since).toBeTruthy();
    const e = await p.agent.client.post(`${P}/r/change_request/${c.id}/transition`, { to: "assess", version: held.version }, 409);
    expect(e.error.message).toContain("متوقف");
    await p.agent.client.post(`${P}/change/records/${c.id}/resume`, {});
    expect((await w.move(c.id, ["assess"])).state).toBe("assess");
  });
});
