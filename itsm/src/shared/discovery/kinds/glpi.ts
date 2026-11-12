// Stub of the «GLPI» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3a owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const glpi = describeKind({
  kind: "glpi",
  label: "GLPI",
  icon: "clipboard-list",
  category: "endpoints",
  editions: ["cloud", "server", "relay"],
  auth: ["token", "session", "oauth_client"],
  collects: ["inventory", "software"],
  contact: { lag_days: 0 },
  availability: false,
  priority: 40,
  permission_note: "نمایه‌ای با خواندن رایانه‌ها و یک کلاینت API",
});
