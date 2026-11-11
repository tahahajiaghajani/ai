// The field library (design F, package F1): field types and library fields (src/shared/tables/fields.ts, area
// `process_design`), their built-in types and validators (src/shared/forms/*). `installFieldsModule()` (once per
// process, src/server/routes/modules.ts) wires the integrity hooks of both tables (hooks.ts); usage.ts says where a
// library field is used, and later packages add their forms and process versions with `registerFieldUsage`.
import { installFieldHooks } from "./hooks";

export { fieldUsage, inUse, registerFieldUsage, type FieldUsage, type FieldUsageSource } from "./usage";
export { SETTINGS_ENV, orgFieldTypes, whereUsed } from "./hooks";

let installed = false;

export function installFieldsModule(): void {
  if (installed) return;
  installed = true;
  installFieldHooks();
}
