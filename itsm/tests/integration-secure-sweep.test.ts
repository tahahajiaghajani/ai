// The secure workspace after the security, portal and predictive-AI merges: a canary security incident — with response
// tasks, observables, evidence, a regulatory clock and journals — stays invisible outside the SOC through EVERY merged
// surface: the portal (home, «درخواست‌های من» and «پیگیری‌شده‌ها», the ticket page, search and its AI answer), public
// knowledge pages, the virtual agent in the portal and through a messenger, the generated record tools (the assistant's
// and an AI agent's principal), the predictive AI (trained models, predictions, clusters, forecasts, insight cards and
// their hidden count, «پرسش تحلیلی»), analytics (reports, KPI live values and stored scores), notifications and the RAG
// index. The reporter (whose incident it is) and a watcher are outsiders too; the SOC still works it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayISO } from "@shared/jalali";
import { orgTz } from "@server/engine";
import { memberCtx, readableIds } from "@server/access";
import type { Ctx } from "@server/context";
import { askWithCitations, retrieve } from "@server/modules/ai/rag";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { seedRequestDefaults } from "@server/modules/request";
import { vaStart } from "@server/modules/ai/va";
import { toolCatalog } from "@server/modules/ai/tools";
import type { ToolRuntime } from "@server/modules/ai/tools/registry";
import { principalCtx } from "@server/modules/ai/skills/principal";
import { askReport } from "@server/modules/ai/nlreport";
import { periodOf, runPeriod } from "@server/modules/ai/insights";
import { runModel } from "@server/modules/ai/ml";
import { runReport } from "@server/modules/analytics/query";
import { snapshotStep } from "@server/modules/analytics/jobs";
import { resetRateLimits } from "@server/http/ratelimit";
import { secWorld, backdate, type SecWorld } from "./security-helpers";
import { Client } from "./helpers";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

// the title word a question may carry, and canaries that only the record's body, notes and children carry
const TOKEN = "sirCanaryQ7";
const BODY = "sirBodyK3";
const NOTE = "sirNoteK4";
const CHILD = "sirChildK5";
const rt: ToolRuntime = { today: "2026-11-09", dataPolicy: "full", putData: async () => "ref_test_1" };

