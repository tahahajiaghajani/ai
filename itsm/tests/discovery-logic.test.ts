// Pure logic of the discovery module (design A §6.2, §6.3, §7.1, §7.4, §10.4): normalisation of reported records, the
// item hash (stable, volatile fields out, config and kind versions in), the field allow-list for built-in mappings,
// overrides and pushed records, the mass-drop guard and contact, and the budget arithmetic of a pull.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { normaliseIp, normaliseMac, normaliseRecord, normaliseSerial, normaliseTime, normaliseUuid, OWNED_FIELD_DROPPED, OWNED_FIELD_WARNING } from "@shared/discovery/normalise";
import { canonical, hashMaterial, softwareMaterial } from "@shared/discovery/hash";
import { ALLOWED_CI_FIELDS, applyRenames, checkMapping, ciValues, isAllowedTarget, recordFromElement, REFUSED_FIELD_MESSAGE } from "@shared/discovery/mapping";
import { hasContact, massDrop } from "@shared/discovery/stale";
import { KIND_DESCRIPTORS, KIND_OPTIONS, kindDescriptor, offeredKinds } from "@shared/discovery/kinds";
import type { DiscoveredRecord } from "@shared/discovery/types";

const NOW = new Date("2026-11-11T10:00:00Z");
const norm = (raw: unknown) => normaliseRecord(raw, { now: NOW });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("normalisation (§6.2)", () => {
  it("normalises identifiers", () => {
    expect(normaliseMac("aa-bb-cc-dd-ee-0f")).toBe("AA:BB:CC:DD:EE:0F");
    expect(normaliseMac("AABB.CCDD.EEFF")).toBe("AA:BB:CC:DD:EE:FF");
    expect(normaliseMac("00:00:00:00:00:00")).toBeNull();
    expect(normaliseMac("not a mac")).toBeNull();
    expect(normaliseIp("10.1.2.3")).toBe("10.1.2.3");
    expect(normaliseIp("۱۰.۰.۰.۵")).toBe("10.0.0.5");
    for (const bad of ["127.0.0.1", "169.254.10.1", "0.0.0.0", "::1", "fe80::1", "256.1.1.1", "x"]) expect(normaliseIp(bad), bad).toBeNull();
    expect(normaliseIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(normaliseIp("::ffff:10.0.0.7")).toBe("10.0.0.7");
    for (const p of ["To be filled by O.E.M.", "Default string", "0", "System Serial Number", "N/A", "  ", "0000000"]) expect(normaliseSerial(p), p).toBeNull();
    expect(normaliseSerial("VMware-42 1a 2b 3c")).toBe("VMware-42 1a 2b 3c");
    expect(normaliseSerial("CZ۱۲۳۴۵")).toBe("CZ12345");
    expect(normaliseUuid("4c4c4544-0042-3510-8051-c3c04f4a4d32")).toBe("4C4C4544-0042-3510-8051-C3C04F4A4D32");
    expect(normaliseUuid("4c4c454400423510 8051c3c04f4a4d32".replace(" ", ""))).toBe("4C4C4544-0042-3510-8051-C3C04F4A4D32");
    expect(normaliseUuid("00000000-0000-0000-0000-000000000000")).toBeNull();
    expect(normaliseTime("2027-01-01T00:00:00Z", NOW)).toBe(NOW.toISOString());
    expect(normaliseTime(1762850000, NOW)).toBe(new Date(1762850000 * 1000).toISOString());
  });

  it("normalises a record: host names, FQDN, digits, numbers, status and the shape", () => {
    const { record, warnings } = norm({
      external_id: "۱۰۴۵۲", kind: "endpoint", name: "  PC-۱۲ ", hostname: "PC-12.Bank.Local.", ips: ["10.0.0.5", "127.0.0.1", "10.0.0.5"], macs: ["aa:bb:cc:dd:ee:ff", "00:00:00:00:00:00"],
      serial_number: "To be filled by O.E.M.", bios_uuid: "4c4c4544-0042-3510-8051-c3c04f4a4d32", ram_mb: "۸۱۹۲", cpu_count: "four",
      last_contact_at: "2026-11-10T09:00:00Z", status: { state: "down", availability: true }, attrs: { rack: "R1", password: "x", reported_user: "y" },
    });
    expect(record).toMatchObject({
      external_id: "10452", kind: "endpoint", name: "PC-۱۲", hostname: "pc-12", fqdn: "pc-12.bank.local", ips: ["10.0.0.5"], macs: ["AA:BB:CC:DD:EE:FF"],
      bios_uuid: "4C4C4544-0042-3510-8051-C3C04F4A4D32", ram_mb: 8192, last_contact_at: "2026-11-10T09:00:00.000Z",
      status: { state: "down", availability: true }, attrs: { rack: "R1" },
    });
    expect(record!.serial_number).toBeUndefined();
    expect(record!.cpu_count).toBeUndefined();
    expect(warnings.length).toBe(3);
    // the FQDN from the host name and the domain; the name falls back to the host name
    expect(norm({ external_id: "a", hostname: "srv1", domain: "bank.local" }).record).toMatchObject({ name: "srv1", fqdn: "srv1.bank.local", kind: "other" });
    // refused records
    expect(norm({ name: "x" }).error).toMatch(/external_id/);
    expect(norm({ external_id: "x".repeat(201) }).error).toMatch(/۲۰۰|200/);
    expect(norm("text").error).toBeTruthy();
  });

  it("keeps fields people and ITAM own out of a record: hints where a tool may hint, warnings always", () => {
    const { record, warnings } = norm({ external_id: "1", name: "a", asset_tag: "AT-1", owned_by: "someone", location_id: "x", foo: 1, reported: { site: "Tehran", secret: "x" } });
    expect(record!.reported).toEqual({ asset_tag: "AT-1", location: "x", site: "Tehran" });
    expect(warnings).toEqual(expect.arrayContaining([OWNED_FIELD_WARNING("asset_tag"), OWNED_FIELD_DROPPED("owned_by"), OWNED_FIELD_WARNING("location_id")]));
    expect(warnings.length).toBe(5);
    expect(JSON.stringify(record)).not.toContain("someone");
  });
});

describe("the item hash (§7.4)", () => {
  const base: DiscoveredRecord = { external_id: "h1", kind: "host", name: "esx-1", ips: ["10.0.0.1"], serial_number: "S1", attrs: { b: 2, a: 1 } };
  it("is stable, ignores volatile fields and software, and moves with the configuration and the kind version", () => {
    const h = (r: DiscoveredRecord, cv = 1, kv = 1) => sha(hashMaterial(r, cv, kv));
    expect(h(base)).toBe(h({ ...base, attrs: { a: 1, b: 2 } }));
    expect(h(base)).toBe(h({ ...base, status: { state: "down" }, last_contact_at: NOW.toISOString(), software: [{ name: "x" }] }));
    expect(h(base)).not.toBe(h({ ...base, serial_number: "S2" }));
    expect(h(base)).not.toBe(h({ ...base, ips: ["10.0.0.2"] }));
    expect(h(base, 1)).not.toBe(h(base, 2));
    expect(h(base, 1, 1)).not.toBe(h(base, 1, 2));
    expect(canonical({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe('{"a":[2,{"d":1}],"b":1}');
    expect(softwareMaterial([{ name: "B", version: "1" }, { name: "a" }])).toBe(softwareMaterial([{ name: "a" }, { name: "b", version: "1" }]));
  });
});

describe("the allow-list and mapping (§6.3)", () => {
  it("allows identity and technical fields and class attributes, never what people or ITAM own", () => {
    for (const f of ALLOWED_CI_FIELDS) expect(isAllowedTarget(f)).toBe(true);
    for (const f of ["owned_by", "managed_by", "used_by", "support_group_id", "location_id", "cost_center_id", "asset_tag", "install_status", "operational_status", "state", "environment", "criticality", "tags", "attrs.reported_user", "health_score", "attr_meta"]) {
      expect(isAllowedTarget(f), f).toBe(false);
    }
    expect(isAllowedTarget("attrs.rack")).toBe(true);
  });

  it("checks mapping overrides with the editor's message", () => {
    expect(checkMapping({ "attrs.rack": "$.rack.name", name: "$.title", ip_address: "$.ip" }, { rest: true })).toEqual([{ key: "external_id", message: expect.stringContaining("external_id") }]);
    expect(checkMapping({ external_id: "$.id", owned_by: "$.owner", "attrs.reported_site": "$.x", location_id: "$.loc", nope: "$.y" }, { rest: true })).toEqual([
      { key: "owned_by", message: REFUSED_FIELD_MESSAGE },
      { key: "attrs.reported_site", message: REFUSED_FIELD_MESSAGE },
      { key: "location_id", message: REFUSED_FIELD_MESSAGE },
      { key: "nope", message: expect.stringContaining("nope") },
    ]);
    expect(checkMapping({ "attrs.rack": "attrs.location" })).toEqual([]);
    expect(checkMapping([])).toHaveLength(1);
  });

  it("builds a REST record by JSON paths, applies a built-in kind's renames, and gives CI values only from the allow-list", () => {
    const el = { id: 7, display: "core-sw-1", primary_ip: { address: "10.9.0.1" }, serial: "FOC123", site: { name: "Tehran" }, owner: "someone" };
    const raw = recordFromElement(el, { external_id: "$.id", name: "$.display", ip_address: "$.primary_ip.address", serial_number: "$.serial", "reported.site": "$.site.name", kind: "$.kind_missing" });
    const { record } = norm({ kind: "network", ...raw });
    expect(record).toMatchObject({ external_id: "7", name: "core-sw-1", ips: ["10.9.0.1"], serial_number: "FOC123", reported: { site: "Tehran" }, kind: "network" });
    const renamed = norm(applyRenames({ ...record!, attrs: { location: "R2" } }, { "attrs.rack": "attrs.location", owned_by: "name" })).record!;
    expect(renamed.attrs).toEqual({ location: "R2", rack: "R2" });
    const ci = ciValues({ ...renamed, terminal_id: "۱۰۲۱", macs: ["AA:BB:CC:DD:EE:FF"], model: "C9300" });
    expect(ci.values).toMatchObject({ name: "core-sw-1", ip_address: "10.9.0.1", mac_address: "AA:BB:CC:DD:EE:FF", serial_number: "FOC123", model_name: "C9300" });
    expect(ci.attrs).toEqual({ location: "R2", rack: "R2", terminal_id: "1021", reported_site: "Tehran" });
    for (const k of Object.keys(ci.values)) expect(isAllowedTarget(k), k).toBe(true);
  });
});

describe("the mass-drop guard and contact (§10)", () => {
  it("trips under 70 % of the last complete pass or at zero, never on a first pass", () => {
    expect(massDrop(100, null)).toBe(false);
    expect(massDrop(0, null)).toBe(false);
    expect(massDrop(70, 100)).toBe(false);
    expect(massDrop(69, 100)).toBe(true);
    expect(massDrop(0, 5)).toBe(true);
  });
  it("judges contact on the tool's own time with the kind's lag", () => {
    const now = NOW.getTime();
    const ago = (d: number) => new Date(now - d * 86_400_000).toISOString();
    expect(hasContact(ago(3), { lag_days: 0 }, 14, now)).toBe(true);
    expect(hasContact(ago(20), { lag_days: 0 }, 14, now)).toBe(false);
    // AD's lastLogonTimestamp lags: 20 days old is still contact with a 14-day lag
    expect(hasContact(ago(20), { lag_days: 14 }, 14, now)).toBe(true);
    expect(hasContact(ago(200), { lag_days: 14 }, 14, now)).toBe(false);
    expect(hasContact(null, { lag_days: 0 }, 14, now)).toBe(false);
    expect(hasContact(null, null, 14, now)).toBe(true);
  });
});

describe("the kind registry (§6.1)", () => {
  it("lists every wave-1 kind; only built ones are offered, in the editions they run in", () => {
    expect(KIND_OPTIONS.map((o) => o.value).sort()).toEqual(["ad_computers", "demo", "endpoint_central", "feed", "glpi", "ksc", "mecm", "prtg", "push", "rest", "sql_view", "vcenter", "zabbix"]);
    expect(KIND_DESCRIPTORS.filter((d) => d.ready).map((d) => d.kind).sort()).toEqual(["demo", "rest"]);
    expect(offeredKinds("cloud").map((x) => x.kind.kind)).toEqual(["rest"]);
    expect(kindDescriptor("ad_computers")).toMatchObject({ contact: { lag_days: 14 }, create_policy: "review", priority: 80 });
    expect(kindDescriptor("ksc")?.create_policy).toBe("review");
    expect(kindDescriptor("mecm")?.editions).not.toContain("cloud");
  });
});
