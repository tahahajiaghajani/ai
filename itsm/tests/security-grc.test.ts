// Governance, risk and compliance: the seeded library (93 Annex A controls in Persian, CSF, 20000-1, placeholders, the
// 5 × 5 matrix, appetite, starter controls), idempotent seeds, requirement status from controls and the SoA approval
// (back to draft when applicability changes), control tests → effectiveness and issues, continuous monitoring with
// failing indicators opening issues, policies published through approval and acknowledged by their campaign's
// audience (who reads only those records), risk scores, residual, appetite and acceptance by the risk owner with expiry,
// audit independence and closing, CSF gaps, the dashboard, the heat map and the review tools.
import { describe, expect, it, beforeAll } from "vitest";
import { secWorld, type SecWorld } from "./security-helpers";
import { indicatorValue, measureIndicators, securitySweep, seedSecurityDefaults } from "@server/modules/security";
import { ANNEX_A } from "@shared/security/frameworks";

let w: SecWorld;
const enc = (f: unknown) => encodeURIComponent(JSON.stringify(f));
beforeAll(async () => {
  w = await secWorld();
});

describe("the seeded library", () => {
  it("holds the 93 Annex A controls with Persian titles, CSF categories and the placeholders; seeding again adds nothing", async () => {
    expect(ANNEX_A.length).toBe(93);
    expect(new Set(ANNEX_A.map((a) => a.code)).size).toBe(93);
    const fws = (await w.p.grc.client.get(`${w.P}/r/grc_framework?size=20`)).rows as any[];
    const iso = fws.find((f) => f.key === "iso27001_2022");
    expect(iso.requirement_count).toBe(93);
    const reqs = (await w.p.grc.client.get(`${w.P}/r/grc_requirement?size=200&filter=${enc({ f: "framework_id", op: "eq", v: iso.id })}`)).rows as any[];
    expect(reqs.length).toBe(93);
    expect(reqs.find((r) => r.code === "A.8.8").title).toBe("مدیریت آسیب‌پذیری‌های فنی");
    expect(fws.find((f) => f.key === "nist_csf_2").requirement_count).toBe(28);
    expect(fws.filter((f) => f.placeholder).length).toBe(3);
    const again = await seedSecurityDefaults(w.e.cfg, w.e.org);
    expect(again.skipped).toBe(true);
    const forced = await seedSecurityDefaults(w.e.cfg, w.e.org, { force: true });
    expect(Object.values(forced.created).reduce((s, n) => s + n, 0)).toBe(0);
    const matrices = (await w.p.grc.client.get(`${w.P}/r/grc_risk_matrix`)).rows as any[];
    expect(matrices.length).toBe(1);
    const playbooks = (await w.p.soc.client.get(`${w.P}/r/sec_playbook`)).rows as any[];
    expect(playbooks.map((p) => p.category).sort()).toEqual(["data_breach", "malware", "phishing"]);
  });
});

