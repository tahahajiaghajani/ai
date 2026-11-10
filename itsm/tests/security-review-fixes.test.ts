// Review fixes of security operations, vulnerability response and GRC (each case failed before its fix):
//   · a phishing reporter or a promoted incident's caller who holds any security grant does not read the incident
//     outside the secure workspace (no own/requester way in)
//   · the scan-import XML reader is linear (deep or unmatched tags, long attribute runs) and bounded
//   · a containment action: its starter is no approver, its approver does not carry it out, and a Windows push never
//     sets its approval or completes it unapproved
//   · an exception (and a policy waiver) is decided by its approval round, never by its requester
//   · legal hold: the stored hold counts, lifting it is a step of its own, a pushed deletion of held evidence is
//     refused and the custody log is the cloud's
//   · «false positive» only through an approved exception; one without is reopened when a scan sees it again
//   · a risk acceptance is its current owner's: no self-named acceptor, no acceptance of an unreadable risk
//   · PII redaction scrubs the record's history too; a masked e-mail shows nothing of the address
//   · an incident with a running regulatory clock is not canceled
//   · host matching looks up every host of an import (no cut at 500)
//   · phishing reports group on the sender's address or a link, never on a shared domain; a grouped report gets no
//     other reporter's number
import { beforeAll, describe, expect, it } from "vitest";
import { secWorld, type SecWorld } from "./security-helpers";
import { statusOf } from "./portal-helpers";
import type { Client } from "./helpers";
import { parseScan, parseXml, XML_LIMITS } from "@shared/security/scan";
import { detectPii, mask } from "@shared/security/pii";
import { tableDef } from "@shared/tables";
import { createIn } from "@server/engine";
import { matchHosts } from "@server/modules/security/vuln";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";

type Result = { entity: string; id: string; status: string; message?: string };
let w: SecWorld;

async function push(c: Client, aggregates: { entity: string; id: string; base_rev: number; row: Record<string, unknown> }[]): Promise<Result[]> {
  return (await c.post(`/sync/push`, { org_id: w.e.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates })).results as Result[];
}
/** A stored row in the shape a Windows app pushes it, with `patch` and a later stamp. */
async function rowOf(table: string, id: string, patch: Record<string, unknown>): Promise<{ row: Record<string, unknown>; rev: number }> {
  const r = (await w.e.db.one<Record<string, unknown>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
  return { row: { ...JSON.parse(JSON.stringify(r)), ...patch, updated_at: new Date(Date.now() + 5_000).toISOString() }, rev: Number(r.rev) };
}
const stored = async (table: string, id: string) => (await w.e.db.one<Record<string, any>>(`select * from ${tableDef(table)!.table} where id = $1`, [id]))!;
const sirByNumber = async (number: string) => ((await w.p.soc.client.get(`${w.P}/r/sec_incident?q=${encodeURIComponent(number)}`)).rows as any[]).find((r) => r.number === number);
const setRoles = async (who: keyof SecWorld["p"], roles: string[]) => {
  const prof = await w.o.get(`${w.P}/access/members/${w.p[who].userId}`);
  await w.o.put(`${w.P}/access/members/${w.p[who].userId}`, { roles, version: prof.profile?.version });
};

const NESSUS_CSV = `Plugin ID,CVE,CVSS v3.0 Base Score,Risk,Host,Protocol,Port,Name,Synopsis,Description,Solution,See Also,Plugin Output
97833,CVE-2017-0144,8.1,High,10.0.0.10,tcp,445,MS17-010: Security Update for Microsoft Windows SMB Server,Remote code execution,desc,Apply MS17-010,,SMBv1 enabled
97833,CVE-2017-0143,8.1,High,10.0.0.10,tcp,445,MS17-010: Security Update for Microsoft Windows SMB Server,Remote code execution,desc,Apply MS17-010,,SMBv1 enabled
42873,CVE-2016-2183,7.5,High,10.0.0.10,tcp,1433,SSL Medium Strength Cipher Suites Supported (SWEET32),weak ciphers,desc,Reconfigure,,3DES
`;

beforeAll(async () => {
  w = await secWorld();
  // the desk agent also remediates vulnerabilities of «زیرساخت» (security read and write: group)
  await w.o.post(`${w.P}/access/groups/${w.g.infra}/members`, { user_ids: [w.p.agent.userId] });
  await setRoles("agent", ["agent", "vuln_remediator"]);
  await w.o.post(`${w.P}/r/ci`, { name: "web01", class: "server", hostname: "web01", ip_address: "10.0.0.10", criticality: "1", support_group_id: w.g.infra, state: "operational" });
  // a real approval round for vulnerability exceptions: the CISO joins the vulnerability group
  await w.o.post(`${w.P}/access/groups/${w.g.vuln}/members`, { user_ids: [w.p.ciso.userId] });
  await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "پویش ۱", content: NESSUS_CSV, format: "csv" });
  await w.drain();
}, 240_000);

