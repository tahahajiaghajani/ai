// Persian labels of the release module's static choices (server side: notifications, notes).
import { GO_DECISIONS, RISK_BANDS } from "@shared/tables/release";

export const decisionLabel = (v: unknown) => GO_DECISIONS.find((o) => o.value === String(v ?? "pending"))?.label ?? "تصمیم گرفته نشده";
export const riskLabelOf = (v: unknown) => RISK_BANDS.find((o) => o.value === String(v ?? ""))?.label ?? String(v ?? "");
