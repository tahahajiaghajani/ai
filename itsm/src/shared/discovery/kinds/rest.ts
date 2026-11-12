// The generic REST/JSON kind (design A §2.2, §6.3): any tool with a JSON API (NetBox, OCS, in-house systems). The kind
// *is* mapping: the connector's `mapping` names a JSON path over each element of the array at `options.items_path`
// for every field of the normalised record (`external_id` and `name` at least). Paging styles: none, offset,
// page, cursor, next link. Imported by the UI: keep it free of server imports.
import { describeKind } from "./base";

export const REST_PAGING = ["none", "offset", "page", "cursor", "next_link"] as const;
export type RestPaging = (typeof REST_PAGING)[number];

export const rest = describeKind({
  kind: "rest",
  label: "REST/JSON عمومی",
  icon: "braces",
  category: "generic",
  ready: true,
  editions: ["cloud", "server", "relay"],
  auth: ["none", "token", "basic"],
  collects: ["inventory", "status"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 90,
  options: [
    { key: "path", label: "مسیر فهرست", type: "string", required: true, ltr: true, help: "مسیر نسبت به نشانی منبع، مانند /api/dcim/devices/" },
    { key: "items_path", label: "مسیر آرایه در پاسخ", type: "string", ltr: true, help: "مانند results؛ خالی یعنی خود پاسخ آرایه است" },
    {
      key: "paging", label: "صفحه‌بندی", type: "choice", default: "offset",
      choices: [
        { value: "none", label: "بدون صفحه‌بندی" }, { value: "offset", label: "جابه‌جایی و اندازه (offset/limit)" }, { value: "page", label: "شمارهٔ صفحه" },
        { value: "cursor", label: "نشانگر (cursor)" }, { value: "next_link", label: "پیوند صفحهٔ بعد" },
      ],
    },
    { key: "page_size", label: "اندازهٔ صفحه", type: "int", default: 500 },
    { key: "offset_param", label: "نام پارامتر جابه‌جایی", type: "string", default: "offset", ltr: true },
    { key: "limit_param", label: "نام پارامتر اندازه", type: "string", default: "limit", ltr: true },
    { key: "page_param", label: "نام پارامتر شمارهٔ صفحه", type: "string", default: "page", ltr: true },
    { key: "size_param", label: "نام پارامتر اندازهٔ صفحه", type: "string", default: "page_size", ltr: true },
    { key: "first_page", label: "شمارهٔ نخستین صفحه", type: "int", default: 1 },
    { key: "cursor_param", label: "نام پارامتر نشانگر", type: "string", default: "cursor", ltr: true },
    { key: "cursor_path", label: "مسیر نشانگر بعدی در پاسخ", type: "string", ltr: true },
    { key: "next_path", label: "مسیر پیوند صفحهٔ بعد در پاسخ", type: "string", default: "next", ltr: true },
    { key: "total_path", label: "مسیر شمار کل در پاسخ", type: "string", ltr: true },
    { key: "query", label: "پارامترهای ثابت درخواست", type: "json", help: "مانند { \"status\": \"active\" }؛ کلید را در بخش «کلید» وارد کنید، نه این‌جا" },
    { key: "listing_is_contact", label: "فهرست شدن یعنی تماس", type: "bool", default: false, help: "برای ابزارهایی که فقط دستگاه‌های روشن و در دسترس را فهرست می‌کنند" },
  ],
  default_mapping: { external_id: "$.id", name: "$.name" },
  permission_note: "یک کاربر یا کلید فقط‌خواندنی در ابزار، با دسترسی به همان فهرست",
});
