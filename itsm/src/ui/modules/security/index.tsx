// The security module's screens (docs/modules/security_FA.md). Two sidebar spaces:
//   «امنیت» (security operations and vulnerability response; members who read the security area)
//     groups       «عملیات امنیت» (SOC workspace, queues, incidents, response tasks, observables and threat indicators,
//                  evidence, regulatory clocks, security reviews, playbooks, regimes, the dashboard),
//                  «آسیب‌پذیری» (items, overdue, remediation groups, exceptions, the library, scanner imports),
//                  «ابزارهای امنیت» (access and privileged-action review, hardening — for access administrators and
//                  auditors)
//   «انطباق» (governance, risk and compliance; items gated by the compliance and risk areas)
//     groups       «حاکمیت و انطباق» (frameworks and requirements, the SoA, controls, tests, evidence, issues,
//                  policies, campaigns, waivers, audits, findings, CSF profiles, regulatory change, privacy, policy
//                  questions), «ریسک» (register, heat map, actions, acceptances, KRIs, losses, matrices, appetite)
//   «خانه» for every member: «گزارش رایانامهٔ مشکوک» and «خط‌مشی‌های من»
// Record pages get the module's header actions and side panels; IT incidents get «ارتقا به رخداد امنیتی» and caller
// verification. Only light modules are imported here; every component loads with its page.
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import {
  ShieldAlert, ShieldCheck, ShieldX, ShieldHalf, Bug, FingerprintPattern, FileLock, AlarmClock, Landmark, BookOpenCheck, Wrench, ShieldQuestionMark, ScanSearch, ScanEye, BadgeCheck, Settings2,
  Library, ListTree, FlaskConical, CircleAlert, FileCheck, ScrollText, Megaphone, FileExclamationPoint, ClipboardList, SearchCheck, Radar, BellRing, DatabaseZap, UserSearch, TriangleAlert,
  Grid3x3, Gauge, ListTodo, Stamp, Activity, TrendingDown, MailWarning, ChartColumn, Scale, KeyRound, User, Users, Flame, Hourglass, MessageCircleQuestionMark, Upload, ListChecks, Crosshair,
} from "lucide-react";
import type { AccessGate } from "@shared/access";
import type { ModuleUi, NavGroup, NavItem } from "../registry";
import { recordModule, RecordListRoute } from "../../records/module";
import { registerRecordExtensions, type RecordContext } from "../../records/extensions";
import type { ListPreset } from "../../records/extensions";
import { Loader } from "../../components/display";

const Soc = lazy(() => import("./Soc"));
const Dashboard = lazy(() => import("./Dashboard"));
const ScanImport = lazy(() => import("./ScanImport"));
const Soa = lazy(() => import("./Soa"));
const Heatmap = lazy(() => import("./Heatmap"));
const MyPolicies = lazy(() => import("./MyPolicies"));
const ReportPhishing = lazy(() => import("./ReportPhishing"));
const Review = lazy(() => import("./Review"));
const PolicyAsk = lazy(() => import("./PolicyAsk"));
const SirActions = lazy(() => import("./Actions").then((m) => ({ default: m.SirActions })));
const PromoteAction = lazy(() => import("./Actions").then((m) => ({ default: m.PromoteAction })));
const VerifyAction = lazy(() => import("./Actions").then((m) => ({ default: m.VerifyAction })));
const RemediationActions = lazy(() => import("./Actions").then((m) => ({ default: m.RemediationActions })));
const SirPanel = lazy(() => import("./Panels").then((m) => ({ default: m.SirPanel })));
const RiskFactorsPanel = lazy(() => import("./Panels").then((m) => ({ default: m.RiskFactorsPanel })));
const ClockPanel = lazy(() => import("./Panels").then((m) => ({ default: m.ClockPanel })));
const CustodyPanel = lazy(() => import("./Panels").then((m) => ({ default: m.CustodyPanel })));
const CrosswalkPanel = lazy(() => import("./Panels").then((m) => ({ default: m.CrosswalkPanel })));
const CampaignPanel = lazy(() => import("./Panels").then((m) => ({ default: m.CampaignPanel })));
const RiskMatrixPanel = lazy(() => import("./Panels").then((m) => ({ default: m.RiskMatrixPanel })));
const PiiPanel = lazy(() => import("./Panels").then((m) => ({ default: m.PiiPanel })));

