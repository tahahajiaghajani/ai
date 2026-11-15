// The calls of the lifecycle editor (design F §4.2, §4.3, §8.5; package F6), over F1's routes:
//   · GET /lifecycles/:table — the module's states and transitions (what is locked marked), the organisation's
//     overlay and the result, and the lines and links of a table whose lifecycle a module configures elsewhere:
//     `settings` view;
//   · PUT /lifecycles/:table — the overlay (validated by the `_states` row's hook on every path); null restores the
//     module's lifecycle («بازگشت به پیش‌فرض»): `settings` full. It replaces the whole overlay, so the editor reads
//     the lifecycle again first (`recheck`) and puts its changes onto another administrator's newer save;
//   · the roles «فقط با نقش» offers: GET /access/roles (`users` read), else the built-in roles by name.
// The response type is F1's (src/server/modules/fields/service.ts `lifecycleOf`), copied here.
import type { Cond } from "@shared/model/conditions";
import type { AreaOp, ColorKey, StateCategory } from "@shared/model/types";
import type { LifecycleOverlay } from "@shared/model/lifecycle";
import type { OrgApi } from "../../../../lib/api";
import { overlayMoved, rebaseDraft, type LifecycleDraft } from "./model";

export interface LifecycleState {
  value: string;
  category: StateCategory;
  default_label: string;
  default_color: ColorKey | null;
  /** with the organisation's overlay */
  label: string;
  color: ColorKey | null;
}

export interface LifecycleTransition {
  /** `transitionKey`: «new,on_hold>in_progress», «*>canceled» */
  key: string;
  from: string[] | "*";
  to: string;
  default_label: string;
  /** the module's own required fields (locked) */
  requires: string[];
  /** the module's rule of who may take it (locked) */
  roles: AreaOp | null;
  /** the module guards it in code (locked) */
  guard: boolean;
  /** the module lets an organisation switch it off */
  optional: boolean;
  /** with the organisation's overlay */
  label: string;
  primary: boolean;
  /** the organisation's extra fields */
  needs: string[];
  /** narrowing: one of these roles as well */
  also: string[];
  when: Cond | null;
  message: string | null;
  /** switched off by the organisation */
  off: boolean;
}

export interface LifecycleView {
  table: string;
  /** a lifecycle a module configures elsewhere (change requests): labels, colours and the primary transition only */
  labels_only: boolean;
  /** where else this lifecycle is shaped, with a link */
  notes: { text: string; link: string }[];
  states: LifecycleState[];
  transitions: LifecycleTransition[];
  /** the organisation's stored overlay (null: the module's lifecycle as it is) */
  overlay: LifecycleOverlay | null;
}

export interface RoleOption {
  key: string;
  name: string;
  active: boolean;
}

export const LIFECYCLE_KEYS = {
  all: (org: string) => ["wf-lifecycle", org] as const,
  one: (org: string, table: string) => ["wf-lifecycle", org, table] as const,
  roles: (org: string) => ["wf-lifecycle", org, "roles"] as const,
};

const enc = encodeURIComponent;

export const lifecycleApi = {
  get: (api: OrgApi, table: string) => api.get<LifecycleView>(`/lifecycles/${enc(table)}`),
  save: (api: OrgApi, table: string, overlay: LifecycleOverlay | null) => api.put<LifecycleView>(`/lifecycles/${enc(table)}`, overlay),
  /**
   * The stored lifecycle read again before «ذخیرهٔ تغییرها» (the PUT replaces the whole overlay): null when nobody
   * saved since `seen` was read; else what is stored now and `draft` put onto it (./model.ts `rebaseDraft`).
   */
  recheck: async (api: OrgApi, seen: LifecycleView, draft: LifecycleDraft): Promise<{ now: LifecycleView; draft: LifecycleDraft } | null> => {
    const now = await lifecycleApi.get(api, seen.table);
    return overlayMoved(seen, now) ? { now, draft: rebaseDraft(seen, draft, now) } : null;
  },
  /** the organisation's roles (built-in and its own), when the caller may read them */
  roles: async (api: OrgApi): Promise<RoleOption[]> => {
    const r = await api.get<{ roles: { key: string; name: string; active?: boolean }[] }>("/access/roles");
    return r.roles.map((x) => ({ key: x.key, name: x.name, active: x.active !== false }));
  },
};
