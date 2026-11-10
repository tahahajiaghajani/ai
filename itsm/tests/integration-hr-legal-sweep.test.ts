// The secure HR and legal workspaces after the ESM merge (like the SOC's sweep in integration-secure-sweep): a sensitive
// HR case, an employee-relations case with its specialist's note and a privileged legal request stay invisible outside
// their workspace through every surface — lists, search and aggregates, the portal (home, «درخواست‌های من», ticket
// pages, search and its answer), the virtual agent, the generated record tools of the assistant and of an agent's
// principal, «پرسش تحلیلی», analytics, insights, notifications, RAG, the Windows app's pull, the access matrix explorer
// (it explains, never reveals) and the REST API with its OpenAPI. And the AI gap the ESM branch reported: people who
// may read them cannot send them to a model — `ESM_DATA_USE` (legal requests and ER notes «هرگز», HR cases «فقط محلی»)
// holds for the assistant's generated tools, and a privileged legal request stays closed to the tools record by record
// even where an AI administrator relaxes the table's policy.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { memberCtx } from "@server/access";
import type { Ctx } from "@server/context";
import { askWithCitations, retrieve } from "@server/modules/ai/rag";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { vaStart } from "@server/modules/ai/va";
import { toolCatalog } from "@server/modules/ai/tools";
import type { ToolRuntime } from "@server/modules/ai/tools/registry";
import { principalCtx } from "@server/modules/ai/skills/principal";
import { askReport } from "@server/modules/ai/nlreport";
import { assertToolData, invalidateDataUse, tablePolicies } from "@server/modules/ai/datause";
import { runReport } from "@server/modules/analytics/query";
import { resetRateLimits } from "@server/http/ratelimit";
import type { AiStreamEvent } from "@shared/ai/types";
import { ESM_DATA_USE } from "@shared/tables/esm";
import { esmWorld, memberAt, type EsmWorld } from "./esm-helpers";
import { Client } from "./helpers";

vi.setConfig({ testTimeout: 240_000 });

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

// a title word and canaries only the records' bodies, notes and fields carry
const TOKEN = "hrlCanaryT1";
const BODY = "hrlBodyB2";
const NOTE = "hrlNoteN3";
const LEGAL = "hrlLegalL4";
const rt: ToolRuntime = { today: "2026-11-10", dataPolicy: "full", putData: async () => "ref_test_1" };

let w: EsmWorld;
let counsel: { client: Client; userId: string };
let hrCase: Record<string, any>;
let erCase: Record<string, any>;
let erNote: Record<string, any>;
let legal: Record<string, any>;
let openLegal: Record<string, any>;
const outsiders = ["it", "admin", "auditor", "fac", "mgr"] as const;
const ctxOf = (userId: string): Promise<Ctx> => memberCtx(w.e.cfg, w.e.org, userId);
const ids = () => [hrCase.id, erCase.id, erNote.id, legal.id, hrCase.number, legal.number];
/** None of the canaries, numbers or ids appears in `x`. */
const clean = (x: unknown, opts: { token?: boolean } = {}) => {
  const s = JSON.stringify(x ?? null);
  for (const c of [BODY, NOTE, LEGAL, ...ids(), ...(opts.token === false ? [] : [TOKEN])]) expect(s).not.toContain(c);
};
const inboxClean = () => expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toMatch(new RegExp(`${BODY}|${NOTE}|${LEGAL}`));

