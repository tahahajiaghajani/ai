// The vocabulary of service requests and the catalogue (docs/modules/request_FA.md): item types, question
// (variable) types and their engine field types, data classes, stages, channels and the small option lists the
// tables, the form model, the server and the screens share. Pure: imported by the UI.
import type { FieldType, Option } from "../model/types";
import { CHANNELS } from "../model/task";

const list = (xs: readonly (readonly [string, string, Option["color"]?])[]): Option[] =>
  xs.map(([value, label, color], i) => ({ value, label, order: i + 1, ...(color ? { color } : {}) }));

/** What a catalogue item is (REQ-003): each kind has its own ordering behaviour and fulfilment defaults. */
export const ITEM_TYPES = list([
  ["standard", "قلم استاندارد", "blue"],
  ["hardware", "سخت‌افزار", "teal"],
  ["software", "نرم‌افزار", "indigo"],
  ["access", "دسترسی", "purple"],
  ["loaner", "امانی و رزروی", "gold"],
  ["standard_change", "تغییر استاندارد", "orange"],
  ["record_producer", "فرم ثبت رکورد", "magenta"],
  ["order_guide", "راهنمای سفارش و بسته", "green"],
  ["content", "محتوا و پیوند", "gray"],
]);
export type ItemType = "standard" | "hardware" | "software" | "access" | "loaner" | "standard_change" | "record_producer" | "order_guide" | "content";

/** Item types that are ordered and become requested items (the others create another record, expand or link). */
export const ORDERABLE_TYPES: ItemType[] = ["standard", "hardware", "software", "access", "loaner", "standard_change"];

/** Question types of the order form (REQ-005) and the engine field type each answer is stored and checked as. */
export const VARIABLE_TYPES: { value: string; label: string; field: FieldType | null; group: string }[] = [
  { value: "string", label: "متن کوتاه", field: "string", group: "متن" },
  { value: "text", label: "متن چندخطی", field: "text", group: "متن" },
  { value: "email", label: "ایمیل", field: "email", group: "متن" },
  { value: "url", label: "نشانی وب", field: "url", group: "متن" },
  { value: "phone", label: "تلفن", field: "phone", group: "متن" },
  { value: "ip", label: "نشانی IP", field: "ip", group: "متن" },
  { value: "int", label: "عدد صحیح", field: "int", group: "عدد و تاریخ" },
  { value: "decimal", label: "عدد اعشاری", field: "decimal", group: "عدد و تاریخ" },
  { value: "money", label: "مبلغ (ریال)", field: "money", group: "عدد و تاریخ" },
  { value: "date", label: "تاریخ", field: "date", group: "عدد و تاریخ" },
  { value: "datetime", label: "تاریخ و ساعت", field: "datetime", group: "عدد و تاریخ" },
  { value: "duration", label: "مدت", field: "duration", group: "عدد و تاریخ" },
  { value: "select", label: "فهرست کشویی", field: "choice", group: "گزینه" },
  { value: "radio", label: "گزینه‌های تکی", field: "choice", group: "گزینه" },
  { value: "multiselect", label: "چند گزینه", field: "multichoice", group: "گزینه" },
  { value: "bool", label: "بله / خیر", field: "bool", group: "گزینه" },
  { value: "rating", label: "امتیاز", field: "rating", group: "گزینه" },
  { value: "reference", label: "ارجاع به رکورد", field: "ref", group: "ارجاع" },
  { value: "list_collector", label: "چند رکورد", field: "refs", group: "ارجاع" },
  { value: "user", label: "کاربر", field: "user", group: "ارجاع" },
  { value: "users", label: "چند کاربر", field: "users", group: "ارجاع" },
  { value: "group", label: "گروه", field: "group", group: "ارجاع" },
  { value: "requested_for", label: "درخواست برای", field: "user", group: "ارجاع" },
  { value: "location", label: "مکان", field: "ref", group: "ارجاع" },
  { value: "ci", label: "پیکربندی یا دارایی", field: "ref", group: "ارجاع" },
  { value: "attachment", label: "پیوست", field: null, group: "ویژه" },
  { value: "secret", label: "رمز (فقط‌نوشتنی)", field: "secret", group: "ویژه" },
  { value: "label", label: "عنوان بخش", field: null, group: "ویژه" },
];
export type VariableType =
  | "string" | "text" | "email" | "url" | "phone" | "ip" | "int" | "decimal" | "money" | "date" | "datetime" | "duration"
  | "select" | "radio" | "multiselect" | "bool" | "rating" | "reference" | "list_collector" | "user" | "users" | "group"
  | "requested_for" | "location" | "ci" | "attachment" | "secret" | "label";

export const VARIABLE_TYPE_OPTIONS: Option[] = VARIABLE_TYPES.map((t, i) => ({ value: t.value, label: t.label, order: i + 1 }));
export const variableType = (t: unknown) => VARIABLE_TYPES.find((x) => x.value === t);
/** Types whose question has options. */
export const CHOICE_TYPES = new Set(["select", "radio", "multiselect"]);
/** Types that hold no answer. */
export const NO_VALUE_TYPES = new Set(["label"]);
/** Reference targets of the fixed reference types. */
export const FIXED_REF: Record<string, string> = { location: "location", ci: "ci" };

