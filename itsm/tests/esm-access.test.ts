// Enterprise service management — the department content pack and the secure HR workspace (ESM-001/002/003/011/020):
// HR cases are invisible to IT agents, IT administrators and auditors on every path — records, lists, search,
// aggregates, analytics, notifications, the assistant's tools, retrieval and AI skills — while the employee reads
// their own case and HR's group works it; masked titles; watchers of secure departments; ER notes for named
// specialists only.
import "./fixtures/rag";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { esmWorld, type EsmWorld } from "./esm-helpers";
import { memberCtx } from "@server/access";
import { recordTools, type ToolEntry } from "@server/modules/ai/tools";
import type { ToolRuntime } from "@server/modules/ai/tools/registry";
import { retrieve } from "@server/modules/ai/rag";
import type { Ctx } from "@server/context";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

const rt: ToolRuntime = { today: "2026-11-09", dataPolicy: "full", putData: async () => "ref_test_1" };
async function runTool(ctx: Ctx, entries: ToolEntry[], name: string, input: unknown) {
  const e = entries.find((x) => x.name === name);
  if (!e) return null;
  const t = e.build();
  return t.run(ctx, t.input.parse(input), rt);
}

// each test drives a whole organisation and drains its jobs; the full suite runs many such files side by side
vi.setConfig({ testTimeout: 180_000 });

