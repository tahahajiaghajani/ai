import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleKey } from "@shared/constants";
import { api, ApiError } from "./api";

/** The web version's answers that mean «the server is not ready» (src/server/cloud.ts), not «this request failed». */
export const SERVER_STATES = new Set(["migrating", "not_configured", "db_unreachable"]);
const serverState = (e: unknown) => e instanceof ApiError && SERVER_STATES.has(e.code);

export interface Meta {
  app: string;
  version: string;
  mode: "cloud" | "desktop";
  /** the web version, the Windows app, or the server edition (Windows Server on an organisation's intranet) */
  edition?: "web" | "desktop" | "server";
  /** the server edition: air-gapped network, public address and the directory (AD) settings page */
  server?: { air_gapped: boolean; public_url: string; directory_path: string } | null;
  allow_signup: boolean;
  first_run: boolean;
  schema: { pending: string[]; current: string; latest: string } | null;
  signed_in: boolean;
  desktop: DesktopInfo | null;
}

export interface DesktopInfo {
  version: string;
  data_dir: string;
  device_id: string;
  computer: string;
  local_url: string;
  lan: { enabled: boolean; port: number; addresses: string[] };
  cloud: { linked: boolean; url: string | null; org_id: string | null; email: string | null; linked_at: string | null; auto_sync: boolean };
  sync: { linked: boolean; running: boolean; online: boolean | null; last_sync_at: string | null; last_error: string | null; pending: number; failed: { entity: string; id: string; error: string | null }[] };
  backups: { dir: string; auto: boolean; keep: number; last: { at: string; file: string; size: number } | null };
}

export interface OrgSummary {
  id: string;
  name: string;
  modules: ModuleKey[];
  logo: string | null;
  /** IANA time zone (the organisation's settings) */
  timezone: string | null;
  /** the caller's role (null while a platform admin works there in support mode) */
  role: string | null;
  support?: { level: "view" | "edit"; expires_at: string } | null;
}

export interface Me {
  user: { id: string; email: string; full_name: string; mobile: string | null; is_platform_admin: boolean; prefs: Record<string, unknown> };
  orgs: OrgSummary[];
}

interface SessionValue {
  meta: Meta | undefined;
  /** the server is not ready (its database is being prepared or cannot be reached): the app shows «آماده‌سازی» */
  serverError: ApiError | null;
  me: Me | null | undefined;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  // a server that is preparing its database answers at once: no retries with back-off (the «آماده‌سازی» screen polls)
  const retry = (n: number, e: unknown) => !serverState(e) && n < 2;
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/meta"), staleTime: 30_000, retry });
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Me>("/auth/me");
      } catch (e) {
        if ((e as { status?: number }).status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: (n, e) => !serverState(e) && n < 1,
  });

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(["me"], null);
    window.addEventListener("itsm:unauthorized", onUnauthorized);
    return () => window.removeEventListener("itsm:unauthorized", onUnauthorized);
  }, [qc]);

  const serverError = [meta.error, me.error].find(serverState) as ApiError | undefined;
  const value: SessionValue = {
    meta: meta.data,
    serverError: serverError ?? null,
    me: me.data,
    loading: meta.isLoading || me.isLoading,
    refresh: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["me"] }), qc.invalidateQueries({ queryKey: ["meta"] })]);
    },
    logout: async () => {
      await api.post("/auth/logout").catch(() => {});
      qc.clear();
      window.location.href = "/login";
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("SessionProvider missing");
  return v;
}