const widget = (C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense fallback={<Loader />}>
    <C ctx={ctx} />
  </Suspense>
);
const action = (key: string, C: ComponentType<{ ctx: RecordContext }>) => (ctx: RecordContext): ReactNode => (
  <Suspense key={key} fallback={null}>
    <C ctx={ctx} />
  </Suspense>
);
const lazyPage = (node: ReactNode) => <Suspense fallback={<Loader />}>{node}</Suspense>;

const SEC: AccessGate = { area: "security" };
const SEC_MANAGE: AccessGate = { area: "security", op: "approve" };
const COMP: AccessGate = { area: "compliance" };
const COMP_MANAGE: AccessGate = { area: "compliance", op: "approve" };
const RISK: AccessGate = { area: "risk" };
const RISK_MANAGE: AccessGate = { area: "risk", op: "approve" };
const AUDIT: AccessGate = { area: "audit", scope: "all" };

export const SECURITY_SPACE = { key: "security", label: "امنیت", title: "عملیات امنیت و آسیب‌پذیری", icon: ShieldHalf, access: SEC };
export const GRC_SPACE = { key: "grc", label: "انطباق", title: "ریسک، حاکمیت و انطباق", icon: Scale };

const DEFS = "تعریف‌ها";
const REPORTS = "گزارش‌ها";
const PRIVACY = "حریم خصوصی";

const OPEN_SIR = ["draft", "analysis", "contain", "eradicate", "recover"];
const sirTone = (r: Record<string, unknown>) => (r.regulatory_overdue ? "danger" : r.severity === "1" ? "warning" : null);
const vulnTone = (r: Record<string, unknown>) => (r.overdue ? "danger" : r.kev ? "warning" : null);

interface Queue {
  key: string;
  label: string;
  path: string;
  icon: typeof User;
  table: string;
  preset: ListPreset;
}

const QUEUES: Queue[] = [
  { key: "mine", label: "رخدادهای من", path: "security/queue/mine", icon: User, table: "sec_incident", preset: { filter: { and: [{ f: "state", op: "in", v: OPEN_SIR }, { or: [{ f: "assigned_to", op: "is_me" }, { f: "lead_id", op: "is_me" }] }] }, sort: "-risk_score", emptyText: "رخداد امنیتی بازی به شما سپرده نشده است", rowTone: sirTone } },
  { key: "unassigned", label: "بی‌تحلیل‌گر", path: "security/queue/unassigned", icon: Users, table: "sec_incident", preset: { filter: { and: [{ f: "state", op: "in", v: OPEN_SIR }, { f: "assigned_to", op: "empty" }] }, sort: "-risk_score", emptyText: "همهٔ رخدادهای باز تحلیل‌گر دارند", rowTone: sirTone } },
  { key: "critical", label: "بحرانی و بالا", path: "security/queue/critical", icon: Flame, table: "sec_incident", preset: { filter: { and: [{ f: "state", op: "in", v: OPEN_SIR }, { f: "severity", op: "in", v: ["1", "2"] }] }, sort: "-risk_score", emptyText: "رخداد بحرانی یا بالای بازی نیست", rowTone: sirTone } },
  { key: "contain", label: "در مرحلهٔ مهار", path: "security/queue/contain", icon: Crosshair, table: "sec_incident", preset: { filter: { f: "state", op: "eq", v: "contain" }, sort: "sla_due", emptyText: "رخدادی در مرحلهٔ مهار نیست", rowTone: sirTone } },
  { key: "overdue", label: "آسیب‌پذیری گذشته از موعد", path: "security/vuln/overdue", icon: Hourglass, table: "sec_vuln_item", preset: { filter: { and: [{ f: "state", op: "in", v: ["open", "in_remediation"] }, { f: "overdue", op: "eq", v: true }] }, sort: "due_at", emptyText: "موردی از موعد رفع نگذشته است", rowTone: vulnTone } },
];

const queueNav = (q: Queue): NavItem => ({ key: `security:q:${q.key}`, label: q.label, path: q.path, icon: q.icon, area: "work", access: SEC, workspace: q.key === "mine", keywords: "امنیت صف SOC" });

// ---------------------------------------------------------------------------------------------------------------
// Security operations

