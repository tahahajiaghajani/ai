// Vulnerability response: scanner imports (Nessus CSV, Qualys XML, OpenVAS XML and JSON) matched to CIs, one item per
// (asset, vulnerability), risk scores and remediation targets from first detection (KEV earlier), a reappearing finding
// that continues its clock, verification by rescan, exceptions with approval and expiry, remediation groups and the
// change they open, rescoring when the library changes, coverage, and who sees the items (the CI's support group).
import { describe, expect, it, beforeAll } from "vitest";
import { secWorld, backdate, type SecWorld } from "./security-helpers";
import { securitySweep } from "@server/modules/security";

let w: SecWorld;
let web: Record<string, any>;
let db: Record<string, any>;

const NESSUS_CSV = `Plugin ID,CVE,CVSS v3.0 Base Score,Risk,Host,Protocol,Port,Name,Synopsis,Description,Solution,See Also,Plugin Output
97833,CVE-2017-0144,8.1,High,10.0.0.10,tcp,445,MS17-010: Security Update for Microsoft Windows SMB Server,Remote code execution,desc,Apply MS17-010,,SMBv1 enabled
97833,CVE-2017-0145,8.1,High,10.0.0.10,tcp,445,MS17-010: Security Update for Microsoft Windows SMB Server,Remote code execution,desc,Apply MS17-010,,SMBv1 enabled
11219,,,None,10.0.0.10,tcp,80,Nessus SYN scanner,open port,,,,
42873,CVE-2016-2183,7.5,High,db01.example.local,tcp,1433,SSL Medium Strength Cipher Suites Supported (SWEET32),weak ciphers,desc,Reconfigure,,3DES
`;

const OPENVAS_XML = `<?xml version="1.0"?>
<report id="r1"><report id="r1"><results>
  <result id="a"><name>OpenSSH Information Disclosure</name><host>10.0.0.10<hostname>web01</hostname></host><port>22/tcp</port>
    <nvt oid="1.3.6.1.4.1.25623.1.0.1"><name>OpenSSH Information Disclosure</name><cvss_base>5.3</cvss_base>
      <tags>cvss_base_vector=AV:N/AC:L|summary=Leaks info|solution=Update OpenSSH</tags>
      <refs><ref type="cve" id="CVE-2023-38408"/><ref type="url" id="https://example.org"/></refs></nvt>
    <threat>Medium</threat><severity>5.3</severity><description>Installed version 8.2</description></result>
  <result id="b"><name>Host Details</name><host>10.0.0.10</host><port>general/tcp</port><nvt oid="1.3.6.1.4.1.25623.1.0.2"><name>Host Details</name><cvss_base>0.0</cvss_base></nvt><threat>Log</threat><severity>0.0</severity></result>
</results></report></report>`;

const QUALYS_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<SCAN value="scan/1"><IP value="10.0.0.20" name="db01.example.local"><VULNS><CAT value="TCP" port="1433" protocol="tcp">
  <VULN number="38173" severity="3"><TITLE><![CDATA[SSL Certificate - Signature Verification Failed]]></TITLE><CVE_ID_LIST><CVE_ID><ID>CVE-2016-2183</ID></CVE_ID></CVE_ID_LIST><SOLUTION>Replace the certificate</SOLUTION><RESULT>cert</RESULT></VULN>
