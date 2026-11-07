// The platform's provisional access model (src/shared/permissions.ts): six areas and four roles, the same on the
// server (ctx.need), in the sync registry and in the UI (nav items, can()). A later ITSM access model replaces it;
// until then these checks keep every place that names an area or a role consistent with it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AREAS, CORE_ROLES, LEVEL_ORDER, PRESET_ROLES, ROLES, can, levelOf, permissionMap, type Area, type Level, type Role } from "@shared/permissions";
import { AGGREGATES } from "@server/sync/registry";
import { NAV } from "../src/ui/modules/registry";

const ROOT = join(__dirname, "..");
const areas = Object.keys(AREAS) as Area[];
const roles = Object.keys(ROLES) as Role[];

function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.tsx?$/.test(f)) out.push(p);
  }
  return out;
}

describe("areas and roles", () => {
  it("has exactly the platform's areas and roles", () => {
    expect(areas).toEqual(["settings", "users", "integrations", "ai", "reports", "work"]);
    expect(roles.sort()).toEqual(["admin", "member", "owner", "viewer"]);
    expect([...CORE_ROLES]).toEqual(["owner", "member", "viewer"]);
    expect([...PRESET_ROLES]).toEqual(["admin"]);
    for (const r of roles) {
      expect(ROLES[r].title.length, r).toBeGreaterThan(1);
      expect(ROLES[r].about.length, r).toBeGreaterThan(5);
      for (const a of Object.keys(ROLES[r].levels)) expect(areas, `${r}.${a}`).toContain(a);
    }
  });

  it("gives each role the documented level in every area", () => {
    const matrix = Object.fromEntries(roles.map((r) => [r, permissionMap(r)]));
    expect(matrix).toEqual({
      owner: { settings: "full", users: "full", integrations: "full", ai: "full", reports: "full", work: "full" },
      admin: { settings: "full", users: "full", integrations: "full", ai: "full", reports: "full", work: "full" },
      member: { settings: "view", users: "view", integrations: "none", ai: "edit", reports: "view", work: "edit" },
      viewer: { settings: "view", users: "none", integrations: "none", ai: "view", reports: "view", work: "view" },
    });
  });

  it("orders levels and lets per-area overrides win in both directions", () => {
    expect(LEVEL_ORDER).toEqual(["none", "view", "edit", "full"]);
    expect(can("viewer", "reports", "view")).toBe(true);
    expect(can("viewer", "reports", "edit")).toBe(false);
    expect(can("viewer", "integrations", "view", { integrations: "edit" })).toBe(true);
    expect(levelOf("admin", "users", { users: "view" })).toBe("view");
    expect(levelOf("member", "ai", { ai: "none" })).toBe("none");
    // an unknown role reads as a viewer
    expect(permissionMap("ghost" as Role)).toEqual(permissionMap("viewer"));
  });
});

describe("every place that names an area uses a known one", () => {
  it("server: ctx.need / ctx.can / can() and the sync registry", () => {
    const used = new Set<string>();
    for (const f of files(join(ROOT, "src/server"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\b(?:need|can)\(\s*"([a-z_]+)"\s*,\s*"(none|view|edit|full)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(2);
    for (const a of used) expect(areas, a).toContain(a);
    for (const a of AGGREGATES) expect(areas, a.entity).toContain(a.area);
  });

  it("UI: nav items and can() calls", () => {
    for (const g of NAV) for (const i of g.items) if (i.area) expect(areas, i.key).toContain(i.area);
    const levels: Level[] = ["none", "view", "edit", "full"];
    for (const f of files(join(ROOT, "src/ui"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\bcan\(\s*"([a-z_]+)"\s*,\s*"([a-z]+)"/g)) {
        expect(areas, `${f}: ${m[1]}`).toContain(m[1]);
        expect(levels, `${f}: ${m[2]}`).toContain(m[2]);
      }
    }
  });
});
