// Pure logic of event management: normalisation of every source format, severities, fingerprints, redaction, paths
// and patterns, thresholds, flapping and noise labels, correlation keys, probable-cause ranking and the on-call
// engine (rotations, restrictions on the calendar with holidays, layers, overrides, gaps).
import { describe, expect, it } from "vitest";
import {
  corrKey, fingerprintOf, flapState, groupSummary, isSnsUrl, mapSeverity, matchPattern, nodeCandidates, noiseLabel, normalize, patternProblem, priorityOf,
  rankCauses, readPath, redact, shortHash, stats, thresholdReached, worse, impactOfCriticality,
} from "@shared/event/logic";
import { finalShifts, gapsOf, onCallAt, restrictionAllows, rotationProblem, rotationShifts, timePerPerson, turnAt, type RotationLike } from "@shared/event/oncall";
import { calendarOf, DEFAULT_HOURS } from "@shared/sla/calendar";

const H = 3600_000;
const D = 86_400_000;

describe("normalisation", () => {
  it("maps generic JSON with a field mapping and with the common names", () => {
    const mapped = normalize({ kind: "generic", mapping: { events: "$.items", message: "$.t", node: "$.h.name", severity: "$.lvl", status: "$.st" }, severity_map: { p1: "critical" } }, { items: [{ t: "دیسک پر", h: { name: "db01" }, lvl: "P1", st: "open" }, { t: "دیسک خالی", h: { name: "db01" }, lvl: "low", st: "closed" }] });
    expect(mapped.events).toHaveLength(2);
    expect(mapped.events[0]).toMatchObject({ message: "دیسک پر", node: "db01", severity: "critical", status: "firing" });
    expect(mapped.events[1]).toMatchObject({ severity: "warning", status: "resolved" });
    const plain = normalize({ kind: "generic", default_severity: "major" }, { title: "x", host: "h1", check: "ping", event_id: "e1", value: "12.5", tags: ["a", "b"] });
    expect(plain.events[0]).toMatchObject({ message: "x", node: "h1", metric: "ping", severity: "major", dedupe_hint: "e1", value: 12.5, tags: ["a", "b"] });
  });

  it("reads Alertmanager and Grafana (unified and legacy) deliveries", () => {
    const am = normalize({ kind: "alertmanager" }, { status: "firing", commonLabels: { job: "node" }, alerts: [{ status: "firing", labels: { alertname: "Down", instance: "web1:9100", severity: "critical" }, annotations: { summary: "وب از دسترس خارج شد" }, startsAt: "2026-11-09T08:00:00Z", endsAt: "0001-01-01T00:00:00Z", fingerprint: "f1" }] });
    expect(am.events[0]).toMatchObject({ message: "وب از دسترس خارج شد", node: "web1", resource: "node", metric: "Down", severity: "critical", status: "firing", occurred_at: "2026-11-09T08:00:00.000Z" });
    expect(am.events[0].fingerprint_hint).toBe("alertmanager:f1");
    const unified = normalize({ kind: "grafana" }, { alerts: [{ status: "resolved", labels: { alertname: "Latency", host: "api1" }, annotations: {}, startsAt: "2026-11-09T08:00:00Z", endsAt: "2026-11-09T08:05:00Z", fingerprint: "g1", valueString: "[ var='A' value=812 ]" }] });
    expect(unified.events[0]).toMatchObject({ status: "resolved", node: "api1", value: 812, occurred_at: "2026-11-09T08:05:00.000Z" });
    const legacy = normalize({ kind: "grafana" }, { ruleId: 7, ruleName: "CPU", state: "alerting", evalMatches: [{ metric: "cpu", value: 97, tags: { host: "srv2" } }], tags: { severity: "major" } });
    expect(legacy.events[0]).toMatchObject({ message: "CPU", node: "srv2", metric: "cpu", value: 97, severity: "major", status: "firing", fingerprint_hint: "grafana:7" });
    expect(normalize({ kind: "grafana" }, { ruleName: "x", state: "pending" }).events).toHaveLength(0);
  });

  it("reads Zabbix, Nagios and Icinga notifications", () => {
    const z = normalize({ kind: "zabbix", severity_map: { disaster: "critical" } }, { event_id: "991", trigger_id: "55", host: "sw-core", trigger_name: "Interface down", severity: "Disaster", status: "PROBLEM", event_date: "2026.11.09", event_time: "10:15:00" });
    expect(z.events[0]).toMatchObject({ node: "sw-core", severity: "critical", status: "firing", fingerprint_hint: "zabbix:55", dedupe_hint: "991:firing", occurred_at: "2026-11-09T10:15:00.000Z" });
    expect(normalize({ kind: "zabbix" }, { event_id: "992", trigger_id: "55", host: "sw-core", trigger_name: "Interface down", status: "RESOLVED" }).events[0].status).toBe("resolved");
    const n = normalize({ kind: "nagios" }, { host_name: "web1", service_desc: "HTTP", service_state: "CRITICAL", output: "timeout", notification_type: "PROBLEM" });
    expect(n.events[0]).toMatchObject({ node: "web1", metric: "HTTP", severity: "critical", status: "firing", description: "timeout" });
    expect(normalize({ kind: "nagios" }, { host_name: "web1", service_desc: "HTTP", service_state: "OK", notification_type: "RECOVERY" }).events[0].status).toBe("resolved");
    expect(normalize({ kind: "nagios" }, { host_name: "web1", notification_type: "ACKNOWLEDGEMENT" }).events).toHaveLength(0);
    const i = normalize({ kind: "icinga" }, { host_name: "db1", service_name: "disk", check_result: { state: "Warning", output: "85%" } });
    expect(i.events[0]).toMatchObject({ node: "db1", metric: "disk", severity: "warning", fingerprint_hint: "icinga:db1/disk" });
  });

  it("reads Azure Monitor's common schema and CloudWatch through SNS (and its subscription confirmation)", () => {
    const az = normalize({ kind: "azure_monitor" }, { schemaId: "azureMonitorCommonAlertSchema", data: { essentials: { alertId: "/sub/x/alerts/1", originAlertId: "o1", alertRule: "High CPU", severity: "Sev1", monitorCondition: "Fired", alertTargetIDs: ["/subscriptions/s/resourceGroups/r/providers/Microsoft.Compute/virtualMachines/vm-7"], firedDateTime: "2026-11-09T07:00:00Z", signalType: "Metric", monitoringService: "Platform" }, alertContext: { condition: { allOf: [{ metricName: "Percentage CPU", metricValue: 93 }] } } } });
    expect(az.events[0]).toMatchObject({ message: "High CPU", node: "vm-7", metric: "Percentage CPU", severity: "major", status: "firing", value: 93 });
    expect(az.events[0].ci_hint).toContain("virtualMachines/vm-7");
    const sns = normalize({ kind: "cloudwatch" }, { Type: "SubscriptionConfirmation", SubscribeURL: "https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=t" });
    expect(sns.events).toHaveLength(0);
    expect(isSnsUrl(sns.confirm_url)).toBe(true);
    expect(isSnsUrl("https://evil.example.com/?x")).toBe(false);
    const cw = normalize({ kind: "cloudwatch" }, { Type: "Notification", MessageId: "m-1", Message: JSON.stringify({ AlarmName: "api-5xx", NewStateValue: "ALARM", NewStateReason: "Threshold crossed", StateChangeTime: "2026-11-09T06:00:00.000+0000", Trigger: { MetricName: "5XXError", Namespace: "AWS/ApiGateway", Dimensions: [{ name: "ApiName", value: "orders" }] } }) });
    expect(cw.events[0]).toMatchObject({ message: "api-5xx", node: "orders", metric: "5XXError", status: "firing", dedupe_hint: "m-1" });
    expect(normalize({ kind: "cloudwatch" }, { Type: "Notification", Message: JSON.stringify({ AlarmName: "api-5xx", NewStateValue: "OK" }) }).events[0].status).toBe("resolved");
  });

  it("extracts fields from e-mail with the source's regular expressions", () => {
    const e = normalize({ kind: "email", mapping: { subject_regex: "^\\[(?<severity>\\w+)\\] (?<node>[\\w.-]+): (?<message>.+)$" } }, { subject: "[critical] db01: replication stopped", text: "details", message_id: "<m1@x>" });
    expect(e.events[0]).toMatchObject({ message: "replication stopped", node: "db01", severity: "critical", dedupe_hint: "<m1@x>" });
    expect(normalize({ kind: "email" }, { subject: "RESOLVED: db01 ok", text: "" }).events[0].status).toBe("resolved");
  });
});

