// Pure logic of problem management, shared by the server and the screens: the RCA canvas stored on a problem
// (five whys, the fishbone, the timeline, hypotheses with evidence, «is / is not»), the risk score and technical-debt
// index, and the rules that turn recurring incidents into problem candidates. No server or UI imports.
import { words } from "../incident/logic";

// ---------------------------------------------------------------------------------------------------------------
// The RCA canvas (`problem.rca`, JSON)

export const FISHBONE: { key: string; label: string }[] = [
  { key: "people", label: "افراد و مهارت" },
  { key: "process", label: "فرایند و روش" },
  { key: "technology", label: "فناوری و ابزار" },
  { key: "supplier", label: "تأمین‌کننده" },
  { key: "environment", label: "محیط" },
  { key: "measurement", label: "پایش و سنجش" },
];

export const HYPOTHESIS_STATES: { value: Hypothesis["status"]; label: string; color: string }[] = [
  { value: "open", label: "در بررسی", color: "gold" },
  { value: "confirmed", label: "تأیید شد", color: "green" },
  { value: "rejected", label: "رد شد", color: "gray" },
];

export const CONFIDENCE: { value: NonNullable<Hypothesis["confidence"]>; label: string }[] = [
  { value: "low", label: "کم" },
  { value: "medium", label: "متوسط" },
  { value: "high", label: "زیاد" },
];

export const IS_ISNOT_ROWS: { key: keyof IsIsNot; label: string }[] = [
  { key: "what", label: "چه چیزی" },
  { key: "where", label: "کجا" },
  { key: "when", label: "چه زمانی" },
  { key: "extent", label: "چه اندازه" },
];

export interface Why {
  question: string;
  answer: string;
}
export interface Hypothesis {
  id: string;
  text: string;
  evidence?: string;
  status: "open" | "confirmed" | "rejected";
  confidence?: "low" | "medium" | "high";
}
export interface IsIsNot {
  what?: { is: string; isnot: string };
  where?: { is: string; isnot: string };
  when?: { is: string; isnot: string };
  extent?: { is: string; isnot: string };
}
export interface RcaCanvas {
  whys: Why[];
  fishbone: Record<string, string[]>;
  timeline: { at: string; text: string }[];
  hypotheses: Hypothesis[];
  is_isnot: IsIsNot;
  conclusion: string;
}

export const RCA_LIMITS = { whys: 10, causes: 20, timeline: 100, hypotheses: 30, text: 2000 };

const str = (v: unknown, max = RCA_LIMITS.text) => (typeof v === "string" ? v.slice(0, max) : "");

/** An empty canvas. */
export const emptyRca = (): RcaCanvas => ({ whys: [], fishbone: {}, timeline: [], hypotheses: [], is_isnot: {}, conclusion: "" });

/** The canvas of a stored value: unknown keys and malformed items dropped, texts and lists capped. */
export function cleanRca(raw: unknown): RcaCanvas {
  const out = emptyRca();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.whys)) {
    for (const w of r.whys.slice(0, RCA_LIMITS.whys)) {
      if (w && typeof w === "object") out.whys.push({ question: str((w as Why).question, 500), answer: str((w as Why).answer) });
    }
  }
  if (r.fishbone && typeof r.fishbone === "object" && !Array.isArray(r.fishbone)) {
    for (const { key } of FISHBONE) {
      const xs = (r.fishbone as Record<string, unknown>)[key];
      if (Array.isArray(xs)) {
        const causes = xs.filter((x) => typeof x === "string" && x.trim()).map((x) => str(x, 300).trim()).slice(0, RCA_LIMITS.causes);
        if (causes.length) out.fishbone[key] = causes;
      }
    }
  }
  if (Array.isArray(r.timeline)) {
    for (const t of r.timeline.slice(0, RCA_LIMITS.timeline)) {
      if (!t || typeof t !== "object") continue;
      const at = str((t as { at?: unknown }).at, 40);
      const text = str((t as { text?: unknown }).text, 500).trim();
      if (text) out.timeline.push({ at, text });
    }
  }
  if (Array.isArray(r.hypotheses)) {
    for (const h of r.hypotheses.slice(0, RCA_LIMITS.hypotheses)) {
      if (!h || typeof h !== "object") continue;
      const x = h as Record<string, unknown>;
      const text = str(x.text, 500).trim();
      if (!text) continue;
      out.hypotheses.push({
        id: typeof x.id === "string" && x.id ? x.id.slice(0, 40) : `h${out.hypotheses.length + 1}`,
        text,
        evidence: str(x.evidence),
        status: x.status === "confirmed" || x.status === "rejected" ? x.status : "open",
        confidence: x.confidence === "low" || x.confidence === "high" ? x.confidence : "medium",
      });
    }
  }
  if (r.is_isnot && typeof r.is_isnot === "object" && !Array.isArray(r.is_isnot)) {
    for (const { key } of IS_ISNOT_ROWS) {
      const v = (r.is_isnot as Record<string, unknown>)[key];
      if (v && typeof v === "object") {
        const is = str((v as { is?: unknown }).is, 500);
        const isnot = str((v as { isnot?: unknown }).isnot, 500);
        if (is || isnot) out.is_isnot[key] = { is, isnot };
      }
    }
  }
  out.conclusion = str(r.conclusion, 4000);
  return out;
}

