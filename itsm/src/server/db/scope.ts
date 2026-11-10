// The demo-data scope (docs/DEMO_FA.md, src/server/modules/demo): work done for an organisation's demo pack — the
// loader's writes, the jobs those writes queued (and theirs, transitively), the requests of the pack's own people —
// runs inside `inDemoScope(orgId, …)`. Both database layers then open every transaction with the transaction-local
// setting `itsm.demo = <org id>` (and run a lone write statement inside such a transaction), and the capture trigger
// of every table that has `id` and `org_id` (engine/ddl.ts `DEMO_CAPTURE_FN`, migration 0098_demo) records each row
// such a transaction inserts for that organisation in `sm_demo_rows`. The purge deletes exactly what is recorded
// there plus what refers to it.
//
// The scope is an AsyncLocalStorage value: it follows the async work started inside it and nothing else. The job
// queue sets it explicitly for every job it runs (a demo job's own writes are demo; any other job's are not), so a
// tick started from inside a demo request never lends the scope to unrelated jobs.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string | null>();

/** The organisation whose demo pack the current work belongs to, or null. */
export function demoScopeOrg(): string | null {
  return store.getStore() ?? null;
}

/** Run `fn` as work of `orgId`'s demo pack (null: explicitly outside any demo scope). */
export function inDemoScope<T>(orgId: string | null, fn: () => T): T {
  return store.run(orgId, fn);
}

/** The statement that marks a transaction as demo work (transaction-local). */
export const DEMO_SCOPE_SQL = "select set_config('itsm.demo', $1, true)";

/** Statements that may insert rows: outside a transaction they run inside one while a demo scope is active. */
const MAY_WRITE = /^\s*(insert|update|delete|with|merge|copy|call|do)\b/i;

/** Does a lone statement need a transaction carrying the demo setting? */
export function scopedWrite(text: string): boolean {
  return !!store.getStore() && MAY_WRITE.test(text);
}