describe("controls, requirements and the SoA", () => {
  it("derives requirement compliance from mapped controls and their tests; a failed test opens an issue", async () => {
    let ctl = (await w.p.grc.client.get(`${w.P}/r/grc_control?q=SEC-VM-01`)).rows[0];
    const a88 = (await w.p.grc.client.get(`${w.P}/r/grc_requirement?q=A.8.8`)).rows.find((r: any) => r.code === "A.8.8");
    expect(a88.control_count).toBeGreaterThanOrEqual(2);
    ctl = (await w.p.grc.client.patch(`${w.P}/r/grc_control/${ctl.id}`, { implementation_status: "implemented", owner_id: w.p.ro.userId, version: ctl.version })).row;
    let req = (await w.p.grc.client.get(`${w.P}/r/grc_requirement/${a88.id}`)).row;
    expect(req.implementation).toBe("implemented");
    let t = (await w.p.grc.client.post(`${w.P}/r/grc_control_test`, { control_id: ctl.id, kind: "operating", population: 40, sample_size: 10, exceptions: 0 })).row;
    t = (await w.p.grc.client.post(`${w.P}/r/grc_control_test/${t.id}/transition`, { to: "completed", data: { conclusion: "effective" }, version: t.version })).row;
    req = (await w.p.grc.client.get(`${w.P}/r/grc_requirement/${a88.id}`)).row;
    expect(req.compliance).toBe("compliant");
    // a failing test turns the requirement partial and opens an issue for the control's owner
    let t2 = (await w.p.grc.client.post(`${w.P}/r/grc_control_test`, { control_id: ctl.id, kind: "operating", population: 40, sample_size: 10, exceptions: 4 })).row;
    t2 = (await w.p.grc.client.post(`${w.P}/r/grc_control_test/${t2.id}/transition`, { to: "completed", data: { conclusion: "ineffective", result_notes: "۴ مورد بی‌وصله" }, version: t2.version })).row;
    expect(t2.issue_id).toBeTruthy();
    const issue = (await w.p.grc.client.get(`${w.P}/r/grc_issue/${t2.issue_id}`)).row;
    expect(issue.owner_id).toBe(w.p.ro.userId);
    expect(issue.source).toBe("control_test");
    ctl = (await w.p.grc.client.get(`${w.P}/r/grc_control/${ctl.id}`)).row;
    expect(ctl.effectiveness).toBe("ineffective");
    const xw = (await w.p.grc.client.get(`${w.P}/security/controls/${ctl.id}/crosswalk`)).frameworks as any[];
    expect(xw.length).toBe(3);
  });

  it("approves the SoA (the ISMS owner only) and returns an entry to draft when its applicability changes", async () => {
    const soa = await w.p.grc.client.get(`${w.P}/security/soa`);
    expect(soa.rows.length).toBe(93);
    const a514 = soa.rows.find((r: any) => r.code === "A.7.4");
    await w.p.ro.client.post(`${w.P}/security/soa/approve`, { ids: [a514.id] }, 403);
    // excluding without a justification is refused at approval
    let req = (await w.p.grc.client.get(`${w.P}/r/grc_requirement/${a514.id}`)).row;
    req = (await w.p.grc.client.patch(`${w.P}/r/grc_requirement/${a514.id}`, { applicable: false, version: req.version })).row;
    expect(req.compliance).toBe("not_applicable");
    await w.p.grc.client.post(`${w.P}/security/soa/approve`, { ids: [a514.id] }, 400);
    req = (await w.p.grc.client.patch(`${w.P}/r/grc_requirement/${a514.id}`, { justification: "مرکز داده در اختیار تأمین‌کننده است", version: req.version })).row;
    const ok = await w.p.grc.client.post(`${w.P}/security/soa/approve`, { ids: [a514.id] });
    expect(ok.approved).toBe(1);
    req = (await w.p.grc.client.get(`${w.P}/r/grc_requirement/${a514.id}`)).row;
    expect(req.soa_state).toBe("approved");
    req = (await w.p.grc.client.patch(`${w.P}/r/grc_requirement/${a514.id}`, { applicable: true, version: req.version })).row;
    expect(req.soa_state).toBe("draft");
  });

  it("measures the indicators over the organisation's data and opens one issue per failing control", async () => {
    // a published policy with an active campaign nobody answered: policy_ack is 0 %
    const v = await indicatorValue(w.sys, "kev_overdue");
    expect(v).toBe(0);
    const r = await measureIndicators(w.sys);
    expect(r.measured).toBeGreaterThan(3);
    const kev = (await w.p.grc.client.get(`${w.P}/r/grc_control?q=SEC-VM-02`)).rows[0];
    expect(kev.indicator_status).toBe("pass");
    await measureIndicators(w.sys);
    const issues = (await w.p.grc.client.get(`${w.P}/r/grc_issue?size=100&filter=${enc({ f: "source", op: "eq", v: "indicator" })}`)).rows as any[];
    const perControl = new Map<string, number>();
    for (const i of issues) perControl.set(i.control_id, (perControl.get(i.control_id) ?? 0) + 1);
    expect([...perControl.values()].every((n) => n === 1)).toBe(true);
  });
});

