// Modules mounted under /api/o/:org (after requireUser, loadOrg and orgAccess, so every handler finds the
// caller's `ctx`). The platform itself has one: the AI («هوش مصنوعی»). A later module owns its routes file
// (src/server/routes/<module>.ts) and is mounted here with `moduleRoutes.route("/<module>", <module>Routes)`;
// its handlers check access with `ctx.need(area, level)` and, for an optional module, `ctx.hasModule(key)`.
// app.ts mounts this router when the app is created, so a module is added here before that (tests add
// fixture modules the same way, see tests/fixtures/module.ts).
import { router } from "../http/hono";
import { aiRoutes } from "./ai";
import { accessRoutes } from "./access";
import { flowRoutes } from "./flows";
import { installAccessModel } from "../access";
import { notifyRoutes } from "./notify";
import { installNotify } from "../modules/notify";
import { installSlaService } from "../modules/sla";
import { approvalRoutes, calendarRoutes, ruleRoutes, slaRoutes } from "./sla";
import { installIncidentModule } from "../modules/incident";
import { incidentRoutes } from "./incident";
import { installProblemModule } from "../modules/problem";
import { problemRoutes } from "./problem";
import { ragRoutes } from "./ai-rag";
import { installRag } from "../modules/ai/rag";
import { installCmdbModule } from "../modules/cmdb";
import { cmdbRoutes } from "./cmdb";
import { installServicePortfolioModule } from "../modules/service_portfolio";
import { servicePortfolioRoutes } from "./service_portfolio";
import { installChangeModule } from "../modules/change";
import { changeRoutes } from "./change";
import { installRequestModule } from "../modules/request";
import { requestRoutes } from "./request";
import { installKnowledgeModule } from "../modules/knowledge";
import { knowledgeRoutes } from "./knowledge";
import { installReleaseModule } from "../modules/release";
import { releaseRoutes } from "./release";
import { installDevopsModule } from "../modules/devops";
import { devopsRoutes } from "./devops";
import { installProjectModule } from "../modules/project";
import { projectRoutes } from "./project";
import { installAnalyticsModule } from "../modules/analytics";
import { analyticsRoutes } from "./analytics";
import { installEventModule } from "../modules/event";
import { eventRoutes } from "./event";
import { installContinuityModule } from "../modules/continuity";
import { continuityRoutes } from "./continuity";
import { installAiSkills } from "../modules/ai/skills";
import { installSecurityModule } from "../modules/security";
import { securityRoutes } from "./security";
import { skillRoutes } from "./ai-skills";
import { installAiAgents } from "../modules/ai/agents";
import { agentRoutes } from "./ai-agents";
import { installVirtualAgent } from "../modules/ai/va";
import { vaRoutes } from "./ai-va";
import { installItamModule } from "../modules/itam";
import { itamRoutes } from "./itam";
import { installSupplierModule } from "../modules/supplier";
import { supplierRoutes } from "./supplier";
import { installFinancialModule } from "../modules/financial";
import { financialRoutes } from "./financial";
import { installPortalModule } from "../modules/portal";
import { portalRoutes } from "./portal";
import { installAiMl } from "../modules/ai/ml";
import { mlRoutes } from "./ai-ml";
import { installAiGovernance } from "../modules/ai/governance";
import { governanceRoutes } from "./ai-governance";
import { installInsights } from "../modules/ai/insights";
import { insightRoutes } from "./ai-insights";
import { installEsmModule } from "../modules/esm";
import { esmRoutes } from "./esm";
import { installCsmModule } from "../modules/csm";
import { csmRoutes } from "./csm";
import { installFieldServiceModule } from "../modules/field_service";
import { fieldServiceRoutes } from "./field_service";

// the ITSM access model is the engine's access provider in every runtime (docs/spec/ACCESS.md)
installAccessModel();
// notifications, e-mail and the inbox (docs/spec/services/notify.md)
installNotify();

// calendars, SLAs, approvals and the rules of records (docs/spec/services/sla.md)
installSlaService();

// the AI index, retrieval, cited answers and the smart documents library (docs/spec/AI.md)
installRag();

// incident management (docs/modules/incident_FA.md) — after the SLA service: one of its hooks must run after the matrix
installIncidentModule();
// problem management (docs/modules/problem_FA.md)
installProblemModule();
// configuration management (docs/modules/cmdb_FA.md)
installCmdbModule();
// the service portfolio (docs/modules/service_portfolio_FA.md) — after configuration management: services are CIs
installServicePortfolioModule();

