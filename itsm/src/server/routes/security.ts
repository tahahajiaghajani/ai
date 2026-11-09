// HTTP API of security operations, vulnerability response and GRC under /api/o/:org/security (docs/modules/
// security_FA.md «API»). Records themselves are served by the engine's generic API (/r/sec_incident…); these routes
// are the operations it cannot express. Every handler works with the caller's context: the engine and the access
// provider decide what they may read and change (404 for records they may not read, 403 for actions their access
// does not allow). Routes every member may use: the phishing report, «گزارش‌های من» and «خط‌مشی‌های من».
import { z } from "zod";
import { router, body, query } from "../http/hono";
import { forbidden } from "../http/errors";
import { access } from "../access/provider";
import { defFor } from "../engine";
import { liveRow } from "../modules/incident";
import {
  accessRisk, acknowledgePolicy, addObservables, applyPlaybook, approveSoa, campaignStatus, checkVerification, crosswalk, enrichObservable, extractIncidentObservables, groupRemediations,
  handoverText, hardening, importScan, incidentFacts, measureIndicators, myPolicies, myReports, privilegedActions, promoteIncident, promotedFrom, redactPii, regimesFor, remediationChange,
  reportPhishing, riskHeatmap, scanCoverage, scanPii, securityAiCapabilities, securityConfig, securityDashboard, seedSecurityDefaults, soaView, socWorkspace, startClock, startVerification,
  submitStage, transferCustody,
} from "../modules/security";
import { managesArea, readsArea, readsTable, sysOf } from "../modules/security/common";
import { grantIn } from "@shared/access/model";
import { subjectOf } from "../access";

const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "شناسه معتبر نیست");
const id = (v: string | undefined) => UUID.parse(v ?? "").toLowerCase();
const text = (max: number) => z.string().max(max, `حداکثر ${max} نویسه`);

export const securityRoutes = router();

// what the screens need to know: AI skills, the settings people see, and what the caller may open
securityRoutes.get("/meta", async (c) => {
  const ctx = c.get("ctx");
  const cfg = await securityConfig(ctx.db, ctx);
  const users = ctx.actor === "system" ? "all" : grantIn(subjectOf(ctx).eff, "users").read;
  return c.json({
    ai: securityAiCapabilities(),
    settings: { vuln_sla: { critical: cfg.vuln_sla_critical, high: cfg.vuln_sla_high, medium: cfg.vuln_sla_medium, low: cfg.vuln_sla_low }, ai_max_classification: cfg.ai_max_classification, seeded: cfg.seeded > 0 },
    can: {
      ops: await readsTable(ctx, "sec_incident"),
      vuln: await readsTable(ctx, "sec_vuln_item"),
      compliance: readsArea(ctx, "compliance"),
      risk: readsArea(ctx, "risk"),
      manage_security: managesArea(ctx, "security"),
      manage_compliance: managesArea(ctx, "compliance"),
      manage_risk: managesArea(ctx, "risk"),
      review: users === "all",
    },
  });
});

// the organisation's defaults (also re-adds what was deleted): security managers and tenant administrators
securityRoutes.post("/seed", async (c) => {
  const ctx = c.get("ctx");
  if (!managesArea(ctx, "security") && !managesArea(ctx, "compliance")) throw forbidden("افزودن پیش‌فرض‌ها با مدیر امنیت یا انطباق است");
  return c.json(await seedSecurityDefaults(ctx.cfg, ctx.org.id, { force: true }));
});

securityRoutes.get("/dashboard", async (c) => c.json(await securityDashboard(c.get("ctx"))));

