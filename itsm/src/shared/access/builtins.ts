// The built-in roles every organisation starts with (docs/spec/ACCESS.md § Default role matrix). They live in code:
// an organisation's `role` row with the same key replaces one (edited in the permission matrix, «بازگشت به پیش‌فرض»
// deletes the row), so improved defaults reach every organisation that has not changed them. The service-desk
// preset decides how far agents read: «میز خدمت باز» (open: every operational record of their workspaces, the
// ServiceNow `itil` default) or «نیاز به دانستن» (need_to_know: their groups' and their own records).
// Imported by the UI: keep it free of server imports.
import type { Grant, Grants, Persona, RoleDef, Scope } from "./model";

export type DeskPreset = "open" | "need_to_know";
export const DESK_PRESETS: Record<DeskPreset, { label: string; about: string }> = {
  open: { label: "میز خدمت باز", about: "کارشناسان همهٔ رکوردهای عملیاتی فضاهای کاری خود را می‌بینند و رکوردهای گروه‌های خود را تغییر می‌دهند" },
  need_to_know: { label: "نیاز به دانستن", about: "کارشناسان فقط رکوردهای گروه‌ها و رکوردهای خود را می‌بینند" },
};

const R = (read: Scope = "all"): Grant => ({ read });
const RW = (read: Scope, write: Scope, extra: Partial<Grant> = {}): Grant => ({ read, create: true, write, ...extra });
const FULL: Grant = { read: "all", create: true, write: "all", delete: "all", approve: true, admin: true };

function role(key: string, name: string, persona: Persona, description: string, grants: Grants, rest: Partial<RoleDef> = {}): RoleDef {
  return { key, name, persona, description, grants, field_groups: [], contains: [], workspaces: "member", domains: "own", ...rest };
}

