// Flows («گردش‌کارها») on the server — docs/spec/services/flows.md. `installFlows()` (called once by
// src/server/routes/flows.ts when the app is assembled) registers the engine hooks, the record-event triggers, the
// job handlers (executor and scheduler, by import) and the built-in node handlers. The rest of the app and the
// services built next to it use what is exported here.
import "./nodes";
import "./http";
import "./scheduler";
import { installFlowHooks } from "./hooks";
import { installTriggers } from "./triggers";

let installed = false;

export function installFlows(): void {
  if (installed) return;
  installed = true;
  installFlowHooks();
  installTriggers();
}

export { registerFlowStepHandler, registerFlowSkill, setFlowBusinessClock, serviceInstalled, stepHandler, flowSkills } from "./registry";
export type { StepContext, StepOutcome, WaitRequest, WaitInfo, WaitCancel, FlowStepHandler, FlowSkill, BusinessClock } from "./registry";
export { startRun, executeRun, resumeFlowWait, cancelRun, RunAborted } from "./executor";
export type { StartInput, TriggerData, ExecuteOptions } from "./executor";
export { startCatalogFlows, startRecordFlows, resolveRunAs, activeFlows } from "./triggers";
export { runScheduler, ensureScheduler, cleanupRuns } from "./scheduler";
export { recipients, durationMs } from "./nodes";
export { hostAllowed, requestUrl } from "./http";
export { flowsGrant } from "./hooks";
export * from "./service";