// ----- security operations -----
securityRoutes.get("/soc", async (c) => c.json(await socWorkspace(c.get("ctx"))));
securityRoutes.get("/handover", async (c) => {
  const ctx = c.get("ctx");
  if (!(await readsTable(ctx, "sec_incident"))) throw forbidden("به رخدادهای امنیتی دسترسی ندارید");
  const q = query(c, z.object({ hours: z.coerce.number().int().min(1).max(72).optional() }));
  return c.json({ text: await handoverText(ctx, undefined, undefined, q.hours ?? 12) });
});
securityRoutes.get("/incidents/:id/facts", async (c) => c.json(await incidentFacts(c.get("ctx"), id(c.req.param("id")))));
securityRoutes.get("/incidents/:id/regimes", async (c) => c.json({ regimes: await regimesFor(c.get("ctx"), id(c.req.param("id"))) }));
securityRoutes.post("/incidents/:id/playbook", async (c) => {
  const input = await body(c, z.object({ playbook_id: UUID }));
  return c.json(await applyPlaybook(c.get("ctx"), id(c.req.param("id")), input.playbook_id.toLowerCase()));
});
securityRoutes.post("/incidents/:id/observables", async (c) => {
  const input = await body(c, z.object({ values: z.array(text(500)).min(1).max(100), is_ioc: z.boolean().optional(), verdict: z.enum(["unknown", "benign", "suspicious", "malicious"]).optional() }));
  return c.json(await addObservables(c.get("ctx"), id(c.req.param("id")), input.values, { is_ioc: input.is_ioc, verdict: input.verdict }));
});
securityRoutes.post("/incidents/:id/observables/extract", async (c) => c.json(await extractIncidentObservables(c.get("ctx"), id(c.req.param("id")))));
securityRoutes.post("/incidents/:id/clocks", async (c) => {
  const input = await body(c, z.object({ regime_id: UUID, aware_at: z.string().max(40).optional().nullable() }));
  return c.json({ row: await startClock(c.get("ctx"), id(c.req.param("id")), input.regime_id.toLowerCase(), input.aware_at ?? null) });
});
securityRoutes.post("/clocks/:id/submit", async (c) => {
  const input = await body(c, z.object({ stage: text(60), reference: text(120).optional().nullable() }));
  return c.json({ row: await submitStage(c.get("ctx"), id(c.req.param("id")), input.stage, input.reference ?? null) });
});
securityRoutes.post("/observables/:id/enrich", async (c) => c.json({ row: await enrichObservable(c.get("ctx"), id(c.req.param("id"))) }));
securityRoutes.post("/evidence/:id/transfer", async (c) => {
  const input = await body(c, z.object({ to: UUID, location: text(200).optional().nullable(), note: text(2000).optional().nullable() }));
  return c.json({ row: await transferCustody(c.get("ctx"), id(c.req.param("id")), { to: input.to.toLowerCase(), location: input.location ?? null, note: input.note ?? null }) });
});

// IT incidents → security incidents
securityRoutes.post("/promote/:incidentId", async (c) => c.json(await promoteIncident(c.get("ctx"), id(c.req.param("incidentId")))));
securityRoutes.get("/promoted/:incidentId", async (c) => {
  const ctx = c.get("ctx");
  const incidentId = id(c.req.param("incidentId"));
  const can = await readsTable(ctx, "sec_incident");
  const { def } = await defFor(ctx, "sec_incident");
  const sir = can ? await promotedFrom(ctx.db, ctx, incidentId) : null;
  // the number only when the caller reads the security incident itself
  const readable = sir ? await liveRow(ctx.db, ctx, "sec_incident", sir.id) : null;
  return c.json({ sir: readable ? { id: readable.id, number: readable.number ?? null } : null, can_promote: access().canCreate(ctx, def, null) });
});

// every member: report a suspicious e-mail, follow one's own reports (redacted)
securityRoutes.post("/phishing", async (c) => {
  const input = await body(c, z.object({ subject: text(300).min(1, "موضوع رایانامه را بنویسید"), sender: text(300).optional().nullable(), body: text(50_000).optional().nullable(), headers: text(20_000).optional().nullable() }));
  return c.json(await reportPhishing(c.get("ctx"), input));
});
securityRoutes.get("/my-reports", async (c) => c.json({ reports: await myReports(c.get("ctx")) }));