const ops = recordModule({
  key: "security",
  space: SECURITY_SPACE,
  group: { key: "security-ops", label: "عملیات امنیت" },
  tables: [
    {
      table: "sec_incident", path: "security/incidents", label: "رخدادهای امنیتی", noun: "رخداد امنیتی", icon: ShieldAlert, area: "work", access: SEC,
      keywords: "رخداد امنیتی SIR نفوذ بدافزار فیشینگ نشت", search: { group: "رخدادهای امنیتی" },
      list: { preset: { rowTone: sirTone, emptyText: "هنوز رخداد امنیتی‌ای ثبت نشده است", board: { cardFields: ["severity", "risk_score", "assigned_to"] } } },
      extensions: {
        headerActions: action("sec-sir", SirActions),
        sidePanels: [{ key: "sec:facts", title: "زمان‌ها، نشانگرها و اطلاع‌رسانی", order: 1, render: widget(SirPanel) }],
        cardFields: ["severity", "risk_score", "assigned_to"],
        policies: [
          { key: "sec:pdb", when: { f: "personal_data_breach", op: "eq", v: false }, actions: [{ field: "records_affected", visible: false }] },
          { key: "sec:review", when: { f: "state", op: "in", v: ["draft", "analysis"] }, actions: [{ field: "close_code", visible: false }, { field: "close_notes", visible: false }] },
        ],
      },
    },
    { table: "sec_task", path: "security/tasks", label: "کارهای پاسخ", noun: "کار پاسخ", icon: ListChecks, area: "work", access: SEC, keywords: "کار پاسخ مهار جداسازی مسدودسازی", newAction: false },
    { table: "sec_observable", path: "security/observables", label: "نشانگرها و اطلاعات تهدید", noun: "نشانگر", icon: FingerprintPattern, area: "work", access: SEC, keywords: "نشانگر IOC آی‌پی دامنه هش اطلاعات تهدید" },
    { table: "sec_evidence", path: "security/evidence", label: "شواهد", noun: "شاهد", icon: FileLock, area: "work", access: SEC, keywords: "شاهد زنجیرهٔ حضانت توقیف قانونی هش" },
    { table: "sec_reg_clock", path: "security/clocks", label: "ساعت‌های الزامی", noun: "ساعت الزامی", icon: AlarmClock, area: "work", access: SEC, keywords: "اطلاع‌رسانی الزامی ماهر افتا GDPR NIS2 موعد", newAction: false },
    { table: "sec_review", path: "security/reviews", label: "بازبینی‌های امنیتی", noun: "بازبینی امنیتی", icon: ScanEye, area: "work", access: SEC, keywords: "بازبینی امنیتی تغییر دروازه" },
    { table: "sec_verification", path: "security/verifications", label: "احراز هویت‌ها", icon: BadgeCheck, area: "work", access: SEC, hidden: true, search: false, newAction: false },
    { table: "sec_playbook", path: "security/playbooks", label: "دستورالعمل‌های پاسخ", noun: "دستورالعمل پاسخ", icon: BookOpenCheck, section: DEFS, area: "work", access: SEC_MANAGE, search: false, keywords: "دستورالعمل پاسخ playbook ران‌بوک" },
    { table: "sec_reg_regime", path: "security/regimes", label: "مقررات اطلاع‌رسانی", noun: "مقررات", icon: Landmark, section: DEFS, area: "work", access: SEC_MANAGE, search: false, keywords: "مقررات ماهر افتا بانک مرکزی GDPR NIS2" },
    { table: "sec_config", path: "security/settings", label: "تنظیمات امنیت", icon: Settings2, section: DEFS, area: "settings", access: SEC_MANAGE, search: false, newAction: false, keywords: "تنظیمات امنیت فضای امن" },
  ],
  nav: [
    { key: "security:soc", label: "میز کار SOC", path: "security/soc", icon: Activity, area: "work", access: SEC, workspace: true, keywords: "SOC مرکز عملیات امنیت تحویل شیفت" },
    { key: "security:dashboard", label: "داشبورد امنیت و انطباق", path: "security/dashboard", icon: ChartColumn, section: REPORTS, area: "work", access: SEC, keywords: "داشبورد شاخص MTTD MTTR انطباق" },
  ],
  routes: [
    ...QUEUES.map((q) => ({ path: q.path, element: <RecordListRoute table={q.table} title={q.label} preset={q.preset} /> })),
    { path: "security/soc", element: lazyPage(<Soc />) },
    { path: "security/dashboard", element: lazyPage(<Dashboard />) },
    { path: "security/vuln/import", element: lazyPage(<ScanImport />) },
    { path: "security/review", element: lazyPage(<Review />) },
    { path: "security/report", element: lazyPage(<ReportPhishing />) },
    { path: "security/my-policies", element: lazyPage(<MyPolicies />) },
  ],
  segments: { security: "security" },
});

