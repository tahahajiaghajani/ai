// The workflow engine on the server (design F §3.5–3.6, package F4a): cases run on the flows executor as runs of kind
// `process` (runs.ts). `installProcessEngine()` (once per process, src/server/routes/modules.ts) registers that kind.
import { registerProcessRuns } from "./runs";

export { PROCESS_RUN_KIND, processHandlers, processVersionGraph } from "./runs";

let installed = false;

export function installProcessEngine(): void {
  if (installed) return;
  installed = true;
  registerProcessRuns();
}
