// The calls of the person's «گردش‌کارها» (design F §5, §8.6; package F7), over F4c's routes — one call per page:
//   · GET /process/inbox            «کارتابل»: my open steps and my pending record approvals, the chips, the counts
//   · GET /process/inbox/count      the nav count and the home card
//   · GET /process/done             «انجام‌شده‌ها»
//   · GET /process/mine             «گردش‌کارهای من» and the start menu (rows with can_start)
//   · GET /process/defs/:key/view   a process's diagram with my steps, my queues and the start form
//   · GET /process/cases            «پرونده‌ها» (filters below; someone who reads no case gets an empty list)
//   · GET /process/cases/:id        one case: diagram, values, my steps, what I may do, history
//   · GET /process/cases/:id/print  the printable view's data (already in words)
//   · POST /process/start, POST /process/tasks/:id/submit — JSON, or multipart (`payload` + `files`, a value
//     `{ upload: n }` names the n-th file) when files go with it
//   · POST|DELETE /process/tasks/:id/claim, POST /process/cases/:id/{reassign,pause,resume,cancel,resume-from}
// Drafts have no /process route: they are `process_draft` rows of the record API (own rows only, never synchronised),
// one per step or per start. The conversation is the case's journal (comments).
// The response types are F4c's (src/server/modules/process/api/{inbox,cases,actions}.ts, engine/service.ts), copied
// here: the UI imports no server code.
import type { NodeStatusView, ProcessGraph, StepOutcome } from "@shared/process";
import type { Right } from "@shared/forms/layout";
import type { FormsSnapshot } from "@shared/forms/snapshot";
import type { FieldDef } from "@shared/model/types";
import { addUnits, zonedMidnight } from "@shared/model/jalali-buckets";
import { DEFAULT_TIMEZONE } from "@shared/constants";
import { ApiError, type OrgApi } from "../../../lib/api";
import { recordsApi } from "../../../records/data/api";
import type { DisplayMap, JournalEntry } from "../../../records/model/types";

// ---------------------------------------------------------------------------------------------------------------
// «کارتابل»

export interface InboxRow {
  kind: "process_step" | "record_approval";
  id: string;
  /** process_step: the case; record_approval: null */
  case_id: string | null;
  table: string | null;
  record_id: string | null;
  number: string | null;
  title: string | null;
  /** the process's name, or the table's label */
  source: string;
  process_id: string | null;
  step: string;
  action: string;
  /** who it comes from (a member id: `display` names them) */
  from: string | null;
  since: string | null;
  due_at: string | null;
  /** «به جانشینی از …» (a member id) */
  on_behalf_of: string | null;
  /** a pool step someone else took («در دست …», a member id) */
  claimed_by: string | null;
  /** my submission waits to be sent («در صف ارسال») */
  queued: boolean;
  /** the case is paused by its managers */
  paused: boolean;
  can_act: boolean;
  /** the app route that opens it: workflows/c/:case/s/:task, or r/:table/:id */
  link: string;
}

export interface InboxChip {
  process_id: string;
  name: string;
  count: number;
}

export interface Inbox {
  rows: InboxRow[];
  chips: InboxChip[];
  counts: { waiting: number; steps: number; approvals: number };
  default_tab: "inbox" | "mine";
  display: Record<string, string>;
}

// ---------------------------------------------------------------------------------------------------------------
// «انجام‌شده‌ها», «گردش‌کارهای من»

export interface DoneRow {
  id: string;
  case_id: string;
  number: string | null;
  title: string | null;
  process: string | null;
  step: string | null;
  action: string;
  outcome: string | null;
  comment: string | null;
  acted_for: string | null;
  closed_at: string | null;
  link: string;
}

export interface MyProcess {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  category: string | null;
  description: string | null;
  /** «آغازکننده»، «تأییدکننده در "تأیید رئیس شعبه"»، «در ۲ پروندهٔ باز» */
  parts: string[];
  /** my open steps in it («منتظر شما: ۳») */
  waiting: number;
  /** my open cases (as requester or participant) */
  cases: number;
  can_start: boolean;
  link: string;
}