describe("esm: the content pack", () => {
  let w: EsmWorld;
  beforeAll(async () => {
    w = await esmWorld();
  }, 240_000);

  it("seeds four department workspaces (HR and legal secure), their groups, departments, services and catalogues", async () => {
    const ws = (await w.o.get(`${w.P}/r/workspace?size=50`)).rows as Record<string, any>[];
    const byKey = Object.fromEntries(ws.map((x) => [x.key, x]));
    expect(byKey.hr.name).toBe("منابع انسانی");
    expect(byKey.hr.secure).toBe(true);
    expect(byKey.legal.secure).toBe(true);
    expect(byKey.facilities.secure).toBe(false);
    expect(byKey.finance.name).toBe("مالی");
    expect(Object.keys(w.dept).sort()).toEqual(["facilities", "finance", "hr", "legal"]);
    expect(w.dept.hr.status).toBe("live");
    expect(w.dept.hr.dept_workspace_id).toBe(byKey.hr.id);
    for (const code of ["hr_leave", "hr_mission", "hr_payslip", "hr_certificate", "hr_loan", "fac_maintenance", "proc_purchase", "fin_expense", "legal_contract"]) {
      expect(w.svc[code], code).toBeTruthy();
      expect(w.svc[code].catalog_item_id, code).toBeTruthy();
    }
    const items = (await w.o.get(`${w.P}/r/catalog_item?size=200&filter=${encodeURIComponent(JSON.stringify({ f: "code", op: "starts", v: "esm_" }))}`)).rows as Record<string, any>[];
    expect(items.length).toBeGreaterThanOrEqual(15);
    expect(items.every((i) => i.state === "published")).toBe(true);
    const tpl = (await w.o.get(`${w.P}/r/journey_template?size=10`)).rows as Record<string, any>[];
    expect(tpl.map((t) => t.code).sort()).toEqual(["offboarding_standard", "onboarding_standard"]);
    const slas = (await w.o.get(`${w.P}/r/sla_definition?size=100&filter=${encodeURIComponent(JSON.stringify({ f: "table_key", op: "in", v: ["hr_case", "facility_request", "finance_case", "legal_request", "purchase_request"] }))}`)).rows;
    // the owner sees the non-secure departments' agreements; HR's and legal's live in their secure workspaces
    expect(slas.length).toBeGreaterThanOrEqual(6);
    const rules = (await w.o.get(`${w.P}/r/approval_rule?size=50&filter=${encodeURIComponent(JSON.stringify({ f: "table_key", op: "eq", v: "purchase_request" }))}`)).rows;
    expect(rules).toHaveLength(3);
  });

  it("is idempotent", async () => {
    const again = await w.o.post(`${w.P}/esm/seed`, {});
    expect(again.skipped).toBe(true);
    const forced = await w.o.post(`${w.P}/esm/seed`, { force: true });
    expect(Object.values(forced.created as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("esm: HR cases stay inside the secure HR workspace", () => {
  let w: EsmWorld;
  let caseId: string;
  let number: string;
  beforeAll(async () => {
    process.env.ITSM_AI_FAKE = "1";
    w = await esmWorld();
    const made = await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "کسر بیمه در فیش مهر SECRET-PAYSLIP-TOKEN", description: "در فیش مهر مبلغ بیمه دو بار کسر شده است SECRET-PAYSLIP-TOKEN", dept_service_id: w.svc.hr_payslip.id });
    caseId = made.row.id;
    number = made.row.number;
    await w.drain();
  }, 240_000);

  it("stamps the department, its workspace and the routing group; masks the title of a sensitive service", async () => {
    const row = await w.get("hr_case", caseId, w.p.emp.client);
    expect(row.department_id).toBe(w.dept.hr.id);
    expect(row.sensitive).toBe(true);
    const asHr = await w.get("hr_case", caseId, w.p.hr.client);
    expect(asHr.workspace_id).toBe(w.ws.hr);
    expect(asHr.assignment_group_id).toBe(w.g["حقوق و دستمزد"]);
    expect(asHr.title).toBe("پروندهٔ محرمانه");
    const list = await w.p.emp.client.get(`${w.P}/r/hr_case?fields=number,title`);
    expect(list.display[caseId] ?? `${number} — پروندهٔ محرمانه`).not.toContain("SECRET-PAYSLIP-TOKEN");
  });

  it("is read by the employee and the HR group, never by IT, the IT administrator or the auditor", async () => {
    await w.get("hr_case", caseId, w.p.emp.client);
    await w.get("hr_case", caseId, w.p.hr.client);
    for (const who of ["it", "admin", "auditor", "fac", "mgr"] as const) {
      await w.get("hr_case", caseId, w.p[who].client, 404);
      const list = await w.p[who].client.get(`${w.P}/r/hr_case?q=SECRET-PAYSLIP-TOKEN`);
      expect(list.rows, who).toHaveLength(0);
      const all = await w.p[who].client.get(`${w.P}/r/hr_case`);
      expect(all.rows.map((r: { id: string }) => r.id), who).not.toContain(caseId);
    }
    // the owner (tenant administrator) is no member of the secure workspace either
    await w.get("hr_case", caseId, w.o, 404);
  });

  it("counts nothing for them in aggregates and reports", async () => {
    for (const who of ["it", "admin", "auditor"] as const) {
      const agg = await w.p[who].client.post(`${w.P}/r/hr_case/agg`, { metrics: [{ fn: "count" }] });
      expect(Number(agg.totals?.count ?? 0), who).toBe(0);
      const run = await w.p[who].client.post(`${w.P}/analytics/run`, { spec: { v: 1, table: "hr_case", measures: [{ fn: "count" }], dims: [], viz: "score" } });
      expect(JSON.stringify(run), who).not.toContain(caseId);
      expect(Number(run.totals?.m0 ?? 0), who).toBe(0);
    }
    const mine = await w.p.hr.client.post(`${w.P}/analytics/run`, { spec: { v: 1, table: "hr_case", measures: [{ fn: "count" }], dims: [], viz: "score" } });
    expect(Number(mine.totals.m0)).toBe(1);
    const hr = await w.p.hr.client.post(`${w.P}/r/hr_case/agg`, { metrics: [{ fn: "count" }] });
    expect(Number(hr.totals.count)).toBe(1);
  });

  it("never reaches an IT agent through the assistant's tools or retrieval", async () => {
    const it = await memberCtx(w.e.cfg, w.e.org, w.p.it.userId);
    const tools = await recordTools(it, { proposals: true });
    const found = await runTool(it, tools, "search_hr_case", { limit: 10 });
    expect(JSON.stringify(found ?? "")).not.toContain("SECRET-PAYSLIP-TOKEN");
    const got = await runTool(it, tools, "get_hr_case", { number }).catch((e: Error) => e.message);
    expect(JSON.stringify(got ?? "")).not.toContain("SECRET-PAYSLIP-TOKEN");
    const r = await retrieve(it, "SECRET-PAYSLIP-TOKEN بیمه فیش", { k: 10 });
    expect(r.passages.some((p) => p.citation.id === caseId)).toBe(false);
    const hr = await memberCtx(w.e.cfg, w.e.org, w.p.hr.userId);
    const mine = await retrieve(hr, "SECRET-PAYSLIP-TOKEN بیمه فیش", { k: 10 });
    expect(mine.passages.some((p) => p.citation.id === caseId)).toBe(true);
  });

  it("refuses the HR case summary skill to IT and answers HR without sensitive fields", async () => {
    const status = await w.p.it.client.post(`${w.P}/ai/skills/esm.hr_case_summary/run`, { table: "hr_case", id: caseId }, 404).then(() => 404).catch((e: Error) => Number(/→ (\d+)/.exec(e.message)?.[1]));
    expect([403, 404]).toContain(status);
    await w.p.hr.client.patch(`${w.P}/r/hr_case/${caseId}`, { sensitive_notes: "MEDICAL-SECRET-TOKEN" });
    const out = await w.p.hr.client.post(`${w.P}/ai/skills/esm.hr_case_summary/run`, { table: "hr_case", id: caseId });
    expect(String(out.text ?? out.output ?? JSON.stringify(out))).not.toContain("MEDICAL-SECRET-TOKEN");
  });

  it("lets only members of the department follow a case of a secure department", async () => {
    const row = await w.get("hr_case", caseId, w.p.hr.client);
    await w.p.hr.client.patch(`${w.P}/r/hr_case/${caseId}`, { watch_list: [w.p.it.userId], version: row.version }, 403);
    const fresh = await w.get("hr_case", caseId, w.p.hr.client);
    await w.p.hr.client.patch(`${w.P}/r/hr_case/${caseId}`, { watch_list: [w.p.hrdesk.userId], version: fresh.version });
  });

  it("sends IT nothing about it", async () => {
    await w.p.hr.client.post(`${w.P}/r/hr_case/${caseId}/journal`, { kind: "comment", body: "فیش اصلاح‌شده پیوست شد" });
    await w.drain();
    for (const who of ["it", "admin", "auditor"] as const) {
      const inbox = await w.p[who].client.get(`${w.P}/r/notification?size=100`);
      expect(JSON.stringify(inbox.rows), who).not.toContain(caseId);
    }
  });

  it("refuses to move a case out of its department by editing the workspace", async () => {
    const row = await w.get("hr_case", caseId, w.p.hr.client);
    await w.p.hr.client.patch(`${w.P}/r/hr_case/${caseId}`, { workspace_id: w.ws.finance, version: row.version }, 403);
  });

  it("keeps employee-relations notes for the author and the named specialists", async () => {
    const er = await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: "گزارش رفتار نامناسب", dept_service_id: w.svc.hr_complaint.id });
    await w.drain();
    const asEr = await w.get("hr_case", er.row.id, w.p.er.client);
    expect(asEr.assignment_group_id).toBe(w.g["روابط کار و رسیدگی"]);
    expect(asEr.confidential).toBe(true);
    // the restricted ER group: HR agents of other groups do not read it
    await w.get("hr_case", er.row.id, w.p.hr.client, 404);
    const note = await w.p.er.client.post(`${w.P}/r/hr_case_note`, { hr_case_id: er.row.id, note_type: "finding", body: "یافته: ER-NOTE-TOKEN" });
    await w.get("hr_case_note", note.row.id, w.p.er.client);
    await w.get("hr_case_note", note.row.id, w.p.hr.client, 404);
    await w.get("hr_case_note", note.row.id, w.p.emp.client, 404);
    // not a writer of the case: no note
    await w.p.hrdesk.client.post(`${w.P}/r/hr_case_note`, { hr_case_id: er.row.id, note_type: "finding", body: "x" }, 403);
  });
});
