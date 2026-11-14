// Access to workflow cases and the guards of the workflow tables (design F §6, §7.2, package F4b): who reads a case
// (participant sources `process` and `process_managers`, ./sources.ts), what each reader sees of it (`redactRows` and
// `filterSide` on `process_case`, ./view.ts), who writes cases, tasks, versions, a process's publish fields and
// submissions (./guards.ts), and the upgrade check of customised roles without `work` create (./roles.ts).
// `installProcessAccess()` is mounted once with the modules (src/server/routes/modules.ts).
import { registerHooks } from "../../../engine";
import { installCaseSources } from "./sources";
import { installProcessGuards } from "./guards";
import { filterCaseSide, redactCases } from "./view";

export { caseViews, visibleData, visibleFiles, redactCases, filterCaseSide, type CaseView } from "./view";
export { setUploadRule, systemOnly, type UploadRule, CASE_WRITE, TASK_WRITE, VERSION_WRITE, PROCESS_STATUS_WRITE, PROCESS_DELETE, CASE_FILES, SUBMISSION_KEPT, SUBMISSION_OWN } from "./guards";
export { rolesWithoutWorkCreate, addWorkCreate, grantsWorkCreate, rolesWithoutWorkMessage, type RoleWithoutWork } from "./roles";
export { myGroupsSql } from "./sources";

let installed = false;

export function installProcessAccess(): void {
  if (installed) return;
  installed = true;
  installCaseSources();
  installProcessGuards();
  registerHooks("process_case", { redactRows: redactCases, filterSide: filterCaseSide });
}