// ---------------------------------------------------------------------------------------------------------------
// Vulnerability response

const vuln = recordModule({
  key: "security-vuln",
  spaceKey: "security",
  group: { key: "security-vuln", label: "آسیب‌پذیری" },
  tables: [
    {
      table: "sec_vuln_item", path: "security/vuln/items", label: "موردهای آسیب‌پذیر", noun: "مورد آسیب‌پذیر", icon: ShieldX, area: "work", access: SEC, workspace: true,
      keywords: "آسیب‌پذیری CVE مورد آسیب‌پذیر وصله", search: { group: "موردهای آسیب‌پذیر" },
      list: { preset: { rowTone: vulnTone, emptyText: "موردی ثبت نشده است؛ نتیجهٔ پویش را وارد کنید" } },
      extensions: { sidePanels: [{ key: "sec:risk", title: "عامل‌های ریسک", order: 1, render: widget(RiskFactorsPanel) }], cardFields: ["risk_rating", "due_at", "assigned_to"] },
    },
    { table: "sec_vuln_remediation", path: "security/vuln/remediations", label: "گروه‌های رفع", noun: "گروه رفع", icon: Wrench, area: "work", access: SEC, keywords: "رفع وصله راه‌حل گروه", extensions: { headerActions: action("sec-rem", RemediationActions) } },
    { table: "sec_vuln_exception", path: "security/vuln/exceptions", label: "استثناها", noun: "استثنای آسیب‌پذیری", icon: ShieldQuestionMark, area: "work", access: SEC, keywords: "استثنا تعویق پذیرش ریسک VEX" },
    { table: "sec_vulnerability", path: "security/vuln/library", label: "کتابخانهٔ آسیب‌پذیری", noun: "آسیب‌پذیری", icon: Bug, area: "work", access: SEC, keywords: "CVE CVSS EPSS KEV کتابخانه" },
    { table: "sec_scan_import", path: "security/vuln/scans", label: "ورودهای پویش", icon: ScanSearch, area: "work", access: SEC, newAction: false, search: false, keywords: "پویش Nessus Qualys OpenVAS" },
  ],
  nav: [
    queueNav(QUEUES[4]),
    { key: "security:import", label: "ورود نتیجهٔ پویش", path: "security/vuln/import", icon: Upload, area: "work", access: { area: "security", op: "create" }, keywords: "ورود پویش Nessus Qualys OpenVAS CSV XML" },
  ],
});

const tools: NavGroup = {
  key: "security-tools",
  label: "ابزارهای امنیت",
  space: "security",
  items: [{ key: "security:review", label: "بازبینی دسترسی و سخت‌سازی", path: "security/review", icon: KeyRound, area: "work", access: AUDIT, keywords: "دسترسی ممتاز ممیزی سخت‌سازی حساب بی‌استفاده تفکیک وظایف" }],
};

// ---------------------------------------------------------------------------------------------------------------
// Governance and compliance; risk