/** The built-in roles under a service-desk preset (default: open). */
export function builtinRoles(preset: DeskPreset = "open"): RoleDef[] {
  // how far agents read operational records
  const D: Scope = preset === "open" ? "all" : "group";
  const requesterSide: Grant = { read: "own", create: true, write: "own" };
  return [
    role("requester", "درخواست‌دهنده", "requester", "ثبت و پیگیری درخواست‌ها و رخدادهای خود؛ دیدن دانش و کاتالوگ خدمات", {
      incident: requesterSide,
      request: requesterSide,
      hr: requesterSide,
      facilities: requesterSide,
      csm: requesterSide,
      work: requesterSide,
      survey: requesterSide,
      knowledge: R(),
      catalog: R(),
      service: R(),
      org: R(),
      users: R("own"),
    }),
    role(
      "agent",
      "کارشناس پشتیبانی",
      "agent",
      "کار روی رخدادها، درخواست‌ها، مشکلات و تغییرهای گروه‌های خود؛ دیدن پیکربندی، دارایی‌ها و دانش",
      {
        incident: RW(D, "group"),
        request: RW(D, "group"),
        problem: RW(D, "group"),
        change: RW(D, "group"),
        work: RW(D, "group"),
        release: R(D),
        event: R(D),
        survey: R("group"),
        knowledge: RW("all", "own"),
        catalog: R(),
        service: R(),
        sla: R(),
        cmdb: R(),
        asset: R(),
        software: R(),
        vendor: R(),
        oncall: R(),
        reports: R(),
        org: R(),
        users: R(),
      },
      { contains: ["requester"], field_groups: ["internal", "personal"] },
    ),
    role(
      "team_lead",
      "سرپرست گروه",
      "agent",
      "مانند کارشناس، به‌علاوهٔ تأیید در گروه‌های خود و مدیریت اعضای گروه‌هایی که در آن‌هاست",
      {
        incident: RW(D, "group", { approve: true }),
        request: RW(D, "group", { approve: true }),
        problem: RW(D, "group", { approve: true }),
        change: RW(D, "group", { approve: true }),
        work: RW(D, "group", { approve: true }),
        org: RW("all", "group"),
      },
      { contains: ["agent"], field_groups: ["internal", "personal"] },
    ),
    role(
      "service_desk_manager",
      "مدیر میز خدمت",
      "agent",
      "همهٔ رخدادها، درخواست‌ها و مشکلات فضاهای کاری خود؛ توافق سطح خدمت، کاتالوگ، گروه‌ها و گزارش‌ها",
      {
        incident: { ...FULL, admin: false },
        request: { ...FULL, admin: false },
        problem: { ...FULL, admin: false },
        work: { ...FULL, admin: false },
        change: RW("all", "group", { approve: true }),
        sla: RW("all", "all", { admin: true }),
        catalog: RW("all", "all", { admin: true }),
        knowledge: RW("all", "all", { approve: true }),
        survey: RW("all", "all"),
        reports: RW("all", "all"),
        org: RW("all", "all"),
      },
      { contains: ["team_lead"], field_groups: ["financial", "internal", "personal"] },
    ),
    role(
      "incident_manager",
      "مدیر رخداد",
      "agent",
      "همهٔ رخدادها (از جمله رخدادهای عمده) و تأیید آن‌ها",
      { incident: RW("all", "all", { approve: true }), problem: RW("all", "group"), change: R(), reports: R() },
      { contains: ["agent"], field_groups: ["internal", "personal"] },
    ),
    role(
      "problem_manager",
      "مدیر مشکل",
      "agent",
      "همهٔ مشکلات و خطاهای شناخته‌شده و انتشار آن‌ها در دانش",
      { problem: RW("all", "all", { approve: true }), incident: RW("all", "group"), knowledge: RW("all", "all"), change: R() },
      { contains: ["agent"], field_groups: ["internal", "personal"] },
    ),
    role(
      "change_manager",
      "مدیر تغییر",
      "agent",
      "همهٔ تغییرها، زمان‌بندی و تأیید آن‌ها؛ دیدن انتشارها و پیکربندی",
      { change: RW("all", "all", { approve: true }), release: RW("all", "group"), cmdb: R(), service: R(), incident: R(), problem: R() },
      { contains: ["agent"], field_groups: ["internal", "personal"] },
    ),
    role(
      "cab_member",
      "عضو هیئت مشورتی تغییر",
      "agent",
      "دیدن و تأیید تغییرها و انتشارها",
      { change: { read: "all", approve: true }, release: R() },
      { contains: ["requester"], field_groups: ["internal"] },
    ),
    role(
      "release_manager",
      "مدیر انتشار",
      "agent",
      "همهٔ انتشارها و تأیید استقرار",
      { release: RW("all", "all", { approve: true }), change: RW("all", "group") },
      { contains: ["agent"], field_groups: ["internal", "personal"] },
    ),
    role(
      "asset_manager",
      "مدیر دارایی",
      "agent",
      "دارایی‌ها، نرم‌افزار، قراردادها، تدارکات و تأمین‌کنندگان با اطلاعات مالی",
      {
        asset: { ...FULL, admin: false },
        software: { ...FULL, admin: false },
        contract: { ...FULL, admin: false },
        procurement: { ...FULL, admin: false },
        vendor: { ...FULL, admin: false },
        cmdb: RW("all", "group"),
        financial: R(),
      },
      { contains: ["agent"], field_groups: ["financial", "internal", "personal"] },
    ),
    role(
      "configuration_manager",
      "مدیر پیکربندی",
      "agent",
      "پایگاه پیکربندی (CMDB) و سبد خدمات",
      { cmdb: { ...FULL, approve: false }, service: RW("all", "all"), asset: R() },
      { contains: ["agent"], field_groups: ["internal", "personal"] },
    ),
    role(
      "knowledge_manager",
      "مدیر دانش",
      "agent",
      "همهٔ مقاله‌های دانش، بازبینی و انتشار آن‌ها",
      { knowledge: FULL },
      { contains: ["agent"], field_groups: ["internal", "personal"] },
    ),
    role(
      "service_owner",
      "مالک خدمت",
      "agent",
      "خدمت‌های خود، کاتالوگ و توافق سطح خدمت؛ دیدن همهٔ رکوردهای عملیاتی",
      {
        service: RW("all", "own", { approve: true }),
        catalog: RW("all", "all"),
        sla: RW("all", "all"),
        incident: R(),
        request: R(),
        problem: R(),
        change: R(),
        reports: R(),
      },
      { contains: ["agent"], field_groups: ["internal", "personal"] },
    ),
    role(
      "security_analyst",
      "تحلیل‌گر امنیت",
      "agent",
      "رخدادهای امنیتی و آسیب‌پذیری‌های گروه‌های خود، با فیلدهای امنیتی",
      {
        security: RW("group", "group", { approve: true }),
        risk: RW("all", "group"),
        compliance: R(),
        event: R(),
        incident: RW(D, "group"),
      },
      { contains: ["agent"], field_groups: ["internal", "personal", "security"] },
    ),
    role(
      "hr_agent",
      "کارشناس منابع انسانی",
      "agent",
      "پرونده‌های منابع انسانی گروه‌های خود با فیلدهای منابع انسانی",
      { hr: RW("group", "group"), work: RW("group", "group"), knowledge: RW("all", "own"), org: R(), users: R() },
      { contains: ["requester"], field_groups: ["hr", "internal", "personal"] },
    ),
    role(
      "facilities_agent",
      "کارشناس پشتیبانی و تأسیسات",
      "agent",
      "درخواست‌های پشتیبانی و تأسیسات گروه‌های خود",
      { facilities: RW("group", "group"), work: RW("group", "group"), asset: R(), knowledge: RW("all", "own"), org: R(), users: R() },
      { contains: ["requester"], field_groups: ["internal", "personal"] },
    ),
    role(
      "vendor_agent",
      "کارشناس پیمانکار",
      "agent",
      "کاربر بیرونی: فقط رکوردهای ارجاع‌شده به گروه‌های خود را می‌بیند و تغییر می‌دهد",
      {
        incident: { read: "group", write: "group" },
        request: { read: "group", write: "group" },
        change: { read: "group", write: "group" },
        problem: { read: "group", write: "group" },
        work: { read: "group", write: "group" },
      },
    ),
    role(
      "auditor",
      "ممیز",
      "agent",
      "دیدن همهٔ رکوردها بدون هیچ تغییری؛ بدون فیلدهای منابع انسانی و امنیتی",
      { "*": R() },
      { field_groups: ["admin", "financial", "internal", "personal"], workspaces: "all", domains: "all" },
    ),
    role(
      "tenant_admin",
      "مدیر سامانه",
      "admin",
      "همهٔ کارها در همهٔ حوزه‌ها، از جمله ساختار سازمانی، نقش‌ها و تنظیمات؛ فیلدهای منابع انسانی و امنیتی و فضاهای کاری امن فقط با نقش جداگانه",
      { "*": FULL },
      { field_groups: ["admin", "ai_private", "financial", "internal", "personal"], workspaces: "all", domains: "all" },
    ),
  ];
}