/** Why a stored canvas is refused (Persian), or null. Only the shape is checked; `cleanRca` trims the rest. */
export function rcaProblem(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "کارگاه تحلیل علت ساختار درستی ندارد";
  const r = raw as Record<string, unknown>;
  for (const k of ["whys", "timeline", "hypotheses"] as const) if (r[k] !== undefined && !Array.isArray(r[k])) return "کارگاه تحلیل علت ساختار درستی ندارد";
  if (Array.isArray(r.whys) && r.whys.length > RCA_LIMITS.whys) return `«پنج چرا» حداکثر ${RCA_LIMITS.whys} گام دارد`;
  if (Array.isArray(r.hypotheses) && r.hypotheses.length > RCA_LIMITS.hypotheses) return `حداکثر ${RCA_LIMITS.hypotheses} فرضیه`;
  if (Array.isArray(r.timeline) && r.timeline.length > RCA_LIMITS.timeline) return `خط زمانی حداکثر ${RCA_LIMITS.timeline} رویداد دارد`;
  if (JSON.stringify(raw).length > 200_000) return "کارگاه تحلیل علت بیش از اندازه بزرگ است";
  return null;
}

/** The analysis as Markdown (cause notes of the problem, the review, the record's print). */
export function rcaMarkdown(c: RcaCanvas): string {
  const out: string[] = [];
  if (c.whys.length) {
    out.push("**پنج چرا**");
    c.whys.forEach((w, i) => out.push(`${i + 1}. ${w.question || "چرا؟"} — ${w.answer || "…"}`));
  }
  const bones = FISHBONE.filter((b) => (c.fishbone[b.key] ?? []).length);
  if (bones.length) {
    out.push("", "**عوامل (استخوان ماهی)**");
    for (const b of bones) out.push(`- ${b.label}: ${c.fishbone[b.key].join("؛ ")}`);
  }
  const confirmed = c.hypotheses.filter((h) => h.status === "confirmed");
  if (confirmed.length) {
    out.push("", "**فرضیه‌های تأییدشده**");
    for (const h of confirmed) out.push(`- ${h.text}${h.evidence ? ` (شواهد: ${h.evidence})` : ""}`);
  }
  if (c.conclusion.trim()) out.push("", "**نتیجه**", c.conclusion.trim());
  return out.join("\n").trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Risk and technical debt

export interface RiskInput {
  impact?: string | null;
  likelihood?: string | null;
  priority?: string | null;
  incident_count?: number | null;
  active_known_errors?: number | null;
}

/**
 * The problem's rank (0–100): severity (impact) × likelihood, the volume of related incidents (logarithmic), the
 * priority, and whether known errors keep producing workarounds.
 */
export function riskScore(r: RiskInput): number {
  const severity = 4 - clamp(Number(r.impact ?? 3), 1, 3);
  const chance = 4 - clamp(Number(r.likelihood ?? 2), 1, 3);
  const base = severity * chance * 7; // 7 … 63
  const n = Math.max(0, Number(r.incident_count ?? 0));
  const volume = Math.min(20, Math.round(Math.log2(1 + n) * 5));
  const priority = r.priority === "1" ? 10 : r.priority === "2" ? 5 : 0;
  const debt = (r.active_known_errors ?? 0) > 0 ? 7 : 0;
  return Math.min(100, base + volume + priority + debt);
}

/** Technical debt of a problem: its active known errors × the incidents they keep answering (at least 1 each). */
export const techDebt = (activeKnownErrors: number, incidents: number): number => Math.max(0, activeKnownErrors) * Math.max(1, incidents);

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : hi;
}

/** Known-error states in which a workaround is in use (counts towards technical debt). */
export const ACTIVE_KE_STATES = ["published", "fix_scheduled", "vendor", "no_action"];

// ---------------------------------------------------------------------------------------------------------------
// Candidates from recurring incidents (rule-based; the AI layer's clustering adds `ml` candidates later)

export interface CandidateIncident {
  id: string;
  number?: string | null;
  short_description?: string | null;
  opened_at: string;
  priority?: string | null;
  category?: string | null;
  subcategory?: string | null;
  ci_id?: string | null;
  service_id?: string | null;
  reopen_count?: number | null;
  major_state?: string | null;
  problem_id?: string | null;
}

export interface CandidateRules {
  candidate_window_days: number;
  candidate_min_incidents: number;
  candidate_reopen_min: number;
}

