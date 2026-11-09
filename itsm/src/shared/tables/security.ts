// Tables of security operations, vulnerability response and governance, risk and compliance (docs/modules/
// security_FA.md, catalogue docs/catalog/g7_levels_analytics.md «Module: security»). Three areas:
//
//   security    security incidents (SIR) and their response tasks, observables / threat indicators, evidence with chain
//               of custody, regulatory notification clocks, playbooks and regimes — all in the secure workspace
//               «امنیت» (members only, no admin bypass) and, for incidents and evidence, confidential —; the
//               vulnerability library, vulnerable items per (asset, vulnerability), remediation groups, exceptions,
//               scanner imports, security reviews of changes, caller verifications and the module's settings
//   compliance  frameworks and their requirements (the SoA lives on the ISO 27001 Annex A rows), the control library and
//               its tests, evidence, issues, policies with acknowledgement campaigns and waivers, audits and findings,
//               NIST CSF profiles, regulatory alerts, the privacy register and data-subject requests
//   risk        the risk register with its matrix, appetite, treatment actions, acceptances with expiry, KRIs and
//               loss events
//
// Behaviour lives in src/server/modules/security (hooks, services, jobs, seed); the record UI renders everything from
// these definitions (src/ui/modules/security). Imported by the UI: keep it free of server imports.
import type { Option, StateModel, TableDef } from "../model/types";
import { APPROVAL_STATES, PRIORITIES, TASK_SCOPE } from "../model/task";
import { CHILD_TASK_STATES, hideTaskFields } from "./incident";
import { CI_CRITICALITY } from "../cmdb/classes";
import { DEFAULT_SIR_WEIGHTS, INDICATORS, type SirWeights } from "../security/logic";

// ---------------------------------------------------------------------------------------------------------------
// Choice lists

const o = (value: string, label: string, color?: Option["color"]): Option => ({ value, label, ...(color ? { color } : {}) });

export const SIR_CATEGORIES: Option[] = [
  o("phishing", "فیشینگ", "orange"),
  o("malware", "بدافزار", "red"),
  o("account_compromise", "نفوذ به حساب کاربری", "purple"),
  o("unauthorized_access", "دسترسی غیرمجاز", "magenta"),
  o("data_breach", "نشت داده", "red"),
  o("dos", "حملهٔ منع خدمت", "orange"),
  o("insider", "تهدید داخلی", "indigo"),
  o("vulnerability_exploit", "بهره‌برداری از آسیب‌پذیری", "gold"),
  o("lost_device", "گم‌شدن یا سرقت دستگاه", "teal"),
  o("policy_violation", "نقض خط‌مشی", "blue"),
  o("other", "سایر", "gray"),
];

export const SIR_CLOSE_CODES: Option[] = [
  o("true_positive", "مثبت واقعی (رخداد تأیید شد)", "red"),
  o("false_positive", "مثبت کاذب", "gray"),
  o("benign", "بی‌خطر (فعالیت مجاز)", "green"),
  o("duplicate", "تکراری", "gray"),
  o("inconclusive", "نامعلوم", "gold"),
];

export const SEVERITIES: Option[] = [o("1", "بحرانی", "red"), o("2", "بالا", "orange"), o("3", "متوسط", "gold"), o("4", "کم", "gray")];
export const BUSINESS_IMPACTS: Option[] = [o("1", "گسترده", "red"), o("2", "قابل‌توجه", "orange"), o("3", "محدود", "gold"), o("4", "ناچیز", "gray")];
export const CLASSIFICATION_OPTIONS: Option[] = [o("public", "عمومی", "green"), o("internal", "داخلی", "blue"), o("confidential", "محرمانه", "orange"), o("restricted", "سری", "red")];
export const SIR_SOURCES: Option[] = [
  o("manual", "ثبت دستی"), o("phishing_report", "گزارش فیشینگ کارکنان"), o("alert", "هشدار سامانهٔ پایش (SIEM/EDR)"), o("promoted", "ارتقا از رخداد فناوری اطلاعات"),
  o("threat_intel", "اطلاعات تهدید"), o("audit", "ممیزی یا بازبینی"), o("external", "گزارش بیرونی"),
];
export const ATTACK_VECTORS: Option[] = [
  o("email", "رایانامه"), o("web", "وب"), o("removable_media", "رسانهٔ جداشدنی"), o("network", "شبکه"), o("cloud", "خدمت ابری"),
  o("physical", "فیزیکی"), o("supply_chain", "زنجیرهٔ تأمین"), o("credentials", "اطلاعات ورود سرقت‌شده"), o("unknown", "نامعلوم"),
];
export const PHASES: Option[] = [o("analysis", "تحلیل", "teal"), o("contain", "مهار", "orange"), o("eradicate", "ریشه‌کنی", "purple"), o("recover", "بازیابی", "indigo"), o("review", "بازبینی", "green")];
export const CONTAINMENT_ACTIONS: Option[] = [
  o("none", "بدون اقدام خودکار"), o("isolate_host", "جداسازی میزبان", "red"), o("block_ip", "مسدودسازی IP", "orange"), o("block_url", "مسدودسازی نشانی یا دامنه", "orange"),
  o("disable_account", "غیرفعال‌سازی حساب", "magenta"), o("reset_password", "بازنشانی گذرواژه و نشست‌ها", "purple"), o("kill_process", "پایان‌دادن فرایند", "gold"),
  o("purge_mail", "حذف رایانامه از صندوق‌ها", "gold"), o("lock_device", "قفل دستگاه", "indigo"), o("wipe_device", "پاک‌سازی دستگاه", "red"), o("other", "سایر"),
];
export const OBSERVABLE_TYPE_OPTIONS: Option[] = [
  o("ipv4", "نشانی IPv4"), o("ipv6", "نشانی IPv6"), o("domain", "دامنه"), o("url", "نشانی وب"), o("email", "رایانامه"), o("md5", "هش MD5"), o("sha1", "هش SHA-1"),
  o("sha256", "هش SHA-256"), o("filename", "نام پرونده"), o("hostname", "نام میزبان"), o("account", "حساب کاربری"), o("other", "سایر"),
];
export const VERDICTS: Option[] = [o("unknown", "نامعلوم", "gray"), o("benign", "بی‌خطر", "green"), o("suspicious", "مشکوک", "gold"), o("malicious", "مخرب", "red")];
export const TLP: Option[] = [o("clear", "TLP:CLEAR", "gray"), o("green", "TLP:GREEN", "green"), o("amber", "TLP:AMBER", "gold"), o("red", "TLP:RED", "red")];
export const OBSERVABLE_SOURCES: Option[] = [o("manual", "دستی"), o("phishing", "گزارش فیشینگ"), o("alert", "هشدار"), o("feed", "خوراک اطلاعات تهدید"), o("import", "ورود از پرونده")];
export const EVIDENCE_KINDS: Option[] = [o("disk_image", "تصویر دیسک"), o("memory", "تصویر حافظه"), o("log", "لاگ"), o("email", "رایانامه"), o("screenshot", "تصویر صفحه"), o("file", "پرونده"), o("network", "ترافیک شبکه"), o("document", "سند"), o("other", "سایر")];

export const VULN_RATING_OPTIONS: Option[] = [o("critical", "بحرانی", "red"), o("high", "بالا", "orange"), o("medium", "متوسط", "gold"), o("low", "کم", "gray")];
export const VULN_SEVERITY_OPTIONS: Option[] = [...VULN_RATING_OPTIONS, o("none", "بدون امتیاز", "gray")];
export const EXPLOIT_MATURITY: Option[] = [o("none", "گزارش نشده"), o("poc", "اثبات مفهوم"), o("functional", "بهره‌بردار کارا"), o("high", "خودکار و گسترده"), o("attacked", "مورد حمله در عمل", "red")];
export const EXPOSURES: Option[] = [o("internet", "در معرض اینترنت", "red"), o("internal", "شبکهٔ داخلی", "gold"), o("isolated", "جداافتاده", "green")];
export const COMPENSATING: Option[] = [o("none", "ندارد"), o("partial", "جزئی"), o("strong", "قوی", "green")];
export const SCANNERS: Option[] = [o("nessus", "Nessus / Tenable"), o("qualys", "Qualys"), o("openvas", "OpenVAS / Greenbone"), o("generic", "قالب عمومی"), o("manual", "دستی")];
export const SSVC: Option[] = [o("track", "پیگیری (Track)", "gray"), o("track_star", "پیگیری ویژه (Track*)", "gold"), o("attend", "توجه (Attend)", "orange"), o("act", "اقدام فوری (Act)", "red")];
export const VEX_STATUSES: Option[] = [o("under_investigation", "در حال بررسی", "gold"), o("affected", "متأثر", "red"), o("not_affected", "متأثر نیست", "green"), o("fixed", "رفع‌شده", "green")];
export const VEX_JUSTIFICATIONS: Option[] = [
  o("component_not_present", "مؤلفهٔ آسیب‌پذیر وجود ندارد"),
  o("vulnerable_code_not_present", "کد آسیب‌پذیر وجود ندارد"),
  o("vulnerable_code_not_in_execute_path", "کد آسیب‌پذیر اجرا نمی‌شود"),
  o("vulnerable_code_cannot_be_controlled_by_adversary", "مهاجم کد آسیب‌پذیر را کنترل نمی‌کند"),
  o("inline_mitigations_already_exist", "کاهندهٔ درون‌خطی وجود دارد"),
];
export const EXCEPTION_KINDS: Option[] = [o("deferral", "تعویق", "gold"), o("risk_acceptance", "پذیرش ریسک", "orange"), o("not_affected", "متأثر نیست (VEX)", "green"), o("false_positive", "مثبت کاذب", "gray")];
export const REVIEW_KINDS: Option[] = [o("change", "تغییر"), o("access", "درخواست دسترسی"), o("supplier", "تأمین‌کننده"), o("baseline", "خط مبنای امن"), o("other", "سایر")];
export const REVIEW_DECISIONS: Option[] = [o("approved", "بی‌اشکال", "green"), o("conditions", "با شرط", "gold"), o("rejected", "رد", "red")];
export const VERIFY_CHANNELS: Option[] = [o("in_app", "اعلان درون‌برنامه"), o("email", "رایانامه"), o("sms", "پیامک")];
export const VERIFY_STATUSES: Option[] = [o("pending", "در انتظار", "gold"), o("verified", "تأییدشده", "green"), o("failed", "ناموفق", "red"), o("expired", "منقضی", "gray")];

// GRC
export const FRAMEWORK_KINDS: Option[] = [o("standard", "استاندارد"), o("regulation", "مقررات"), o("contract", "قرارداد"), o("internal", "داخلی")];
export const IMPLEMENTATION: Option[] = [o("not_assessed", "ارزیابی‌نشده", "gray"), o("not_implemented", "پیاده‌نشده", "red"), o("partial", "بخشی", "gold"), o("implemented", "پیاده‌شده", "green"), o("not_applicable", "کاربست‌ناپذیر", "gray")];
export const COMPLIANCE: Option[] = [o("not_assessed", "ارزیابی‌نشده", "gray"), o("non_compliant", "نامنطبق", "red"), o("partial", "بخشی", "gold"), o("compliant", "منطبق", "green"), o("not_applicable", "کاربست‌ناپذیر", "gray")];
export const SOA_STATES: Option[] = [o("draft", "پیش‌نویس", "gold"), o("approved", "تأییدشده", "green")];
export const CONTROL_TYPES: Option[] = [o("preventive", "پیشگیرانه"), o("detective", "کشف‌کننده"), o("corrective", "اصلاحی")];
export const CONTROL_NATURES: Option[] = [o("manual", "دستی"), o("automated", "خودکار"), o("hybrid", "ترکیبی")];
export const FREQUENCIES: Option[] = [o("continuous", "پیوسته"), o("daily", "روزانه"), o("weekly", "هفتگی"), o("monthly", "ماهانه"), o("quarterly", "فصلی"), o("semiannual", "شش‌ماهه"), o("annual", "سالانه")];
export const CONTROL_STATUS: Option[] = [o("planned", "برنامه‌ریزی‌شده", "blue"), o("partial", "بخشی", "gold"), o("implemented", "پیاده‌شده", "green"), o("not_implemented", "پیاده‌نشده", "red")];
export const EFFECTIVENESS: Option[] = [o("not_tested", "آزموده‌نشده", "gray"), o("effective", "اثربخش", "green"), o("partially_effective", "تا حدی اثربخش", "gold"), o("ineffective", "ناکارآمد", "red")];
export const INDICATOR_STATUS: Option[] = [o("unknown", "نامعلوم", "gray"), o("pass", "برقرار", "green"), o("fail", "نقض", "red")];
export const INDICATOR_OPTIONS: Option[] = [o("none", "بدون پایش خودکار"), ...INDICATORS.map((i) => o(i.key, i.label))];
export const CIA: Option[] = [o("confidentiality", "محرمانگی"), o("integrity", "صحت"), o("availability", "دسترس‌پذیری")];
export const CONCEPTS: Option[] = [o("identify", "شناسایی"), o("protect", "حفاظت"), o("detect", "کشف"), o("respond", "پاسخ"), o("recover", "بازیابی")];
export const TEST_KINDS: Option[] = [o("design", "طراحی"), o("operating", "اثربخشی عملیاتی"), o("self_assessment", "خودارزیابی")];
export const ISSUE_SOURCES: Option[] = [o("control_test", "آزمون کنترل"), o("audit_finding", "یافتهٔ ممیزی"), o("indicator", "پایش خودکار"), o("risk_event", "رویداد ریسک"), o("regulatory", "تغییر مقررات"), o("self", "گزارش داوطلبانه")];
export const ISSUE_SEVERITIES: Option[] = [o("critical", "بحرانی", "red"), o("high", "بالا", "orange"), o("medium", "متوسط", "gold"), o("low", "کم", "gray")];
export const EVIDENCE_TYPES: Option[] = [o("document", "سند"), o("screenshot", "تصویر صفحه"), o("log", "لاگ"), o("report", "گزارش"), o("config", "پیکربندی"), o("population", "جامعه و نمونه"), o("attestation", "تأییدنامه"), o("other", "سایر")];
export const POLICY_KINDS: Option[] = [o("policy", "خط‌مشی"), o("standard", "استاندارد"), o("procedure", "روال"), o("guideline", "رهنمود"), o("isms_scope", "دامنهٔ سامانهٔ مدیریت"), o("objective", "اهداف امنیت اطلاعات")];
export const AUDIT_KINDS: Option[] = [o("internal", "ممیزی داخلی"), o("external", "ممیزی بیرونی"), o("certification", "صدور گواهی"), o("surveillance", "مراقبتی"), o("supplier", "تأمین‌کننده")];
export const FINDING_KINDS: Option[] = [o("major_nc", "عدم انطباق عمده", "red"), o("minor_nc", "عدم انطباق جزئی", "orange"), o("observation", "مشاهده", "gold"), o("ofi", "فرصت بهبود", "blue")];
export const PROFILE_KINDS: Option[] = [o("current", "وضع موجود"), o("target", "وضع مطلوب"), o("community", "پروفایل جامعه")];
export const TIERS: Option[] = [o("1", "۱ — جزئی"), o("2", "۲ — آگاه از ریسک"), o("3", "۳ — تکرارپذیر"), o("4", "۴ — تطبیقی")];
export const IMPACT_CLASSES: Option[] = [o("not_assessed", "ارزیابی‌نشده", "gray"), o("none", "بی‌اثر", "green"), o("minor", "جزئی", "gold"), o("material", "اساسی", "red")];
export const LEGAL_BASES: Option[] = [o("consent", "رضایت"), o("contract", "قرارداد"), o("legal_obligation", "الزام قانونی"), o("vital_interest", "منافع حیاتی"), o("public_task", "وظیفهٔ عمومی"), o("legitimate_interest", "منافع مشروع")];
export const DSR_KINDS: Option[] = [o("access", "دسترسی"), o("erasure", "حذف"), o("rectification", "اصلاح"), o("portability", "انتقال‌پذیری"), o("objection", "اعتراض"), o("restriction", "محدودسازی پردازش")];
export const RISK_CATEGORIES: Option[] = [
  o("security", "امنیت", "red"), o("operational", "عملیاتی", "orange"), o("compliance", "انطباق", "purple"), o("supplier", "تأمین‌کننده", "gold"), o("project", "پروژه", "blue"),
  o("ai", "هوش مصنوعی", "magenta"), o("privacy", "حریم خصوصی", "indigo"), o("availability", "دسترس‌پذیری و تداوم", "teal"), o("strategic", "راهبردی", "green"), o("financial", "مالی", "gray"),
];
export const LIKELIHOODS: Option[] = [o("1", "۱ — نادر"), o("2", "۲ — بعید"), o("3", "۳ — ممکن"), o("4", "۴ — محتمل"), o("5", "۵ — تقریباً قطعی")];
export const IMPACTS5: Option[] = [o("1", "۱ — ناچیز"), o("2", "۲ — جزئی"), o("3", "۳ — متوسط"), o("4", "۴ — عمده"), o("5", "۵ — فاجعه‌بار")];
export const RISK_RATING_OPTIONS: Option[] = [o("low", "کم", "green"), o("medium", "متوسط", "gold"), o("high", "بالا", "orange"), o("critical", "بحرانی", "red")];
export const CONTROL_EFFECT: Option[] = [o("none", "ندارد"), o("weak", "ضعیف"), o("moderate", "متوسط"), o("strong", "قوی")];
export const TREATMENTS: Option[] = [o("avoid", "اجتناب", "red"), o("reduce", "کاهش", "blue"), o("share", "انتقال یا اشتراک", "purple"), o("accept", "پذیرش", "gold")];
export const KRI_STATUS: Option[] = [o("unknown", "نامعلوم", "gray"), o("ok", "عادی", "green"), o("warn", "هشدار", "gold"), o("breach", "عبور از آستانه", "red")];
export const KRI_DIRECTIONS: Option[] = [o("higher_worse", "مقدار بیشتر بدتر است"), o("lower_worse", "مقدار کمتر بدتر است")];

