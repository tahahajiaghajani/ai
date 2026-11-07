import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { orgApi, type OrgApi } from "./api";
import type { Area, Level } from "@shared/permissions";
import { LEVEL_ORDER } from "@shared/permissions";
import type { ModuleKey } from "@shared/constants";
import { formatMoney } from "@shared/format";
import { todayISO } from "@shared/jalali";
import type { Num } from "@shared/money";

export interface FiscalYear {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  status: "open" | "closing" | "closed";
}

export interface OrgInfo {
  org: {
    id: string;
    name: string;
    legal_name: string | null;
    business_kind: string;
    modules: ModuleKey[];
    base_currency: string;
    money_decimals: number;
    settings: Record<string, any>;
    logo: string | null;
    [k: string]: any;
  };
  member: { role: string; title: string; permissions: Record<Area, Level> };
  fiscal_years: FiscalYear[];
  base_currency: { id: string; code: string; name: string; symbol: string; decimals: number } | null;
  counts: { members: number };
  /** the platform admin working here in «حالت پشتیبانی» (null for members) */
  support?: OrgSupport | null;
  /** the business's platform status: read_only refuses changes, suspended closes it to members */
  status?: { status: OrgStatus; reason: string | null };
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
  has: (m: ModuleKey) => boolean;
  fy: FiscalYear | null;
  setFy: (id: string) => void;
  money: (v: Num, opts?: { parens?: boolean; zero?: string }) => string;
  unit: string;
  /** the active support session of the platform admin, when he works here in support mode */
  support: OrgSupport | null;
  /** false while the platform admin has made the business read-only (members still see everything) */
  writable: boolean;
}

const Ctx = createContext<OrgValue | null>(null);

export function useOrgQuery(orgId: string) {
  return useQuery({ queryKey: ["org", orgId], queryFn: () => orgApi(orgId).get<OrgInfo>(""), staleTime: 60_000, enabled: !!orgId });
}

export function OrgProvider({ orgId, info, children }: { orgId: string; info: OrgInfo; children: ReactNode }) {
  const key = `taraz.fy.${orgId}`;
  const [fyId, setFyId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  });
  const visiting = !!info.support;
  useEffect(() => {
    // a business opened in support mode is not «the last business» the admin returns to
    if (visiting) return;
    try {
      localStorage.setItem("taraz.lastOrg", orgId);
    } catch {
      /* ignore */
    }
  }, [orgId, visiting]);

  const value = useMemo<OrgValue>(() => {
    const today = todayISO(info.org.settings?.timezone || "Asia/Tehran");
    const current = info.fiscal_years.find((f) => f.start_date <= today && f.end_date >= today) ?? info.fiscal_years[0] ?? null;
    const fy = info.fiscal_years.find((f) => f.id === fyId) ?? current;
    const perms = info.member.permissions;
    const dp = info.org.money_decimals ?? 0;
    const unit = info.base_currency?.symbol || (info.org.base_currency === "IRR" ? "ریال" : info.org.base_currency === "IRT" ? "تومان" : info.org.base_currency);
    return {
      orgId,
      info,
      org: info.org,
      api: orgApi(orgId),
      can: (area, level = "view") => LEVEL_ORDER.indexOf(perms[area] ?? "none") >= LEVEL_ORDER.indexOf(level),
      has: (m) => info.org.modules.includes(m),
      fy,
      setFy: (id) => {
        setFyId(id);
        try {
          localStorage.setItem(key, id);
        } catch {
          /* ignore */
        }
      },
      money: (v, opts) => formatMoney(v, dp, opts),
      unit,
      support: info.support ?? null,
      writable: (info.status?.status ?? "active") === "active",
    };
  }, [orgId, info, fyId, key]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOrg() {
  const v = useContext(Ctx);
  if (!v) throw new Error("OrgProvider missing");
  return v;
}
