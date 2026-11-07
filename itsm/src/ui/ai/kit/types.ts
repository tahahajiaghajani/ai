// What the AI screens read from /api/o/:org/ai/*: every response shape comes from @shared/ai/api.
import type { AiConnectionPublic, AiJob, AiTestReport } from "@shared/ai/types";

export type {
  AiStatus as AiStatusView,
  AiPreset as AiPresetView,
  AiConnectionInput,
  AiUsageReport as AiUsageView,
  AiUsageTotals,
  AiActionView,
  AiToolCallView,
  AiSettingsView,
  AiBudgetState,
} from "@shared/ai/api";

export type { AiConnectionPublic, AiTestReport };

export type { AiJob };