/** Tenant-editable lists (Settings › «فهرست‌های گزینه»). */
export const SECURITY_CHOICE_LISTS: Record<string, Option[]> = {
  "sec_incident.category": SIR_CATEGORIES,
  "sec_incident.subcategory": [],
  "sec_incident.close_code": SIR_CLOSE_CODES,
  "sec_task.category": [],
  "sec_task.subcategory": [],
  "sec_task.close_code": [],
  "grc_risk.category": RISK_CATEGORIES,
};

const MAIN = "اصلی";

// ---------------------------------------------------------------------------------------------------------------
// Security incidents (SEC-001, SEC-010, SEC-012)

export const SIR_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "analysis", label: "تحلیل", category: "active", color: "teal" },
    { value: "contain", label: "مهار", category: "active", color: "orange" },
    { value: "eradicate", label: "ریشه‌کنی", category: "active", color: "purple" },
    { value: "recover", label: "بازیابی", category: "active", color: "indigo" },
    { value: "review", label: "بازبینی پس از رخداد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "analysis", label: "شروع تحلیل" },
    { from: ["draft", "analysis"], to: "contain", label: "مهار" },
    { from: ["contain"], to: "eradicate", label: "ریشه‌کنی" },
    { from: ["eradicate"], to: "recover", label: "بازیابی" },
    { from: ["contain", "eradicate", "recover"], to: "analysis", label: "بازگشت به تحلیل" },
    { from: ["analysis", "contain", "eradicate", "recover"], to: "review", label: "بازبینی پس از رخداد", requires: ["close_code"], guard: "sec_can_review" },
    { from: ["review"], to: "recover", label: "بازگشت به بازیابی" },
    { from: ["review"], to: "closed", label: "بستن", requires: ["close_notes"], guard: "sec_can_close" },
    { from: ["draft", "analysis"], to: "canceled", label: "لغو", requires: ["close_code", "close_notes"] },
  ],
  locked: ["closed", "canceled"],
};

const IMPACT = "اثر و دامنه";
const TIMES = "زمان‌ها";
const OUTCOME = "نتیجه";
const PIR = "بازبینی پس از رخداد";

const SIR_HIDDEN = ["channel", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "escalation", "parent_id", "approval", "location_id", "time_worked"];

const secIncident: TableDef = {
  key: "sec_incident",
  table: "sm_sec_incidents",
  label: "رخداد امنیتی",
  plural: "رخدادهای امنیتی",
  icon: "shield-alert",
  module: "security",
  area: "security",
  description: "رخداد امنیت اطلاعات با چرخهٔ NIST: تحلیل، مهار، ریشه‌کنی، بازیابی و بازبینی؛ فقط برای اعضای فضای کاری امن «امنیت»",
  extends: "task",
  numbered: { prefix: "SIR", pad: 7 },
  display: "short_description",
  fields: [
    { name: "short_description", label: "عنوان", type: "string", section: MAIN },
    { name: "description", label: "شرح", type: "markdown", section: MAIN, noSync: true },
    { name: "category", label: "دسته", type: "choice", choices: "$table.category", required: true, list: true, filter: true, section: MAIN },
    { name: "severity", label: "شدت", type: "choice", choices: SEVERITIES, default: "3", required: true, list: true, filter: true, sort: true, span: 8, section: MAIN },
    { name: "business_impact", label: "اثر کسب‌وکاری", type: "choice", choices: BUSINESS_IMPACTS, default: "3", required: true, filter: true, span: 8, section: MAIN },
    { name: "classification", label: "طبقه‌بندی داده", type: "choice", choices: CLASSIFICATION_OPTIONS, default: "confidential", required: true, filter: true, span: 8, section: MAIN, help: "«سری»: این پرونده به هیچ مدل هوش مصنوعی نمی‌رسد" },
    { name: "risk_score", label: "امتیاز ریسک", type: "int", system: true, list: true, filter: true, sort: true, span: 8, section: MAIN },
    { name: "priority", label: "اولویت", type: "choice", choices: PRIORITIES, readonly: true, section: MAIN, help: "از امتیاز ریسک حساب می‌شود" },
    { name: "source", label: "منبع", type: "choice", choices: SIR_SOURCES, default: "manual", filter: true, span: 8, section: MAIN },
    { name: "attack_vector", label: "مسیر حمله", type: "choice", choices: ATTACK_VECTORS, filter: true, span: 8, section: MAIN },
    { name: "mitre_techniques", label: "تکنیک‌های MITRE ATT&CK", type: "tags", filter: true, search: true, span: 16, section: MAIN, help: "مانند T1566 یا T1486" },
    { name: "caller_id", label: "گزارش‌دهنده", type: "user", section: MAIN },
    { name: "assignment_group_id", label: "گروه پاسخ", type: "group", section: MAIN },
    { name: "assigned_to", label: "تحلیل‌گر", type: "user", section: MAIN },
    { name: "lead_id", label: "فرماندهٔ پاسخ", type: "user", filter: true, index: true, span: 8, section: MAIN },
    { name: "playbook_id", label: "دستورالعمل پاسخ", type: "ref", ref: "sec_playbook", filter: true, span: 8, section: MAIN },
    { name: "major", label: "رخداد امنیتی عمده", type: "bool", default: false, filter: true, span: 8, section: MAIN, help: "اتاق عملیات، اطلاع‌رسانی به مدیران و بازبینی الزامی" },

    { name: "personal_data_breach", label: "نقض دادهٔ شخصی", type: "bool", default: false, filter: true, span: 8, section: IMPACT, help: "ساعت‌های الزامی اطلاع‌رسانی حریم خصوصی را پیشنهاد می‌کند" },
    { name: "records_affected", label: "تعداد رکوردهای متأثر", type: "int", min: 0, span: 8, section: IMPACT },
    { name: "affected_users", label: "کاربران متأثر", type: "users", span: 24, section: IMPACT },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", section: IMPACT },
    { name: "ci_id", label: "پیکربندی اصلی", type: "ref", ref: "ci", section: IMPACT },
    { name: "affected_cis", label: "پیکربندی‌های متأثر", type: "refs", ref: "ci", span: 12, section: IMPACT },
    { name: "affected_services", label: "خدمت‌های متأثر", type: "refs", ref: "service", span: 12, section: IMPACT },
    { name: "affected_data", label: "دادهٔ متأثر", type: "text", group: "security", noSync: true, span: 24, section: IMPACT, help: "نوع، حجم و دارندگان داده" },
    { name: "it_incident_id", label: "رخداد فناوری اطلاعات", type: "ref", ref: "incident", filter: true, index: true, span: 8, section: IMPACT },
    { name: "problem_id", label: "مشکل", type: "ref", ref: "problem", filter: true, span: 8, section: IMPACT },

    { name: "first_malicious_at", label: "نخستین فعالیت مخرب", type: "datetime", sort: true, filter: true, span: 8, section: TIMES },
    { name: "detected_at", label: "زمان کشف", type: "datetime", sort: true, filter: true, span: 8, section: TIMES },
    { name: "opened_at", label: "زمان ثبت", type: "datetime", section: TIMES },
    { name: "contained_at", label: "زمان مهار", type: "datetime", sort: true, filter: true, span: 8, section: TIMES },
    { name: "eradicated_at", label: "زمان ریشه‌کنی", type: "datetime", sort: true, span: 8, section: TIMES },
    { name: "recovered_at", label: "زمان بازیابی", type: "datetime", sort: true, filter: true, span: 8, section: TIMES },
    { name: "time_to_detect", label: "زمان تا کشف", type: "duration", system: true, sort: true, span: 8, section: TIMES },
    { name: "time_to_contain", label: "زمان تا مهار", type: "duration", system: true, sort: true, span: 8, section: TIMES },
    { name: "time_to_recover", label: "زمان تا بازیابی", type: "duration", system: true, sort: true, span: 8, section: TIMES },
    { name: "sla_due", label: "موعد توافق", type: "datetime", list: true, section: TIMES },
    { name: "due_at", label: "موعد", type: "datetime", section: TIMES },
    { name: "regulatory", label: "اطلاع‌رسانی الزامی", type: "bool", system: true, filter: true, span: 8, section: TIMES },
    { name: "regulatory_overdue", label: "اطلاع‌رسانی الزامی دیرکرد دارد", type: "bool", system: true, filter: true, span: 8, section: TIMES },

    { name: "close_code", label: "نتیجه", type: "choice", choices: "$table.close_code", section: OUTCOME },
    { name: "close_notes", label: "یادداشت پایانی", type: "text", section: OUTCOME },

    { name: "root_cause", label: "علت ریشه‌ای", type: "markdown", group: "security", span: 24, tab: PIR },
    { name: "actions_taken", label: "اقدام‌های انجام‌شده", type: "markdown", span: 24, tab: PIR },
    { name: "lessons", label: "درس‌آموخته‌ها و اقدام‌های پیشگیرانه", type: "markdown", span: 24, tab: PIR, ai: { index: true } },
    { name: "pir_done_at", label: "زمان ثبت بازبینی", type: "datetime", system: true, span: 8, tab: PIR },
    ...hideTaskFields(SIR_HIDDEN),
  ],
  states: SIR_STATES,
  scope: {
    ...TASK_SCOPE,
    own: ["caller_id", "opened_by", "assigned_to", "lead_id"],
    requester: ["caller_id", "opened_by"],
    // the reporter of a security incident changes nothing on it: the SOC works it
    requesterWritable: [],
    requesterTransitions: [],
  },
  features: { sla: true, confidential: true, rag: true, kanban: "state" },
  form: {
    sections: [MAIN, IMPACT, TIMES, OUTCOME],
    tabs: ["جزئیات", PIR],
    related: [
      { table: "sec_task", field: "sec_incident_id", label: "کارهای پاسخ", columns: ["number", "short_description", "phase", "state", "action", "assigned_to"] },
      { table: "sec_evidence", field: "sec_incident_id", label: "شواهد", columns: ["number", "title", "kind", "state", "custodian_id", "legal_hold"] },
      { table: "sec_reg_clock", field: "sec_incident_id", label: "ساعت‌های الزامی", columns: ["number", "regime_id", "state", "next_stage", "next_due_at", "overdue"] },
    ],
  },
  list: { columns: ["number", "short_description", "category", "severity", "risk_score", "state", "assigned_to", "sla_due", "updated_at"], order: "-risk_score,-opened_at" },
  ai: { title: "short_description", text: ["description", "lessons"] },
};

const SEC_TASK_STATES: StateModel = {
  ...CHILD_TASK_STATES,
  transitions: CHILD_TASK_STATES.transitions.map((t) => (t.to === "closed_complete" ? { ...t, guard: "sec_task_can_complete" } : t)),
};

const secTask: TableDef = {
  key: "sec_task",
  table: "sm_sec_tasks",
  label: "کار پاسخ",
  plural: "کارهای پاسخ",
  icon: "list-checks",
  module: "security",
  area: "security",
  description: "گامی از پاسخ به یک رخداد امنیتی؛ اقدام‌های مهار (جداسازی، مسدودسازی، غیرفعال‌سازی) پیش از انجام تأیید انسانی می‌خواهند",
  extends: "task",
  numbered: { prefix: "SIT", pad: 7 },
  display: "short_description",
  fields: [
    { name: "sec_incident_id", label: "رخداد امنیتی", type: "ref", ref: "sec_incident", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "phase", label: "مرحله", type: "choice", choices: PHASES, default: "analysis", list: true, filter: true, span: 6 },
    { name: "mandatory", label: "لازم برای بستن", type: "bool", default: true, filter: true, span: 6 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 6 },
    { name: "action", label: "اقدام مهار", type: "choice", choices: CONTAINMENT_ACTIONS, default: "none", list: true, filter: true, span: 8 },
    { name: "action_target", label: "هدف اقدام", type: "string", maxLength: 255, ltr: true, span: 8, help: "میزبان، نشانی، حساب یا صندوق" },
    { name: "requires_approval", label: "تأیید انسانی لازم است", type: "bool", default: false, filter: true, span: 8 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "executed_at", label: "زمان اجرا", type: "datetime", system: true, sort: true, span: 8 },
    { name: "executed_by", label: "اجراکننده", type: "user", system: true, span: 8 },
    { name: "action_result", label: "نتیجهٔ اقدام", type: "text", span: 24 },
    ...hideTaskFields(["channel", "category", "subcategory", "impact", "urgency", "requested_for", "offering_id", "knowledge", "escalation", "parent_id", "close_code", "service_id", "location_id"]),
  ],
  states: SEC_TASK_STATES,
  scope: { ...TASK_SCOPE, requesterWritable: [], requesterTransitions: [] },
  features: { approvals: true },
  list: { columns: ["number", "short_description", "sec_incident_id", "phase", "state", "action", "approval", "assigned_to"], order: "sort_order,number" },
};