describe("policies and acknowledgement campaigns", () => {
  it("publishes a policy through its approver, and its campaign audience reads and acknowledges it — nothing else", async () => {
    let pol = (await w.p.grc.client.post(`${w.P}/r/grc_policy`, { title: "خط‌مشی استفادهٔ قابل‌قبول", kind: "policy", body: "استفاده از حافظهٔ USB شخصی ممنوع است.", approver_id: w.p.ciso.userId })).row;
    pol = (await w.p.grc.client.post(`${w.P}/r/grc_policy/${pol.id}/transition`, { to: "review", version: pol.version })).row;
    await w.drain();
    const ap = ((await w.p.ciso.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === pol.id);
    await w.p.ciso.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved" });
    pol = (await w.p.grc.client.get(`${w.P}/r/grc_policy/${pol.id}`)).row;
    expect(pol.state).toBe("published");
    expect(pol.next_review_at).toBeTruthy();
    // the requester cannot read the policy before a campaign addresses them
    await w.p.req.client.get(`${w.P}/r/grc_policy/${pol.id}`, 404);
    let camp = (await w.p.grc.client.post(`${w.P}/r/grc_policy_campaign`, { title: "پذیرش سالانه", policy_id: pol.id, due_at: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), target_users: [w.p.req.userId] })).row;
    camp = (await w.p.grc.client.post(`${w.P}/r/grc_policy_campaign/${camp.id}/transition`, { to: "active", version: camp.version })).row;
    expect(camp.version_label).toBe("1.0");
    const mine = (await w.p.req.client.get(`${w.P}/security/policies/mine`)).policies as any[];
    expect(mine.length).toBe(1);
    expect(mine[0].body).toMatch(/USB/);
    expect((await w.p.req.client.get(`${w.P}/r/grc_policy/${pol.id}`)).row.title).toBe("خط‌مشی استفادهٔ قابل‌قبول");
    await w.p.req.client.get(`${w.P}/r/grc_policy?size=5`, 403);
    await w.p.agent.client.post(`${w.P}/security/policies/campaigns/${camp.id}/ack`, {}, 403);
    await w.p.req.client.post(`${w.P}/security/policies/campaigns/${camp.id}/ack`, {});
    const st = await w.p.grc.client.get(`${w.P}/security/policies/campaigns/${camp.id}/status`);
    expect(st.acknowledged).toBe(1);
    expect(st.rate).toBe(100);
    // what people accepted changes only through a new edition; the review date may move
    await w.p.grc.client.patch(`${w.P}/r/grc_policy/${pol.id}`, { body: "استفاده از حافظهٔ USB شخصی آزاد است.", version: pol.version }, 400);
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    pol = (await w.p.grc.client.patch(`${w.P}/r/grc_policy/${pol.id}`, { next_review_at: past, version: pol.version })).row;
    expect(pol.body).toMatch(/ممنوع/);
    // the owner hears once that the review is due, however often the sweep runs
    await w.drain();
    const notices = async () =>
      (await w.e.db.query(`select id from sm_notification_log where org_id = $1 and record_id = $2 and recipient_id = $3 and channel = 'in_app' and subject like '%بازنگری%'`, [w.e.org, pol.id, w.p.grc.userId])).length;
    expect(await notices()).toBe(0);
    await securitySweep(w.sys);
    await securitySweep(w.sys);
    await w.drain();
    expect(await notices()).toBe(1);
    // a new edition goes back to draft with the next version label and ends the campaign of the old one
    pol = (await w.p.grc.client.post(`${w.P}/r/grc_policy/${pol.id}/transition`, { to: "draft", version: pol.version })).row;
    expect(pol.version_label).toBe("1.1");
    pol = (await w.p.grc.client.patch(`${w.P}/r/grc_policy/${pol.id}`, { body: "حافظهٔ USB فقط با رمزنگاری و تأیید واحد امنیت مجاز است.", version: pol.version })).row;
    expect(pol.body).toMatch(/رمزنگاری/);
    camp = (await w.p.grc.client.get(`${w.P}/r/grc_policy_campaign/${camp.id}`)).row;
    expect(camp.state).toBe("closed");
    expect(((await w.p.req.client.get(`${w.P}/security/policies/mine`)).policies as any[]).length).toBe(0);
    await w.p.req.client.post(`${w.P}/security/policies/campaigns/${camp.id}/ack`, {}, 400);
    // published again: the old campaign stays with its version; a new campaign asks for the new text
    pol = (await w.p.grc.client.post(`${w.P}/r/grc_policy/${pol.id}/transition`, { to: "review", version: pol.version })).row;
    await w.drain();
    const ap2 = ((await w.p.ciso.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === pol.id);
    await w.p.ciso.client.post(`${w.P}/approvals/${ap2.id}/decide`, { decision: "approved" });
    expect((await w.p.grc.client.get(`${w.P}/r/grc_policy/${pol.id}`)).row.state).toBe("published");
    await w.p.grc.client.post(`${w.P}/r/grc_policy_campaign/${camp.id}/transition`, { to: "active", version: camp.version }, 409);
    let camp2 = (await w.p.grc.client.post(`${w.P}/r/grc_policy_campaign`, { title: "پذیرش نسخهٔ ۱.۱", policy_id: pol.id, due_at: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), target_users: [w.p.req.userId] })).row;
    camp2 = (await w.p.grc.client.post(`${w.P}/r/grc_policy_campaign/${camp2.id}/transition`, { to: "active", version: camp2.version })).row;
    expect(camp2.version_label).toBe("1.1");
    const again = (await w.p.req.client.get(`${w.P}/security/policies/mine`)).policies as any[];
    expect(again.length).toBe(1);
    expect(again[0].acked_at).toBeNull();
    expect(again[0].body).toMatch(/رمزنگاری/);
    await w.p.req.client.post(`${w.P}/security/policies/campaigns/${camp2.id}/ack`, {});
    expect((await w.p.grc.client.get(`${w.P}/security/policies/campaigns/${camp2.id}/status`)).acknowledged).toBe(1);
  });
});

