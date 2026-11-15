// The field library and the table overlays (design F, package F1): field types and library fields
// (src/shared/tables/fields.ts, area `process_design`), their built-in types and validators (src/shared/forms/*).
// `installFieldsModule()` (once per process, src/server/routes/modules.ts) wires the integrity hooks of both tables
// (hooks.ts), the organisation's requirements on people's writes and the lifecycle rules of transitions
// (requirements.ts), and the refused combinations of overrides, UI policies, lifecycle overlays and choice options
// (combinations.ts); usage.ts says where a library field is used, and later packages add their forms and process
// versions with `registerFieldUsage`. The API is src/server/routes/fields.ts (service.ts).
import { installFieldHooks } from "./hooks";
import { installRequirementHooks } from "./requirements";
import { installCombinationHooks } from "./combinations";

export { fieldUsage, inUse, registerFieldUsage, type FieldUsage, type FieldUsageSource } from "./usage";
export { SETTINGS_ENV, orgFieldTypes, whereUsed } from "./hooks";
export { personaOf, unmetRequirements } from "./requirements";
export { mandatoryPolicy, portalReportsThroughCatalogue, removeLifecycleOverlay, NO_LIBRARY_TABLES } from "./combinations";

let installed = false;

export function installFieldsModule(): void {
  if (installed) return;
  installed = true;
  installFieldHooks();
  installRequirementHooks();
  installCombinationHooks();
}
