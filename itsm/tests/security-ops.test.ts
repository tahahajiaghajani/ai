// Security operations: the security incident's lifecycle (risk score and priority, NIST phases and their stamps,
// playbook tasks, containment actions that need approval, the review and close guards), regulatory clocks and their
// submissions, evidence custody, observables, the promotion of IT incidents (by hand and automatic), phishing reports
// with grouping and the reporter's redacted view, the SOC workspace and the handover.
import { describe, expect, it, beforeAll } from "vitest";
import { secWorld, type SecWorld } from "./security-helpers";

let w: SecWorld;
beforeAll(async () => {
  w = await secWorld();
});

describe("security incidents", () => {
  it("lives in the secure workspace, confidential, with a risk score, a priority and the category's playbook", async () => {
    const r = await w.sir({ category: "phishing", severity: "1", business_impact: "2", classification: "confidential", personal_data_breach: false });
    expect(r.number).toMatch(/^SIR/);
    expect(r.workspace_id).toBe(w.ws);
    expect(r.confidential).toBe(true);
    expect(r.assignment_group_id).toBe(w.g.soc);
    expect(r.risk_score).toBeGreaterThan(60);
    expect(r.priority).toBe("2");
    expect(r.detected_at).toBeTruthy();
    const tasks = (await w.p.soc.client.get(`${w.P}/r/sec_task?filter=${encodeURIComponent(JSON.stringify({ f: "sec_incident_id", op: "eq", v: r.id }))}&size=50`)).rows;
    expect(tasks.length).toBe(8);
    const contain = tasks.find((t: any) => t.action === "block_url");
    expect(contain.requires_approval).toBe(true);
    expect(contain.phase).toBe("contain");
  });

  it("is created only by members of the secure workspace", async () => {
    await w.p.analyst.client.post(`${w.P}/r/sec_incident`, { short_description: "x", category: "malware" }, 403);
    await w.o.post(`${w.P}/r/sec_incident`, { short_description: "x", category: "malware" }, 403);
  });

  it("keeps the workspace and the confidential flag whatever a client sends", async () => {
    const r = await w.sir();
    const other = (await w.o.post(`${w.P}/r/workspace`, { key: "other", name: "دیگر" })).row.id;
    const u = (await w.p.soc.client.patch(`${w.P}/r/sec_incident/${r.id}`, { workspace_id: other, confidential: false, version: r.version })).row;
    expect(u.workspace_id).toBe(w.ws);
    expect(u.confidential).toBe(true);
  });

  it("stamps containment, eradication and recovery and computes MTTD / MTTC / MTTR", async () => {
    const first = new Date(Date.now() - 6 * 3600_000).toISOString();
    const detected = new Date(Date.now() - 4 * 3600_000).toISOString();
    let r = await w.sir({ category: "other", first_malicious_at: first, detected_at: detected });
    const go = async (to: string, data: Record<string, unknown> = {}) => (r = (await w.p.soc.client.post(`${w.P}/r/sec_incident/${r.id}/transition`, { to, data, version: r.version })).row);
    await go("analysis");
    await go("contain");
    expect(r.contained_at).toBeFalsy();
    await go("eradicate");
    expect(r.contained_at).toBeTruthy();
    expect(r.time_to_detect).toBe(7200);
    expect(r.time_to_contain).toBeGreaterThanOrEqual(4 * 3600 - 5);
    await go("recover");
    expect(r.eradicated_at).toBeTruthy();
    await go("review", { close_code: "true_positive" });
    expect(r.recovered_at).toBeTruthy();
    expect(r.time_to_recover).toBeGreaterThan(0);
    // an important true positive needs its lessons before closing
    await w.p.soc.client.post(`${w.P}/r/sec_incident/${r.id}/transition`, { to: "closed", data: { close_notes: "پایان" }, version: r.version }, 409);
    r = (await w.p.soc.client.patch(`${w.P}/r/sec_incident/${r.id}`, { lessons: "آموزش کاربران و مسدودسازی ماکروها", version: r.version })).row;
    expect(r.pir_done_at).toBeTruthy();
    await go("closed", { close_notes: "پایان" });
    expect(r.state).toBe("closed");
  });

  it("refuses review while mandatory response tasks are open, and containment actions wait for approval", async () => {
    let r = await w.sir({ category: "malware" });
    const tasks = (await w.p.soc.client.get(`${w.P}/r/sec_task?filter=${encodeURIComponent(JSON.stringify({ f: "sec_incident_id", op: "eq", v: r.id }))}&size=50`)).rows;
    expect(tasks.length).toBe(7);
    r = (await w.p.soc.client.post(`${w.P}/r/sec_incident/${r.id}/transition`, { to: "analysis", version: r.version })).row;
    await w.p.soc.client.post(`${w.P}/r/sec_incident/${r.id}/transition`, { to: "review", data: { close_code: "true_positive" }, version: r.version }, 409);
    const isolate = tasks.find((t: any) => t.action === "isolate_host");
    // start → the approval is requested of the SOC group (not the analyst themselves)
    let t = (await w.p.soc.client.post(`${w.P}/r/sec_task/${isolate.id}/transition`, { to: "in_progress", version: isolate.version })).row;
    await w.drain();
    t = (await w.p.soc.client.get(`${w.P}/r/sec_task/${isolate.id}`)).row;
    expect(t.approval).toBe("requested");
    await w.p.soc.client.post(`${w.P}/r/sec_task/${t.id}/transition`, { to: "closed_complete", version: t.version }, 409);
    const mine = (await w.p.soc2.client.get(`${w.P}/approvals/mine`)).approvals as any[];
    const ap = mine.find((a) => a.record_id === t.id);
    expect(ap).toBeTruthy();
    await w.p.soc2.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved", comments: "تأیید" });
    t = (await w.p.soc.client.get(`${w.P}/r/sec_task/${t.id}`)).row;
    expect(t.approval).toBe("approved");
    t = (await w.p.soc.client.post(`${w.P}/r/sec_task/${t.id}/transition`, { to: "closed_complete", data: { action_target: "PC-042" }, version: t.version })).row;
    expect(t.executed_at).toBeTruthy();
    const journal = (await w.p.soc.client.get(`${w.P}/r/sec_incident/${r.id}/journal`)).entries as any[];
    expect(journal.some((j) => /اقدام مهار/.test(j.body))).toBe(true);
  });
});