describe("who reads a security incident", () => {
  it("a phishing reporter with a security grant does not read the incident, its journal or its tasks", async () => {
    const one = await w.p.agent.client.post(`${w.P}/security/phishing`, { subject: "صورتحساب معوق", sender: "billing@invoice-fraud.example", body: "پرداخت: https://invoice-fraud.example/pay" });
    expect(one.receipt).toMatch(/^SIR/);
    const sir = await sirByNumber(one.receipt);
    await w.p.soc.client.post(`${w.P}/r/sec_incident/${sir.id}/journal`, { kind: "work_note", body: "SOC-INTERNAL-NOTE-123" });
    await w.p.agent.client.get(`${w.P}/r/sec_incident/${sir.id}`, 404);
    expect([403, 404]).toContain(await statusOf(w.p.agent.client, "GET", `${w.P}/r/sec_incident/${sir.id}/journal`));
    // a security analyst outside the SOC who reports a mail does not read it either
    const two = await w.p.analyst.client.post(`${w.P}/security/phishing`, { subject: "رمز عبور منقضی شد", sender: "it-desk@pwreset.example", body: "https://pwreset.example/login" });
    const sir2 = await sirByNumber(two.receipt);
    await w.p.analyst.client.get(`${w.P}/r/sec_incident/${sir2.id}`, 404);
    // … but follows the report through «گزارش‌های من»
    const mine = (await w.p.analyst.client.get(`${w.P}/security/my-reports`)).reports as any[];
    expect(mine.map((r) => r.number)).toContain(two.receipt);
  });

  it("the caller of a promoted IT incident does not read the security incident", async () => {
    const inc = (await w.p.agent.client.post(`${w.P}/r/incident`, { short_description: "رایانهٔ کند و پیام باج", caller_id: w.p.analyst.userId })).row;
    const r = await w.p.soc.client.post(`${w.P}/security/promote/${inc.id}`, {});
    const sir = (await w.p.soc.client.get(`${w.P}/r/sec_incident/${r.id}`)).row;
    expect(sir.caller_id).toBe(w.p.analyst.userId);
    await w.p.analyst.client.get(`${w.P}/r/sec_incident/${r.id}`, 404);
  });
});

describe("the scan-import XML reader", () => {
  it("parses unmatched end tags, deep nesting and long attribute runs in linear time, within its limits", () => {
    let t = Date.now();
    const deep = parseScan(`<NessusClientData_v2>${"<a>".repeat(20_000)}${"</b>".repeat(20_000)}`, { format: "xml" });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(deep.errors.join(" ")).toMatch(/تودرتو/);
    t = Date.now();
    const doc = parseXml(`<r>${"<a>".repeat(200)}${"</b>".repeat(200_000)}${"</a>".repeat(200)}<z k="v"/></r>`);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(doc.children[0].children.map((c) => c.name)).toEqual(["a", "z"]);
    t = Date.now();
    const attrs = parseXml(`<a ${"x".repeat(100_000)} y="1" ${"q ".repeat(30_000)}>t</a>`);
    expect(Date.now() - t).toBeLessThan(1500);
    expect(attrs.children[0].attrs).toEqual({ y: "1" });
    expect(XML_LIMITS.depth).toBeLessThanOrEqual(256);
  });

  it("still reads attributes, entities and mismatched end tags as before", () => {
    const doc = parseXml(`<?xml version="1.0"?><a x = "1&amp;2" y='3' z=4 w="5"><b><c></b><d k="v"/></a>`);
    const a = doc.children[0];
    expect(a.attrs).toEqual({ x: "1&2", y: "3", w: "5" });
    expect(a.children.map((c) => c.name)).toEqual(["b", "d"]);
    expect(a.children[0].children.map((c) => c.name)).toEqual(["c"]);
  });
});

