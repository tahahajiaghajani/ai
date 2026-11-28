// The bank's own fields, forms, organisational roles and workflows (release 1.1.5, docs/DEMO_FA.md «گردش‌کارهای
// نمونه»), and the scripts of their sample cases: pure data, read by ./workflows.ts, which writes them as the pack's
// rows inside the demo scope and plays the scripts as the pack's people through the workflows' own services.
//   · fields «u_aftab_*», forms and positions «… (نمونه)» with keys «aftab_*»: never a real organisation's name or key
//     (a clash refuses only that part, and what depends on it);
//   · every assignee rule names only the pack's people: its positions and their holders, its groups, its personas,
//     the managers and unit heads it sets on its own profiles and units, a person field, an earlier actor, the
//     requester — never an access role or a real group, so a case of the pack never reaches the organisation's people;
//   · every process names the pack's managers, and only the pack's people start it (its starters);
//   · no sample is left at a step whose time runs out by itself after the load: «پایان مهلت» is shown by one case
//     whose step the load dates back (./workflows.ts), every other open sample waits at a step without a time.
// The owner's case of the 1.1.5 reports is «گردش کار پروژه (نمونه)»: one tabbed form in two steps, the second for the
// holders of «مدیر گروه (نمونه)». Its version 1 keeps the designer's old default «واحد درخواست‌دهنده», and one case
// stays on it waiting for its managers — the journal says why nobody was found, and «دوباره پیدا کردن انجام‌دهنده»
// with the rules of version 2 («همه‌جا») gives the step to the holders.
import type { FormLayoutV2 } from "@shared/forms/layout";
import type { AssigneeRule } from "@shared/process/assignees";
import type { ProcessGraph } from "@shared/process/graph";
import { Rng, type DemoSize, type Persona } from "./bank";

// ----- fields -----------------------------------------------------------------------------------------------------

export interface WfField {
  name: string;
  label: string;
  type: string;
  help?: string;
  options?: { value: string; label: string }[];
  validation?: Record<string, unknown>;
  default_value?: string;
}

const opts = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

/** The library fields of the bank's workflows (the access request's four are ./bank.ts DEMO_WORKFLOW's). */
export const WF_FIELDS = {
  // «گردش کار پروژه»
  prjName: { name: "u_aftab_prj_name", label: "نام پروژه", type: "string", validation: { maxLength: 120 } },
  prjPriority: { name: "u_aftab_prj_priority", label: "اولویت پروژه", type: "select", options: opts(["normal", "عادی"], ["urgent", "فوری"], ["critical", "بحرانی"]), default_value: "normal" },
  prjStart: { name: "u_aftab_prj_start", label: "تاریخ شروع", type: "date" },
  prjManager: { name: "u_aftab_prj_manager", label: "مدیر پروژه", type: "user" },
  prjUnit: { name: "u_aftab_prj_unit", label: "واحد مجری", type: "unit" },
  prjDelay: { name: "u_aftab_prj_delay", label: "تعداد روز تأخیر", type: "int", validation: { min: 0, max: 365 }, help: "روزهایی که پروژه از برنامه عقب است؛ صفر یعنی بی‌تأخیر" },
  prjDelayReason: { name: "u_aftab_prj_delay_reason", label: "علت تأخیر", type: "text" },
  prjReview: { name: "u_aftab_prj_review", label: "نظر مدیر گروه", type: "text" },
  prjProgress: { name: "u_aftab_prj_progress", label: "درصد پیشرفت", type: "percent", validation: { min: 0, max: 100 } },
  prjDocs: { name: "u_aftab_prj_docs", label: "نشانی مستندات پروژه", type: "url" },
  prjFollow: { name: "u_aftab_prj_follow", label: "نقش پیگیری‌کننده", type: "position" },
  // «درخواست تنخواه شعبه»
  pcAmount: { name: "u_aftab_pc_amount", label: "مبلغ درخواستی", type: "money", validation: { max: 2_000_000_000 } },
  pcNeedDate: { name: "u_aftab_pc_need_date", label: "تاریخ نیاز", type: "date" },
  pcPurpose: { name: "u_aftab_pc_purpose", label: "شرح نیاز", type: "text" },
  pcInvoice: { name: "u_aftab_pc_invoice", label: "پیش‌فاکتور", type: "attachment", validation: { max: 3 } },
  pcFinanceNote: { name: "u_aftab_pc_finance_note", label: "نظر مالی", type: "text" },
  pcPaidRef: { name: "u_aftab_pc_paid_ref", label: "شمارهٔ سند پرداخت", type: "string" },
  pcIban: { name: "u_aftab_pc_iban", label: "شمارهٔ شبای دریافت‌کننده", type: "iban" },
  // «درخواست مرخصی و معرفی جانشین»
  lvType: { name: "u_aftab_lv_type", label: "نوع مرخصی", type: "radio", options: opts(["annual", "استحقاقی"], ["sick", "استعلاجی"], ["unpaid", "بدون حقوق"]) },
  lvDays: { name: "u_aftab_lv_days", label: "تعداد روز", type: "int", validation: { min: 1, max: 30 } },
  lvFrom: { name: "u_aftab_lv_from", label: "از تاریخ", type: "date" },
  lvSub: { name: "u_aftab_lv_sub", label: "جانشین در مدت مرخصی", type: "user" },
  lvStatus: { name: "u_aftab_lv_status", label: "وضعیت ثبت", type: "string", help: "گردش‌کار پس از تأیید می‌نویسد" },
  lvHrOk: { name: "u_aftab_lv_hr_ok", label: "سوابق مرخصی بررسی شد", type: "checkbox" },
  lvHrNote: { name: "u_aftab_lv_hr_note", label: "نظر منابع انسانی", type: "text" },
  lvMobile: { name: "u_aftab_lv_mobile", label: "تلفن همراه در مدت مرخصی", type: "mobile" },
  // «تأیید قرارداد خرید تجهیزات»
  prVendor: { name: "u_aftab_pr_vendor", label: "تأمین‌کننده", type: "string" },
  prAmount: { name: "u_aftab_pr_amount", label: "مبلغ قرارداد", type: "money" },
  prRisk: { name: "u_aftab_pr_risk", label: "سطح ریسک", type: "radio", options: opts(["low", "کم"], ["medium", "متوسط"], ["high", "زیاد"]) },
  prSecurity: { name: "u_aftab_pr_security", label: "نظر امنیت اطلاعات", type: "text" },
  prTech: { name: "u_aftab_pr_tech", label: "نظر فنی", type: "text" },
  prFin: { name: "u_aftab_pr_fin", label: "نظر مالی خرید", type: "text" },
  prVendorEmail: { name: "u_aftab_pr_vendor_email", label: "ایمیل تأمین‌کننده", type: "email" },
  prVendorPhone: { name: "u_aftab_pr_vendor_phone", label: "تلفن تأمین‌کننده", type: "phone" },
  prItems: { name: "u_aftab_pr_items", label: "دسته‌های تجهیزات", type: "multiselect", options: opts(["terminal", "پایانه و خودپرداز"], ["network", "شبکه"], ["storage", "ذخیره‌سازی"], ["server", "سرور"]) },
  prAdjust: { name: "u_aftab_pr_adjust", label: "ضریب تعدیل قیمت", type: "decimal", validation: { min: 0, max: 3, decimals: 2 } },
  prRenewal: { name: "u_aftab_pr_renewal", label: "قرارداد تمدیدی است", type: "switch" },
  // «گزارش رخداد امنیتی شعبه»
  siBranch: { name: "u_aftab_si_branch", label: "شعبهٔ محل رخداد", type: "unit", validation: { refFilter: { f: "kind", op: "eq", v: "branch" } } },
  siWhen: { name: "u_aftab_si_when", label: "زمان رخداد", type: "datetime" },
  siKind: { name: "u_aftab_si_kind", label: "نوع رخداد", type: "select", options: opts(["phishing", "ایمیل فیشینگ"], ["malware", "بدافزار"], ["physical", "امنیت فیزیکی"], ["fraud", "تقلب"]) },
  siDesc: { name: "u_aftab_si_desc", label: "شرح رخداد", type: "text" },
  siOfficerNote: { name: "u_aftab_si_officer_note", label: "نظر رئیس شعبه", type: "text" },
  siSocNote: { name: "u_aftab_si_soc_note", label: "نظر مرکز عملیات امنیت", type: "text" },
  siSystems: { name: "u_aftab_si_systems", label: "سامانه‌های درگیر", type: "checklist", options: opts(["core", "کربنکینگ"], ["card", "سوئیچ کارت"], ["internet", "بانکداری اینترنتی"], ["mobile", "بانکداری همراه"], ["atm", "خودپرداز"]) },
  siIp: { name: "u_aftab_si_ip", label: "نشانی IP مشکوک", type: "ip" },
  siCustomerId: { name: "u_aftab_si_customer_id", label: "کد ملی مشتری آسیب‌دیده", type: "national_id" },
  // «ثبت نیاز آموزشی واحد»
  tnCourse: { name: "u_aftab_tn_course", label: "عنوان دوره", type: "string" },
  tnKind: { name: "u_aftab_tn_kind", label: "نوع دوره", type: "select", options: opts(["internal", "درون‌سازمانی"], ["external", "برون‌سازمانی"], ["cancel", "لغو نیاز"]) },
  tnCost: { name: "u_aftab_tn_cost", label: "هزینهٔ دوره", type: "money" },
  tnPeople: { name: "u_aftab_tn_people", label: "شرکت‌کنندگان", type: "users" },
  tnPlan: { name: "u_aftab_tn_plan", label: "برنامهٔ آموزش", type: "text" },
  tnDuration: { name: "u_aftab_tn_duration", label: "مدت دوره", type: "duration" },
  tnImportance: { name: "u_aftab_tn_importance", label: "اهمیت نیاز", type: "rating" },
  tnSkills: { name: "u_aftab_tn_skills", label: "مهارت‌ها", type: "tags" },
  tnAudience: { name: "u_aftab_tn_audience", label: "گروه مخاطب", type: "group" },
} as const satisfies Record<string, WfField>;