const grc = recordModule({
  key: "grc",
  space: GRC_SPACE,
  group: { key: "grc", label: "حاکمیت و انطباق" },
  tables: [
    { table: "grc_control", path: "grc/controls", label: "کتابخانهٔ کنترل‌ها", noun: "کنترل", icon: ShieldCheck, area: "work", access: COMP, workspace: true, keywords: "کنترل پایش اثربخشی نگاشت", extensions: { sidePanels: [{ key: "grc:xwalk", title: "نگاشت به چارچوب‌ها", order: 1, render: widget(CrosswalkPanel) }] } },
    { table: "grc_requirement", path: "grc/requirements", label: "الزام‌ها", noun: "الزام", icon: ListTree, area: "work", access: COMP, keywords: "الزام بند پیوست الف کاربست‌پذیری" },
    { table: "grc_framework", path: "grc/frameworks", label: "چارچوب‌ها و مقررات", noun: "چارچوب", icon: Library, area: "work", access: COMP, search: false, keywords: "ISO 27001 NIST CSF 20000 افتا" },
    { table: "grc_control_test", path: "grc/tests", label: "آزمون‌های کنترل", noun: "آزمون کنترل", icon: FlaskConical, area: "work", access: COMP, keywords: "آزمون خودارزیابی نمونه" },
    { table: "grc_evidence", path: "grc/evidence", label: "شواهد انطباق", noun: "شاهد انطباق", icon: FileCheck, area: "work", access: COMP, keywords: "شاهد انطباق ممیزی" },
    { table: "grc_issue", path: "grc/issues", label: "مسائل", noun: "مسئله", icon: CircleAlert, area: "work", access: COMP, keywords: "مسئله عدم انطباق رفع" },
    { table: "grc_policy", path: "grc/policies", label: "خط‌مشی‌ها", noun: "خط‌مشی", icon: ScrollText, area: "work", access: COMP, keywords: "خط‌مشی استاندارد روال" },
    { table: "grc_policy_campaign", path: "grc/campaigns", label: "کارزارهای پذیرش", noun: "کارزار پذیرش", icon: Megaphone, area: "work", access: COMP, keywords: "پذیرش خط‌مشی خواندم و می‌پذیرم", extensions: { sidePanels: [{ key: "grc:camp", title: "وضعیت پذیرش", order: 1, render: widget(CampaignPanel), participants: true }] } },
    { table: "grc_policy_ack", path: "grc/acks", label: "پذیرش‌ها", icon: Stamp, area: "work", access: COMP, hidden: true, search: false, newAction: false },
    { table: "grc_policy_exception", path: "grc/waivers", label: "استثناهای خط‌مشی", noun: "استثنای خط‌مشی", icon: FileExclamationPoint, area: "work", access: COMP, keywords: "استثنا معافیت خط‌مشی" },
    { table: "grc_audit", path: "grc/audits", label: "ممیزی‌ها", noun: "ممیزی", icon: ClipboardList, area: "work", access: COMP, keywords: "ممیزی داخلی گواهی" },
    { table: "grc_finding", path: "grc/findings", label: "یافته‌های ممیزی", noun: "یافتهٔ ممیزی", icon: SearchCheck, area: "work", access: COMP, keywords: "یافته عدم انطباق" },
    { table: "grc_csf_profile", path: "grc/csf", label: "پروفایل‌های NIST CSF", noun: "پروفایل CSF", icon: Radar, area: "work", access: COMP, search: false, keywords: "NIST CSF پروفایل شکاف" },
    { table: "grc_reg_alert", path: "grc/reg-alerts", label: "تغییرهای مقررات", noun: "تغییر مقررات", icon: BellRing, area: "work", access: COMP, keywords: "مقررات بخشنامه تغییر" },
    { table: "grc_ropa", path: "grc/privacy/ropa", label: "فعالیت‌های پردازش داده", noun: "فعالیت پردازش", icon: DatabaseZap, section: PRIVACY, area: "work", access: COMP, keywords: "حریم خصوصی پردازش داده DPIA" },
    { table: "grc_dsr", path: "grc/privacy/dsr", label: "درخواست‌های صاحبان داده", noun: "درخواست صاحب داده", icon: UserSearch, section: PRIVACY, area: "work", access: COMP, keywords: "صاحب داده حذف دسترسی" },
  ],
  nav: [
    { key: "grc:soa", label: "بیانیهٔ کاربست‌پذیری", path: "grc/soa", icon: ListChecks, area: "work", access: COMP, keywords: "SoA کاربست‌پذیری پیوست الف ۲۷۰۰۱" },
    { key: "grc:ask", label: "پرسش از خط‌مشی‌ها", path: "grc/ask", icon: MessageCircleQuestionMark, area: "work", access: COMP, keywords: "پرسش خط‌مشی هوش مصنوعی" },
    { key: "grc:dashboard", label: "داشبورد انطباق", path: "grc/dashboard", icon: ChartColumn, section: REPORTS, area: "work", access: COMP, keywords: "داشبورد انطباق درصد کنترل" },
  ],
  routes: [
    { path: "grc/soa", element: lazyPage(<Soa />) },
    { path: "grc/ask", element: lazyPage(<PolicyAsk />) },
    { path: "grc/dashboard", element: lazyPage(<Dashboard />) },
    { path: "grc/heatmap", element: lazyPage(<Heatmap />) },
  ],
  segments: { grc: "grc" },
});