describe("containment actions", () => {
  it("never asks the starter, never lets the approver carry it out, and is completed by someone else", async () => {
    const sir = await w.sir({ category: "malware" });
    const tasks = (await w.p.soc.client.get(`${w.P}/r/sec_task?filter=${encodeURIComponent(JSON.stringify({ f: "sec_incident_id", op: "eq", v: sir.id }))}&size=50`)).rows as any[];
    const isolate = tasks.find((t) => t.action === "isolate_host");
    await w.p.soc.client.post(`${w.P}/r/sec_task/${isolate.id}/transition`, { to: "in_progress", version: isolate.version });
    await w.drain();
    let t = (await w.p.soc.client.get(`${w.P}/r/sec_task/${isolate.id}`)).row;
    expect(t.started_by).toBe(w.p.soc.userId);
    expect(t.approval).toBe("requested");
    const own = ((await w.p.soc.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === isolate.id);
    expect(own).toBeUndefined();
    const ap = ((await w.p.soc2.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === isolate.id);
    expect(ap).toBeTruthy();
    await w.p.soc2.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved", comments: "تأیید" });
    t = (await w.p.soc2.client.get(`${w.P}/r/sec_task/${isolate.id}`)).row;
    expect(t.approval).toBe("approved");
    // the approver does not carry out the action they approved
    await w.p.soc2.client.post(`${w.P}/r/sec_task/${t.id}/transition`, { to: "closed_complete", version: t.version }, 409);
    t = (await w.p.soc.client.post(`${w.P}/r/sec_task/${t.id}/transition`, { to: "closed_complete", version: t.version })).row;
    expect(t.state).toBe("closed_complete");
  });

  it("a Windows push never sets the approval, nor completes the action without it", async () => {
    const sir = await w.sir({ category: "other" });
    const task = (await w.p.soc.client.post(`${w.P}/r/sec_task`, { short_description: "مسدودسازی نشانی", sec_incident_id: sir.id, action: "block_ip" })).row;
    expect(task.requires_approval).toBe(true);
    let p = await rowOf("sec_task", task.id, { state: "closed_complete", approval: "approved" });
    expect((await push(w.p.soc.client, [{ entity: "sec_task", id: task.id, base_rev: p.rev, row: p.row }]))[0].status).not.toBe("ok");
    let s = await stored("sec_task", task.id);
    expect([s.state, s.approval]).toEqual(["new", "not_requested"]);
    // an approval pushed on its own keeps the stored value
    p = await rowOf("sec_task", task.id, { approval: "approved", executed_by: w.p.soc2.userId });
    expect((await push(w.p.soc.client, [{ entity: "sec_task", id: task.id, base_rev: p.rev, row: p.row }]))[0].status).toBe("ok");
    s = await stored("sec_task", task.id);
    expect([s.approval, s.executed_by]).toEqual(["not_requested", null]);
  });
});

describe("exceptions", () => {
  it("are decided by the approval round, never by their requester", async () => {
    const item = ((await w.p.vm.client.get(`${w.P}/r/sec_vuln_item?size=100`)).rows as any[]).find((i) => i.state === "open")!;
    const exp = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    // a member files it in their own name (another requester is not taken)
    let exc = (await w.p.vm.client.post(`${w.P}/r/sec_vuln_exception`, { title: "تعویق تا پنجره", kind: "deferral", items: [item.id], justification: "پنجرهٔ نگهداری ماه بعد", expires_at: exp, requested_by: w.p.ciso.userId })).row;
    expect(exc.requested_by).toBe(w.p.vm.userId);
    exc = (await w.p.vm.client.post(`${w.P}/r/sec_vuln_exception/${exc.id}/transition`, { to: "requested", version: exc.version })).row;
    await w.drain();
    exc = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_exception/${exc.id}`)).row;
    expect(exc.approval).toBe("requested");
    // the requester does not approve it; nor does anyone else past the open round
    expect([403, 409]).toContain(await statusOf(w.p.vm.client, "POST", `${w.P}/r/sec_vuln_exception/${exc.id}/transition`, { to: "approved", version: exc.version }));
    expect([403, 409]).toContain(await statusOf(w.p.ciso.client, "POST", `${w.P}/r/sec_vuln_exception/${exc.id}/transition`, { to: "approved", version: exc.version }));
    expect((await w.p.vm.client.get(`${w.P}/r/sec_vuln_item/${item.id}`)).row.state).toBe("open");
    const ap = ((await w.p.ciso.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === exc.id);
    await w.p.ciso.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved" });
    exc = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_exception/${exc.id}`)).row;
    expect([exc.state, exc.approval]).toEqual(["approved", "approved"]);
    expect((await w.p.vm.client.get(`${w.P}/r/sec_vuln_item/${item.id}`)).row.state).toBe("deferred");
  });

  it("policy waivers decide on the compliance area", () => {
    const t = tableDef("grc_policy_exception")!.states!.transitions.find((x) => x.to === "approved")!;
    expect(t.roles).toMatchObject({ area: "compliance" });
    expect(t.guard).toBe("sec_exception_approve");
  });

  it("a false positive needs an approved exception of that kind; one without is reopened by the next scan", async () => {
    const items = (await w.p.agent.client.get(`${w.P}/r/sec_vuln_item?size=100`)).rows as any[];
    const it0 = items.find((i) => i.state === "open")!;
    expect([403, 409]).toContain(await statusOf(w.p.agent.client, "POST", `${w.P}/r/sec_vuln_item/${it0.id}/transition`, { to: "false_positive", data: { close_notes: "به نظرم مثبت کاذب است" }, version: it0.version }));
    expect((await stored("sec_vuln_item", it0.id)).state).toBe("open");
    // the approved «false positive» exception moves it
    const exp = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    let exc = (await w.p.vm.client.post(`${w.P}/r/sec_vuln_exception`, { title: "مثبت کاذب", kind: "false_positive", items: [it0.id], justification: "نسخهٔ وصله‌شده", expires_at: exp })).row;
    exc = (await w.p.vm.client.post(`${w.P}/r/sec_vuln_exception/${exc.id}/transition`, { to: "requested", version: exc.version })).row;
    await w.drain();
    const ap = ((await w.p.ciso.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === exc.id);
    await w.p.ciso.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved" });
    expect((await stored("sec_vuln_item", it0.id)).state).toBe("false_positive");
    // an item marked false positive without an exception (an older copy) returns when the scan sees it again
    const other = items.find((i) => i.id !== it0.id && i.state === "open")!;
    await w.e.db.query(`update ${tableDef("sec_vuln_item")!.table} set state = 'false_positive', exception_id = null where id = $1`, [other.id]);
    const res = await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "پویش ۲", content: NESSUS_CSV, format: "csv" });
    expect(res.reopened).toBeGreaterThanOrEqual(1);
    expect((await stored("sec_vuln_item", other.id)).state).toBe("open");
    expect((await stored("sec_vuln_item", it0.id)).state).toBe("false_positive");
  });
});

