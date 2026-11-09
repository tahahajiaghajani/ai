// Pure logic of security operations, vulnerability response and GRC (docs/modules/security_FA.md), shared by the
// server (hooks, services, jobs) and the screens: the security incident's risk score and phase stamps, observables
// (type detection, normalisation, extraction from text), vulnerability risk scoring with its explanation and the
// remediation target from first detection, regulatory deadlines, the risk matrix (scores, ratings, residual,
// appetite, annual loss expectancy), requirement and framework compliance, CSF profile gaps, the continuous-
// monitoring indicators, data classification and the KPI arithmetic (MTTD, MTTC, MTTR, rates).
// Numbers that are stored are exact (decimal strings); nothing here reads a database or a clock it was not given.
// Imported by the UI: keep it free of server imports.
import Decimal from "decimal.js";
import type { RegimeStage } from "./frameworks";

// ---------------------------------------------------------------------------------------------------------------
// Data classification (SEC-053)

export const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASSIFICATION_LABELS: Record<Classification, string> = { public: "عمومی", internal: "داخلی", confidential: "محرمانه", restricted: "سری" };

/** Rank of a classification (0 public … 3 restricted); unknown values count as internal. */
export const classRank = (c: unknown): number => {
  const i = CLASSIFICATIONS.indexOf(String(c ?? "") as Classification);
  return i < 0 ? 1 : i;
};

/** May a record of this classification reach a model, given the organisation's ceiling? «سری» never does. */
export function aiAllowed(classification: unknown, ceiling: unknown = "confidential"): boolean {
  if (String(classification ?? "") === "restricted") return false;
  return classRank(classification) <= Math.min(2, classRank(ceiling));
}

// ---------------------------------------------------------------------------------------------------------------
// Security incidents (SEC-001)

export const SEVERITY_WEIGHT: Record<string, number> = { "1": 1, "2": 0.75, "3": 0.5, "4": 0.25 };
export const IMPACT_WEIGHT: Record<string, number> = { "1": 1, "2": 0.75, "3": 0.5, "4": 0.25 };
const DATA_WEIGHT: Record<string, number> = { restricted: 1, confidential: 0.75, internal: 0.4, public: 0.1 };

export interface SirWeights {
  severity: number;
  impact: number;
  data: number;
  personal: number;
}
export const DEFAULT_SIR_WEIGHTS: SirWeights = { severity: 40, impact: 30, data: 20, personal: 10 };

/**
 * The security incident's risk score (0–100): severity, business impact, the classification of the data involved and
 * a personal-data breach, each weighted by the organisation's calculator (weights in percent, normalised to 100).
 */
export function sirRiskScore(row: { severity?: unknown; business_impact?: unknown; classification?: unknown; personal_data_breach?: unknown }, weights: Partial<SirWeights> = {}): number {
  const w = { ...DEFAULT_SIR_WEIGHTS, ...weights };
  const total = Math.max(1, Number(w.severity) + Number(w.impact) + Number(w.data) + Number(w.personal));
  const sev = SEVERITY_WEIGHT[String(row.severity ?? "")] ?? 0.5;
  const imp = IMPACT_WEIGHT[String(row.business_impact ?? "")] ?? 0.5;
  const data = DATA_WEIGHT[String(row.classification ?? "")] ?? 0.4;
  const pdb = row.personal_data_breach === true ? 1 : 0;
  const v = (sev * w.severity + imp * w.impact + data * w.data + pdb * w.personal) / total;
  return Math.max(0, Math.min(100, Math.round(v * 100)));
}

/** Priority (1–5) of a risk score: the SLA definitions of security incidents key on it. */
export function sirPriority(score: number): string {
  return score >= 80 ? "1" : score >= 60 ? "2" : score >= 40 ? "3" : score >= 20 ? "4" : "5";
}

