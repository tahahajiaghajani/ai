// Which rows the purge derives from demo rows (src/server/modules/demo/purge.ts derivedConds).
// On GitHub's fast runner the CMDB's own scheduled checks ran while the demo pack was loaded and raised 78 findings about
// demo CIs, outside the demo scope; the purge left them (and the predictions and history about them) behind, because a
// finding is a numbered record and only non-numbered rows were derived through their required references.
// Release 1.1.5 (the owner's decision, docs/DEMO_FA.md): what was recorded on demo data goes with it, whoever made it —
// a row with a required reference, a parent the catalogue declares (`refs.ts` PARENTS: a workflow case of a demo
// process and its tasks, a holder in a pack unit, a pack library field attached to a real table) or a pack person as its
// requester or beneficiary — numbered or not. A real record that only points at demo data through an optional reference
// stays (the reference is cleared and the record routed again).
import { describe, it, expect } from "vitest";
import "./fixtures/module";
import { TABLES } from "@shared/tables";
import { derivedConds, type ColInfo, type TableInfo } from "@server/modules/demo/purge";

const col = (name: string, type = "uuid"): ColInfo => ({ name, type, nullable: true, hasDefault: false, generated: false });

function info(key: string, cols: string[]): TableInfo {
  const def = TABLES.get(key);
  if (!def) throw new Error(`no table ${key}`);
  return { name: `sm_${key}s`, cols: new Map(cols.map((c) => [c, col(c)])), def, arc: false, synced: true };
}

describe("the purge derives a platform-raised record from the demo row it cannot exist without", () => {
  it("a CMDB finding about a demo CI is derived, whoever made it (1.1.5: recorded on demo data, it goes with it)", () => {
    const finding = TABLES.get("cmdb_finding");
    expect(finding?.numbered, "cmdb_finding is a numbered record").toBeTruthy();
    expect(finding?.fields.find((f) => f.name === "ci_id")?.required).toBe(true);
    const conds = derivedConds(info("cmdb_finding", ["id", "org_id", "ci_id", "created_by", "updated_by"]));
    const viaCi = conds.filter((c) => c.includes(`x."ci_id"`));
    expect(viaCi, "derived through ci_id").toHaveLength(1);
    // (before 1.1.5 only when the platform made it and no real person changed it: a real person's finding stayed with a
    // dangling CI. The owner decided that what was recorded on demo data goes with it.)
    expect(viaCi[0]).not.toContain("created_by");
  });

  it("a real task on a demo incident, a real case of a demo workflow and its rows, a holder in a pack unit are derived", () => {
    const task = derivedConds(info("incident_task", ["id", "org_id", "incident_id", "caller_id", "assigned_to", "created_by", "updated_by"]));
    expect(task.some((c) => c.includes(`x."incident_id"`) && !c.includes("created_by"))).toBe(true);
    const kase = derivedConds(info("process_case", ["id", "org_id", "process_id", "version_id", "requested_by", "requested_for", "created_by", "updated_by"]));
    for (const col of ["process_id", "version_id", "requested_by", "requested_for"]) expect(kase.some((c) => c.includes(`x."${col}"`)), col).toBe(true);
    const ptask = derivedConds(info("process_task", ["id", "org_id", "case_id", "assigned_to", "created_by"]));
    expect(ptask.some((c) => c.includes(`x."case_id"`))).toBe(true);
    // the assignee of a task is routing, not its parent: a real task of a removed person ends (reroute), it is not derived
    expect(ptask.some((c) => c.includes(`x."assigned_to"`))).toBe(false);
    const sub = derivedConds({ ...info("process_submission", ["id", "org_id", "task_id", "process_id"]), cols: new Map([...info("process_submission", ["id", "org_id", "task_id", "process_id"]).cols, ["case_id", col("case_id", "text")]]) });
    expect(sub.some((c) => c.includes(`x."case_id"`))).toBe(true);
    const holder = derivedConds(info("position_holder", ["id", "org_id", "position_id", "user_id", "org_unit_id"]));
    expect(holder.some((c) => c.includes(`x."org_unit_id"`))).toBe(true);
    const attached = derivedConds(info("custom_field", ["id", "org_id", "library_id"]));
    expect(attached.some((c) => c.includes(`x."library_id"`))).toBe(true);
  });

  it("a real incident filed for a pack person is derived through its caller; one a pack person was only assigned is not", () => {
    const conds = derivedConds(info("incident", ["id", "org_id", "caller_id", "requested_for", "assigned_to", "opened_by", "created_by", "updated_by"]));
    expect(conds.some((c) => c.includes(`x."caller_id"`))).toBe(true);
    expect(conds.some((c) => c.includes(`x."requested_for"`))).toBe(true);
    expect(conds.some((c) => c.includes(`x."assigned_to"`))).toBe(false);
  });

  it("a work order the field service's schedule generated from a demo maintenance plan is derived; one a real person made or changed is not", () => {
    // a demo plan keeps generating while the pack is loaded: its next visit a quarter later is made by the sweep, outside
    // the demo scope, and names the plan only through an optional reference that the platform alone sets
    const plan = TABLES.get("work_order")?.fields.find((f) => f.name === "maintenance_plan_id");
    expect(plan?.type).toBe("ref");
    expect(plan?.required, "an optional reference").toBeFalsy();
    expect(plan?.readonly, "set by the platform only").toBe(true);
    const conds = derivedConds(info("work_order", ["id", "org_id", "maintenance_plan_id", "location_id", "entitlement_id", "created_by", "updated_by"]));
    const viaPlan = conds.filter((c) => c.includes(`x."maintenance_plan_id"`));
    expect(viaPlan, "derived through maintenance_plan_id").toHaveLength(1);
    expect(viaPlan[0]).toContain("x.created_by is null");
    expect(viaPlan[0]).toMatch(/x\.updated_by is null or exists \(select 1 from sm_demo_rows d where d\.org_id = \$1 and d\.row_id = x\.updated_by\)/);
    // its other optional references (the place of the visit, the customer's entitlement) never derive it
    for (const name of ["location_id", "entitlement_id"]) expect(conds.some((c) => c.includes(`x."${name}"`)), name).toBe(false);
  });

  it("an optional reference of a numbered record never derives it (a real incident naming a demo CI stays)", () => {
    const def = TABLES.get("incident");
    const optional = def?.fields.find((f) => f.type === "ref" && !f.required && !f.base);
    expect(optional, "the incident has an optional reference").toBeTruthy();
    const conds = derivedConds(info("incident", ["id", "org_id", optional!.name, "created_by", "updated_by"]));
    expect(conds.some((c) => c.includes(`x."${optional!.name}"`))).toBe(false);
  });
});