describe("evidence under legal hold", () => {
  it("counts the stored hold, lifts it only as a step of its own, and refuses a pushed deletion", async () => {
    const sir = await w.sir();
    let ev = (await w.p.soc.client.post(`${w.P}/r/sec_evidence`, { title: "دیسک سرور", kind: "disk_image", sec_incident_id: sir.id, legal_hold: true, location: "گاوصندوق ۱" })).row;
    ev = (await w.p.soc.client.post(`${w.P}/r/sec_evidence/${ev.id}/transition`, { to: "stored", version: ev.version })).row;
    expect([403, 409]).toContain(await statusOf(w.p.soc.client, "POST", `${w.P}/r/sec_evidence/${ev.id}/transition`, { to: "destroyed", data: { notes: "امحا", legal_hold: false }, version: ev.version }));
    expect((await stored("sec_evidence", ev.id)).state).toBe("stored");
    // a Windows push: deleting held evidence is refused (as on the web)
    let p = await rowOf("sec_evidence", ev.id, { deleted_at: new Date().toISOString() });
    expect((await push(w.p.ciso.client, [{ entity: "sec_evidence", id: ev.id, base_rev: p.rev, row: p.row }]))[0].status).not.toBe("ok");
    expect((await stored("sec_evidence", ev.id)).deleted_at).toBeNull();
    // … and its custody log is the cloud's: a transfer is logged whatever log the push carries
    const before = ((await stored("sec_evidence", ev.id)).custody_log as any[]).length;
    p = await rowOf("sec_evidence", ev.id, { custody_log: [], custodian_id: w.p.soc2.userId });
    expect((await push(w.p.soc.client, [{ entity: "sec_evidence", id: ev.id, base_rev: p.rev, row: p.row }]))[0].status).toBe("ok");
    const log = (await stored("sec_evidence", ev.id)).custody_log as any[];
    expect(log.length).toBe(before + 1);
    expect(log.at(-1)).toMatchObject({ action: "transfer", to: w.p.soc2.userId, by: w.p.soc.userId });
    // lifting the hold, then destroying, are two steps
    ev = (await w.p.soc.client.get(`${w.P}/r/sec_evidence/${ev.id}`)).row;
    ev = (await w.p.soc.client.patch(`${w.P}/r/sec_evidence/${ev.id}`, { legal_hold: false, version: ev.version })).row;
    expect(ev.custody_log.at(-1).action).toBe("hold_lifted");
    ev = (await w.p.soc.client.post(`${w.P}/r/sec_evidence/${ev.id}/transition`, { to: "destroyed", data: { notes: "امحا پس از رفع توقیف" }, version: ev.version })).row;
    expect(ev.state).toBe("destroyed");
  });
});

