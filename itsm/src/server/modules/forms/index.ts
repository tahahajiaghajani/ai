// Process forms and the list of every form (design F §3.2, §8.2, package F2): the `form` table
// (src/shared/tables/forms.ts, area `process_design`), its layout and step rights (@shared/forms/layout) and the
// version snapshot (@shared/forms/snapshot). `installFormsModule()` (once per process, src/server/routes/modules.ts)
// wires the form's integrity hooks (hooks.ts) and reports the forms that use each library field to F1's usage
// (usage.ts), so a used field is never renamed, deleted or moved to another storage type.
// For the process packages (F4): `publishForms` and `loadFormsSnapshot` (snapshot.ts) take a version's snapshot,
// `checkFormValues` and `checkFormRefs` (values.ts) check what a person submits against it, `registerFormUsage` reports
// the processes that use a form, and `registerStepRights` lets the preview open a step of a process.
// The API is src/server/routes/forms.ts.
import { registerFieldUsage } from "../fields";
import { installFormHooks } from "./hooks";
import { formsUsingField } from "./usage";

export { formsUsage, formUsage, registerFormUsage, type FormUsage, type FormUsageSource } from "./usage";
export { libraryFields, type LibraryField } from "./library";
export { loadFormsSnapshot, publishForms } from "./snapshot";
export { checkFormRefs, checkFormValues, type FormValuesOptions, type FormValuesResult } from "./values";
export { registerStepRights, type StepOfForm, type StepRightsSource } from "./preview";
export { viewpointOf, type Viewpoint } from "./access";
export { FORM_KINDS, LINKED_KINDS, systemFormTables, type FormEntry, type FormKind } from "./list";

let installed = false;

export function installFormsModule(): void {
  if (installed) return;
  installed = true;
  installFormHooks();
  registerFieldUsage(formsUsingField);
}