// ---------------------------------------------------------------------------------------------------------------
// A process's diagram and its start form

export interface QueueItem {
  task_id: string;
  case_id: string;
  number: string | null;
  title: string | null;
  since: string | null;
  due_at: string | null;
}

export interface StepView {
  key: string;
  label: string;
  action: string;
  start: boolean;
  /** the rules in words («نقش سازمانی: رئیس شعبه») */
  people: string[];
  /** a step whose rules may include me */
  mine: boolean;
  /** cases waiting for me at this step */
  queue: QueueItem[];
}

export interface StartInfo {
  can_start: boolean;
  step: string | null;
  label: string | null;
  /** the start form (from the version's snapshot) */
  form: { id: string; name: string; layout: unknown } | null;
  /** the definitions of the fields my rights let me see */
  fields: Record<string, FieldDef>;
  rights: Record<string, Right>;
  /** the step the start goes to («ارسال برای "…"») */
  next: string | null;
  /** my saved draft of a start */
  draft: Record<string, unknown> | null;
}

export interface ProcessView {
  process: { id: string; key: string; name: string; icon: string | null; category: string | null; description: string | null; status: string };
  version: { id: string; version_no: number };
  graph: ProcessGraph;
  /** form steps in the diagram's order */
  steps: StepView[];
  start: StartInfo;
  display: Record<string, string>;
}

// ---------------------------------------------------------------------------------------------------------------
// «پرونده‌ها» and one case

export interface CaseListRow {
  id: string;
  number: string | null;
  version?: number;
  title: string | null;
  process_id: string | null;
  process_name: string | null;
  version_no: number | null;
  state: string;
  outcome: string | null;
  requested_by: string | null;
  requested_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  current_steps: { key: string; label: string }[] | null;
  confidential: boolean | null;
  paused_at: string | null;
}

/** My starts a linked Windows app has not sent yet («در صف ارسال»). */
export interface QueuedStart {
  id: string;
  case_id: string | null;
  process_id: string | null;
  process_name: string | null;
  submitted_at: string | null;
}

export interface CasesPage {
  rows: CaseListRow[];
  total: number | null;
  page: number;
  size: number;
  display: DisplayMap;
  queued_starts: QueuedStart[];
}

export interface CaseFilters {
  /** process id or key */
  process?: string | null;
  /** «open», «closed», or a csv of states */
  state?: string | null;
  step?: string | null;
  requester?: string | null;
  unit?: string | null;
  from?: string | null;
  to?: string | null;
  /** «آغازشده توسط من» */
  mine?: boolean;
  q?: string | null;
  page?: number;
  size?: number;
}

export interface MyStep {
  id: string;
  step_key: string;
  label: string;
  action: string;
  round: number;
  opened_at: string | null;
  due_at: string | null;
  delegated_from: string | null;
  claimed_by: string | null;
  /** my submission waits to be sent («در صف ارسال») */
  queued: boolean;
  /** my last submission of this step the authority refused: its message and the values I entered */
  refused: { id: string; note: string | null; submitted_at: string | null; values: Record<string, unknown> } | null;
  form: string | null;
  rights: Record<string, Right>;
  outcomes: StepOutcome[];
  /** the steps a «بازگشت» may send the case back to; the first is the default; `to`: whom it returns to */
  return_targets: { key: string; label: string; default: boolean; to: string | null }[];
  /** the step each decision leads to when known */
  next: Partial<Record<StepOutcome, string | null>>;
  draft: Record<string, unknown> | null;
}

export interface CaseInfo {
  id: string;
  number: string | null;
  title: string | null;
  process_id: string | null;
  process_name: string | null;
  version_id: string | null;
  version_no: number | null;
  state: string;
  outcome: string | null;
  requested_by: string | null;
  requested_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  paused_at: string | null;
  current_steps: { key: string; label: string }[];
  confidential: boolean;
  /** the row's version */
  version: number;
}