export const BUILTIN_KEYS = builtinRoles().map((r) => r.key);
export const isBuiltinRole = (key: string) => BUILTIN_KEYS.includes(key);

/** Starting points for a new member («پیش‌تنظیم دسترسی» when inviting): a persona and its roles. */
export interface PersonaPreset {
  key: string;
  label: string;
  persona: Persona;
  roles: string[];
}

export const PERSONA_PRESETS: PersonaPreset[] = [
  { key: "requester", label: "درخواست‌دهنده", persona: "requester", roles: ["requester"] },
  { key: "agent", label: "کارشناس پشتیبانی", persona: "agent", roles: ["agent"] },
  { key: "team_lead", label: "سرپرست گروه", persona: "agent", roles: ["team_lead"] },
  { key: "service_desk_manager", label: "مدیر میز خدمت", persona: "agent", roles: ["service_desk_manager"] },
  { key: "hr_agent", label: "کارشناس منابع انسانی", persona: "agent", roles: ["hr_agent"] },
  { key: "facilities_agent", label: "کارشناس پشتیبانی و تأسیسات", persona: "agent", roles: ["facilities_agent"] },
  { key: "vendor_agent", label: "کارشناس پیمانکار", persona: "agent", roles: ["vendor_agent"] },
  { key: "auditor", label: "ممیز", persona: "agent", roles: ["auditor"] },
  { key: "tenant_admin", label: "مدیر سامانه", persona: "admin", roles: ["tenant_admin"] },
];

/** The organisation's role catalogue: the built-ins under its preset, replaced or extended by its own rows. */
export function roleCatalog(own: RoleDef[], preset: DeskPreset = "open"): Map<string, RoleDef> {
  const out = new Map<string, RoleDef>(builtinRoles(preset).map((r) => [r.key, r]));
  for (const r of own) out.set(r.key, r);
  return out;
}
