// Configuration management's data pipeline: the identification and reconciliation engine (match by normalised
// identifiers, unchanged / updated / created, dry runs, source authority and locked attributes, duplicates turned into
// review tasks, relationships between items), imports as runs of batches, merge with its preview and undo, baselines
// with comparison and drift, CI health and the summary, data-quality findings of the nightly pass, rule-based
// relationships, wrong-CI feedback on an incident, and the Windows-only collector.
import { beforeAll, describe, expect, it } from "vitest";
import { cmdbWorld, type CmdbWorld } from "./cmdb-helpers";

let w: CmdbWorld;
const R = (t: string, id?: string) => `${w.P}/r/${t}${id ? `/${id}` : ""}`;
const C = (p: string) => `${w.P}/cmdb${p}`;
const items = (list: unknown[], extra: Record<string, unknown> = {}) => w.o.post(C("/ire/items"), { items: list, ...extra });
const byName = async (name: string) => (await w.o.post(`${R("ci")}/query`, { filter: { f: "name", op: "eq", v: name }, fields: ["name", "state", "os", "ram_mb", "serial_number"] })).rows;

beforeAll(async () => {
  w = await cmdbWorld();
}, 120_000);

describe("identification and reconciliation", () => {
  it("creates a CI from an item and recognises it again by its serial, whatever the case or digits", async () => {
    const first = await items([{ class: "server", values: { name: "srv-ire-1", serial_number: "abc-123", manufacturer: "Dell" } }]);
    expect(first).toMatchObject({ created: 1, failed: 0 });
    const id = first.results[0].ci_id;
    const same = await items([{ class: "server", values: { name: "srv-ire-1", serial_number: "abc-123", manufacturer: "Dell" } }]);
    expect(same.results[0]).toMatchObject({ action: "unchanged", ci_id: id });
    const changed = await items([{ class: "server", values: { serial_number: "ABC-۱۲۳", ram_mb: 16384 } }]);
    expect(changed.results[0]).toMatchObject({ action: "updated", ci_id: id });
    expect(changed.results[0].changed).toContain("ram_mb");
    expect(changed.results[0].matched_by).toBeTruthy();
    expect((await byName("srv-ire-1"))[0].ram_mb).toBe(16384);
  });

  it("checks without writing on a dry run", async () => {
    const dry = await items([{ class: "server", values: { name: "srv-dry", serial_number: "DRY-1" } }], { dry_run: true });
    expect(dry).toMatchObject({ created: 1, dry_run: true });
    expect(await byName("srv-dry")).toHaveLength(0);
  });

  it("keeps a more trusted source's values and locked attributes", async () => {
    const hi = (await w.o.post(R("cmdb_data_source"), { name: "منبع معتبر", kind: "api", priority: 5 })).row;
    const lo = (await w.o.post(R("cmdb_data_source"), { name: "منبع کم‌اعتبار", kind: "api", priority: 90 })).row;
    const a = await items([{ class: "server", values: { name: "srv-prov", serial_number: "PROV-1", os: "Ubuntu 24.04", ram_mb: 8192 } }], { source_id: hi.id });
    const id = a.results[0].ci_id;
    const b = await items([{ class: "server", values: { serial_number: "PROV-1", os: "Ubuntu 20.04" } }], { source_id: lo.id });
    expect(b.results[0].skipped).toContain("os");
    expect((await w.o.get(R("ci", id))).row.os).toBe("Ubuntu 24.04");
    await w.o.patch(R("ci", id), { locked_attrs: ["ram_mb"] });
    const c = await items([{ class: "server", values: { serial_number: "PROV-1", ram_mb: 1 } }], { source_id: hi.id });
    expect(c.results[0].skipped).toContain("ram_mb");
    expect((await w.o.get(R("ci", id))).row.ram_mb).toBe(8192);
    const prov = await w.o.get(C(`/ci/${id}/provenance`));
    expect(prov.rows.find((r: any) => r.field === "os").set_by.name).toBe("منبع معتبر");
    expect(prov.rows.find((r: any) => r.field === "ram_mb").locked).toBe(true);
  });

  it("turns an ambiguous match into a duplicate review instead of a twin", async () => {
    await w.ci({ name: "dup-a", class: "server", serial_number: "DUP-1" });
    await w.ci({ name: "dup-b", class: "server", serial_number: "DUP-1" });
    const r = await items([{ class: "server", values: { serial_number: "dup-1", name: "dup-c" } }]);
    expect(r.results[0].action).toBe("duplicate");
    const task = (await w.o.get(R("cmdb_dedup_task", r.results[0].dedup_task_id))).row;
    expect(task.candidates).toHaveLength(2);
    expect(await byName("dup-c")).toHaveLength(0);
  });

  it("relates items of the same payload and existing CIs", async () => {
    const host = await w.ci({ name: "esx-ire", class: "server", serial_number: "ESX-IRE" });
    const r = await items([
      { class: "application", values: { name: "app-ire" }, relations: [{ type: "runs_on", item: 1 }] },
      { class: "virtual_machine", values: { name: "vm-ire", bios_uuid: "VM-IRE-1" }, relations: [{ type: "runs_on", ci_id: host.id }] },
    ]);
    expect(r.created).toBe(2);
    expect(r.relations.created).toBe(2);
    const rels = (await w.o.post(`${R("ci_rel")}/query`, { filter: { f: "child_id", op: "eq", v: host.id }, fields: ["type", "parent_id"] })).rows;
    expect(rels).toEqual(expect.arrayContaining([expect.objectContaining({ type: "runs_on", parent_id: r.results[1].ci_id })]));
  });
});

