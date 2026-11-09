// Pure logic of the security module: the incident's risk score and phase stamps, observables (refang, types,
// normalisation, extraction), vulnerability risk and remediation targets (KEV, SSVC), regulatory deadlines, the risk
// matrix (scores, ratings, residual, appetite, ALE, heat map), requirement and framework compliance, CSF gaps,
// indicators and KRIs, change security flags, Persian PII detectors with their checksums, and the scanner parsers.
import { describe, expect, it } from "vitest";
import {
  aboveAppetite, aiAllowed, annualLoss, csfGap, cvssSeverity, cvesIn, detectObservableType, extractObservables, frameworkCompliance, heatMap, indicatorStatus, kriStatus,
  nextDeadline, nextTestDue, normalizeObservable, phaseStamps, refang, regDeadlines, requirementStatus, riskRating, riskScore, securityFlags, sirPriority, sirRiskScore, ssvc,
  suggestedResidual, vulnDueAt, vulnRisk,
} from "@shared/security/logic";
import { detectPii, redact, validIban, validLuhn, validNationalId, validPostalCode } from "@shared/security/pii";
import { detectFormat, detectScanner, parseScan, parseXml, vulnKeys } from "@shared/security/scan";
import { ANNEX_A, CONTROLS, CSF_CATEGORIES, ISO20000, MATRIX_5X5, PLAYBOOKS, REGIMES } from "@shared/security/frameworks";

