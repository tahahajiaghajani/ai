// The ingestion endpoint and the processing pipeline end to end: keys, idempotency and rate limits, the tools'
// formats, rules (ignore, enrich, threshold, simulation), CI binding, deduplication, clear and re-open, flapping,
// maintenance windows, correlation into groups (CMDB topology) and the alert → incident rules with auto-resolution.
import { beforeAll, describe, expect, it } from "vitest";
import { eventWorld, type EventWorld } from "./event-helpers";

let w: EventWorld;
beforeAll(async () => {
  w = await eventWorld();
}, 120_000);

type Row = Record<string, any>;
const q = async (table: string, filter: unknown, fields?: string[]) => (await w.o.post(`${w.P}/r/${table}/query`, { filter, size: 100, ...(fields ? { fields } : {}) })).rows as Row[];
const one = async (table: string, id: string) => (await w.o.get(`${w.P}/r/${table}/${id}`)).row as Row;

describe("ingestion", () => {
  it("refuses an unknown key, stores a delivery once and binds the CI by host name", async () => {
    expect((await w.send("ev_notarealkeynotarealkeynotarealkey", { title: "x" })).status).toBe(401);
    const s = await w.source({ name: "عمومی ۱" });
    const first = await w.send(s.key, { title: "CPU بالا", host: "srv-db01", severity: "warning", event_id: "e-1" });
    expect(first.status).toBe(202);
    expect(first.body.accepted).toBe(1);
    const again = await w.send(s.key, { title: "CPU بالا", host: "srv-db01", severity: "warning", event_id: "e-1" });
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 1 });
    await w.drain();
    const ev = await q("event", { f: "source_id", op: "eq", v: s.id }, ["outcome", "ci_id", "alert_id", "payload"]);
    expect(ev).toHaveLength(1);
    expect(ev[0].outcome).toBe("created");
    expect(ev[0].ci_id).toBe(w.ci.host);
    const alert = await one("alert", ev[0].alert_id);
    expect(alert).toMatchObject({ ci_id: w.ci.host, severity: "warning", state: "open", event_count: 1, assignment_group_id: w.g.db });
  });

  it("honours an Idempotency-Key header and redacts secrets of payloads", async () => {
    const s = await w.source({ name: "عمومی ۲" });
    const r1 = await w.send(s.key, { title: "ورود ناموفق", host: "app01", password: "hunter2", nested: { api_key: "abc" } }, { "idempotency-key": "k-77" });
    const r2 = await w.send(s.key, { title: "ورود ناموفق", host: "app01" }, { "idempotency-key": "k-77" });
    expect(r1.body.accepted).toBe(1);
    expect(r2.body.duplicates).toBe(1);
    await w.drain();
    const [ev] = await q("event", { f: "source_id", op: "eq", v: s.id }, ["payload"]);
    expect(JSON.stringify(ev.payload)).not.toContain("hunter2");
    expect(JSON.stringify(ev.payload)).not.toContain("abc");
  });

  it("limits each source to its rate", async () => {
    const s = await w.source({ name: "پرحرف", rate_limit: 2 });
    expect((await w.send(s.key, { title: "a", event_id: "1" })).status).toBe(202);
    expect((await w.send(s.key, { title: "b", event_id: "2" })).status).toBe(202);
    const third = await w.send(s.key, { title: "c", event_id: "3" });
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });

  it("normalises Alertmanager deliveries (firing, then resolved)", async () => {
    const s = await w.source({ name: "AM", kind: "alertmanager" });
    const payload = (status: string) => ({
      version: "4",
      status,
      receiver: "itsm",
      commonLabels: { job: "node" },
      alerts: [
        { status, labels: { alertname: "HighLoad", instance: "srv-db01:9100", severity: "critical" }, annotations: { summary: "بار زیاد روی srv-db01" }, startsAt: "2026-11-09T08:00:00Z", endsAt: status === "resolved" ? "2026-11-09T08:10:00Z" : "0001-01-01T00:00:00Z", fingerprint: "abc123" },
      ],
    });
    expect((await w.send(s.key, payload("firing"))).body.accepted).toBe(1);
    await w.drain();
    const [a] = await q("alert", { f: "source_id", op: "eq", v: s.id });
    expect(a).toMatchObject({ node: "srv-db01", metric: "HighLoad", severity: "critical", ci_id: w.ci.host });
    expect((await w.send(s.key, payload("resolved"))).body.accepted).toBe(1);
    await w.drain();
    expect((await one("alert", a.id)).state).toBe("cleared");
  });
});