/** The NIST phases of the state model in order (draft is before, review and closed after). */
export const SIR_PHASES = ["draft", "analysis", "contain", "eradicate", "recover", "review", "closed"] as const;
const PHASE_INDEX = new Map<string, number>(SIR_PHASES.map((s, i) => [s, i]));

/**
 * Stamps a move through the phases sets when they are still empty: leaving «مهار» means contained, leaving
 * «ریشه‌کنی» eradicated, leaving «بازیابی» recovered (a jump stamps every phase it passes); `detected_at` defaults to
 * when the record was opened.
 */
export function phaseStamps(prevState: string | null, nextState: string, row: Record<string, unknown>, now: string): Record<string, string> {
  const out: Record<string, string> = {};
  const to = PHASE_INDEX.get(nextState);
  if (to === undefined) return out;
  const from = prevState ? (PHASE_INDEX.get(prevState) ?? 0) : 0;
  if (to <= from && prevState) return out;
  const passed = (phase: string) => to > (PHASE_INDEX.get(phase) ?? 99);
  if (passed("contain") && !row.contained_at) out.contained_at = now;
  if (passed("eradicate") && !row.eradicated_at) out.eradicated_at = now;
  if (passed("recover") && !row.recovered_at) out.recovered_at = now;
  return out;
}

/** Seconds between two instants, or null (missing, unparsable or negative). */
export function secondsBetween(from: unknown, to: unknown): number | null {
  const a = Date.parse(String(from ?? ""));
  const b = Date.parse(String(to ?? ""));
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 1000);
}

/** Mean of the non-null values (null when there are none). */
export function mean(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
}

/** MTTD, MTTC and MTTR (seconds) of security incidents (SEC KPIs). */
export function sirTimes(rows: { first_malicious_at?: unknown; detected_at?: unknown; contained_at?: unknown; recovered_at?: unknown }[]) {
  return {
    mttd: mean(rows.map((r) => secondsBetween(r.first_malicious_at, r.detected_at))),
    mttc: mean(rows.map((r) => secondsBetween(r.detected_at, r.contained_at))),
    mttr: mean(rows.map((r) => secondsBetween(r.detected_at, r.recovered_at))),
  };
}

/** A share as a percentage with one decimal (null when there is nothing to divide). */
export const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ---------------------------------------------------------------------------------------------------------------
// Observables (SEC-003)

export const OBSERVABLE_TYPES = ["ipv4", "ipv6", "domain", "url", "email", "md5", "sha1", "sha256", "filename", "hostname", "account", "other"] as const;
export type ObservableType = (typeof OBSERVABLE_TYPES)[number];

