// Creation paths (design F §3.3): for the main tables, who creates their records — a person (an agent, a requester,
// or either, as their roles allow) or the system. An organisation's requirement on a built-in table (`custom_field`
// `required` + `required_for`) binds people's writes only, so the requirement editor shows which paths it affects and
// which it does not («ثبت خودکار سامانه: بررسی نمی‌شود»), and «همه» is refused where people create through a form
// that cannot carry the field (`requirementBlockers`: the portal's built-in «گزارش مشکل»).
// Agents are writers whose roles have the agent or admin persona; everyone else is a requester.
// Imported by the UI: keep it free of server imports.

/** Who writes on a path: people as agents, as requesters, either (as their roles allow), or the system. */
export type PathWriter = "agent" | "requester" | "person" | "system";

/** Whom an organisation's requirement binds (`custom_field.required_for`; `FieldDef.formRequired`). */
export type RequiredFor = "all" | "agents";

export const REQUIRED_FOR_LABELS: Record<RequiredFor, string> = { all: "همه", agents: "فقط کارشناسان" };

export const isRequiredFor = (v: unknown): v is RequiredFor => v === "all" || v === "agents";

export interface CreationPath {
  key: string;
  label: string;
  writer: PathWriter;
  /** people fill a fixed form on this path, which cannot carry a field the organisation adds */
  fixedForm?: boolean;
  /** the setting that replaces the fixed form with a catalogue form */
  formSetting?: "portal_report_item";
  /** said beside the path in the editor */
  note?: string;
}

const RECORD: CreationPath = { key: "record", label: "صفحهٔ رکورد", writer: "person" };
const IMPORT: CreationPath = { key: "import", label: "ورود از صفحه‌گسترده", writer: "person" };
const API: CreationPath = { key: "api", label: "API و کاربران یکپارچه‌سازی", writer: "person" };
const WINDOWS: CreationPath = { key: "windows", label: "برنامهٔ ویندوز", writer: "person", note: "هنگام ارسال به سرور سنجیده می‌شود" };
const FLOWS: CreationPath = { key: "flows", label: "جریان‌های خودکار", writer: "system", note: "جریانی که به نام یک عضو اجرا شود مانند همان عضو سنجیده می‌شود" };
const EMAIL: CreationPath = { key: "email", label: "ایمیل ورودی", writer: "system" };

/** Paths every table has: the record page, imports, the API, Windows apps and automation flows. */
export const COMMON_PATHS: readonly CreationPath[] = [RECORD, IMPORT, API, WINDOWS, FLOWS];

/** The main tables' own paths, beside the common ones. */
const TABLE_PATHS: Record<string, CreationPath[]> = {
  incident: [
    { key: "portal_report", label: "درگاه: «گزارش مشکل»", writer: "requester", fixedForm: true, formSetting: "portal_report_item", note: "با فرم پیش‌فرض درگاه، یا فرمی از کاتالوگ که در تنظیمات درگاه برگزیده شود" },
    { key: "virtual_agent", label: "دستیار مجازی", writer: "requester", note: "فقط عنوان و شرح را از درخواست‌دهنده می‌پرسد" },
    { key: "interaction", label: "ثبت از تعامل (تماس یا گفتگو)", writer: "agent" },
    { key: "request", label: "تبدیل قلم درخواست‌شده به رخداد", writer: "agent" },
    EMAIL,
    { key: "event", label: "قاعده‌های رویداد و هشدارهای پایش", writer: "system" },
  ],
  problem: [{ key: "incident", label: "ساخت مشکل از رخداد", writer: "agent" }],
  change_request: [
    { key: "related", label: "ساخت تغییر از رخداد یا مشکل", writer: "agent" },
    { key: "devops", label: "استقرارهای ابزار دواپس", writer: "system" },
  ],
  request: [{ key: "catalog", label: "سفارش از کاتالوگ خدمات", writer: "person", note: "فرم را خود قلم کاتالوگ می‌سازد" }],
  request_item: [{ key: "catalog", label: "سفارش از کاتالوگ خدمات", writer: "system", note: "قلم‌های سفارش را سامانه هنگام ثبت سبد می‌سازد" }],
  todo: [EMAIL],
};

/** The tables people create through a fixed form that `setting` replaces (the portal's «گزارش مشکل»: incident). */
export function tablesBehind(setting: NonNullable<CreationPath["formSetting"]>): string[] {
  return Object.keys(TABLE_PATHS).filter((t) => TABLE_PATHS[t].some((p) => p.fixedForm && p.formSetting === setting && p.writer !== "system"));
}

/**
 * The creation paths of a table: its own first, then the common ones. `emailTarget`: a mailbox of the organisation
 * creates records of this table (an inbound e-mail channel names it).
 */
export function pathsOf(table: string, opts: { emailTarget?: boolean } = {}): CreationPath[] {
  const own = TABLE_PATHS[table] ?? [];
  const out = [...own];
  for (const p of COMMON_PATHS) if (!out.some((x) => x.key === p.key)) out.push(p);
  if (opts.emailTarget && !out.some((x) => x.key === EMAIL.key)) out.push(EMAIL);
  return out;
}

export interface PathEffect {
  path: CreationPath;
  /** does the requirement bind the people writing on this path */
  checked: boolean;
  text: string;
}

/** Which paths a requirement binds, and which it does not, for the requirement editor. */
export function requirementEffects(table: string, requiredFor: RequiredFor, opts: { emailTarget?: boolean } = {}): PathEffect[] {
  return pathsOf(table, opts).map((path) => {
    if (path.writer === "system") return { path, checked: false, text: "ثبت خودکار سامانه: بررسی نمی‌شود" };
    if (path.writer === "requester" && requiredFor === "agents") return { path, checked: false, text: "درخواست‌دهندگان: بررسی نمی‌شود" };
    if (path.writer === "person" && requiredFor === "agents") return { path, checked: true, text: "فقط ثبت کارشناسان بررسی می‌شود" };
    return { path, checked: true, text: "بررسی می‌شود" };
  });
}

/** What the server knows about the organisation's forms when it judges a requirement. */
export interface RequirementEnv {
  /** the portal's «گزارش مشکل» uses a catalogue form (portal settings `report_item_id`) instead of its built-in one */
  portalReportItem?: boolean;
}

/**
 * Why a requirement cannot be saved: «همه» while requesters create through a fixed form that cannot carry the field
 * (the portal's built-in «گزارش مشکل»), with the two ways out. Empty when it can.
 */
export function requirementBlockers(table: string, requiredFor: RequiredFor, env: RequirementEnv = {}): string[] {
  if (requiredFor !== "all") return [];
  const out: string[] = [];
  for (const p of pathsOf(table)) {
    if (!p.fixedForm || p.writer === "system" || p.writer === "agent") continue;
    if (p.formSetting === "portal_report_item" && env.portalReportItem) continue;
    out.push(
      `الزام برای «همه» ثبت نمی‌شود: ${p.label} با فرم پیش‌فرض درگاه ثبت می‌شود و این فیلد در آن نیست. ` +
        "در تنظیمات درگاه فرمی از کاتالوگ برای «گزارش مشکل» برگزینید، یا «فقط کارشناسان» را انتخاب کنید.",
    );
  }
  return out;
}
