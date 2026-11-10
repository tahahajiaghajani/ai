// Software asset management end to end: installations from the CMDB's runs_on relationships and computers' operating
// systems, normalisation by the seeded software models, the reconciliation run and the compliance position
// (unlicensed, under- and over-licensed, prohibited and unmatched software), removed installs, money only with the
// financial field group, and the licence narrative without a model (rule-based).
import { beforeAll, describe, expect, it } from "vitest";
import { itamWorld, type ItamWorld } from "./itam-helpers";

let w: ItamWorld;
const laptops: string[] = [];
const rels: Record<string, string> = {};

beforeAll(async () => {
  w = await itamWorld();
  const users = [w.p.req.userId, w.p.req2.userId, null];
  for (let i = 0; i < 3; i++) {
    const ci = (await w.o.post(`${w.P}/r/ci`, { name: `LT-SAM-${i}`, class: "laptop", state: "operational", os: "Microsoft Windows 11 Pro", os_version: "23H2", cpu_count: 8, used_by: users[i] })).row;
    laptops.push(ci.id);
  }
  const app = async (name: string, vendor: string | null, on: number[]) => {
    const ci = (await w.o.post(`${w.P}/r/ci`, { name, class: "application", state: "operational", ...(vendor ? { attrs: { vendor } } : {}) })).row;
    for (const i of on) rels[`${name}|${i}`] = (await w.o.post(`${w.P}/r/ci_rel`, { parent_id: ci.id, type: "runs_on", child_id: laptops[i] })).row.id;
    return ci.id as string;
  };
  await app("ESET Endpoint Security", "ESET, spol. s r.o.", [0, 1, 2]);
  await app("AutoCAD 2024 - English", "Autodesk", [0, 1]);
  await app("Adobe Acrobat Reader DC", "Adobe", [0]);
  await app("µTorrent", null, [2]);
  await app("Notepad++ (64-bit x64)", "Notepad++ Team", [1, 2]);
}, 180_000);

describe("installations from the CMDB", () => {
  it("syncs programs and operating systems and normalises them", async () => {
    const r = await w.p.am.client.post(`${w.P}/itam/software/sync`);
    expect(r.sync.created).toBe(3 + 3 + 2 + 1 + 1 + 2);
    const installs = await w.o.post(`${w.P}/r/software_install/query`, { size: 50, fields: ["raw_name", "software_model_id", "normalized_by", "user_id", "ci_id", "source"] });
    const of = (raw: string) => installs.rows.filter((x: any) => x.raw_name === raw);
    const win = of("Microsoft Windows 11 Pro");
    expect(win).toHaveLength(3);
    expect(win.every((x: any) => x.software_model_id && x.normalized_by === "rule")).toBe(true);
    expect(of("Adobe Acrobat Reader DC")[0].software_model_id).toBeNull();
    expect(of("Notepad++ (64-bit x64)")[0].normalized_by).toBe("none");
    expect(win.find((x: any) => x.ci_id === laptops[0]).user_id).toBe(w.p.req.userId);
    // a second sync finds the same installs
    const again = await w.p.am.client.post(`${w.P}/itam/software/sync`);
    expect(again.sync.created).toBe(0);
  });

  it("computes the effective licence position", async () => {
    const c = await w.p.am.client.get(`${w.P}/itam/compliance`);
    expect(c.run).toBeTruthy();
    const pos = (name: string) => c.positions.find((p: any) => p.model === name);
    expect(pos("Windows 11 Pro")).toMatchObject({ consumed: 3, entitled: 50, status: "over_licensed" });
    expect(pos("ESET Endpoint Security")).toMatchObject({ consumed: 3, entitled: 60 });
    expect(pos("AutoCAD 2024")).toMatchObject({ consumed: 2, entitled: 0, status: "unlicensed", metric: "per_user" });
    expect(Number(pos("AutoCAD 2024").exposure)).toBeGreaterThan(0);
    expect(c.unmatched.map((u: any) => u.raw_name)).toEqual(expect.arrayContaining(["Notepad++ (64-bit x64)", "Adobe Acrobat Reader DC"]));
    expect(c.restricted.map((r: any) => r.model)).toContain("uTorrent");
    expect(c.positions[0].status).toBe("unlicensed");
    expect(c.trueups.length).toBeGreaterThan(0);
  });

  it("moves to under-licensed with a small entitlement, and removed installs stop counting", async () => {
    const autocad = await w.idOf("software_model", "name", "AutoCAD 2024");
    const ent = (await w.p.am.client.post(`${w.P}/r/license_entitlement`, { name: "AutoCAD — ۱ کاربر", software_model_id: autocad, metric: "per_user", quantity: 1, unit_cost: "380000000" })).row;
    await w.p.am.client.post(`${w.P}/r/license_entitlement/${ent.id}/transition`, { to: "active" });
    await w.p.am.client.post(`${w.P}/itam/compliance/run`);
    let pos = (await w.p.am.client.get(`${w.P}/itam/compliance`)).positions.find((p: any) => p.model === "AutoCAD 2024");
    expect(pos).toMatchObject({ entitled: 1, consumed: 2, delta: -1, status: "under_licensed", exposure: "380000000" });
    // the program is uninstalled from one laptop: its relationship ends
    await w.o.patch(`${w.P}/r/ci_rel/${rels["AutoCAD 2024 - English|1"]}`, { valid_to: new Date().toISOString() });
    const r = await w.p.am.client.post(`${w.P}/itam/software/sync`);
    expect(r.sync.removed).toBe(1);
    pos = (await w.p.am.client.get(`${w.P}/itam/compliance`)).positions.find((p: any) => p.model === "AutoCAD 2024");
    expect(pos).toMatchObject({ consumed: 1, status: "compliant" });
  });
});

describe("who sees what", () => {
  it("shows positions without money to those without the financial field group", async () => {
    const c = await w.p.agent.client.get(`${w.P}/itam/compliance`);
    expect(c.financial).toBe(false);
    expect(c.totals.exposure).toBeNull();
    expect(c.positions.every((p: any) => p.exposure === "")).toBe(true);
    await w.p.req.client.get(`${w.P}/itam/compliance`, 403);
    await w.p.agent.client.post(`${w.P}/itam/compliance/run`, {}, 403);
    await w.p.agent.client.post(`${w.P}/r/license_position`, { run_id: c.run.id, software_model_id: c.positions[0].software_model_id }, 403);
  });

  it("answers the licence narrative without a model", async () => {
    const r = await w.p.am.client.post(`${w.P}/itam/compliance/narrative`);
    expect(r.ai).toBe(false);
    expect(r.text).toContain("نرم‌افزار بررسی شد");
    expect(r.text).toContain("uTorrent");
  });
});