describe("imports", () => {
  it("imports a file in batches as one run with its counts", async () => {
    const run = (await w.o.post(C("/import/runs"), { name: "ورود سرورها", class: "server", file_name: "servers.csv" })).run;
    const rows = [{ Name: "imp-1", Serial: "IMP-1" }, { Name: "imp-2", Serial: "IMP-2" }];
    const b1 = await w.o.post(C(`/import/runs/${run.id}/batch`), { rows: rows.slice(0, 1), mapping: { Name: "name", Serial: "serial_number" } });
    const b2 = await w.o.post(C(`/import/runs/${run.id}/batch`), { rows: rows.slice(1), mapping: { Name: "name", Serial: "serial_number" } });
    expect(b1.created + b2.created).toBe(2);
    const done = await w.o.post(C(`/import/runs/${run.id}/finish`), {});
    expect(done.run.state).toBe("completed");
    const rec = (await w.o.get(R("cmdb_import_run", run.id))).row;
    expect(rec).toMatchObject({ created: 2, failed: 0 });
  });
});

describe("merge", () => {
  it("previews and merges duplicates, moving relationships, and can be undone", async () => {
    const a = await w.ci({ name: "merge-a", class: "server", serial_number: "MRG-1" });
    const b = await w.ci({ name: "merge-b", class: "server", serial_number: "MRG-1", manufacturer: "Lenovo" });
    const app = await w.ci({ name: "merge-app", class: "application" });
    await w.rel(app.id, "runs_on", b.id);
    const preview = await w.o.post(C("/merge/preview"), { survivor: a.id, absorbed: [b.id] });
    expect(preview.relations.move).toBe(1);
    expect(preview.fills.map((f: any) => f.field)).toContain("manufacturer");
    const merged = await w.o.post(C("/merge"), { survivor: a.id, absorbed: [b.id] });
    expect(merged.survivor).toBe(a.id);
    expect((await w.o.get(R("ci", b.id))).row.state).toBe("retired");
    expect((await w.o.get(R("ci", a.id))).row.manufacturer).toBe("Lenovo");
    const moved = (await w.o.post(`${R("ci_rel")}/query`, { filter: { f: "parent_id", op: "eq", v: app.id }, fields: ["child_id", "valid_to"] })).rows.filter((r: any) => !r.valid_to);
    expect(moved.map((r: any) => r.child_id)).toEqual([a.id]);
    const undo = await w.o.post(C(`/merge/${merged.task_id}/undo`), {});
    expect(undo.restored).toBeGreaterThan(0);
    expect((await w.o.get(R("ci", b.id))).row.state).not.toBe("retired");
  });
});