const F = WF_FIELDS;
type FieldKey = keyof typeof WF_FIELDS;
const n = (k: FieldKey) => F[k].name;

// ----- forms ------------------------------------------------------------------------------------------------------

export interface WfForm {
  key: string;
  name: string;
  description: string;
  layout: FormLayoutV2;
}

const fi = (k: FieldKey, more: Record<string, unknown> = {}) => ({ field: n(k), ...more });

/** The forms: tabs, sections in one or two columns, notes and «نمایش وقتی…». */
export const WF_FORMS: WfForm[] = [
  {
    key: "project",
    name: "فرم پروژهٔ فناوری (نمونه)",
    description: "فرم نمونهٔ بانک برای «گردش کار پروژه»: جزئیات در «ثبت درخواست»، تأخیر و بررسی در «مرحلهٔ فرم»",
    layout: {
      tabs: [
        {
          label: "جزئیات",
          sections: [
            { label: "پروژه", columns: 2, items: [fi("prjName", { required: true }), fi("prjPriority"), fi("prjStart")] },
            { label: "مدیر پروژه", columns: 2, items: [fi("prjManager"), fi("prjUnit"), fi("prjFollow"), fi("prjDocs")] },
          ],
        },
        {
          label: "تأخیر و بررسی",
          sections: [
            {
              label: "تأخیر",
              items: [fi("prjProgress"), fi("prjDelay"), fi("prjDelayReason", { showIf: { f: n("prjDelay"), op: "gt", v: 0 } }), { text: "اگر پروژه تأخیر دارد، علت آن را هم بنویسید", tone: "info" }],
            },
            { label: "بررسی مدیر گروه", items: [fi("prjReview")] },
          ],
        },
      ],
    },
  },
  {
    key: "petty",
    name: "فرم تنخواه شعبه (نمونه)",
    description: "فرم نمونهٔ بانک برای «درخواست تنخواه شعبه»: درخواست شعبه و بررسی امور مالی",
    layout: {
      tabs: [
        {
          label: "درخواست",
          sections: [
            { label: "مبلغ و تاریخ", columns: 2, items: [fi("pcAmount", { required: true }), fi("pcNeedDate"), fi("pcIban")] },
            {
              label: "شرح و پیوست",
              items: [
                fi("pcPurpose", { required: true }),
                fi("pcInvoice", { showIf: { f: n("pcAmount"), op: "gt", v: 10_000_000 } }),
                { text: "برای مبلغ بیش از ۱۰ میلیون ریال پیش‌فاکتور را پیوست کنید", tone: "warning" },
              ],
            },
          ],
        },
        { label: "امور مالی", sections: [{ label: "بررسی و پرداخت", columns: 2, items: [fi("pcFinanceNote"), fi("pcPaidRef")] }] },
      ],
    },
  },
  {
    key: "leave",
    name: "فرم مرخصی و جانشین (نمونه)",
    description: "فرم نمونهٔ بانک برای «درخواست مرخصی و معرفی جانشین»",
    layout: {
      tabs: [
        { label: "درخواست", sections: [{ label: "نوع و مدت", columns: 2, items: [fi("lvType", { required: true }), fi("lvDays", { required: true }), fi("lvFrom"), fi("lvMobile")] }] },
        { label: "جانشین", sections: [{ label: null, items: [fi("lvSub"), { text: "جانشین پیش از تأیید مدیر موافقت خود را ثبت می‌کند", tone: "info" }] }] },
        {
          label: "منابع انسانی",
          sections: [{ label: null, items: [fi("lvStatus", { readonly: true }), fi("lvHrOk"), fi("lvHrNote", { showIf: { f: n("lvType"), op: "ne", v: "annual" } })] }],
        },
      ],
    },
  },
  {
    key: "procurement",
    name: "فرم خرید تجهیزات (نمونه)",
    description: "فرم نمونهٔ بانک برای «تأیید قرارداد خرید تجهیزات»: قرارداد و نظرهای هم‌زمان",
    layout: {
      tabs: [
        {
          label: "قرارداد",
          sections: [
            { label: "قرارداد", columns: 2, items: [fi("prVendor", { required: true }), fi("prAmount", { required: true }), fi("prRisk", { required: true }), fi("prItems"), fi("prAdjust"), fi("prRenewal")] },
            { label: "تماس با تأمین‌کننده", columns: 2, items: [fi("prVendorEmail"), fi("prVendorPhone")] },
          ],
        },
        {
          label: "نظرها",
          sections: [
            { label: "امنیت اطلاعات", items: [fi("prSecurity")] },
            { label: "فنی و مالی", columns: 2, items: [fi("prTech"), fi("prFin")] },
          ],
        },
      ],
    },
  },
  {
    key: "security",
    name: "فرم گزارش رخداد امنیتی (نمونه)",
    description: "فرم نمونهٔ بانک برای «گزارش رخداد امنیتی شعبه»",
    layout: {
      tabs: [
        {
          label: "گزارش",
          sections: [
            { label: "محل و زمان", columns: 2, items: [fi("siBranch", { required: true }), fi("siWhen")] },
            {
              label: "شرح",
              items: [fi("siKind", { required: true }), fi("siDesc"), fi("siSystems"), fi("siIp"), fi("siCustomerId", { showIf: { f: n("siKind"), op: "eq", v: "fraud" } })],
            },
          ],
        },
        { label: "بررسی", sections: [{ label: null, items: [fi("siOfficerNote"), fi("siSocNote")] }] },
      ],
    },
  },
  {
    key: "training",
    name: "فرم نیاز آموزشی (نمونه)",
    description: "فرم نمونهٔ بانک برای «ثبت نیاز آموزشی واحد»",
    layout: {
      tabs: [
        {
          label: "دوره",
          sections: [
            { label: null, columns: 2, items: [fi("tnCourse", { required: true }), fi("tnKind", { required: true }), fi("tnCost", { showIf: { f: n("tnKind"), op: "eq", v: "external" } }), fi("tnDuration")] },
            { label: "مخاطبان", items: [fi("tnPeople"), fi("tnAudience"), fi("tnImportance"), fi("tnSkills")] },
          ],
        },
        { label: "برنامه‌ریزی", sections: [{ label: null, items: [fi("tnPlan")] }] },
      ],
    },
  },
];

