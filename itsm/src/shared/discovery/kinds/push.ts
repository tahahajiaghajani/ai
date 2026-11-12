// Stub of the «ارسال از ابزار (API)» kind (design A §6.1): the registries import it, the wizard hides it (`ready: false`) and its
// server kind refuses with «هنوز ساخته نشده». Package DA2 owns this file and replaces it with the real descriptor
// (options, default mapping). Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const push = describeKind({
  kind: "push",
  label: "ارسال از ابزار (API)",
  icon: "cloud-upload",
  category: "generic",
  editions: ["cloud", "server"],
  auth: ["none"],
  collects: ["inventory", "status", "problems"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 90,
  permission_note: "کلید API یک کاربر یکپارچه‌سازی با مجوز ثبت «موارد منبع داده»",
});