const secObservable: TableDef = {
  key: "sec_observable",
  table: "sm_sec_observables",
  label: "نشانگر",
  plural: "نشانگرها و اطلاعات تهدید",
  icon: "fingerprint",
  module: "security",
  area: "security",
  description: "نشانی IP، دامنه، نشانی وب، هش یا رایانامه — نشانگر یک رخداد یا نشانگر تهدید (IOC) — با رأی، اعتماد، مهلت اعتبار و رخدادهایی که در آن‌ها دیده شده است",
  display: "value",
  fields: [
    { name: "value", label: "مقدار", type: "string", required: true, maxLength: 500, ltr: true, list: true, search: true, span: 16 },
    { name: "type", label: "نوع", type: "choice", choices: OBSERVABLE_TYPE_OPTIONS, required: true, list: true, filter: true, span: 8 },
    { name: "normalized", label: "مقدار یکسان‌شده", type: "string", maxLength: 500, ltr: true, system: true, index: true, search: true, span: 24 },
    { name: "verdict", label: "رأی", type: "choice", choices: VERDICTS, default: "unknown", list: true, filter: true, span: 8 },
    { name: "confidence", label: "اعتماد (۰ تا ۱۰۰)", type: "int", min: 0, max: 100, default: 50, span: 8 },
    { name: "tlp", label: "سطح اشتراک (TLP)", type: "choice", choices: TLP, default: "amber", filter: true, span: 8 },
    { name: "is_ioc", label: "نشانگر تهدید (IOC)", type: "bool", default: false, list: true, filter: true, span: 8, help: "در شکار تهدید و هشدارها به کار می‌رود" },
    { name: "source", label: "منبع", type: "choice", choices: OBSERVABLE_SOURCES, default: "manual", filter: true, span: 8 },
    { name: "mitre", label: "تکنیک‌های MITRE", type: "tags", filter: true, span: 8 },
    { name: "incidents", label: "رخدادهای امنیتی", type: "refs", ref: "sec_incident", span: 24 },
    { name: "sightings", label: "دفعات دیده‌شدن", type: "int", system: true, default: 0, list: true, sort: true, span: 8 },
    { name: "first_seen", label: "نخستین مشاهده", type: "datetime", sort: true, span: 8 },
    { name: "last_seen", label: "آخرین مشاهده", type: "datetime", list: true, sort: true, span: 8 },
    { name: "expires_at", label: "پایان اعتبار", type: "datetime", sort: true, filter: true, span: 8, help: "نشانگرهای منقضی از جست‌وجوی تهدید کنار می‌روند" },
    { name: "enrichment", label: "غنی‌سازی", type: "json", system: true, audit: false, span: 24 },
    { name: "enriched_at", label: "زمان غنی‌سازی", type: "datetime", system: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, index: true, span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  unique: [["type", "normalized"]],
  scope: { group: "assignment_group_id" },
  features: { journal: true, links: true },
  list: { columns: ["value", "type", "verdict", "is_ioc", "sightings", "last_seen"], order: "-last_seen" },
};

export const EVIDENCE_STATES: StateModel = {
  field: "state",
  initial: "collected",
  states: [
    { value: "collected", label: "گردآوری‌شده", category: "new", color: "blue" },
    { value: "in_analysis", label: "در تحلیل", category: "active", color: "teal" },
    { value: "stored", label: "بایگانی امن", category: "waiting", color: "indigo" },
    { value: "released", label: "تحویل یا آزادشده", category: "closed", color: "gray" },
    { value: "destroyed", label: "امحاشده", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["collected", "stored"], to: "in_analysis", label: "شروع تحلیل" },
    { from: ["collected", "in_analysis"], to: "stored", label: "بایگانی امن" },
    { from: ["stored", "in_analysis"], to: "released", label: "تحویل یا آزادسازی", requires: ["notes"], guard: "sec_evidence_release" },
    { from: ["stored"], to: "destroyed", label: "امحا", requires: ["notes"], guard: "sec_evidence_release" },
  ],
  locked: ["closed"],
};

const secEvidence: TableDef = {
  key: "sec_evidence",
  table: "sm_sec_evidence",
  label: "شاهد",
  plural: "شواهد و زنجیرهٔ حضانت",
  icon: "file-lock-2",
  module: "security",
  area: "security",
  description: "شاهد یک رخداد امنیتی با هش SHA-256، نگه‌دارنده، محل نگهداری، توقیف قانونی و دفتر زنجیرهٔ حضانت",
  numbered: { prefix: "EVD", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "kind", label: "نوع", type: "choice", choices: EVIDENCE_KINDS, default: "file", list: true, filter: true, span: 8 },
    { name: "sec_incident_id", label: "رخداد امنیتی", type: "ref", ref: "sec_incident", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "sha256", label: "هش SHA-256", type: "string", maxLength: 64, ltr: true, search: true, index: true, span: 12, help: "خالی: از نخستین پیوست حساب می‌شود" },
    { name: "description", label: "شرح", type: "text", noSync: true, span: 24 },
    { name: "collected_at", label: "زمان گردآوری", type: "datetime", default: "$now", sort: true, span: 8 },
    { name: "collected_by", label: "گردآورنده", type: "user", default: "$me", span: 8 },
    { name: "custodian_id", label: "نگه‌دارندهٔ کنونی", type: "user", default: "$me", list: true, filter: true, span: 8 },
    { name: "location", label: "محل نگهداری", type: "string", maxLength: 200, span: 12 },
    { name: "legal_hold", label: "توقیف قانونی", type: "bool", default: false, list: true, filter: true, span: 6, help: "تا برداشته نشود، شاهد امحا یا آزاد نمی‌شود" },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 6 },
    { name: "custody_log", label: "دفتر زنجیرهٔ حضانت", type: "json", system: true, default: [], span: 24 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  states: EVIDENCE_STATES,
  scope: { own: ["custodian_id", "collected_by"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true, confidential: true },
  list: { columns: ["number", "title", "kind", "sec_incident_id", "state", "custodian_id", "legal_hold"], order: "-collected_at" },
};

export const REG_CLOCK_STATES: StateModel = {
  field: "state",
  initial: "running",
  states: [
    { value: "running", label: "در جریان", category: "active", color: "orange" },
    { value: "submitted", label: "همهٔ گزارش‌ها فرستاده شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "not_required", label: "لازم نیست", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["running"], to: "submitted", label: "همهٔ گزارش‌ها فرستاده شد", guard: "sec_reg_all_submitted" },
    { from: ["submitted"], to: "closed", label: "بستن" },
    { from: ["submitted"], to: "running", label: "بازگشایی" },
    { from: ["running"], to: "not_required", label: "لازم نیست", requires: ["notes"] },
  ],
  locked: ["closed", "canceled"],
};

const secRegClock: TableDef = {
  key: "sec_reg_clock",
  table: "sm_sec_reg_clocks",
  label: "ساعت اطلاع‌رسانی الزامی",
  plural: "ساعت‌های اطلاع‌رسانی الزامی",
  icon: "alarm-clock",
  module: "security",
  area: "security",
  description: "موعدهای قانونی گزارش یک رخداد به نهادهای ناظر (به ساعت تقویمی از لحظهٔ آگاهی) با ارسال‌ها و شاهد آن‌ها",
  numbered: { prefix: "REG", pad: 6 },
  display: "authority",
  fields: [
    { name: "sec_incident_id", label: "رخداد امنیتی", type: "ref", ref: "sec_incident", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "regime_id", label: "مقررات", type: "ref", ref: "sec_reg_regime", required: true, list: true, filter: true, span: 12 },
    { name: "aware_at", label: "لحظهٔ آگاهی", type: "datetime", required: true, default: "$now", sort: true, span: 8 },
    { name: "authority", label: "نهاد ناظر", type: "string", maxLength: 200, span: 8 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, span: 8 },
    { name: "next_stage", label: "مرحلهٔ بعد", type: "string", maxLength: 120, system: true, list: true, span: 8 },
    { name: "next_due_at", label: "موعد بعدی", type: "datetime", system: true, list: true, sort: true, filter: true, span: 8 },
    { name: "overdue", label: "دیرکرد", type: "bool", system: true, list: true, filter: true, span: 8 },
    { name: "deadlines", label: "موعدها و ارسال‌ها", type: "json", system: true, default: [], span: 24 },
    { name: "reference", label: "شمارهٔ پیگیری نزد نهاد", type: "string", maxLength: 120, ltr: true, span: 12 },
    { name: "submitted_at", label: "زمان آخرین ارسال", type: "datetime", system: true, span: 12 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 12 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  states: REG_CLOCK_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true },
  list: { columns: ["number", "sec_incident_id", "regime_id", "state", "next_stage", "next_due_at", "overdue"], order: "next_due_at" },
};

const secRegRegime: TableDef = {
  key: "sec_reg_regime",
  table: "sm_sec_reg_regimes",
  label: "مقررات اطلاع‌رسانی",
  plural: "مقررات اطلاع‌رسانی",
  icon: "landmark",
  module: "security",
  area: "security",
  description: "یک الزام گزارش‌دهی (مرکز ماهر، افتا، بانک مرکزی، GDPR، NIS2…) با مرحله‌ها و ساعت‌هایشان",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 60, ltr: true, unique: true, list: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "authority", label: "نهاد ناظر", type: "string", maxLength: 200, list: true, span: 12 },
    { name: "personal_data", label: "ویژهٔ نقض دادهٔ شخصی", type: "bool", default: false, filter: true, span: 6 },
    { name: "placeholder", label: "جای‌نگهدار (نیازمند تطبیق)", type: "bool", default: false, filter: true, span: 6 },
    { name: "stages", label: "مرحله‌ها (کلید، عنوان، ساعت)", type: "json", required: true, default: [], span: 24 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "authority", "personal_data", "placeholder", "active"], order: "name" },
};

const secPlaybook: TableDef = {
  key: "sec_playbook",
  table: "sm_sec_playbooks",
  label: "دستورالعمل پاسخ",
  plural: "دستورالعمل‌های پاسخ",
  icon: "book-open-check",
  module: "security",
  area: "security",
  description: "گام‌های پاسخ به یک دستهٔ رخداد امنیتی به ترتیب مرحله؛ گام‌های دارای اقدام مهار تأیید انسانی می‌خواهند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "category", label: "دستهٔ رخداد", type: "choice", choices: "sec_incident.category", required: true, list: true, filter: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "auto_apply", label: "به رخدادهای تازهٔ این دسته افزوده شود", type: "bool", default: true, span: 12 },
    { name: "revision", label: "ویرایش", type: "int", system: true, default: 1, span: 6 },
    { name: "steps", label: "گام‌ها", type: "json", required: true, default: [], span: 24, help: "[{ title, phase, mandatory, action, approval }]" },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "category", "auto_apply", "active"], order: "category,name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Vulnerability response (SEC-014 … SEC-023, SEC-025)

const secVulnerability: TableDef = {
  key: "sec_vulnerability",
  table: "sm_sec_vulnerabilities",
  label: "آسیب‌پذیری",
  plural: "کتابخانهٔ آسیب‌پذیری‌ها",
  icon: "bug",
  module: "security",
  area: "security",
  description: "یک آسیب‌پذیری شناخته‌شده (CVE یا شناسهٔ پویشگر) با CVSS، احتمال بهره‌برداری (EPSS)، فهرست KEV، بلوغ بهره‌بردار و راه‌حل",
  display: "cve_id",
  fields: [
    { name: "cve_id", label: "شناسه", type: "string", required: true, maxLength: 60, ltr: true, unique: true, list: true, search: true, sort: true, span: 8 },
    { name: "title", label: "عنوان", type: "string", maxLength: 300, list: true, search: true, span: 16 },
    { name: "severity", label: "شدت (CVSS)", type: "choice", choices: VULN_SEVERITY_OPTIONS, readonly: true, list: true, filter: true, span: 6 },
    { name: "cvss_score", label: "امتیاز CVSS", type: "decimal", min: 0, max: 10, list: true, sort: true, filter: true, span: 6 },
    { name: "cvss_version", label: "نسخهٔ CVSS", type: "choice", choices: [o("2.0", "2.0"), o("3.0", "3.0"), o("3.1", "3.1"), o("4.0", "4.0")], span: 6 },
    { name: "cvss_vector", label: "بردار CVSS", type: "string", maxLength: 200, ltr: true, span: 6 },
    { name: "epss", label: "احتمال بهره‌برداری (EPSS)", type: "decimal", min: 0, max: 1, sort: true, filter: true, span: 6 },
    { name: "epss_percentile", label: "صدک EPSS", type: "decimal", min: 0, max: 1, span: 6 },
    { name: "kev", label: "در فهرست KEV", type: "bool", default: false, list: true, filter: true, span: 6 },
    { name: "kev_due", label: "موعد KEV", type: "date", filter: true, span: 6 },
    { name: "exploit_maturity", label: "بلوغ بهره‌بردار", type: "choice", choices: EXPLOIT_MATURITY, default: "none", filter: true, span: 8 },
    { name: "published_at", label: "تاریخ انتشار", type: "date", sort: true, span: 8 },
    { name: "cwe", label: "CWE", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "vendor", label: "سازنده", type: "string", maxLength: 120, filter: true, span: 8 },
    { name: "product", label: "محصول", type: "string", maxLength: 160, search: true, span: 8 },
    { name: "source", label: "منبع", type: "choice", choices: [o("scanner", "پویشگر"), o("feed", "خوراک"), o("bundle", "بستهٔ آفلاین امضاشده"), o("manual", "دستی")], default: "manual", filter: true, span: 8 },
    { name: "affected_versions", label: "نسخه‌های آسیب‌پذیر", type: "text", span: 12 },
    { name: "fixed_versions", label: "نسخه‌های رفع‌شده", type: "text", span: 12 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    { name: "solution", label: "راه‌حل", type: "markdown", span: 24 },
    { name: "advisories", label: "توصیه‌نامه‌ها و پیوندها", type: "text", ltr: true, span: 24 },
    { name: "open_items", label: "موردهای باز", type: "int", system: true, default: 0, list: true, sort: true, span: 8 },
    { name: "last_seen_at", label: "آخرین مشاهده", type: "datetime", system: true, sort: true, span: 8 },
  ],
  scope: { public: true },
  features: { links: true },
  list: { columns: ["cve_id", "title", "severity", "cvss_score", "kev", "open_items"], order: "-cvss_score,cve_id" },
};

export const VULN_ITEM_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "red" },
    { value: "in_remediation", label: "در حال رفع", category: "active", color: "teal" },
    { value: "deferred", label: "به تعویق", category: "waiting", color: "gold" },
    { value: "exception", label: "استثنا", category: "waiting", color: "purple" },
    { value: "fixed", label: "رفع‌شده", category: "resolved", color: "green" },
    { value: "closed", label: "بسته (تأییدشده)", category: "closed", color: "gray" },
    { value: "false_positive", label: "مثبت کاذب", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "in_remediation", label: "شروع رفع" },
    { from: ["open", "in_remediation"], to: "deferred", label: "تعویق", guard: "sec_vuln_exception_approved", roles: { area: "security", level: "full" } },
    { from: ["open", "in_remediation"], to: "exception", label: "استثنا", guard: "sec_vuln_exception_approved", roles: { area: "security", level: "full" } },
    { from: ["deferred", "exception", "in_remediation"], to: "open", label: "بازگشایی" },
    { from: ["open", "in_remediation", "deferred", "exception"], to: "fixed", label: "رفع شد", requires: ["close_notes"] },
    { from: ["fixed"], to: "closed", label: "تأیید رفع" },
    { from: ["fixed", "closed"], to: "open", label: "بازگشایی (دوباره دیده شد)" },
    { from: ["open", "in_remediation"], to: "false_positive", label: "مثبت کاذب", requires: ["close_notes"] },
    { from: ["false_positive"], to: "open", label: "بازگشایی" },
  ],
  locked: ["closed", "canceled"],
};

const VIT_FINDING = "یافته";
const VIT_RISK = "ریسک و موعد";
const VIT_FIX = "رفع";

const secVulnItem: TableDef = {
  key: "sec_vuln_item",
  table: "sm_sec_vuln_items",
  label: "مورد آسیب‌پذیر",
  plural: "موردهای آسیب‌پذیر",
  icon: "shield-x",
  module: "security",
  area: "security",
  description: "یک آسیب‌پذیری روی یک پیکربندی (یا میزبانی که هنوز در پایگاه پیکربندی نیست)، یکی برای هر جفت دارایی و آسیب‌پذیری، با ریسک، موعد رفع از نخستین کشف و مسیر رفع",
  numbered: { prefix: "VIT", pad: 7 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24, section: VIT_FINDING },
    { name: "vulnerability_id", label: "آسیب‌پذیری", type: "ref", ref: "sec_vulnerability", required: true, list: true, filter: true, index: true, span: 12, section: VIT_FINDING },
    { name: "ci_id", label: "پیکربندی", type: "ref", ref: "ci", list: true, filter: true, index: true, span: 12, section: VIT_FINDING },
    { name: "host", label: "میزبان گزارش‌شده", type: "string", maxLength: 255, ltr: true, search: true, filter: true, index: true, span: 8, section: VIT_FINDING },
    { name: "ip_address", label: "نشانی IP", type: "ip", ltr: true, filter: true, span: 8, section: VIT_FINDING },
    { name: "port", label: "درگاه", type: "int", min: 0, max: 65535, span: 6, section: VIT_FINDING },
    { name: "protocol", label: "پروتکل", type: "string", maxLength: 10, ltr: true, span: 6, section: VIT_FINDING },
    { name: "service_id", label: "خدمت", type: "ref", ref: "service", readonly: true, filter: true, span: 8, section: VIT_FINDING },
    { name: "source", label: "پویشگر", type: "choice", choices: SCANNERS, default: "manual", filter: true, span: 8, section: VIT_FINDING },
    { name: "scanner_ref", label: "شناسهٔ بررسی پویشگر", type: "string", maxLength: 120, ltr: true, span: 8, section: VIT_FINDING },
    { name: "dedupe_key", label: "کلید یکتایی", type: "string", maxLength: 400, ltr: true, system: true, hidden: true, index: true },
    { name: "first_detected_at", label: "نخستین کشف", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: VIT_FINDING },
    { name: "last_seen_at", label: "آخرین مشاهده", type: "datetime", readonly: true, sort: true, filter: true, span: 8, section: VIT_FINDING },
    { name: "times_seen", label: "دفعات مشاهده", type: "int", readonly: true, default: 0, span: 8, section: VIT_FINDING },
    { name: "last_scan_id", label: "آخرین پویش", type: "ref", ref: "sec_scan_import", readonly: true, span: 8, section: VIT_FINDING },
    { name: "missing_since", label: "دیده نشده از", type: "datetime", system: true, span: 8, section: VIT_FINDING },
    { name: "proof", label: "خروجی پویشگر", type: "text", readonly: true, span: 24, section: VIT_FINDING },

    { name: "cvss_score", label: "امتیاز CVSS", type: "decimal", readonly: true, sort: true, span: 6, section: VIT_RISK },
    { name: "epss", label: "EPSS", type: "decimal", readonly: true, span: 6, section: VIT_RISK },
    { name: "kev", label: "در فهرست KEV", type: "bool", readonly: true, filter: true, span: 6, section: VIT_RISK },
    { name: "asset_criticality", label: "اهمیت دارایی", type: "choice", choices: CI_CRITICALITY, readonly: true, filter: true, span: 6, section: VIT_RISK },
    { name: "exposure", label: "در معرض بودن", type: "choice", choices: EXPOSURES, default: "internal", filter: true, span: 8, section: VIT_RISK },
    { name: "compensating", label: "کنترل جبرانی", type: "choice", choices: COMPENSATING, default: "none", filter: true, span: 8, section: VIT_RISK },
    { name: "risk_score", label: "امتیاز ریسک", type: "int", system: true, list: true, sort: true, filter: true, span: 8, section: VIT_RISK },
    { name: "risk_rating", label: "ردهٔ ریسک", type: "choice", choices: VULN_RATING_OPTIONS, system: true, list: true, filter: true, sort: true, index: true, span: 8, section: VIT_RISK },
    { name: "ssvc", label: "تصمیم SSVC", type: "choice", choices: SSVC, system: true, filter: true, span: 8, section: VIT_RISK },
    { name: "risk_factors", label: "عامل‌های ریسک", type: "json", system: true, audit: false, hidden: true },
    { name: "due_at", label: "موعد رفع", type: "datetime", system: true, list: true, sort: true, filter: true, span: 8, section: VIT_RISK },
    { name: "overdue", label: "گذشته از موعد", type: "bool", system: true, filter: true, span: 8, section: VIT_RISK },
    { name: "sla_due", label: "موعد توافق", type: "datetime", system: true, sort: true, span: 8, section: VIT_RISK },

    { name: "assignment_group_id", label: "گروه رفع", type: "group", list: true, filter: true, index: true, span: 8, section: VIT_FIX },
    { name: "assigned_to", label: "مسئول رفع", type: "user", filter: true, index: true, span: 8, section: VIT_FIX },
    { name: "remediation_id", label: "گروه رفع (راه‌حل)", type: "ref", ref: "sec_vuln_remediation", filter: true, index: true, span: 8, section: VIT_FIX },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", filter: true, span: 8, section: VIT_FIX },
    { name: "exception_id", label: "استثنا", type: "ref", ref: "sec_vuln_exception", readonly: true, filter: true, span: 8, section: VIT_FIX },
    { name: "vex_status", label: "وضعیت VEX", type: "choice", choices: VEX_STATUSES, default: "affected", filter: true, span: 8, section: VIT_FIX },
    { name: "vex_justification", label: "توجیه VEX", type: "choice", choices: VEX_JUSTIFICATIONS, span: 8, section: VIT_FIX },
    { name: "fixed_at", label: "زمان رفع", type: "datetime", system: true, sort: true, span: 8, section: VIT_FIX },
    { name: "verified_at", label: "تأیید با پویش", type: "datetime", system: true, span: 8, section: VIT_FIX },
    { name: "reopen_count", label: "دفعات بازگشایی", type: "int", system: true, default: 0, span: 8, section: VIT_FIX },
    { name: "close_notes", label: "یادداشت رفع یا بستن", type: "text", span: 24, section: VIT_FIX },
    { name: "watch_list", label: "پیگیری‌کنندگان", type: "users", span: 24, section: VIT_FIX },
  ],
  states: VULN_ITEM_STATES,
  unique: [["dedupe_key"]],
  scope: { own: ["assigned_to"], group: "assignment_group_id", watchers: "watch_list", requester: [] },
  features: { journal: true, attachments: true, links: true, sla: true, watchers: true, kanban: "state" },
  form: { sections: [VIT_FINDING, VIT_RISK, VIT_FIX] },
  list: { columns: ["number", "title", "ci_id", "host", "risk_rating", "risk_score", "state", "due_at", "assignment_group_id"], order: "-risk_score,due_at" },
};

