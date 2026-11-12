// Stub of the «VMware vCenter» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3a owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const vcenter = describeKind({
  kind: "vcenter",
  label: "VMware vCenter",
  icon: "server-cog",
  category: "virtualisation",
  editions: ["cloud", "server", "relay"],
  auth: ["session"],
  collects: ["inventory", "status"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 40,
  permission_note: "نقش فقط‌خواندنی در سطح لازم",
});
