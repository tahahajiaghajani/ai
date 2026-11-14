// Organisational roles «نقش‌های سازمانی» and assignee resolution (design F §3.4, package F3): positions and their
// holders (src/shared/tables/positions.ts, area `org`), the assignee rules of workflow steps
// (src/shared/process/assignees.ts) and their resolution (resolve.ts) — the one function a step runs when it opens
// (F4a) and the designer previews (routes/positions.ts). Holders are kept by hand, by a spreadsheet import (import.ts)
// and by Active Directory group mappings (src/server/modules/integration/directory*.ts, `GroupMapping.position_id`).
// `installPositionsModule()` (once per process, src/server/routes/modules.ts) wires the integrity hooks of both tables.
import { installPositionHooks } from "./hooks";

export { resolveAssignees, heldPositions, Resolution, type ResolveInput, type ResolveResult, type Resolved, type Via } from "./resolve";
export { previewResolve, estimateStep, positionsOverview, canPreview, PREVIEW_REFUSAL } from "./service";
export { importHolders, MAX_HOLDER_ROWS, type HolderImportInput, type HolderImportResult } from "./import";
export { applyDirectoryHoldings, directoryFacts, type DirectoryHolding, type HoldingsResult } from "./directory";

let installed = false;

export function installPositionsModule(): void {
  if (installed) return;
  installed = true;
  installPositionHooks();
}