describe("risk acceptance", () => {
  it("is its current owner's: no self-named acceptor, no acceptance of a risk one does not read, no acceptance on the owner's behalf", async () => {
    let r = (await w.p.grc.client.post(`${w.P}/r/grc_risk`, { title: "نشت دادهٔ پشتیبان", category: "privacy", owner_id: w.p.grc.userId, inherent_likelihood: "3", inherent_impact: "4" })).row;
    r = (await w.p.grc.client.post(`${w.P}/r/grc_risk/${r.id}/transition`, { to: "assessed", version: r.version })).row;
    const exp = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    // the risk owner role reads only its own risks: this one does not exist for them
    expect(await statusOf(w.p.ro.client, "POST", `${w.P}/r/grc_risk_acceptance`, { risk_id: r.id, expires_at: exp, conditions: "—", accepted_by: w.p.ro.userId })).toBe(400);
    // a risk manager reads it but does not name themselves the acceptor…
    expect(await statusOf(w.p.ciso.client, "POST", `${w.P}/r/grc_risk_acceptance`, { risk_id: r.id, expires_at: exp, conditions: "—", accepted_by: w.p.ciso.userId })).toBe(400);
    // … nor accept it for the owner
    const acc = (await w.p.ciso.client.post(`${w.P}/r/grc_risk_acceptance`, { risk_id: r.id, expires_at: exp, conditions: "پشتیبان رمزنگاری‌شده" })).row;
    expect(acc.accepted_by).toBe(w.p.grc.userId);
    expect([403, 409]).toContain(await statusOf(w.p.ciso.client, "POST", `${w.P}/r/grc_risk_acceptance/${acc.id}/transition`, { to: "active", version: acc.version }));
    expect((await stored("grc_risk", r.id)).state).toBe("assessed");
  });
});