/** The library fields a form uses (its dependencies). */
export function formFields(form: WfForm): string[] {
  const out: string[] = [];
  for (const t of form.layout.tabs) for (const s of t.sections) for (const i of s.items) if ("field" in i && !out.includes(i.field)) out.push(i.field);
  return out;
}

// ----- organisational roles ---------------------------------------------------------------------------------------

export interface WfPosition {
  key: string;
  name: string;
  unit_kind: string | null;
  reports_to?: string;
  description: string;
}

/** The pack's positions, in the order they are made («گزارش به» first). */
export const WF_POSITIONS: WfPosition[] = [
  { key: "aftab_region_head", name: "مدیر شعب منطقه (نمونه)", unit_kind: "division", description: "مدیر شعب یک منطقه؛ تشدید مهلت «تأیید رئیس شعبه» به او می‌رسد" },
  { key: "aftab_branch_head", name: "رئیس شعبه (نمونه)", unit_kind: "branch", reports_to: "aftab_region_head", description: "رئیس هر شعبه؛ تنخواه و گزارش رخداد امنیتی شعبه را بررسی و تأیید می‌کند" },
  { key: "aftab_group_manager", name: "مدیر گروه (نمونه)", unit_kind: "department", description: "مدیر گروه فناوری؛ «مرحلهٔ فرم» گردش کار پروژه به دارندگان آن می‌رسد" },
  { key: "aftab_project_expert", name: "کارشناس پروژه (نمونه)", unit_kind: null, description: "کارشناسان پروژه‌های فناوری؛ گردش کار پروژه را آغاز می‌کنند" },
  { key: "aftab_finance_deputy", name: "معاون مالی (نمونه)", unit_kind: "department", description: "هزینه‌های بیش از سقف شعبه و هزینهٔ دوره‌ها را تأیید می‌کند" },
  { key: "aftab_inspector", name: "بازرس داخلی (نمونه)", unit_kind: "department", description: "پست بی‌دارنده: مرحلهٔ «بازبینی بازرس داخلی» تا پیدا شدن دارنده از روی آن می‌گذرد" },
];

/** What the pack knows about its own people, units and groups when it writes its workflows. */
export interface WfRefs {
  personas: Partial<Record<Persona, string>>;
  /** memo.units: departments by code (IT, FIN, HR…), `region:<name>` */
  units: Record<string, string>;
  /** the branches in order (memo.branches) */
  branches: { unit: string; name: string }[];
  /** the branch managers (bm<i>) of the staffed branches, in branch order (memo.itam.managers) */
  branchManagers: (string | undefined)[];
  groups: Record<string, string>;
  /** the first region's unit (the field persona's) */
  region0?: string;
}

export interface WfHolder {
  position: string;
  user: string;
  unit: string | null;
  kind: "primary" | "acting" | "temporary";
  /** days from the load's day (inclusive end), when the holding ends */
  ends_in?: number;
}

/**
 * The holders: personas (who sign in) in their own units, and the branch managers in the staffed branches — one of
 * them acting, one ending soon. «بازرس داخلی (نمونه)» stays vacant.
 */
export function wfHolders(r: WfRefs): WfHolder[] {
  const P = r.personas;
  const out: WfHolder[] = [];
  const add = (position: string, user: string | undefined, unit: string | undefined | null, kind: WfHolder["kind"] = "primary", ends_in?: number) => {
    if (user) out.push({ position, user, unit: unit ?? null, kind, ...(ends_in !== undefined ? { ends_in } : {}) });
  };
  add("aftab_region_head", P.field, r.region0);
  // the requester persona heads the first branch; the branch managers the others (the third acting, the fourth's term
  // ending in ten days)
  add("aftab_branch_head", P.requester, r.branches[0]?.unit);
  for (let i = 1; i < r.branchManagers.length; i++) add("aftab_branch_head", r.branchManagers[i], r.branches[i]?.unit, i === 2 ? "acting" : "primary", i === 3 ? 10 : undefined);
  add("aftab_group_manager", P.manager, r.units.IT);
  add("aftab_group_manager", P.agent, r.units.IT);
  add("aftab_project_expert", P.pm, r.units.IT);
  add("aftab_project_expert", P.release, r.units.IT);
  add("aftab_finance_deputy", P.finance, r.units.FIN);
  return out;
}

/** Who reports to whom among the personas (member profiles), and who heads a department (its unit's manager). */
export function wfManagers(r: WfRefs): { profiles: [user: string, manager: string][]; units: [unit: string, manager: string][] } {
  const P = r.personas;
  const pairs: [Persona, Persona][] = [["agent", "manager"], ["release", "manager"], ["pm", "manager"], ["assets", "manager"], ["ops", "manager"], ["branch", "requester"], ["soc", "grc"]];
  const profiles = pairs.map(([who, boss]) => [P[who], P[boss]] as const).filter((x): x is readonly [string, string] => !!x[0] && !!x[1]).map(([a, b]) => [a, b] as [string, string]);
  const units: [string, string][] = r.units.IT && P.manager ? [[r.units.IT, P.manager]] : [];
  return { profiles, units };
}

// ----- processes --------------------------------------------------------------------------------------------------