export interface CandidateGroup {
  signature: string;
  rule_kind: "recurring_ci" | "recurring_category" | "major_incident" | "reopened";
  title: string;
  incidents: string[];
  incident_count: number;
  first_at: string;
  last_at: string;
  score: number;
  category: string | null;
  ci_id: string | null;
  service_id: string | null;
}

const PRIORITY_WEIGHT: Record<string, number> = { "1": 5, "2": 4, "3": 3, "4": 2, "5": 1 };
const DAY = 86_400_000;

/** size × mean priority weight × √(span in days) × (1 + share reopened), rounded (≤ 9999). */
export function candidateScore(xs: CandidateIncident[]): number {
  if (!xs.length) return 0;
  const weight = xs.reduce((s, x) => s + (PRIORITY_WEIGHT[String(x.priority ?? "4")] ?? 2), 0) / xs.length;
  const times = xs.map((x) => Date.parse(x.opened_at)).filter((t) => !Number.isNaN(t));
  const span = times.length ? Math.max(1, (Math.max(...times) - Math.min(...times)) / DAY) : 1;
  const reopened = xs.filter((x) => Number(x.reopen_count ?? 0) > 0).length / xs.length;
  return Math.min(9999, Math.round(xs.length * weight * Math.sqrt(span) * (1 + reopened)));
}

/** A short Persian title of a group: the most common words of its titles, else the latest title. */
function groupTitle(xs: CandidateIncident[], what: string): string {
  const counts = new Map<string, number>();
  for (const x of xs) for (const w of new Set(words(x.short_description))) counts.set(w, (counts.get(w) ?? 0) + 1);
  const common = [...counts.entries()].filter(([, n]) => n >= Math.max(2, Math.ceil(xs.length / 2))).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
  const latest = [...xs].sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at))[0];
  const head = common.length ? common.join(" ") : String(latest?.short_description ?? "").slice(0, 80);
  return `${xs.length} رخداد ${what}: ${head}`.slice(0, 200);
}

/**
 * Groups of incidents the rules turn into candidates, strongest first. Only incidents of the window that are not
 * linked to a problem count. Rules: the same configuration item (≥ min), the same subcategory or else category
 * (≥ min, incidents already in a CI group left out), every declared major incident, and incidents reopened at least
 * `candidate_reopen_min` times.
 */
export function candidateGroups(all: CandidateIncident[], rules: CandidateRules, now = Date.now()): CandidateGroup[] {
  const from = now - Math.max(1, rules.candidate_window_days) * DAY;
  const xs = all.filter((x) => !x.problem_id && Date.parse(x.opened_at) >= from);
  const min = Math.max(2, rules.candidate_min_incidents);
  const out: CandidateGroup[] = [];
  const group = (signature: string, rule_kind: CandidateGroup["rule_kind"], ys: CandidateIncident[], what: string) => {
    const times = ys.map((y) => y.opened_at).sort();
    out.push({
      signature,
      rule_kind,
      title: groupTitle(ys, what),
      incidents: ys.map((y) => y.id),
      incident_count: ys.length,
      first_at: times[0],
      last_at: times[times.length - 1],
      score: candidateScore(ys),
      category: ys[0].category ?? null,
      ci_id: rule_kind === "recurring_ci" ? (ys[0].ci_id ?? null) : null,
      service_id: ys.every((y) => y.service_id && y.service_id === ys[0].service_id) ? (ys[0].service_id ?? null) : null,
    });
  };
  const byCi = new Map<string, CandidateIncident[]>();
  for (const x of xs) if (x.ci_id) byCi.set(x.ci_id, [...(byCi.get(x.ci_id) ?? []), x]);
  const inCi = new Set<string>();
  for (const [ci, ys] of byCi) {
    if (ys.length < min) continue;
    group(`ci:${ci}`, "recurring_ci", ys, "روی یک پیکربندی");
    for (const y of ys) inCi.add(y.id);
  }
  const byCat = new Map<string, CandidateIncident[]>();
  for (const x of xs) {
    if (inCi.has(x.id)) continue;
    const key = x.subcategory || x.category;
    if (key && key !== "other" && key !== "other.general") byCat.set(key, [...(byCat.get(key) ?? []), x]);
  }
  for (const [cat, ys] of byCat) if (ys.length >= min) group(`cat:${cat}`, "recurring_category", ys, "در یک دسته");
  for (const x of xs) if (x.major_state && ["accepted", "resolved", "pir_done"].includes(x.major_state)) group(`mi:${x.id}`, "major_incident", [x], "عمده");
  if (rules.candidate_reopen_min > 0) {
    for (const x of xs) if (Number(x.reopen_count ?? 0) >= rules.candidate_reopen_min) group(`reopen:${x.id}`, "reopened", [x], "با بازگشایی‌های پیاپی");
  }
  return out.sort((a, b) => b.score - a.score || (a.signature < b.signature ? -1 : 1));
}
