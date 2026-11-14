// The «ارسال از ابزار (API)» kind (design A §6.1, §12): the tool sends its records, statuses and open problems to
// /api/v1/discovery/<connector>/… with an integration user's key — nothing is pulled. Batches are staged when they
// arrive and reconciled under the pull path's budget; a snapshot in parts is a complete picture once every part has
// arrived. Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const push = describeKind({
  kind: "push",
  label: "ارسال از ابزار (API)",
  icon: "cloud-upload",
  category: "generic",
  ready: true,
  editions: ["cloud", "server"],
  auth: ["none"],
  collects: ["inventory", "status", "problems"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 90,
  options: [
    {
      key: "availability_match", label: "الگوی هشدار قطع", type: "string", ltr: true,
      help: "هشداری که نام سنجه، منبع یا پیامش با این الگو بخواند یعنی خود دستگاه قطع است؛ مانند ^ping",
    },
  ],
  permission_note: "کلید API یک کاربر یکپارچه‌سازی با مجوز ثبت «موارد منبع داده»؛ همان کاربر در «کاربر یکپارچه‌سازیِ ارسال‌کننده» این منبع",
});