export const REMEDIATION_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال رفع", category: "active", color: "teal" },
    { value: "completed", label: "انجام شد", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "in_progress", label: "شروع" },
    { from: ["open", "in_progress"], to: "completed", label: "انجام شد" },
    { from: ["completed"], to: "in_progress", label: "بازگشایی" },
    { from: ["completed"], to: "closed", label: "بستن" },
    { from: ["open", "in_progress"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const secRemediation: TableDef = {
  key: "sec_vuln_remediation",
  table: "sm_sec_vuln_remediations",
  label: "گروه رفع آسیب‌پذیری",
  plural: "گروه‌های رفع آسیب‌پذیری",
  icon: "wrench",
  module: "security",
  area: "security",
  description: "یک کار رفع برای همهٔ موردهایی که با یک راه‌حل (وصله، ارتقا، پیکربندی) و یک گروه پشتیبانی رفع می‌شوند",
  numbered: { prefix: "VG", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "vulnerability_id", label: "آسیب‌پذیری", type: "ref", ref: "sec_vulnerability", list: true, filter: true, index: true, span: 12 },
    { name: "basis", label: "گروه‌بندی بر پایهٔ", type: "choice", choices: [o("solution", "راه‌حل"), o("cve", "آسیب‌پذیری"), o("owner", "گروه مالک")], default: "solution", span: 12 },
    { name: "assignment_group_id", label: "گروه رفع", type: "group", list: true, filter: true, index: true, span: 8 },
    { name: "assigned_to", label: "مسئول", type: "user", list: true, filter: true, span: 8 },
    { name: "due_at", label: "موعد (زودترین مورد)", type: "datetime", system: true, list: true, sort: true, span: 8 },
    { name: "item_count", label: "موردها", type: "int", system: true, default: 0, list: true, span: 6 },
    { name: "open_count", label: "موردهای باز", type: "int", system: true, default: 0, list: true, span: 6 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", filter: true, span: 12 },
    { name: "solution", label: "راه‌حل", type: "markdown", span: 24 },
  ],
  states: REMEDIATION_STATES,
  scope: { own: ["assigned_to"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true, kanban: "state" },
  form: { related: [{ table: "sec_vuln_item", field: "remediation_id", label: "موردهای آسیب‌پذیر", columns: ["number", "title", "ci_id", "risk_rating", "state", "due_at"] }] },
  list: { columns: ["number", "title", "assignment_group_id", "state", "open_count", "item_count", "due_at"], order: "due_at" },
};

export const EXCEPTION_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "requested", label: "در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "approved", label: "تأییدشده", category: "active", color: "green" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "red" },
    { value: "expired", label: "منقضی", category: "closed", color: "gray" },
    { value: "revoked", label: "ابطال‌شده", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft", "rejected"], to: "requested", label: "درخواست تأیید", guard: "sec_exception_valid" },
    { from: ["requested"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["requested"], to: "approved", label: "تأیید", roles: { area: "security", level: "full" }, guard: "sec_exception_valid" },
    { from: ["requested"], to: "rejected", label: "رد", roles: { area: "security", level: "full" } },
    { from: ["approved"], to: "revoked", label: "ابطال", requires: ["notes"] },
    { from: ["approved"], to: "expired", label: "انقضا", roles: { area: "security", level: "full" } },
  ],
  locked: ["closed"],
};

const secException: TableDef = {
  key: "sec_vuln_exception",
  table: "sm_sec_vuln_exceptions",
  label: "استثنای آسیب‌پذیری",
  plural: "استثناهای آسیب‌پذیری",
  icon: "shield-question",
  module: "security",
  area: "security",
  description: "تعویق، پذیرش ریسک، «متأثر نیست» با توجیه VEX یا مثبت کاذب، با کنترل جبرانی، تأییدکننده و تاریخ انقضا",
  numbered: { prefix: "EXC", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "kind", label: "نوع", type: "choice", choices: EXCEPTION_KINDS, default: "deferral", required: true, list: true, filter: true, span: 8 },
    { name: "vulnerability_id", label: "آسیب‌پذیری", type: "ref", ref: "sec_vulnerability", filter: true, span: 8 },
    { name: "expires_at", label: "تاریخ انقضا", type: "date", required: true, list: true, sort: true, filter: true, span: 8 },
    { name: "items", label: "موردهای آسیب‌پذیر", type: "refs", ref: "sec_vuln_item", span: 24 },
    { name: "justification", label: "توجیه", type: "text", required: true, span: 24 },
    { name: "vex_justification", label: "توجیه VEX", type: "choice", choices: VEX_JUSTIFICATIONS, span: 12, help: "برای «متأثر نیست» لازم است" },
    { name: "compensating_controls", label: "کنترل‌های جبرانی", type: "text", span: 24 },
    { name: "requested_by", label: "درخواست‌کننده", type: "user", default: "$me", filter: true, span: 8 },
    { name: "approver_id", label: "تأییدکننده", type: "user", filter: true, span: 8, help: "خالی: گروه مدیریت آسیب‌پذیری" },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "approved_at", label: "زمان تأیید", type: "datetime", system: true, span: 8 },
    { name: "approved_by", label: "تأییدشده با", type: "user", system: true, span: 8 },
    { name: "warned_at", label: "یادآوری انقضا", type: "datetime", system: true, audit: false, span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  states: EXCEPTION_STATES,
  scope: { own: ["requested_by", "approver_id"], group: "assignment_group_id", requester: ["requested_by"] },
  features: { journal: true, attachments: true, links: true, approvals: true },
  list: { columns: ["number", "title", "kind", "state", "expires_at", "requested_by", "approval"], order: "expires_at" },
};

const secScanImport: TableDef = {
  key: "sec_scan_import",
  table: "sm_sec_scan_imports",
  label: "ورود پویش",
  plural: "ورودهای پویش",
  icon: "scan-search",
  module: "security",
  area: "security",
  description: "یک پروندهٔ خروجی پویشگر (Nessus، Qualys، OpenVAS) که به موردهای آسیب‌پذیر تبدیل شد، با شمار ساخته، به‌روز، بازگشایی و بسته‌شده‌ها",
  numbered: { prefix: "SCN", pad: 6 },
  display: "name",
  fields: [
    { name: "name", label: "پرونده", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "scanner", label: "پویشگر", type: "choice", choices: SCANNERS, list: true, filter: true, span: 6 },
    { name: "format", label: "قالب", type: "choice", choices: [o("csv", "CSV"), o("xml", "XML"), o("json", "JSON")], span: 6 },
    { name: "imported_at", label: "زمان ورود", type: "datetime", readonly: true, list: true, sort: true, span: 8 },
    { name: "imported_by", label: "واردکننده", type: "user", readonly: true, filter: true, span: 8 },
    { name: "hosts", label: "میزبان‌ها", type: "int", readonly: true, default: 0, span: 8 },
    { name: "finding_count", label: "یافته‌ها", type: "int", readonly: true, default: 0, list: true, span: 6 },
    { name: "created_count", label: "ساخته", type: "int", readonly: true, default: 0, list: true, span: 6 },
    { name: "updated_count", label: "به‌روز", type: "int", readonly: true, default: 0, span: 6 },
    { name: "reopened_count", label: "بازگشایی", type: "int", readonly: true, default: 0, list: true, span: 6 },
    { name: "closed_count", label: "رفع‌شده (دیده نشد)", type: "int", readonly: true, default: 0, list: true, span: 6 },
    { name: "unmatched_count", label: "بی‌پیکربندی", type: "int", readonly: true, default: 0, list: true, span: 6 },
    { name: "skipped_count", label: "کنارگذاشته (اطلاعاتی)", type: "int", readonly: true, default: 0, span: 6 },
    { name: "covered_cis", label: "پیکربندی‌های پویش‌شده", type: "refs", ref: "ci", readonly: true, span: 24 },
    { name: "errors", label: "خطاها", type: "json", readonly: true, default: [], span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["number", "name", "scanner", "imported_at", "finding_count", "created_count", "reopened_count", "closed_count", "unmatched_count"], order: "-imported_at" },
};

export const SEC_REVIEW_STATES: StateModel = {
  field: "state",
  initial: "requested",
  states: [
    { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
    { value: "in_review", label: "در بازبینی", category: "active", color: "teal" },
    { value: "completed", label: "انجام شد", category: "closed", color: "green" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["requested"], to: "in_review", label: "شروع بازبینی" },
    { from: ["requested", "in_review"], to: "completed", label: "ثبت نتیجه", requires: ["decision"] },
    { from: ["requested", "in_review"], to: "canceled", label: "لغو" },
    { from: ["completed"], to: "in_review", label: "بازگشایی" },
  ],
  locked: ["canceled"],
};

const secReview: TableDef = {
  key: "sec_review",
  table: "sm_sec_reviews",
  label: "بازبینی امنیتی",
  plural: "بازبینی‌های امنیتی",
  icon: "scan-eye",
  module: "security",
  area: "security",
  description: "دروازهٔ امنیتی در فرایندهای دیگر: بازبینی تغییرهایی که به رمزها، مرز هویت و دسترسی، دادهٔ شخصی یا در معرض اینترنت بودن دست می‌زنند",
  numbered: { prefix: "SRV", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "kind", label: "موضوع", type: "choice", choices: REVIEW_KINDS, default: "change", list: true, filter: true, span: 8 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", list: true, filter: true, index: true, span: 8 },
    { name: "due_at", label: "موعد", type: "datetime", list: true, sort: true, span: 8 },
    { name: "flags", label: "نشانه‌ها", type: "tags", readonly: true, filter: true, span: 24 },
    { name: "reviewer_id", label: "بازبین", type: "user", list: true, filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "decision", label: "نتیجه", type: "choice", choices: REVIEW_DECISIONS, list: true, filter: true, span: 8 },
    { name: "findings", label: "یافته‌ها", type: "markdown", span: 24 },
    { name: "conditions", label: "شرط‌ها", type: "text", span: 24 },
  ],
  states: SEC_REVIEW_STATES,
  scope: { own: ["reviewer_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, links: true },
  list: { columns: ["number", "title", "kind", "change_id", "state", "decision", "reviewer_id", "due_at"], order: "-created_at" },
};

const secVerification: TableDef = {
  key: "sec_verification",
  table: "sm_sec_verifications",
  label: "احراز هویت تماس‌گیرنده",
  plural: "احراز هویت‌های تماس‌گیرنده",
  icon: "badge-check",
  module: "security",
  area: "security",
  description: "رمز یک‌بارمصرفی که پیش از اقدام حساس (بازنشانی گذرواژه، تغییر دسترسی) برای فرد فرستاده و از او پرسیده می‌شود",
  display: "record_number",
  fields: [
    { name: "user_id", label: "فرد", type: "user", required: true, readonly: true, list: true, filter: true, index: true, span: 8 },
    { name: "record_table", label: "جدول", type: "string", maxLength: 60, readonly: true, ltr: true, span: 8 },
    { name: "record_id", label: "شناسهٔ رکورد", type: "string", maxLength: 36, readonly: true, ltr: true, index: true, span: 8 },
    { name: "record_number", label: "رکورد", type: "string", maxLength: 40, readonly: true, list: true, ltr: true, span: 8 },
    { name: "channel", label: "مجرا", type: "choice", choices: VERIFY_CHANNELS, readonly: true, list: true, span: 8 },
    { name: "status", label: "نتیجه", type: "choice", choices: VERIFY_STATUSES, readonly: true, default: "pending", list: true, filter: true, span: 8 },
    { name: "code_hash", label: "چکیدهٔ رمز", type: "string", maxLength: 128, system: true, hidden: true, noSync: true, audit: false },
    { name: "expires_at", label: "انقضا", type: "datetime", readonly: true, span: 8 },
    { name: "attempts", label: "تلاش‌ها", type: "int", readonly: true, default: 0, span: 8 },
    { name: "requested_by", label: "درخواست‌کننده", type: "user", readonly: true, list: true, filter: true, span: 8 },
    { name: "verified_at", label: "زمان تأیید", type: "datetime", readonly: true, list: true, span: 8 },
  ],
  scope: { own: ["requested_by"], requester: [] },
  list: { columns: ["record_number", "user_id", "channel", "status", "requested_by", "verified_at"], order: "-created_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// The module's settings (one row per organisation; the server falls back to these defaults without it)

export const SECURITY_CONFIG_DEFAULTS = {
  secure_workspace_id: null as string | null,
  soc_group_id: null as string | null,
  vuln_group_id: null as string | null,
  grc_group_id: null as string | null,
  auto_promote: true,
  auto_playbook: true,
  sir_weights: DEFAULT_SIR_WEIGHTS as SirWeights,
  vuln_sla_critical: 15,
  vuln_sla_high: 30,
  vuln_sla_medium: 90,
  vuln_sla_low: 180,
  autoclose_missing: true,
  ai_max_classification: "confidential",
  policy_review_months: 12,
  exception_warn_days: 14,
  review_changes: true,
};
export type SecurityConfig = typeof SECURITY_CONFIG_DEFAULTS;

const CFG_OPS = "عملیات امنیت";
const CFG_VULN = "آسیب‌پذیری";
const CFG_GRC = "حاکمیت و انطباق";

const secConfig: TableDef = {
  key: "sec_config",
  table: "sm_sec_configs",
  label: "تنظیمات امنیت",
  plural: "تنظیمات امنیت",
  icon: "settings-2",
  module: "security",
  area: "security",
  description: "فضای کاری امن، گروه‌ها، محاسبهٔ امتیاز ریسک رخداد، موعدهای رفع آسیب‌پذیری و سقف طبقه‌بندی برای هوش مصنوعی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, default: "تنظیمات امنیت", maxLength: 80, list: true, span: 12 },
    { name: "config_key", label: "کلید", type: "string", required: true, default: "default", maxLength: 40, hidden: true, unique: true },
    { name: "secure_workspace_id", label: "فضای کاری امن", type: "ref", ref: "workspace", span: 12, section: CFG_OPS },
    { name: "soc_group_id", label: "گروه مرکز عملیات امنیت", type: "group", span: 12, section: CFG_OPS },
    { name: "auto_promote", label: "رخدادهای امنیتیِ میز خدمت خودکار ارتقا یابند", type: "bool", default: true, span: 12, section: CFG_OPS },
    { name: "auto_playbook", label: "دستورالعمل دسته خودکار افزوده شود", type: "bool", default: true, span: 12, section: CFG_OPS },
    { name: "sir_weights", label: "وزن‌های امتیاز ریسک (شدت، اثر، داده، دادهٔ شخصی)", type: "json", default: DEFAULT_SIR_WEIGHTS, span: 24, section: CFG_OPS },
    { name: "ai_max_classification", label: "بالاترین طبقه‌بندی مجاز برای هوش مصنوعی", type: "choice", choices: CLASSIFICATION_OPTIONS.filter((x) => x.value !== "restricted"), default: "confidential", span: 12, section: CFG_OPS },
    { name: "vuln_group_id", label: "گروه مدیریت آسیب‌پذیری", type: "group", span: 12, section: CFG_VULN },
    { name: "vuln_sla_critical", label: "موعد رفع بحرانی (روز)", type: "int", min: 1, max: 365, default: 15, span: 6, section: CFG_VULN },
    { name: "vuln_sla_high", label: "موعد رفع بالا (روز)", type: "int", min: 1, max: 365, default: 30, span: 6, section: CFG_VULN },
    { name: "vuln_sla_medium", label: "موعد رفع متوسط (روز)", type: "int", min: 1, max: 730, default: 90, span: 6, section: CFG_VULN },
    { name: "vuln_sla_low", label: "موعد رفع کم (روز)", type: "int", min: 1, max: 1095, default: 180, span: 6, section: CFG_VULN },
    { name: "autoclose_missing", label: "موردی که پویش بعدی نبیند رفع‌شده شمرده شود", type: "bool", default: true, span: 12, section: CFG_VULN },
    { name: "exception_warn_days", label: "هشدار انقضای استثنا و پذیرش (روز پیش از آن)", type: "int", min: 0, max: 90, default: 14, span: 12, section: CFG_VULN },
    { name: "review_changes", label: "تغییرهای حساس بازبینی امنیتی بگیرند", type: "bool", default: true, span: 12, section: CFG_VULN },
    { name: "grc_group_id", label: "گروه ریسک و انطباق", type: "group", span: 12, section: CFG_GRC },
    { name: "policy_review_months", label: "بازنگری خط‌مشی‌ها هر (ماه)", type: "int", min: 1, max: 60, default: 12, span: 12, section: CFG_GRC },
    { name: "seeded", label: "پیش‌فرض‌ها افزوده شد", type: "int", readonly: true, default: 0, hidden: true },
  ],
  scope: { public: true },
  form: { sections: [MAIN, CFG_OPS, CFG_VULN, CFG_GRC] },
  list: { columns: ["name"], order: "name" },
};

// ---------------------------------------------------------------------------------------------------------------
// Governance and compliance (area compliance)

const grcFramework: TableDef = {
  key: "grc_framework",
  table: "sm_grc_frameworks",
  label: "چارچوب",
  plural: "چارچوب‌ها و مقررات",
  icon: "library",
  module: "security",
  area: "compliance",
  description: "استاندارد، مقررات یا قرارداد با الزام‌هایش: ISO/IEC 27001، NIST CSF، ISO/IEC 20000-1 و بسته‌های مقررات داخلی",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, span: 12 },
    { name: "key", label: "کلید", type: "string", required: true, maxLength: 60, ltr: true, unique: true, list: true, span: 6 },
    { name: "active", label: "فعال", type: "bool", default: true, list: true, filter: true, span: 6 },
    { name: "kind", label: "نوع", type: "choice", choices: FRAMEWORK_KINDS, default: "standard", list: true, filter: true, span: 8 },
    { name: "edition", label: "نسخه", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "publisher", label: "منتشرکننده", type: "string", maxLength: 200, span: 8 },
    { name: "placeholder", label: "جای‌نگهدار (الزام‌ها وارد نشده‌اند)", type: "bool", default: false, filter: true, span: 12 },
    { name: "requirement_count", label: "الزام‌ها", type: "int", system: true, default: 0, list: true, span: 6 },
    { name: "compliance_pct", label: "درصد انطباق", type: "decimal", system: true, list: true, span: 6 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  form: { related: [{ table: "grc_requirement", field: "framework_id", label: "الزام‌ها", columns: ["code", "title", "applicable", "implementation", "compliance"] }] },
  list: { columns: ["name", "kind", "edition", "requirement_count", "compliance_pct", "active"], order: "name" },
};

const SOA = "بیانیهٔ کاربست‌پذیری";

const grcRequirement: TableDef = {
  key: "grc_requirement",
  table: "sm_grc_requirements",
  label: "الزام",
  plural: "الزام‌ها و بیانیهٔ کاربست‌پذیری",
  icon: "list-tree",
  module: "security",
  area: "compliance",
  description: "یک بند یا کنترل یک چارچوب (پیوست الف، دستهٔ CSF، بند ۲۰۰۰۰) یا یک تعهد قانونی، با کاربست‌پذیری، توجیه، مالک، کنترل‌های نگاشته و وضعیت انطباق",
  display: "code",
  fields: [
    { name: "framework_id", label: "چارچوب", type: "ref", ref: "grc_framework", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "code", label: "کد", type: "string", required: true, maxLength: 40, ltr: true, list: true, search: true, sort: true, span: 6 },
    { name: "level", label: "سطح", type: "int", default: 1, span: 6 },
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 300, list: true, search: true, span: 24 },
    { name: "title_en", label: "عنوان لاتین", type: "string", maxLength: 300, ltr: true, search: true, span: 24 },
    { name: "theme", label: "حوزه", type: "string", maxLength: 120, filter: true, span: 8 },
    { name: "parent_code", label: "کد بالادست", type: "string", maxLength: 40, ltr: true, span: 8 },
    { name: "sort_order", label: "ترتیب", type: "int", default: 100, sort: true, span: 8 },
    { name: "attributes", label: "ویژگی‌ها (۲۷۰۰۲)", type: "tags", filter: true, span: 24 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    { name: "applicable", label: "کاربست‌پذیر", type: "bool", default: true, list: true, filter: true, span: 8, section: SOA },
    { name: "justification", label: "توجیه کاربست یا کنارگذاری", type: "text", span: 24, section: SOA },
    { name: "owner_id", label: "مالک", type: "user", filter: true, index: true, span: 8, section: SOA },
    { name: "implementation", label: "پیاده‌سازی", type: "choice", choices: IMPLEMENTATION, system: true, default: "not_assessed", list: true, filter: true, span: 8, section: SOA },
    { name: "compliance", label: "انطباق", type: "choice", choices: COMPLIANCE, system: true, default: "not_assessed", list: true, filter: true, span: 8, section: SOA },
    { name: "control_count", label: "کنترل‌های نگاشته", type: "int", system: true, default: 0, span: 8, section: SOA },
    { name: "soa_state", label: "وضعیت در SoA", type: "choice", choices: SOA_STATES, system: true, default: "draft", filter: true, span: 8, section: SOA },
    { name: "soa_approved_by", label: "تأییدکنندهٔ SoA", type: "user", system: true, span: 8, section: SOA },
    { name: "soa_approved_at", label: "زمان تأیید SoA", type: "datetime", system: true, span: 8, section: SOA },
  ],
  unique: [["framework_id", "code"]],
  scope: { public: true },
  features: { links: true },
  form: { sections: [MAIN, SOA] },
  list: { columns: ["code", "title", "framework_id", "applicable", "implementation", "compliance", "soa_state"], order: "framework_id,sort_order,code" },
};

const CTL_MON = "پایش و آزمون";

const grcControl: TableDef = {
  key: "grc_control",
  table: "sm_grc_controls",
  label: "کنترل",
  plural: "کتابخانهٔ کنترل‌ها",
  icon: "shield-check",
  module: "security",
  area: "compliance",
  description: "کنترل سازمان با هدف، مالک، نوع و تناوب، نگاشته به الزام‌های چند چارچوب (یک بار آزمون، چند بار انطباق) و پایش خودکار",
  numbered: { prefix: "CTL", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "code", label: "کد", type: "string", maxLength: 40, ltr: true, unique: true, search: true, list: true, span: 8 },
    { name: "objective", label: "هدف کنترل", type: "markdown", span: 24 },
    { name: "owner_id", label: "مالک", type: "user", list: true, filter: true, index: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, index: true, span: 8 },
    { name: "active", label: "فعال", type: "bool", default: true, filter: true, span: 8 },
    { name: "type", label: "نوع", type: "choice", choices: CONTROL_TYPES, default: "preventive", filter: true, span: 8 },
    { name: "nature", label: "روش اجرا", type: "choice", choices: CONTROL_NATURES, default: "manual", filter: true, span: 8 },
    { name: "frequency", label: "تناوب", type: "choice", choices: FREQUENCIES, default: "annual", filter: true, span: 8 },
    { name: "cia", label: "ویژگی‌های امنیتی", type: "multichoice", choices: CIA, span: 12 },
    { name: "concepts", label: "مفهوم‌های سایبری", type: "multichoice", choices: CONCEPTS, span: 12 },
    { name: "requirements", label: "الزام‌های نگاشته", type: "refs", ref: "grc_requirement", span: 24, help: "یک کنترل، الزام‌های چند چارچوب را پوشش می‌دهد" },
    { name: "implementation_status", label: "پیاده‌سازی", type: "choice", choices: CONTROL_STATUS, default: "planned", list: true, filter: true, span: 8 },
    { name: "effectiveness", label: "اثربخشی", type: "choice", choices: EFFECTIVENESS, system: true, default: "not_tested", list: true, filter: true, span: 8 },
    { name: "test_procedure", label: "روش آزمون", type: "markdown", span: 24, section: CTL_MON },
    { name: "last_tested_at", label: "آخرین آزمون", type: "datetime", system: true, sort: true, span: 8, section: CTL_MON },
    { name: "next_test_due", label: "آزمون بعدی", type: "date", system: true, list: true, sort: true, filter: true, span: 8, section: CTL_MON },
    { name: "indicator", label: "شاخص پایش خودکار", type: "choice", choices: INDICATOR_OPTIONS, default: "none", filter: true, span: 8, section: CTL_MON },
    { name: "indicator_threshold", label: "آستانهٔ شاخص", type: "decimal", span: 8, section: CTL_MON },
    { name: "indicator_value", label: "مقدار شاخص", type: "decimal", system: true, span: 8, section: CTL_MON },
    { name: "indicator_status", label: "وضعیت پایش", type: "choice", choices: INDICATOR_STATUS, system: true, default: "unknown", list: true, filter: true, span: 8, section: CTL_MON },
    { name: "indicator_at", label: "زمان سنجش", type: "datetime", system: true, span: 8, section: CTL_MON },
  ],
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true },
  form: {
    sections: [MAIN, CTL_MON],
    related: [
      { table: "grc_control_test", field: "control_id", label: "آزمون‌ها", columns: ["number", "kind", "state", "conclusion", "tester_id", "planned_for"] },
      { table: "grc_evidence", field: "control_id", label: "شواهد", columns: ["number", "title", "state", "period_end"] },
      { table: "grc_issue", field: "control_id", label: "مسائل", columns: ["number", "title", "severity", "state", "due_at"] },
    ],
  },
  list: { columns: ["number", "code", "name", "owner_id", "implementation_status", "effectiveness", "indicator_status", "next_test_due"], order: "code,name" },
  ai: { title: "name", text: ["objective", "test_procedure"] },
};

export const TEST_STATES: StateModel = {
  field: "state",
  initial: "planned",
  states: [
    { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "completed", label: "انجام‌شده", category: "closed", color: "green" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["planned"], to: "in_progress", label: "شروع آزمون" },
    { from: ["planned", "in_progress"], to: "completed", label: "ثبت نتیجه", requires: ["conclusion"] },
    { from: ["planned", "in_progress"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const grcControlTest: TableDef = {
  key: "grc_control_test",
  table: "sm_grc_control_tests",
  label: "آزمون کنترل",
  plural: "آزمون‌ها و خودارزیابی‌های کنترل",
  icon: "flask-conical",
  module: "security",
  area: "compliance",
  description: "آزمون طراحی، اثربخشی عملیاتی یا خودارزیابی یک کنترل: جامعه، نمونه، استثناها، نتیجه، آزمونگر و هش شواهد",
  numbered: { prefix: "TST", pad: 6 },
  display: "control_id",
  fields: [
    { name: "control_id", label: "کنترل", type: "ref", ref: "grc_control", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: TEST_KINDS, default: "operating", list: true, filter: true, span: 6 },
    { name: "planned_for", label: "تاریخ برنامه", type: "date", list: true, sort: true, filter: true, span: 6 },
    { name: "tester_id", label: "آزمونگر", type: "user", default: "$me", list: true, filter: true, index: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "period_start", label: "دورهٔ آزمون از", type: "date", span: 6 },
    { name: "period_end", label: "تا", type: "date", span: 6 },
    { name: "population", label: "اندازهٔ جامعه", type: "int", min: 0, span: 8 },
    { name: "sample_size", label: "اندازهٔ نمونه", type: "int", min: 0, span: 8 },
    { name: "exceptions", label: "استثناها", type: "int", min: 0, default: 0, span: 8 },
    { name: "procedure", label: "روش آزمون", type: "markdown", span: 24 },
    { name: "result_notes", label: "شرح نتیجه", type: "markdown", span: 24 },
    { name: "conclusion", label: "نتیجه", type: "choice", choices: EFFECTIVENESS.filter((x) => x.value !== "not_tested"), list: true, filter: true, span: 8 },
    { name: "evidence_hash", label: "هش شواهد", type: "string", maxLength: 64, ltr: true, span: 16 },
    { name: "completed_at", label: "زمان ثبت نتیجه", type: "datetime", system: true, sort: true, span: 8 },
    { name: "issue_id", label: "مسئلهٔ ساخته‌شده", type: "ref", ref: "grc_issue", system: true, span: 8 },
  ],
  states: TEST_STATES,
  scope: { own: ["tester_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true },
  list: { columns: ["number", "control_id", "kind", "state", "conclusion", "tester_id", "planned_for"], order: "-planned_for" },
};

export const ISSUE_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "red" },
    { value: "in_progress", label: "در حال رفع", category: "active", color: "teal" },
    { value: "accepted", label: "ریسک پذیرفته شد", category: "waiting", color: "gold" },
    { value: "resolved", label: "رفع‌شده (در انتظار تأیید)", category: "resolved", color: "green" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open", "accepted"], to: "in_progress", label: "شروع رفع" },
    { from: ["open", "in_progress"], to: "accepted", label: "پذیرش ریسک", requires: ["notes"], roles: { area: "compliance", level: "full" } },
    { from: ["open", "in_progress"], to: "resolved", label: "رفع شد", requires: ["remediation_plan"] },
    { from: ["resolved"], to: "in_progress", label: "بازگشایی" },
    { from: ["resolved"], to: "closed", label: "تأیید و بستن" },
    { from: ["open", "in_progress"], to: "canceled", label: "لغو", requires: ["notes"] },
  ],
  locked: ["closed", "canceled"],
};

const grcIssue: TableDef = {
  key: "grc_issue",
  table: "sm_grc_issues",
  label: "مسئلهٔ حاکمیتی",
  plural: "مسائل و رفع آن‌ها",
  icon: "circle-alert",
  module: "security",
  area: "compliance",
  description: "مسئله‌ای از آزمون ناموفق، یافتهٔ ممیزی، پایش خودکار، رویداد ریسک یا گزارش داوطلبانه، با برنامهٔ رفع، مالک و موعد",
  numbered: { prefix: "ISS", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "source", label: "منشأ", type: "choice", choices: ISSUE_SOURCES, default: "self", list: true, filter: true, span: 8 },
    { name: "severity", label: "شدت", type: "choice", choices: ISSUE_SEVERITIES, default: "medium", list: true, filter: true, span: 8 },
    { name: "due_at", label: "موعد", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "control_id", label: "کنترل", type: "ref", ref: "grc_control", filter: true, index: true, span: 8 },
    { name: "test_id", label: "آزمون", type: "ref", ref: "grc_control_test", filter: true, span: 8 },
    { name: "finding_id", label: "یافتهٔ ممیزی", type: "ref", ref: "grc_finding", filter: true, span: 8 },
    { name: "risk_id", label: "ریسک", type: "ref", ref: "grc_risk", filter: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", list: true, filter: true, index: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, index: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    { name: "remediation_plan", label: "برنامهٔ رفع", type: "markdown", span: 24 },
    { name: "overdue", label: "گذشته از موعد", type: "bool", system: true, filter: true, span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  states: ISSUE_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true, kanban: "state" },
  list: { columns: ["number", "title", "source", "severity", "state", "owner_id", "due_at"], order: "due_at" },
  ai: { title: "title", text: ["description", "remediation_plan"] },
};

export const GRC_EVIDENCE_STATES: StateModel = {
  field: "state",
  initial: "requested",
  states: [
    { value: "requested", label: "درخواست‌شده", category: "new", color: "blue" },
    { value: "submitted", label: "ارسال‌شده", category: "active", color: "teal" },
    { value: "accepted", label: "پذیرفته", category: "closed", color: "green" },
    { value: "rejected", label: "ناکافی", category: "waiting", color: "red" },
  ],
  transitions: [
    { from: ["requested", "rejected"], to: "submitted", label: "ارسال شواهد", guard: "grc_evidence_has_files" },
    { from: ["submitted"], to: "accepted", label: "پذیرش" },
    { from: ["submitted"], to: "rejected", label: "ناکافی است", requires: ["review_notes"] },
    { from: ["accepted"], to: "submitted", label: "بازبینی دوباره" },
  ],
  locked: [],
};

const grcEvidence: TableDef = {
  key: "grc_evidence",
  table: "sm_grc_evidence",
  label: "شاهد انطباق",
  plural: "شواهد انطباق",
  icon: "file-check",
  module: "security",
  area: "compliance",
  description: "درخواست و پروندهٔ شاهد برای یک کنترل، آزمون، ممیزی یا الزام در یک دوره، با هش SHA-256 برای بستهٔ شواهد",
  numbered: { prefix: "EVI", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "kind", label: "نوع", type: "choice", choices: EVIDENCE_TYPES, default: "document", list: true, filter: true, span: 8 },
    { name: "control_id", label: "کنترل", type: "ref", ref: "grc_control", filter: true, index: true, span: 8 },
    { name: "test_id", label: "آزمون", type: "ref", ref: "grc_control_test", filter: true, index: true, span: 8 },
    { name: "audit_id", label: "ممیزی", type: "ref", ref: "grc_audit", filter: true, index: true, span: 8 },
    { name: "finding_id", label: "یافته", type: "ref", ref: "grc_finding", filter: true, span: 8 },
    { name: "requirement_id", label: "الزام", type: "ref", ref: "grc_requirement", filter: true, span: 8 },
    { name: "period_start", label: "دوره از", type: "date", span: 6 },
    { name: "period_end", label: "دوره تا", type: "date", list: true, sort: true, span: 6 },
    { name: "due_at", label: "موعد ارسال", type: "date", list: true, sort: true, filter: true, span: 6 },
    { name: "owner_id", label: "مسئول ارسال", type: "user", list: true, filter: true, index: true, span: 6 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "sha256", label: "هش SHA-256", type: "string", maxLength: 64, ltr: true, system: true, span: 16 },
    { name: "submitted_at", label: "زمان ارسال", type: "datetime", system: true, sort: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
    { name: "review_notes", label: "نظر بازبین", type: "text", span: 24 },
  ],
  states: GRC_EVIDENCE_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true },
  list: { columns: ["number", "title", "kind", "control_id", "state", "owner_id", "due_at"], order: "-created_at" },
  ai: { title: "title", text: ["description", "review_notes"], attachments: true },
};

export const POLICY_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "review", label: "در بازبینی و تأیید", category: "waiting", color: "gold" },
    { value: "published", label: "منتشرشده", category: "active", color: "green" },
    { value: "retired", label: "بازنشسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "review", label: "فرستادن برای تأیید", requires: ["body", "approver_id"] },
    { from: ["review"], to: "draft", label: "بازگشت به پیش‌نویس" },
    { from: ["review"], to: "published", label: "انتشار", roles: { area: "compliance", level: "full" }, guard: "grc_policy_publish" },
    { from: ["published"], to: "draft", label: "ویرایش تازه" },
    { from: ["published"], to: "retired", label: "بازنشستگی" },
  ],
  locked: ["closed"],
};

const grcPolicy: TableDef = {
  key: "grc_policy",
  table: "sm_grc_policies",
  label: "خط‌مشی",
  plural: "خط‌مشی‌ها و استانداردها",
  icon: "scroll-text",
  module: "security",
  area: "compliance",
  description: "خط‌مشی، استاندارد، روال یا رهنمود با چرخهٔ پیش‌نویس ← تأیید ← انتشار ← بازنشستگی، نسخه، بازنگری دوره‌ای و الزام‌هایی که برآورده می‌کند",
  numbered: { prefix: "POL", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "kind", label: "نوع", type: "choice", choices: POLICY_KINDS, default: "policy", list: true, filter: true, span: 8 },
    { name: "version_label", label: "نسخه", type: "string", maxLength: 20, ltr: true, default: "1.0", list: true, span: 6 },
    { name: "classification", label: "طبقه‌بندی", type: "choice", choices: CLASSIFICATION_OPTIONS, default: "internal", filter: true, span: 6 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", list: true, filter: true, index: true, span: 6 },
    { name: "approver_id", label: "تأییدکننده", type: "user", filter: true, span: 6 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "effective_at", label: "تاریخ اجرا", type: "date", sort: true, span: 8 },
    { name: "next_review_at", label: "بازنگری بعدی", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "summary", label: "خلاصه", type: "text", span: 24 },
    { name: "body", label: "متن", type: "markdown", span: 24 },
    { name: "requirements", label: "الزام‌های برآورده", type: "refs", ref: "grc_requirement", span: 24 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "published_at", label: "زمان انتشار", type: "datetime", system: true, sort: true, span: 8 },
    { name: "published_by", label: "منتشرکننده", type: "user", system: true, span: 8 },
    { name: "revision", label: "شمار ویرایش", type: "int", system: true, default: 0, span: 8 },
  ],
  states: POLICY_STATES,
  scope: { own: ["owner_id", "approver_id"], group: "assignment_group_id", requester: ["owner_id"] },
  features: { journal: true, attachments: true, links: true, approvals: true, rag: true },
  form: { related: [{ table: "grc_policy_campaign", field: "policy_id", label: "کارزارهای پذیرش", columns: ["number", "title", "state", "due_at", "audience_count", "ack_count"] }] },
  list: { columns: ["number", "title", "kind", "version_label", "state", "owner_id", "next_review_at"], order: "title" },
  ai: { title: "title", text: ["summary", "body"], attachments: true },
};

export const CAMPAIGN_STATES: StateModel = {
  field: "state",
  initial: "draft",
  states: [
    { value: "draft", label: "پیش‌نویس", category: "new", color: "blue" },
    { value: "active", label: "در جریان", category: "active", color: "green" },
    { value: "closed", label: "پایان‌یافته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["draft"], to: "active", label: "شروع کارزار", guard: "grc_campaign_start" },
    { from: ["active"], to: "closed", label: "پایان کارزار" },
    { from: ["closed"], to: "active", label: "ادامهٔ کارزار" },
  ],
  locked: [],
};

const grcCampaign: TableDef = {
  key: "grc_policy_campaign",
  table: "sm_grc_policy_campaigns",
  label: "کارزار پذیرش خط‌مشی",
  plural: "کارزارهای پذیرش خط‌مشی",
  icon: "megaphone",
  module: "security",
  area: "compliance",
  description: "«خواندم و می‌پذیرم» برای نسخهٔ منتشرشدهٔ یک خط‌مشی: مخاطبان (همه، افراد، گروه‌ها، واحدها)، موعد و یادآوری",
  numbered: { prefix: "PAC", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "policy_id", label: "خط‌مشی", type: "ref", ref: "grc_policy", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "version_label", label: "نسخه", type: "string", maxLength: 20, ltr: true, readonly: true, span: 6 },
    { name: "due_at", label: "موعد", type: "date", required: true, list: true, sort: true, span: 6 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, index: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "remind_every_days", label: "یادآوری هر (روز)", type: "int", min: 0, max: 60, default: 3, span: 8 },
    { name: "target_all", label: "همهٔ اعضا", type: "bool", default: false, span: 8 },
    { name: "target_users", label: "افراد", type: "users", span: 16 },
    { name: "target_groups", label: "گروه‌ها", type: "refs", ref: "group", span: 12 },
    { name: "target_units", label: "واحدها (با زیرمجموعه‌ها)", type: "refs", ref: "org_unit", span: 12 },
    { name: "audience_count", label: "مخاطبان", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8 },
    { name: "ack_count", label: "پذیرش‌ها", type: "int", readonly: true, audit: false, default: 0, list: true, span: 8 },
    { name: "reminded_at", label: "آخرین یادآوری", type: "datetime", readonly: true, audit: false, span: 8 },
  ],
  states: CAMPAIGN_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true },
  form: { related: [{ table: "grc_policy_ack", field: "campaign_id", label: "پذیرش‌ها", columns: ["user_id", "version_label", "acked_at"] }] },
  list: { columns: ["number", "title", "policy_id", "state", "due_at", "audience_count", "ack_count"], order: "-created_at" },
};

const grcAck: TableDef = {
  key: "grc_policy_ack",
  table: "sm_grc_policy_acks",
  label: "پذیرش خط‌مشی",
  plural: "پذیرش‌های خط‌مشی",
  icon: "check-check",
  module: "security",
  area: "compliance",
  description: "پذیرش یک عضو برای نسخهٔ مشخصی از یک خط‌مشی در یک کارزار",
  display: "version_label",
  fields: [
    { name: "campaign_id", label: "کارزار", type: "ref", ref: "grc_policy_campaign", required: true, readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "policy_id", label: "خط‌مشی", type: "ref", ref: "grc_policy", required: true, readonly: true, filter: true, index: true, span: 12 },
    { name: "user_id", label: "عضو", type: "user", required: true, readonly: true, list: true, filter: true, index: true, span: 12 },
    { name: "version_label", label: "نسخه", type: "string", maxLength: 20, readonly: true, ltr: true, list: true, span: 6 },
    { name: "acked_at", label: "زمان پذیرش", type: "datetime", readonly: true, list: true, sort: true, span: 6 },
  ],
  unique: [["campaign_id", "user_id"]],
  scope: { own: ["user_id"], requester: [] },
  list: { columns: ["campaign_id", "user_id", "version_label", "acked_at"], order: "-acked_at" },
};

const grcPolicyException: TableDef = {
  key: "grc_policy_exception",
  table: "sm_grc_policy_exceptions",
  label: "استثنای خط‌مشی",
  plural: "استثناهای خط‌مشی",
  icon: "file-warning",
  module: "security",
  area: "compliance",
  description: "معافیت از یک خط‌مشی با دلیل، کنترل‌های جبرانی، پذیرش ریسک، تأییدکننده و تاریخ انقضا",
  numbered: { prefix: "WVR", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "policy_id", label: "خط‌مشی", type: "ref", ref: "grc_policy", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "expires_at", label: "تاریخ انقضا", type: "date", required: true, list: true, sort: true, filter: true, span: 12 },
    { name: "justification", label: "دلیل", type: "text", required: true, span: 24 },
    { name: "compensating_controls", label: "کنترل‌های جبرانی", type: "text", span: 24 },
    { name: "risk_accepted", label: "ریسک پذیرفته می‌شود", type: "bool", default: false, span: 8 },
    { name: "requested_by", label: "درخواست‌کننده", type: "user", default: "$me", filter: true, span: 8 },
    { name: "approver_id", label: "تأییدکننده", type: "user", filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "approved_at", label: "زمان تأیید", type: "datetime", system: true, span: 8 },
    { name: "warned_at", label: "یادآوری انقضا", type: "datetime", system: true, audit: false, span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  states: EXCEPTION_STATES,
  scope: { own: ["requested_by", "approver_id"], group: "assignment_group_id", requester: ["requested_by"] },
  features: { journal: true, attachments: true, approvals: true },
  list: { columns: ["number", "title", "policy_id", "state", "expires_at", "requested_by"], order: "expires_at" },
};

export const AUDIT_STATES: StateModel = {
  field: "state",
  initial: "planned",
  states: [
    { value: "planned", label: "برنامه‌ریزی‌شده", category: "new", color: "blue" },
    { value: "fieldwork", label: "اجرای ممیزی", category: "active", color: "teal" },
    { value: "reporting", label: "تهیهٔ گزارش", category: "active", color: "indigo" },
    { value: "follow_up", label: "پیگیری یافته‌ها", category: "waiting", color: "gold" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["planned"], to: "fieldwork", label: "شروع ممیزی" },
    { from: ["fieldwork"], to: "reporting", label: "تهیهٔ گزارش" },
    { from: ["reporting"], to: "follow_up", label: "انتشار گزارش", requires: ["conclusion"] },
    { from: ["follow_up", "reporting"], to: "closed", label: "بستن", guard: "grc_audit_can_close" },
    { from: ["planned", "fieldwork"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const grcAudit: TableDef = {
  key: "grc_audit",
  table: "sm_grc_audits",
  label: "ممیزی",
  plural: "ممیزی‌ها",
  icon: "clipboard-list",
  module: "security",
  area: "compliance",
  description: "ممیزی داخلی، بیرونی یا گواهی: دامنه، چارچوب، تیم ممیزی با بررسی استقلال، برنامهٔ زمانی، شواهد، یافته‌ها و نتیجه",
  numbered: { prefix: "AUD", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "kind", label: "نوع", type: "choice", choices: AUDIT_KINDS, default: "internal", list: true, filter: true, span: 8 },
    { name: "framework_id", label: "چارچوب", type: "ref", ref: "grc_framework", list: true, filter: true, span: 12 },
    { name: "lead_auditor_id", label: "سرممیز", type: "user", list: true, filter: true, index: true, span: 6 },
    { name: "auditee_owner_id", label: "نمایندهٔ ممیزی‌شونده", type: "user", filter: true, span: 6 },
    { name: "auditors", label: "تیم ممیزی", type: "users", span: 12 },
    { name: "auditee_units", label: "واحدهای ممیزی‌شونده", type: "refs", ref: "org_unit", span: 12 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "planned_start", label: "شروع برنامه", type: "date", list: true, sort: true, span: 8 },
    { name: "planned_end", label: "پایان برنامه", type: "date", span: 8 },
    { name: "scope_text", label: "دامنه و معیارها", type: "markdown", span: 24 },
    { name: "independence_ok", label: "استقلال ممیزان تأیید شد", type: "bool", system: true, default: false, filter: true, span: 8 },
    { name: "independence_note", label: "بررسی استقلال", type: "text", system: true, span: 16 },
    { name: "conclusion", label: "نتیجه‌گیری", type: "markdown", span: 24 },
  ],
  states: AUDIT_STATES,
  scope: { own: ["lead_auditor_id", "auditors"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true, calendar: { start: "planned_start", end: "planned_end" } },
  form: {
    related: [
      { table: "grc_finding", field: "audit_id", label: "یافته‌ها", columns: ["number", "title", "kind", "state", "owner_id", "due_at"] },
      { table: "grc_evidence", field: "audit_id", label: "شواهد", columns: ["number", "title", "state", "owner_id", "due_at"] },
    ],
  },
  list: { columns: ["number", "title", "kind", "framework_id", "state", "lead_auditor_id", "planned_start"], order: "-planned_start" },
};

export const FINDING_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "red" },
    { value: "action_planned", label: "برنامهٔ اقدام دارد", category: "active", color: "blue" },
    { value: "in_progress", label: "در حال اقدام", category: "active", color: "teal" },
    { value: "verification", label: "در انتظار تأیید اثر", category: "resolved", color: "gold" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "action_planned", label: "ثبت برنامهٔ اقدام", requires: ["action_plan", "owner_id", "due_at"] },
    { from: ["action_planned"], to: "in_progress", label: "شروع اقدام" },
    { from: ["action_planned", "in_progress"], to: "verification", label: "اقدام انجام شد" },
    { from: ["verification"], to: "in_progress", label: "اثر کافی نبود" },
    { from: ["verification"], to: "closed", label: "تأیید و بستن" },
    { from: ["open", "action_planned"], to: "canceled", label: "لغو" },
  ],
  locked: ["closed", "canceled"],
};

const grcFinding: TableDef = {
  key: "grc_finding",
  table: "sm_grc_findings",
  label: "یافتهٔ ممیزی",
  plural: "یافته‌های ممیزی",
  icon: "search-check",
  module: "security",
  area: "compliance",
  description: "عدم انطباق عمده یا جزئی، مشاهده یا فرصت بهبود، با علت، برنامهٔ اقدام، مالک، موعد و تأیید اثربخشی",
  numbered: { prefix: "FND", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "audit_id", label: "ممیزی", type: "ref", ref: "grc_audit", list: true, filter: true, index: true, span: 12 },
    { name: "kind", label: "نوع", type: "choice", choices: FINDING_KINDS, default: "minor_nc", list: true, filter: true, span: 12 },
    { name: "requirement_id", label: "الزام", type: "ref", ref: "grc_requirement", filter: true, span: 12 },
    { name: "control_id", label: "کنترل", type: "ref", ref: "grc_control", filter: true, span: 12 },
    { name: "owner_id", label: "مالک اقدام", type: "user", list: true, filter: true, index: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "due_at", label: "موعد اقدام", type: "date", list: true, sort: true, filter: true, span: 8 },
    { name: "description", label: "شرح یافته", type: "markdown", span: 24 },
    { name: "root_cause", label: "علت", type: "markdown", span: 24 },
    { name: "action_plan", label: "برنامهٔ اقدام", type: "markdown", span: 24 },
    { name: "overdue", label: "گذشته از موعد", type: "bool", system: true, filter: true, span: 8 },
  ],
  states: FINDING_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true },
  list: { columns: ["number", "title", "audit_id", "kind", "state", "owner_id", "due_at"], order: "due_at" },
};

const grcCsfProfile: TableDef = {
  key: "grc_csf_profile",
  table: "sm_grc_csf_profiles",
  label: "پروفایل NIST CSF",
  plural: "پروفایل‌های NIST CSF",
  icon: "radar",
  module: "security",
  area: "compliance",
  description: "سطح کنونی و هدف در هر دستهٔ NIST CSF 2.0، ردهٔ پیاده‌سازی، شکاف‌ها و برنامهٔ اقدام",
  numbered: { prefix: "PRF", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "kind", label: "نوع", type: "choice", choices: PROFILE_KINDS, default: "current", list: true, filter: true, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "tier", label: "ردهٔ کنونی", type: "choice", choices: TIERS, default: "2", span: 6 },
    { name: "target_tier", label: "ردهٔ هدف", type: "choice", choices: TIERS, default: "3", span: 6 },
    { name: "scope_text", label: "دامنه", type: "text", span: 24 },
    { name: "items", label: "امتیاز دسته‌ها", type: "json", default: {}, span: 24, help: "{ «GV.OC»: { current: 2, target: 3, note } }" },
    { name: "gap_total", label: "جمع شکاف", type: "int", system: true, list: true, sort: true, span: 8 },
    { name: "scored", label: "دسته‌های امتیازدار", type: "int", system: true, span: 8 },
    { name: "action_plan", label: "برنامهٔ اقدام", type: "markdown", span: 24 },
  ],
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true },
  list: { columns: ["number", "name", "kind", "tier", "target_tier", "gap_total"], order: "-created_at" },
};

export const ALERT_STATES: StateModel = {
  field: "state",
  initial: "new",
  states: [
    { value: "new", label: "تازه", category: "new", color: "blue" },
    { value: "assessing", label: "در ارزیابی اثر", category: "active", color: "teal" },
    { value: "action_plan", label: "برنامهٔ اقدام در انتظار تأیید", category: "waiting", color: "gold" },
    { value: "implementing", label: "در حال اجرا", category: "active", color: "indigo" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["new"], to: "assessing", label: "ارزیابی اثر" },
    { from: ["assessing"], to: "action_plan", label: "پیشنهاد برنامه", requires: ["impact", "action_plan"] },
    { from: ["action_plan"], to: "implementing", label: "تأیید برنامه", roles: { area: "compliance", level: "full" } },
    { from: ["action_plan"], to: "assessing", label: "بازگشت" },
    { from: ["implementing", "assessing"], to: "closed", label: "بستن", requires: ["impact"] },
  ],
  locked: ["closed"],
};

const grcRegAlert: TableDef = {
  key: "grc_reg_alert",
  table: "sm_grc_reg_alerts",
  label: "تغییر مقررات",
  plural: "هشدارهای تغییر مقررات",
  icon: "bell-ring",
  module: "security",
  area: "compliance",
  description: "مقررات یا بخشنامهٔ تازه: الزام‌ها، کنترل‌ها و خط‌مشی‌های متأثر، ردهٔ اثر و برنامهٔ اقدام تأییدشده",
  numbered: { prefix: "RAL", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "issuer", label: "صادرکننده", type: "string", maxLength: 200, list: true, span: 12 },
    { name: "published_on", label: "تاریخ صدور", type: "date", sort: true, span: 6 },
    { name: "effective_on", label: "تاریخ اجرا", type: "date", list: true, sort: true, span: 6 },
    { name: "summary", label: "خلاصه", type: "markdown", span: 24 },
    { name: "requirements", label: "الزام‌های متأثر", type: "refs", ref: "grc_requirement", span: 24 },
    { name: "controls", label: "کنترل‌های متأثر", type: "refs", ref: "grc_control", span: 12 },
    { name: "policies", label: "خط‌مشی‌های متأثر", type: "refs", ref: "grc_policy", span: 12 },
    { name: "impact", label: "ردهٔ اثر", type: "choice", choices: IMPACT_CLASSES, default: "not_assessed", list: true, filter: true, span: 8 },
    { name: "owner_id", label: "مسئول", type: "user", default: "$me", filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "rationale", label: "دلیل ردهٔ اثر", type: "text", span: 24 },
    { name: "action_plan", label: "برنامهٔ اقدام", type: "markdown", span: 24 },
  ],
  states: ALERT_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true },
  list: { columns: ["number", "title", "issuer", "impact", "state", "effective_on"], order: "-created_at" },
};

const grcRopa: TableDef = {
  key: "grc_ropa",
  table: "sm_grc_ropa",
  label: "فعالیت پردازش داده",
  plural: "ثبت فعالیت‌های پردازش",
  icon: "database-zap",
  module: "security",
  area: "compliance",
  description: "فعالیت پردازش دادهٔ شخصی: هدف، مبنای قانونی، دسته‌های داده و افراد، گیرندگان، نگهداری، انتقال، سامانه‌ها و ارزیابی اثر (DPIA)",
  numbered: { prefix: "ROPA", pad: 5 },
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "legal_basis", label: "مبنای قانونی", type: "choice", choices: LEGAL_BASES, list: true, filter: true, span: 8 },
    { name: "purpose", label: "هدف", type: "text", required: true, span: 24 },
    { name: "data_categories", label: "دسته‌های داده", type: "tags", filter: true, span: 12 },
    { name: "subject_categories", label: "دسته‌های افراد", type: "tags", filter: true, span: 12 },
    { name: "special_data", label: "دادهٔ حساس ویژه", type: "bool", default: false, filter: true, span: 8 },
    { name: "recipients", label: "گیرندگان", type: "text", span: 16 },
    { name: "retention", label: "مدت نگهداری", type: "string", maxLength: 200, span: 12 },
    { name: "transfers", label: "انتقال به بیرون", type: "text", span: 12 },
    { name: "systems", label: "سامانه‌ها", type: "refs", ref: "ci", span: 24 },
    { name: "owner_id", label: "مالک", type: "user", list: true, filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "dpia_required", label: "ارزیابی اثر (DPIA) لازم است", type: "bool", default: false, list: true, filter: true, span: 8 },
    { name: "dpia_result", label: "نتیجهٔ ارزیابی اثر", type: "choice", choices: RISK_RATING_OPTIONS, filter: true, span: 8 },
    { name: "dpia_date", label: "تاریخ ارزیابی اثر", type: "date", span: 8 },
    { name: "dpia_measures", label: "اقدام‌های کاهش ریسک", type: "markdown", span: 24 },
  ],
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true },
  list: { columns: ["number", "name", "legal_basis", "owner_id", "dpia_required", "dpia_result"], order: "name" },
};