describe("helpers", () => {
  it("maps severities from maps, words and numbers", () => {
    expect(mapSeverity("Disaster", null)).toBe("critical");
    expect(mapSeverity("HIGH", null)).toBe("major");
    expect(mapSeverity("average", null)).toBe("minor");
    expect(mapSeverity("4", null)).toBe("warning");
    expect(mapSeverity("whatever", { whatever: "info" })).toBe("info");
    expect(mapSeverity(null, null, "major")).toBe("major");
    expect(worse("minor", "critical")).toBe("critical");
    expect(priorityOf("critical", "1")).toBe("1");
    expect(priorityOf("info", "3")).toBe("5");
    expect(impactOfCriticality("1")).toBe("1");
    expect(impactOfCriticality("4")).toBe("3");
  });

  it("makes stable fingerprints and node candidates", () => {
    const a = fingerprintOf("s1", { fingerprint_hint: null, node: "DB01", resource: null, metric: "cpu", message: "x" });
    const b = fingerprintOf("s1", { fingerprint_hint: null, node: "db01", resource: null, metric: "CPU", message: "y" });
    expect(a).toBe(b);
    expect(fingerprintOf("s2", { fingerprint_hint: null, node: "db01", resource: null, metric: "cpu", message: "x" })).not.toBe(a);
    expect(fingerprintOf("s1", { fingerprint_hint: "zabbix:9", node: "a", resource: null, metric: null, message: "" })).toBe(fingerprintOf("s1", { fingerprint_hint: "zabbix:9", node: "b", resource: null, metric: null, message: "" }));
    expect(shortHash("abc")).toHaveLength(16);
    expect(nodeCandidates("Web1.example.local:8080")).toEqual(expect.arrayContaining(["Web1.example.local", "web1.example.local", "Web1", "web1"]));
  });

  it("redacts secrets and bounds payloads", () => {
    const r = redact({ password: "p", token: "t", nested: { "x-api-key": "k", ok: 1 }, list: Array.from({ length: 300 }, (_, i) => i), long: "x".repeat(5000) }) as Record<string, any>;
    expect(r.password).toBe("***");
    expect(r.token).toBe("***");
    expect(r.nested["x-api-key"]).toBe("***");
    expect(r.nested.ok).toBe(1);
    expect(r.list).toHaveLength(200);
    expect(r.long.length).toBeLessThan(4100);
  });

  it("reads paths and patterns safely", () => {
    expect(readPath({ a: { b: [{ c: 5 }] } }, "$.a.b[0].c")).toBe(5);
    expect(readPath({ a: 1 }, "=ثابت")).toBe("ثابت");
    expect(matchPattern("(?<node>srv\\d+) is down", "srv12 is down now")).toEqual({ node: "srv12" });
    expect(matchPattern("([", "x")).toBeNull();
    expect(patternProblem("([")).toContain("معتبر نیست");
    expect(patternProblem("ok")).toBeNull();
  });

  it("counts thresholds, flapping and noise", () => {
    const now = Date.now();
    expect(thresholdReached([now - 60_000, now - 30_000], now, 3, 5)).toBe(false);
    expect(thresholdReached([now - 60_000, now - 30_000, now], now, 3, 5)).toBe(true);
    let f = flapState([], now - 3000, 30 * 60_000, 3);
    expect(f.flapping).toBe(false);
    f = flapState(f.flips, now - 2000, 30 * 60_000, 3);
    f = flapState(f.flips, now, 30 * 60_000, 3);
    expect(f.flapping).toBe(true);
    expect(flapState([now - 2 * H], now, 30 * 60_000, 2).flips).toHaveLength(1);
    expect(noiseLabel({ acknowledged: false, incident: true, flapCount: 0, reopenCount: 0, openedMs: 0, clearedMs: 1, transientSeconds: 300 }).label).toBe("signal");
    expect(noiseLabel({ acknowledged: false, incident: false, flapCount: 3, reopenCount: 0, openedMs: 0, clearedMs: 1, transientSeconds: 300 }).label).toBe("noise");
    expect(noiseLabel({ acknowledged: false, incident: false, flapCount: 0, reopenCount: 0, openedMs: 0, clearedMs: 60_000, transientSeconds: 300 })).toMatchObject({ label: "likely_noise", reason: expect.stringContaining("گذرا") });
    expect(noiseLabel({ acknowledged: true, incident: false, flapCount: 0, reopenCount: 0, openedMs: 0, clearedMs: 60_000, transientSeconds: 300 }).label).toBe("signal");
  });

  it("keys correlations and ranks probable causes", () => {
    expect(corrKey("ci", { id: "a", ci_id: "c1" })).toBe("ci:c1");
    expect(corrKey("ci", { id: "a", node: "Web1" })).toBe("node:web1");
    expect(corrKey("service", { id: "a" })).toBeNull();
    expect(corrKey("fields", { id: "a", node: "x", metric: "cpu" }, ["node", "metric"])).toBe(corrKey("fields", { id: "b", node: "X", metric: "CPU" }, ["node", "metric"]));
    const t0 = Date.parse("2026-11-09T08:00:00Z");
    const causes = rankCauses(
      [
        { id: "1", number: "ALR1", title: "host down", ci_id: "h", ci_name: "srv", severity: "critical", first_seen_ms: t0, dependents: 2 },
        { id: "2", number: "ALR2", title: "app errors", ci_id: "a", ci_name: "app", severity: "major", first_seen_ms: t0 + 120_000, dependents: 0 },
        { id: "3", number: "ALR3", title: "db slow", ci_id: "d", ci_name: "db", severity: "minor", first_seen_ms: t0 + 60_000, dependents: 1 },
      ],
      [{ id: "c", number: "CHG1", title: "patch", at_ms: t0 - 10 * 60_000, on_group_ci: true }],
    );
    expect(causes).toHaveLength(3);
    expect(causes[0].id).toBe("1");
    expect(causes.some((c) => c.kind === "change")).toBe(true);
    expect(causes[0].evidence.join(" ")).toContain("نخستین");
    const text = groupSummary({ title: "۳ هشدار", alerts: [{ number: "ALR1", title: "x", severity: "critical", state: "open", ci_name: "srv" }], services: ["پرداخت"], causes });
    expect(text).toContain("پرداخت");
    expect(text).toContain("علت‌های محتمل");
    expect(groupSummary({ title: "t", alerts: [], services: [], causes: [] })).toContain("شواهد کافی");
    expect(stats([5, 1, 3])).toMatchObject({ median: 3, count: 3 });
  });
});