/** «hxxp://evil[.]com» → «http://evil.com» (defanged indicators as analysts paste them). */
export function refang(v: string): string {
  return v
    .trim()
    .replace(/^hxxp/i, "http")
    .replace(/\[\.\]|\(\.\)|\{\.\}/g, ".")
    .replace(/\[:\]/g, ":")
    .replace(/\[@\]|\(at\)|\[at\]/gi, "@");
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The type a value most likely is. */
export function detectObservableType(raw: string): ObservableType {
  const v = refang(raw);
  if (IPV4.test(v)) return "ipv4";
  if (v.includes(":") && IPV6.test(v) && v.split(":").length > 2) return "ipv6";
  if (/^https?:\/\//i.test(v)) return "url";
  if (EMAIL.test(v)) return "email";
  if (/^[a-f0-9]{64}$/i.test(v)) return "sha256";
  if (/^[a-f0-9]{40}$/i.test(v)) return "sha1";
  if (/^[a-f0-9]{32}$/i.test(v)) return "md5";
  if (DOMAIN.test(v)) return /\.(exe|dll|js|vbs|ps1|bat|docm|xlsm|zip|rar|iso|lnk|scr|hta)$/i.test(v) ? "filename" : "domain";
  if (/\.[a-z0-9]{2,4}$/i.test(v) && !/\s/.test(v)) return "filename";
  return "other";
}

/** The key observables are de-duplicated on: refanged, lower-cased where case does not matter, URLs without fragments. */
export function normalizeObservable(type: string, raw: string): string {
  const v = refang(String(raw ?? ""));
  switch (type) {
    case "domain":
    case "hostname":
      return v.toLowerCase().replace(/\.$/, "");
    case "email":
    case "md5":
    case "sha1":
    case "sha256":
    case "ipv6":
    case "account":
      return v.toLowerCase();
    case "url": {
      try {
        const u = new URL(v);
        u.hash = "";
        u.hostname = u.hostname.toLowerCase();
        return u.toString();
      } catch {
        return v;
      }
    }
    default:
      return v;
  }
}

/** Indicators found in free text (a reported e-mail, an alert): URLs, e-mail addresses, IPs, domains and hashes. */
export function extractObservables(text: string, limit = 100): { type: ObservableType; value: string }[] {
  const src = String(text ?? "").replace(/hxxp/gi, "http").replace(/\[\.\]/g, ".");
  const out = new Map<string, { type: ObservableType; value: string }>();
  const add = (type: ObservableType, value: string) => {
    const key = `${type}:${normalizeObservable(type, value)}`;
    if (!out.has(key) && out.size < limit) out.set(key, { type, value: normalizeObservable(type, value) });
  };
  const urls = src.match(/https?:\/\/[^\s<>"'()]+/gi) ?? [];
  for (const u of urls) add("url", u.replace(/[.,;]+$/, ""));
  const rest = urls.reduce((s, u) => s.split(u).join(" "), src);
  for (const m of rest.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) add("email", m);
  const noMail = rest.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ");
  for (const m of noMail.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []) if (IPV4.test(m)) add("ipv4", m);
  for (const m of noMail.match(/\b[a-f0-9]{64}\b/gi) ?? []) add("sha256", m);
  for (const m of noMail.match(/\b[a-f0-9]{40}\b/gi) ?? []) add("sha1", m);
  for (const m of noMail.match(/\b[a-f0-9]{32}\b/gi) ?? []) add("md5", m);
  for (const m of noMail.match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi) ?? []) {
    if (IPV4.test(m) || /^\d+(\.\d+)+$/.test(m)) continue;
    const t = detectObservableType(m);
    if (t === "domain") add("domain", m);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------------------
// Vulnerability risk (SEC-015, SEC-016, SEC-018)

export const VULN_RATINGS = ["critical", "high", "medium", "low"] as const;
export type VulnRating = (typeof VULN_RATINGS)[number];
export const VULN_RATING_LABELS: Record<VulnRating, string> = { critical: "بحرانی", high: "بالا", medium: "متوسط", low: "کم" };

/** CVSS base score → qualitative severity (CVSS v3/v4 bands). */
export function cvssSeverity(score: unknown): VulnRating | "none" {
  const s = Number(score);
  if (!Number.isFinite(s) || s <= 0) return "none";
  return s >= 9 ? "critical" : s >= 7 ? "high" : s >= 4 ? "medium" : "low";
}

/** A scanner's own 0–4/1–5 severity → CVSS-like score when the finding carries none. */
export function severityToCvss(sev: unknown): number | null {
  const s = String(sev ?? "").trim().toLowerCase();
  const map: Record<string, number> = { critical: 9.5, urgent: 9.5, high: 7.5, serious: 7.5, medium: 5.5, moderate: 5.5, low: 3, info: 0, informational: 0, log: 0, none: 0, "4": 9.5, "3": 7.5, "2": 5.5, "1": 3, "0": 0, "5": 9.5 };
  return s in map ? map[s] : null;
}

export interface VulnFactors {
  cvss: number | null;
  epss: number | null;
  kev: boolean;
  /** the CI's criticality «1» (vital) … «4» (low) */
  criticality: string | null;
  exposure: string | null;
  compensating: string | null;
}

export interface VulnRisk {
  score: number;
  rating: VulnRating;
  factors: { key: string; label: string; value: string; weight: number }[];
}

const CRIT_W: Record<string, number> = { "1": 1.2, "2": 1.1, "3": 1, "4": 0.85 };
const EXPO_W: Record<string, number> = { internet: 1.2, internal: 1, isolated: 0.7 };
const COMP_W: Record<string, number> = { none: 0, partial: 0.25, strong: 0.5 };

/**
 * Risk-based priority (SEC-016): CVSS × f(EPSS) × KEV boost × asset criticality × exposure × (1 − compensating
 * control), scaled to 0–100, with the rating that sets the remediation target. A KEV finding is at least «بالا».
 */
export function vulnRisk(f: VulnFactors): VulnRisk {
  const cvss = f.cvss === null || !Number.isFinite(f.cvss) ? 5 : Math.max(0, Math.min(10, f.cvss));
  const epss = f.epss === null || !Number.isFinite(f.epss) ? null : Math.max(0, Math.min(1, f.epss));
  const fe = epss === null ? 0.85 : 0.75 + 0.25 * Math.sqrt(epss);
  const kev = f.kev ? 1.3 : 1;
  const crit = CRIT_W[String(f.criticality ?? "")] ?? 1;
  const expo = EXPO_W[String(f.exposure ?? "")] ?? 1;
  const comp = COMP_W[String(f.compensating ?? "")] ?? 0;
  const raw = cvss * 10 * fe * kev * crit * expo * (1 - comp);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  let rating: VulnRating = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 30 ? "medium" : "low";
  if (f.kev && (rating === "medium" || rating === "low")) rating = "high";
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  return {
    score,
    rating,
    factors: [
      { key: "cvss", label: "امتیاز CVSS", value: f.cvss === null ? "نامعلوم (۵ فرض شد)" : fmt(cvss), weight: cvss * 10 },
      { key: "epss", label: "احتمال بهره‌برداری (EPSS)", value: epss === null ? "نامعلوم" : `${fmt(epss * 100)}٪`, weight: fe },
      { key: "kev", label: "در فهرست KEV", value: f.kev ? "بله" : "خیر", weight: kev },
      { key: "criticality", label: "اهمیت دارایی", value: f.criticality ?? "نامعلوم", weight: crit },
      { key: "exposure", label: "در معرض بودن", value: f.exposure ?? "نامعلوم", weight: expo },
      { key: "compensating", label: "کنترل جبرانی", value: f.compensating ?? "ندارد", weight: 1 - comp },
    ],
  };
}

export interface VulnSlaDays {
  critical: number;
  high: number;
  medium: number;
  low: number;
}
export const DEFAULT_VULN_SLA: VulnSlaDays = { critical: 15, high: 30, medium: 90, low: 180 };

/**
 * The remediation target (SEC-018): first detection + the days of the rating; a KEV due date earlier than that wins.
 * A finding that reappears keeps its first detection, so the clock continues from the original discovery.
 */
export function vulnDueAt(firstDetected: string, rating: VulnRating, days: Partial<VulnSlaDays> = {}, kevDue?: string | null): string {
  const d = { ...DEFAULT_VULN_SLA, ...days }[rating];
  const start = Date.parse(firstDetected);
  const base = (Number.isFinite(start) ? start : Date.now()) + Math.max(0, Number(d) || 0) * 86_400_000;
  const kev = kevDue ? Date.parse(kevDue.length === 10 ? `${kevDue}T23:59:59Z` : kevDue) : NaN;
  return new Date(Number.isFinite(kev) && kev < base ? kev : base).toISOString();
}

/** A simplified SSVC decision (Track, Track*, Attend, Act) from exploitation, exposure and the asset's criticality. */
export function ssvc(f: { kev: boolean; exploit?: string | null; exposure?: string | null; criticality?: string | null }): "track" | "track_star" | "attend" | "act" {
  const exploited = f.kev || f.exploit === "attacked" || f.exploit === "high";
  const poc = f.exploit === "poc" || f.exploit === "functional";
  const exposed = f.exposure === "internet";
  const vital = f.criticality === "1" || f.criticality === "2";
  if (exploited && (exposed || vital)) return "act";
  if (exploited || (poc && exposed && vital)) return "attend";
  if (poc || (exposed && vital)) return "track_star";
  return "track";
}

/** The CVE ids in a text («CVE-2024-3400, cve-2023-4966») upper-cased and unique. */
export function cvesIn(text: unknown): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").match(/CVE-\d{4}-\d{4,7}/gi) ?? []) out.add(m.toUpperCase());
  return [...out];
}

// ---------------------------------------------------------------------------------------------------------------
// Regulatory clocks (SEC-008)

export interface Deadline {
  stage: string;
  label: string;
  due_at: string;
  submitted_at: string | null;
}

/** Calendar-time deadlines from the moment of awareness (submissions already recorded are kept by stage). */
export function regDeadlines(awareAt: string, stages: RegimeStage[], previous: Deadline[] = []): Deadline[] {
  const start = Date.parse(awareAt);
  if (!Number.isFinite(start)) return [];
  const sub = new Map(previous.map((d) => [d.stage, d.submitted_at]));
  return stages
    .filter((s) => s && typeof s.key === "string" && Number(s.hours) > 0)
    .map((s) => ({ stage: s.key, label: String(s.label ?? s.key), due_at: new Date(start + Number(s.hours) * 3_600_000).toISOString(), submitted_at: sub.get(s.key) ?? null }));
}

/** The first stage not yet submitted, whether it is late, and whether every stage is in. */
export function nextDeadline(deadlines: Deadline[], now: number): { next: Deadline | null; overdue: boolean; done: boolean } {
  const open = deadlines.filter((d) => !d.submitted_at).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  const next = open[0] ?? null;
  return { next, overdue: !!next && Date.parse(next.due_at) < now, done: deadlines.length > 0 && !open.length };
}

// ---------------------------------------------------------------------------------------------------------------
// Risk matrix and register (SEC-041 … SEC-045)

export const RISK_RATINGS = ["low", "medium", "high", "critical"] as const;
export type RiskRating = (typeof RISK_RATINGS)[number];

/** Likelihood × impact (each 1–5); null when either is missing. */
export function riskScore(likelihood: unknown, impact: unknown): number | null {
  const l = Number(likelihood);
  const i = Number(impact);
  if (!Number.isInteger(l) || !Number.isInteger(i) || l < 1 || i < 1 || l > 10 || i > 10) return null;
  return l * i;
}

/** The rating of a cell of the matrix (`cells[l − 1][i − 1]`), or by score bands when the matrix has no such cell. */
export function riskRating(cells: unknown, likelihood: unknown, impact: unknown): RiskRating | null {
  const s = riskScore(likelihood, impact);
  if (s === null) return null;
  const grid = Array.isArray(cells) ? (cells as unknown[][]) : [];
  const v = grid[Number(likelihood) - 1]?.[Number(impact) - 1];
  if (typeof v === "string" && (RISK_RATINGS as readonly string[]).includes(v)) return v as RiskRating;
  return s <= 4 ? "low" : s <= 9 ? "medium" : s <= 14 ? "high" : "critical";
}

/** Residual likelihood and impact suggested from the inherent ones and how well the existing controls work. */
export function suggestedResidual(likelihood: number, impact: number, effectiveness: string | null): { likelihood: number; impact: number } {
  const step = effectiveness === "strong" ? 2 : effectiveness === "moderate" ? 1 : 0;
  return { likelihood: Math.max(1, likelihood - step), impact: Math.max(1, impact - (step === 2 ? 1 : 0)) };
}

/** Is a residual score above the category's appetite (or, without one, «high» and above)? */
export function aboveAppetite(score: number | null, appetite: number | null | undefined, rating?: string | null): boolean {
  if (score === null) return false;
  if (appetite !== null && appetite !== undefined && Number.isFinite(Number(appetite))) return score > Number(appetite);
  return rating === "high" || rating === "critical";
}

/** Annual loss expectancy = single loss expectancy × annual rate of occurrence (exact decimals). */
export function annualLoss(sle: unknown, aro: unknown): string | null {
  try {
    if (sle === null || sle === undefined || sle === "" || aro === null || aro === undefined || aro === "") return null;
    return new Decimal(String(sle)).mul(new Decimal(String(aro))).toDecimalPlaces(2).toString();
  } catch {
    return null;
  }
}

/** Heat-map cells: how many risks sit on each likelihood × impact (1–5 × 1–5). */
export function heatMap(rows: { likelihood: unknown; impact: unknown }[], size = 5): number[][] {
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  for (const r of rows) {
    const l = Number(r.likelihood);
    const i = Number(r.impact);
    if (Number.isInteger(l) && Number.isInteger(i) && l >= 1 && i >= 1 && l <= size && i <= size) grid[l - 1][i - 1]++;
  }
  return grid;
}

// ---------------------------------------------------------------------------------------------------------------
// Controls, requirements and frameworks (SEC-029, SEC-030, SEC-037, SEC-038, SEC-049)

export type Effectiveness = "not_tested" | "effective" | "partially_effective" | "ineffective";

export interface ControlState {
  implementation_status?: unknown;
  effectiveness?: unknown;
  indicator_status?: unknown;
  active?: unknown;
}

/**
 * A requirement's implementation and compliance from the controls mapped to it: implemented when one live control is
 * implemented; compliant when one implemented control is effective (by test or a passing indicator) and none fails.
 */
export function requirementStatus(applicable: boolean, controls: ControlState[]): { implementation: string; compliance: string } {
  if (!applicable) return { implementation: "not_applicable", compliance: "not_applicable" };
  const live = controls.filter((c) => c.active !== false);
  if (!live.length) return { implementation: "not_implemented", compliance: "not_assessed" };
  const impl = live.filter((c) => c.implementation_status === "implemented");
  const implementation = impl.length ? "implemented" : live.some((c) => c.implementation_status === "partial" || c.implementation_status === "planned") ? "partial" : "not_implemented";
  const effective = (c: ControlState) => c.effectiveness === "effective" || (c.effectiveness !== "ineffective" && c.indicator_status === "pass");
  const failing = (c: ControlState) => c.effectiveness === "ineffective" || c.indicator_status === "fail";
  let compliance: string;
  if (!impl.length) compliance = implementation === "partial" ? "partial" : "non_compliant";
  else if (impl.some(failing)) compliance = "partial";
  else if (impl.some(effective)) compliance = "compliant";
  else if (live.every((c) => (c.effectiveness ?? "not_tested") === "not_tested" && (c.indicator_status ?? "unknown") === "unknown")) compliance = "not_assessed";
  else compliance = "partial";
  return { implementation, compliance };
}

/** Compliance of a framework: implemented-and-effective requirements ÷ applicable ones (SEC KPIs). */
export function frameworkCompliance(reqs: { applicable?: unknown; compliance?: unknown; implementation?: unknown }[]) {
  const applicable = reqs.filter((r) => r.applicable !== false);
  const compliant = applicable.filter((r) => r.compliance === "compliant").length;
  const implemented = applicable.filter((r) => r.implementation === "implemented").length;
  return { total: reqs.length, applicable: applicable.length, compliant, implemented, percent: percent(compliant, applicable.length), implemented_percent: percent(implemented, applicable.length) };
}

/** The effectiveness a completed control test sets. */
export function testEffectiveness(conclusion: unknown): Effectiveness {
  return conclusion === "effective" ? "effective" : conclusion === "partially_effective" ? "partially_effective" : conclusion === "ineffective" ? "ineffective" : "not_tested";
}

/** Days between control tests by frequency (continuous controls are still tested yearly by people). */
export const FREQUENCY_DAYS: Record<string, number> = { continuous: 365, daily: 1, weekly: 7, monthly: 30, quarterly: 91, semiannual: 182, annual: 365 };

/** The next test of a control after its last one (or now, when it was never tested). */
export function nextTestDue(lastTested: string | null | undefined, frequency: unknown, from: number): string {
  const days = FREQUENCY_DAYS[String(frequency ?? "")] ?? 365;
  const last = lastTested ? Date.parse(lastTested) : NaN;
  const base = Number.isFinite(last) ? last : from;
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** CSF profile gap: Σ(target − current tier) over the categories that have both, with the worst categories first. */
export function csfGap(items: Record<string, { current?: unknown; target?: unknown }> | null | undefined) {
  const rows = Object.entries(items ?? {})
    .map(([code, v]) => ({ code, current: Number(v?.current), target: Number(v?.target) }))
    .filter((r) => Number.isFinite(r.current) && Number.isFinite(r.target));
  const gaps = rows.map((r) => ({ ...r, gap: Math.max(0, r.target - r.current) })).sort((a, b) => b.gap - a.gap || a.code.localeCompare(b.code));
  return { total: gaps.reduce((s, r) => s + r.gap, 0), scored: rows.length, worst: gaps.filter((g) => g.gap > 0).slice(0, 5) };
}

// ---------------------------------------------------------------------------------------------------------------
// Continuous control monitoring indicators (SEC-038, SEC-045)

export interface IndicatorDef {
  key: string;
  label: string;
  unit: "percent" | "count";
  /** higher_better: pass when value ≥ threshold; lower_better: pass when value ≤ threshold */
  direction: "higher_better" | "lower_better";
  threshold: number;
  description: string;
}

export const INDICATORS: IndicatorDef[] = [
  { key: "vuln_sla", label: "رفع آسیب‌پذیری در موعد (٪)", unit: "percent", direction: "higher_better", threshold: 90, description: "آسیب‌پذیری‌های رفع‌شده در ۹۰ روز گذشته که پیش از موعد رفع شدند" },
  { key: "kev_overdue", label: "آسیب‌پذیری‌های KEV گذشته از موعد", unit: "count", direction: "lower_better", threshold: 0, description: "موردهای باز فهرست KEV که موعدشان گذشته است" },
  { key: "critical_open_overdue", label: "آسیب‌پذیری بحرانی گذشته از موعد", unit: "count", direction: "lower_better", threshold: 0, description: "موردهای باز بحرانی که موعدشان گذشته است" },
  { key: "change_approved", label: "تغییرهای اجراشده با مجوز (٪)", unit: "percent", direction: "higher_better", threshold: 95, description: "تغییرهای ۹۰ روز گذشته که پیش از اجرا تأیید شدند" },
  { key: "policy_ack", label: "نرخ پذیرش خط‌مشی‌ها (٪)", unit: "percent", direction: "higher_better", threshold: 90, description: "تأییدهای مطالعه ÷ مخاطبان کارزارهای در جریان" },
  { key: "sir_contained", label: "مهار رخداد امنیتی در موعد (٪)", unit: "percent", direction: "higher_better", threshold: 90, description: "رخدادهای امنیتی ۹۰ روز گذشته که در موعد مهار شدند" },
  { key: "sir_lessons", label: "رخدادهای بسته با درس‌آموخته (٪)", unit: "percent", direction: "higher_better", threshold: 80, description: "رخدادهای امنیتی بسته‌شدهٔ ۹۰ روز گذشته که درس‌آموخته دارند" },
  { key: "risk_reviewed", label: "ریسک‌های بازنگری‌شده در شش ماه (٪)", unit: "percent", direction: "higher_better", threshold: 80, description: "ریسک‌های باز که در شش ماه گذشته بازنگری شده‌اند" },
  { key: "risk_above_appetite", label: "ریسک‌های بالاتر از اشتها", unit: "count", direction: "lower_better", threshold: 0, description: "ریسک‌های بازی که ریسک باقی‌ماندهٔ آن‌ها از اشتهای دسته بیشتر است" },
  { key: "controls_tested", label: "کنترل‌های آزموده در شش ماه (٪)", unit: "percent", direction: "higher_better", threshold: 80, description: "کنترل‌های فعالی که در شش ماه گذشته آزموده شده‌اند" },
  { key: "exceptions_expired", label: "استثناهای منقضی‌شدهٔ باز", unit: "count", direction: "lower_better", threshold: 0, description: "استثناهای آسیب‌پذیری و خط‌مشی که موعدشان گذشته و هنوز باز مانده‌اند" },
  { key: "findings_overdue", label: "یافته‌های ممیزی گذشته از موعد", unit: "count", direction: "lower_better", threshold: 0, description: "یافته‌های باز ممیزی که موعد اقدامشان گذشته است" },
];

export const indicatorDef = (key: unknown) => INDICATORS.find((i) => i.key === key) ?? null;

/** pass / fail of a measured value against a threshold (unknown without a value). */
export function indicatorStatus(value: number | null, threshold: unknown, direction: IndicatorDef["direction"]): "pass" | "fail" | "unknown" {
  if (value === null || !Number.isFinite(value)) return "unknown";
  const t = Number(threshold);
  if (!Number.isFinite(t)) return "unknown";
  return direction === "higher_better" ? (value >= t ? "pass" : "fail") : value <= t ? "pass" : "fail";
}

/** A KRI's status with a warning and a breach threshold (higher_worse: larger values are worse). */
export function kriStatus(value: number | null, warn: unknown, breach: unknown, direction: "higher_worse" | "lower_worse" = "higher_worse"): "ok" | "warn" | "breach" | "unknown" {
  if (value === null || !Number.isFinite(value)) return "unknown";
  const w = Number(warn);
  const b = Number(breach);
  const worse = (x: number, t: number) => (direction === "higher_worse" ? x >= t : x <= t);
  if (Number.isFinite(b) && worse(value, b)) return "breach";
  if (Number.isFinite(w) && worse(value, w)) return "warn";
  return "ok";
}

// ---------------------------------------------------------------------------------------------------------------
// Security review triggers on changes (SEC-065): deterministic flags the AI layer may refine.

const REVIEW_TERMS: { key: string; label: string; re: RegExp }[] = [
  { key: "secrets", label: "رمز، کلید یا گواهی", re: /(password|secret|api[ _-]?key|token|certificate|private key|گذرواژه|رمز عبور|کلید|گواهی)/i },
  { key: "identity", label: "هویت و دسترسی", re: /(firewall|vpn|ldap|active directory|\bad\b|sso|mfa|iam|privilege|admin|دیواره|فایروال|دسترسی|احراز هویت|مجوز دسترسی)/i },
  { key: "pii", label: "دادهٔ شخصی", re: /(personal data|pii|national id|customer data|کد ملی|اطلاعات شخصی|دادهٔ مشتری|داده‌های مشتری)/i },
  { key: "exposure", label: "در معرض اینترنت", re: /(internet[- ]facing|public|dmz|expose|port forward|اینترنت|عمومی)/i },
  { key: "crypto", label: "رمزنگاری", re: /(tls|ssl|encrypt|cipher|رمزنگاری)/i },
];

/** Security-relevant themes in a change's text (title, description, plans). */
export function securityFlags(text: string): { key: string; label: string }[] {
  const t = String(text ?? "");
  return REVIEW_TERMS.filter((x) => x.re.test(t)).map(({ key, label }) => ({ key, label }));
}
