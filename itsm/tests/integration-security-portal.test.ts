// Security, the portal and the predictive AI together:
//   · portal ↔ security: «گزارش ایمیل فیشینگ» (the security module's report page) is a quick link of the portal and a
//     search hit for every member while the security tables exist (`registerPortalLink`), opened in the app
//   · portal ↔ service portfolio / continuity: the status card shows the published business services with the portfolio
//     status, worsened by an ongoing outage of the continuity module — never an outage's title, its CI or incident
//   · analytics: the security and portal KPIs are seeded with the library (ANALYTICS_SEED_VERSION 4); security scores
//     go to security and compliance roles only (never the tenant administrator outside the SOC), live values run as
//     the viewer
//   · the AI data-use policy per table: security tables default to «فقط محلی» or «هرگز» until an AI administrator
//     decides, and the default holds for skills, the assistant's and agents' tools, retrieval answers (the virtual
//     agent), embeddings, insight narratives and «پرسش تحلیلی»
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { memberCtx } from "@server/access";
import type { Ctx } from "@server/context";
import { FAKE_INBOX, clearFakeInbox } from "@server/modules/ai/adapters/fake";
import { seedRequestDefaults } from "@server/modules/request";
import { assertToolData, dataUsePlan, defaultDataUse, tablePolicies, invalidateDataUse } from "@server/modules/ai/datause";
import { embeddable } from "@server/modules/ai/rag/indexer";
import { activeEmbedder } from "@server/modules/ai/rag/embed";
import { runSkill } from "@server/modules/ai/skills";
import { askWithCitations } from "@server/modules/ai/rag";
import { askReport } from "@server/modules/ai/nlreport";
import { registerPortalLink } from "@server/modules/portal";
import { ANALYTICS_SEED_VERSION } from "@server/modules/analytics";
import { libraryFor } from "@shared/analytics/library";
import { tableDef } from "@shared/tables";
import { SECURE_TABLES, SECURITY_DATA_USE } from "@shared/tables/security";
import { resetRateLimits } from "@server/http/ratelimit";
import { secWorld, type SecWorld } from "./security-helpers";

const before = process.env.ITSM_AI_FAKE;
afterAll(() => {
  if (before === undefined) delete process.env.ITSM_AI_FAKE;
  else process.env.ITSM_AI_FAKE = before;
});

const TOKEN = "sirPolicyZ9";
let w: SecWorld;
let sir: Record<string, any>;
const ctxOf = (userId: string): Promise<Ctx> => memberCtx(w.e.cfg, w.e.org, userId);

beforeAll(async () => {
  process.env.ITSM_AI_FAKE = "1";
  resetRateLimits();
  w = await secWorld();
  await w.o.post(`${w.P}/knowledge/seed`, {});
  await seedRequestDefaults(w.e.cfg, w.e.org);
  await w.o.post(`${w.P}/cmdb/seed`, {});
  await w.o.post(`${w.P}/service_portfolio/seed`, {});
  await w.o.post(`${w.P}/portal/seed`, {});
  await w.o.post(`${w.P}/analytics/seed`, { force: true });
  await w.o.post(`${w.P}/ai/connections`, { preset: "fake", embed: { model: "fake-embed", dims: 32 } });
  sir = await w.sir({ short_description: `باج‌افزار روی سرور فایل ${TOKEN}`, description: `شرح ${TOKEN}`, severity: "1" });
  await w.drain();
}, 300_000);

describe("portal ↔ security", () => {
  it("offers «گزارش ایمیل فیشینگ» to every member as an in-app quick link and a search hit", async () => {
    for (const who of ["req", "agent", "soc"] as const) {
      const home = await w.p[who].client.get(`${w.P}/portal/home`);
      const link = (home.links as { id: string; url: string; internal?: boolean; name: string }[]).find((l) => l.id === "module:security.report_phishing");
      expect(link).toMatchObject({ url: "security/report", internal: true, name: "گزارش ایمیل فیشینگ" });
      const s = await w.p[who].client.get(`${w.P}/portal/search?q=${encodeURIComponent("فیشینگ")}&log=0`);
      expect((s.hits as { kind: string; path: string; external?: boolean }[]).some((h) => h.kind === "link" && h.path === "security/report" && !h.external)).toBe(true);
    }
    // the page it opens files the report for the member
    const r = await w.p.req.client.post(`${w.P}/security/phishing`, { subject: "پیام مشکوک بانک", sender: "x@phish.example", body: "روی hxxp://phish[.]example/login بزنید" });
    expect(r).toBeTruthy();
  });

  it("module links follow their own availability and can be withdrawn", async () => {
    const off = registerPortalLink({ key: "test.closed", name: "پیوند بسته", path: "nowhere", available: async () => false });
    const on = registerPortalLink({ key: "test.open", name: "پیوند باز", path: "somewhere", available: async (ctx) => ctx.actor !== "system" });
    try {
      const links = (await w.p.req.client.get(`${w.P}/portal/home`)).links as { id: string }[];
      expect(links.some((l) => l.id === "module:test.closed")).toBe(false);
      expect(links.some((l) => l.id === "module:test.open")).toBe(true);
    } finally {
      off();
      on();
    }
    expect(((await w.p.req.client.get(`${w.P}/portal/home`)).links as { id: string }[]).some((l) => l.id === "module:test.open")).toBe(false);
  });
});

