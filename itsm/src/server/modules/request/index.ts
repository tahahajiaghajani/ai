// Service request management and the service catalogue (docs/modules/request_FA.md): the tables are in
// src/shared/tables/request.ts (shared model in src/shared/request), the screens in src/ui/modules/request, the HTTP API
// in src/server/routes/request.ts. `installRequestModule()` (once per process, src/server/routes/modules.ts, after the
// SLA service: the lifecycle's hook on "*" must see approvals planned) wires the module into the platform:
//   · hooks of the catalogue's tables (catalog-hooks.ts) and the lifecycle of orders (lifecycle.ts)
//   · the ITIL priority matrix as the default of requested items, approver sources «مالک قلم کاتالوگ» and «مدیر مرکز
//     هزینه» for approval rules
//   · record meta `request` on GET /r/request_item/:id (the AI skills available; whether the caller works items rather
//     than following their own: «درخواست اطلاعات», «تغییر قلم», «تبدیل به رخداد»)
//   · jobs (jobs.ts): flow checks, links, the sweep and nightly statistics
//   · the seed of a new organisation (seed.ts), queued after the SLA service's calendars
// Extension points: the AI layer registers its skills with `registerRequestAi` (ai.ts); other modules start
// fulfilment flows by binding a flow to an item's code (trigger «سفارش از کاتالوگ»), order through `placeOrder`, and
// may embed the order form (src/ui/modules/request/OrderForm.tsx) — the portal does.
import { registerApproverSource, registerPriorityDefault, SEED_DELAY_MS } from "../sla";
import { registerOrgSeed } from "../orgs/service";
import { registerRecordMeta, systemCtx } from "../../engine";
import { enqueue, registerJobHandler, type JobConfig } from "../../jobs";
import { installCatalogHooks } from "./catalog-hooks";
import { installLifecycle, requesterLike } from "./lifecycle";
import { installRequestJobs } from "./jobs";
import { requestAiCapabilities } from "./ai";
import { liveRow, sysOf } from "./common";
import { seedRequestDefaultsIn, type SeedCounts } from "./seed";

let installed = false;

/** Add the defaults of service requests to an organisation (as the system; idempotent). */
export async function seedRequestDefaults(cfg: JobConfig, orgId: string, opts: { force?: boolean } = {}): Promise<SeedCounts> {
  const sys = await systemCtx(cfg, orgId);
  return sys.write((tx) => seedRequestDefaultsIn(tx, sys, opts));
}

export function installRequestModule(): void {
  if (installed) return;
  installed = true;
  installCatalogHooks();
  installLifecycle();
  installRequestJobs();
  registerPriorityDefault("request_item");
  // approval levels { kind: "owner", of: "catalog_item_owner" | "cost_center_manager" }
  registerApproverSource("catalog_item_owner", async (q, ctx, def, row) => {
    if (def.key !== "request_item") return [];
    const item = await liveRow(q, sysOf(ctx), "catalog_item", row.cat_item_id);
    return item?.owner_id ? [String(item.owner_id)] : [];
  });
  registerApproverSource("cost_center_manager", async (q, ctx, def, row) => {
    const sys = sysOf(ctx);
    const req = def.key === "request" ? row : def.key === "request_item" ? await liveRow(q, sys, "request", row.request_id) : null;
    const unit = req?.cost_center_id ? await liveRow(q, sys, "org_unit", req.cost_center_id) : null;
    return unit?.manager_id ? [String(unit.manager_id)] : [];
  });
  registerRecordMeta("request_item", async ({ q, ctx }) => ({ request: { ai: requestAiCapabilities(), can_work: !(await requesterLike(q, ctx)) } }));
  registerJobHandler("request.seed", async (job, jctx) => {
    if (!job.org_id) return;
    await seedRequestDefaults(jctx.cfg, job.org_id);
  });
  registerOrgSeed((tx, orgId) => enqueue(tx, { kind: "request.seed", orgId, delayMs: SEED_DELAY_MS + 90_000, dedupeKey: "request.seed", maxAttempts: 5 }).then(() => undefined));
}

export { seedRequestDefaultsIn, REQUEST_SEED_VERSION, type SeedCounts } from "./seed";
export { requestConfig, sysOf, liveRows, liveRow, eqAll, isUuid, allowed, type Row, type RequestConfig } from "./common";
export { publishItem, draftSchema, schemaProblems, versionSchema, publishedSchema, itemSettings, type DefinitionProblem } from "./definition";
export { entitlementFor, canOrder, onBehalfRefusal, memberFacts, catalogIndex } from "./entitlement";
export { browse, itemForm, checkItem, expandGuide, placeOrder, cartView, addLine, updateLine, removeLine, checkoutCart, updateCart, publicSchema, summaryOf, type OrderInput, type OrderResult, type LineInput, type ItemCard, type BrowseResult, type ItemForm, type CartView, type GuideLine } from "./ordering";
export { answersView, editAnswers, revealSecret, requestInfo, reorder, changeItem, convertToIncident, progress, giveFeedback, type AnswersView, type Progress } from "./actions";
export { definition, bindApprovalRule, bindExistingRule, createFlow, copyItem, audienceCheck, fulfilmentGraph, boundCondition, type Definition } from "./builder";
export { requestDashboard, type RequestDashboard } from "./dashboard";
export { sweep, stats, ensureSweep, resetSweepThrottle, SWEEP_EVERY, type SweepResult } from "./jobs";
export { checkFlows, promiseOf, calendarOf, itemFlows, FALLBACK_TITLE } from "./fulfil";
export { rollupRequest, rollupTasks, splitAnswers, writeFacts } from "./lifecycle";
export { registerRequestAi, requestAi, requestAiCapabilities, promptSafe, type RequestAi, type ItemDraft } from "./ai";
