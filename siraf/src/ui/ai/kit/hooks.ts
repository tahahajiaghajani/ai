// Data hooks of the E2 screens over /api/o/:org/ai/*. Every key starts with ["ai", orgId] so one invalidation after a
// settings change refreshes status, connections and the dashboard cards together.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AiConnectionPublic, AiInsight, AiSettings } from "@shared/ai/types";
import { useOrg } from "../../lib/org";
import type { AiActionView, AiBriefView, AiPresetView, AiSettingsView, AiStatusView, AiToolCallView, AiUsageView } from "./types";

/** Lists may come bare or wrapped ({connections: […]}, {rows: […]}); take the array either way. */
export function listOf<T>(r: unknown, ...keys: string[]): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === "object") {
    for (const k of [...keys, "rows", "items", "list", "data"]) {
      const v = (r as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

/** An object that may come wrapped ({settings: {…}}) or bare. */
export function objectOf<T>(r: unknown, key: string): T {
  if (r && typeof r === "object" && key in (r as object) && typeof (r as Record<string, unknown>)[key] === "object") return (r as Record<string, T>)[key];
  return r as T;
}

export function useAiKey() {
  const { orgId } = useOrg();
  return (...rest: unknown[]) => ["ai", orgId, ...rest];
}

/** Refresh everything AI after a change (status, connections, settings, dashboard cards). */
export function useAiInvalidate() {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  return () => qc.invalidateQueries({ queryKey: ["ai", orgId] });
}

export function useAiStatus(enabled = true) {
  const { api, can } = useOrg();
  const key = useAiKey();
  return useQuery({
    queryKey: key("status"),
    queryFn: () => api.get<AiStatusView>("/ai/status"),
    enabled: enabled && can("ai", "view"),
    staleTime: 30_000,
    retry: false,
  });
}

export function useAiPresets() {
  const { api } = useOrg();
  const key = useAiKey();
  return useQuery({ queryKey: key("presets"), queryFn: () => api.get("/ai/presets").then((r) => listOf<AiPresetView>(r, "presets")), staleTime: 5 * 60_000 });
}

export function useAiConnections(enabled = true) {
  const { api, can } = useOrg();
  const key = useAiKey();
  return useQuery({
    queryKey: key("connections"),
    queryFn: () => api.get("/ai/connections").then((r) => listOf<AiConnectionPublic>(r, "connections")),
    enabled: enabled && can("ai", "full"),
  });
}

export function useAiSettings(enabled = true) {
  const { api, can } = useOrg();
  const key = useAiKey();
  return useQuery({
    queryKey: key("settings"),
    queryFn: () =>
      api.get("/ai/settings").then((r): AiSettingsView => {
        const v = (r ?? {}) as Partial<AiSettingsView>;
        return "settings" in v && v.settings
          ? (v as AiSettingsView)
          : { settings: r as AiSettings, can_manage: true, policy: { disabled: false, allowed_presets: null, allowed_protocols: null, monthly_cap_usd: null }, app_secret_missing: false, mode: "cloud", linked: false };
      }),
    enabled: enabled && can("ai", "view"),
  });
}

export function useAiUsage(params: { from?: string | null; to?: string | null }, enabled = true) {
  const { api, can } = useOrg();
  const key = useAiKey();
  return useQuery({
    queryKey: key("usage", params.from, params.to),
    queryFn: () => api.get<AiUsageView>("/ai/usage", { from: params.from, to: params.to }),
    enabled: enabled && can("ai", "full"),
  });
}

export function useAiActions(params: Record<string, string | null | undefined>, enabled = true) {
  const { api, can } = useOrg();
  const key = useAiKey();
  return useQuery({
    queryKey: key("actions", params),
    queryFn: () => api.get("/ai/actions", params).then((r) => listOf<AiActionView>(r, "actions")),
    enabled: enabled && can("ai", "view"),
  });
}

export function useAiToolCalls(params: Record<string, string | null | undefined>, enabled = true) {
  const { api, can } = useOrg();
  const key = useAiKey();
  return useQuery({
    queryKey: key("tool-calls", params),
    queryFn: () => api.get("/ai/tool-calls", params).then((r) => listOf<AiToolCallView>(r, "tool_calls", "calls")),
    enabled: enabled && can("ai", "full"),
    retry: false,
  });
}

export function useAiInsights(enabled = true) {
  const { api, can } = useOrg();
  const key = useAiKey();
  return useQuery({
    queryKey: key("insights"),
    queryFn: () => api.get("/ai/insights").then((r) => listOf<AiInsight>(r, "insights")),
    enabled: enabled && can("ai", "view"),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: false,
  });
}

export function useAiBrief(enabled = true) {
  const { api, can } = useOrg();
  const key = useAiKey();
  return useQuery({
    queryKey: key("brief"),
    queryFn: () => api.get("/ai/brief").then((r) => objectOf<AiBriefView>(r, "brief")),
    enabled: enabled && can("ai", "view"),
    staleTime: 10 * 60_000,
    retry: false,
  });
}