export interface HistoryTask {
  id: string;
  step_key: string;
  step_label: string | null;
  action: string;
  round: number;
  assigned_to: string | null;
  delegated_from: string | null;
  claimed_by: string | null;
  status: string;
  outcome: string | null;
  comment: string | null;
  acted_by: string | null;
  acted_for: string | null;
  opened_at: string | null;
  closed_at: string | null;
  due_at: string | null;
}

export interface HistorySubmission {
  id: string;
  kind: string;
  step_key: string | null;
  round: number | null;
  outcome: string | null;
  comment: string | null;
  submitted_by: string | null;
  on_behalf_of: string | null;
  submitted_at: string | null;
  result: string;
  /** only on my own submissions */
  result_note: string | null;
  applied_at: string | null;
  /** cut to what I may read */
  values: Record<string, unknown>;
}

export interface CaseCan {
  cancel: boolean;
  manage: boolean;
  pause: boolean;
  resume: boolean;
  reassign: boolean;
  resume_from: boolean;
}

export interface CaseDetail {
  case: CaseInfo;
  graph: ProcessGraph;
  statuses: Record<string, NodeStatusView>;
  /** the version's forms and the fields of the values shown */
  forms: FormsSnapshot | null;
  data: Record<string, unknown>;
  my_steps: MyStep[];
  can: CaseCan;
  restart_targets: { key: string; label: string }[];
  /** the earliest due time of the open steps */
  due_at: string | null;
  history: { tasks: HistoryTask[]; submissions: HistorySubmission[]; journal: JournalEntry[] };
  display: Record<string, string>;
}

/** A file of the case (an attachment a «پیوست» field holds). */
export interface CaseFile {
  id: string;
  name: string;
  size?: number;
}

export interface CasePrint {
  org: string;
  case: {
    id: string;
    number: string | null;
    title: string | null;
    process: string | null;
    version_no: number | null;
    state: string | null;
    outcome: string | null;
    requested_by: string | null;
    requested_for: string | null;
    started_at: string | null;
    ended_at: string | null;
    finished: boolean;
  };
  decisions: { step: string | null; action: string | null; outcome: string | null; by: string | null; for: string | null; at: string | null; at_text: string | null; comment: string | null; round: number }[];
  values: { field: string; label: string; text: string }[];
  printed_at: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Writes

/** What a start or a step's submission came to. */
export interface SubmitResult {
  submission: string;
  /** applied: done; late: someone settled the step first (my values kept, not applied); pending: a linked Windows
   *  app recorded it and sends it with the next synchronisation («در صف ارسال») */
  result: "applied" | "late" | "pending";
  note: string | null;
  case: string | null;
}

export interface StartBody {
  process: string;
  values?: Record<string, unknown>;
  requested_for?: string | null;
  /** chosen here (a uuid), so the case opens at once */
  case_id?: string | null;
}

export interface SubmitBody {
  outcome: StepOutcome;
  comment?: string | null;
  values?: Record<string, unknown>;
  return_to?: string | null;
}

export interface ReassignBody {
  step: string;
  task?: string | null;
  to: string[];
  comment?: string | null;
}

/** A draft row (process_draft, the record API). */
export interface DraftRow {
  id: string;
  version?: number;
  task_id: string | null;
  process_id: string | null;
  values: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------------------------------------------
// React-query keys (the organisation first)

export const USER_KEYS = {
  all: (org: string) => ["wf-user", org] as const,
  inbox: (org: string) => ["wf-user", org, "inbox"] as const,
  count: (org: string) => ["wf-user", org, "count"] as const,
  done: (org: string) => ["wf-user", org, "done"] as const,
  mine: (org: string) => ["wf-user", org, "mine"] as const,
  view: (org: string, key: string) => ["wf-user", org, "view", key] as const,
  cases: (org: string, q: string) => ["wf-user", org, "cases", q] as const,
  kase: (org: string, id: string) => ["wf-user", org, "case", id] as const,
  files: (org: string, id: string) => ["wf-user", org, "files", id] as const,
  print: (org: string, id: string) => ["wf-user", org, "print", id] as const,
  talk: (org: string, id: string) => ["wf-user", org, "talk", id] as const,
};

const enc = encodeURIComponent;

/** The last instant (ISO) of a calendar day in `tz`: the next day's local midnight less a millisecond. */
export function dayEnd(day: string, tz: string): string | null {
  const next = zonedMidnight(addUnits(day, "day", 1), tz);
  return Number.isFinite(next) ? new Date(next - 1).toISOString() : null;
}

/**
 * The query of «پرونده‌ها» (empty values left out). The date range covers its last day whole: the server keeps the
 * cases started at or before `to` and reads a bare date as that day's first instant, so `to` goes as the last instant
 * of the chosen day in the organisation's zone («امروز» is from = to = today).
 */
export function casesQuery(f: CaseFilters, tz: string = DEFAULT_TIMEZONE): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const k of ["process", "state", "step", "requester", "unit", "from", "to", "q"] as const) {
    const v = f[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  if (typeof out.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(out.to)) out.to = dayEnd(out.to, tz) ?? out.to;
  if (f.mine) out.mine = "1";
  if (f.page && f.page > 1) out.page = f.page;
  if (f.size) out.size = f.size;
  return out;
}

/**
 * A multipart POST (the JSON under `payload`, the files under `files`): the start or a step with files. Errors read
 * like the JSON calls' (the server's Persian message; 413 when the files are too large).
 */
export async function postMultipart<T>(orgId: string, path: string, payload: unknown, files: readonly File[]): Promise<T> {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload ?? {}));
  for (const f of files) form.append("files", f, f.name);
  let res: Response;
  try {
    res = await fetch(`/api/o/${enc(orgId)}${path}`, { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "ارتباط با سرور برقرار نشد؛ اتصال را بررسی کنید");
  }
  const text = await res.text();
  let data: { error?: { code?: string; message?: string; details?: unknown } } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = data?.error;
    if (res.status === 401 && (e?.code ?? "unauthorized") === "unauthorized") window.dispatchEvent(new CustomEvent("itsm:unauthorized"));
    const msg = res.status === 413 ? "حجم پیوست‌ها بیش از حد مجاز است" : (e?.message ?? `خطای ${res.status}`);
    throw new ApiError(res.status, e?.code ?? "error", msg, e?.details);
  }
  return data as T;
}

