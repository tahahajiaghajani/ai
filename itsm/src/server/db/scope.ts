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
import type { Queryable } from "./index";

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

/** Is `id` a row of `orgId`'s demo pack (recorded in sm_demo_rows)? */
export async function isDemoRow(q: Queryable, orgId: string, id: string | null | undefined): Promise<boolean> {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
  return !!(await q.one(`select 1 from sm_demo_rows where org_id = $1 and row_id = $2::uuid`, [orgId, id]));
}

/**
 * Must nothing about this leave the system (docs/DEMO_FA.md)? True inside `orgId`'s demo scope (demo work, a demo
 * person's request, a demo job) and for a record of the demo pack: no email, SMS, webhook, messenger or other outbound
 * message, and in-app bells to the pack's own people only.
 */
export async function demoQuiet(q: Queryable, orgId: string, recordId?: string | null): Promise<boolean> {
  if (demoScopeOrg() === orgId) return true;
  return isDemoRow(q, orgId, recordId);
}

/** The pack's people among `users` (accounts marked with the organisation's demo pack). */
export async function demoPeople(q: Queryable, orgId: string, users: string[]): Promise<Set<string>> {
  users = users.filter((u) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u));
  if (!users.length) return new Set();
  const rows = await q.query<{ id: string }>(`select id::text as id from sm_users where id::text = any($1::text[]) and prefs ->> 'demo_org' = $2`, [`{${users.map((u) => u.toLowerCase()).join(",")}}`, orgId]);
  return new Set(rows.map((r) => r.id.toLowerCase()));
}

/** What a refused outbound call tells a person: nothing of the demo pack left the system. */
export const DEMO_OUTBOUND_TEXT = "داده‌های نمایشی از سامانه بیرون نمی‌رود؛ چیزی فرستاده نشد";

/** Thrown by an outbound sender asked to send something inside the demo scope (nothing of demo work leaves the system). */
export class DemoOutboundError extends Error {
  constructor() {
    super("demo: nothing of the demo pack leaves the system");
  }
}

/** Refuse an outbound message (email, SMS, messenger, webhook, HTTP call of a flow) inside a demo scope. */
export function assertNotDemoOutbound(): void {
  if (store.getStore()) throw new DemoOutboundError();
}

/**
 * `f` refusing inside a demo scope, before any connection (a rejected DemoOutboundError): the fetch of the platform's
 * outbound clients — the integration hub's `outsideFetch`/`callOut`, messengers and SMS gateways, the portal's bots,
 * flows' HTTP calls, the CMDB's URL sources, the event module's SNS confirmation — so that a caller added later
 * cannot send demo work out either. The AI providers' fetch is the one deliberate exception (docs/DEMO_FA.md: the
 * organisation's own model under its data-use policy; the demo script asks the assistant about demo records).
 */
export function demoSafeFetch(f: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => (store.getStore() ? Promise.reject(new DemoOutboundError()) : f(input, init))) as typeof fetch;
}
