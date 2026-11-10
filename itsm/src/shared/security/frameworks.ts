// Content the security module seeds for a new organisation (docs/modules/security_FA.md): the control frameworks and
// their requirements (ISO/IEC 27001:2022 Annex A — all 93 controls with Persian titles —, NIST CSF 2.0 functions and
// categories, ISO/IEC 20000-1:2018 clauses, placeholders for Iranian regulations whose exact requirements are authored
// per organisation), the regulatory notification regimes, the response playbooks (phishing, malware, data leak), the
// 5 × 5 risk matrix, risk appetite per category and a starter control library mapped across frameworks («test once,
// comply many») with the continuous-monitoring indicators. Everything is data: organisations edit or extend it.
// Imported by the UI: keep it free of server imports.

export interface FrameworkSeed {
  key: string;
  name: string;
  version: string;
  publisher: string;
  kind: "standard" | "regulation" | "contract" | "internal";
  placeholder?: boolean;
  description: string;
}

export interface RequirementSeed {
  code: string;
  title: string;
  title_en: string;
  theme: string;
  parent?: string;
  level: number;
}

export const FRAMEWORKS: FrameworkSeed[] = [
  { key: "iso27001_2022", name: "ISO/IEC 27001:2022 — پیوست الف", version: "2022", publisher: "ISO/IEC", kind: "standard", description: "۹۳ کنترل پیوست الف استاندارد سامانهٔ مدیریت امنیت اطلاعات؛ مبنای بیانیهٔ کاربست‌پذیری (SoA)" },
  { key: "nist_csf_2", name: "NIST CSF 2.0", version: "2.0", publisher: "NIST", kind: "standard", description: "چارچوب امنیت سایبری: شش کارکرد و ۲۲ دسته (زیردسته‌ها را می‌توان افزود)" },
  { key: "iso20000_2018", name: "ISO/IEC 20000-1:2018", version: "2018", publisher: "ISO/IEC", kind: "standard", description: "الزامات سامانهٔ مدیریت خدمت (بندهای ۴ تا ۱۰)" },
  { key: "ir_afta", name: "الزامات امنیتی افتا", version: "—", publisher: "سازمان فناوری اطلاعات ایران (افتا)", kind: "regulation", placeholder: true, description: "جای‌نگهدار: الزامات دقیق برای هر سازمان وارد و تأیید می‌شود (ورود از اکسل در فهرست الزامات)" },
  { key: "ir_passive_defense", name: "الزامات پدافند غیرعامل فاوا", version: "—", publisher: "سازمان پدافند غیرعامل", kind: "regulation", placeholder: true, description: "جای‌نگهدار: الزامات دقیق برای هر سازمان وارد و تأیید می‌شود" },
  { key: "ir_cbi", name: "ضوابط امنیت اطلاعات بانک مرکزی", version: "—", publisher: "بانک مرکزی جمهوری اسلامی ایران", kind: "regulation", placeholder: true, description: "جای‌نگهدار برای بانک‌ها و مؤسسه‌های اعتباری؛ الزامات را از بخشنامه‌های معتبر وارد کنید" },
];

const ORG = "سازمانی";
const PEOPLE = "افراد";
const PHYS = "فیزیکی";
const TECH = "فناورانه";

const A = (code: string, title: string, title_en: string, theme: string): RequirementSeed => ({ code: `A.${code}`, title, title_en, theme, level: 2 });