// ----- vulnerability response -----
securityRoutes.post("/scans/import", async (c) => {
  const input = await body(c, z.object({
    name: text(200).min(1), content: z.string().min(1, "پرونده خالی است").max(20_000_000, "پرونده بزرگ است؛ آن را چند بخش کنید"),
    scanner: z.enum(["nessus", "qualys", "openvas", "generic"]).optional().nullable(), format: z.enum(["csv", "xml", "json"]).optional().nullable(), dry_run: z.boolean().optional(),
  }));
  return c.json(await importScan(c.get("ctx"), input));
});
securityRoutes.post("/remediations/group", async (c) => {
  const input = await body(c, z.object({ basis: z.enum(["solution", "owner"]).optional(), item_ids: z.array(UUID).max(500).optional() }));
  return c.json(await groupRemediations(c.get("ctx"), input.basis ?? "solution", input.item_ids?.map((x) => x.toLowerCase())));
});
securityRoutes.post("/remediations/:id/change", async (c) => c.json(await remediationChange(c.get("ctx"), id(c.req.param("id")))));
securityRoutes.get("/coverage", async (c) => {
  const ctx = c.get("ctx");
  if (!(await readsTable(ctx, "sec_vuln_item"))) throw forbidden("به آسیب‌پذیری‌ها دسترسی ندارید");
  return c.json(await scanCoverage(ctx.db, ctx));
});

// ----- governance and compliance -----
securityRoutes.get("/soa", async (c) => {
  const q = query(c, z.object({ framework: UUID.optional() }));
  return c.json(await soaView(c.get("ctx"), q.framework?.toLowerCase() ?? null));
});
securityRoutes.post("/soa/approve", async (c) => {
  const input = await body(c, z.object({ ids: z.array(UUID).min(1).max(500) }));
  return c.json(await approveSoa(c.get("ctx"), input.ids.map((x) => x.toLowerCase())));
});
securityRoutes.get("/controls/:id/crosswalk", async (c) => c.json({ frameworks: await crosswalk(c.get("ctx"), id(c.req.param("id"))) }));
securityRoutes.post("/indicators/measure", async (c) => {
  const ctx = c.get("ctx");
  if (!managesArea(ctx, "compliance")) throw forbidden("سنجش شاخص‌ها با مدیر انطباق است");
  return c.json(await measureIndicators(sysOf(ctx)));
});
securityRoutes.get("/policies/mine", async (c) => c.json({ policies: await myPolicies(c.get("ctx")) }));
securityRoutes.post("/policies/campaigns/:id/ack", async (c) => c.json(await acknowledgePolicy(c.get("ctx"), id(c.req.param("id")))));
securityRoutes.get("/policies/campaigns/:id/status", async (c) => c.json(await campaignStatus(c.get("ctx"), id(c.req.param("id")))));
securityRoutes.get("/risks/heatmap", async (c) => c.json(await riskHeatmap(c.get("ctx"))));

// ----- administration tools -----
securityRoutes.get("/access-risk", async (c) => c.json(await accessRisk(c.get("ctx"))));
securityRoutes.get("/privileged", async (c) => {
  const q = query(c, z.object({ days: z.coerce.number().int().min(1).max(365).optional() }));
  return c.json(await privilegedActions(c.get("ctx"), q.days ?? 30));
});
securityRoutes.get("/hardening", async (c) => c.json(await hardening(c.get("ctx"))));
securityRoutes.post("/verify", async (c) => {
  const input = await body(c, z.object({ table: text(60), id: UUID, user_id: UUID, channel: z.enum(["in_app", "email", "sms"]).optional() }));
  return c.json(await startVerification(c.get("ctx"), { table: input.table, id: input.id.toLowerCase(), user_id: input.user_id.toLowerCase(), channel: input.channel }));
});
securityRoutes.post("/verify/:id/check", async (c) => {
  const input = await body(c, z.object({ code: text(20) }));
  return c.json(await checkVerification(c.get("ctx"), id(c.req.param("id")), input.code));
});
securityRoutes.get("/pii/:table/:id", async (c) => c.json({ fields: await scanPii(c.get("ctx"), text(60).parse(c.req.param("table")), id(c.req.param("id"))) }));
securityRoutes.post("/pii/:table/:id/redact", async (c) => {
  const input = await body(c, z.object({ fields: z.array(text(60)).min(1).max(50) }));
  return c.json(await redactPii(c.get("ctx"), text(60).parse(c.req.param("table")), id(c.req.param("id")), input.fields));
});