export const DSR_STATES: StateModel = {
  field: "state",
  initial: "received",
  states: [
    { value: "received", label: "دریافت‌شده", category: "new", color: "blue" },
    { value: "verifying", label: "احراز هویت", category: "active", color: "teal" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "indigo" },
    { value: "completed", label: "انجام‌شده", category: "closed", color: "green" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["received"], to: "verifying", label: "احراز هویت" },
    { from: ["received", "verifying"], to: "in_progress", label: "شروع" },
    { from: ["in_progress"], to: "completed", label: "انجام شد", requires: ["response"] },
    { from: ["received", "verifying", "in_progress"], to: "rejected", label: "رد", requires: ["response"] },
  ],
  locked: ["closed", "canceled"],
};

const grcDsr: TableDef = {
  key: "grc_dsr",
  table: "sm_grc_dsrs",
  label: "درخواست صاحب داده",
  plural: "درخواست‌های صاحبان داده",
  icon: "user-search",
  module: "security",
  area: "compliance",
  description: "درخواست دسترسی، حذف، اصلاح یا انتقال داده‌های شخصی یک فرد، با موعد پاسخ",
  numbered: { prefix: "DSR", pad: 6 },
  display: "subject_name",
  fields: [
    { name: "subject_name", label: "نام فرد", type: "string", required: true, maxLength: 200, list: true, search: true, group: "personal", span: 12 },
    { name: "subject_contact", label: "راه تماس", type: "string", maxLength: 200, group: "personal", span: 12 },
    { name: "kind", label: "نوع درخواست", type: "choice", choices: DSR_KINDS, default: "access", required: true, list: true, filter: true, span: 8 },
    { name: "received_at", label: "زمان دریافت", type: "datetime", default: "$now", sort: true, span: 8 },
    { name: "due_at", label: "موعد پاسخ", type: "datetime", system: true, list: true, sort: true, filter: true, span: 8 },
    { name: "ropa_id", label: "فعالیت پردازش", type: "ref", ref: "grc_ropa", filter: true, span: 12 },
    { name: "assigned_to", label: "کارشناس", type: "user", list: true, filter: true, span: 6 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 6 },
    { name: "details", label: "شرح درخواست", type: "text", group: "personal", span: 24 },
    { name: "response", label: "پاسخ", type: "text", span: 24 },
    { name: "overdue", label: "گذشته از موعد", type: "bool", system: true, filter: true, span: 8 },
  ],
  states: DSR_STATES,
  scope: { own: ["assigned_to"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true },
  list: { columns: ["number", "subject_name", "kind", "state", "due_at", "assigned_to"], order: "due_at" },
};

// ---------------------------------------------------------------------------------------------------------------
// Risk (area risk)

export const RISK_STATES: StateModel = {
  field: "state",
  initial: "identified",
  states: [
    { value: "identified", label: "شناسایی‌شده", category: "new", color: "blue" },
    { value: "assessed", label: "ارزیابی‌شده", category: "active", color: "teal" },
    { value: "treatment_planned", label: "برنامهٔ درمان", category: "active", color: "indigo" },
    { value: "treating", label: "در حال درمان", category: "active", color: "purple" },
    { value: "monitoring", label: "پایش", category: "active", color: "green" },
    { value: "accepted", label: "پذیرفته‌شده", category: "waiting", color: "gold" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
    { value: "retired", label: "بازنشسته", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["identified"], to: "assessed", label: "ثبت ارزیابی", requires: ["inherent_likelihood", "inherent_impact", "owner_id"] },
    { from: ["assessed"], to: "treatment_planned", label: "برنامهٔ درمان", requires: ["treatment", "treatment_plan"] },
    { from: ["treatment_planned"], to: "treating", label: "شروع درمان" },
    { from: ["treating", "assessed", "treatment_planned"], to: "monitoring", label: "پایش" },
    { from: ["monitoring", "accepted"], to: "assessed", label: "ارزیابی دوباره" },
    { from: ["assessed", "monitoring", "treatment_planned"], to: "accepted", label: "پذیرش ریسک", guard: "grc_risk_acceptance_active" },
    { from: ["monitoring", "accepted"], to: "closed", label: "بستن", requires: ["notes"] },
    { from: ["identified", "assessed"], to: "retired", label: "بازنشستگی", requires: ["notes"] },
  ],
  locked: ["closed", "canceled"],
};

const ASSESS = "ارزیابی";
const TREAT = "درمان";

const grcRisk: TableDef = {
  key: "grc_risk",
  table: "sm_grc_risks",
  label: "ریسک",
  plural: "ثبت ریسک‌ها",
  icon: "triangle-alert",
  module: "security",
  area: "risk",
  description: "علت، رویداد و پیامد؛ مالک؛ احتمال × اثر ذاتی، کنترل‌های موجود، ریسک باقی‌مانده و هدف؛ گزینهٔ درمان و برنامهٔ آن؛ مقایسه با اشتهای ریسک",
  numbered: { prefix: "RSK", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 16 },
    { name: "category", label: "دسته", type: "choice", choices: "$table.category", default: "security", required: true, list: true, filter: true, span: 8 },
    { name: "cause", label: "علت", type: "text", span: 24 },
    { name: "event", label: "رویداد", type: "text", span: 24 },
    { name: "consequence", label: "پیامد", type: "text", span: 24 },
    { name: "owner_id", label: "مالک ریسک", type: "user", list: true, filter: true, index: true, span: 8 },
    { name: "reporter_id", label: "گزارش‌دهنده", type: "user", default: "$me", filter: true, span: 8 },
    { name: "reporter_role", label: "نقش گزارش‌دهنده", type: "string", maxLength: 80, readonly: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, index: true, span: 8 },
    { name: "services", label: "خدمت‌های متأثر", type: "refs", ref: "service", span: 8 },
    { name: "cis", label: "پیکربندی‌های متأثر", type: "refs", ref: "ci", span: 8 },

    { name: "matrix_id", label: "ماتریس ریسک", type: "ref", ref: "grc_risk_matrix", span: 8, section: ASSESS },
    { name: "inherent_likelihood", label: "احتمال ذاتی", type: "choice", choices: LIKELIHOODS, span: 8, section: ASSESS },
    { name: "inherent_impact", label: "اثر ذاتی", type: "choice", choices: IMPACTS5, span: 8, section: ASSESS },
    { name: "inherent_score", label: "امتیاز ذاتی", type: "int", system: true, sort: true, span: 8, section: ASSESS },
    { name: "inherent_rating", label: "ردهٔ ذاتی", type: "choice", choices: RISK_RATING_OPTIONS, system: true, filter: true, span: 8, section: ASSESS },
    { name: "controls", label: "کنترل‌های موجود", type: "refs", ref: "grc_control", span: 16, section: ASSESS },
    { name: "control_effectiveness", label: "اثربخشی کنترل‌ها", type: "choice", choices: CONTROL_EFFECT, default: "none", span: 8, section: ASSESS },
    { name: "residual_likelihood", label: "احتمال باقی‌مانده", type: "choice", choices: LIKELIHOODS, span: 8, section: ASSESS, help: "خالی: از احتمال ذاتی و اثربخشی کنترل‌ها پیشنهاد می‌شود" },
    { name: "residual_impact", label: "اثر باقی‌مانده", type: "choice", choices: IMPACTS5, span: 8, section: ASSESS },
    { name: "residual_score", label: "امتیاز باقی‌مانده", type: "int", system: true, list: true, sort: true, filter: true, span: 8, section: ASSESS },
    { name: "residual_rating", label: "ردهٔ باقی‌مانده", type: "choice", choices: RISK_RATING_OPTIONS, system: true, list: true, filter: true, sort: true, span: 8, section: ASSESS },
    { name: "target_likelihood", label: "احتمال هدف", type: "choice", choices: LIKELIHOODS, span: 8, section: ASSESS },
    { name: "target_impact", label: "اثر هدف", type: "choice", choices: IMPACTS5, span: 8, section: ASSESS },
    { name: "target_score", label: "امتیاز هدف", type: "int", system: true, span: 8, section: ASSESS },
    { name: "appetite_score", label: "اشتهای ریسک دسته", type: "int", system: true, span: 8, section: ASSESS },
    { name: "above_appetite", label: "بالاتر از اشتها", type: "bool", system: true, list: true, filter: true, span: 8, section: ASSESS },
    { name: "sle", label: "زیان یک‌بارهٔ برآوردی", type: "money", min: 0, span: 8, section: ASSESS },
    { name: "aro", label: "رخداد سالانه (دفعه)", type: "decimal", min: 0, span: 8, section: ASSESS },
    { name: "ale", label: "زیان سالانهٔ مورد انتظار", type: "money", system: true, span: 8, section: ASSESS },

    { name: "treatment", label: "گزینهٔ درمان", type: "choice", choices: TREATMENTS, list: true, filter: true, span: 8, section: TREAT },
    { name: "review_due", label: "بازنگری بعدی", type: "date", list: true, sort: true, filter: true, span: 8, section: TREAT },
    { name: "last_reviewed_at", label: "آخرین بازنگری", type: "datetime", system: true, sort: true, span: 8, section: TREAT },
    { name: "treatment_plan", label: "برنامهٔ درمان", type: "markdown", span: 24, section: TREAT },
    { name: "notes", label: "یادداشت", type: "text", span: 24, section: TREAT },
  ],
  states: RISK_STATES,
  scope: { own: ["owner_id", "reporter_id"], group: "assignment_group_id", requester: ["owner_id", "reporter_id"] },
  features: { journal: true, attachments: true, links: true, kanban: "state" },
  form: {
    sections: [MAIN, ASSESS, TREAT],
    related: [
      { table: "grc_risk_action", field: "risk_id", label: "اقدام‌های درمان", columns: ["number", "title", "state", "owner_id", "due_at"] },
      { table: "grc_risk_acceptance", field: "risk_id", label: "پذیرش‌ها", columns: ["number", "state", "accepted_by", "expires_at"] },
      { table: "grc_kri", field: "risk_id", label: "شاخص‌های کلیدی ریسک", columns: ["name", "last_value", "status"] },
      { table: "grc_risk_event", field: "risk_id", label: "رویدادهای زیان", columns: ["number", "title", "occurred_at", "loss_amount"] },
    ],
  },
  list: { columns: ["number", "title", "category", "owner_id", "residual_rating", "residual_score", "above_appetite", "state", "review_due"], order: "-residual_score,title" },
  ai: { title: "title", text: ["cause", "event", "consequence", "treatment_plan"] },
};

const grcRiskMatrix: TableDef = {
  key: "grc_risk_matrix",
  table: "sm_grc_risk_matrices",
  label: "ماتریس ریسک",
  plural: "ماتریس‌ها و مقیاس‌های ریسک",
  icon: "grid-3x3",
  module: "security",
  area: "risk",
  description: "مقیاس احتمال و اثر و رده‌ای که هر خانه می‌گیرد (نسخه‌دار)؛ ماتریس پیش‌فرض برای ریسک‌های تازه به کار می‌رود",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 120, list: true, search: true, span: 12 },
    { name: "revision", label: "نسخه", type: "int", default: 1, list: true, span: 6 },
    { name: "is_default", label: "پیش‌فرض", type: "bool", default: false, list: true, filter: true, span: 6 },
    { name: "likelihood_labels", label: "برچسب‌های احتمال", type: "json", required: true, default: [], span: 12 },
    { name: "impact_labels", label: "برچسب‌های اثر", type: "json", required: true, default: [], span: 12 },
    { name: "cells", label: "رده‌ها (احتمال × اثر)", type: "json", required: true, default: [], span: 24 },
    { name: "description", label: "شرح", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["name", "revision", "is_default"], order: "-is_default,name" },
};

