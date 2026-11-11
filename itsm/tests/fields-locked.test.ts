// F1 — locked fields and creation paths (design F §3.3): which fields of a built-in table an organisation may never
// hide from the form or require, each with its reasons (system, record identity, access basis, transition
// requirement, module requirement, AI search basis, module lock); and who creates a table's records, so a tenant
// requirement names the paths it binds and «همه» is refused while the portal reports through its built-in form.
import { describe, it, expect } from "vitest";
import { buildTable, tableDef } from "@shared/tables";
import type { TableDef } from "@shared/model/types";
import { LOCK_REASONS, isLocked, lockRefusal, lockedFields } from "@shared/forms/locked";
import { COMMON_PATHS, REQUIRED_FOR_LABELS, isRequiredFor, pathsOf, requirementBlockers, requirementEffects } from "@shared/forms/paths";

const reasons = (def: TableDef, field: string) => (lockedFields(def)[field] ?? []).map((l) => l.label);

describe("locked fields of incident", () => {
  const incident = tableDef("incident")!;

  it("lock the record's identity, the system fields and the module's requirements, with every reason", () => {
    expect(reasons(incident, "short_description")).toEqual(["شناسهٔ رکورد", "الزامی در ماژول", "پایهٔ جست‌وجوی هوشمند"]);
    expect(reasons(incident, "state")).toEqual(["شناسهٔ رکورد"]);
    expect(reasons(incident, "number")).toEqual(["سامانه‌ای", "شناسهٔ رکورد"]);
    expect(reasons(incident, "opened_at")).toEqual(["سامانه‌ای"]);
    expect(reasons(incident, "workspace_id")).toEqual(["سامانه‌ای"]);
  });

  it("lock the access basis: own, requester, group and unit fields", () => {
    for (const f of ["caller_id", "requested_for", "assigned_to", "affected_users", "assignment_group_id"]) expect(reasons(incident, f), f).toContain("پایهٔ دسترسی");
    expect(reasons(incident, "unit_id")).toEqual(["سامانه‌ای", "پایهٔ دسترسی"]);
  });

  it("lock what a transition requires and what AI search reads", () => {
    expect(reasons(incident, "hold_reason")).toEqual(["لازم برای تغییر وضعیت"]);
    expect(reasons(incident, "close_code")).toEqual(["لازم برای تغییر وضعیت"]);
    expect(reasons(incident, "close_notes")).toEqual(["لازم برای تغییر وضعیت", "پایهٔ جست‌وجوی هوشمند"]);
    expect(reasons(incident, "workaround")).toEqual(["پایهٔ جست‌وجوی هوشمند"]);
  });

  it("leave «اثر» and the other ordinary fields free to hide or require", () => {
    expect(incident.fields.find((f) => f.name === "impact")?.label).toBe("اثر");
    for (const f of ["impact", "urgency", "category", "location_id", "ci_id"]) expect(isLocked(incident, f), f).toBe(false);
    expect(lockRefusal(incident, "impact", "hide")).toBeNull();
    expect(lockRefusal(incident, "impact", "require")).toBeNull();
  });

  it("refuse hiding or requiring a locked field, naming its reasons", () => {
    expect(lockRefusal(incident, "close_notes", "hide")).toBe("«یادداشت حل» را نمی‌توانید از فرم پنهان کنید؛ این فیلد قفل است: لازم برای تغییر وضعیت، پایهٔ جست‌وجوی هوشمند");
    expect(lockRefusal(incident, "assigned_to", "require")).toBe("«کارشناس» را نمی‌توانید الزامی کنید؛ این فیلد قفل است: پایهٔ دسترسی");
  });
});