function parseSse(text: string): AiStreamEvent[] {
  return text
    .split("\n\n")
    .map((frame) => frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n"))
    .filter(Boolean)
    .map((d) => JSON.parse(d) as AiStreamEvent);
}
async function chat(c: Client, text: string): Promise<AiStreamEvent[]> {
  const res = await w.e.app.fetch(new Request(`http://local.test/api${w.P}/ai/chat`, { method: "POST", headers: { "content-type": "application/json", cookie: c.cookie }, body: JSON.stringify({ text }) }));
  return parseSse(await res.text());
}

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  resetRateLimits();
  w = await esmWorld();
  await w.o.post(`${w.P}/portal/seed`, {});
  await w.o.post(`${w.P}/analytics/seed`, { force: true });
  await w.o.post(`${w.P}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
  // the legal counsel: a member of the legal department's group (its role and the secure workspace come with it)
  counsel = await memberAt(w.e, "counsel.sweep@example.com", "10.97.0.1");
  const groups = (await w.o.get(`${w.P}/r/group?size=200`)).rows as { id: string; name: string }[];
  await w.o.post(`${w.P}/access/groups/${groups.find((g) => g.name === "امور حقوقی")!.id}/members`, { user_ids: [counsel.userId] });
  hrCase = (await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: `کسر بیمه ${TOKEN}`, description: `شرح ${BODY}`, dept_service_id: w.svc.hr_payslip.id })).row;
  erCase = (await w.p.emp.client.post(`${w.P}/r/hr_case`, { short_description: `رفتار نامناسب ${TOKEN}`, description: `شرح ${BODY}`, dept_service_id: w.svc.hr_complaint.id })).row;
  await w.drain();
  erNote = (await w.p.er.client.post(`${w.P}/r/hr_case_note`, { hr_case_id: erCase.id, note_type: "finding", body: `یافته ${NOTE}` })).row;
  legal = (await w.p.emp.client.post(`${w.P}/r/legal_request`, { short_description: `قرارداد محرمانه ${TOKEN}`, description: `شرح ${LEGAL}`, counterparty: `طرف ${LEGAL}`, dept_service_id: w.svc.legal_contract.id })).row;
  await w.drain();
  // a legal request that is not attorney–client privileged (the per-record rule lets it through when the table may)
  const asCounsel = (await counsel.client.get(`${w.P}/r/legal_request/${legal.id}`)).row;
  expect(asCounsel.privileged).toBe(true);
  openLegal = (await counsel.client.post(`${w.P}/r/legal_request`, { short_description: "بررسی آیین‌نامهٔ عمومی", privileged: false, requested_for: w.p.emp.userId })).row;
  await w.p.hr.client.post(`${w.P}/r/hr_case/${hrCase.id}/journal`, { kind: "work_note", body: `یادداشت ${NOTE}` });
  await w.drain();
}, 300_000);

describe("the canaries inside their workspaces (they are real)", () => {
  it("HR, ER and legal work them", async () => {
    await w.get("hr_case", hrCase.id, w.p.hr.client);
    await w.get("hr_case_note", erNote.id, w.p.er.client);
    await w.get("legal_request", legal.id, counsel.client);
  });
});

describe("AI data use of HR and legal records (the ESM report's gap)", () => {
  it("ships the default policies: legal requests and ER notes never, HR cases local only", async () => {
    expect(ESM_DATA_USE).toMatchObject({ legal_request: "never", hr_case_note: "never", hr_case: "local" });
    const listed = (await w.o.get(`${w.P}/ai/governance/data-policies`)).tables as { table: string; use: string; explicit: boolean }[];
    expect(listed.find((r) => r.table === "legal_request")).toMatchObject({ use: "never", explicit: false });
    expect(listed.find((r) => r.table === "hr_case_note")).toMatchObject({ use: "never", explicit: false });
    expect(listed.find((r) => r.table === "hr_case")).toMatchObject({ use: "local", explicit: false });
    const c = await ctxOf(counsel.userId);
    await expect(assertToolData(c, ["legal_request"], "assistant", true)).rejects.toMatchObject({ code: "ai_policy" });
    await expect(assertToolData(c, ["hr_case"], "assistant", false)).rejects.toMatchObject({ code: "ai_policy" });
    await expect(assertToolData(c, ["hr_case"], "assistant", true)).resolves.toMatchObject({ use: "local" });
  });

  it("the assistant's generated tools never hand a legal request, an ER note or an HR case to a cloud model", async () => {
    for (const [who, tool] of [[counsel, "search_legal_request"], [counsel, "get_legal_request"], [w.p.er, "search_hr_case_note"], [w.p.hr, "search_hr_case"], [w.p.er, "history_hr_case"]] as const) {
      clearFakeInbox();
      const input = tool.startsWith("get_") || tool.startsWith("history_") ? { id: tool.endsWith("legal_request") ? legal.id : erCase.id } : {};
      const events = await chat(who.client, `[tool:${tool} ${JSON.stringify(input)}]`);
      expect(JSON.stringify(events), tool).not.toMatch(new RegExp(`${BODY}|${NOTE}|${LEGAL}`));
      inboxClean();
    }
    const log = await w.e.db.query<{ tables: string[] }>(`select tables from sm_ai_guard_log where org_id = $1 and kind = 'policy'`, [w.e.org]);
    const logged = new Set(log.flatMap((r) => r.tables ?? []));
    for (const t of ["legal_request", "hr_case_note", "hr_case"]) expect(logged.has(t), t).toBe(true);
  });

  it("a privileged legal request stays closed to the tools when the table's policy is relaxed", async () => {
    await w.o.put(`${w.P}/ai/governance/data-policies/legal_request`, { use: "cloud", pii: "inherit" });
    invalidateDataUse(w.e.org);
    try {
      const c = await ctxOf(counsel.userId);
      expect((await tablePolicies(c)).get("legal_request")?.use).toBe("cloud");
      const { generated } = await toolCatalog(c, { proposals: true });
      const search = generated.find((e) => e.name === "search_legal_request")!;
      const found = (await search.build().run(c, {}, rt)) as { data: { rows: { number?: string }[]; total: number } };
      expect(JSON.stringify(found)).not.toContain(legal.number);
      expect(JSON.stringify(found)).toContain(openLegal.number);
      const agg = (await generated.find((e) => e.name === "aggregate_legal_request")!.build().run(c, {}, rt)) as { data: any };
      expect(Number(agg.data?.totals?.count ?? 0)).toBe(1);
      const got = await generated.find((e) => e.name === "get_legal_request")!.build().run(c, { id: legal.id }, rt).then(() => null, (e: Error) => e.message);
      expect(got).toMatch(/بسته است/);
      // and through the assistant: nothing of it reaches the model
      clearFakeInbox();
      await chat(counsel.client, "[tool:search_legal_request {}]");
      inboxClean();
    } finally {
      await w.o.put(`${w.P}/ai/governance/data-policies/legal_request`, { use: "never", pii: "inherit" });
      invalidateDataUse(w.e.org);
    }
  });
});

describe("HR and legal records outside their workspaces", () => {
  it("lists, search and aggregates", async () => {
    for (const who of outsiders) {
      const c = w.p[who].client;
      for (const t of ["hr_case", "hr_case_note", "legal_request"]) {
        clean(await c.get(`${w.P}/r/${t}?q=${TOKEN}`).catch(() => null));
        clean(await c.get(`${w.P}/r/${t}?size=200`).catch(() => null));
        const agg = await c.post(`${w.P}/r/${t}/agg`, { metrics: [{ fn: "count" }] }).catch(() => ({ totals: { count: 0 } }));
        expect(Number(agg.totals?.count ?? 0), `${who} ${t}`).toBe(0);
      }
    }
    // the HR desk is in HR's workspace but not the legal one, nor the ER group's
    clean(await w.p.hrdesk.client.get(`${w.P}/r/legal_request?size=200`).catch(() => null), { token: false });
    await w.get("hr_case_note", erNote.id, w.p.hrdesk.client, 404);
  });

  it("the portal: home, items, ticket pages, search and its answer", async () => {
    for (const who of outsiders) {
      const c = w.p[who].client;
      clean(await c.get(`${w.P}/portal/home`));
      for (const tab of ["mine", "shared", "team"]) clean(await c.get(`${w.P}/portal/items?tab=${tab}&state=all`).catch(() => null));
      for (const [t, id] of [["hr_case", hrCase.id], ["legal_request", legal.id]]) {
        const r = await c.req("GET", `${w.P}/portal/tickets/${t}/${id}`, undefined, undefined as never).catch((e: Error) => e);
        expect(r instanceof Error && /→ (400|403|404)/.test(r.message), `${who} ${t}`).toBe(true);
      }
      clean((await c.get(`${w.P}/portal/search?q=${encodeURIComponent(TOKEN)}&log=0`)).hits);
      clearFakeInbox();
      const answer = await c.post(`${w.P}/portal/search/answer`, { q: `${TOKEN} چه شد؟` }).catch(() => null);
      clean(answer?.answer?.citations ?? []);
      inboxClean();
    }
    // the employee's own portal shows the HR case under its neutral title, never the summary of a sensitive one
    const mine = (await w.p.emp.client.get(`${w.P}/portal/items?tab=mine&state=all`)).items as { id: string; title: string }[];
    expect(mine.find((i) => i.id === hrCase.id)?.title).toBe("پروندهٔ محرمانه");
  });

  it("the virtual agent, in the portal and through a messenger", async () => {
    for (const who of ["it", "mgr"] as const) {
      const ctx = await ctxOf(w.p[who].userId);
      for (const channel of ["portal", "messenger"] as const) {
        clearFakeInbox();
        clean(await vaStart(ctx, { channel, text: "وضعیت درخواست‌های من چیست؟" }));
        clean(await vaStart(ctx, { channel, text: `دربارهٔ ${TOKEN} چه می‌دانی؟` }), { token: false });
        inboxClean();
      }
    }
  });

  it("the generated record tools: outsiders' and an AI agent's principal", async () => {
    await w.o.get(`${w.P}/ai/agents/admin`);
    await w.o.post(`${w.P}/ai/agents/admin`, { key: "hrl_probe", name: "عامل آزمون", from: "incident_triage" });
    await w.o.post(`${w.P}/ai/agents/admin/hrl_probe/principal`, { roles: ["agent", "hr_agent"] });
    const principal = await principalCtx(w.e.cfg, w.e.org, "hrl_probe");
    const ctxs = [...(await Promise.all(outsiders.map((who) => ctxOf(w.p[who].userId)))), await ctxOf(w.e.ownerId), ...(principal ? [principal] : [])];
    for (const ctx of ctxs) {
      const { generated } = await toolCatalog(ctx, { proposals: true });
      for (const table of ["hr_case", "hr_case_note", "legal_request"]) {
        const search = generated.find((e) => e.name === `search_${table}`);
        if (search) {
          clean(await search.build().run(ctx, {}, rt).catch(() => null));
          clean(await search.build().run(ctx, { text: TOKEN }, rt).catch(() => null));
        }
        const agg = generated.find((e) => e.name === `aggregate_${table}`);
        if (agg) {
          const r = (await agg.build().run(ctx, {}, rt).catch(() => ({ data: { totals: { count: 0 } } }))) as { data: any };
          expect(Number(r.data?.totals?.count ?? 0)).toBe(0);
        }
        const get = generated.find((e) => e.name === `get_${table}`);
        if (get) clean(await get.build().run(ctx, { id: table === "legal_request" ? legal.id : table === "hr_case_note" ? erNote.id : hrCase.id }, rt).catch(() => null), { token: false });
      }
    }
  });

  it("«پرسش تحلیلی» and analytics reports", async () => {
    for (const who of [...outsiders, "owner"] as const) {
      const ctx = await ctxOf(who === "owner" ? w.e.ownerId : w.p[who].userId);
      for (const table of ["hr_case", "legal_request"]) {
        const r = await runReport(ctx, { v: 1, table, measures: [{ fn: "count" }], dims: [{ field: "state" }], viz: "table" }).catch(() => null);
        if (r) expect(r.total_n, `${who} ${table}`).toBe(0);
      }
      clearFakeInbox();
      const ask = await askReport(ctx, "تعداد پرونده‌های منابع انسانی بر اساس وضعیت").catch(() => null);
      if (ask?.result) expect(Number(ask.result.total_n ?? 0)).toBe(0);
      clean(ask?.result ?? null);
      inboxClean();
    }
  });

  it("insights", async () => {
    for (const who of outsiders) {
      const ins = await w.p[who].client.get(`${w.P}/ai/insights?period=daily`).catch(() => null);
      if (ins) {
        expect((ins.insights as { table: string }[]).some((i) => ["hr_case", "hr_case_note", "legal_request"].includes(i.table)), who).toBe(false);
        clean(ins.insights);
      }
    }
  });

  it("notifications and the RAG index", async () => {
    const rows = await w.e.db.query<{ recipient_id: string; record_id: string | null; subject: string | null }>(`select recipient_id, record_id, subject from sm_notification_log where org_id = $1`, [w.e.org]);
    const outsiderIds = new Set([...outsiders.map((who) => w.p[who].userId), w.e.ownerId]);
    for (const r of rows.filter((x) => outsiderIds.has(x.recipient_id))) {
      expect([hrCase.id, erCase.id, legal.id]).not.toContain(r.record_id);
      for (const c of [TOKEN, BODY, NOTE, LEGAL]) expect(r.subject ?? "").not.toContain(c);
    }
    for (const who of outsiders) clean(await w.p[who].client.get(`${w.P}/notify/inbox`).catch(() => null));
    for (const userId of [...outsiders.map((who) => w.p[who].userId), w.e.ownerId]) {
      const ctx = await ctxOf(userId);
      const r = await retrieve(ctx, `${TOKEN} ${BODY}`, { k: 12 });
      clean(r.passages.map((p) => ({ text: p.text, citation: p.citation })));
      clearFakeInbox();
      const a = await askWithCitations(ctx, TOKEN, {}, { k: 6 }).catch(() => null);
      clean(a?.passages.map((p) => p.text) ?? []);
      inboxClean();
    }
    // insiders: neither the counsel's nor HR's cited answers carry a legal request or an HR case to the (cloud) model
    for (const id of [counsel.userId, w.p.hr.userId]) {
      clearFakeInbox();
      await askWithCitations(await ctxOf(id), `${TOKEN} کسر بیمه قرارداد محرمانه`, {}, { k: 6 }).catch(() => null);
      inboxClean();
    }
    const hrSees = await retrieve(await ctxOf(w.p.hr.userId), `${TOKEN} کسر بیمه`, { k: 12 });
    expect(hrSees.passages.some((p) => p.citation.id === hrCase.id)).toBe(true);
  });

  it("the Windows app's pull", async () => {
    for (const who of outsiders) {
      const page = await w.p[who].client.get(`/sync/pull?org_id=${w.e.org}&cursor=0&user_cursor=0`);
      clean(page);
    }
    // the employee's own pull never carries the ER note's text (noSync), nor the legal request's privileged fields to others
    const mine = await w.p.er.client.get(`/sync/pull?org_id=${w.e.org}&cursor=0&user_cursor=0`);
    expect(JSON.stringify(mine)).not.toContain(NOTE);
  });

  it("the access matrix explorer explains without revealing", async () => {
    // the IT administrator explains a member's access to the tables, never a record it cannot read itself
    const explained = await w.o.post(`${w.P}/admin/access/explain`, { user_id: w.p.it.userId, table: "hr_case" });
    clean(explained);
    for (const [t, id] of [["hr_case", hrCase.id], ["legal_request", legal.id], ["hr_case_note", erNote.id]]) {
      const r = await w.o.req("POST", `${w.P}/admin/access/explain`, { user_id: counsel.userId, table: t, record_id: id }, undefined as never).catch((e: Error) => e);
      expect(r instanceof Error && /→ (403|404)/.test(r.message), t).toBe(true);
      const who = await w.o.req("GET", `${w.P}/admin/access/who?table=${t}&id=${id}`, undefined, undefined as never).catch((e: Error) => e);
      expect(who instanceof Error && /→ (403|404)/.test(who.message), t).toBe(true);
    }
    clean(await w.o.get(`${w.P}/admin/access/matrix?user=${counsel.userId}`));
  });

  it("the REST API and its OpenAPI, as the integration user", async () => {
    const user = (await w.o.post(`${w.P}/r/integration_user`, { name: "سامانهٔ گزارش", rate_limit: 1000 })).row;
    await w.o.put(`${w.P}/integration/users/${user.id}/roles`, { roles: ["agent", "auditor"] });
    const { key } = await w.o.post(`${w.P}/integration/users/${user.id}/keys`, { name: "کلید خواندن", scopes: [{ table: "*", ops: ["read"] }] });
    const get = async (path: string) => {
      const res = await w.e.app.fetch(new Request(`http://local.test/api/v1${path}`, { headers: { authorization: `Bearer ${key}` } }));
      return { status: res.status, text: await res.text() };
    };
    for (const t of ["hr_case", "hr_case_note", "legal_request"]) {
      const r = await get(`/r/${t}?size=200`);
      expect([200, 403, 404]).toContain(r.status);
      clean(r.text);
      const one = await get(`/r/${t}/${t === "legal_request" ? legal.id : t === "hr_case_note" ? erNote.id : hrCase.id}`);
      expect([403, 404]).toContain(one.status);
      clean(one.text, { token: false });
    }
    const spec = await get("/openapi.json");
    expect(spec.status).toBe(200);
    clean(spec.text);
  });
});