type Node = ProcessGraph["nodes"][number];
const node = (id: string, type: Node["type"], config: Record<string, unknown> = {}, label?: string): Node => ({ id, type, config, ...(label ? { label } : {}) });
const edge = (source: string, target: string, port?: string) => ({ id: `${source}.${port ?? "out"}.${target}`, source, target, ...(port ? { port } : {}) });
const hide = (...keys: FieldKey[]) => Object.fromEntries(keys.map((k) => [n(k), "hidden"]));

export interface WfDraft {
  graph: ProcessGraph;
  starters: AssigneeRule[];
  title_template: string;
  requester_view: string[];
  managers: string[];
  manager_groups: string[];
  confidential: boolean;
}

export interface WfProcess {
  key: string;
  name: string;
  category: string;
  description: string;
  /** the forms (WF_FORMS keys), positions and groups (memo.groups keys) it needs */
  forms: string[];
  positions: string[];
  groups: string[];
  /** its draft; `version` 1 is what the first publish takes (the project's keeps the designer's old default) */
  draft(r: WfRefs, forms: Record<string, string>, version: 1 | 2): WfDraft;
}

const personasOf = (r: WfRefs) => [...new Set(Object.values(r.personas).filter((x): x is string => !!x))];
const users = (...ids: (string | undefined)[]): AssigneeRule => ({ kind: "users", users: ids.filter((x): x is string => !!x) });