// the modules that work with incidents and problems come after them
// change enablement (docs/modules/change_FA.md) — after the SLA service: its authorization hook follows the approvals
installChangeModule();
// service requests and the catalogue (docs/modules/request_FA.md) — after the SLA service: its hook on "*" must see approvals planned
installRequestModule();
// knowledge management (docs/modules/knowledge_FA.md) — after the RAG index and the modules whose records it links
installKnowledgeModule();
// IT asset management, suppliers and contracts, IT financial management (docs/modules/{itam,supplier,financial}_FA.md) —
// after the CMDB (assets link to CIs) and the request module (catalogue items bound to models)
installItamModule();
installSupplierModule();
installFinancialModule();

// release and deployment management (docs/modules/release_FA.md) — after the change module: deployments move changes
installReleaseModule();
// DevOps (docs/modules/devops_FA.md) — after release management: pipelines write its deployments
installDevopsModule();
// project and portfolio management (docs/modules/project_FA.md) — its gate runs on the approvals service
installProjectModule();
// event management, AIOps light and on-call (docs/modules/event_FA.md) — after incidents, the CMDB and change
installEventModule();
// availability, capacity and continuity (docs/modules/continuity_FA.md) — after the event module (capacity sink)
installContinuityModule();
// security operations, vulnerability response and GRC (docs/modules/security_FA.md) — after the SLA service, the RAG
// index and the modules whose records it links (incidents, CIs, changes); before analytics, which reports on its tables
installSecurityModule();
// enterprise service management (docs/modules/esm_FA.md) — after the request module (department catalogues) and the
// SLA service (approvals of journey activities and bookings)
installEsmModule();
// customer service management (docs/modules/csm_FA.md) — after incidents (proactive cases, internal escalation) and ESM
// (the portal's registration hook)
installCsmModule();
// field service management (docs/modules/field_service_FA.md) — after CSM (coverage from entitlements) and ESM
installFieldServiceModule();
// analytics, reporting and KPIs (docs/modules/analytics_FA.md) — after every module whose tables it reports on
installAnalyticsModule();

// the AI skills (docs/spec/AI.md §11) — after every module whose AI extension points they implement
installAiSkills();
// AI agents (docs/spec/AI.md §11.8) — after the skills they run as tools
installAiAgents();
// the virtual agent's brain (docs/spec/AI.md §11.9) — the portal builds its requester UI
installVirtualAgent();
// the self-service portal and its channels (docs/modules/portal_FA.md) — after the virtual agent it talks through
installPortalModule();
// predictive AI (docs/spec/AI.md §13) — after the modules whose tables it learns from and the SLA rules it serves
installAiMl();
// AI governance (docs/spec/AI.md §14): the data-use policy per table and the console
installAiGovernance();
// insights (docs/spec/AI.md §16): daily and weekly cards, digests by role
installInsights();

export const moduleRoutes = router();

moduleRoutes.route("/ai", aiRoutes);
moduleRoutes.route("/ai", ragRoutes);
moduleRoutes.route("/ai", skillRoutes);
moduleRoutes.route("/ai", agentRoutes);
moduleRoutes.route("/ai", vaRoutes);
moduleRoutes.route("/ai", mlRoutes);
moduleRoutes.route("/ai", governanceRoutes);
moduleRoutes.route("/ai", insightRoutes);
moduleRoutes.route("/access", accessRoutes);
moduleRoutes.route("/notify", notifyRoutes);
moduleRoutes.route("/calendars", calendarRoutes);
moduleRoutes.route("/sla", slaRoutes);
moduleRoutes.route("/approvals", approvalRoutes);
moduleRoutes.route("/rules", ruleRoutes);
moduleRoutes.route("/flows", flowRoutes);
moduleRoutes.route("/incident", incidentRoutes);
moduleRoutes.route("/problem", problemRoutes);
moduleRoutes.route("/cmdb", cmdbRoutes);
moduleRoutes.route("/service_portfolio", servicePortfolioRoutes);
moduleRoutes.route("/change", changeRoutes);
moduleRoutes.route("/request", requestRoutes);
moduleRoutes.route("/knowledge", knowledgeRoutes);
moduleRoutes.route("/release", releaseRoutes);
moduleRoutes.route("/devops", devopsRoutes);
moduleRoutes.route("/project", projectRoutes);
moduleRoutes.route("/analytics", analyticsRoutes);
moduleRoutes.route("/event", eventRoutes);
moduleRoutes.route("/continuity", continuityRoutes);
moduleRoutes.route("/itam", itamRoutes);
moduleRoutes.route("/supplier", supplierRoutes);
moduleRoutes.route("/financial", financialRoutes);
moduleRoutes.route("/security", securityRoutes);
moduleRoutes.route("/portal", portalRoutes);
moduleRoutes.route("/esm", esmRoutes);
moduleRoutes.route("/csm", csmRoutes);
moduleRoutes.route("/field_service", fieldServiceRoutes);