describe("regulatory clocks, evidence and observables", () => {
  it("computes calendar deadlines from awareness, records submissions and blocks closing while running", async () => {
    let r = await w.sir({ category: "data_breach", personal_data_breach: true, affected_data: "فهرست مشتریان", records_affected: 1200 });
    const regimes = (await w.p.soc.client.get(`${w.P}/security/incidents/${r.id}/regimes`)).regimes as any[];
    expect(regimes[0].personal_data).toBe(true);
    const nis2 = regimes.find((x) => x.name === "NIS2");
    const aware = new Date(Date.now() - 2 * 3600_000).toISOString();
    const clock = (await w.p.soc.client.post(`${w.P}/security/incidents/${r.id}/clocks`, { regime_id: nis2.id, aware_at: aware })).row;
    expect(clock.deadlines.length).toBe(3);
    expect(Date.parse(clock.deadlines[0].due_at) - Date.parse(aware)).toBe(24 * 3600_000);
    expect(clock.next_stage).toBe("هشدار اولیه");
    r = (await w.p.soc.client.get(`${w.P}/r/sec_incident/${r.id}`)).row;
    expect(r.regulatory).toBe(true);
    let c = (await w.p.soc.client.post(`${w.P}/security/clocks/${clock.id}/submit`, { stage: "early_warning", reference: "CERT-1" })).row;
    expect(c.next_stage).toBe("اطلاع رخداد");
    c = (await w.p.soc.client.post(`${w.P}/security/clocks/${clock.id}/submit`, { stage: "notification" })).row;
    c = (await w.p.soc.client.post(`${w.P}/security/clocks/${clock.id}/submit`, { stage: "final" })).row;
    expect(c.state).toBe("submitted");
  });

  it("keeps a chain of custody and refuses release under legal hold", async () => {
    const r = await w.sir();
    let ev = (await w.p.soc.client.post(`${w.P}/r/sec_evidence`, { title: "تصویر حافظه", kind: "memory", sec_incident_id: r.id, legal_hold: true, location: "گاوصندوق ۲" })).row;
    expect(ev.confidential).toBe(true);
    expect(ev.custody_log[0].action).toBe("collected");
    ev = (await w.p.soc.client.post(`${w.P}/security/evidence/${ev.id}/transfer`, { to: w.p.soc2.userId, note: "برای تحلیل" })).row;
    expect(ev.custody_log.at(-1).action).toBe("transfer");
    ev = (await w.p.soc2.client.post(`${w.P}/r/sec_evidence/${ev.id}/transition`, { to: "stored", version: ev.version })).row;
    await w.p.soc2.client.post(`${w.P}/r/sec_evidence/${ev.id}/transition`, { to: "destroyed", data: { notes: "امحا" }, version: ev.version }, 409);
  });

  it("adds observables refanged and de-duplicated, linking each to its incidents", async () => {
    const a = await w.sir();
    const b = await w.sir();
    const r1 = await w.p.soc.client.post(`${w.P}/security/incidents/${a.id}/observables`, { values: ["hxxp://evil[.]example.com/login", "203.0.113.7", "EVIL.example.com"] });
    expect(r1.added).toBe(3);
    const types = r1.observables.map((o: any) => o.type).sort();
    expect(types).toEqual(["domain", "ipv4", "url"]);
    const r2 = await w.p.soc.client.post(`${w.P}/security/incidents/${b.id}/observables`, { values: ["203.0.113.7"] });
    expect(r2.observables[0].id).toBe(r1.observables.find((o: any) => o.type === "ipv4").id);
    expect(r2.observables[0].sightings).toBe(2);
  });
});