export const WF_PROCESSES: WfProcess[] = [
  {
    key: "aftab_project",
    name: "گردش کار پروژه (نمونه)",
    category: "پروژه‌ها",
    description: "گردش‌کار نمونهٔ بانک با یک فرم در دو مرحله: کارشناس پروژه جزئیات را ثبت می‌کند و «مرحلهٔ فرم» به دارندگان «مدیر گروه (نمونه)» می‌رسد که تأخیر و نظر خود را می‌نویسند.",
    forms: ["project"],
    positions: ["aftab_group_manager", "aftab_project_expert"],
    groups: [],
    draft: (r, forms, version) => ({
      graph: {
        nodes: [
          node("start", "trigger"),
          node("request", "form_step", { action: "fill", start: true, form: forms.project, rights: { default: "edit", fields: hide("prjDelay", "prjDelayReason", "prjReview", "prjProgress") } }, "ثبت درخواست"),
          node("form", "form_step", {
            action: "fill", form: forms.project, rights: { default: "read", fields: { [n("prjDelay")]: "required", [n("prjDelayReason")]: "edit", [n("prjReview")]: "edit", [n("prjProgress")]: "edit" } },
            // version 1: the designer's old default «واحد درخواست‌دهنده» (the requester's own unit); version 2: «همه‌جا»
            assignees: [{ kind: "position", position: "aftab_group_manager", where: version === 1 ? "requester_unit" : "anywhere" }], ifNobody: "wait",
          }, "مرحلهٔ فرم"),
          node("done", "end", { outcome: "completed" }, "پایان (انجام‌شده)"),
        ],
        edges: [edge("start", "request"), edge("request", "form"), edge("form", "done")],
      },
      starters: [{ kind: "position", position: "aftab_project_expert", where: "anywhere" }, { kind: "position", position: "aftab_group_manager", where: "anywhere" }, users(r.personas.finance)],
      title_template: `پروژهٔ {{case.${n("prjName")}}}`,
      requester_view: [n("prjDelay"), n("prjProgress"), n("prjReview")],
      managers: [r.personas.manager].filter((x): x is string => !!x),
      manager_groups: [],
      confidential: false,
    }),
  },
  {
    key: "aftab_petty_cash",
    name: "درخواست تنخواه شعبه (نمونه)",
    category: "امور مالی",
    description: "تنخواه شعبه: رئیس شعبهٔ درخواست‌دهنده (نزدیک‌ترین شعبهٔ بالادست) با مهلت یک روز کاری تأیید می‌کند؛ بیش از ۵۰ میلیون ریال معاون مالی هم تأیید می‌کند؛ امور مالی بررسی و پرداخت می‌کند یا برای اصلاح برمی‌گرداند.",
    forms: ["petty"],
    positions: ["aftab_branch_head", "aftab_finance_deputy"],
    groups: [],
    draft: (r, forms) => ({
      graph: {
        nodes: [
          node("start", "trigger"),
          node("request", "form_step", { action: "fill", start: true, form: forms.petty, rights: { default: "edit", fields: hide("pcFinanceNote", "pcPaidRef") } }, "ثبت درخواست"),
          node("head", "form_step", {
            action: "approve", quorum: "any", form: forms.petty, rights: { default: "read", fields: hide("pcFinanceNote", "pcPaidRef") },
            assignees: [{ kind: "position", position: "aftab_branch_head", where: "requester_unit_up", unitKind: "branch" }],
            fallback: [{ kind: "unit_head", of: "requester", unitKind: "branch" }], ifNobody: "managers",
            due: { amount: 1, unit: "day" }, escalate: [{ after: { amount: 4, unit: "hour" }, action: "notify", to: "reports_to" }],
          }, "تأیید رئیس شعبه"),
          node("amount", "branch", { mode: "data", rules: [{ left: `{{case.${n("pcAmount")}}}`, op: "gt", right: "50000000" }] }, "مبلغ بیش از ۵۰ میلیون ریال؟"),
          node("deputy", "form_step", { action: "approve", quorum: "any", form: forms.petty, rights: { default: "read", fields: hide("pcPaidRef") }, assignees: [{ kind: "position", position: "aftab_finance_deputy", where: "anywhere" }] }, "تأیید معاون مالی"),
          node("pay", "form_step", {
            action: "review", form: forms.petty, rights: { default: "read", fields: { [n("pcFinanceNote")]: "required", [n("pcPaidRef")]: "required" } }, assignees: [users(r.personas.finance)],
          }, "بررسی و پرداخت"),
          node("paid", "end", { outcome: "completed" }, "پایان (پرداخت‌شده)"),
          node("refused", "end", { outcome: "rejected" }, "پایان (ردشده)"),
          node("expired", "end", { outcome: "canceled" }, "پایان (منقضی)"),
        ],
        edges: [
          edge("start", "request"), edge("request", "head"),
          edge("head", "amount", "approved"), edge("head", "refused", "rejected"), edge("head", "request", "returned"), edge("head", "expired", "timeout"),
          edge("amount", "deputy", "yes"), edge("amount", "pay", "no"),
          edge("deputy", "pay", "approved"), edge("deputy", "refused", "rejected"),
          edge("pay", "paid"), edge("pay", "request", "returned"),
        ],
      },
      starters: [users(...personasOf(r))],
      title_template: `تنخواه {{case.${n("pcAmount")}}} — {{case.requested_by}}`,
      requester_view: [n("pcFinanceNote"), n("pcPaidRef")],
      managers: [r.personas.finance].filter((x): x is string => !!x),
      manager_groups: [],
      confidential: false,
    }),
  },
  {
    key: "aftab_leave",
    name: "درخواست مرخصی و معرفی جانشین (نمونه)",
    category: "منابع انسانی",
    description: "مرخصی با جانشین: جانشین موافقت می‌کند (بی‌جانشین از این مرحله می‌گذرد)، مدیر مستقیم تأیید می‌کند، مرخصی استعلاجی، طولانی یا بدون حقوق به منابع انسانی می‌رود، وضعیت ثبت و به درخواست‌دهنده و جانشین اعلان می‌شود.",
    forms: ["leave"],
    positions: [],
    groups: ["hr"],
    draft: (r, forms) => ({
      graph: {
        nodes: [
          node("start", "trigger"),
          node("request", "form_step", { action: "fill", start: true, form: forms.leave, rights: { default: "edit", fields: hide("lvStatus", "lvHrOk", "lvHrNote") } }, "ثبت درخواست"),
          node("substitute", "form_step", {
            action: "review", form: forms.leave, rights: { default: "read", fields: hide("lvHrOk", "lvHrNote") }, assignees: [{ kind: "field", field: n("lvSub") }], exclude: ["requester"], ifNobody: "skip",
          }, "موافقت جانشین"),
          node("manager", "form_step", {
            action: "approve", quorum: "any", form: forms.leave, rights: { default: "read", fields: hide("lvHrOk", "lvHrNote") },
            assignees: [{ kind: "manager", of: "requester" }], fallback: [{ kind: "manager", of: "requester", depth: 2 }], ifNobody: "managers",
          }, "تأیید مدیر مستقیم"),
          node("kind", "choice", {
            cases: [
              { key: "sick", label: "استعلاجی", rules: [{ left: `{{case.${n("lvType")}}}`, op: "eq", right: "sick" }] },
              { key: "long", label: "طولانی یا بدون حقوق", match: "any", rules: [{ left: `{{case.${n("lvDays")}}}`, op: "gt", right: "7" }, { left: `{{case.${n("lvType")}}}`, op: "eq", right: "unpaid" }] },
            ],
          }, "نوع مرخصی"),
          node("hr", "form_step", {
            action: "review", form: forms.leave, rights: { default: "read", fields: { [n("lvHrNote")]: "required", [n("lvHrOk")]: "edit" } }, assignees: r.groups.hr ? [{ kind: "group", group: r.groups.hr }] : [],
          }, "بررسی منابع انسانی"),
          node("record", "set_values", { values: { [n("lvStatus")]: `تأییدشده: {{case.${n("lvDays")}}} روز از {{case.${n("lvFrom")}}}` } }, "ثبت وضعیت"),
          node("tell", "notify", { to: [{ kind: "requester" }, { kind: "field", field: n("lvSub") }], subject: "مرخصی تأیید شد: {{case.number}}", body: `{{case.${n("lvStatus")}}}` }, "اعلان تأیید"),
          node("done", "end", { outcome: "completed" }, "پایان (تأییدشده)"),
          node("refused", "end", { outcome: "rejected" }, "پایان (ردشده)"),
        ],
        edges: [
          edge("start", "request"), edge("request", "substitute"), edge("substitute", "manager"),
          edge("manager", "kind", "approved"), edge("manager", "refused", "rejected"), edge("manager", "request", "returned"),
          edge("kind", "hr", "sick"), edge("kind", "hr", "long"), edge("kind", "record", "else"),
          edge("hr", "record"), edge("hr", "request", "returned"),
          edge("record", "tell"), edge("tell", "done"),
        ],
      },
      starters: [users(...personasOf(r))],
      title_template: `مرخصی {{case.${n("lvType")}}} — {{case.requested_by}}`,
      requester_view: [n("lvStatus")],
      managers: [r.personas.hr].filter((x): x is string => !!x),
      manager_groups: [],
      confidential: false,
    }),
  },
  {
    key: "aftab_procurement",
    name: "تأیید قرارداد خرید تجهیزات (نمونه)",
    category: "تدارکات",
    description: "خرید تجهیزات: امنیت اطلاعات، فنی و مالی هم‌زمان نظر می‌دهند؛ پس از پیوستن، کمیتهٔ خرید با دو تأیید (بی آن‌که کسی از مرحله‌های پیشین باشد) تصمیم می‌گیرد و قرارداد پرریسک به تأیید مدیر ریسک هم می‌رسد.",
    forms: ["procurement"],
    positions: ["aftab_finance_deputy"],
    groups: ["soc", "apps"],
    draft: (r, forms) => ({
      graph: {
        nodes: [
          node("start", "trigger"),
          node("request", "form_step", { action: "fill", start: true, form: forms.procurement, rights: { default: "edit", fields: hide("prSecurity", "prTech", "prFin") } }, "ثبت درخواست خرید"),
          node("reviews", "parallel", {}, "بررسی‌های هم‌زمان"),
          node("security", "form_step", {
            action: "fill", form: forms.procurement, rights: { default: "read", fields: { [n("prSecurity")]: "required", ...hide("prTech", "prFin") } }, assignees: r.groups.soc ? [{ kind: "group", group: r.groups.soc }] : [],
          }, "نظر امنیت اطلاعات"),
          node("tech", "form_step", {
            action: "fill", form: forms.procurement, rights: { default: "read", fields: { [n("prTech")]: "required", ...hide("prSecurity", "prFin") } }, assignees: r.groups.apps ? [{ kind: "group", group: r.groups.apps }] : [],
          }, "نظر فنی"),
          node("finance", "form_step", {
            action: "fill", form: forms.procurement, rights: { default: "read", fields: { [n("prFin")]: "required", ...hide("prSecurity", "prTech") } }, assignees: [{ kind: "position", position: "aftab_finance_deputy", where: "anywhere" }],
          }, "نظر مالی"),
          node("join", "join", { mode: "all" }, "پیوستن"),
          node("committee", "form_step", {
            action: "approve", quorum: "count", threshold: 2, form: forms.procurement, rights: { default: "read" },
            assignees: [users(r.personas.change, r.personas.finance, r.personas.pm)], exclude: ["earlier_actors"],
          }, "کمیتهٔ خرید"),
          node("risk", "choice", { cases: [{ key: "high", label: "ریسک زیاد", rules: [{ left: `{{case.${n("prRisk")}}}`, op: "eq", right: "high" }] }] }, "سطح ریسک"),
          node("riskboard", "form_step", { action: "approve", quorum: "any", form: forms.procurement, rights: { default: "read" }, assignees: [users(r.personas.grc)] }, "تأیید مدیر ریسک"),
          node("done", "end", { outcome: "completed" }, "پایان (تأییدشده)"),
          node("refused", "end", { outcome: "rejected" }, "پایان (ردشده)"),
        ],
        edges: [
          edge("start", "request"), edge("request", "reviews"),
          edge("reviews", "security"), edge("reviews", "tech"), edge("reviews", "finance"),
          edge("security", "join"), edge("tech", "join"), edge("finance", "join"),
          edge("join", "committee"),
          edge("committee", "risk", "approved"), edge("committee", "refused", "rejected"), edge("committee", "request", "returned"),
          edge("risk", "riskboard", "high"), edge("risk", "done", "else"),
          edge("riskboard", "done", "approved"), edge("riskboard", "refused", "rejected"),
        ],
      },
      starters: [users(...personasOf(r))],
      title_template: `خرید از {{case.${n("prVendor")}}}`,
      requester_view: [],
      managers: [r.personas.change].filter((x): x is string => !!x),
      manager_groups: [],
      confidential: false,
    }),
  },
  {
    key: "aftab_security_report",
    name: "گزارش رخداد امنیتی شعبه (نمونه)",
    category: "امنیت اطلاعات",
    description: "رخداد امنیتی شعبه: رئیس همان شعبه‌ای که در فرم آمده (یا اگر رئیسی ندارد مدیر آن واحد) بررسی می‌کند و مرکز عملیات امنیت (نخستین پاسخ) تصمیم می‌گیرد یا برای بررسی دوباره برمی‌گرداند.",
    forms: ["security"],
    positions: ["aftab_branch_head"],
    groups: ["soc"],
    draft: (r, forms) => ({
      graph: {
        nodes: [
          node("start", "trigger"),
          node("request", "form_step", { action: "fill", start: true, form: forms.security, rights: { default: "edit", fields: hide("siOfficerNote", "siSocNote") } }, "ثبت گزارش"),
          node("officer", "form_step", {
            action: "review", form: forms.security, rights: { default: "read", fields: { [n("siOfficerNote")]: "required", ...hide("siSocNote") } },
            assignees: [{ kind: "position", position: "aftab_branch_head", where: "unit_field", unitField: n("siBranch") }],
            fallback: [{ kind: "unit_head", of: "unit_field", unitField: n("siBranch") }], ifNobody: "managers", returnTo: "rule",
          }, "بررسی رئیس شعبه"),
          node("soc", "form_step", { action: "approve", quorum: "first", form: forms.security, rights: { default: "read", fields: { [n("siSocNote")]: "edit" } }, assignees: r.groups.soc ? [{ kind: "group", group: r.groups.soc }] : [] }, "تحلیل مرکز عملیات امنیت"),
          node("done", "end", { outcome: "completed" }, "پایان (رسیدگی‌شده)"),
          node("closed", "end", { outcome: "rejected" }, "پایان (بی‌اقدام)"),
        ],
        edges: [
          edge("start", "request"), edge("request", "officer"), edge("officer", "soc"), edge("officer", "request", "returned"),
          edge("soc", "done", "approved"), edge("soc", "closed", "rejected"), edge("soc", "officer", "returned"),
        ],
      },
      starters: [users(...personasOf(r))],
      title_template: `رخداد امنیتی {{case.${n("siKind")}}} در {{case.${n("siBranch")}}}`,
      requester_view: [n("siSocNote")],
      managers: [r.personas.grc].filter((x): x is string => !!x),
      manager_groups: r.groups.soc ? [r.groups.soc] : [],
      confidential: false,
    }),
  },
  {
    key: "aftab_training",
    name: "ثبت نیاز آموزشی واحد (نمونه)",
    category: "منابع انسانی",
    description: "نیاز آموزشی: رئیس ادارهٔ درخواست‌دهنده تأیید می‌کند (اداره‌ای بی‌رئیس از آن می‌گذرد)، بازبینی بازرس داخلی تا دارنده‌ای پیدا شود از روی پست بی‌دارنده می‌گذرد، منابع انسانی برنامه می‌ریزد و دورهٔ برون‌سازمانی به تأیید هزینه می‌رسد.",
    forms: ["training"],
    positions: ["aftab_inspector", "aftab_finance_deputy"],
    groups: ["hr"],
    draft: (r, forms) => ({
      graph: {
        nodes: [
          node("start", "trigger"),
          node("request", "form_step", { action: "fill", start: true, form: forms.training, rights: { default: "edit", fields: hide("tnPlan") } }, "ثبت نیاز آموزشی"),
          node("head", "form_step", {
            action: "approve", quorum: "any", form: forms.training, rights: { default: "read", fields: hide("tnPlan") }, assignees: [{ kind: "unit_head", of: "requester", unitKind: "department" }], ifNobody: "skip",
          }, "تأیید رئیس اداره"),
          node("audit", "form_step", { action: "review", form: forms.training, rights: { default: "read", fields: hide("tnPlan") }, assignees: [{ kind: "position", position: "aftab_inspector", where: "anywhere" }], ifNobody: "skip" }, "بازبینی بازرس داخلی"),
          node("plan", "form_step", {
            action: "fill", form: forms.training, rights: { default: "read", fields: { [n("tnPlan")]: "required", [n("tnCourse")]: "edit" } }, assignees: r.groups.hr ? [{ kind: "group", group: r.groups.hr }] : [],
          }, "برنامه‌ریزی آموزش"),
          node("kind", "choice", {
            cases: [
              { key: "dropped", label: "لغو نیاز", rules: [{ left: `{{case.${n("tnKind")}}}`, op: "eq", right: "cancel" }] },
              { key: "external", label: "برون‌سازمانی با هزینه", rules: [{ left: `{{case.${n("tnKind")}}}`, op: "eq", right: "external" }, { left: `{{case.${n("tnCost")}}}`, op: "nempty" }] },
            ],
          }, "نوع دوره"),
          node("cost", "form_step", { action: "approve", quorum: "first", form: forms.training, rights: { default: "read" }, assignees: [{ kind: "position", position: "aftab_finance_deputy", where: "anywhere" }] }, "تأیید هزینه"),
          node("announce", "notify", { to: [{ kind: "field", field: n("tnPeople") }, { kind: "requester" }], subject: `دورهٔ «{{case.${n("tnCourse")}}}» برنامه‌ریزی شد`, body: `{{case.${n("tnPlan")}}}` }, "اعلان به شرکت‌کنندگان"),
          node("done", "end", { outcome: "completed" }, "پایان (برنامه‌ریزی‌شده)"),
          node("dropped", "end", { outcome: "canceled" }, "پایان (لغو)"),
          node("refused", "end", { outcome: "rejected" }, "پایان (ردشده)"),
        ],
        edges: [
          edge("start", "request"), edge("request", "head"),
          edge("head", "audit", "approved"), edge("head", "refused", "rejected"),
          edge("audit", "plan"), edge("plan", "kind"),
          edge("kind", "dropped", "dropped"), edge("kind", "cost", "external"), edge("kind", "announce", "else"),
          edge("cost", "announce", "approved"), edge("cost", "refused", "rejected"),
          edge("announce", "done"),
        ],
      },
      starters: [users(...personasOf(r))],
      title_template: `نیاز آموزشی: {{case.${n("tnCourse")}}}`,
      requester_view: [n("tnPlan")],
      managers: [r.personas.hr].filter((x): x is string => !!x),
      manager_groups: [],
      confidential: false,
    }),
  },
];