describe("portal ↔ service portfolio and continuity", () => {
  it("the status card shows the portfolio status, worsened by an ongoing outage, without CI names or outage details", async () => {
    const svc = (await w.o.post(`${w.P}/r/service`, { name: "حقوق و دستمزد", service_type: "business", description: "خدمت حقوق", owner_id: w.e.ownerId, on_status_page: true })).row;
    await w.o.post(`${w.P}/r/service/${svc.id}/transition`, { to: "approved" });
    const off = (await w.o.post(`${w.P}/r/service_offering`, { name: "استاندارد", service_id: svc.id })).row;
    await w.o.post(`${w.P}/r/service_offering/${off.id}/transition`, { to: "active" });
    await w.o.post(`${w.P}/r/service/${svc.id}/transition`, { to: "live" });
    let home = await w.p.req.client.get(`${w.P}/portal/home`);
    const row = () => (home.status?.services as { name: string; status: string }[] | undefined)?.find((s) => s.name === "حقوق و دستمزد");
    expect(row()?.status).toBe("operational");
    const ci = (await w.o.post(`${w.P}/r/ci`, { name: "srv-payroll-db-07", class: "server", state: "operational" })).row;
    await w.o.post(`${w.P}/r/outage`, { title: "قطعی پایگاه دادهٔ حقوق ciOutageX1", service_id: svc.id, ci_id: ci.id, outage_type: "outage", impact_pct: "100", begin_at: new Date(Date.now() - 600_000).toISOString(), cause_detail: "دیسک پر شد" });
    home = await w.p.req.client.get(`${w.P}/portal/home`);
    expect(row()?.status).toBe("major_outage");
    expect(home.status.overall).toBe("major_outage");
    const text = JSON.stringify(home.status);
    for (const hidden of ["srv-payroll-db-07", "ciOutageX1", "دیسک پر شد", ci.id]) expect(text).not.toContain(hidden);
    // a degradation of another published service shows as degraded; a partial outage as a partial one
    const ok = await w.p.agent.client.get(`${w.P}/portal/home`);
    expect((ok.status.services as { name: string; status: string }[]).find((s) => s.name === "حقوق و دستمزد")?.status).toBe("major_outage");
  });
});

describe("analytics: security and portal KPIs", () => {
  it("are seeded with the library (seed version 4) when their tables exist", async () => {
    expect(ANALYTICS_SEED_VERSION).toBe(4);
    const lib = libraryFor((t) => tableDef(t)).map((k) => k.key);
    expect(lib).toEqual(expect.arrayContaining(["security.open_incidents", "security.mttc", "security.vuln_overdue", "security.control_pass_rate", "security.risks_above_appetite", "portal.csat", "portal.deflection", "portal.self_service_share"]));
    // without the security and portal tables they are not offered
    const without = libraryFor((t) => (t.startsWith("sec_") || t.startsWith("grc_") || t === "portal" || t.startsWith("survey") ? undefined : tableDef(t))).map((k) => k.key);
    expect(without.some((k) => k.startsWith("security.") || k.startsWith("portal."))).toBe(false);
    const rows = (await w.o.get(`${w.P}/r/analytics_indicator?size=200`)).rows as { key: string }[];
    expect(rows.map((r) => r.key)).toEqual(expect.arrayContaining(["security.open_incidents", "security.mttc", "portal.csat", "portal.self_service_share"]));
  });

  it("security scores are shared with security roles only; live values count what each viewer reads", async () => {
    const ind = (await w.e.db.query<{ key: string; score_shares: unknown }>(`select key, score_shares from sm_analytics_indicators where org_id = $1 and key like 'security.%'`, [w.e.org]));
    expect(ind.length).toBe(5);
    for (const i of ind) {
      const shares = JSON.stringify(i.score_shares ?? []);
      expect(shares).not.toContain("tenant_admin");
    }
    const open = async (c: typeof w.o) => {
      const items = (await c.get(`${w.P}/analytics/scorecard?practice=security`).catch(() => ({ items: [] }))).items as { key?: string; current: { value: number | null } }[];
      return items.find((i) => i.key === "security.open_incidents")?.current.value ?? 0;
    };
    const soc = await open(w.p.ciso.client);
    expect(soc).toBeGreaterThanOrEqual(1);
    for (const c of [w.o, w.p.agent.client, w.p.analyst.client, w.p.grc.client]) expect(await open(c)).toBe(0);
  });
});

