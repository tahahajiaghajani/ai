// Stub of the «PRTG Network Monitor» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA3a owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const prtg = describeKind({
  kind: "prtg",
  label: "PRTG Network Monitor",
  icon: "gauge",
  category: "monitoring",
  editions: ["cloud", "server", "relay"],
  auth: ["token", "basic"],
  collects: ["inventory", "status", "problems"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 70,
  permission_note: "کاربر فقط‌خواندنی با کلید API؛ و حسگری که نشانهٔ دسترس‌پذیری است",
});
