// The kit's calls: positions and their holders through the generic record API (/r/position, /r/position_holder:
// `org` read), the static estimate behind the role-then-people picker's explanation line (POST /positions/estimate:
// `process_design` write, or `org` write beyond one's own groups — the server decides), and the demo pack's people
// (GET /positions/demo-people: whoever opens the designer or the positions page).
import type { AccessGate } from "@shared/access";
import type { Cond } from "@shared/model/conditions";
import type { AssigneeKind, Quorum, StepAction, StepAssignees } from "@shared/process";
import type { DemoPeople } from "@shared/process/waiting";
import type { OrgApi } from "../../../lib/api";
import { recordsApi } from "../../../records/data/api";
import type { DisplayMap, RecordRow } from "../../../records/model/types";

export interface PositionRow {
  id: string;
  key: string;
  name: string;
  unit_kind: string | null;
  active: boolean;
}

export interface HolderRow {
  id: string;
  user_id: string;
  org_unit_id: string | null;
  kind: string | null;
  valid_from: string | null;
  valid_to: string | null;
}

export interface EstimateResult {
  /** `demo`: how many of the rule's people are the demo pack's (release 1.1.5) */
  rules: { index: number; kind: AssigneeKind; estimate: number | null; line: string; demo?: number }[];
  /** the most people the rules can bring (null: depends on each case) */
  total: number | null;
  /** how many of `total` are the demo pack's people: only cases the pack's people start reach them (1.1.5) */
  demo?: number;
  limit: number;
  warnings: string[];
}

/** A member as a people picker shows them. */
export interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  title: string | null;
  active: boolean;
}

const POSITION_FIELDS = ["name", "key", "unit_kind", "active"];
const MEMBER_FIELDS = ["name", "email", "title", "is_active"];

const positionOf = (r: RecordRow): PositionRow => ({
  id: String(r.id),
  key: String(r.key ?? ""),
  name: String(r.name ?? r.key ?? ""),
  unit_kind: typeof r.unit_kind === "string" ? r.unit_kind : null,
  active: r.active !== false,
});

export const kitApi = {
  /** Positions matching a search (by name or key), and those named by id or key (the current value). */
  positions: async (api: OrgApi, q: { q?: string; ids?: string[]; keys?: string[]; filter?: Cond | null }): Promise<PositionRow[]> => {
    if (q.ids?.length) return (await recordsApi.list(api, "position", { ids: q.ids, size: q.ids.length, fields: POSITION_FIELDS, total: false })).rows.map(positionOf);
    if (q.keys?.length) {
      const filter: Cond = { f: "key", op: "in", v: q.keys };
      return (await recordsApi.list(api, "position", { filter, size: q.keys.length, fields: POSITION_FIELDS, total: false })).rows.map(positionOf);
    }
    return (await recordsApi.list(api, "position", { q: q.q || undefined, filter: q.filter ?? undefined, size: 50, sort: "name", fields: POSITION_FIELDS, total: false })).rows.map(positionOf);
  },
  /** Holder rows of a position (in one unit when given), with the names of people and units. */
  holders: async (api: OrgApi, position: string, unit?: string | null): Promise<{ rows: HolderRow[]; display: DisplayMap }> => {
    const parts: Cond[] = [{ f: "position_id", op: "eq", v: position }];
    if (unit) parts.push({ f: "org_unit_id", op: "eq", v: unit });
    const r = await recordsApi.list(api, "position_holder", { filter: { and: parts }, size: 200, fields: ["user_id", "org_unit_id", "kind", "valid_from", "valid_to"], total: false });
    return {
      rows: r.rows.map((x) => ({
        id: String(x.id),
        user_id: String(x.user_id ?? "").toLowerCase(),
        org_unit_id: typeof x.org_unit_id === "string" ? x.org_unit_id : null,
        kind: typeof x.kind === "string" ? x.kind : null,
        valid_from: typeof x.valid_from === "string" ? x.valid_from : null,
        valid_to: typeof x.valid_to === "string" ? x.valid_to : null,
      })),
      display: r.display ?? {},
    };
  },
  estimate: (api: OrgApi, body: { step: StepAssignees; action: StepAction; quorum?: Quorum | null }) => api.post<EstimateResult>("/positions/estimate", body),
  /** the organisation's demo pack people (lower-case ids; empty without a pack) */
  demoPeople: (api: OrgApi) => api.get<DemoPeople>("/positions/demo-people"),
  /** members by search or by id, with the fields a people picker shows */
  members: async (api: OrgApi, q: { q?: string; ids?: string[]; size?: number }): Promise<MemberRow[]> => {
    const r = q.ids
      ? await recordsApi.list(api, "user", { ids: q.ids, size: Math.max(1, Math.min(q.ids.length, 500)), fields: MEMBER_FIELDS, total: false })
      : await recordsApi.list(api, "user", { q: q.q || undefined, size: q.size ?? 50, fields: MEMBER_FIELDS, total: false });
    return r.rows.map((u) => ({
      id: String(u.id).toLowerCase(),
      name: String(u.name || u.email || "—"),
      email: typeof u.email === "string" ? u.email : null,
      title: typeof u.title === "string" ? u.title : null,
      active: u.is_active !== false,
    }));
  },
};

/** Who may ask for the estimate and the preview (the server's `canPreview`): designers, or keepers of the structure. */
export const ESTIMATE_GATES: AccessGate[] = [
  { area: "process_design", op: "write" },
  { area: "process_design", op: "create" },
  { area: "org", op: "write", scope: "unit" },
];