/** Where the two steps stand (saved with the pack's memo between job invocations). */
export interface WfMemo {
  /**
   * the moment the pack's workflows began: the holders' terms and the scripts' dates count from it, whichever job
   * invocation writes them (a load split over invocations, or over midnight, makes the same pack)
   */
  at?: number;
  /** library fields the pack has (made now or found as its own) */
  fields?: string[];
  /** form, position and process ids by key (made or found as the pack's own) */
  forms?: Record<string, string>;
  positions?: Record<string, string>;
  processes?: Record<string, string>;
  /** processes «انتشار» has been asked for */
  published?: string[];
  cases?: {
    /** the project's second version is published */
    v2?: boolean;
    rows: Record<string, WfCaseRow>;
  };
}

export interface WfCaseRow {
  /** the case's id, chosen before its start */
  id: string;
  /** the next act of the script */
  act: number;
  started?: boolean;
  done?: boolean;
  /** since when nothing could be done and nothing of the case was queued */
  stuck?: number;
}

/** Every process but the project's is published once by the definitions; the project's second version by the cases. */
export const PROJECT = "aftab_project";

// ----- the sample cases ---------------------------------------------------------------------------------------------

/** Who acts in a script: a persona, or the manager of the i-th staffed branch (`bm1`: they hold «رئیس شعبه»). */
export type WfActor = Persona | `bm${number}`;