describe("risks", () => {
  it("scores inherent and residual risk from the default matrix, compares with appetite and records the reporter's role", async () => {
    let r = (await w.p.ro.client.post(`${w.P}/r/grc_risk`, { title: "از دست رفتن داده‌های مشتری", category: "privacy", owner_id: w.p.ro.userId, inherent_likelihood: "4", inherent_impact: "5", control_effectiveness: "moderate", sle: "1000000", aro: "0.5" })).row;
    expect(r.inherent_score).toBe(20);
    expect(r.inherent_rating).toBe("critical");
    expect(r.residual_likelihood).toBe("3");
    expect(r.residual_score).toBe(15);
    expect(r.appetite_score).toBe(4);
    expect(r.above_appetite).toBe(true);
    expect(r.ale).toBe("500000");
    expect(r.reporter_role).toBe("سایر کارکنان");
    expect(r.matrix_id).toBeTruthy();
    // the risk owner reads their own risk; another member without the area does not
    await w.p.req.client.get(`${w.P}/r/grc_risk/${r.id}`, 404);
    r = (await w.p.ro.client.post(`${w.P}/r/grc_risk/${r.id}/transition`, { to: "assessed", version: r.version })).row;
    // acceptance needs an active acceptance by the owner
    await w.p.ro.client.post(`${w.P}/r/grc_risk/${r.id}/transition`, { to: "accepted", version: r.version }, 409);
  });

  it("accepts a risk only by its owner, with expiry returning it to assessment", async () => {
    let r = (await w.p.grc.client.post(`${w.P}/r/grc_risk`, { title: "قطع خدمت ابری", category: "availability", owner_id: w.p.ro.userId, inherent_likelihood: "2", inherent_impact: "4" })).row;
    r = (await w.p.grc.client.post(`${w.P}/r/grc_risk/${r.id}/transition`, { to: "assessed", version: r.version })).row;
    const exp = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    let acc = (await w.p.grc.client.post(`${w.P}/r/grc_risk_acceptance`, { risk_id: r.id, expires_at: exp, conditions: "پشتیبان روزانه در منطقهٔ دیگر" })).row;
    expect(acc.accepted_by).toBe(w.p.ro.userId);
    await w.drain();
    const ap = ((await w.p.ro.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === acc.id);
    expect(ap).toBeTruthy();
    await w.p.ro.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved" });
    acc = (await w.p.grc.client.get(`${w.P}/r/grc_risk_acceptance/${acc.id}`)).row;
    expect(acc.state).toBe("active");
    r = (await w.p.grc.client.get(`${w.P}/r/grc_risk/${r.id}`)).row;
    expect(r.state).toBe("accepted");
    await w.e.db.query(`update sm_grc_risk_acceptances set expires_at = current_date - 1 where id = $1`, [acc.id]);
    await securitySweep(w.sys);
    r = (await w.p.grc.client.get(`${w.P}/r/grc_risk/${r.id}`)).row;
    expect(r.state).toBe("assessed");
  });

  it("serves the heat map with the above-appetite list", async () => {
    const h = await w.p.grc.client.get(`${w.P}/security/risks/heatmap`);
    expect(h.residual.length).toBe(25);
    expect(h.above_appetite.length).toBeGreaterThanOrEqual(1);
    await w.p.req.client.get(`${w.P}/security/risks/heatmap`, 403);
  });
});

describe("audits, profiles and the dashboard", () => {
  it("checks auditor independence and refuses closing with open findings", async () => {
    const iso = (await w.p.grc.client.get(`${w.P}/r/grc_framework?q=27001`)).rows[0];
    let a = (await w.p.grc.client.post(`${w.P}/r/grc_audit`, { title: "ممیزی داخلی ۱۴۰۵", framework_id: iso.id, lead_auditor_id: w.p.ro.userId, planned_start: "2026-12-01" })).row;
    // the risk owner owns SEC-VM-01 (mapped to Annex A): not independent
    expect(a.independence_ok).toBe(false);
    a = (await w.p.grc.client.patch(`${w.P}/r/grc_audit/${a.id}`, { lead_auditor_id: w.p.auditor.userId, version: a.version })).row;
    expect(a.independence_ok).toBe(true);
    await w.p.grc.client.post(`${w.P}/r/grc_finding`, { title: "شواهد آزمون ناقص", audit_id: a.id, kind: "minor_nc" });
    a = (await w.p.grc.client.post(`${w.P}/r/grc_audit/${a.id}/transition`, { to: "fieldwork", version: a.version })).row;
    a = (await w.p.grc.client.post(`${w.P}/r/grc_audit/${a.id}/transition`, { to: "reporting", version: a.version })).row;
    await w.p.grc.client.post(`${w.P}/r/grc_audit/${a.id}/transition`, { to: "closed", version: a.version }, 409);
  });

  it("computes a CSF profile's gap and serves the dashboard sections by area", async () => {
    const p = (await w.p.grc.client.post(`${w.P}/r/grc_csf_profile`, { name: "پروفایل کنونی", kind: "current", items: { "GV.OC": { current: 1, target: 3 }, "PR.AA": { current: 2, target: 4 }, "DE.CM": { current: 3, target: 3 } } })).row;
    expect(p.gap_total).toBe(4);
    await w.p.grc.client.post(`${w.P}/r/grc_csf_profile`, { name: "بد", items: { "GV.OC": { current: 9 } } }, 400);
    const d = await w.p.grc.client.get(`${w.P}/security/dashboard`);
    expect(d.ops).toBeNull();
    expect(d.compliance.frameworks.length).toBeGreaterThanOrEqual(6);
    expect(d.risk.above_appetite).toBeGreaterThanOrEqual(1);
    const ciso = await w.p.ciso.client.get(`${w.P}/security/dashboard`);
    expect(ciso.ops).not.toBeNull();
    expect(ciso.vuln).not.toBeNull();
    const req = await w.p.req.client.get(`${w.P}/security/dashboard`);
    expect(req).toEqual({ ops: null, vuln: null, compliance: null, risk: null });
  });
});