const grcRiskAppetite: TableDef = {
  key: "grc_risk_appetite",
  table: "sm_grc_risk_appetites",
  label: "اشتهای ریسک",
  plural: "اشتها و تحمل ریسک",
  icon: "gauge",
  module: "security",
  area: "risk",
  description: "بیشترین امتیاز ریسک باقی‌مانده‌ای که در هر دسته بدون تشدید پذیرفته می‌شود، و حد تحمل",
  display: "category",
  fields: [
    { name: "category", label: "دسته", type: "choice", choices: "grc_risk.category", required: true, unique: true, list: true, span: 8 },
    { name: "appetite_score", label: "اشتها (امتیاز)", type: "int", min: 1, max: 25, required: true, list: true, span: 8 },
    { name: "tolerance_score", label: "تحمل (امتیاز)", type: "int", min: 1, max: 25, list: true, span: 8 },
    { name: "statement", label: "بیانیه", type: "text", span: 24 },
  ],
  scope: { public: true },
  list: { columns: ["category", "appetite_score", "tolerance_score"], order: "category" },
};

export const ACTION_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "in_progress", label: "در حال انجام", category: "active", color: "teal" },
    { value: "done", label: "انجام‌شده", category: "closed", color: "green" },
    { value: "canceled", label: "لغوشده", category: "canceled", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "in_progress", label: "شروع" },
    { from: ["open", "in_progress"], to: "done", label: "انجام شد" },
    { from: ["open", "in_progress"], to: "canceled", label: "لغو" },
    { from: ["done"], to: "in_progress", label: "بازگشایی" },
  ],
  locked: ["canceled"],
};

