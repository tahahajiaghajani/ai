// Stub of the «Kaspersky Security Center» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3b owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const ksc = describeKind({
  kind: "ksc",
  label: "Kaspersky Security Center",
  icon: "shield-check",
  category: "directory_security",
  editions: ["cloud", "server", "relay"],
  auth: ["basic", "session"],
  collects: ["inventory", "status", "problems"],
  contact: { lag_days: 0 },
  availability: false,
  priority: 60,
  create_policy: "review",
  permission_note: "کاربری با دسترسی خواندن روی گروه‌های مدیریتی",
});
