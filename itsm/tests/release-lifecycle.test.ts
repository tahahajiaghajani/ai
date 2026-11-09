// Release management: seeds, the template's set-up, readiness checks, the go/no-go decision and the lifecycle guards.
import { describe, expect, it, beforeAll } from "vitest";
import { world, at, type World } from "./release-helpers";

let w: World;

beforeAll(async () => {
  w = await world();
}, 120_000);

describe("release seed", () => {
  it("adds the defaults once and is idempotent", async () => {
    const again = await w.o.post(`${w.P}/release/seed`, {});
    expect(again.skipped).toBe(true);
    const envs = (await w.o.get(`${w.P}/r/release_environment?size=50`)).rows as Record<string, any>[];
    expect(envs.map((e) => e.key).sort()).toEqual(["dev", "prod", "staging", "test"]);
    expect(envs.find((e) => e.key === "prod")!.protection).toBe("change");
    const checks = (await w.o.get(`${w.P}/r/release_check?size=50`)).rows as Record<string, any>[];
    expect(checks.length).toBeGreaterThanOrEqual(10);
    const templates = (await w.o.get(`${w.P}/r/release_template?size=50`)).rows as Record<string, any>[];
    expect(templates.some((t) => t.type === "major")).toBe(true);
    const cfgId = (await w.o.get(`${w.P}/r/release_config?size=5`)).rows[0].id;
    const cfg = await w.get("release_config", cfgId);
    expect(cfg.dora_definitions?.cfr?.name).toBe("نرخ شکست تغییر");
    const forced = await w.o.post(`${w.P}/release/seed`, { force: true });
    expect(Object.values(forced.created ?? {}).reduce((s: number, n) => s + Number(n), 0)).toBe(0);
  });

  it("keeps the seed and the definitions to the release manager", async () => {
    await w.p.dev.client.post(`${w.P}/release/seed`, {}, 403);
    await w.p.dev.client.post(`${w.P}/r/release_check`, { key: "my_check", name: "بررسی من", rule: "manual" }, 403);
    const envs = (await w.p.dev.client.get(`${w.P}/r/release_environment?size=50`)).rows as Record<string, any>[];
    const prod = envs.find((e) => e.key === "prod")!;
    await w.p.dev.client.patch(`${w.P}/r/release_environment/${prod.id}`, { protection: "open", version: prod.version }, 403);
    const made = await w.p.rm.client.post(`${w.P}/r/release_check`, { key: "perf_test", name: "آزمون کارایی انجام شد", rule: "manual", types: ["major"] });
    expect(made.row.key).toBe("perf_test");
  });
});

describe("a release from a template", () => {
  it("copies the template's tasks and readiness checks", async () => {
    const templates = (await w.o.get(`${w.P}/r/release_template?size=50`)).rows as Record<string, any>[];
    const major = templates.find((t) => t.type === "major")!;
    const rel = await w.release({ type: "major", template_id: major.id, planned_start: at(1), planned_end: at(25, 18) });
    expect(rel.number).toMatch(/^REL/);
    expect(rel.deployment_plan).toContain("استقرار");
    expect(rel.els_days).toBe(14);
    await w.drain();
    const tasks = (await w.o.get(`${w.P}/r/release_task?filter=${encodeURIComponent(JSON.stringify({ f: "release_id", op: "eq", v: rel.id }))}&size=50`)).rows as Record<string, any>[];
    expect(tasks.length).toBe(9);
    expect(tasks.every((t) => t.release_manager_id === rel.release_manager_id)).toBe(true);
    const results = (await w.o.get(`${w.P}/r/release_check_result?filter=${encodeURIComponent(JSON.stringify({ f: "release_id", op: "eq", v: rel.id }))}&size=50`)).rows as Record<string, any>[];
    expect(results.length).toBe(10);
    const fresh = await w.get("release", rel.id);
    expect(fresh.checks_total).toBe(10);
    expect(fresh.risk_band).toBeTruthy();
  });
});