describe("rules", () => {
  it("ignores test events, enriches network devices and holds events under a threshold", async () => {
    const s = await w.source({ name: "قواعد" });
    await w.send(s.key, [{ title: "[TEST] اتصال", host: "x1", event_id: "t1" }, { title: "port is down", host: "sw-core1", event_id: "t2" }, { title: "disk usage", host: "srv-9", metric: "disk_used", event_id: "t3" }]);
    await w.drain();
    const evs = await q("event", { f: "source_id", op: "eq", v: s.id }, ["outcome", "message", "decision", "severity", "tags", "assignment_group_id"]);
    const by = (m: string) => evs.find((e) => String(e.message).includes(m))!;
    expect(by("[TEST]").outcome).toBe("ignored");
    expect(by("port").assignment_group_id).toBe(w.g.network);
    expect(by("port").tags).toContain("شبکه");
    expect(by("port").severity).toBe("critical");
    expect(by("disk").outcome).toBe("held");
    expect(by("disk").decision.rules.some((r: Row) => r.action === "threshold")).toBe(true);
    await w.send(s.key, [{ title: "disk usage", host: "srv-9", metric: "disk_used", event_id: "t4" }, { title: "disk usage", host: "srv-9", metric: "disk_used", event_id: "t5" }]);
    await w.drain();
    const after = await q("event", { and: [{ f: "source_id", op: "eq", v: s.id }, { f: "metric", op: "eq", v: "disk_used" }] }, ["outcome"]);
    expect(after.map((e) => e.outcome)).toContain("created");
  });

  it("simulates a rule on stored events without changing them", async () => {
    const r = await w.o.post(`${w.P}/event/rules/simulate`, { rule: { name: "آزمون", action: "set", condition: { f: "node", op: "eq", v: "srv-db01" }, set_severity: "info" }, days: 7 });
    expect(r.checked).toBeGreaterThan(0);
    expect(r.matched).toBeGreaterThan(0);
    expect(r.samples[0].after.severity).toBe("info");
    const still = await q("event", { f: "node", op: "eq", v: "srv-db01" }, ["severity"]);
    expect(still.every((e) => e.severity !== "info")).toBe(true);
  });

  it("refuses an invalid pattern", async () => {
    await w.o.post(`${w.P}/r/event_rule`, { name: "بد", action: "set", pattern: "([", set_severity: "info" }, 400);
  });
});

describe("deduplication, flapping and maintenance", () => {
  it("folds repeats into one alert with a severity history, re-opens after a clear and marks flapping", async () => {
    const s = await w.source({ name: "تکرار" });
    const fire = (sev: string, id: string) => w.send(s.key, { title: "سرویس کند", host: "app-9", check: "latency", severity: sev, event_id: id });
    const clear = (id: string) => w.send(s.key, { title: "سرویس کند", host: "app-9", check: "latency", status: "ok", event_id: id });
    await fire("warning", "d1");
    await fire("major", "d2");
    await w.drain();
    let [a] = await q("alert", { f: "source_id", op: "eq", v: s.id });
    expect(a.event_count).toBe(2);
    a = await one("alert", a.id);
    expect(a.severity).toBe("major");
    expect(a.severity_history.map((h: Row) => h.to)).toEqual(["warning", "major"]);
    for (let i = 0; i < 4; i++) {
      await clear(`c${i}`);
      await w.drain();
      await fire("major", `f${i}`);
      await w.drain();
    }
    a = await one("alert", a.id);
    expect(a.state).toBe("flapping");
    expect(a.noise_label).toBe("noise");
    expect(a.reopen_count).toBeGreaterThan(0);
  });

  it("puts alerts of a CI inside a maintenance window into «در نگهداری» (no paging)", async () => {
    const now = Date.now();
    await w.o.post(`${w.P}/r/change_window`, { name: "نگهداری db01", kind: "maintenance", start_at: new Date(now - 3600_000).toISOString(), end_at: new Date(now + 3600_000).toISOString(), cis: [w.ci.db] });
    const s = await w.source({ name: "نگهداری" });
    await w.send(s.key, { title: "پایگاه داده در دسترس نیست", host: "db01", severity: "critical", event_id: "m1" });
    await w.drain();
    const [a] = await q("alert", { f: "source_id", op: "eq", v: s.id });
    expect(a.state).toBe("maintenance");
    expect((await one("alert", a.id)).maintenance_window_id).toBeTruthy();
    expect(await q("page", { f: "alert_id", op: "eq", v: a.id })).toHaveLength(0);
  });
});