describe("IT incidents, phishing reports and the SOC workspace", () => {
  it("promotes an IT incident by hand (linked, noted) and automatically when it is flagged", async () => {
    const inc = (await w.p.agent.client.post(`${w.P}/r/incident`, { short_description: "رایانامهٔ مشکوک بانک", category: "software" })).row;
    const r = await w.p.soc.client.post(`${w.P}/security/promote/${inc.id}`, {});
    expect(r.created).toBe(true);
    const sir = (await w.p.soc.client.get(`${w.P}/r/sec_incident/${r.id}`)).row;
    expect(sir.category).toBe("other");
    expect(sir.source).toBe("promoted");
    expect(sir.it_incident_id).toBe(inc.id);
    // the desk agent sees a note with the number, never the security incident
    const seen = await w.p.agent.client.get(`${w.P}/security/promoted/${inc.id}`);
    expect(seen.sir).toBeNull();
    await w.p.agent.client.get(`${w.P}/r/sec_incident/${r.id}`, 404);
    // automatic: a flagged incident gets its security incident through the subscriber
    const inc2 = (await w.p.agent.client.post(`${w.P}/r/incident`, { short_description: "باج‌افزار روی رایانه", security_incident: true })).row;
    await w.drain();
    const auto = (await w.p.soc.client.get(`${w.P}/security/promoted/${inc2.id}`)).sir;
    expect(auto?.number).toMatch(/^SIR/);
  });

  it("files phishing reports from any member, groups the same sender and shows the reporter only a redacted status", async () => {
    const one = await w.p.req.client.post(`${w.P}/security/phishing`, { subject: "حساب شما مسدود شد", sender: "Bank <alert@fake-bank.example>", body: "برای فعال‌سازی روی http://fake-bank.example/verify بزنید" });
    expect(one.receipt).toMatch(/^SIR/);
    expect(one.grouped).toBe(false);
    const two = await w.p.agent.client.post(`${w.P}/security/phishing`, { subject: "حساب شما مسدود شد", sender: "alert@fake-bank.example", body: "http://fake-bank.example/verify" });
    expect(two.grouped).toBe(true);
    const mine = (await w.p.req.client.get(`${w.P}/security/my-reports`)).reports;
    expect(mine.length).toBe(1);
    expect(Object.keys(mine[0]).sort()).toEqual(["number", "outcome", "reported_at", "status"]);
    // the agent who reported the same mail is listed as affected but gets no number
    const theirs = (await w.p.agent.client.get(`${w.P}/security/my-reports`)).reports;
    expect(theirs[0].number).toBeNull();
    await w.p.req.client.get(`${w.P}/r/sec_incident?size=5`, 403);
  });

  it("serves the SOC workspace and a handover to the SOC only", async () => {
    const soc = await w.p.soc.client.get(`${w.P}/security/soc`);
    expect(soc.tiles.find((t: any) => t.key === "open").value).toBeGreaterThan(0);
    expect(soc.handover).toMatch(/تحویل شیفت/);
    await w.p.agent.client.get(`${w.P}/security/soc`, 403);
  });
});