describe("baselines and drift", () => {
  it("snapshots, compares with the present and records drift", async () => {
    const ci = await w.ci({ name: "base-1", class: "server", serial_number: "BASE-1", os: "Windows Server", os_version: "2019" });
    const b = (await w.o.post(R("ci_baseline"), { name: "خط مبنای آزمایشی", scope_kind: "cis", ci_ids: [ci.id] })).row;
    const snap = await w.o.post(C(`/baselines/${b.id}/snapshot`), {});
    expect(snap.item_count).toBe(1);
    await w.o.patch(R("ci", ci.id), { os_version: "2022" });
    const cmp = await w.o.get(C(`/baselines/${b.id}/compare`));
    expect(cmp.diff.modified[0].fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: "os_version", before: "2019", after: "2022" })]));
    await w.o.post(C(`/baselines/${b.id}/drift`), {}, 409); // drift only from an approved baseline
    const approved = (await w.o.post(`${R("ci_baseline", b.id)}/transition`, { to: "approved", data: {} })).row;
    expect(approved.approved_at).toBeTruthy();
    const drift = await w.o.post(C(`/baselines/${b.id}/drift`), {});
    expect(drift.created).toBeGreaterThanOrEqual(1);
    const rows = (await w.o.post(`${R("ci_drift")}/query`, { filter: { f: "ci_id", op: "eq", v: ci.id }, fields: ["ci_id"] })).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("health, rules and suggestions", () => {
  it("computes a CI's health and the summary per class", async () => {
    const ci = await w.ci({ name: "health-1", class: "server", serial_number: "H-1" });
    const h = await w.o.post(C(`/ci/${ci.id}/health`), {});
    expect(typeof h.health.score).toBe("number");
    expect(h.health.issues.length).toBeGreaterThan(0);
    const sum = await w.o.get(C("/health"));
    expect(sum.total).toBeGreaterThan(0);
  });

  it("opens data-quality findings in the nightly pass", async () => {
    const ci = await w.ci({ name: "rule-1", class: "server", serial_number: "RULE-1", support_group_id: null });
    await w.o.post(C("/health/run"), {});
    await w.drain();
    const f = (await w.o.post(`${R("cmdb_finding")}/query`, { filter: { f: "ci_id", op: "eq", v: ci.id }, fields: ["kind", "active", "short_description"] })).rows;
    expect(f.some((x: any) => x.active)).toBe(true);
    const sum = await w.o.get(C("/health"));
    expect(sum.classes.find((c: any) => c.class === "server")).toBeTruthy();
  });

  it("creates relationships from rules (a VM's host id matches a server's BIOS id)", async () => {
    const host = await w.ci({ name: "esx-rule", class: "server", serial_number: "ESX-RULE", bios_uuid: "HOST-UUID-9" });
    const vm = await w.ci({ name: "vm-rule", class: "virtual_machine", attrs: { host_uuid: "host-uuid-9" } });
    await w.o.post(C("/rel-rules/run"), {});
    const rels = (await w.o.post(`${R("ci_rel")}/query`, { filter: { f: "parent_id", op: "eq", v: vm.id }, fields: ["type", "child_id"] })).rows;
    expect(rels).toEqual(expect.arrayContaining([expect.objectContaining({ type: "runs_on", child_id: host.id })]));
  });
});

describe("feedback and the collector", () => {
  it("records wrong-CI feedback on an incident: the correction and a finding for the CI's owner", async () => {
    const wrong = await w.ci({ name: "wrong-ci", class: "server", serial_number: "W-1", owned_by: w.p.am.userId });
    const right = await w.ci({ name: "right-ci", class: "server", serial_number: "W-2" });
    const inc = (await w.o.post(R("incident"), { short_description: "سرور در دسترس نیست", ci_id: wrong.id })).row;
    const r = await w.o.post(C("/wrong-ci"), { table: "incident", id: inc.id, correct_ci_id: right.id, note: "سرور دیگری بود" });
    expect(r.finding_id).toBeTruthy();
    expect((await w.o.get(R("incident", inc.id))).row.ci_id).toBe(right.id);
    const f = (await w.o.get(R("cmdb_finding", r.finding_id))).row;
    expect(f).toMatchObject({ kind: "wrong_ci", ci_id: wrong.id, assigned_to: w.p.am.userId });
  });

  it("keeps the local inventory collector to the Windows app", async () => {
    await w.o.get(C("/collector/local/preview"), 403);
  });
});
