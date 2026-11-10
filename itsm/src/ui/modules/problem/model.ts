// Pure logic of the problem screens (tests/problem-ui.test.ts): the queues and the RCA canvas editing operations —
// immutable updates of the five whys, the fishbone, the timeline, hypotheses and «is / is not».
import type { Cond } from "@shared/model/conditions";
import { cleanRca, type Hypothesis, type IsIsNot, type RcaCanvas, type Why } from "@shared/problem/logic";

export interface ProblemQueue {
  key: string;
  path: string;
  label: string;
  table: string;
  filter: Cond;
  sort: string;
  columns: string[];
  emptyText: string;
}

const OPEN: Cond = { f: "active", op: "eq", v: true };

export const PROBLEM_QUEUES: ProblemQueue[] = [
  {
    key: "mine", path: "problems/mine", label: "مشکلات من", table: "problem",
    filter: { and: [OPEN, { or: [{ f: "assigned_to", op: "is_me" }, { f: "manager_id", op: "is_me" }] }] }, sort: "priority,-risk_score",
    columns: ["number", "short_description", "state", "priority", "risk_score", "incident_count", "updated_at"], emptyText: "مشکل بازی به شما سپرده نشده است",
  },
  {
    key: "triage", path: "problems/triage", label: "در انتظار ارزیابی", table: "problem",
    filter: { f: "state", op: "in", v: ["new", "assess"] }, sort: "-risk_score,opened_at",
    columns: ["number", "short_description", "source", "priority", "incident_count", "opened_at"], emptyText: "مشکل تازه‌ای برای ارزیابی نیست",
  },
  {
    key: "monitoring", path: "problems/monitoring", label: "در پایش پس از رفع", table: "problem",
    filter: { f: "state", op: "eq", v: "resolved" }, sort: "monitoring_until",
    columns: ["number", "short_description", "fix_at", "monitoring_until", "incident_count"], emptyText: "مشکلی در پایش نیست",
  },
];

// ---------------------------------------------------------------------------------------------------------------
// RCA canvas operations (each returns a new canvas)

export const rcaOf = (raw: unknown): RcaCanvas => cleanRca(raw);

export function addWhy(c: RcaCanvas, previousAnswer?: string): RcaCanvas {
  const last = c.whys[c.whys.length - 1];
  const question = previousAnswer ?? (last?.answer ? `چرا ${last.answer}؟` : "چرا؟");
  return { ...c, whys: [...c.whys, { question, answer: "" }] };
}

export function setWhy(c: RcaCanvas, i: number, patch: Partial<Why>): RcaCanvas {
  return { ...c, whys: c.whys.map((w, j) => (j === i ? { ...w, ...patch } : w)) };
}

export function removeAt<K extends "whys" | "timeline" | "hypotheses">(c: RcaCanvas, key: K, i: number): RcaCanvas {
  return { ...c, [key]: (c[key] as unknown[]).filter((_, j) => j !== i) } as RcaCanvas;
}

export function addCause(c: RcaCanvas, bone: string, text: string): RcaCanvas {
  const t = text.trim();
  if (!t) return c;
  const list = c.fishbone[bone] ?? [];
  if (list.includes(t)) return c;
  return { ...c, fishbone: { ...c.fishbone, [bone]: [...list, t] } };
}

export function removeCause(c: RcaCanvas, bone: string, i: number): RcaCanvas {
  const list = (c.fishbone[bone] ?? []).filter((_, j) => j !== i);
  const fishbone = { ...c.fishbone };
  if (list.length) fishbone[bone] = list;
  else delete fishbone[bone];
  return { ...c, fishbone };
}

export function addEvent(c: RcaCanvas, at: string, text: string): RcaCanvas {
  if (!text.trim()) return c;
  const timeline = [...c.timeline, { at, text: text.trim() }].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  return { ...c, timeline };
}

let seq = 0;
export function addHypothesis(c: RcaCanvas, text: string): RcaCanvas {
  if (!text.trim()) return c;
  const id = `h${Date.now().toString(36)}${(seq++).toString(36)}`;
  return { ...c, hypotheses: [...c.hypotheses, { id, text: text.trim(), evidence: "", status: "open", confidence: "medium" }] };
}

export function setHypothesis(c: RcaCanvas, id: string, patch: Partial<Hypothesis>): RcaCanvas {
  return { ...c, hypotheses: c.hypotheses.map((h) => (h.id === id ? { ...h, ...patch } : h)) };
}

export function setIsIsNot(c: RcaCanvas, key: keyof IsIsNot, side: "is" | "isnot", text: string): RcaCanvas {
  const cur = c.is_isnot[key] ?? { is: "", isnot: "" };
  return { ...c, is_isnot: { ...c.is_isnot, [key]: { ...cur, [side]: text } } };
}

/** Has the canvas changed against the stored value (both cleaned)? */
export const rcaDirty = (c: RcaCanvas, stored: unknown): boolean => JSON.stringify(cleanRca(c)) !== JSON.stringify(cleanRca(stored));