/** ISO/IEC 27001:2022 Annex A — 37 organizational, 8 people, 14 physical and 34 technological controls. */
export const ANNEX_A: RequirementSeed[] = [
  A("5.1", "خط‌مشی‌های امنیت اطلاعات", "Policies for information security", ORG),
  A("5.2", "نقش‌ها و مسئولیت‌های امنیت اطلاعات", "Information security roles and responsibilities", ORG),
  A("5.3", "تفکیک وظایف", "Segregation of duties", ORG),
  A("5.4", "مسئولیت‌های مدیریت", "Management responsibilities", ORG),
  A("5.5", "ارتباط با مراجع ذی‌صلاح", "Contact with authorities", ORG),
  A("5.6", "ارتباط با گروه‌های تخصصی", "Contact with special interest groups", ORG),
  A("5.7", "اطلاعات تهدید", "Threat intelligence", ORG),
  A("5.8", "امنیت اطلاعات در مدیریت پروژه", "Information security in project management", ORG),
  A("5.9", "فهرست اطلاعات و دیگر دارایی‌های مرتبط", "Inventory of information and other associated assets", ORG),
  A("5.10", "استفادهٔ قابل‌قبول از اطلاعات و دیگر دارایی‌های مرتبط", "Acceptable use of information and other associated assets", ORG),
  A("5.11", "بازگرداندن دارایی‌ها", "Return of assets", ORG),
  A("5.12", "طبقه‌بندی اطلاعات", "Classification of information", ORG),
  A("5.13", "برچسب‌گذاری اطلاعات", "Labelling of information", ORG),
  A("5.14", "انتقال اطلاعات", "Information transfer", ORG),
  A("5.15", "کنترل دسترسی", "Access control", ORG),
  A("5.16", "مدیریت هویت", "Identity management", ORG),
  A("5.17", "اطلاعات احراز هویت", "Authentication information", ORG),
  A("5.18", "حقوق دسترسی", "Access rights", ORG),
  A("5.19", "امنیت اطلاعات در روابط با تأمین‌کنندگان", "Information security in supplier relationships", ORG),
  A("5.20", "پرداختن به امنیت اطلاعات در توافق‌نامه‌های تأمین‌کنندگان", "Addressing information security within supplier agreements", ORG),
  A("5.21", "مدیریت امنیت اطلاعات در زنجیرهٔ تأمین فاوا", "Managing information security in the ICT supply chain", ORG),
  A("5.22", "پایش، بازنگری و مدیریت تغییر خدمات تأمین‌کنندگان", "Monitoring, review and change management of supplier services", ORG),
  A("5.23", "امنیت اطلاعات در استفاده از خدمات ابری", "Information security for use of cloud services", ORG),
  A("5.24", "برنامه‌ریزی و آمادگی مدیریت رخدادهای امنیت اطلاعات", "Information security incident management planning and preparation", ORG),
  A("5.25", "ارزیابی و تصمیم‌گیری دربارهٔ رویدادهای امنیت اطلاعات", "Assessment and decision on information security events", ORG),
  A("5.26", "پاسخ به رخدادهای امنیت اطلاعات", "Response to information security incidents", ORG),
  A("5.27", "درس‌آموزی از رخدادهای امنیت اطلاعات", "Learning from information security incidents", ORG),
  A("5.28", "گردآوری شواهد", "Collection of evidence", ORG),
  A("5.29", "امنیت اطلاعات هنگام اختلال", "Information security during disruption", ORG),
  A("5.30", "آمادگی فاوا برای تداوم کسب‌وکار", "ICT readiness for business continuity", ORG),
  A("5.31", "الزامات قانونی، مقرراتی و قراردادی", "Legal, statutory, regulatory and contractual requirements", ORG),
  A("5.32", "حقوق مالکیت فکری", "Intellectual property rights", ORG),
  A("5.33", "حفاظت از سوابق", "Protection of records", ORG),
  A("5.34", "حریم خصوصی و حفاظت از اطلاعات شخصی", "Privacy and protection of PII", ORG),
  A("5.35", "بازنگری مستقل امنیت اطلاعات", "Independent review of information security", ORG),
  A("5.36", "انطباق با خط‌مشی‌ها، قواعد و استانداردهای امنیت اطلاعات", "Compliance with policies, rules and standards for information security", ORG),
  A("5.37", "روال‌های عملیاتی مستند", "Documented operating procedures", ORG),
  A("6.1", "غربالگری", "Screening", PEOPLE),
  A("6.2", "شرایط و ضوابط استخدام", "Terms and conditions of employment", PEOPLE),
  A("6.3", "آگاهی، آموزش و تعلیم امنیت اطلاعات", "Information security awareness, education and training", PEOPLE),
  A("6.4", "فرایند انضباطی", "Disciplinary process", PEOPLE),
  A("6.5", "مسئولیت‌ها پس از پایان یا تغییر استخدام", "Responsibilities after termination or change of employment", PEOPLE),
  A("6.6", "توافق‌نامه‌های محرمانگی یا عدم افشا", "Confidentiality or non-disclosure agreements", PEOPLE),
  A("6.7", "دورکاری", "Remote working", PEOPLE),
  A("6.8", "گزارش رویدادهای امنیت اطلاعات", "Information security event reporting", PEOPLE),
  A("7.1", "محیط‌های امنیت فیزیکی", "Physical security perimeters", PHYS),
  A("7.2", "ورود فیزیکی", "Physical entry", PHYS),
  A("7.3", "ایمن‌سازی دفاتر، اتاق‌ها و تأسیسات", "Securing offices, rooms and facilities", PHYS),
  A("7.4", "پایش امنیت فیزیکی", "Physical security monitoring", PHYS),
  A("7.5", "حفاظت در برابر تهدیدهای فیزیکی و محیطی", "Protecting against physical and environmental threats", PHYS),
  A("7.6", "کار در محیط‌های امن", "Working in secure areas", PHYS),
  A("7.7", "میز پاک و صفحهٔ نمایش پاک", "Clear desk and clear screen", PHYS),
  A("7.8", "جانمایی و حفاظت از تجهیزات", "Equipment siting and protection", PHYS),
  A("7.9", "امنیت دارایی‌های بیرون از محل", "Security of assets off-premises", PHYS),
  A("7.10", "رسانه‌های ذخیره‌سازی", "Storage media", PHYS),
  A("7.11", "تأسیسات پشتیبان", "Supporting utilities", PHYS),
  A("7.12", "امنیت کابل‌کشی", "Cabling security", PHYS),
  A("7.13", "نگهداری تجهیزات", "Equipment maintenance", PHYS),
  A("7.14", "امحای امن یا استفادهٔ دوبارهٔ تجهیزات", "Secure disposal or re-use of equipment", PHYS),
  A("8.1", "دستگاه‌های نقطهٔ پایانی کاربر", "User endpoint devices", TECH),
  A("8.2", "حقوق دسترسی ممتاز", "Privileged access rights", TECH),
  A("8.3", "محدودسازی دسترسی به اطلاعات", "Information access restriction", TECH),
  A("8.4", "دسترسی به کد منبع", "Access to source code", TECH),
  A("8.5", "احراز هویت امن", "Secure authentication", TECH),
  A("8.6", "مدیریت ظرفیت", "Capacity management", TECH),
  A("8.7", "حفاظت در برابر بدافزار", "Protection against malware", TECH),
  A("8.8", "مدیریت آسیب‌پذیری‌های فنی", "Management of technical vulnerabilities", TECH),
  A("8.9", "مدیریت پیکربندی", "Configuration management", TECH),
  A("8.10", "حذف اطلاعات", "Information deletion", TECH),
  A("8.11", "پوشاندن داده", "Data masking", TECH),
  A("8.12", "پیشگیری از نشت داده", "Data leakage prevention", TECH),
  A("8.13", "پشتیبان‌گیری از اطلاعات", "Information backup", TECH),
  A("8.14", "افزونگی امکانات پردازش اطلاعات", "Redundancy of information processing facilities", TECH),
  A("8.15", "ثبت رویدادها (لاگ)", "Logging", TECH),
  A("8.16", "فعالیت‌های پایش", "Monitoring activities", TECH),
  A("8.17", "همگام‌سازی ساعت", "Clock synchronization", TECH),
  A("8.18", "استفاده از برنامه‌های کمکی ممتاز", "Use of privileged utility programs", TECH),
  A("8.19", "نصب نرم‌افزار روی سامانه‌های عملیاتی", "Installation of software on operational systems", TECH),
  A("8.20", "امنیت شبکه‌ها", "Networks security", TECH),
  A("8.21", "امنیت خدمات شبکه", "Security of network services", TECH),
  A("8.22", "تفکیک شبکه‌ها", "Segregation of networks", TECH),
  A("8.23", "پالایش وب", "Web filtering", TECH),
  A("8.24", "استفاده از رمزنگاری", "Use of cryptography", TECH),
  A("8.25", "چرخهٔ عمر توسعهٔ امن", "Secure development life cycle", TECH),
  A("8.26", "الزامات امنیتی برنامه‌های کاربردی", "Application security requirements", TECH),
  A("8.27", "اصول معماری و مهندسی سامانهٔ امن", "Secure system architecture and engineering principles", TECH),
  A("8.28", "کدنویسی امن", "Secure coding", TECH),
  A("8.29", "آزمون امنیت در توسعه و پذیرش", "Security testing in development and acceptance", TECH),
  A("8.30", "توسعهٔ برون‌سپاری‌شده", "Outsourced development", TECH),
  A("8.31", "جداسازی محیط‌های توسعه، آزمون و عملیات", "Separation of development, test and production environments", TECH),
  A("8.32", "مدیریت تغییر", "Change management", TECH),
  A("8.33", "اطلاعات آزمون", "Test information", TECH),
  A("8.34", "حفاظت از سامانه‌های اطلاعاتی هنگام آزمون ممیزی", "Protection of information systems during audit testing", TECH),
];