let w: SecWorld;
let sir: Record<string, any>;
let anon: Client;
const outsiders = ["req", "agent", "analyst", "auditor", "vm", "grc"] as const;
const ctxOf = (userId: string): Promise<Ctx> => memberCtx(w.e.cfg, w.e.org, userId);
/** None of the record's canaries, number or id appears in `x`. */
const clean = (x: unknown, opts: { token?: boolean } = {}) => {
  const s = JSON.stringify(x ?? null);
  for (const c of [BODY, NOTE, CHILD, sir.id, sir.number, ...(opts.token === false ? [] : [TOKEN])]) expect(s).not.toContain(c);
};

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  resetRateLimits();
  w = await secWorld();
  anon = new Client(w.e.app);
  await w.o.post(`${w.P}/knowledge/seed`, {});
  await seedRequestDefaults(w.e.cfg, w.e.org);
  await w.o.post(`${w.P}/portal/seed`, {});
  await w.o.post(`${w.P}/analytics/seed`, { force: true });
  await w.o.post(`${w.P}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
  // the requester reported it, the requester and a desk agent watch it; it carries canaries everywhere
  sir = await w.sir({
    short_description: `نفوذ به سامانهٔ حقوق ${TOKEN}`, description: `شرح محرمانه ${BODY}`, lessons: `درس ${BODY}`,
    caller_id: w.p.req.userId, watch_list: [w.p.req.userId, w.p.agent.userId], severity: "1", category: "malware",
  });
  await w.p.soc.client.post(`${w.P}/r/sec_incident/${sir.id}/journal`, { kind: "comment", body: `پاسخ ${NOTE}` });
  await w.p.soc.client.post(`${w.P}/r/sec_incident/${sir.id}/journal`, { kind: "work_note", body: `یادداشت داخلی ${NOTE}` });
  await w.p.soc.client.post(`${w.P}/r/sec_task`, { short_description: `جداسازی میزبان ${CHILD}`, sec_incident_id: sir.id });
  await w.p.soc.client.post(`${w.P}/security/incidents/${sir.id}/observables`, { values: ["hxxp://canary-evil[.]example.com/k5"] });
  await w.p.soc.client.post(`${w.P}/r/sec_evidence`, { title: `تصویر حافظه ${CHILD}`, kind: "memory", sec_incident_id: sir.id });
  const regimes = (await w.p.soc.client.get(`${w.P}/security/incidents/${sir.id}/regimes`)).regimes as any[];
  if (regimes[0]) await w.p.soc.client.post(`${w.P}/security/incidents/${sir.id}/clocks`, { regime_id: regimes[0].id, aware_at: new Date(Date.now() - 3600_000).toISOString() });
  // an IT incident of the requester, so their portal lists something
  await w.p.req.client.post(`${w.P}/r/incident`, { short_description: "چاپگر کار نمی‌کند" });
  await w.drain();
  // yesterday's records, for the insight cards of the period
  await backdate(w.e, "sm_sec_incidents", sir.id, "created_at", 1);
}, 300_000);

describe("the canary security incident outside the SOC", () => {
  it("the SOC works it (the canary is real)", async () => {
    const rows = (await w.p.soc.client.get(`${w.P}/r/sec_incident?q=${TOKEN}`)).rows as any[];
    expect(rows.map((r) => r.id)).toContain(sir.id);
    const tasks = (await w.p.soc.client.get(`${w.P}/r/sec_task?size=50`)).rows as any[];
    expect(tasks.some((t) => String(t.short_description).includes(CHILD))).toBe(true);
  });

  it("the portal: home, my and followed items, the ticket page, search and its answer", async () => {
    for (const who of outsiders) {
      const c = w.p[who].client;
      clean(await c.get(`${w.P}/portal/home`));
      for (const tab of ["mine", "shared", "team"]) clean(await c.get(`${w.P}/portal/items?tab=${tab}&state=all`));
      const ticket = await c.req("GET", `${w.P}/portal/tickets/sec_incident/${sir.id}`, undefined, undefined as never).catch((e: Error) => e);
      expect(ticket instanceof Error && /→ (400|403|404)/.test(ticket.message)).toBe(true);
      const search = await c.get(`${w.P}/portal/search?q=${encodeURIComponent(TOKEN)}&log=0`);
      clean(search.hits);
      clearFakeInbox();
      const answer = await c.post(`${w.P}/portal/search/answer`, { q: `${TOKEN} چه شد؟` });
      clean(answer.answer?.citations ?? []);
      clean(answer.answer?.text ?? "", { token: false });
      expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toMatch(new RegExp(`${BODY}|${NOTE}|${CHILD}`));
    }
  });

  it("public knowledge pages", async () => {
    const bases = (await w.o.get(`${w.P}/r/kb_base?size=20`)).rows as any[];
    const pub = (await w.o.post(`${w.P}/r/portal_kb_publication`, { name: "راهنمای عمومی", bases: bases.map((b) => b.id), title: "راهنما" })).row;
    const r = await w.o.post(`${w.P}/portal/public-kb/${pub.id}`, { enabled: true });
    const token = String(r.url).split("/").pop()!;
    clean(await anon.get(`/public/portal/kb/${token}`));
    clean((await anon.get(`/public/portal/kb/${token}/search?q=${encodeURIComponent(TOKEN)}`)).hits);
  });

  it("the virtual agent, in the portal and through a messenger", async () => {
    for (const who of ["req", "agent"] as const) {
      const ctx = await ctxOf(w.p[who].userId);
      for (const channel of ["portal", "messenger"] as const) {
        clearFakeInbox();
        // «my tickets» — the requester is the reporter of the security incident
        clean(await vaStart(ctx, { channel, text: "وضعیت درخواست‌های من چیست؟" }));
        clean(await vaStart(ctx, { channel, text: `دربارهٔ ${TOKEN} چه می‌دانی؟` }), { token: false });
        expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toMatch(new RegExp(`${BODY}|${NOTE}|${CHILD}`));
      }
    }
  });

  it("the generated record tools: the assistant's and an AI agent's principal", async () => {
    await w.o.get(`${w.P}/ai/agents/admin`);
    await w.o.post(`${w.P}/ai/agents/admin`, { key: "sweep_probe", name: "عامل آزمون", from: "incident_triage" });
    // even with the security area's role, an agent's principal is outside the secure workspace
    await w.o.post(`${w.P}/ai/agents/admin/sweep_probe/principal`, { roles: ["agent", "security_analyst"] });
    const principal = await principalCtx(w.e.cfg, w.e.org, "sweep_probe");
    expect(principal).toBeTruthy();
    const ctxs = [...(await Promise.all(outsiders.map((who) => ctxOf(w.p[who].userId)))), await ctxOf(w.e.ownerId), principal!];
    for (const ctx of ctxs) {
      const { generated } = await toolCatalog(ctx, { proposals: true });
      for (const table of ["sec_incident", "sec_task", "sec_observable", "sec_evidence", "sec_reg_clock"]) {
        const search = generated.find((e) => e.name === `search_${table}`);
        if (search) {
          const res = await search.build().run(ctx, { text: TOKEN }, rt).catch((e: Error) => ({ data: null, error: e.message }));
          clean(res);
          const all = await search.build().run(ctx, {}, rt).catch(() => ({ data: null }));
          clean(all);
        }
        const agg = generated.find((e) => e.name === `aggregate_${table}`);
        if (agg) {
          const res = (await agg.build().run(ctx, { group_by: [{ field: "state" }] }, rt).catch(() => ({ data: { totals: { count: 0 } } }))) as { data: any };
          expect(Number(res.data?.totals?.count ?? 0)).toBe(0);
        }
        const get = generated.find((e) => e.name === `get_${table}`);
        if (get && table === "sec_incident") {
          const res = await get.build().run(ctx, { id: sir.id }, rt).catch(() => null);
          clean(res, { token: false });
        }
      }
    }
  });

  it("predictive AI: never trained on it; no prediction, cluster, forecast count or insight card outside the SOC", async () => {
    await w.o.get(`${w.P}/ai/ml/models`);
    await w.drain();
    const keys = (await w.e.db.query<{ key: string }>(`select key from sm_ai_models where org_id = $1`, [w.e.org])).map((r) => r.key);
    expect(keys.some((k) => k.includes("sec_incident"))).toBe(true);
    for (const key of keys.filter((k) => k.includes("sec_") || k.startsWith("classify:incident") || k.startsWith("duplicate:"))) await runModel(w.e.cfg, w.e.org, key, { force: true }).catch(() => null);
    const stored = await w.e.db.query<{ t: string }>(`select row_to_json(m)::text as t from sm_ai_models m where org_id = $1`, [w.e.org]);
    for (const r of stored) for (const c of [TOKEN.toLowerCase(), BODY.toLowerCase(), NOTE.toLowerCase(), CHILD.toLowerCase()]) expect(r.t.toLowerCase()).not.toContain(c);
    // the insight cards of yesterday, computed as the system
    const tz = orgTz(w.sys);
    await runPeriod(w.e.cfg, w.e.org, periodOf("daily", todayISO(tz), tz));
    // no stored card names a canary, whoever may see it
    for (const r of await w.e.db.query<{ t: string }>(`select row_to_json(i)::text as t from sm_ai_insights i where org_id = $1`, [w.e.org])) for (const c of [TOKEN, BODY, NOTE, CHILD]) expect(r.t).not.toContain(c);
    for (const who of outsiders) {
      const c = w.p[who].client;
      await c.get(`${w.P}/ai/ml/records/sec_incident/${sir.id}`).then(
        (r) => clean(r),
        (e: Error) => expect(e.message).toMatch(/→ (403|404)/),
      );
      const clusters = await c.get(`${w.P}/ai/ml/clusters?table=sec_incident`).catch(() => ({ clusters: [] }));
      clean(clusters);
      const fc = await c.get(`${w.P}/ai/ml/forecast?table=sec_incident&grain=day`).catch(() => null);
      if (fc) expect((fc.history as { count: number }[]).every((h) => h.count === 0)).toBe(true);
      const ins = await c.get(`${w.P}/ai/insights?period=daily`).catch(() => null);
      if (ins) {
        expect((ins.insights as { table: string }[]).some((i) => i.table.startsWith("sec_"))).toBe(false);
        clean(ins.insights);
      }
      clearFakeInbox();
      const ask = await askReport(await ctxOf(w.p[who].userId), "تعداد رخدادهای امنیتی بر اساس شدت").catch(() => null);
      if (ask?.result) expect(Number(ask.result.total_n ?? 0)).toBe(0);
      clean(ask?.result ?? null);
      expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toMatch(new RegExp(`${BODY}|${NOTE}|${CHILD}|${TOKEN}`));
    }
    // the owner (a tenant administrator outside the secure workspace) sees no security card, nor counts one as hidden
    const mine = await w.o.get(`${w.P}/ai/insights?period=daily`);
    expect((mine.insights as { table: string }[]).some((i) => i.table.startsWith("sec_"))).toBe(false);
    const others = (await w.e.db.query<{ n: string }>(`select count(*) as n from sm_ai_insights where org_id = $1 and table_key not like 'sec\\_%'`, [w.e.org]))[0];
    expect(mine.hidden + mine.insights.length).toBeLessThanOrEqual(Number(others?.n ?? 0));
  });

  it("analytics: reports, live KPI values and stored scores", async () => {
    // a snapshot of every indicator now: the security scores are stored (counting the canary) and the SOC's manager reads them
    await snapshotStep(w.e.cfg, w.e.org, { since: new Date(Date.now() - 2 * 86_400_000).toISOString(), deadline: Date.now() + 120_000 });
    const openId = (await w.e.db.query<{ id: string }>(`select id from sm_analytics_indicators where org_id = $1 and key = 'security.open_incidents'`, [w.e.org]))[0]!.id;
    const stored = await w.e.db.query<{ value: string }>(`select value from sm_analytics_scores where org_id = $1 and indicator_id = $2`, [w.e.org, openId]);
    expect(stored.some((r) => Number(r.value) >= 1)).toBe(true);
    const ciso = (await w.p.ciso.client.get(`${w.P}/r/analytics_score?size=200`)).rows as { indicator_id: string }[];
    expect(ciso.some((s) => s.indicator_id === openId)).toBe(true);
    for (const who of [...outsiders, "owner"] as const) {
      const ctx = await ctxOf(who === "owner" ? w.e.ownerId : w.p[who].userId);
      const r = await runReport(ctx, { v: 1, table: "sec_incident", measures: [{ fn: "count" }], dims: [{ field: "severity" }], viz: "table" }).catch(() => null);
      if (r) expect(r.total_n).toBe(0);
      const c = who === "owner" ? w.o : w.p[who].client;
      const card = await c.get(`${w.P}/analytics/scorecard?practice=security`).catch(() => ({ items: [] }));
      for (const i of card.items as { key?: string; current: { value: number | null } }[]) if (i.key === "security.open_incidents") expect(i.current.value ?? 0).toBe(0);
      const scores = await c.get(`${w.P}/r/analytics_score?size=200`).catch(() => ({ rows: [] }));
      // stored scores of security incidents reach no one outside the SOC — not the vulnerability or GRC manager, who read
      // only their own measures' scores; the others read no security score at all
      const pattern = who === "vm" || who === "grc" ? "security.open_incidents|security.mttc" : "security.%";
      const indicators = (await w.e.db.query<{ id: string }>(`select id from sm_analytics_indicators where org_id = $1 and key similar to $2`, [w.e.org, pattern.includes("|") ? `(${pattern})` : pattern])).map((x) => x.id);
      expect(indicators.length).toBeGreaterThan(0);
      expect([who, (scores.rows as { indicator_id: string }[]).some((s) => indicators.includes(s.indicator_id))]).toEqual([who, false]);
    }
  });

  it("notifications and the RAG index", async () => {
    const rows = await w.e.db.query<{ recipient_id: string; record_id: string | null; subject: string | null }>(
      `select recipient_id, record_id, subject from sm_notification_log where org_id = $1 and status in ('sent', 'queued', 'held', 'delivered')`,
      [w.e.org],
    );
    const outsiderIds = new Set([...outsiders.map((who) => w.p[who].userId), w.e.ownerId]);
    for (const r of rows.filter((x) => outsiderIds.has(x.recipient_id))) {
      expect(r.record_id).not.toBe(sir.id);
      for (const c of [TOKEN, BODY, NOTE, CHILD, sir.number]) expect(r.subject ?? "").not.toContain(c);
    }
    for (const who of outsiders) clean(await w.p[who].client.get(`${w.P}/notify/inbox`));
    for (const userId of [...outsiders.map((who) => w.p[who].userId), w.e.ownerId]) {
      const ctx = await ctxOf(userId);
      const r = await retrieve(ctx, TOKEN, { k: 12 });
      clean(r.passages.map((p) => ({ text: p.text, citation: p.citation })));
      for (const p of r.passages) expect((await readableIds(ctx, p.citation.table, [p.citation.id])).has(p.citation.id)).toBe(true);
      clearFakeInbox();
      const a = await askWithCitations(ctx, TOKEN, {}, { k: 6 });
      clean(a.passages.map((p) => p.text));
      expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toMatch(new RegExp(`${BODY}|${NOTE}|${CHILD}`));
    }
  });
});