/** The record API's process_draft: the newest of mine for a step or a start, or null. */
async function findDraft(api: OrgApi, key: { task_id: string } | { process_id: string }): Promise<DraftRow | null> {
  const filter =
    "task_id" in key
      ? { and: [{ f: "task_id", op: "eq" as const, v: key.task_id }] }
      : { and: [{ f: "process_id", op: "eq" as const, v: key.process_id }, { f: "task_id", op: "empty" as const }] };
  const r = await recordsApi.list(api, "process_draft", { filter, sort: "-updated_at", size: 1, total: false, fields: ["task_id", "process_id", "values"] });
  const row = r.rows[0];
  return row ? { id: String(row.id), version: typeof row.version === "number" ? row.version : undefined, task_id: (row.task_id as string) ?? null, process_id: (row.process_id as string) ?? null, values: (row.values as Record<string, unknown>) ?? null } : null;
}

export const userApi = {
  inbox: (api: OrgApi) => api.get<Inbox>("/process/inbox"),
  count: (api: OrgApi) => api.get<{ count: number }>("/process/inbox/count").then((r) => Number(r.count) || 0),
  done: (api: OrgApi, limit = 100) => api.get<{ rows: DoneRow[]; display: Record<string, string> }>("/process/done", { limit }),
  mine: (api: OrgApi) => api.get<{ processes: MyProcess[] }>("/process/mine"),
  view: (api: OrgApi, key: string) => api.get<ProcessView>(`/process/defs/${enc(key)}/view`),
  /** «پرونده‌ها»; `tz`: the organisation's zone, where the date range's days begin and end */
  cases: (api: OrgApi, f: CaseFilters, tz?: string) => api.get<CasesPage>("/process/cases", casesQuery(f, tz)),
  kase: (api: OrgApi, id: string) => api.get<CaseDetail>(`/process/cases/${enc(id)}`),
  print: (api: OrgApi, id: string) => api.get<CasePrint>(`/process/cases/${enc(id)}/print`),
  /**
   * The case's files I may open (the record API's attachments of the case: F4b's `filterSide` keeps those a «پیوست»
   * field I read holds), by name: a value names its files by id.
   */
  files: async (api: OrgApi, caseId: string): Promise<CaseFile[]> =>
    (await recordsApi.attachments(api, "process_case", caseId)).attachments.map((a) => ({ id: String(a.id).toLowerCase(), name: a.name, size: a.size })),

  /** «آغاز پرونده»: JSON, or multipart with the files the values name as `{ upload: n }`. */
  start: (api: OrgApi, orgId: string, body: StartBody, files: readonly File[] = []) =>
    files.length ? postMultipart<SubmitResult>(orgId, "/process/start", body, files) : api.post<SubmitResult>("/process/start", body),
  /** «انجام مرحله». */
  submit: (api: OrgApi, orgId: string, task: string, body: SubmitBody, files: readonly File[] = []) =>
    files.length ? postMultipart<SubmitResult>(orgId, `/process/tasks/${enc(task)}/submit`, body, files) : api.post<SubmitResult>(`/process/tasks/${enc(task)}/submit`, body),
  claim: (api: OrgApi, task: string) => api.post<{ claimed_by: string | null }>(`/process/tasks/${enc(task)}/claim`, {}),
  release: (api: OrgApi, task: string) => api.del<{ claimed_by: string | null }>(`/process/tasks/${enc(task)}/claim`),

  reassign: (api: OrgApi, caseId: string, body: ReassignBody) => api.post<{ tasks: string[] }>(`/process/cases/${enc(caseId)}/reassign`, body),
  pause: (api: OrgApi, caseId: string, comment?: string | null) => api.post<{ paused_at: string }>(`/process/cases/${enc(caseId)}/pause`, { comment: comment || null }),
  resume: (api: OrgApi, caseId: string, comment?: string | null) => api.post<{ state: string }>(`/process/cases/${enc(caseId)}/resume`, { comment: comment || null }),
  cancel: (api: OrgApi, caseId: string, comment?: string | null) =>
    api.post<{ result: SubmitResult["result"] | "refused"; by: "manager" | "requester"; note?: string | null }>(`/process/cases/${enc(caseId)}/cancel`, { comment: comment || null }),
  resumeFrom: (api: OrgApi, caseId: string, node: string, comment?: string | null) => api.post<unknown>(`/process/cases/${enc(caseId)}/resume-from`, { node, comment: comment || null }),

  /** The conversation «گفت‌وگو»: the case's comments. */
  talk: (api: OrgApi, caseId: string) => recordsApi.journal(api, "process_case", caseId, { kinds: ["comment"], limit: 100 }),
  say: (api: OrgApi, caseId: string, body: string) => recordsApi.addJournal(api, "process_case", caseId, { kind: "comment", body }),

  /** Save my draft of a step or a start (one row each: the newest is updated). */
  saveDraft: async (api: OrgApi, key: { task_id: string } | { process_id: string }, values: Record<string, unknown>): Promise<string> => {
    const have = await findDraft(api, key);
    if (have) {
      await recordsApi.update(api, "process_draft", have.id, { values }, have.version);
      return have.id;
    }
    const made = await recordsApi.create(api, "process_draft", { ...key, values });
    return String(made.row.id);
  },
  /**
   * Drop my draft of a step or a start (after it was sent): removed, or emptied where my access does not remove rows
   * of «کارها» (a requester's) — an emptied draft reads as none. Never fails the caller.
   */
  dropDraft: async (api: OrgApi, key: { task_id: string } | { process_id: string }): Promise<void> => {
    let have: DraftRow | null = null;
    try {
      have = await findDraft(api, key);
      if (have) await recordsApi.remove(api, "process_draft", have.id);
    } catch {
      try {
        if (have) await recordsApi.update(api, "process_draft", have.id, { values: null });
      } catch {
        // a draft left behind is replaced by the next one
      }
    }
  },
};