</CAT></VULNS><INFOS><CAT><INFO number="1"/></CAT></INFOS></IP></SCAN>`;

beforeAll(async () => {
  w = await secWorld();
  web = (await w.o.post(`${w.P}/r/ci`, { name: "web01", class: "server", hostname: "web01", ip_address: "10.0.0.10", criticality: "1", support_group_id: w.g.infra, state: "operational" })).row;
  db = (await w.o.post(`${w.P}/r/ci`, { name: "db01", class: "server", fqdn: "db01.example.local", ip_address: "10.0.0.20", criticality: "3", state: "operational" })).row;
});

const items = async (as = w.p.vm.client, filter?: unknown) => (await as.get(`${w.P}/r/sec_vuln_item?size=100${filter ? `&filter=${encodeURIComponent(JSON.stringify(filter))}` : ""}`)).rows as any[];

describe("scanner imports", () => {
  it("previews without writing, then imports a Nessus CSV: one item per asset and CVE, matched to CIs, informational rows skipped", async () => {
    const pre = await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "nessus.csv", content: NESSUS_CSV, dry_run: true });
    expect(pre.dry_run).toBe(true);
    expect(pre.scanner).toBe("nessus");
    expect(pre.items).toBe(3);
    expect((await items()).length).toBe(0);
    const r = await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "nessus.csv", content: NESSUS_CSV });
    expect(r.created).toBe(3);
    expect(r.skipped).toBe(1);
    expect(r.matched_hosts).toBe(2);
    const all = await items();
    const smb = all.filter((i) => i.ci_id === web.id);
    expect(smb.length).toBe(2);
    expect(smb[0].assignment_group_id).toBe(w.g.infra);
    // CVSS 8.1 on a vital server (criticality 1) is critical; the same on db01 (criticality 3) would be high
    expect(smb[0].risk_rating).toBe("critical");
    expect(all.find((i) => i.ci_id === db.id)!.risk_rating).toBe("high");
    const vulns = (await w.p.vm.client.get(`${w.P}/r/sec_vulnerability?size=50`)).rows as any[];
    expect(vulns.map((v) => v.cve_id).sort()).toEqual(["CVE-2016-2183", "CVE-2017-0144", "CVE-2017-0145"]);
  });

  it("sets the remediation target from first detection by rating, with an earlier KEV due date winning", async () => {
    const vuln = (await w.p.vm.client.get(`${w.P}/r/sec_vulnerability?q=CVE-2017-0144`)).rows[0];
    const kevDue = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await w.p.vm.client.patch(`${w.P}/r/sec_vulnerability/${vuln.id}`, { kev: true, kev_due: kevDue, epss: "0.97", version: vuln.version });
    await w.drain();
    const it = (await items(w.p.vm.client, { f: "vulnerability_id", op: "eq", v: vuln.id }))[0];
    expect(it.kev).toBe(true);
    expect(it.risk_rating).toBe("critical");
    expect(it.due_at.slice(0, 10)).toBe(kevDue);
  });

  it("matches OpenVAS XML and Qualys XML by host name, FQDN and IP; the same CVE on the same CI stays one item", async () => {
    const ov = await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "openvas.xml", content: OPENVAS_XML });
    expect(ov.scanner).toBe("openvas");
    expect(ov.created).toBe(1);
    expect(ov.skipped).toBe(1);
    const q = await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "qualys.xml", content: QUALYS_XML });
    expect(q.scanner).toBe("qualys");
    expect(q.created).toBe(0);
    expect(q.updated).toBe(1);
    const sweet = (await items()).filter((i) => i.ci_id === db.id);
    expect(sweet.length).toBe(1);
    expect(sweet[0].times_seen).toBe(2);
  });

  it("verifies fixes by rescan: what a covering scan of the same scanner no longer sees is fixed, then closed; a reappearance reopens it with its first detection", async () => {
    const only0145 = NESSUS_CSV.split("\n").filter((l) => !l.includes("CVE-2017-0144")).join("\n");
    const r1 = await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "nessus-2.csv", content: only0145 });
    expect(r1.closed).toBe(1);
    let it = (await items()).find((i) => i.title.startsWith("MS17-010") && i.state === "fixed");
    expect(it).toBeTruthy();
    const first = it.first_detected_at;
    const r2 = await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "nessus-3.csv", content: only0145 });
    expect(r2.closed).toBe(1);
    it = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_item/${it.id}`)).row;
    expect(it.state).toBe("closed");
    expect(it.verified_at).toBeTruthy();
    const r3 = await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "nessus-4.csv", content: NESSUS_CSV });
    expect(r3.reopened).toBe(1);
    it = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_item/${it.id}`)).row;
    expect(it.state).toBe("open");
    expect(it.reopen_count).toBe(1);
    expect(it.first_detected_at).toBe(first);
  });

  it("refuses an import from someone without the right to create items, and unknown layouts", async () => {
    await w.p.agent.client.post(`${w.P}/security/scans/import`, { name: "x.csv", content: NESSUS_CSV }, 403);
    await w.p.vm.client.post(`${w.P}/security/scans/import`, { name: "x.csv", content: "a,b,c\n1,2,3\n" }, 400);
  });
});

describe("exceptions, remediation and coverage", () => {
  it("defers items only through an approved exception; expiry returns them to the queue", async () => {
    const it = (await items()).find((i) => i.ci_id === db.id)!;
    await w.p.vm.client.post(`${w.P}/r/sec_vuln_item/${it.id}/transition`, { to: "deferred", version: it.version }, 409);
    const exp = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    let exc = (await w.p.soc.client.post(`${w.P}/r/sec_vuln_exception`, { title: "تعویق تا پنجرهٔ نگهداری", kind: "not_affected", items: [it.id], justification: "سرویس رمزنگاری قدیمی خاموش است", expires_at: exp })).row;
    // «not affected» needs a VEX justification
    await w.p.soc.client.post(`${w.P}/r/sec_vuln_exception/${exc.id}/transition`, { to: "requested", version: exc.version }, 409);
    exc = (await w.p.soc.client.patch(`${w.P}/r/sec_vuln_exception/${exc.id}`, { vex_justification: "vulnerable_code_not_in_execute_path", version: exc.version })).row;
    exc = (await w.p.soc.client.post(`${w.P}/r/sec_vuln_exception/${exc.id}/transition`, { to: "requested", version: exc.version })).row;
    await w.drain();
    const ap = ((await w.p.vm.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === exc.id);
    expect(ap).toBeTruthy();
    await w.p.vm.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved" });
    exc = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_exception/${exc.id}`)).row;
    expect(exc.state).toBe("approved");
    let item = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_item/${it.id}`)).row;
    expect(item.state).toBe("exception");
    expect(item.vex_status).toBe("not_affected");
    // expiry (the sweep) reopens the item
    await w.e.db.query(`update sm_sec_vuln_exceptions set expires_at = current_date - 1 where id = $1`, [exc.id]);
    await securitySweep(w.sys);
    exc = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_exception/${exc.id}`)).row;
    expect(exc.state).toBe("expired");
    item = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_item/${it.id}`)).row;
    expect(item.state).toBe("open");
    expect(item.exception_id).toBeNull();
  });

  it("groups open items by solution and opens a change for a group", async () => {
    const r = await w.p.vm.client.post(`${w.P}/security/remediations/group`, { basis: "solution" });
    expect(r.groups).toBeGreaterThan(0);
    const groups = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_remediation?size=20`)).rows as any[];
    const smb = groups.find((g) => g.open_count >= 1 && g.assignment_group_id === w.g.infra)!;
    expect(smb.due_at).toBeTruthy();
    const chg = await w.p.vm.client.post(`${w.P}/security/remediations/${smb.id}/change`, {});
    expect(chg.number).toMatch(/^CHG/);
    const rem = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_remediation/${smb.id}`)).row;
    expect(rem.change_id).toBe(chg.change_id);
    expect(rem.state).toBe("in_progress");
  });

  it("shows items to the CI's support group through the remediator role, not to others", async () => {
    const it = (await items()).find((i) => i.assignment_group_id === w.g.infra)!;
    await w.p.agent.client.get(`${w.P}/r/sec_vuln_item?size=5`, 403);
    await w.o.post(`${w.P}/access/groups/${w.g.infra}/members`, { user_ids: [w.p.agent.userId] });
    const prof = await w.o.get(`${w.P}/access/members/${w.p.agent.userId}`);
    await w.o.put(`${w.P}/access/members/${w.p.agent.userId}`, { roles: ["agent", "vuln_remediator"], version: prof.profile?.version });
    const mine = (await w.p.agent.client.get(`${w.P}/r/sec_vuln_item?size=100`)).rows as any[];
    expect(mine.some((x) => x.id === it.id)).toBe(true);
    expect(mine.every((x) => x.assignment_group_id === w.g.infra)).toBe(true);
    // the remediator still sees no security incident
    await w.p.agent.client.get(`${w.P}/r/sec_incident?size=5`).then((r) => expect(r.rows.length).toBe(0));
  });

  it("reports scan coverage of in-scope CIs and an overdue flag from the sweep", async () => {
    const cov = await w.p.vm.client.get(`${w.P}/security/coverage`);
    expect(cov.in_scope).toBeGreaterThanOrEqual(2);
    expect(cov.scanned_30).toBeGreaterThanOrEqual(2);
    const it = (await items()).find((i) => i.state === "open")!;
    await backdate(w.e, "sm_sec_vuln_items", it.id, "due_at", 2);
    await securitySweep(w.sys);
    const after = (await w.p.vm.client.get(`${w.P}/r/sec_vuln_item/${it.id}`)).row;
    expect(after.overdue).toBe(true);
  });
});
