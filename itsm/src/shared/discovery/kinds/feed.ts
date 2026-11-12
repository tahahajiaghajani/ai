// Stub of the «فایل CSV یا JSON» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3c owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const feed = describeKind({
  kind: "feed",
  label: "فایل CSV یا JSON",
  icon: "file-spreadsheet",
  category: "atm_files",
  editions: ["cloud", "server", "relay"],
  auth: ["none", "token", "basic"],
  collects: ["inventory", "status"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 50,
  permission_note: "نشانی HTTPS فایل خروجی، یا پوشهٔ ورودی سرور",
});