const F = (code: string, title: string, title_en: string): RequirementSeed => ({ code, title, title_en, theme: title, level: 1 });
const C = (code: string, title: string, title_en: string, parent: string, theme: string): RequirementSeed => ({ code, title, title_en, theme, parent, level: 2 });

const GV = "حاکمیت";
const ID = "شناسایی";
const PR = "حفاظت";
const DE = "کشف";
const RS = "پاسخ";
const RC = "بازیابی";

/** NIST CSF 2.0: the six functions and their 22 categories. */
export const NIST_CSF: RequirementSeed[] = [
  F("GV", GV, "Govern"),
  C("GV.OC", "بافت سازمانی", "Organizational Context", "GV", GV),
  C("GV.RM", "راهبرد مدیریت ریسک", "Risk Management Strategy", "GV", GV),
  C("GV.RR", "نقش‌ها، مسئولیت‌ها و اختیارات", "Roles, Responsibilities, and Authorities", "GV", GV),
  C("GV.PO", "خط‌مشی", "Policy", "GV", GV),
  C("GV.OV", "نظارت", "Oversight", "GV", GV),
  C("GV.SC", "مدیریت ریسک زنجیرهٔ تأمین سایبری", "Cybersecurity Supply Chain Risk Management", "GV", GV),
  F("ID", ID, "Identify"),
  C("ID.AM", "مدیریت دارایی", "Asset Management", "ID", ID),
  C("ID.RA", "ارزیابی ریسک", "Risk Assessment", "ID", ID),
  C("ID.IM", "بهبود", "Improvement", "ID", ID),
  F("PR", PR, "Protect"),
  C("PR.AA", "مدیریت هویت، احراز هویت و کنترل دسترسی", "Identity Management, Authentication, and Access Control", "PR", PR),
  C("PR.AT", "آگاهی‌بخشی و آموزش", "Awareness and Training", "PR", PR),
  C("PR.DS", "امنیت داده", "Data Security", "PR", PR),
  C("PR.PS", "امنیت سکو", "Platform Security", "PR", PR),
  C("PR.IR", "تاب‌آوری زیرساخت فناوری", "Technology Infrastructure Resilience", "PR", PR),
  F("DE", DE, "Detect"),
  C("DE.CM", "پایش مستمر", "Continuous Monitoring", "DE", DE),
  C("DE.AE", "تحلیل رویدادهای نامطلوب", "Adverse Event Analysis", "DE", DE),
  F("RS", RS, "Respond"),
  C("RS.MA", "مدیریت رخداد", "Incident Management", "RS", RS),
  C("RS.AN", "تحلیل رخداد", "Incident Analysis", "RS", RS),
  C("RS.CO", "گزارش‌دهی و ارتباطات پاسخ به رخداد", "Incident Response Reporting and Communication", "RS", RS),
  C("RS.MI", "مهار رخداد", "Incident Mitigation", "RS", RS),
  F("RC", RC, "Recover"),
  C("RC.RP", "اجرای برنامهٔ بازیابی رخداد", "Incident Recovery Plan Execution", "RC", RC),
  C("RC.CO", "ارتباطات بازیابی رخداد", "Incident Recovery Communication", "RC", RC),
];

