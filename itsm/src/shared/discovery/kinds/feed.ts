// The «فایل CSV یا JSON» kind (design A §6.6): a tool's export as CSV or JSON — the switch's terminal-status export, a
// vendor console's CSV report, Padvish or Lansweeper Classic exports; the 1.1 path for ATM sources. Two sources: a
// host-pinned URL (both editions) or the server edition's drop folder `<data dir>/discovery/drop/<connector id>/`,
// whose path the server fixes and «آزمودن اتصال» shows. A file is a snapshot by default (the complete picture, so
// what it no longer lists becomes «دیگر گزارش نمی‌شود»); a delta mode is an option.
//
// THE COLUMN MAP (`options.columns`, held to the allow-list like every mapping, §6.3) names for each field of the
// normalised record the CSV column — or for JSON the path over each element — that holds it:
// `{ "external_id": "TerminalID", "terminal_id": "TerminalID", "status.device_status": "State" }`. Without one, CSV
// columns named after a record field (`external_id`, `name`, `status.state`, …) are read as that field, and a JSON
// element is read as a record of the push API's shape (`kariz.discovery/1`). The connector's `mapping` stays what it
// is for every built-in kind: renames on the record the kind produced. Imported by the UI: keep it free of server
// imports.
import type { Option } from "../../model/types";
import { ITEM_KINDS } from "../types";
import { describeKind } from "./base";

export const FEED_SOURCES = ["url", "folder"] as const;
export type FeedSource = (typeof FEED_SOURCES)[number];
export const FEED_FORMATS = ["auto", "csv", "json"] as const;
export const FEED_MODES = ["snapshot", "delta"] as const;
export const FEED_DELIMITERS = ["auto", ",", ";", "tab", "|"] as const;
export const FEED_ENCODINGS = ["utf-8", "windows-1256"] as const;

const choice = (value: string, label: string): Option => ({ value, label });

export const feed = describeKind({
  kind: "feed",
  label: "فایل CSV یا JSON",
  icon: "file-spreadsheet",
  category: "atm_files",
  ready: true,
  editions: ["cloud", "server", "relay"],
  auth: ["none", "token", "basic"],
  collects: ["inventory", "status"],
  contact: { lag_days: 0 },
  availability: true,
  priority: 50,
  options: [
    {
      key: "source", label: "محل فایل", type: "choice", default: "url",
      choices: [choice("url", "نشانی وب"), choice("folder", "پوشهٔ ورودی سرور")],
      help: "پوشهٔ ورودی فقط در نسخهٔ سرور است؛ «آزمودن اتصال» مسیر آن را نشان می‌دهد",
    },
    { key: "path", label: "مسیر فایل", type: "string", ltr: true, help: "نسبت به نشانی منبع؛ خالی یعنی خود نشانی" },
    { key: "format", label: "قالب", type: "choice", default: "auto", choices: [choice("auto", "از پسوند یا محتوای فایل"), choice("csv", "CSV"), choice("json", "JSON")] },
    {
      key: "delimiter", label: "جداکنندهٔ ستون‌ها", type: "choice", default: "auto",
      choices: [choice("auto", "خودکار"), choice(",", "ویرگول (,)"), choice(";", "نقطه‌ویرگول (;)"), choice("tab", "Tab"), choice("|", "خط عمودی (|)")],
    },
    {
      key: "encoding", label: "نویسه‌گذاری فایل", type: "choice", default: "utf-8",
      choices: [choice("utf-8", "UTF-8"), choice("windows-1256", "Windows-1256")],
      help: "برای فایل پوشهٔ ورودی؛ فایل UTF-16 از نشانهٔ آغازش شناخته می‌شود",
    },
    { key: "items_path", label: "مسیر آرایه در JSON", type: "string", ltr: true, help: "مانند data.items؛ خالی یعنی خود فایل آرایه است" },
    {
      key: "columns", label: "ستون‌ها", type: "json",
      help: "مانند { \"external_id\": \"TerminalID\", \"terminal_id\": \"TerminalID\", \"status.device_status\": \"State\" }؛ خالی یعنی ستون‌هایی که نام فیلد را دارند",
    },
    { key: "item_kind", label: "گونهٔ موردها", type: "choice", default: "device", choices: ITEM_KINDS, help: "برای ردیف‌هایی که ستون گونه ندارند" },
    {
      key: "mode", label: "هر فایل", type: "choice", default: "snapshot",
      choices: [choice("snapshot", "تصویر کامل؛ نیامده‌ها «دیگر گزارش نمی‌شود»"), choice("delta", "فقط تغییرها")],
    },
    { key: "page_size", label: "ردیف در هر گام", type: "int", default: 500 },
    { key: "listing_is_contact", label: "آمدن در فایل یعنی تماس", type: "bool", default: false, help: "برای خروجی‌هایی که فقط دستگاه‌های در دسترس را دارند" },
  ],
  permission_note: "نشانی HTTPS فایل خروجی با کلید فقط‌خواندنی، یا پوشهٔ ورودی سرور با اجازهٔ نوشتن برای حساب برون‌بری",
});
