// Data of the access pages: the caller's effective access (GET /access/me), the role catalogue, member access, the
// organisation's reference tables (units, locations, groups, workspaces) read through the generic engine API, and
// the members directory. One react-query key per resource so a change refreshes every page that shows it.
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import type { DeskPreset, FullGrant, Grants, Persona, RoleChange, RoleDef, RowExplanation } from "@shared/access";
import type { FieldGroup } from "@shared/model/types";

export interface AccessSummary {
  user_id: string;
  kind: "user" | "support" | "system";
  legacy: boolean;
  roles: string[];
  grants: Record<string, FullGrant>;
  field_groups: FieldGroup[];
  workspaces_all: boolean;
  domains_all: boolean;
  groups: string[];
  write_groups: string[];
  led_groups: string[];
  workspaces: string[];
  unit_id: string | null;
  domain_id: string | null;
  managed_units: string[];
  reportees: string[];
  delegators: string[];
  settings: { domain_separation: boolean; preset: DeskPreset };
}

export interface RoleView extends RoleDef {
  builtin: boolean;
  modified: boolean;
  diff: RoleChange[];
  holders: number;
  version: number | null;
}

export interface MemberAccessRow {
  user_id: string;
  name: string;
  email: string;
  membership_role: string;
  is_active: boolean;
  persona: Persona | null;
  roles: string[];
  unit_id: string | null;
  title: string | null;
  groups: number;
  legacy: boolean;
}

export interface MemberAccessDetail {
  member: { user_id: string; name: string; email: string; membership_role: string; is_active: boolean };
  profile: Record<string, any> | null;
  groups: { id: string; group_id: string; name: string; kind: string; roles: string[]; valid_from: string | null; valid_to: string | null; version: number }[];
  sources: { profile: string[]; groups: { group_id: string; roles: string[] }[]; membership: string[] };
  effective: AccessSummary;
}

export interface AccessCheck {
  user: { id: string; name: string };
  table: { key: string; label: string; plural: string; area: string };
  grant: FullGrant;
  roles: string[];
  legacy: boolean;
  field_groups: FieldGroup[];
  hidden_fields: { name: string; label: string; group: FieldGroup }[];
  can: { read_table: boolean; create: boolean };
  record?: { id: string; label: string; explanation: RowExplanation; sql_read: boolean; writable_fields: string[] | null };
}

/** A row of an engine table as the generic API returns it. */
export type Rec = Record<string, any> & { id: string; version: number };

export interface UnitRow extends Rec {
  name: string;
  code: string | null;
  kind: string;
  parent_id: string | null;
  manager_id: string | null;
  location_id?: string | null;
  is_domain?: boolean;
  active: boolean;
  description?: string | null;
}

export interface GroupRow extends Rec {
  name: string;
  types: string[];
  parent_id: string | null;
  manager_id: string | null;
  email: string | null;
  skills: string[];
  roles: string[];
  restricted: boolean;
  active: boolean;
  workspace_id: string | null;
  description?: string | null;
}

export interface WorkspaceRow extends Rec {
  key: string;
  name: string;
  icon: string | null;
  color: string | null;
  is_default: boolean;
  secure: boolean;
  active: boolean;
  description?: string | null;
}

export interface MemberLite {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
}

export const KEYS = {
  me: ["access", "me"],
  roles: ["access", "roles"],
  members: ["access", "members"],
  member: (id: string) => ["access", "member", id],
  table: (t: string) => ["access", "table", t],
  users: ["access", "users"],
  settings: ["access", "settings"],
};

/** Every row of a (small) engine table: the org structure is reference data, read in full. */
export function useTable<T extends Rec>(table: string, opts: { enabled?: boolean } = {}) {
  const { api } = useOrg();
  return useQuery({
    queryKey: KEYS.table(table),
    queryFn: async () => {
      const out: T[] = [];
      for (let page = 1; page < 50; page++) {
        const r = await api.get<{ rows: T[]; total: number }>(`/r/${table}`, { size: "500", page: String(page), total: page === 1 ? "true" : "false" });
        out.push(...r.rows);
        if (r.rows.length < 500) break;
      }
      return out;
    },
    staleTime: 30_000,
    enabled: opts.enabled ?? true,
  });
}

/** The members (directory), for pickers and labels. */
export function useMembers() {
  const { api } = useOrg();
  return useQuery({
    queryKey: KEYS.users,
    queryFn: async () => (await api.get<{ rows: MemberLite[] }>(`/r/user`, { size: "500", total: "false" })).rows,
    staleTime: 60_000,
  });
}

export function useMyAccess() {
  const { api } = useOrg();
  return useQuery({ queryKey: KEYS.me, queryFn: () => api.get<AccessSummary>("/access/me"), staleTime: 30_000 });
}

export function useRoles() {
  const { api } = useOrg();
  return useQuery({ queryKey: KEYS.roles, queryFn: () => api.get<{ roles: RoleView[]; preset: DeskPreset }>("/access/roles"), staleTime: 15_000 });
}

/** May the caller administer access (`users` admin in their effective access)? */
export function useAccessAdmin(): { admin: boolean; manageOrg: boolean; loading: boolean } {
  const me = useMyAccess();
  const { writable } = useOrg();
  const users = me.data?.grants.users;
  const org = me.data?.grants.org;
  return { admin: !!users?.admin && writable, manageOrg: !!org && org.write === "all" && writable, loading: me.isLoading };
}

export type { Grants };