describe("correlation and incidents", () => {
  it("groups alerts of dependent CIs with the upstream CI as root and raises one incident per group, resolved when they clear", async () => {
    const host = (await w.o.post(`${w.P}/r/ci`, { name: "srv-t1", class: "server", state: "operational", hostname: "srv-t1", support_group_id: w.g.db })).row.id as string;
    const app = (await w.o.post(`${w.P}/r/ci`, { name: "سامانهٔ حقوق", class: "business_application", state: "operational", criticality: "1", support_group_id: w.g.network })).row.id as string;
    await w.o.post(`${w.P}/r/ci_rel`, { parent_id: app, type: "depends_on", child_id: host });
    const s = await w.source({ name: "توپولوژی" });
    await w.send(s.key, [
      { title: "سرور srv-t1 در دسترس نیست", host: "srv-t1", severity: "critical", check: "ping", event_id: "g1" },
      { title: "حقوق خطا می‌دهد", ci: "سامانهٔ حقوق", host: "hr-app", severity: "major", check: "http", event_id: "g2" },
    ]);
    await w.drain();
    const alerts = await q("alert", { f: "source_id", op: "eq", v: s.id });
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.ci_id).sort()).toEqual([host, app].sort());
    expect(alerts[0].group_id).toBeTruthy();
    expect(alerts[0].group_id).toBe(alerts[1].group_id);
    const group = await one("alert_group", alerts[0].group_id);
    expect(group.reason).toBe("topology");
    expect(group.ci_id).toBe(host);
    expect(group.alert_count).toBe(2);
    expect(group.summary).toContain("هشدار");
    const fresh = await Promise.all(alerts.map((a) => one("alert", a.id)));
    expect(fresh.find((a) => a.ci_id === app)!.symptom).toBe(true);
    expect(fresh[0].incident_id).toBeTruthy();
    expect(fresh[1].incident_id).toBe(fresh[0].incident_id);
    const inc = await one("incident", fresh[0].incident_id);
    expect(inc.channel).toBe("monitoring");
    const links = (await w.o.get(`${w.P}/r/incident/${inc.id}/links`)).links as Row[];
    expect(links.filter((l) => l.kind === "raised")).toHaveLength(2);
    await w.send(s.key, [
      { title: "سرور srv-t1 در دسترس نیست", host: "srv-t1", check: "ping", status: "resolved", event_id: "g1r" },
      { title: "حقوق خطا می‌دهد", ci: "سامانهٔ حقوق", host: "hr-app", check: "http", status: "resolved", event_id: "g2r" },
    ]);
    await w.drain();
    expect((await one("incident", inc.id)).state).toBe("resolved");
    expect((await one("alert_group", group.id)).state).toBe("resolved");
  });

  it("explains a group's probable causes with rules when no model is configured", async () => {
    const [g] = await q("alert_group", { f: "reason", op: "eq", v: "topology" });
    const causes = await w.o.get(`${w.P}/event/groups/${g.id}/causes`);
    expect(causes.causes.length).toBeGreaterThan(0);
    expect(causes.causes[0].evidence.length).toBeGreaterThan(0);
    const ai = await w.o.post(`${w.P}/event/groups/${g.id}/ai/causes`, {});
    expect(ai.ai).toBe(false);
    expect(ai.text).toContain("سرنخ");
  });
});
