// Hooks shared by the assistant's parts and the shell (Topbar button, Ctrl K palette).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../lib/org";
import { ApiError } from "../../lib/api";
import { aiClient, type AiClient, type AiStatus } from "../client";

export function useAiClient(): AiClient {
  const { api } = useOrg();
  return useMemo(() => aiClient(api), [api]);
}

/** May the signed-in member use the assistant at all (ai:view)? */
export function useCanAsk(): boolean {
  const { can } = useOrg();
  return can("ai", "view");
}

/**
 * GET /ai/status (cached for a minute). `data` stays undefined while it loads or when the endpoint is missing;
 * callers treat «unknown» as «may ask», and the panel shows the real state once it arrives.
 */
export function useAiStatus() {
  const { orgId } = useOrg();
  const client = useAiClient();
  const allowed = useCanAsk();
  return useQuery<AiStatus>({
    queryKey: ["ai", orgId, "status"],
    queryFn: () => client.status(),
    enabled: allowed,
    staleTime: 60_000,
    retry: (n, e) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
  });
}

/** The assistant is switched off (organisation or platform). */
export const isOff = (s: AiStatus | undefined) => !!s && (!s.enabled || s.features?.assistant === false);

/**
 * The Topbar button and the palette rows hide when the assistant is off for someone who cannot switch it on; people
 * who manage AI keep them (the panel then says what to do).
 */
export const switchedOff = (s: AiStatus | undefined) => isOff(s) && !s?.can_manage;

export function useThreads(enabled: boolean, q = "") {
  const { orgId } = useOrg();
  const client = useAiClient();
  return useQuery({ queryKey: ["ai", orgId, "threads", q], queryFn: () => client.threads(q || undefined), enabled, staleTime: 30_000, placeholderData: (prev) => prev });
}