/** The CSF categories (the rows a profile scores). */
export const CSF_CATEGORIES = NIST_CSF.filter((r) => r.level === 2).map((r) => r.code);

const S = (code: string, title: string, title_en: string, parent?: string): RequirementSeed => ({
  code, title, title_en, parent, level: code.split(".").length, theme: parent ? parent.split(".")[0] : code,
});

/** ISO/IEC 20000-1:2018 clauses 4–10 (operation down to its processes). */
export const ISO20000: RequirementSeed[] = [
  S("4", "بافت سازمان", "Context of the organization"),
  S("4.1", "درک سازمان و بافت آن", "Understanding the organization and its context", "4"),
  S("4.2", "درک نیازها و انتظارات طرف‌های ذی‌نفع", "Understanding the needs and expectations of interested parties", "4"),
  S("4.3", "تعیین دامنهٔ سامانهٔ مدیریت خدمت", "Determining the scope of the service management system", "4"),
  S("4.4", "سامانهٔ مدیریت خدمت", "Service management system", "4"),
  S("5", "رهبری", "Leadership"),
  S("5.1", "رهبری و تعهد", "Leadership and commitment", "5"),
  S("5.2", "خط‌مشی", "Policy", "5"),
  S("5.3", "نقش‌ها، مسئولیت‌ها و اختیارات سازمانی", "Organizational roles, responsibilities and authorities", "5"),
  S("6", "برنامه‌ریزی", "Planning"),
  S("6.1", "اقدام‌ها برای پرداختن به ریسک‌ها و فرصت‌ها", "Actions to address risks and opportunities", "6"),
  S("6.2", "اهداف مدیریت خدمت و برنامه‌ریزی برای دستیابی به آن‌ها", "Service management objectives and planning to achieve them", "6"),
  S("6.3", "طرح‌ریزی سامانهٔ مدیریت خدمت", "Plan the service management system", "6"),
  S("7", "پشتیبانی", "Support of the service management system"),
  S("7.1", "منابع", "Resources", "7"),
  S("7.2", "صلاحیت", "Competence", "7"),
  S("7.3", "آگاهی", "Awareness", "7"),
  S("7.4", "ارتباطات", "Communication", "7"),
  S("7.5", "اطلاعات مستند", "Documented information", "7"),
  S("7.6", "دانش", "Knowledge", "7"),
  S("8", "عملیات", "Operation of the service management system"),
  S("8.1", "برنامه‌ریزی و کنترل عملیاتی", "Operational planning and control", "8"),
  S("8.2", "سبد خدمات", "Service portfolio", "8"),
  S("8.2.4", "کاتالوگ خدمات", "Service catalogue management", "8.2"),
  S("8.2.5", "مدیریت دارایی", "Asset management", "8.2"),
  S("8.2.6", "مدیریت پیکربندی", "Configuration management", "8.2"),
  S("8.3", "روابط و توافق", "Relationship and agreement", "8"),
  S("8.3.3", "مدیریت سطح خدمت", "Service level management", "8.3"),
  S("8.3.4", "مدیریت تأمین‌کننده", "Supplier management", "8.3"),
  S("8.4", "عرضه و تقاضا", "Supply and demand", "8"),
  S("8.4.3", "مدیریت ظرفیت", "Capacity management", "8.4"),
  S("8.5", "طراحی، ساخت و انتقال خدمت", "Service design, build and transition", "8"),
  S("8.5.1", "مدیریت تغییر", "Change management", "8.5"),
  S("8.5.3", "مدیریت انتشار و استقرار", "Release and deployment management", "8.5"),
  S("8.6", "حل و انجام", "Resolution and fulfilment", "8"),
  S("8.6.1", "مدیریت رخداد", "Incident management", "8.6"),
  S("8.6.2", "مدیریت درخواست خدمت", "Service request management", "8.6"),
  S("8.6.3", "مدیریت مشکل", "Problem management", "8.6"),
  S("8.7", "تضمین خدمت", "Service assurance", "8"),
  S("8.7.1", "مدیریت دسترس‌پذیری خدمت", "Service availability management", "8.7"),
  S("8.7.2", "مدیریت تداوم خدمت", "Service continuity management", "8.7"),
  S("8.7.3", "مدیریت امنیت اطلاعات", "Information security management", "8.7"),
  S("9", "ارزیابی عملکرد", "Performance evaluation"),
  S("9.1", "پایش، اندازه‌گیری، تحلیل و ارزشیابی", "Monitoring, measurement, analysis and evaluation", "9"),
  S("9.2", "ممیزی داخلی", "Internal audit", "9"),
  S("9.3", "بازنگری مدیریت", "Management review", "9"),
  S("9.4", "گزارش‌دهی خدمت", "Service reporting", "9"),
  S("10", "بهبود", "Improvement"),
  S("10.1", "عدم انطباق و اقدام اصلاحی", "Nonconformity and corrective action", "10"),
  S("10.2", "بهبود مستمر", "Continual improvement", "10"),
];

