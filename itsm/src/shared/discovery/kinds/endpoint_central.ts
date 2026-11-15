// Stub of the «ManageEngine Endpoint Central» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3b owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const endpoint_central = describeKind({
  kind: "endpoint_central",
  label: "ManageEngine Endpoint Central",
  icon: "laptop",
  category: "endpoints",
  editions: ["cloud", "server", "relay"],
  auth: ["token", "session"],
  collects: ["inventory", "status", "software"],
  contact: { lag_days: 0 },
  availability: false,
  priority: 40,
  permission_note: "کارشناس فقط‌خواندنی با دسترسی API",
});
