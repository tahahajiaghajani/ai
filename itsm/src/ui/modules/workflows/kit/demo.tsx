// The demo pack's people in the workflow screens (release 1.1.5, docs/DEMO_FA.md): who they are (GET
// /positions/demo-people, lower-case ids; empty without a pack) and the «نمایشی» tag beside their names. The pack's
// people never take the organisation's own work (FINAL-1): a real case's step leaves them out, so the screens that
// list holders or people mark them, and a real case's pickers leave them out.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AccessGate } from "@shared/access";
import { PROCESS_DESIGN_AREA } from "@shared/tables/fields";
import { useOrg } from "../../../lib/org";
import { Chip } from "../../../components/display";
import { kitApi } from "./api";
import "./demo.css";

/** Who may read the pack's people: whoever opens the designer or the positions page (the server's rule). */
export const DEMO_PEOPLE_GATES: AccessGate[] = [{ area: PROCESS_DESIGN_AREA }, { area: "org" }];

const NONE: ReadonlySet<string> = new Set();

/** The ids of a DemoPeople answer as a set (lower case; anything not a string left out). */
export function demoSet(users: readonly unknown[] | null | undefined): ReadonlySet<string> {
  const ids = (users ?? []).filter((u): u is string => typeof u === "string" && !!u).map((u) => u.toLowerCase());
  return ids.length ? new Set(ids) : NONE;
}

/** Is `id` one of the pack's people? */
export const isDemo = (demo: ReadonlySet<string>, id: string | null | undefined): boolean => !!id && demo.has(id.toLowerCase());

export const DEMO_PEOPLE_KEY = (org: string) => ["wfk-demo-people", org] as const;

/**
 * The organisation's demo pack people (empty without a pack, for someone the server does not tell, or when the read
 * fails: the screens then simply mark nobody).
 */
export function useDemoPeople(): ReadonlySet<string> {
  const { api, orgId, allows } = useOrg();
  const may = DEMO_PEOPLE_GATES.some((g) => allows(g));
  const q = useQuery({ queryKey: DEMO_PEOPLE_KEY(orgId), queryFn: () => kitApi.demoPeople(api), enabled: may, staleTime: 300_000, retry: false });
  const users = q.data?.users;
  return useMemo(() => demoSet(users), [users]);
}

/** «نمایشی» beside a person (or a case) of the demo pack. */
export function DemoTag({ title }: { title?: string }) {
  return (
    <Chip tone="info" dot={false} className="wfk-demo" title={title ?? "حساب نمایشی (دادهٔ نمایشی)"}>
      نمایشی
    </Chip>
  );
}