export const REQUIREMENTS_OF: Record<string, RequirementSeed[]> = {
  iso27001_2022: ANNEX_A,
  nist_csf_2: NIST_CSF,
  iso20000_2018: ISO20000,
};

// ---------------------------------------------------------------------------------------------------------------
// Regulatory notification regimes (SEC-008): calendar-time deadlines from the moment of awareness. The Iranian
// regimes are placeholders whose hours each organisation verifies against the rules that bind it.

export interface RegimeStage {
  key: string;
  label: string;
  hours: number;
}

export interface RegimeSeed {
  key: string;
  name: string;
  authority: string;
  placeholder?: boolean;
  personal_data?: boolean;
  stages: RegimeStage[];
  description: string;
}

export const REGIMES: RegimeSeed[] = [
  { key: "ir_maher", name: "گزارش رخداد به مرکز ماهر", authority: "مرکز ماهر (CERT ملی)", placeholder: true, stages: [{ key: "initial", label: "گزارش اولیه", hours: 24 }, { key: "final", label: "گزارش نهایی", hours: 24 * 14 }], description: "جای‌نگهدار: موعدها را با ضوابط معتبر سازمان خود تطبیق دهید" },
  { key: "ir_afta", name: "گزارش رخداد زیرساخت حیاتی به افتا", authority: "افتا", placeholder: true, stages: [{ key: "initial", label: "اطلاع اولیه", hours: 24 }], description: "جای‌نگهدار برای دستگاه‌های دارای زیرساخت حیاتی" },
  { key: "ir_cbi", name: "گزارش رخداد امنیتی به بانک مرکزی", authority: "بانک مرکزی", placeholder: true, stages: [{ key: "initial", label: "اطلاع اولیه", hours: 24 }], description: "جای‌نگهدار برای بانک‌ها و مؤسسه‌های اعتباری" },
  { key: "gdpr", name: "GDPR — نقض داده‌های شخصی", authority: "مرجع ناظر حفاظت از داده", personal_data: true, stages: [{ key: "notify", label: "اطلاع به مرجع ناظر", hours: 72 }], description: "ماده ۳۳: اطلاع ظرف ۷۲ ساعت از آگاهی" },
  { key: "nis2", name: "NIS2", authority: "CSIRT یا مرجع ملی", stages: [{ key: "early_warning", label: "هشدار اولیه", hours: 24 }, { key: "notification", label: "اطلاع رخداد", hours: 72 }, { key: "final", label: "گزارش نهایی", hours: 24 * 30 }], description: "ماده ۲۳: ۲۴ ساعت، ۷۲ ساعت و یک ماه" },
  { key: "eu_cra", name: "EU CRA — آسیب‌پذیری بهره‌برداری‌شده", authority: "ENISA و CSIRT هماهنگ‌کننده", stages: [{ key: "early_warning", label: "هشدار اولیه", hours: 24 }, { key: "notification", label: "اطلاع", hours: 72 }, { key: "final", label: "گزارش نهایی", hours: 24 * 14 }], description: "ماده ۱۴ برای سازندگان محصولات دیجیتال" },
];