/** Data classes of answers (REQ-041): what may be kept, shown and copied where. */
export const FIELD_CLASSES = list([
  ["public", "عمومی", "green"],
  ["personal", "شخصی", "blue"],
  ["sensitive", "حساس", "orange"],
  ["secret", "محرمانه (فقط‌نوشتنی)", "red"],
]);
export type FieldClass = "public" | "personal" | "sensitive" | "secret";

export const FREQUENCIES = list([
  ["weekly", "هفتگی"],
  ["monthly", "ماهانه"],
  ["quarterly", "سه‌ماهه"],
  ["yearly", "سالانه"],
]);

/** For whom a member may order an item (REQ-019). Agents who may change others' requests order for anyone. */
export const ON_BEHALF = list([
  ["none", "فقط برای خود"],
  ["anyone", "هر کس در سازمان"],
  ["reportees", "زیردستان من"],
  ["unit_tree", "افراد واحد من و زیرمجموعه‌اش"],
  ["delegators", "کسانی که مرا جانشین کرده‌اند"],
]);

/** Until when a requester may cancel an item (REQ-044). */
export const REQUESTER_CANCEL = list([
  ["never", "هرگز"],
  ["before_approval", "تا پیش از تأیید"],
  ["before_fulfilment", "تا پیش از شروع انجام"],
  ["anytime", "تا پیش از تحویل"],
]);

/** The requester-facing stages of a requested item (REQ-023), shown as a progress bar; organisations edit the list. */
export const STAGES = list([
  ["submitted", "ثبت", "blue"],
  ["approval", "تأیید", "gold"],
  ["sourcing", "تأمین", "purple"],
  ["fulfilment", "انجام", "teal"],
  ["delivery", "تحویل", "green"],
  ["completed", "پایان", "gray"],
  ["rejected", "ردشده", "red"],
  ["cancelled", "لغوشده", "gray"],
]);
/** The default progress bar of an item. */
export const DEFAULT_STAGES = ["submitted", "approval", "fulfilment", "delivery", "completed"];

/** Channels through which a request arrives (the task channels plus the catalogue's own). */
export const REQUEST_CHANNELS: Option[] = [
  ...CHANNELS,
  { value: "assistant", label: "دستیار هوشمند" },
  { value: "schedule", label: "زمان‌بندی" },
  { value: "flow", label: "گردش‌کار" },
];

export const ITEM_CLOSE_CODES = list([
  ["fulfilled", "انجام شد", "green"],
  ["partially_fulfilled", "بخشی انجام شد", "gold"],
  ["rejected", "رد شد", "red"],
  ["cancelled", "لغو شد", "gray"],
  ["backordered", "تأمین نشد", "orange"],
  ["converted", "تبدیل شد", "blue"],
  ["duplicate", "تکراری", "gray"],
]);

export const TASK_CLOSE_CODES = list([
  ["done", "انجام شد", "green"],
  ["not_done", "انجام نشد", "red"],
  ["not_needed", "لازم نبود", "gray"],
]);

/** Kanban classes of service of fulfilment tasks (REQ-050). */
export const CLASSES_OF_SERVICE = list([
  ["expedite", "فوری", "red"],
  ["fixed_date", "تاریخ ثابت", "orange"],
  ["standard", "استاندارد", "blue"],
  ["intangible", "غیرفوری", "gray"],
]);

export const CART_KINDS = list([
  ["cart", "سبد جاری"],
  ["saved", "سبد ذخیره‌شده"],
  ["wishlist", "فهرست علاقه‌مندی"],
]);

export const TASK_PHASES = list([
  ["after_approval", "پس از تأیید"],
  ["before_approval", "پیش از تأیید"],
]);

export const POLICY_SCOPES = list([
  ["both", "فرم سفارش و نمای کارشناس"],
  ["order", "فقط فرم سفارش"],
  ["fulfil", "فقط نمای کارشناس"],
]);

export const AUDIENCE_MATCH = list([
  ["any", "یکی از معیارها کافی است"],
  ["all", "همهٔ معیارهای پرشده"],
]);

export const PERSONAS = list([
  ["requester", "درخواست‌کننده"],
  ["agent", "کارشناس"],
  ["admin", "مدیر سامانه"],
]);

export const CATEGORY_ORDER = list([
  ["manual", "ترتیب دستی"],
  ["alpha", "الفبایی"],
]);

/** How a requested item is fulfilled (derived from its version: a flow, task templates, or by hand). */
export const FULFILMENT_MODES = list([
  ["flow", "گردش‌کار"],
  ["tasks", "وظایف الگو"],
  ["manual", "دستی"],
]);

export const label = (options: readonly Option[], value: unknown): string => options.find((o) => o.value === value)?.label ?? String(value ?? "");
