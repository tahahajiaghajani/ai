// Which rows the purge derives from demo rows (src/server/modules/demo/purge.ts derivedConds).
// On GitHub's fast runner the CMDB's own scheduled checks ran while the demo pack was loaded and raised 78 findings about
// demo CIs, outside the demo scope; the purge left them (and the predictions and history about them) behind, because a
// finding is a numbered record and only non-numbered rows were derived through their required references. A record the
// platform raised by itself that cannot exist without the demo row it names is about demo data and goes with it; a
// record a real person made or changed never does (its reference is reported).
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
  it("a CMDB finding the system raised about a demo CI is derived; one a real person made or changed is not", () => {
    const finding = TABLES.get("cmdb_finding");
    expect(finding?.numbered, "cmdb_finding is a numbered record").toBeTruthy();
    expect(finding?.fields.find((f) => f.name === "ci_id")?.required).toBe(true);
    const conds = derivedConds(info("cmdb_finding", ["id", "org_id", "ci_id", "created_by", "updated_by"]));
    const viaCi = conds.filter((c) => c.includes(`x."ci_id"`));
    expect(viaCi, "derived through ci_id").toHaveLength(1);
    // only when the platform made it and no real person changed it
    expect(viaCi[0]).toContain("x.created_by is null");
    expect(viaCi[0]).toMatch(/x\.updated_by is null or exists \(select 1 from sm_demo_rows d where d\.org_id = \$1 and d\.row_id = x\.updated_by\)/);
  });

  it("an optional reference of a numbered record never derives it (a real incident naming a demo CI stays)", () => {
    const def = TABLES.get("incident");
    const optional = def?.fields.find((f) => f.type === "ref" && !f.required && !f.base);
    expect(optional, "the incident has an optional reference").toBeTruthy();
    const conds = derivedConds(info("incident", ["id", "org_id", optional!.name, "created_by", "updated_by"]));
    expect(conds.some((c) => c.includes(`x."${optional!.name}"`))).toBe(false);
  });
});
