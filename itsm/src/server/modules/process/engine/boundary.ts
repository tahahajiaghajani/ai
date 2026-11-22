// The demo boundary of workflow cases (docs/DEMO_FA.md, release 1.1.5), both ways:
//   · a case of the organisation's demo pack is the pack's: every write on it runs inside the pack's demo scope, whoever
//     makes it — a real holder's decision and the steps it opens, a real holder's «برداشتن کار», a real manager's
//     «ارجاع», pause, resume, cancel, «ادامه از» and «دوباره پیدا کردن انجام‌دهنده», the organisation's own timer and
//     jobs (../timers, ../reresolve, ../sync) — so its rows are the pack's rows, its jobs demo jobs that go on in the
//     scope, and the purge takes all of it with the case;
//   · any other case is the organisation's own: every write on it runs outside every demo scope, whoever makes it (a
//     request of the pack's people runs inside the scope, http/hono.ts), and the pack's people take none of its work —
//     neither as a step's people (FINAL-1: the resolver, «ارجاع» and the delegations leave them out, and a decision
//     of a step they still hold or stand in for is refused) nor as its managers (refused: `demoRealWork`).
// Reads before the caller's transaction (PGlite has one connection), or through it.
import type { Ctx } from "../../../context";
import type { Queryable } from "../../../db";
import { demoPeople, inDemoScope, isDemoRow } from "../../../db/scope";
import { isSystemCtx } from "../../../engine";
import { isId } from "./store";

/** Is the case a row of the organisation's demo pack? */
export async function isPackCase(q: Queryable, orgId: string, caseId: string | null | undefined): Promise<boolean> {
  return isId(caseId) && (await isDemoRow(q, orgId, caseId.toLowerCase()));
}

/** Run `fn` as the case's work: inside the pack's demo scope for a case of the pack's, outside every demo scope else. */
export async function inCaseScope<T>(q: Queryable, orgId: string, caseId: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  return inDemoScope((await isPackCase(q, orgId, caseId)) ? orgId : null, fn);
}

/** Is the caller one of the demo pack's people, asking to act on a case of the organisation's own? */
export async function packOnRealCase(q: Queryable, ctx: Ctx, caseId: string): Promise<boolean> {
  if (isSystemCtx(ctx) || !isId(ctx.user?.id)) return false;
  if (!(await demoPeople(q, ctx.org.id, [ctx.user.id])).size) return false;
  return !(await isPackCase(q, ctx.org.id, caseId));
}