describe("locked fields of any table", () => {
  const def = buildTable({
    key: "f1_locks",
    table: "sm_f1_locks",
    label: "آزمون",
    plural: "آزمون‌ها",
    icon: "x",
    module: "test",
    area: "work",
    display: "title",
    fields: [
      { name: "title", label: "عنوان", type: "string" },
      { name: "parent_id", label: "والد", type: "ref", ref: "f1_parent" },
      { name: "readers", label: "خوانندگان", type: "users" },
      { name: "risk_code", label: "کد ریسک", type: "string", locked: true },
      { name: "note", label: "یادداشت", type: "text" },
    ],
    scope: { readers: ["readers"], parent: "parent_id" },
  });

  it("lock the readers and the parent of the access model, and what a module marks locked", () => {
    expect(reasons(def, "readers")).toEqual(["پایهٔ دسترسی"]);
    expect(reasons(def, "parent_id")).toEqual(["پایهٔ دسترسی"]);
    expect(reasons(def, "risk_code")).toEqual(["قفل‌شده در ماژول"]);
    expect(reasons(def, "title")).toEqual(["شناسهٔ رکورد"]);
    expect(isLocked(def, "note")).toBe(false);
  });

  it("never lock an organisation's own fields, even on an effective definition", () => {
    const effective: TableDef = { ...def, fields: [...def.fields, { name: "u_branch", label: "شعبه", type: "ref", ref: "org_unit", custom: true, required: true, locked: true }] };
    expect(isLocked(effective, "u_branch")).toBe(false);
    expect(lockRefusal(effective, "u_branch", "require")).toBeNull();
  });

  it("give every reason a chip", () => {
    expect(Object.values(LOCK_REASONS)).toEqual(["سامانه‌ای", "شناسهٔ رکورد", "پایهٔ دسترسی", "لازم برای تغییر وضعیت", "الزامی در ماژول", "پایهٔ جست‌وجوی هوشمند", "قفل‌شده در ماژول"]);
  });
});

describe("creation paths", () => {
  it("list who creates incidents: people on the record page, the portal, the virtual agent and the API; the system by e-mail and events", () => {
    const paths = pathsOf("incident");
    const by = Object.fromEntries(paths.map((p) => [p.key, p.writer]));
    expect(by).toMatchObject({ record: "person", portal_report: "requester", virtual_agent: "requester", api: "person", import: "person", windows: "person", interaction: "agent", email: "system", event: "system", flows: "system" });
    expect(paths.find((p) => p.key === "portal_report")).toMatchObject({ fixedForm: true, formSetting: "portal_report_item" });
  });

  it("give every table the common paths, and e-mail where a mailbox creates its records", () => {
    expect(pathsOf("ci").map((p) => p.key)).toEqual(COMMON_PATHS.map((p) => p.key));
    expect(pathsOf("ci", { emailTarget: true }).map((p) => p.key)).toContain("email");
    expect(pathsOf("todo").filter((p) => p.key === "email")).toHaveLength(1);
    expect(pathsOf("request_item").find((p) => p.key === "catalog")?.writer).toBe("system");
  });

  it("say which paths a requirement binds: never the system's, requesters' only for «همه»", () => {
    const all = Object.fromEntries(requirementEffects("incident", "all").map((e) => [e.path.key, e]));
    expect(all.email).toMatchObject({ checked: false, text: "ثبت خودکار سامانه: بررسی نمی‌شود" });
    expect(all.event.checked).toBe(false);
    expect(all.portal_report.checked).toBe(true);
    expect(all.record.checked).toBe(true);
    const agents = Object.fromEntries(requirementEffects("incident", "agents").map((e) => [e.path.key, e]));
    expect(agents.portal_report).toMatchObject({ checked: false, text: "درخواست‌دهندگان: بررسی نمی‌شود" });
    expect(agents.virtual_agent.checked).toBe(false);
    expect(agents.record).toMatchObject({ checked: true, text: "فقط ثبت کارشناسان بررسی می‌شود" });
    expect(agents.interaction).toMatchObject({ checked: true, text: "بررسی می‌شود" });
    expect(agents.email.checked).toBe(false);
  });

  it("refuse «همه» on incident while the portal reports through its built-in form, naming both ways out", () => {
    const [why, ...rest] = requirementBlockers("incident", "all");
    expect(rest).toEqual([]);
    expect(why).toContain("درگاه: «گزارش مشکل»");
    expect(why).toContain("در تنظیمات درگاه فرمی از کاتالوگ");
    expect(why).toContain("«فقط کارشناسان»");
    expect(requirementBlockers("incident", "all", { portalReportItem: true })).toEqual([]);
    expect(requirementBlockers("incident", "agents")).toEqual([]);
    expect(requirementBlockers("todo", "all")).toEqual([]);
  });

  it("name the two kinds of requirement", () => {
    expect(REQUIRED_FOR_LABELS).toEqual({ all: "همه", agents: "فقط کارشناسان" });
    expect(isRequiredFor("agents")).toBe(true);
    expect(isRequiredFor("requesters")).toBe(false);
  });
});
