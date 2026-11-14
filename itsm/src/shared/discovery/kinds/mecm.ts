// Stub of the «Microsoft MECM (SCCM)» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3b owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const mecm = describeKind({
  kind: "mecm",
  label: "Microsoft MECM (SCCM)",
  icon: "monitor-cog",
  category: "endpoints",
  editions: ["server", "relay"],
  auth: ["windows_identity", "ntlm"],
  collects: ["inventory", "software"],
  contact: { lag_days: 0 },
  availability: false,
  priority: 40,
  permission_note: "نقش Read-only Analyst و دسترسی به AdminService؛ اجرای سرویس کاریز با حساب دامنه یا gMSA",
});
