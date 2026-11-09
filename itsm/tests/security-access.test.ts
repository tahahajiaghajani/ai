// Security incidents and their journals are invisible without the security area and outside the secure workspace:
// lists, records, journals, search (the palette's per-table search), reports (aggregates), notifications, the AI index
// (retrieve, askWithCitations) and the AI skills — for a requester who reported the incident, a service-desk agent, a
// security analyst outside the SOC, an auditor and the tenant administrator (owner). The SOC reads them; records
// classified «سری» never reach a model, not even the SOC's. The module's routes repeat the checks (SOC page, dashboard,
// review tools), and the caller verification and PII tools follow the record's own access.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { secWorld, type SecWorld } from "./security-helpers";
import type { Ctx } from "@server/context";
import { memberCtx, readableIds } from "@server/access";
import { askWithCitations, retrieve } from "@server/modules/ai/rag";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { runSkill } from "@server/modules/ai/skills";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

let w: SecWorld;
let sir: Record<string, any>;
let secret: Record<string, any>;
const TOKEN = "sirleakZ7";
const SECRET = "sirsecretZ8";

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  w = await secWorld();
  await w.o.post(`${w.P}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
  // the requester reported it and watches it; it is high severity (notifications) and carries a canary
  sir = await w.sir({ short_description: `نفوذ به سرور پرداخت ${TOKEN}`, description: `شرح محرمانه ${TOKEN}`, lessons: `درس ${TOKEN}`, caller_id: w.p.req.userId, watch_list: [w.p.req.userId, w.p.agent.userId], severity: "1" });
  secret = await w.sir({ short_description: `پروندهٔ سری ${SECRET}`, lessons: `درس ${SECRET}`, classification: "restricted" });
  await w.p.soc.client.post(`${w.P}/r/sec_incident/${sir.id}/journal`, { kind: "comment", body: `پاسخ عمومی ${TOKEN}` });
  await w.p.soc.client.post(`${w.P}/r/sec_incident/${sir.id}/journal`, { kind: "work_note", body: `یادداشت داخلی ${TOKEN}` });
  await w.p.soc.client.post(`${w.P}/r/sec_incident/${sir.id}/transition`, { to: "analysis", version: (await w.p.soc.client.get(`${w.P}/r/sec_incident/${sir.id}`)).row.version });
  await w.drain();
}, 240_000);

const outsiders = ["req", "agent", "analyst", "auditor", "vm", "grc"] as const;

describe("security incidents stay inside the SOC", () => {
  it("are listed, opened and searched by the SOC", async () => {
    const list = (await w.p.soc.client.get(`${w.P}/r/sec_incident?q=${TOKEN}`)).rows as any[];
    expect(list.map((r) => r.id)).toContain(sir.id);
    const journal = (await w.p.soc2.client.get(`${w.P}/r/sec_incident/${sir.id}/journal`)).entries as any[];
    expect(journal.some((j) => j.body.includes("یادداشت داخلی"))).toBe(true);
    const ciso = (await w.p.ciso.client.get(`${w.P}/r/sec_incident/${sir.id}`)).row;
    expect(ciso.affected_data === undefined || ciso.affected_data === null).toBe(true);
  });

  for (const who of outsiders) {
    it(`${who}: no list, record, journal, search hit or report count`, async () => {
      const c = w.p[who].client;
      const listed = await c.req("GET", `${w.P}/r/sec_incident?q=${TOKEN}`, undefined, undefined as never).catch((e: Error) => e);
      if (listed instanceof Error) expect(listed.message).toMatch(/→ 403/);
      else expect((listed as any).rows.length).toBe(0);
      await c.get(`${w.P}/r/sec_incident/${sir.id}`, 404);
      const j = await c.req("GET", `${w.P}/r/sec_incident/${sir.id}/journal`, undefined, undefined as never).catch((e: Error) => e);
      expect(j instanceof Error && /→ (403|404)/.test(j.message)).toBe(true);
      const agg = await c.req("POST", `${w.P}/r/sec_incident/agg`, { groupBy: ["severity"], metrics: [{ fn: "count" }] }, undefined as never).catch((e: Error) => e);
      if (!(agg instanceof Error)) expect(Number((agg as any).totals?.count ?? 0)).toBe(0);
      const tasks = await c.req("GET", `${w.P}/r/sec_task?size=5`, undefined, undefined as never).catch((e: Error) => e);
      if (!(tasks instanceof Error)) expect((tasks as any).rows.length).toBe(0);
    });
  }

  it("the tenant administrator (owner) is outside the secure workspace too", async () => {
    const rows = (await w.o.get(`${w.P}/r/sec_incident?size=50`)).rows as any[];
    expect(rows.length).toBe(0);
    await w.o.get(`${w.P}/r/sec_incident/${sir.id}`, 404);
    const agg = await w.o.post(`${w.P}/r/sec_incident/agg`, { groupBy: ["severity"], metrics: [{ fn: "count" }] });
    expect(Number(agg.totals?.count ?? 0)).toBe(0);
  });

  it("sends no notification about it to people who may not read it (the reporter and a watcher)", async () => {
    const rows = await w.e.db.query<{ recipient_id: string; status: string }>(`select recipient_id, status from sm_notification_log where org_id = $1 and record_id = $2 and status in ('sent', 'queued', 'held', 'delivered')`, [w.e.org, sir.id]);
    const got = new Set(rows.map((r) => r.recipient_id));
    expect(got.has(w.p.req.userId)).toBe(false);
    expect(got.has(w.p.agent.userId)).toBe(false);
    const inbox = await w.p.req.client.get(`${w.P}/notify/inbox`);
    expect(JSON.stringify(inbox)).not.toContain(TOKEN);
    expect(JSON.stringify(inbox)).not.toContain(sir.number);
  });
});

describe("the AI index and the skills", () => {
  const ctxOf = (who: keyof SecWorld["p"]): Promise<Ctx> => memberCtx(w.e.cfg, w.e.org, w.p[who].userId);

  it("retrieval and cited answers never return the incident to outsiders; the SOC finds it", async () => {
    for (const who of [...outsiders, "soc"] as const) {
      const ctx = await ctxOf(who);
      const r = await retrieve(ctx, TOKEN, { k: 12 });
      const text = r.passages.map((p) => `${p.text} ${p.citation.title}`).join("\n");
      const a = await askWithCitations(ctx, TOKEN, {}, { k: 6 });
      const all = `${text}\n${a.answer}\n${a.passages.map((p) => p.text).join("\n")}`;
      if (who === "soc") expect(text).toContain(TOKEN);
      else expect(all).not.toContain(TOKEN);
      for (const p of r.passages) expect((await readableIds(ctx, p.citation.table, [p.citation.id])).has(p.citation.id)).toBe(true);
    }
    const owner = await memberCtx(w.e.cfg, w.e.org, w.e.ownerId);
    expect((await retrieve(owner, TOKEN, { k: 12 })).passages.map((p) => p.text).join("")).not.toContain(TOKEN);
  });

  it("records classified «سری» are never retrieved or summarised, not even for the SOC", async () => {
    const soc = await ctxOf("soc");
    const r = await retrieve(soc, SECRET, { k: 12 });
    expect(r.passages.map((p) => p.text).join("")).not.toContain(SECRET);
    clearFakeInbox();
    await expect(runSkill(soc, "security.incident_summary", { table: "sec_incident", id: secret.id })).rejects.toThrow(/بسته/);
    expect(FAKE_INBOX.map((t) => t.text).join("")).not.toContain(SECRET);
  });

  it("the CISO summary runs for the SOC and is refused to everyone else", async () => {
    clearFakeInbox();
    const ok = await runSkill(await ctxOf("soc"), "security.incident_summary", { table: "sec_incident", id: sir.id });
    expect(ok.text ?? "").not.toBe("");
    for (const who of outsiders) {
      clearFakeInbox();
      await expect(runSkill(await ctxOf(who), "security.incident_summary", { table: "sec_incident", id: sir.id })).rejects.toThrow();
      expect(FAKE_INBOX.map((t) => t.text).join("")).not.toContain(TOKEN);
    }
  });

  it("answers policy questions from published policies only, for readers of the compliance area", async () => {
    let pol = (await w.p.grc.client.post(`${w.P}/r/grc_policy`, { title: "خط‌مشی گذرواژه", kind: "standard", body: "گذرواژه دست‌کم ۱۲ نویسه و هر ۹۰ روز تغییر می‌کند policyQ1.", approver_id: w.p.ciso.userId })).row;
    const draft = (await w.p.grc.client.post(`${w.P}/r/grc_policy`, { title: "پیش‌نویس رمزنگاری", kind: "standard", body: "کلیدها در HSM نگهداری می‌شوند draftQ2." })).row;
    pol = (await w.p.grc.client.post(`${w.P}/r/grc_policy/${pol.id}/transition`, { to: "review", version: pol.version })).row;
    await w.drain();
    const ap = ((await w.p.ciso.client.get(`${w.P}/approvals/mine`)).approvals as any[]).find((a) => a.record_id === pol.id);
    await w.p.ciso.client.post(`${w.P}/approvals/${ap.id}/decide`, { decision: "approved" });
    await w.drain();
    const grc = await ctxOf("grc");
    clearFakeInbox();
    const ans = await runSkill(grc, "security.policy_qa", { text: "گذرواژه policyQ1" });
    expect(ans.text ?? "").not.toBe("");
    // the published policy reached the model as a source; the draft never did
    const prompt = FAKE_INBOX.map((t) => t.text).join("\n");
    expect(prompt).toContain("۱۲ نویسه");
    expect(ans.citations.every((c) => c.id !== draft.id)).toBe(true);
    clearFakeInbox();
    await runSkill(grc, "security.policy_qa", { text: "کلیدها در HSM draftQ2" });
    expect(FAKE_INBOX.map((t) => t.text).join("")).not.toContain("draftQ2.");
    expect(FAKE_INBOX.map((t) => t.text).join("")).not.toContain("کلیدها در HSM نگهداری");
    await expect(runSkill(await ctxOf("req"), "security.policy_qa", { text: "گذرواژه" })).rejects.toThrow();
  });
});

describe("module routes and tools", () => {
  it("serve the review tools to access administrators and auditors only", async () => {
    const risk = await w.p.auditor.client.get(`${w.P}/security/access-risk`);
    expect(Array.isArray(risk.flags)).toBe(true);
    const h = await w.o.get(`${w.P}/security/hardening`);
    expect(h.score).toBeGreaterThan(0);
    expect(h.checks.find((c: any) => c.key === "secure_workspace").status).toBe("pass");
    const pr = await w.o.get(`${w.P}/security/privileged?days=7`);
    expect(pr.chain).toMatch(/^[0-9a-f]{64}$/);
    // the SOC's reads of security incidents are in the review
    expect(pr.entries.some((e: any) => e.kind === "security_record_read")).toBe(true);
    for (const who of ["soc", "agent", "req"] as const) await w.p[who].client.get(`${w.P}/security/access-risk`, 403);
  });

  it("verifies a caller with a one-time code on a record the agent works", async () => {
    const inc = (await w.p.agent.client.post(`${w.P}/r/incident`, { short_description: "بازنشانی گذرواژه", caller_id: w.p.req.userId, assignment_group_id: w.g.desk, assigned_to: w.p.agent.userId })).row;
    const v = await w.p.agent.client.post(`${w.P}/security/verify`, { table: "incident", id: inc.id, user_id: w.p.req.userId });
    expect(v.status).toBe("pending");
    const wrong = await w.p.agent.client.post(`${w.P}/security/verify/${v.id}/check`, { code: "000000" });
    expect(["pending", "verified"]).toContain(wrong.status);
    // the code reached the caller's inbox (they read their own incident)
    await w.drain();
    const inbox = await w.p.req.client.get(`${w.P}/notify/inbox`);
    // the code itself, not six digits of an id or a number elsewhere in the inbox
    const code = /رمز تأیید هویت(?: شما)?:? (\d{6})(?!\d)/.exec(JSON.stringify(inbox).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))))?.[1];
    expect(code).toBeTruthy();
    const ok = await w.p.agent.client.post(`${w.P}/security/verify/${v.id}/check`, { code });
    expect(ok.status).toBe("verified");
    // someone who cannot change the record cannot start one
    await w.p.req.client.post(`${w.P}/security/verify`, { table: "incident", id: inc.id, user_id: w.p.req.userId }, 403);
  });

  it("finds and redacts personal data in a record's fields", async () => {
    const inc = (await w.p.agent.client.post(`${w.P}/r/incident`, { short_description: "تماس مشتری", description: "کد ملی ۰۰۸۴۵۷۵۹۴۸ و شماره ۰۹۱۲۳۴۵۶۷۸۹ و کارت 6037-9975-9940-5678", assignment_group_id: w.g.desk })).row;
    const scan = (await w.p.agent.client.get(`${w.P}/security/pii/incident/${inc.id}`)).fields as any[];
    const kinds = scan.flatMap((f) => f.findings.map((x: any) => x.kind)).sort();
    expect(kinds).toEqual(["card", "mobile", "national_id"]);
    const red = await w.p.agent.client.post(`${w.P}/security/pii/incident/${inc.id}/redact`, { fields: ["description"] });
    expect(red.redacted).toBe(3);
    const after = (await w.p.agent.client.get(`${w.P}/r/incident/${inc.id}`)).row;
    expect(after.description).toMatch(/حذف شد/);
    expect(after.description).not.toMatch(/۰۰۸۴۵۷۵۹۴۸|0084575948/);
  });
});