describe("on-call engine", () => {
  const tz = "Asia/Tehran";
  // Saturday 1405/08/17 = 2026-11-07, 08:00 Tehran = 04:30Z
  const sat8 = Date.parse("2026-11-07T04:30:00Z");
  const weekly: RotationLike = { id: "w", layer: 1, rotation_type: "weekly", start_at: new Date(sat8).toISOString(), members: ["ali", "sara", "reza"], restriction: "none" };

  it("takes turns weekly from Saturday 08:00 and daily or every N hours", () => {
    expect(turnAt(weekly, sat8)).toBe("ali");
    expect(turnAt(weekly, sat8 + 7 * D - 1)).toBe("ali");
    expect(turnAt(weekly, sat8 + 7 * D)).toBe("sara");
    expect(turnAt(weekly, sat8 + 21 * D)).toBe("ali");
    expect(turnAt(weekly, sat8 - 1)).toBeNull();
    expect(turnAt({ ...weekly, rotation_type: "daily" }, sat8 + D + 1)).toBe("sara");
    expect(turnAt({ ...weekly, rotation_type: "custom", length_hours: 12 }, sat8 + 13 * H)).toBe("sara");
    expect(turnAt({ ...weekly, end_at: new Date(sat8 + D).toISOString() }, sat8 + 2 * D)).toBeNull();
  });

  it("restricts a layer to working hours, the hours outside them (holidays included) or a daily window", () => {
    const cal = calendarOf({ timezone: tz, hours: DEFAULT_HOURS }, [{ date: "2026-11-09", title: "تعطیل" }]);
    const o = { tz, cal };
    const sat10 = sat8 + 2 * H; // Saturday 10:00 — working time
    const sat22 = sat8 + 14 * H; // Saturday 22:00 — outside
    const mon10 = sat8 + 2 * D + 2 * H; // Monday 10:00 — a holiday in this calendar
    expect(restrictionAllows({ ...weekly, restriction: "office" }, sat10, o)).toBe(true);
    expect(restrictionAllows({ ...weekly, restriction: "office" }, sat22, o)).toBe(false);
    expect(restrictionAllows({ ...weekly, restriction: "off_hours" }, sat22, o)).toBe(true);
    expect(restrictionAllows({ ...weekly, restriction: "off_hours" }, mon10, o)).toBe(true);
    const night = { ...weekly, restriction: "custom", restrict_from: "20:00", restrict_to: "08:00", restrict_days: ["0"] };
    expect(restrictionAllows(night, sat22, o)).toBe(true);
    expect(restrictionAllows(night, sat8 + D - 30 * 60_000, o)).toBe(true); // Sunday 07:30 belongs to Saturday's night
    expect(restrictionAllows(night, sat8 + D + 14 * H, o)).toBe(false); // Sunday 22:00 — not a chosen day
  });

  it("lets the higher layer win and overrides beat every layer (all or instead of one person)", () => {
    const nights: RotationLike = { id: "n", layer: 2, rotation_type: "daily", start_at: new Date(sat8).toISOString(), members: ["nima"], restriction: "custom", restrict_from: "20:00", restrict_to: "08:00" };
    const o = { tz, cal: null };
    expect(onCallAt([weekly, nights], [], sat8 + 2 * H, o).user).toBe("ali");
    expect(onCallAt([weekly, nights], [], sat8 + 14 * H, o)).toMatchObject({ user: "nima", layer: 2 });
    const cover = { id: "o1", user_id: "maryam", start_at: new Date(sat8 + H).toISOString(), end_at: new Date(sat8 + 3 * H).toISOString() };
    expect(onCallAt([weekly, nights], [cover], sat8 + 2 * H, o)).toMatchObject({ user: "maryam", override_id: "o1" });
    const instead = { id: "o2", user_id: "maryam", replaces_id: "nima", start_at: new Date(sat8).toISOString(), end_at: new Date(sat8 + D).toISOString() };
    expect(onCallAt([weekly, nights], [instead], sat8 + 2 * H, o).user).toBe("ali");
    expect(onCallAt([weekly, nights], [instead], sat8 + 14 * H, o).user).toBe("maryam");
  });

  it("builds the final layer with merged shifts, gaps and hours per person", () => {
    const office: RotationLike = { ...weekly, restriction: "office" };
    const cal = calendarOf({ timezone: tz, hours: DEFAULT_HOURS }, []);
    const shifts = finalShifts([office], [], sat8, sat8 + D, { tz, cal });
    expect(shifts[0]).toMatchObject({ user: "ali", start: sat8, end: sat8 + 8 * H });
    expect(gapsOf(shifts)).toHaveLength(1);
    expect(gapsOf(shifts)[0]).toMatchObject({ start: sat8 + 8 * H, end: sat8 + D });
    const full = finalShifts([weekly], [], sat8, sat8 + 14 * D, { tz, cal: null });
    expect(full.map((s) => s.user)).toEqual(["ali", "sara"]);
    expect(timePerPerson(full).get("ali")).toBe(7 * D);
    expect(rotationShifts(office, sat8, sat8 + D, { tz, cal })).toHaveLength(1);
    expect(rotationProblem({ members: [], start_at: "x" })).toContain("یک نفر");
    expect(rotationProblem({ ...weekly, restriction: "custom" })).toContain("۰۸:۰۰");
    expect(rotationProblem(weekly)).toBeNull();
  });
});