describe("security incidents", () => {
  it("scores risk by the weighted calculator and maps it to a priority", () => {
    expect(sirRiskScore({ severity: "1", business_impact: "1", classification: "restricted", personal_data_breach: true })).toBe(100);
    expect(sirRiskScore({ severity: "4", business_impact: "4", classification: "public" })).toBe(20);
    expect(sirRiskScore({ severity: "1", business_impact: "4" }, { severity: 100, impact: 0, data: 0, personal: 0 })).toBe(100);
    expect([sirPriority(85), sirPriority(60), sirPriority(41), sirPriority(20), sirPriority(5)]).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("stamps every phase a move passes, never twice, never going back", () => {
    const now = "2026-01-01T00:00:00.000Z";
    expect(phaseStamps("analysis", "recover", {}, now)).toEqual({ contained_at: now, eradicated_at: now });
    expect(phaseStamps("contain", "review", { contained_at: "x" }, now)).toEqual({ eradicated_at: now, recovered_at: now });
    expect(phaseStamps("recover", "analysis", {}, now)).toEqual({});
  });

  it("refangs, types, normalises and extracts indicators", () => {
    expect(refang("hxxp://evil[.]com")).toBe("http://evil.com");
    expect(detectObservableType("10.1.2.3")).toBe("ipv4");
    expect(detectObservableType("d41d8cd98f00b204e9800998ecf8427e")).toBe("md5");
    expect(detectObservableType("invoice.exe")).toBe("filename");
    expect(detectObservableType("Evil.COM")).toBe("domain");
    expect(normalizeObservable("url", "HTTP://Evil.com/a#frag")).toBe("http://evil.com/a");
    const found = extractObservables("از a@b.example آمد؛ پیوند hxxp://x[.]example/p و 198.51.100.4 و هش 5d41402abc4b2a76b9719d911017c592");
    expect(found.map((f) => f.type).sort()).toEqual(["email", "ipv4", "md5", "url"]);
  });
});

describe("vulnerability risk", () => {
  it("scores CVSS × EPSS × KEV × criticality × exposure × compensating, a KEV finding at least high", () => {
    expect(cvssSeverity(9.8)).toBe("critical");
    expect(cvssSeverity(0)).toBe("none");
    const base = vulnRisk({ cvss: 7.5, epss: null, kev: false, criticality: "3", exposure: "internal", compensating: "none" });
    expect(base.rating).toBe("high");
    const kev = vulnRisk({ cvss: 3.1, epss: 0.9, kev: true, criticality: "4", exposure: "isolated", compensating: "strong" });
    expect(kev.rating).toBe("high");
    const vital = vulnRisk({ cvss: 9.8, epss: 0.95, kev: true, criticality: "1", exposure: "internet", compensating: "none" });
    expect(vital.score).toBe(100);
    expect(vital.factors.map((f) => f.key)).toEqual(["cvss", "epss", "kev", "criticality", "exposure", "compensating"]);
    const shielded = vulnRisk({ cvss: 7.5, epss: null, kev: false, criticality: "3", exposure: "internal", compensating: "strong" });
    expect(shielded.score).toBeLessThan(base.score);
  });

  it("sets the remediation target from first detection, a KEV due date earlier wins", () => {
    expect(vulnDueAt("2026-01-01T00:00:00.000Z", "high", { high: 30 })).toBe("2026-01-31T00:00:00.000Z");
    expect(vulnDueAt("2026-01-01T00:00:00.000Z", "low", {}, "2026-01-05").slice(0, 10)).toBe("2026-01-05");
    expect(ssvc({ kev: true, exposure: "internet", criticality: "3" })).toBe("act");
    expect(ssvc({ kev: false, exploit: "poc", exposure: "internal", criticality: "4" })).toBe("track_star");
    expect(cvesIn("cve-2024-3400 و CVE-2023-4966, CVE-2024-3400")).toEqual(["CVE-2024-3400", "CVE-2023-4966"]);
  });
});

describe("deadlines, risk and compliance", () => {
  it("computes regulatory deadlines in calendar hours and the next open stage", () => {
    const d = regDeadlines("2026-03-01T10:00:00.000Z", REGIMES.find((r) => r.key === "nis2")!.stages);
    expect(d.map((x) => x.due_at)).toEqual(["2026-03-02T10:00:00.000Z", "2026-03-04T10:00:00.000Z", "2026-03-31T10:00:00.000Z"]);
    d[0].submitted_at = "2026-03-01T20:00:00.000Z";
    const n = nextDeadline(d, Date.parse("2026-03-05T00:00:00.000Z"));
    expect(n.next?.stage).toBe("notification");
    expect(n.overdue).toBe(true);
    // a recomputation keeps submissions by stage
    expect(regDeadlines("2026-03-01T11:00:00.000Z", REGIMES.find((r) => r.key === "nis2")!.stages, d)[0].submitted_at).toBe(d[0].submitted_at);
  });

  it("rates the 5 × 5 matrix, suggests residual risk, checks appetite and computes ALE exactly", () => {
    expect(riskScore("4", "5")).toBe(20);
    expect(riskScore(null, "5")).toBeNull();
    expect(riskRating(MATRIX_5X5, 1, 4)).toBe("low");
    expect(riskRating(MATRIX_5X5, 3, 3)).toBe("medium");
    expect(riskRating(MATRIX_5X5, 3, 4)).toBe("high");
    expect(riskRating(MATRIX_5X5, 5, 5)).toBe("critical");
    expect(suggestedResidual(4, 5, "strong")).toEqual({ likelihood: 2, impact: 4 });
    expect(aboveAppetite(10, 9)).toBe(true);
    expect(aboveAppetite(10, null, "high")).toBe(true);
    expect(annualLoss("1200000.50", "0.3")).toBe("360000.15");
    const hm = heatMap([{ likelihood: "2", impact: "3" }, { likelihood: 2, impact: 3 }, { likelihood: 9, impact: 1 }]);
    expect(hm[1][2]).toBe(2);
  });

  it("derives requirement status from controls and framework compliance from requirements", () => {
    expect(requirementStatus(false, [])).toEqual({ implementation: "not_applicable", compliance: "not_applicable" });
    expect(requirementStatus(true, [])).toEqual({ implementation: "not_implemented", compliance: "not_assessed" });
    expect(requirementStatus(true, [{ implementation_status: "implemented", effectiveness: "effective" }]).compliance).toBe("compliant");
    expect(requirementStatus(true, [{ implementation_status: "implemented", indicator_status: "pass" }]).compliance).toBe("compliant");
    expect(requirementStatus(true, [{ implementation_status: "implemented", effectiveness: "effective" }, { implementation_status: "implemented", effectiveness: "ineffective" }]).compliance).toBe("partial");
    expect(requirementStatus(true, [{ implementation_status: "planned" }]).implementation).toBe("partial");
    const c = frameworkCompliance([{ compliance: "compliant", implementation: "implemented" }, { compliance: "partial" }, { applicable: false, compliance: "not_applicable" }]);
    expect(c).toMatchObject({ applicable: 2, compliant: 1, percent: 50 });
    expect(nextTestDue("2026-01-01T00:00:00.000Z", "quarterly", 0)).toBe("2026-04-02");
    expect(csfGap({ "GV.OC": { current: 1, target: 3 }, "PR.AA": { current: 4, target: 3 } })).toMatchObject({ total: 2, scored: 2 });
  });

  it("evaluates indicators, KRIs, change flags and the AI ceiling", () => {
    expect(indicatorStatus(92, 90, "higher_better")).toBe("pass");
    expect(indicatorStatus(1, 0, "lower_better")).toBe("fail");
    expect(indicatorStatus(null, 0, "lower_better")).toBe("unknown");
    expect(kriStatus(12, 10, 15)).toBe("warn");
    expect(kriStatus(3, 5, 2, "lower_worse")).toBe("warn");
    expect(securityFlags("باز کردن درگاه روی فایروال و تغییر گذرواژهٔ مدیر").map((f) => f.key)).toEqual(["secrets", "identity"]);
    expect(aiAllowed("restricted", "confidential")).toBe(false);
    expect(aiAllowed("confidential", "internal")).toBe(false);
    expect(aiAllowed("internal", "confidential")).toBe(true);
  });
});

describe("personal data detectors", () => {
  it("validates Iranian national IDs, IBANs, cards and postal codes", () => {
    expect(validNationalId("0084575948")).toBe(true);
    expect(validNationalId("0084575949")).toBe(false);
    expect(validNationalId("1111111111")).toBe(false);
    expect(validIban("IR062960000000100324200001")).toBe(true);
    expect(validIban("IR062960000000100324200002")).toBe(false);
    expect(validLuhn("6037997599405678")).toBe(true);
    expect(validLuhn("6037997599405679")).toBe(false);
    expect(validPostalCode("1193653471")).toBe(true);
    expect(validPostalCode("0193653471")).toBe(false);
  });

  it("finds Persian-digit data, masks it and redacts in place", () => {
    const text = "کد ملی ۰۰۸۴۵۷۵۹۴۸، همراه ۰۹۱۲-۳۴۵-۶۷۸۹، شبا IR06 2960 0000 0010 0324 2000 01 و نامه a.b@example.com";
    const f = detectPii(text);
    expect(f.map((x) => x.kind)).toEqual(["national_id", "mobile", "iban", "email"]);
    expect(f[0].masked).toBe("******5948");
    const out = redact(text, f);
    expect(out).not.toMatch(/۰۰۸۴۵۷۵۹۴۸/);
    expect(out).toContain("[کد ملی حذف شد]");
    expect(detectPii("شمارهٔ سفارش 1234567890")).toEqual([]);
  });
});

describe("scanner parsers", () => {
  it("reads XML with CDATA, entities and namespaces", () => {
    const doc = parseXml(`<?xml version="1.0"?><a:root xmlns:a="x"><b k="1 &amp; 2"><![CDATA[<raw>]]>t&lt;x</b><c/></a:root>`);
    const root = doc.children[0];
    expect(root.children[0].attrs.k).toBe("1 & 2");
    expect(root.children[0].text).toBe("<raw>t<x");
  });

  it("detects formats and scanners, and keys findings without a CVE by the scanner's check", () => {
    expect(detectFormat("  <NessusClientData_v2>")).toBe("xml");
    expect(detectScanner("<NessusClientData_v2>", "xml")).toBe("nessus");
    expect(detectScanner("IP,Hostname,Port,Port Protocol,CVSS,Severity,NVT Name,NVT OID", "csv")).toBe("openvas");
    const nessus = parseScan(`<NessusClientData_v2><Report><ReportHost name="10.0.0.5"><HostProperties><tag name="host-ip">10.0.0.5</tag><tag name="host-fqdn">app.local</tag></HostProperties>
      <ReportItem port="443" protocol="tcp" severity="2" pluginID="51192" pluginName="SSL Certificate Cannot Be Trusted"><solution>Buy a cert</solution><cvss3_base_score>6.5</cvss3_base_score></ReportItem>
      <ReportItem port="0" protocol="tcp" severity="0" pluginID="19506" pluginName="Nessus Scan Information"></ReportItem></ReportHost></Report></NessusClientData_v2>`);
    expect(nessus.findings.length).toBe(1);
    expect(nessus.skipped).toBe(1);
    expect(nessus.findings[0]).toMatchObject({ ip: "10.0.0.5", fqdn: "app.local", port: 443, cvss: 6.5, plugin: "51192" });
    expect(vulnKeys(nessus.findings[0], "nessus")).toEqual(["NESSUS-51192"]);
    const json = parseScan(JSON.stringify({ findings: [{ asset: { ipv4: "10.0.0.9", hostname: "h9" }, plugin: { id: 1, name: "X", cve: ["CVE-2024-1000"], cvss3_base_score: 9.1 }, port: { port: 22, protocol: "tcp" }, severity: "critical" }] }));
    expect(json.findings[0]).toMatchObject({ ip: "10.0.0.9", hostname: "h9", port: 22, cves: ["CVE-2024-1000"] });
    expect(parseScan("not,a,known,layout\n1,2,3,4").errors.length).toBe(1);
  });
});

describe("seeded content", () => {
  it("has the 93 Annex A controls (37/8/14/34), 22 CSF categories, the 20000-1 clauses, three playbooks and mapped controls", () => {
    const by = (t: string) => ANNEX_A.filter((a) => a.theme === t).length;
    expect([by("سازمانی"), by("افراد"), by("فیزیکی"), by("فناورانه")]).toEqual([37, 8, 14, 34]);
    expect(CSF_CATEGORIES.length).toBe(22);
    expect(ISO20000.some((r) => r.code === "8.7.3")).toBe(true);
    expect(PLAYBOOKS.map((p) => p.category)).toEqual(["phishing", "malware", "data_breach"]);
    for (const c of CONTROLS) for (const [fw, codes] of Object.entries(c.maps)) {
      const pool = fw === "iso27001_2022" ? ANNEX_A : fw === "iso20000_2018" ? ISO20000 : [];
      if (pool.length) for (const code of codes) expect(pool.some((r) => r.code === code)).toBe(true);
    }
  });
});