const risk = recordModule({
  key: "grc-risk",
  spaceKey: "grc",
  group: { key: "grc-risk", label: "ریسک" },
  tables: [
    { table: "grc_risk", path: "grc/risks", label: "ثبت ریسک‌ها", noun: "ریسک", icon: TriangleAlert, area: "work", access: RISK, workspace: true, keywords: "ریسک ثبت احتمال اثر درمان", search: { group: "ریسک‌ها" }, extensions: { sidePanels: [{ key: "grc:matrix", title: "جایگاه در ماتریس", order: 1, render: widget(RiskMatrixPanel) }] } },
    { table: "grc_risk_action", path: "grc/risk-actions", label: "اقدام‌های درمان", noun: "اقدام درمان", icon: ListTodo, area: "work", access: RISK, keywords: "اقدام درمان ریسک" },
    { table: "grc_risk_acceptance", path: "grc/acceptances", label: "پذیرش‌های ریسک", noun: "پذیرش ریسک", icon: Stamp, area: "work", access: RISK, keywords: "پذیرش ریسک انقضا" },
    { table: "grc_kri", path: "grc/kris", label: "شاخص‌های کلیدی ریسک", noun: "شاخص کلیدی ریسک", icon: Gauge, area: "work", access: RISK, search: false, keywords: "KRI شاخص آستانه" },
    { table: "grc_risk_event", path: "grc/losses", label: "رویدادهای زیان", noun: "رویداد زیان", icon: TrendingDown, area: "work", access: RISK, keywords: "زیان رویداد ریسک" },
    { table: "grc_risk_matrix", path: "grc/matrices", label: "ماتریس‌های ریسک", noun: "ماتریس ریسک", icon: Grid3x3, section: DEFS, area: "work", access: RISK_MANAGE, search: false, keywords: "ماتریس احتمال اثر" },
    { table: "grc_risk_appetite", path: "grc/appetite", label: "اشتهای ریسک", noun: "اشتهای ریسک", icon: Gauge, section: DEFS, area: "work", access: RISK_MANAGE, search: false, keywords: "اشتها تحمل ریسک" },
  ],
  nav: [{ key: "grc:heatmap", label: "نقشهٔ حرارتی ریسک", path: "grc/heatmap", icon: Grid3x3, area: "work", access: RISK, keywords: "نقشهٔ حرارتی ریسک اشتها" }],
});

// every member: report a suspicious e-mail, read and accept policies
const mine: NavGroup = {
  key: "security-mine",
  label: "امنیت من",
  space: "home",
  items: [
    { key: "security:report", label: "گزارش رایانامهٔ مشکوک", path: "security/report", icon: MailWarning, keywords: "فیشینگ رایانامهٔ مشکوک گزارش امنیت" },
    { key: "security:my-policies", label: "خط‌مشی‌های من", path: "security/my-policies", icon: ScrollText, keywords: "خط‌مشی پذیرش خواندم" },
  ],
};

// IT incidents and requests: promotion to a security incident, caller verification, personal data
for (const table of ["incident", "request_item"]) registerRecordExtensions(table, { headerActions: action(`sec-verify-${table}`, VerifyAction) });
registerRecordExtensions("incident", { headerActions: action("sec-promote", PromoteAction) });
for (const table of ["incident", "sec_incident", "request_item", "grc_dsr"]) {
  registerRecordExtensions(table, { sidePanels: [{ key: "sec:pii", title: "دادهٔ شخصی", order: 60, render: widget(PiiPanel) }] });
}
registerRecordExtensions("sec_reg_clock", { sidePanels: [{ key: "sec:clock", title: "موعدها و ارسال‌ها", order: 1, render: widget(ClockPanel) }] });
registerRecordExtensions("sec_evidence", { sidePanels: [{ key: "sec:custody", title: "زنجیرهٔ حضانت", order: 1, render: widget(CustodyPanel) }] });

const [opsGroup] = ops.nav;
const opsWithQueues: NavGroup = { ...opsGroup, items: [...QUEUES.slice(0, 4).map(queueNav), ...opsGroup.items] };

export const securityUi: ModuleUi = {
  spaces: [SECURITY_SPACE, GRC_SPACE],
  nav: [opsWithQueues, ...vuln.nav, tools, ...grc.nav, ...risk.nav, mine],
  routes: [...ops.routes, ...vuln.routes, ...grc.routes, ...risk.routes],
  searches: [...(ops.searches ?? []), ...(vuln.searches ?? []), ...(grc.searches ?? []), ...(risk.searches ?? [])],
  segments: { ...ops.segments, ...grc.segments },
};