export type WfAct =
  | { step: string; as: WfActor; outcome?: "submitted" | "approved" | "rejected" | "returned"; values?: Record<string, unknown>; comment?: string }
  | { cancel: WfActor; comment: string }
  /** the open round of `timeout` is dated back past its time and the organisation's timer is woken (no person acts) */
  | { timeout: string };

export interface WfScript {
  /** stable key of the sample (its place in the memo) */
  key: string;
  process: string;
  /** started on the process's first version, before the second is published */
  v1?: boolean;
  by: WfActor;
  values: Record<string, unknown>;
  acts: WfAct[];
  /** where the case stands when the load is done: its state, and the steps still open */
  expect: { state: "active" | "waiting" | "completed" | "rejected" | "canceled"; open?: string[] };
}

/** What the scripts' values need: the people (WfRefs), and the load's day for dates. */
export interface WfScriptRefs extends WfRefs {
  /** the load's day, YYYY-MM-DD */
  today: string;
  /** the load's moment (ms): times of the security reports */
  now: number;
}

const DAY = 86_400_000;
const dayPlus = (today: string, days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

const PROJECTS = ["سامانهٔ تسهیلات خرد", "نوسازی شبکهٔ شعب", "درگاه پرداخت قبوض", "بایگانی الکترونیک اسناد", "پایش برخط خودپردازها", "سامانهٔ صف شعب", "یکپارچه‌سازی پیامک‌های بانکی", "داشبورد مدیریتی شعب"];
const PURPOSES = ["خرید لوازم مصرفی باجه‌ها", "تعمیر کولر سالن مشتریان", "پذیرایی جلسهٔ مشتریان حقوقی", "خرید کاغذ چاپگر دفترچه", "تعویض قفل در خزانه", "هزینهٔ پیک اسناد"];
const VENDORS = ["شرکت نمونهٔ تجهیزات پایانه", "شرکت نمونهٔ ذخیره‌سازی داده", "شرکت نمونهٔ شبکهٔ امن", "شرکت نمونهٔ سرورهای سازمانی"];
const COURSES = ["آموزش امنیت شبکه", "مدیریت خدمات فناوری اطلاعات", "آشنایی با کربنکینگ", "مهارت‌های ارتباط با مشتری"];
const SKILLS = [["امنیت شبکه", "پایش"], ["ITIL", "مدیریت رخداد"], ["کربنکینگ"], ["ارتباط با مشتری", "رسیدگی به شکایت"]];

/** A valid Iranian IBAN (IR, two check digits, 22 digits: ISO 13616 mod 97) for 22 digits of the sample's account. */
export function sampleIban(bban: string): string {
  // IR moved to the end as digits (I = 18, R = 27), check digits 00: the remainder gives them
  let rest = 0;
  for (const ch of `${bban}182700`) rest = (rest * 10 + Number(ch)) % 97;
  return `IR${String(98 - rest).padStart(2, "0")}${bban}`;
}

/**
 * The sample cases, in the order they are played. A pure function of the pack's size, seed and people: a load split
 * over any number of job invocations plays the same scripts (the values never depend on where an earlier invocation
 * stopped). Small: 15 cases; the finished ones repeat with other values for a medium (×2) and a large (×4) pack.
 */
export function wfScripts(r: WfScriptRefs, size: DemoSize, seed: number): WfScript[] {
  const rng = new Rng(seed + 61);
  const P = r.personas;
  const t = r.today;
  const reps = size === "small" ? 1 : size === "medium" ? 2 : 4;
  const branch0 = r.branches[0]?.unit;
  const branch1 = r.branches[1]?.unit;
  const out: WfScript[] = [];
  const project = (name: string, by: Persona, unit: string | undefined, priority = "normal"): Record<string, unknown> => ({
    [n("prjName")]: name, [n("prjPriority")]: priority, [n("prjStart")]: dayPlus(t, rng.int(3, 30)), [n("prjManager")]: P[by] ?? null, [n("prjUnit")]: unit ?? null,
    [n("prjDocs")]: `https://wiki.aftab-bank.example/projects/${rng.int(100, 999)}`,
  });
  // 1. the owner's case on version 1: «واحد درخواست‌دهنده» finds no «مدیر گروه (نمونه)» in the finance department
  out.push({ key: "project-v1", process: PROJECT, v1: true, by: "finance", values: project("سامانهٔ بودجه‌ریزی شعب", "finance", r.units.FIN, "urgent"), acts: [], expect: { state: "waiting" } });
  // 2. on version 2 («همه‌جا»): open for both holders
  out.push({ key: "project-open", process: PROJECT, by: "agent", values: project(PROJECTS[0], "agent", r.units.IT), acts: [], expect: { state: "active", open: ["form"] } });
  for (let k = 0; k < reps; k++) {
    const s = k ? `-${k + 1}` : "";
    const delay = rng.int(0, 1) ? rng.int(3, 20) : 0;
    out.push({
      key: `project-done${s}`, process: PROJECT, by: "pm", values: project(PROJECTS[(1 + k) % PROJECTS.length], "pm", r.units.IT, rng.pick(["normal", "urgent"])),
      acts: [{ step: "form", as: "manager", values: { [n("prjProgress")]: String(rng.int(6, 10) * 10), [n("prjDelay")]: delay, ...(delay ? { [n("prjDelayReason")]: "تأخیر در تأمین تجهیزات شبکه از سوی پیمانکار" } : {}), [n("prjReview")]: "برنامهٔ پروژه بررسی شد و تأیید می‌شود" } }],
      expect: { state: "completed" },
    });
    out.push({
      key: `project-canceled${s}`, process: PROJECT, by: "release", values: project(PROJECTS[(4 + k) % PROJECTS.length], "release", r.units.IT),
      acts: [{ cancel: "release", comment: "این پروژه به برنامهٔ سال بعد رفت" }], expect: { state: "canceled" },
    });
  }
  const petty = (amount: number, purpose: string): Record<string, unknown> => ({
    [n("pcAmount")]: String(amount), [n("pcNeedDate")]: dayPlus(t, rng.int(2, 10)), [n("pcPurpose")]: purpose,
    [n("pcIban")]: sampleIban(`0170000000${String(rng.int(100_000, 999_999))}${String(rng.int(100_000, 999_999))}`),
  });
  for (let k = 0; k < reps; k++) {
    const s = k ? `-${k + 1}` : "";
    out.push({
      key: `petty-paid${s}`, process: "aftab_petty_cash", by: "branch", values: petty(rng.int(55, 90) * 1_000_000, PURPOSES[(k * 2) % PURPOSES.length]),
      acts: [
        { step: "head", as: "requester", outcome: "approved", comment: "هزینه برای کار شعبه لازم است" },
        { step: "deputy", as: "finance", outcome: "approved" },
        { step: "pay", as: "finance", outcome: "submitted", values: { [n("pcFinanceNote")]: "از تنخواه شعبه پرداخت شد", [n("pcPaidRef")]: `SND-${rng.int(10_000, 99_999)}` } },
      ],
      expect: { state: "completed" },
    });
    out.push({
      key: `petty-rejected${s}`, process: "aftab_petty_cash", by: "branch", values: petty(rng.int(120, 300) * 1_000_000, PURPOSES[(k * 2 + 1) % PURPOSES.length]),
      acts: [{ step: "head", as: "requester", outcome: "rejected", comment: "سقف تنخواه شعبه رعایت نشده است؛ از راه خرید ستاد درخواست دهید" }], expect: { state: "rejected" },
    });
  }
  // returned to the requester for correction: «ثبت درخواست» round 2 waits in the branch persona's «کارتابل»
  out.push({
    key: "petty-returned", process: "aftab_petty_cash", by: "branch", values: petty(5_000_000, "خرید لوازم"),
    acts: [{ step: "head", as: "requester", outcome: "approved" }, { step: "pay", as: "finance", outcome: "returned", comment: "شرح نیاز ناقص است؛ اقلام و تعداد را بنویسید" }],
    expect: { state: "active", open: ["request"] },
  });
  // «پایان مهلت»: nobody approves, the round's time is dated back and the organisation's timer ends it
  out.push({ key: "petty-expired", process: "aftab_petty_cash", by: "branch", values: petty(8_000_000, "هزینهٔ پیک اسناد"), acts: [{ timeout: "head" }], expect: { state: "canceled" } });
  const leave = (type: string, days: number, sub: Persona | null): Record<string, unknown> => ({
    [n("lvType")]: type, [n("lvDays")]: days, [n("lvFrom")]: dayPlus(t, rng.int(1, 14)), [n("lvSub")]: sub ? (P[sub] ?? null) : null, [n("lvMobile")]: `0912${rng.int(1_000_000, 9_999_999)}`,
  });
  for (let k = 0; k < reps; k++) {
    out.push({
      key: `leave-done${k ? `-${k + 1}` : ""}`, process: "aftab_leave", by: "agent", values: leave("annual", rng.int(2, 5), "release"),
      acts: [{ step: "substitute", as: "release", outcome: "submitted" }, { step: "manager", as: "manager", outcome: "approved", comment: "با جانشینی سپیده موافقم" }],
      expect: { state: "completed" },
    });
  }
  // without a substitute: «موافقت جانشین» is passed by; the manager's approval waits in «کارتابل»
  out.push({ key: "leave-waiting", process: "aftab_leave", by: "ops", values: leave("sick", 2, null), acts: [], expect: { state: "active", open: ["manager"] } });
  const purchase = (amount: number, risk: string, k: number): Record<string, unknown> => ({
    [n("prVendor")]: VENDORS[k % VENDORS.length], [n("prAmount")]: String(amount), [n("prRisk")]: risk,
    [n("prItems")]: k % 2 ? ["storage", "server"] : ["terminal", "network"], [n("prAdjust")]: `1.${String(rng.int(0, 15)).padStart(2, "0")}`, [n("prRenewal")]: k % 2 === 1,
    [n("prVendorEmail")]: `sales${(k % VENDORS.length) + 1}@vendors.example`, [n("prVendorPhone")]: `021-8${rng.int(1_000_000, 9_999_999)}`,
  });
  // parallel reviews in progress: «نظر فنی» is in, security and finance still open
  out.push({
    key: "procurement-parallel", process: "aftab_procurement", by: "assets", values: purchase(900_000_000, "low", 0),
    acts: [{ step: "tech", as: "release", values: { [n("prTech")]: "مشخصات فنی با استاندارد بانک می‌خواند" } }], expect: { state: "active", open: ["security", "finance"] },
  });
  for (let k = 0; k < reps; k++) {
    out.push({
      key: `procurement-done${k ? `-${k + 1}` : ""}`, process: "aftab_procurement", by: "assets", values: purchase(rng.int(30, 60) * 100_000_000, "high", k + 1),
      acts: [
        { step: "security", as: "soc", values: { [n("prSecurity")]: "ارزیابی امنیتی تأمین‌کننده انجام شد" } },
        { step: "tech", as: "release", values: { [n("prTech")]: "پشتیبانی پنج‌ساله در قرارداد آمده است" } },
        { step: "finance", as: "finance", values: { [n("prFin")]: "در بودجهٔ سرمایه‌ای امسال پیش‌بینی شده است" } },
        { step: "committee", as: "change", outcome: "approved" },
        { step: "committee", as: "pm", outcome: "approved" },
        { step: "riskboard", as: "grc", outcome: "approved", comment: "ریسک تأمین‌کننده با ضمانت‌نامه پوشش داده شد" },
      ],
      expect: { state: "completed" },
    });
  }
  const report = (unit: string | undefined, kind: string, desc: string, systems: string[], ip?: string): Record<string, unknown> => ({
    [n("siBranch")]: unit ?? null, [n("siWhen")]: new Date(r.now - rng.int(2, 30) * 3_600_000).toISOString(), [n("siKind")]: kind, [n("siDesc")]: desc, [n("siSystems")]: systems,
    ...(ip ? { [n("siIp")]: ip } : {}),
  });
  out.push({ key: "security-open", process: "aftab_security_report", by: "branch", values: report(branch0, "phishing", "ایمیلی با پیوند «به‌روزرسانی حساب» به سه کارمند شعبه رسید", ["internet"], `203.0.113.${rng.int(2, 250)}`), acts: [], expect: { state: "active", open: ["officer"] } });
  for (let k = 0; k < reps; k++) {
    out.push({
      key: `security-done${k ? `-${k + 1}` : ""}`, process: "aftab_security_report", by: "branch", values: report(branch1, rng.pick(["malware", "physical"]), "کارمند باجه یک حافظهٔ جانبی ناشناس روی میز پیدا کرد", ["core", "atm"]),
      acts: [
        { step: "officer", as: "bm1", values: { [n("siOfficerNote")]: "حافظه جمع‌آوری و تحویل مسئول امنیت شد" } },
        { step: "soc", as: "soc", outcome: "approved", values: { [n("siSocNote")]: "بررسی شد؛ بدافزاری روی رایانه‌های شعبه نیست" } },
      ],
      expect: { state: "completed" },
    });
  }
  for (let k = 0; k < reps; k++) {
    out.push({
      key: `training-dropped${k ? `-${k + 1}` : ""}`, process: "aftab_training", by: "agent",
      values: {
        [n("tnCourse")]: COURSES[k % COURSES.length], [n("tnKind")]: "cancel", [n("tnPeople")]: [P.agent, P.release].filter(Boolean), [n("tnDuration")]: `${rng.int(8, 24)}:00`,
        [n("tnImportance")]: rng.int(3, 5), [n("tnSkills")]: SKILLS[k % SKILLS.length], [n("tnAudience")]: r.groups.apps ?? null,
      },
      acts: [{ step: "head", as: "manager", outcome: "approved" }, { step: "plan", as: "hr", values: { [n("tnPlan")]: "دوره با برنامهٔ آموزشی ستاد همپوشانی دارد" } }],
      expect: { state: "canceled" },
    });
  }
  return out;
}