const grcRiskAction: TableDef = {
  key: "grc_risk_action",
  table: "sm_grc_risk_actions",
  label: "اقدام درمان ریسک",
  plural: "اقدام‌های درمان ریسک",
  icon: "list-todo",
  module: "security",
  area: "risk",
  description: "یک اقدام از برنامهٔ درمان یک ریسک با مالک و موعد",
  numbered: { prefix: "RTA", pad: 6 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "risk_id", label: "ریسک", type: "ref", ref: "grc_risk", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", list: true, filter: true, index: true, span: 6 },
    { name: "due_at", label: "موعد", type: "date", list: true, sort: true, filter: true, span: 6 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "change_id", label: "تغییر", type: "ref", ref: "change_request", filter: true, span: 8 },
    { name: "overdue", label: "گذشته از موعد", type: "bool", system: true, filter: true, span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  states: ACTION_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, links: true },
  list: { columns: ["number", "title", "risk_id", "state", "owner_id", "due_at"], order: "due_at" },
};

export const ACCEPTANCE_STATES: StateModel = {
  field: "state",
  initial: "requested",
  states: [
    { value: "requested", label: "در انتظار تأیید مالک ریسک", category: "waiting", color: "gold" },
    { value: "active", label: "برقرار", category: "active", color: "green" },
    { value: "rejected", label: "ردشده", category: "canceled", color: "red" },
    { value: "expired", label: "منقضی", category: "closed", color: "gray" },
    { value: "revoked", label: "ابطال‌شده", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["requested"], to: "active", label: "پذیرش", guard: "grc_acceptance_by_owner" },
    { from: ["requested"], to: "rejected", label: "رد", guard: "grc_acceptance_by_owner" },
    { from: ["active"], to: "revoked", label: "ابطال", requires: ["notes"] },
    { from: ["active"], to: "expired", label: "انقضا", roles: { area: "risk", level: "full" } },
    { from: ["rejected"], to: "requested", label: "درخواست دوباره" },
  ],
  locked: ["closed"],
};

const grcRiskAcceptance: TableDef = {
  key: "grc_risk_acceptance",
  table: "sm_grc_risk_acceptances",
  label: "پذیرش ریسک",
  plural: "پذیرش‌های ریسک",
  icon: "stamp",
  module: "security",
  area: "risk",
  description: "پذیرش رسمی یک ریسک به دست مالک آن، با شرط‌ها و تاریخ انقضا؛ پیش از انقضا یادآوری و پس از آن ریسک دوباره ارزیابی می‌شود",
  numbered: { prefix: "RAC", pad: 6 },
  display: "risk_id",
  fields: [
    { name: "risk_id", label: "ریسک", type: "ref", ref: "grc_risk", required: true, list: true, filter: true, index: true, span: 12 },
    { name: "expires_at", label: "تاریخ انقضا", type: "date", required: true, list: true, sort: true, filter: true, span: 6 },
    { name: "accepted_by", label: "پذیرنده (مالک ریسک)", type: "user", list: true, filter: true, index: true, span: 6, help: "خالی: مالک کنونی ریسک" },
    { name: "requested_by", label: "درخواست‌کننده", type: "user", default: "$me", filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "residual_score", label: "امتیاز باقی‌مانده هنگام پذیرش", type: "int", readonly: true, span: 8 },
    { name: "conditions", label: "شرط‌ها", type: "text", required: true, span: 24 },
    { name: "approval", label: "تأیید", type: "choice", choices: APPROVAL_STATES, default: "not_requested", readonly: true, filter: true, span: 8 },
    { name: "accepted_at", label: "زمان پذیرش", type: "datetime", system: true, span: 8 },
    { name: "warned_at", label: "یادآوری انقضا", type: "datetime", system: true, audit: false, span: 8 },
    { name: "notes", label: "یادداشت", type: "text", span: 24 },
  ],
  states: ACCEPTANCE_STATES,
  scope: { own: ["accepted_by", "requested_by"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, approvals: true },
  list: { columns: ["number", "risk_id", "state", "accepted_by", "expires_at"], order: "expires_at" },
};

const grcKri: TableDef = {
  key: "grc_kri",
  table: "sm_grc_kris",
  label: "شاخص کلیدی ریسک",
  plural: "شاخص‌های کلیدی ریسک",
  icon: "activity",
  module: "security",
  area: "risk",
  description: "شاخصی که از داده‌های خود سامانه سنجیده می‌شود، با آستانهٔ هشدار و عبور؛ روند آن در تاریخچه می‌ماند",
  display: "name",
  fields: [
    { name: "name", label: "نام", type: "string", required: true, maxLength: 160, list: true, search: true, span: 12 },
    { name: "risk_id", label: "ریسک", type: "ref", ref: "grc_risk", list: true, filter: true, index: true, span: 12 },
    { name: "indicator", label: "سنجه", type: "choice", choices: INDICATOR_OPTIONS.filter((x) => x.value !== "none"), required: true, span: 12 },
    { name: "direction", label: "جهت", type: "choice", choices: KRI_DIRECTIONS, default: "higher_worse", span: 12 },
    { name: "warn_at", label: "آستانهٔ هشدار", type: "decimal", span: 8 },
    { name: "breach_at", label: "آستانهٔ عبور", type: "decimal", span: 8 },
    { name: "owner_id", label: "مالک", type: "user", filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "last_value", label: "آخرین مقدار", type: "decimal", system: true, list: true, span: 8 },
    { name: "status", label: "وضعیت", type: "choice", choices: KRI_STATUS, system: true, default: "unknown", list: true, filter: true, span: 8 },
    { name: "measured_at", label: "زمان سنجش", type: "datetime", system: true, span: 8 },
  ],
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  list: { columns: ["name", "risk_id", "last_value", "status", "measured_at"], order: "name" },
};

export const LOSS_STATES: StateModel = {
  field: "state",
  initial: "open",
  states: [
    { value: "open", label: "باز", category: "new", color: "blue" },
    { value: "analysed", label: "تحلیل‌شده", category: "active", color: "teal" },
    { value: "closed", label: "بسته", category: "closed", color: "gray" },
  ],
  transitions: [
    { from: ["open"], to: "analysed", label: "تحلیل شد" },
    { from: ["open", "analysed"], to: "closed", label: "بستن" },
    { from: ["closed"], to: "analysed", label: "بازگشایی" },
  ],
  locked: [],
};

const grcRiskEvent: TableDef = {
  key: "grc_risk_event",
  table: "sm_grc_risk_events",
  label: "رویداد زیان",
  plural: "رویدادهای زیان",
  icon: "trending-down",
  module: "security",
  area: "risk",
  description: "ریسکی که رخ داد: زمان، زیان و بازیافت، و رخدادی که آن را نشان داد",
  numbered: { prefix: "LOSS", pad: 5 },
  display: "title",
  fields: [
    { name: "title", label: "عنوان", type: "string", required: true, maxLength: 200, list: true, search: true, span: 24 },
    { name: "risk_id", label: "ریسک", type: "ref", ref: "grc_risk", list: true, filter: true, index: true, span: 12 },
    { name: "incident_id", label: "رخداد", type: "ref", ref: "incident", filter: true, span: 12 },
    { name: "occurred_at", label: "زمان رخداد", type: "datetime", required: true, default: "$now", list: true, sort: true, span: 8 },
    { name: "loss_amount", label: "زیان", type: "money", min: 0, list: true, span: 8 },
    { name: "recovered_amount", label: "بازیافت", type: "money", min: 0, span: 8 },
    { name: "owner_id", label: "مالک", type: "user", default: "$me", filter: true, span: 8 },
    { name: "assignment_group_id", label: "گروه", type: "group", filter: true, span: 8 },
    { name: "description", label: "شرح", type: "markdown", span: 24 },
  ],
  states: LOSS_STATES,
  scope: { own: ["owner_id"], group: "assignment_group_id", requester: [] },
  features: { journal: true, attachments: true, links: true },
  list: { columns: ["number", "title", "risk_id", "occurred_at", "loss_amount", "state"], order: "-occurred_at" },
};

/** Tables kept in the secure workspace «امنیت» by the module's hook (members only; no admin bypass). */
export const SECURE_TABLES = ["sec_incident", "sec_task", "sec_observable", "sec_evidence", "sec_reg_clock"] as const;

export const SECURITY_TABLES: TableDef[] = [
  secIncident, secTask, secObservable, secEvidence, secRegClock, secRegRegime, secPlaybook,
  secVulnerability, secVulnItem, secRemediation, secException, secScanImport, secReview, secVerification, secConfig,
  grcFramework, grcRequirement, grcControl, grcControlTest, grcIssue, grcEvidence, grcPolicy, grcCampaign, grcAck, grcPolicyException,
  grcAudit, grcFinding, grcCsfProfile, grcRegAlert, grcRopa, grcDsr,
  grcRisk, grcRiskMatrix, grcRiskAppetite, grcRiskAction, grcRiskAcceptance, grcKri, grcRiskEvent,
];
