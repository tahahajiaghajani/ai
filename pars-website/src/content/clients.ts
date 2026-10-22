/**
 * The "most important clients" page of the company profile, with what Pars did for each.
 * Engagements are derived from the verified track record (records.ts), so the two never disagree.
 */
import { CONSULTING, SOFTWARE, TRAINING } from "@/content/records";

type T = { fa: string; en: string };
const o = (fa: string, en: string): T => ({ fa, en });

export type KeyClient = {
  key: string;
  name: T;
  sector: T;
  /** official logo in /public/clients */
  logo: string;
  /** organization names as written in records.ts */
  match: string[];
};

export const KEY_CLIENTS: KeyClient[] = [
  { key: "mellat", name: o("بانک ملت", "Bank Mellat"), sector: o("بانک", "Bank"), logo: "/clients/mellat.svg", match: ["بانک ملت", "بانک ملت (بر اساس استاندارد PMBOK)"] },
  { key: "tejarat", name: o("بانک تجارت", "Bank Tejarat"), sector: o("بانک", "Bank"), logo: "/clients/tejarat.svg", match: ["بانک تجارت"] },
  { key: "melli", name: o("بانک ملی ایران", "Bank Melli Iran"), sector: o("بانک", "Bank"), logo: "/clients/melli.svg", match: ["بانک ملی ایران"] },
  { key: "refah", name: o("بانک رفاه کارگران", "Refah Kargaran Bank"), sector: o("بانک", "Bank"), logo: "/clients/refah.svg", match: ["بانک رفاه کارگران"] },
  { key: "sepah", name: o("بانک سپه", "Bank Sepah"), sector: o("بانک", "Bank"), logo: "/clients/sepah.svg", match: ["بانک سپه"] },
  { key: "postbank", name: o("پست بانک ایران", "Post Bank of Iran"), sector: o("بانک", "Bank"), logo: "/clients/postbank.svg", match: ["پست بانک"] },
  { key: "ayandeh", name: o("بانک آینده", "Ayandeh Bank"), sector: o("بانک", "Bank"), logo: "/clients/ayandeh.svg", match: ["بانک آینده"] },
  { key: "igmc", name: o("شرکت مدیریت شبکه برق ایران", "Iran Grid Management Co."), sector: o("صنعت برق", "Power grid"), logo: "/clients/igmc.svg", match: ["شرکت مدیریت شبکه برق ایران", "مدیریت شبکه برق ایران"] },
  {
    key: "rajaee",
    name: o("قرارگاه خاتم‌الانبیاء — گروه تخصصی شهید رجائی", "Khatam al-Anbiya HQ — Shahid Rajaei Group"),
    sector: o("عمرانی، نفت و گاز", "Construction, oil & gas"),
    logo: "/clients/rajaee.svg",
    match: ["قرارگاه خاتم‌الانبیاء – گروه تخصصی شهید رجائی"],
  },
];

/** Short training labels for the course groups in records.ts (same order). */
const COURSE: T[] = [o("PMBOK", "PMBOK"), o("MSP", "MSP"), o("Primavera P6", "Primavera P6"), o("برنامه‌ریزی و کنترل", "Planning & control"), o("دانشگاه", "University")];

export type Engagements = {
  software: T[];
  consulting: T[];
  /** course group label and the number of courses (when the profile gives it) */
  training: { label: T; count?: number }[];
};

export function engagements(c: KeyClient): Engagements {
  const hit = (org: T) => c.match.includes(org.fa);
  return {
    software: SOFTWARE.filter((r) => hit(r.org)).flatMap((r) => r.detail ?? []),
    consulting: CONSULTING.filter((g) => g.items.some((r) => hit(r.org))).map((g) => g.title),
    training: TRAINING.flatMap((g, i) => g.items.filter((r) => hit(r.org)).map((r) => ({ label: COURSE[i] ?? g.title, count: r.count }))),
  };
}
