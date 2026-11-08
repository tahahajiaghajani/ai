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
import { installChangeModule } from "../modules/change";
import { changeRoutes } from "./change";
import { installRequestModule } from "../modules/request";
import { requestRoutes } from "./request";

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

// the modules that work with incidents and problems come after them
// change enablement (docs/modules/change_FA.md) — after the SLA service: its authorization hook follows the approvals
installChangeModule();
// service requests and the catalogue (docs/modules/request_FA.md) — after the SLA service: its hook on "*" must see approvals planned
installRequestModule();

export const moduleRoutes = router();

moduleRoutes.route("/ai", aiRoutes);
moduleRoutes.route("/ai", ragRoutes);
moduleRoutes.route("/access", accessRoutes);
moduleRoutes.route("/notify", notifyRoutes);
moduleRoutes.route("/calendars", calendarRoutes);
moduleRoutes.route("/sla", slaRoutes);
moduleRoutes.route("/approvals", approvalRoutes);
moduleRoutes.route("/rules", ruleRoutes);
moduleRoutes.route("/flows", flowRoutes);
moduleRoutes.route("/incident", incidentRoutes);
moduleRoutes.route("/problem", problemRoutes);
moduleRoutes.route("/change", changeRoutes);
moduleRoutes.route("/request", requestRoutes);
