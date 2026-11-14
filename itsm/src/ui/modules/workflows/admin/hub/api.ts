// The calls of «گردش‌کارها» (design F §4, §8.3; package F6), over F4c's routes:
//   · GET /process/hub — the nine kinds with their counts, the rows (each with its editor's route), the notices and
//     the «قاعده‌ها» line: `process_design` read or `settings` edit;
//   · POST /process/hub/roles/:key/work — «افزودن حق» (`users` admin and a recent sign-in: the API client asks for it);
//   · POST /process/defs — «گردش‌کار تازه» (`process_design` create or write): a draft with «ثبت درخواست» by the requester;
//   · GET /process/defs/:id/diff, POST …/publish, POST …/retire — «انتشار» and «بازنشسته‌کردن» (`process_design`
//     approve and a recent sign-in, on the authority only);
//   · the names of who changed each row last: the members table of the record API (every member reads it).
// The response types are F4c's (src/server/modules/process/{hub,publish}), copied here: the UI imports no server code.
import type { FlowProblem } from "@shared/flows/types";
import type { OrgApi } from "../../../../lib/api";
import { recordsApi } from "../../../../records/data/api";

export type HubKind = "process" | "lifecycle" | "change_model" | "approval_rule" | "flow" | "catalog_flow" | "catalog_tasks" | "journey" | "playbook";

/** A row of the hub. */
export interface HubRow {
  kind: HubKind;
  id: string;
  name: string;
  /** the table it works on (key and label), or its category */
  table: string | null;
  table_label: string | null;
  category: string | null;
  /** «منتشرشده نسخهٔ ۳»، «پیش‌نویس»، «فعال»، «غیرفعال»، «بازنشسته»، «سفارشی‌شده»، «پیش‌فرض» */
  status: string;
  active: boolean;
  /** processes only */
  open_cases?: number;
  updated_at: string | null;
  /** who changed it last (a member id) */
  owner: string | null;
  /** the module whose page edits it */
  module: string;
  /** all: everything; safe: the safe subset; labels: labels, colours and the primary transition */
  editable: "all" | "safe" | "labels";
  /** the app route of its editor */
  editor: string;
}

export interface HubNotice {
  kind: "roles_without_work" | "lists_changed";
  message: string;
  /** roles_without_work: the roles («افزودن حق») */
  roles?: { key: string; name: string; holders: number }[];
  /** lists_changed: the process and the lists */
  process?: { id: string; name: string };
  lists?: string[];
}

export interface HubKindInfo {
  key: HubKind;
  label: string;
  count: number;
  /** what may be changed there, in words */
  editable: string;
  module: string;
}

export interface Hub {
  kinds: HubKindInfo[];
  rows: HubRow[];
  notices: HubNotice[];
  /** «قاعده‌ها»: the rules that are not workflows */
  rules: { label: string; link: string }[];
  /** no process yet: the page shows its first-use panel */
  empty: boolean;
  can: { create: boolean; publish: boolean };
}

/** What «انتشار» would publish (GET /process/defs/:id/diff). */
export interface PublishDiff {
  /** the process's first version */
  first: boolean;
  /** what changed in the process itself */
  changes: string[];
  /** what changed in who reads and manages its cases */
  access: string[];
}

export interface DiffPreview {
  diff: PublishDiff;
  problems: FlowProblem[];
  can_publish: boolean;
  next_version: number;
  display: Record<string, string>;
}

export interface PublishResult {
  version: { id: string; version_no: number; published_at: string };
  diff: PublishDiff;
  /** how many cases of the process took the new access settings */
  propagated: number;
  message: string;
}

export interface RetireResult {
  status: string;
  open_cases: number;
  message: string;
}

/** What POST /process/defs takes. */
export interface NewProcessBody {
  name: string;
  key: string;
  category?: string | null;
  description?: string | null;
}

/** The part of the designer's view (ProcessDetail) a new process's page needs: where it is. */
export interface CreatedProcess {
  process: { id: string; key: string; name: string; status: string; version_no: number | null };
}

/** React-query keys of the hub (the organisation first). */
export const HUB_KEYS = {
  all: (org: string) => ["wf-hub", org] as const,
  hub: (org: string) => ["wf-hub", org, "hub"] as const,
  people: (org: string, ids: string) => ["wf-hub", org, "people", ids] as const,
  diff: (org: string, id: string) => ["wf-hub", org, "diff", id] as const,
};

const enc = encodeURIComponent;

export const hubApi = {
  hub: (api: OrgApi) => api.get<Hub>("/process/hub"),
  grantWork: (api: OrgApi, role: string) => api.post<{ role: { key: string; name: string } }>(`/process/hub/roles/${enc(role)}/work`, {}),
  create: (api: OrgApi, body: NewProcessBody) => api.post<CreatedProcess>("/process/defs", body),
  diff: (api: OrgApi, id: string) => api.get<DiffPreview>(`/process/defs/${enc(id)}/diff`),
  publish: (api: OrgApi, id: string, note: string | null) => api.post<PublishResult>(`/process/defs/${enc(id)}/publish`, { note }),
  retire: (api: OrgApi, id: string, note: string | null) => api.post<RetireResult>(`/process/defs/${enc(id)}/retire`, { note }),
  /** The names of members by id (those the caller may see; at most 500). */
  people: async (api: OrgApi, ids: readonly string[]): Promise<Record<string, string>> => {
    const wanted = [...new Set(ids)].slice(0, 500);
    if (!wanted.length) return {};
    const r = await recordsApi.list(api, "user", { ids: wanted, size: wanted.length, fields: ["name"], total: false });
    return Object.fromEntries(r.rows.filter((u) => typeof u.name === "string" && u.name).map((u) => [String(u.id), String(u.name)]));
  },
};