describe("readiness and the go/no-go decision", () => {
  it("blocks deployment until the blocking checks pass and a Go is recorded", async () => {
    const rel = await w.release({ type: "minor" });
    await w.drain();
    let row = await w.move("release", rel.id, ["planning", "build", "test", "readiness"]);
    expect(row.state).toBe("readiness");
    // the guard: blocking checks are pending or failed
    await w.p.dev.client.post(`${w.P}/r/release/${rel.id}/transition`, { to: "deploying", version: row.version }, 409);
    // a member of the release team may not decide
    await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/decide`, { decision: "go", rationale: "آماده است" }, 403);
    // a Go is refused while blocking checks are open
    await w.p.rm.client.post(`${w.P}/release/records/${rel.id}/decide`, { decision: "go", rationale: "آماده است" }, 409);
    // the release manager waives the open blocking checks with a reason
    const board = await w.p.rm.client.get(`${w.P}/release/board`);
    const mine = (board.releases as Record<string, any>[]).find((r) => r.id === rel.id)!;
    expect(mine.readiness.ready).toBe(false);
    for (const c of mine.checks as Record<string, any>[]) {
      if (c.blocking !== false && !["pass", "waived", "na"].includes(c.status)) {
        await w.p.dev.client.post(`${w.P}/release/records/${rel.id}/checks/${c.id}/waive`, { reason: "پذیرفته شد" }, 403);
        await w.p.rm.client.post(`${w.P}/release/records/${rel.id}/checks/${c.id}/waive`, { reason: "ریسک پذیرفته شد؛ آزمون دستی انجام شد" });
      }
    }
    const decided = await w.p.rm.client.post(`${w.P}/release/records/${rel.id}/decide`, { decision: "go_with_conditions", conditions: "پایش ویژه در ۲ ساعت نخست", rationale: "بررسی‌ها قبول یا با دلیل پذیرفته شدند" });
    expect(decided.release.go_no_go).toBe("go_with_conditions");
    expect(decided.decision.snapshot.readiness.pct).toBeGreaterThan(0);
    row = await w.get("release", rel.id, w.p.dev.client);
    row = (await w.p.dev.client.post(`${w.P}/r/release/${rel.id}/transition`, { to: "deploying", version: row.version })).row;
    expect(row.state).toBe("deploying");
  });

  it("a No-Go sends the release back to test", async () => {
    const rel = await w.release({ type: "patch" });
    await w.drain();
    await w.move("release", rel.id, ["build", "test", "readiness"]);
    const r = await w.p.rm.client.post(`${w.P}/release/records/${rel.id}/decide`, { decision: "no_go", rationale: "نقص بحرانی در آزمون پذیرش" });
    expect(r.release.go_no_go).toBe("no_go");
    expect(r.release.state).toBe("test");
    const decisions = (await w.o.get(`${w.P}/r/release_decision?filter=${encodeURIComponent(JSON.stringify({ f: "release_id", op: "eq", v: rel.id }))}`)).rows;
    expect(decisions.length).toBe(1);
    // decisions are a record: nobody edits or deletes them through the generic API
    await w.o.patch(`${w.P}/r/release_decision/${decisions[0].id}`, { rationale: "تغییر" }, 403);
  });

  it("the emergency procedure goes straight to the decision only for emergency releases", async () => {
    const normal = await w.release({ type: "minor" });
    await w.p.dev.client.post(`${w.P}/r/release/${normal.id}/transition`, { to: "readiness", version: normal.version }, 409);
    const urgent = await w.release({ type: "emergency", short_description: "رفع فوری خطای ورود" });
    const row = (await w.p.dev.client.post(`${w.P}/r/release/${urgent.id}/transition`, { to: "readiness", version: urgent.version })).row;
    expect(row.state).toBe("readiness");
  });
});

describe("release rules", () => {
  it("refuses a delivery date before the start and a cycle in the release train", async () => {
    await w.p.dev.client.post(`${w.P}/r/release`, { short_description: "تاریخ نادرست", type: "minor", planned_start: at(5), planned_end: at(2) }, 400);
    const parent = await w.release({ short_description: "قطار انتشار آبان" });
    const child = await w.release({ short_description: "انتشار فرزند", parent_release_id: parent.id });
    await w.p.dev.client.patch(`${w.P}/r/release/${parent.id}`, { parent_release_id: child.id, version: parent.version }, 400);
  });

  it("a release window's capacity is enforced", async () => {
    const win = (await w.o.post(`${w.P}/r/release_window`, { name: "پنجرهٔ آزمایشی تک‌ظرفیتی", kind: "slot", capacity: 1, start_at: at(3, 18), end_at: at(3, 21) })).row;
    await w.release({ window_id: win.id });
    await w.p.dev.client.post(`${w.P}/r/release`, { short_description: "انتشار دوم", type: "minor", window_id: win.id }, 409);
  });
});
