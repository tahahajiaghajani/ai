// Stub of the «نمای SQL Server» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3c owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const sql_view = describeKind({
  kind: "sql_view",
  label: "نمای SQL Server",
  icon: "database",
  category: "atm_files",
  editions: ["server", "relay"],
  auth: ["windows_identity", "basic"],
  collects: ["inventory", "status"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 50,
  permission_note: "ورود فقط‌خواندنی SQL یا حساب سرویس، روی همان نما",
});
