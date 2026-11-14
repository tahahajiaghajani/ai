// Stub of the «Active Directory — رایانه‌ها» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3b owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const ad_computers = describeKind({
  kind: "ad_computers",
  label: "Active Directory — رایانه‌ها",
  icon: "network",
  category: "directory_security",
  editions: ["cloud", "server", "relay"],
  auth: ["directory"],
  collects: ["inventory"],
  contact: { lag_days: 14 },
  availability: false,
  priority: 80,
  create_policy: "review",
  permission_note: "حساب اتصال منبع فهرست کاربران، با تأیید مدیر یکپارچه‌سازی",
});