describe("personal data and regulatory clocks", () => {
  it("redaction scrubs the record's history; a masked e-mail shows nothing of the address", async () => {
    const sir = await w.sir({ description: "کد ملی 0499370899 و رایانامهٔ ali.rezaei@example.com" });
    const scan = (await w.p.soc.client.get(`${w.P}/security/pii/sec_incident/${sir.id}`)).fields as any[];
    const masked = scan.flatMap((f) => f.findings.map((x: any) => x.masked)).join(" ");
    expect(masked).not.toContain("ali.rezaei");
    expect(masked).not.toContain("example.com");
    const red = await w.p.soc.client.post(`${w.P}/security/pii/sec_incident/${sir.id}/redact`, { fields: ["description"] });
    expect(red.redacted).toBe(2);
    const hist = JSON.stringify(await w.p.soc.client.get(`${w.P}/r/sec_incident/${sir.id}/history`));
    expect(hist).not.toContain("0499370899");
    expect(hist).not.toContain("ali.rezaei@example.com");
    expect(mask("abcdef", 0)).toBe("******");
    expect(detectPii("x ali@example.com")[0].masked).not.toContain("ali");
  });

  it("an incident whose regulatory clock runs is not canceled", async () => {
    let r = await w.sir({ category: "data_breach", personal_data_breach: true, affected_data: "فهرست مشتریان", records_affected: 300 });
    r = (await w.p.soc.client.post(`${w.P}/r/sec_incident/${r.id}/transition`, { to: "analysis", version: r.version })).row;
    const regimes = (await w.p.soc.client.get(`${w.P}/security/incidents/${r.id}/regimes`)).regimes as any[];
    await w.p.soc.client.post(`${w.P}/security/incidents/${r.id}/clocks`, { regime_id: regimes[0].id });
    r = (await w.p.soc.client.get(`${w.P}/r/sec_incident/${r.id}`)).row;
    await w.p.soc.client.post(`${w.P}/r/sec_incident/${r.id}/transition`, { to: "canceled", data: { close_code: "false_positive", close_notes: "لغو" }, version: r.version }, 409);
    expect((await stored("sec_incident", r.id)).state).toBe("analysis");
  });
});

describe("scan imports and phishing reports", () => {
  it("match every host of an import to its CI, past 500 addresses", async () => {
    const n = 520;
    await w.sys.write(async (tx) => {
      for (let i = 0; i < n; i++) await createIn(tx, w.sys, "ci", { name: `host-${i}`, class: "server", ip_address: `10.9.${Math.floor(i / 250)}.${(i % 250) + 1}`, state: "operational" }, { trusted: true });
    });
    const hosts = Array.from({ length: n }, (_, i) => ({ host: `10.9.${Math.floor(i / 250)}.${(i % 250) + 1}`, ip: `10.9.${Math.floor(i / 250)}.${(i % 250) + 1}`, hostname: null, fqdn: null }));
    const matched = await matchHosts(w.e.db, w.sys, hosts);
    expect([...matched.values()].filter(Boolean).length).toBe(n);
  });

  it("group reports on the sender's address or a link, never on a shared domain; a joined report gets no other reporter's number", async () => {
    const a = await w.p.req.client.post(`${w.P}/security/phishing`, { subject: "Invoice overdue", sender: "john.smith1970@gmail.com", body: "https://pay-invoice.example/x1" });
    const b = await w.p.soc2.client.post(`${w.P}/security/phishing`, { subject: "Your parcel is waiting", sender: "dhl.parcels.tracking@gmail.com", body: "https://parcel-track.example/y2" });
    expect(b.grouped).toBe(false);
    expect(b.receipt).toMatch(/^SIR/);
    expect(b.receipt).not.toBe(a.receipt);
    // the same sender again joins the first report, and its reporter gets no number of someone else's
    const c = await w.p.ro.client.post(`${w.P}/security/phishing`, { subject: "Invoice overdue (2)", sender: "John.Smith1970@gmail.com", body: "pay now" });
    expect(c.grouped).toBe(true);
    expect(c.receipt).toBeNull();
  });
});
