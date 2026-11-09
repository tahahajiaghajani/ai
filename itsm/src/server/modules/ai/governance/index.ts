// AI governance (docs/spec/AI.md §14): the data-use policy per table enforced by the chain (../datause.ts), the guards of
// the governance tables, and the console's read models (./console.ts) for AI administrators.
import { AI_DIGEST } from "@shared/tables/ai-governance";
import { registerHooks } from "../../../engine";
import { forbidden } from "../../../http/errors";
import { installDataUse } from "../datause";

export { governanceOverview, guardLog, usageReport, feedbackReport, qualityReport, oversightView, dataPolicies, saveDataPolicy, auditExport, modelCards } from "./console";

let installed = false;

export function installAiGovernance(): void {
  if (installed) return;
  installed = true;
  installDataUse();
  // digests are written by the runtime only (built from what each recipient may see)
  registerHooks(AI_DIGEST, {
    beforeWrite(w) {
      if (w.ctx.actor !== "system") throw forbidden("خلاصهٔ بینش‌ها را فقط سامانه می‌نویسد");
    },
    // never from a member's Windows app either
    validatePush: () => "خلاصهٔ بینش‌ها را فقط سامانه می‌نویسد",
  });
}