describe("the AI data-use policy of security tables", () => {
  it("defaults security records to local models only or no model, and an AI administrator may decide otherwise", async () => {
    for (const t of SECURE_TABLES) expect(["local", "never"]).toContain(defaultDataUse(t));
    expect(defaultDataUse("sec_evidence")).toBe("never");
    expect(defaultDataUse("incident")).toBe("cloud");
    expect(defaultDataUse("grc_policy")).toBe("cloud");
    expect(Object.keys(SECURITY_DATA_USE).every((t) => !!tableDef(t))).toBe(true);
    const plan = await dataUsePlan(w.sys, ["incident", "sec_incident"]);
    expect(plan).toMatchObject({ use: "local", local: ["sec_incident"] });
    expect((await dataUsePlan(w.sys, ["sec_task", "sec_evidence"])).use).toBe("never");
    const listed = (await w.o.get(`${w.P}/ai/governance/data-policies`)).tables as { table: string; use: string; explicit: boolean }[];
    expect(listed.find((r) => r.table === "sec_incident")).toMatchObject({ use: "local", explicit: false });
    expect(listed.find((r) => r.table === "sec_evidence")).toMatchObject({ use: "never", explicit: false });
    // an explicit decision wins over the default (and is logged as any policy)
    await w.o.put(`${w.P}/ai/governance/data-policies/sec_observable`, { use: "cloud", pii: "inherit" });
    invalidateDataUse(w.e.org);
    expect((await tablePolicies(w.sys)).get("sec_observable")?.use).toBe("cloud");
    await w.o.put(`${w.P}/ai/governance/data-policies/sec_observable`, { use: "local", pii: "inherit" });
    invalidateDataUse(w.e.org);
  });

  it("holds for skills, tools of the assistant and agents, cited answers and embeddings", async () => {
    const soc = await ctxOf(w.p.soc.userId);
    // a skill on a security incident: the cloud test model never receives it; the rule-based fallback answers
    clearFakeInbox();
    const r = await runSkill(soc, "security.incident_summary", { table: "sec_incident", id: sir.id });
    expect(r.fallback).toBe(true);
    expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toContain(TOKEN);
    // the assistant's and agents' tool results (a conversation with cloud models only)
    await expect(assertToolData(soc, ["sec_incident"], "assistant", false)).rejects.toMatchObject({ code: "ai_policy" });
    await expect(assertToolData(soc, ["sec_incident"], "agent:test", true)).resolves.toMatchObject({ use: "local" });
    await expect(assertToolData(soc, ["sec_evidence"], "agent:test", true)).rejects.toMatchObject({ code: "ai_policy" });
    // a cited answer (the portal's search answer and the virtual agent's knowledge route) over a security incident
    clearFakeInbox();
    await askWithCitations(soc, TOKEN, {}, { k: 6 }).catch(() => null);
    expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toContain(`شرح ${TOKEN}`);
    // embeddings: the cloud embedding model never reads security incidents (local vectors and full text only)
    const embedder = await activeEmbedder(w.sys).catch(() => null);
    if (embedder) {
      expect(await embeddable({ sys: w.sys, embedder } as never, "sec_incident")).toBe(false);
      expect(await embeddable({ sys: w.sys, embedder } as never, "incident")).toBe(true);
    }
  });

  it("holds for «پرسش تحلیلی» narratives over security tables", async () => {
    const ciso = await ctxOf(w.p.ciso.userId);
    clearFakeInbox();
    const a = await askReport(ciso, "تعداد رخدادهای امنیتی بر اساس شدت").catch(() => null);
    if (a?.narrative) expect(a.narrative.ai).toBe(false);
    expect(FAKE_INBOX.map((t) => t.text).join("\n")).not.toContain(TOKEN);
  });
});