// ---------------------------------------------------------------------------------------------------------------
// Response playbooks (SEC-002): steps by phase; a step with an action is a containment action that needs approval.

export interface PlaybookStep {
  title: string;
  phase: "analysis" | "contain" | "eradicate" | "recover" | "review";
  mandatory: boolean;
  action?: string;
  approval?: boolean;
}

export interface PlaybookSeed {
  name: string;
  category: string;
  description: string;
  steps: PlaybookStep[];
}

export const PLAYBOOKS: PlaybookSeed[] = [
  {
    name: "پاسخ به فیشینگ",
    category: "phishing",
    description: "رایانامهٔ فریبنده یا پیوند مخرب: نشانگرها، گیرندگان، مسدودسازی، حذف از صندوق‌ها و بازنشانی حساب‌ها",
    steps: [
      { title: "بررسی سرآیند و فرستنده و استخراج نشانگرها (نشانی‌ها، دامنه‌ها، پیوست‌ها)", phase: "analysis", mandatory: true },
      { title: "یافتن گیرندگان دیگر و کاربرانی که روی پیوند کلیک کرده یا اطلاعات وارد کرده‌اند", phase: "analysis", mandatory: true },
      { title: "مسدودسازی فرستنده، دامنه و پیوندهای مخرب در دروازهٔ رایانامه و پراکسی", phase: "contain", mandatory: true, action: "block_url", approval: true },
      { title: "حذف رایانامه از صندوق همهٔ گیرندگان", phase: "contain", mandatory: false, action: "purge_mail", approval: true },
      { title: "بازنشانی گذرواژه و ابطال نشست‌های حساب‌هایی که اطلاعات وارد کرده‌اند", phase: "contain", mandatory: false, action: "reset_password", approval: true },
      { title: "بررسی ورودهای مشکوک و قاعده‌های هدایت رایانامه در حساب‌های متأثر", phase: "eradicate", mandatory: true },
      { title: "پایش ۷۲ ساعتهٔ حساب‌های متأثر و بازگشت دسترسی کاربران", phase: "recover", mandatory: false },
      { title: "آگاه‌سازی کارکنان و ثبت درس‌آموخته‌ها", phase: "review", mandatory: true },
    ],
  },
  {
    name: "پاسخ به بدافزار",
    category: "malware",
    description: "میزبان آلوده: جداسازی، مسدودسازی نشانگرها، پاک‌سازی، بررسی گسترش و بازگرداندن",
    steps: [
      { title: "شناسایی میزبان‌های آلوده و استخراج نشانگرها (هش، فرایند، اتصال‌ها)", phase: "analysis", mandatory: true },
      { title: "جداسازی میزبان آلوده از شبکه", phase: "contain", mandatory: true, action: "isolate_host", approval: true },
      { title: "مسدودسازی هش فایل و نشانی‌های فرمان و کنترل", phase: "contain", mandatory: true, action: "block_ip", approval: true },
      { title: "پاک‌سازی یا نصب دوبارهٔ سامانه و به‌روزرسانی امضاها", phase: "eradicate", mandatory: true },
      { title: "بررسی گسترش جانبی و حساب‌های به‌خطرافتاده", phase: "eradicate", mandatory: true },
      { title: "بازگرداندن از پشتیبان سالم و بازگشت به شبکه زیر پایش", phase: "recover", mandatory: true },
      { title: "تحلیل ریشه‌ای و درس‌آموخته‌ها", phase: "review", mandatory: true },
    ],
  },
  {
    name: "پاسخ به نشت داده",
    category: "data_breach",
    description: "دادهٔ محرمانه یا شخصی بیرون رفته است: دامنه، مجرا، قطع نشت، شواهد، اطلاع‌رسانی الزامی و پیشگیری",
    steps: [
      { title: "تعیین نوع، حجم، طبقه‌بندی و دارندگان دادهٔ نشت‌یافته", phase: "analysis", mandatory: true },
      { title: "تعیین مجرای نشت و بازهٔ زمانی آن", phase: "analysis", mandatory: true },
      { title: "قطع مجرای نشت (ابطال پیوند عمومی، غیرفعال‌سازی حساب، مسدودسازی مقصد)", phase: "contain", mandatory: true, action: "disable_account", approval: true },
      { title: "حفظ شواهد با زنجیرهٔ حضانت", phase: "contain", mandatory: true },
      { title: "رفع آسیب‌پذیری یا پیکربندی نادرستی که به نشت انجامید", phase: "eradicate", mandatory: true },
      { title: "ارزیابی لزوم اطلاع به نهادهای ناظر و افراد متأثر و شروع ساعت‌های الزامی", phase: "recover", mandatory: true },
      { title: "گزارش پس از رخداد و اقدام‌های پیشگیرانه", phase: "review", mandatory: true },
    ],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// The risk matrix (SEC-042): 5 × 5, likelihood × impact, a rating per cell.

export const LIKELIHOOD_LABELS = ["نادر", "بعید", "ممکن", "محتمل", "تقریباً قطعی"];
export const IMPACT_LABELS = ["ناچیز", "جزئی", "متوسط", "عمده", "فاجعه‌بار"];

/** cells[likelihood − 1][impact − 1]: the rating of a score (low ≤ 4, medium ≤ 9, high ≤ 14, critical above). */
export const MATRIX_5X5: string[][] = [1, 2, 3, 4, 5].map((l) =>
  [1, 2, 3, 4, 5].map((i) => {
    const s = l * i;
    return s <= 4 ? "low" : s <= 9 ? "medium" : s <= 14 ? "high" : "critical";
  }),
);

/** Default appetite (residual score accepted without escalation) and tolerance per risk category. */
export const APPETITE: { category: string; appetite: number; tolerance: number; statement: string }[] = [
  { category: "security", appetite: 6, tolerance: 9, statement: "ریسک امنیتی پایین تا متوسط پذیرفته می‌شود؛ ریسک بالا درمان می‌خواهد" },
  { category: "privacy", appetite: 4, tolerance: 6, statement: "برای داده‌های شخصی، اشتهای ریسک کم است" },
  { category: "compliance", appetite: 4, tolerance: 6, statement: "عدم انطباق با الزامات قانونی پذیرفته نمی‌شود" },
  { category: "operational", appetite: 9, tolerance: 12, statement: "ریسک عملیاتی متوسط با کنترل‌های موجود پذیرفتنی است" },
  { category: "availability", appetite: 8, tolerance: 12, statement: "اختلال‌های کوتاه در خدمات غیرحیاتی پذیرفتنی است" },
  { category: "supplier", appetite: 8, tolerance: 12, statement: "وابستگی به تأمین‌کننده با قرارداد و پایش پذیرفتنی است" },
  { category: "project", appetite: 10, tolerance: 15, statement: "ریسک پروژه‌ها در حد برنامهٔ مدیریت ریسک پروژه" },
  { category: "ai", appetite: 6, tolerance: 9, statement: "سامانه‌های هوش مصنوعی با ارزیابی و نظارت انسانی" },
  { category: "strategic", appetite: 12, tolerance: 16, statement: "برای فرصت‌های راهبردی، ریسک بالاتر پذیرفتنی است" },
  { category: "financial", appetite: 8, tolerance: 12, statement: "زیان مالی بیش از آستانهٔ مصوب پذیرفته نمی‌شود" },
];

// ---------------------------------------------------------------------------------------------------------------
// The starter control library: one control tested once satisfies requirements of several frameworks.

export interface ControlSeed {
  code: string;
  name: string;
  objective: string;
  type: "preventive" | "detective" | "corrective";
  nature: "manual" | "automated" | "hybrid";
  frequency: string;
  maps: Record<string, string[]>;
  indicator?: string;
  threshold?: number;
}

export const CONTROLS: ControlSeed[] = [
  { code: "SEC-VM-01", name: "رفع آسیب‌پذیری‌ها در موعد", objective: "آسیب‌پذیری‌های فنی بر پایهٔ ریسک و در موعد مصوب رفع می‌شوند", type: "corrective", nature: "hybrid", frequency: "monthly", maps: { iso27001_2022: ["A.8.8"], nist_csf_2: ["ID.RA", "PR.PS"], iso20000_2018: ["8.7.3"] }, indicator: "vuln_sla", threshold: 90 },
  { code: "SEC-VM-02", name: "آسیب‌پذیری‌های بهره‌برداری‌شده (KEV) بی‌تأخیر", objective: "هیچ آسیب‌پذیری فهرست KEV از موعد خود نمی‌گذرد", type: "corrective", nature: "automated", frequency: "continuous", maps: { iso27001_2022: ["A.8.8", "A.5.7"], nist_csf_2: ["ID.RA"] }, indicator: "kev_overdue", threshold: 0 },
  { code: "SEC-CH-01", name: "تأیید تغییرها پیش از اجرا", objective: "هر تغییر عملیاتی پیش از اجرا مجوز می‌گیرد", type: "preventive", nature: "automated", frequency: "continuous", maps: { iso27001_2022: ["A.8.32"], nist_csf_2: ["PR.PS"], iso20000_2018: ["8.5.1"] }, indicator: "change_approved", threshold: 95 },
  { code: "SEC-PO-01", name: "پذیرش خط‌مشی امنیت اطلاعات", objective: "کارکنان خط‌مشی‌های امنیت اطلاعات را خوانده و پذیرفته‌اند", type: "preventive", nature: "hybrid", frequency: "annual", maps: { iso27001_2022: ["A.5.1", "A.6.3"], nist_csf_2: ["GV.PO", "PR.AT"], iso20000_2018: ["5.2", "7.3"] }, indicator: "policy_ack", threshold: 90 },
  { code: "SEC-IR-01", name: "مهار رخدادهای امنیتی در موعد", objective: "رخدادهای امنیتی در موعد توافق مهار می‌شوند", type: "corrective", nature: "manual", frequency: "continuous", maps: { iso27001_2022: ["A.5.24", "A.5.25", "A.5.26"], nist_csf_2: ["RS.MA", "RS.MI"], iso20000_2018: ["8.7.3"] }, indicator: "sir_contained", threshold: 90 },
  { code: "SEC-IR-02", name: "درس‌آموزی از رخدادهای امنیتی", objective: "هر رخداد امنیتی بسته‌شده درس‌آموخته و اقدام پیشگیرانه دارد", type: "preventive", nature: "manual", frequency: "quarterly", maps: { iso27001_2022: ["A.5.27"], nist_csf_2: ["ID.IM"], iso20000_2018: ["10.1"] }, indicator: "sir_lessons", threshold: 80 },
  { code: "SEC-IR-03", name: "گردآوری و نگهداری شواهد", objective: "شواهد با هش و زنجیرهٔ حضانت نگهداری می‌شوند", type: "corrective", nature: "manual", frequency: "quarterly", maps: { iso27001_2022: ["A.5.28"], nist_csf_2: ["RS.AN"] } },
  { code: "SEC-RM-01", name: "بازنگری دوره‌ای ریسک‌ها", objective: "هر ریسک مالک دارد و دست‌کم هر شش ماه بازنگری می‌شود", type: "detective", nature: "manual", frequency: "semiannual", maps: { iso27001_2022: ["A.5.4"], nist_csf_2: ["GV.RM", "ID.RA"], iso20000_2018: ["6.1"] }, indicator: "risk_reviewed", threshold: 80 },
  { code: "SEC-GV-01", name: "آزمون دوره‌ای کنترل‌ها", objective: "کنترل‌ها دست‌کم هر شش ماه آزموده می‌شوند", type: "detective", nature: "manual", frequency: "semiannual", maps: { iso27001_2022: ["A.5.35", "A.5.36"], nist_csf_2: ["GV.OV"], iso20000_2018: ["9.1", "9.2"] }, indicator: "controls_tested", threshold: 80 },
  { code: "SEC-GV-02", name: "مدیریت استثناهای امنیتی", objective: "هیچ استثنای امنیتی بی‌تمدید از موعد خود نمی‌گذرد", type: "detective", nature: "automated", frequency: "continuous", maps: { iso27001_2022: ["A.5.36"], nist_csf_2: ["GV.RM"] }, indicator: "exceptions_expired", threshold: 0 },
];
