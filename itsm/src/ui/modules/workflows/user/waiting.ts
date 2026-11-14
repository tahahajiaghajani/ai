// What waits for the person in «گردش‌کارها», for the portal (design F §5 «Navigation»; package F7): most bank staff
// work in the portal, so a step waiting for them — a case returned to its requester for correction, a head's approval —
// counts in the portal's «کارهای من» badge, and «کارهای من» lists it (./PortalSteps.tsx). One query, «کارتابل»
// (GET /process/inbox), shared with the portal home's card and the «گردش‌کارها» page, and live with cases, steps and
// approvals («wf-user»). Light on purpose: the portal's shell imports it.
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "../../../lib/org";
import { USER_KEYS, userApi } from "./api";

/** «کارتابل»: my open steps and my pending record approvals. */
export function useInbox(enabled = true) {
  const { api, orgId } = useOrg();
  return useQuery({ queryKey: USER_KEYS.inbox(orgId), queryFn: () => userApi.inbox(api), staleTime: 30_000, retry: false, enabled });
}

/**
 * How many of my process steps wait, and whether that is still being read. The record approvals of «کارتابل» are
 * not counted: the portal counts and lists them itself, from the same approvals service.
 */
export function useWaitingSteps(enabled = true): { count: number; loading: boolean } {
  const q = useInbox(enabled);
  return { count: q.data?.counts.steps ?? 0, loading: q.isLoading };
}
