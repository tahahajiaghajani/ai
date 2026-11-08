// The organisation the signed-in person works in: GET /api/o/:org (the organisation, the caller's role and per-area
// levels, the platform admin's support session, the platform status) and the helpers every page uses — `can` for
// permissions, `has` for modules, `api` scoped to the organisation.
import { createContext, useContext, useMemo, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { orgApi, type OrgApi } from "./api";
import type { Area, Level } from "@shared/permissions";
import { LEVEL_ORDER } from "@shared/permissions";
import { gateAllows, type AccessGate, type FullGrant, type Persona } from "@shared/access";
import { DEFAULT_TIMEZONE, type ModuleKey } from "@shared/constants";
import { formatNumber } from "@shared/format";
import type { Num } from "@shared/money";

export interface OrgInfo {
  org: {
    id: string;
    name: string;
    legal_name: string | null;
    modules: ModuleKey[];
    phone: string | null;
    email: string | null;
    website: string | null;
    city: string | null;
    address: string | null;
    logo: string | null;
    settings: { timezone?: string; [k: string]: any };
    [k: string]: any;
  };
  member: { role: string; title: string; permissions: Record<Area, Level> };
  counts: { members: number };
  /** the platform admin working here in «حالت پشتیبانی» (null for members) */
  support?: OrgSupport | null;
  /** the organisation's platform status: read_only refuses changes, suspended closes it to members */
  status?: { status: OrgStatus; reason: string | null };
  /** the member's effective ITSM access: grants per area, roles, working persona (nav items and spaces name a gate) */
  access?: { grants: Record<string, FullGrant>; roles: string[]; legacy: boolean; persona: Persona };
}

export type OrgStatus = "active" | "read_only" | "suspended";

export interface OrgSupport {
  active: true;
  id: string;
  level: "view" | "edit";
  level_title: string;
  reason: string;
  started_at: string;
  expires_at: string;
}

interface OrgValue {
  orgId: string;
  info: OrgInfo;
  org: OrgInfo["org"];
  api: OrgApi;
  can: (area: Area, level?: Level) => boolean;
  /** the member's ITSM access passes `gate` (an area, an operation, the least scope) — what to offer in the shell */
  allows: (gate: AccessGate) => boolean;
  /** requester (no operational role), agent or admin */
  persona: Persona;
  has: (m: ModuleKey) => boolean;
  /** the organisation's IANA time zone (today's date, reports) */
  timezone: string;
  /** a number in Persian digits with grouping (`dp` decimals at most) */
  num: (v: Num, dp?: number) => string;
  /** the active support session of the platform admin, when he works here in support mode */
  support: OrgSupport | null;
  /** false while the platform admin has made the organisation read-only (members still see everything) */
  writable: boolean;
}

const Ctx = createContext<OrgValue | null>(null);

export function useOrgQuery(orgId: string) {
  return useQuery({ queryKey: ["org", orgId], queryFn: () => orgApi(orgId).get<OrgInfo>(""), staleTime: 60_000, enabled: !!orgId });
}

export function OrgProvider({ orgId, info, children }: { orgId: string; info: OrgInfo; children: ReactNode }) {
  const visiting = !!info.support;
  useEffect(() => {
    // an organisation opened in support mode is not «the last organisation» the admin returns to
    if (visiting) return;
    try {
      localStorage.setItem("itsm.lastOrg", orgId);
    } catch {
      /* ignore */
    }
  }, [orgId, visiting]);

  const value = useMemo<OrgValue>(() => {
    const perms = info.member.permissions;
    return {
      orgId,
      info,
      org: info.org,
      api: orgApi(orgId),
      can: (area, level = "view") => LEVEL_ORDER.indexOf(perms[area] ?? "none") >= LEVEL_ORDER.indexOf(level),
      allows: (gate) => gateAllows(info.access?.grants, gate),
      persona: info.access?.persona ?? "agent",
      has: (m) => (info.org.modules ?? []).includes(m),
      timezone: info.org.settings?.timezone || DEFAULT_TIMEZONE,
      num: (v, dp = 0) => formatNumber(v, { dp }),
      support: info.support ?? null,
      writable: (info.status?.status ?? "active") === "active",
    };
  }, [orgId, info]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg() {
  const v = useContext(Ctx);
  if (!v) throw new Error("OrgProvider missing");
  return v;
}
