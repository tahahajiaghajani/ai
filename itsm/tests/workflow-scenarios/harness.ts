// Workflow scenarios end to end (release 1.1.5): custom fields, tabbed forms, organisational roles with holders,
// groups, people and units, and a workflow «گردش‌کار» — all made through the HTTP routes the screens call — then runs
// driven as different people (start, submit, claim, reassign, return, cancel, pause and resume, timers by moving
// `due_at` and running the timer), with assertions on paths, people per step, journal, case state, outcome and values.
// The twelve workflows W1–W12 (./w01-project.ts … ./w12-transfer.ts) are written once against this harness and run
// on every edition:
//
//   Edition                                   File                               How to run (from itsm/)
//   Windows app standalone (PGlite, desktop)  w01-project.test.ts … w12-*.test.ts npx vitest run --maxWorkers=1 tests/workflow-scenarios
//   the web's own job ticks (PGlite, cloud)   web-cadence.test.ts                (the same; no drain: after-write and traffic ticks only)
//   Windows app linked to an authority        linked.test.ts                     (the same; PGlite authority and PGlite apps)
//   server edition (PostgreSQL 16, its pool)  pg-server-{a,b}.test.ts            ITSM_PG_BIN=/usr/lib/postgresql/16/bin ITSM_PG_RUNAS=nobody \
//   web (PostgreSQL 16, webPoolOptions)       pg-web-{a,b}.test.ts                 npx vitest run --maxWorkers=1 tests/workflow-scenarios/pg-*.test.ts
//   web through Supavisor v2.9.13 (emulator)  pg-pooler.test.ts                  (or ITSM_PG_URL=postgres://… instead of ITSM_PG_BIN)
//   web cadence on PostgreSQL + the pooler    pg-pooler.test.ts                  (W1 and W2 drained, then a W11 run with the web's own ticks)
//
// The PostgreSQL suites are skipped unless ITSM_PG_URL or ITSM_PG_BIN is set (tests/pg-real.ts: a scratch database per
// world, or a throwaway cluster run as ITSM_PG_RUNAS when the tests run as root).
//
// The demo pack: the scenarios run «on the demo data», as the owner did — a pack row with demo sign-in on, and the pack's
// people marked as the loader marks them (an account with `prefs.demo_org`, recorded in `sm_demo_rows`). Their requests
// then run inside the demo scope (hono's loadOrg), so what they start is demo work; the organisation's own people (the
// owner, «real» people) start the organisation's own cases, which never go to the pack's people (FINAL-1).
//
// Assertions marked «1.1.5 (b)…(g)», RC1–RC4 assert behaviour this release adds (CaseDetail.waiting, the reresolve route,
// journal notes, estimate demo counts, eligibility-first requester_unit_up, the timer path's demo scope, approve plus
// skip journal text): they fail until wf-eng's work is merged.
import { expect } from "vitest";
import { Client, useServerDb } from "../helpers";
import { engineOrg, type EngineOrg } from "../engine-helpers";
import { createPgliteDb } from "@server/db/pglite";
import { createPostgresDb } from "@server/db/postgres";
import { webPoolOptions } from "@server/cloud";
import type { Db } from "@server/db";
import type { ServerConfig } from "@server/context";
import { resetTrafficTick, tick } from "@server/jobs";
import { extraDatabase, realPg, realPgAvailable, type RealPg } from "../pg-real";
import { backendOf, startPooler, type Pooler } from "../web-db-pooler";

export { realPgAvailable };

// ---------------------------------------------------------------------------------------------------------------
// The 1.1.5 contract (src/shared/process/waiting.ts, added by wf-eng and wf-ui): mirrored here, the file is theirs.

export interface StepWaiting {
  reason: "nobody" | "too_many";
  message: string;
  notes: string[];
  candidates?: { id: string; name: string; demo: boolean }[];
}
export interface ReresolveResult {
  status: "ok" | "managers" | "nobody" | "too_many";
  people: { id: string; name: string; demo: boolean }[];
  message: string | null;
  notes: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Editions

export type EditionKind = "desktop" | "cloud" | "server" | "web" | "pooler";

export interface Edition {
  kind: EditionKind;
  label: string;
  /** the world's mode: the Windows app («desktop») or a server («cloud») */
  mode: "desktop" | "cloud";
  /** the jobs a tick of this edition runs at once (the server edition's leader: 4) */
  concurrency: number;
  /** a new database for a world (null: PGlite in memory) */
  database: ((mode: "desktop" | "cloud") => Promise<Db>) | null;
  /** close what the edition opened (pools, the pooler, the cluster) */
  close(): Promise<void>;
  /** the pooler's counters (pooler edition) */
  pooler?: () => Pooler[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An edition opened once for the scenarios of a file (a PostgreSQL cluster), closed after them. */
export interface EditionRef {
  get(): Promise<Edition>;
  close(): Promise<void>;
}

export function editionRef(make: () => Promise<Edition> | Edition): EditionRef {
  let p: Promise<Edition> | null = null;
  return {
    get: () => (p ??= Promise.resolve(make())),
    async close() {
      if (p) await (await p).close();
      p = null;
    },
  };
}

/** The standalone Windows app: PGlite in memory, desktop mode (no after-write tick; the harness drains the queue). */
export function desktopEdition(): Edition {
  return { kind: "desktop", label: "Windows standalone (PGlite)", mode: "desktop", concurrency: 1, database: null, close: async () => undefined };
}

/** A cloud flavour on PGlite (the web's own ticks run here without a real PostgreSQL). */
export function cloudEdition(): Edition {
  return { kind: "cloud", label: "web flavour (PGlite)", mode: "cloud", concurrency: 1, database: null, close: async () => undefined };
}

/**
 * A PostgreSQL 16 edition: the server edition's pool (prepared statements, pipelining; the leader runs 4 jobs at once),
 * the web's pool (webPoolOptions: max 3, no pipelining, transaction limits, client deadlines), or the web's pool through
 * the Supavisor v2.9.13 emulator. Each world gets a database of its own on one cluster per file.
 */
export async function pgEdition(kind: "server" | "web" | "pooler", name: string): Promise<Edition> {
  const pg: RealPg = await realPg(`wfscen_${name}`);
  const pools: Db[] = [];
  const poolers: Pooler[] = [];
  let seq = 0;
  const database = async (mode: "desktop" | "cloud"): Promise<Db> => {
    // a Windows app keeps its own PGlite
    if (mode === "desktop") return createPgliteDb({ desktop: true });
    const url = await extraDatabase(pg, `wfscen_${name}_${process.pid}_${++seq}`);
    let db: Db;
    if (kind === "server") db = createPostgresDb({ url, max: 6, ssl: false, prepare: true });
    else {
      let through = url;
      if (kind === "pooler") {
        const p = await startPooler({ backend: backendOf(url), poolSize: 3 });
        poolers.push(p);
        through = `postgres://app:ignored@127.0.0.1:${p.port}/${new URL(url).pathname.slice(1)}`;
      }
      db = createPostgresDb({ ...webPoolOptions(through, { DATABASE_SSL: "disable" }), onEvent: undefined });
    }
    pools.push(db);
    return db;
  };
  return {
    kind,
    label: kind === "server" ? "server edition (PostgreSQL 16)" : kind === "web" ? "web (PostgreSQL 16, web pool)" : "web through Supavisor v2.9.13 (emulator)",
    mode: "cloud",
    concurrency: kind === "server" ? 4 : 1,
    database,
    pooler: () => poolers,
    async close() {
      useServerDb(null);
      await Promise.all(pools.splice(0).map((db) => Promise.race([db.close().catch(() => undefined), sleep(15_000)])));
      await Promise.all(poolers.splice(0).map((p) => p.close().catch(() => undefined)));
      await pg.stop();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Layout and graph helpers

type Cond = Record<string, unknown>;
export const item = (field: string, o: { required?: boolean; readonly?: boolean; hidden?: boolean; showIf?: Cond; span?: number } = {}) => ({ field, ...o });
export const note = (text: string, tone: "info" | "warning" = "info") => ({ text, tone });
export const section = (label: string | null, items: unknown[], columns: 1 | 2 = 1) => ({ label, columns, items });
export const tab = (label: string, sections: unknown[]) => ({ label, sections });

export interface GNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  label?: string;
}
export const n = (id: string, type: string, config: Record<string, unknown> = {}, label?: string): GNode => ({ id, type, config, ...(label ? { label } : {}) });
export const e = (source: string, target: string, port?: string) => ({ id: `${source}.${port ?? "out"}.${target}`, source, target, ...(port ? { port } : {}) });

export interface Draft {
  graph: { nodes: GNode[]; edges: ReturnType<typeof e>[] };
  starters?: unknown[];
  title_template?: string | null;
  requester_view?: string[];
  managers?: string[];
  manager_groups?: string[];
  confidential?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// The scenario world

export const PASS = "scenario-pass-1405";
let seq = 0;

export interface PersonOpts {
  unit?: string | null;
  manager?: string | null;
  roles?: string[];
  demo?: boolean;
  membership?: "member" | "viewer" | "admin";
  title?: string;
}

export interface Started {
  result: string;
  case: string;
  submission: string;
  note: string | null;
}

export interface TaskRow {
  id: string;
  step_key: string;
  round: number;
  assigned_to: string;
  delegated_from: string | null;
  claimed_by: string | null;
  status: string;
  outcome: string | null;
  acted_by: string | null;
  acted_for: string | null;
  comment: string | null;
  due_at: string | null;
  opened_at: string;
}

export interface CaseRow {
  id: string;
  number: string;
  title: string;
  state: string;
  outcome: string | null;
  data: Record<string, any>;
  progress: Record<string, any>;
  current_steps: { key: string; label: string }[];
  open_rounds: Record<string, number>;
  participants: string[];
  managers: string[];
  version_no: number;
  version_id: string;
  requested_by: string | null;
  requested_for: string | null;
  paused_at: string | null;
  run_ref: string | null;
  confidential: boolean;
}

/** One organisation of a scenario: its people, structure, forms and workflows, and the drivers of its runs. */
export class Scn {
  readonly P: string;
  readonly U: Record<string, string> = {};
  readonly C: Record<string, Client> = {};
  readonly email: Record<string, string> = {};
  readonly units: Record<string, string> = {};
  readonly groups: Record<string, string> = {};
  readonly positions: Record<string, string> = {};
  readonly forms: Record<string, string> = {};
  readonly procs: Record<string, { id: string; key: string }> = {};
  private names = new Map<string, string>();
  constructor(
    readonly ed: Edition,
    readonly o: EngineOrg,
    readonly cadence: "drain" | "web",
    /** the web's after-write and traffic ticks (cfg.waitUntil) still running */
    readonly pending: Promise<unknown>[] = [],
  ) {
    this.P = `/o/${o.org}`;
    this.U.owner = o.ownerId;
    this.C.owner = o.owner;
    this.names.set(o.ownerId, "owner");
  }

  get db(): Db {
    return this.o.db;
  }
  get org(): string {
    return this.o.org;
  }
  get cfg(): ServerConfig {
    return this.o.cfg;
  }
  get owner(): Client {
    return this.o.owner;
  }

  /** A person's id by key (or an id as given). */
  id = (key: string): string => this.U[key] ?? (/^[0-9a-f-]{36}$/i.test(key) ? key : (() => { throw new Error(`no person «${key}»`); })());
  ids = (...keys: string[]): string[] => keys.map(this.id);
  /** People's keys of ids, sorted (readable assertions). */
  keys = (ids: (string | null | undefined)[]): string[] => ids.filter((x): x is string => !!x).map((x) => this.names.get(x.toLowerCase()) ?? x).sort();
  key = (id: string | null | undefined): string | null => (id ? this.names.get(id.toLowerCase()) ?? id : null);
  as = (key: string): Client => this.C[key] ?? (() => { throw new Error(`no client for «${key}»`); })();
  u = (key: string): string => this.units[key] ?? (() => { throw new Error(`no unit «${key}»`); })();
  g = (key: string): string => this.groups[key] ?? (() => { throw new Error(`no group «${key}»`); })();

  // ----- structure (through the routes the screens call) -------------------------------------------------------

  /** «واحد سازمانی» (the organisation chart: the record API of org_unit). */
  async unit(key: string, name: string, kind: string, parent?: string | null, manager?: string | null): Promise<string> {
    const r = await this.owner.post(`${this.P}/r/org_unit`, { name, kind, parent_id: parent ? this.u(parent) : null, manager_id: manager ? this.id(manager) : null });
    this.units[key] = String(r.row.id);
    return this.units[key];
  }

  /** The unit's head («مدیر واحد»). */
  async unitHead(unit: string, person: string | null): Promise<void> {
    const cur = await this.owner.get(`${this.P}/r/org_unit/${this.u(unit)}`);
    await this.owner.patch(`${this.P}/r/org_unit/${this.u(unit)}`, { manager_id: person ? this.id(person) : null, version: cur.row.version });
  }

  /**
   * A member («اعضا»: an account with a password, signed in), their profile (unit, manager) and access roles; the
   * pack's people marked as the demo loader marks them.
   */
  async person(key: string, name: string, o: PersonOpts = {}): Promise<string> {
    const email = `${key}-${++seq}-${Date.now().toString(36)}@aftab-bank.example`;
    await this.owner.post(`${this.P}/members`, { email, password: PASS, full_name: name, role: o.membership ?? "member" });
    const id = (await this.db.one<{ id: string }>(`select id from sm_users where email = $1`, [email]))!.id;
    this.U[key] = id;
    this.email[key] = email;
    this.names.set(id.toLowerCase(), key);
    await this.owner.put(`${this.P}/access/members/${id}`, { roles: o.roles ?? ["requester"] });
    await this.profile(key, { org_unit_id: o.unit ? this.u(o.unit) : null, manager_id: o.manager ? this.id(o.manager) : null, ...(o.title ? { title: o.title } : {}) });
    if (o.demo) await this.markDemo(id);
    const c = new Client(this.o.app);
    await c.post("/auth/login", { email, password: PASS });
    this.C[key] = c;
    return id;
  }

  /** Mark an account as the pack's (what the demo loader does; no screen does it). */
  async markDemo(id: string): Promise<void> {
    await this.db.query(`update sm_users set prefs = coalesce(prefs, '{}'::jsonb) || jsonb_build_object('demo_org', $2::text) where id = $1`, [id, this.org]);
    await this.db.query(`insert into sm_demo_rows (org_id, row_id, tbl) values ($1, $2, 'sm_users') on conflict do nothing`, [this.org, id]);
  }

  /** Change a member's profile («پروفایل اعضا»: unit, manager, out of office, delegate). */
  async profile(key: string, patch: Record<string, unknown>): Promise<void> {
    const id = this.id(key);
    const have = await this.db.one<{ id: string; version: number }>(`select id, version from sm_member_profiles where org_id = $1 and user_id = $2 and deleted_at is null`, [this.org, id]);
    if (have) await this.owner.patch(`${this.P}/r/member_profile/${have.id}`, { ...patch, version: have.version });
    else await this.owner.post(`${this.P}/r/member_profile`, { user_id: id, ...patch });
  }

  /** «فیلدها»: a library field. */
  async field(name: string, label: string, type: string, more: Record<string, unknown> = {}): Promise<string> {
    return String((await this.owner.post(`${this.P}/fields/library`, { name, label, type, ...more }, 201)).row.id);
  }

  /** «فرم‌ها»: a process form with tabs and sections. */
  async form(key: string, name: string, tabs: unknown[]): Promise<string> {
    this.forms[key] = String((await this.owner.post(`${this.P}/forms`, { name, layout: { tabs } }, 201)).form.id);
    return this.forms[key];
  }

  /** «نقش‌های سازمانی»: a position. */
  async position(key: string, name: string, o: { unitKind?: string | null; reportsTo?: string | null; active?: boolean } = {}): Promise<string> {
    const r = await this.owner.post(`${this.P}/r/position`, { key, name, unit_kind: o.unitKind ?? null, reports_to: o.reportsTo ? this.positions[o.reportsTo] : null, active: o.active ?? true });
    this.positions[key] = String(r.row.id);
    return this.positions[key];
  }

  /** A holder of a position in a unit («دارندگان»). */
  async hold(position: string, person: string, unit: string | null, o: { kind?: string; from?: string | null; to?: string | null } = {}): Promise<string> {
    const r = await this.owner.post(`${this.P}/r/position_holder`, {
      position_id: this.positions[position], user_id: this.id(person), org_unit_id: unit ? this.u(unit) : null, kind: o.kind ?? "primary", valid_from: o.from ?? null, valid_to: o.to ?? null,
    });
    return String(r.row.id);
  }

  /** A group with its members and leads. */
  async group(key: string, name: string, members: string[], leads: string[] = [], more: Record<string, unknown> = {}): Promise<string> {
    const r = await this.owner.post(`${this.P}/r/group`, { name, ...more });
    this.groups[key] = String(r.row.id);
    for (const m of members) await this.owner.post(`${this.P}/r/group_member`, { group_id: this.groups[key], user_id: this.id(m), kind: "member" });
    for (const m of leads) await this.owner.post(`${this.P}/r/group_member`, { group_id: this.groups[key], user_id: this.id(m), kind: "lead" });
    return this.groups[key];
  }

  /** The designer: a new process, its draft (autosave), then «انتشار» (a recent sign-in). */
  async publish(key: string, name: string, draft: Draft, note?: string): Promise<{ id: string; key: string; version: string; problems: any[] }> {
    let id = this.procs[key]?.id;
    if (!id) {
      id = String((await this.owner.post(`${this.P}/process/defs`, { name, key }, 201)).process.id);
      this.procs[key] = { id, key };
    }
    const saved = await this.saveDraft(key, draft);
    await this.db.query(`update sm_sessions set reauth_at = now() where user_id = $1`, [this.o.ownerId]);
    const pub = await this.owner.post(`${this.P}/process/defs/${id}/publish`, { note: note ?? null });
    await this.settle();
    return { id, key, version: String(pub.version.id), problems: saved.problems ?? [] };
  }

  async saveDraft(key: string, draft: Draft): Promise<any> {
    const full = { starters: [], title_template: null, requester_view: [], managers: [], manager_groups: [], confidential: false, ...draft };
    return this.owner.put(`${this.P}/process/defs/${this.procs[key].id}/draft`, { draft: full });
  }

  // ----- runs ---------------------------------------------------------------------------------------------------

  /** «آغاز پرونده» as `who` (the start page's POST /process/start). */
  async start(who: string, proc: string, values: Record<string, unknown> = {}, o: { requested_for?: string; case_id?: string; expect?: number } = {}): Promise<Started> {
    const r = await this.as(who).post(
      `${this.P}/process/start`,
      { process: this.procs[proc]?.key ?? proc, values, ...(o.requested_for ? { requested_for: this.id(o.requested_for) } : {}), ...(o.case_id ? { case_id: o.case_id } : {}) },
      o.expect ?? 201,
    );
    await this.afterRequest();
    return r as Started;
  }

  /** Any request as `who`, whatever its status: { status, body }. */
  async raw(who: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
    const c = this.as(who);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (c.cookie) headers.cookie = c.cookie;
    if (c.token) headers.authorization = `Bearer ${c.token}`;
    const res = await this.o.app.fetch(new Request(`http://local.test/api${this.P}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    await this.afterRequest();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /** A refused request: its message (and field problems). */
  async refused(p: Promise<any>): Promise<{ message: string; fields: Record<string, string>; code: string }> {
    const r = await p;
    return { message: r?.error?.message ?? "", fields: r?.error?.details?.fields ?? {}, code: r?.error?.code ?? "" };
  }

  /** The case as `who` reads it (GET /process/cases/:id). */
  detail(who: string, caseId: string, expect = 200): Promise<any> {
    return this.as(who).get(`${this.P}/process/cases/${caseId}`, expect);
  }

  /** `who`'s open step at `step` on the case page (my_steps), or throws. */
  async myStep(who: string, caseId: string, step: string): Promise<any> {
    const d = await this.detail(who, caseId);
    const s = (d.my_steps as any[]).find((x) => x.step_key === step);
    if (!s) throw new Error(`${who} has no open step «${step}» on ${caseId}: ${JSON.stringify({ my_steps: d.my_steps.map((x: any) => x.step_key), open: await this.openAt(caseId, step) })}`);
    return s;
  }

  /** «ارسال» of `who`'s open step (found on the case page, as the step form does). */
  async submit(who: string, caseId: string, step: string, input: { outcome?: string; values?: Record<string, unknown>; comment?: string; return_to?: string } = {}, expect = 200): Promise<any> {
    const s = await this.myStep(who, caseId, step);
    return this.submitTask(who, s.id, input, expect);
  }

  async submitTask(who: string, taskId: string, input: { outcome?: string; values?: Record<string, unknown>; comment?: string; return_to?: string } = {}, expect = 200): Promise<any> {
    const r = await this.as(who).post(`${this.P}/process/tasks/${taskId}/submit`, input, expect);
    await this.afterRequest();
    return r;
  }

  /** A multipart start or submit with files (values name them as `{ upload: n }`). */
  async multipart(who: string, path: string, payload: Record<string, unknown>, files: { name: string; data: Uint8Array; type?: string }[], expect: number): Promise<any> {
    const form = new FormData();
    form.append("payload", JSON.stringify(payload));
    for (const f of files) form.append("files", new File([Buffer.from(f.data)], f.name, { type: f.type ?? "application/pdf" }));
    const c = this.as(who);
    const headers: Record<string, string> = {};
    if (c.cookie) headers.cookie = c.cookie;
    const res = await this.o.app.fetch(new Request(`http://local.test/api${this.P}${path}`, { method: "POST", headers, body: form }));
    const text = await res.text();
    if (res.status !== expect) throw new Error(`POST ${path} → ${res.status}: ${text}`);
    await this.afterRequest();
    return text ? JSON.parse(text) : null;
  }

  async claim(who: string, caseId: string, step: string, expect = 200): Promise<any> {
    const s = await this.myStep(who, caseId, step);
    const r = await this.as(who).post(`${this.P}/process/tasks/${s.id}/claim`, {}, expect);
    await this.afterRequest();
    return r;
  }

  async release(who: string, caseId: string, step: string, expect = 200): Promise<any> {
    const s = await this.myStep(who, caseId, step);
    const r = await this.as(who).del(`${this.P}/process/tasks/${s.id}/claim`, expect);
    await this.afterRequest();
    return r;
  }

  /** A manager's «ارجاع» (to people; `task`: the task that moves). */
  async reassign(who: string, caseId: string, step: string, to: string[], o: { task?: string; comment?: string; expect?: number } = {}): Promise<any> {
    const r = await this.as(who).post(`${this.P}/process/cases/${caseId}/reassign`, { step, to: this.ids(...to), ...(o.task ? { task: o.task } : {}), ...(o.comment ? { comment: o.comment } : {}) }, o.expect ?? 200);
    await this.afterRequest();
    return r;
  }

  /** The 1.1.5 managers' «دوباره پیدا کردن انجام‌دهنده» (contract (c)). */
  async reresolve(who: string, caseId: string, step: string, rules?: "case" | "current", expect = 200): Promise<ReresolveResult> {
    const r = await this.as(who).post(`${this.P}/process/cases/${caseId}/reresolve`, { step, ...(rules ? { rules } : {}) }, expect);
    await this.afterRequest();
    return r;
  }

  async caseAction(who: string, caseId: string, action: "pause" | "resume" | "cancel", comment?: string, expect = 200): Promise<any> {
    const r = await this.as(who).post(`${this.P}/process/cases/${caseId}/${action}`, comment ? { comment } : {}, expect);
    await this.afterRequest();
    return r;
  }

  async resumeFrom(who: string, caseId: string, node: string, comment?: string, expect = 200): Promise<any> {
    const r = await this.as(who).post(`${this.P}/process/cases/${caseId}/resume-from`, { node, ...(comment ? { comment } : {}) }, expect);
    await this.afterRequest();
    return r;
  }

  /** «ذخیرهٔ پیش‌نویس» (process_draft rows of the record API, as the start page and the step form keep them). */
  async saveStartDraft(who: string, proc: string, values: Record<string, unknown>): Promise<string> {
    return String((await this.as(who).post(`${this.P}/r/process_draft`, { process_id: this.procs[proc].id, values })).row.id);
  }

  // ----- the queue and the clock ---------------------------------------------------------------------------------

  /** After a request: the web's own ticks run (cadence «web»); otherwise nothing (the harness settles). */
  private async afterRequest(): Promise<void> {
    if (this.cadence === "web") await Promise.allSettled(this.pending.splice(0));
  }

  /** Run what is due, as the edition would: drained (Windows' 10 s timer, the server's leader, the web's heartbeat). */
  async settle(): Promise<void> {
    if (this.cadence === "web") {
      await Promise.allSettled(this.pending.splice(0));
      return;
    }
    for (let i = 0; i < 200; i++) {
      const r = await tick(this.cfg, { budgetMs: 20_000, concurrency: this.ed.concurrency });
      if (r.busy) {
        await sleep(20);
        continue;
      }
      if (!r.more && r.ran + r.failed === 0) return;
    }
    throw new Error("the queue did not settle");
  }

  /** The web's traffic clock forgotten («a minute later»): the next request may run a traffic tick. */
  minuteLater(): void {
    resetTrafficTick();
  }

  /** Time passes for a case's step: its tasks opened (and were reminded, escalated, fall due) `ms` earlier. */
  async elapse(caseId: string, step: string, ms: number): Promise<void> {
    await this.db.query(
      `update sm_process_tasks set opened_at = opened_at - $3 * interval '1 millisecond', due_at = due_at - $3 * interval '1 millisecond',
         reminded_at = reminded_at - $3 * interval '1 millisecond', escalated_at = escalated_at - $3 * interval '1 millisecond',
         timers_from = timers_from - $3 * interval '1 millisecond'
       where org_id = $4 and case_id = $1 and step_key = $2`,
      [caseId, step, ms, this.org],
    );
  }

  /** The organisation's process.timer (and the jobs of `kinds`) run now, then everything due. */
  async timers(kinds: string[] = ["process.timer"]): Promise<void> {
    await this.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = any($2::text[]) and status = 'queued'`, [this.org, `{${kinds.join(",")}}`]);
    await this.settle();
  }

  /** Every flow timer of the organisation's runs (a «انتظار» step) due now, then everything due. */
  async waitsDue(): Promise<void> {
    await this.db.query(`update sm_flow_waits set due_at = now() - interval '1 second' where org_id = $1 and due_at is not null`, [this.org]);
    await this.db.query(`update sm_jobs set run_at = now() - interval '1 second' where org_id = $1 and kind = 'flows.timer' and status = 'queued'`, [this.org]);
    await this.settle();
  }

  // ----- readers --------------------------------------------------------------------------------------------------

  kase(id: string): Promise<CaseRow> {
    return this.db.one<CaseRow>(`select * from sm_process_cases where id = $1`, [id]) as Promise<CaseRow>;
  }

  tasks(caseId: string): Promise<TaskRow[]> {
    return this.db.query<TaskRow>(`select * from sm_process_tasks where case_id = $1 and deleted_at is null order by opened_at, round, assigned_to`, [caseId]);
  }

  /** Who holds an open task of `step` (its latest open round), by key. */
  async openAt(caseId: string, step: string): Promise<string[]> {
    const t = (await this.tasks(caseId)).filter((x) => x.step_key === step && x.status === "open");
    return this.keys(t.map((x) => x.assigned_to));
  }

  /** The tasks of a step as «key:status» (latest round when `round` is omitted). */
  async at(caseId: string, step: string, round?: number): Promise<string[]> {
    const all = (await this.tasks(caseId)).filter((x) => x.step_key === step);
    const r = round ?? Math.max(0, ...all.map((x) => Number(x.round)));
    return all.filter((x) => Number(x.round) === r).map((x) => `${this.key(x.assigned_to)}:${x.status}`).sort();
  }

  async journal(caseId: string): Promise<string[]> {
    return (await this.db.query<{ body: string }>(`select body from sm_journal where table_key = 'process_case' and record_id = $1 order by created_at, id`, [caseId])).map((r) => r.body);
  }

  async isDemo(rowId: string): Promise<boolean> {
    return !!(await this.db.one(`select 1 as x from sm_demo_rows where org_id = $1 and row_id = $2`, [this.org, rowId]));
  }

  /** The bells of a person (newest last): titles. */
  async bells(who: string): Promise<string[]> {
    return (await this.db.query<{ title: string }>(`select title from sm_notifications where org_id = $1 and user_id = $2 order by created_at, id`, [this.org, this.id(who)])).map((r) => r.title);
  }

  /** The path the case's run took, in the order of its log: «node:port» for a completed step, «node:status» else. */
  async path(caseId: string): Promise<string[]> {
    const k = await this.kase(caseId);
    if (!k.run_ref) return [];
    const rows = await this.db.query<{ node_id: string; status: string; port: string | null }>(
      `select node_id, status, port from sm_flow_run_steps where run_id = $1 order by started_at, id`,
      [k.run_ref],
    );
    // a completed step as «node:port» (an end as «node»), any other as «node:status»
    return rows.map((r) => (r.status === "completed" ? `${r.node_id}${r.port ? `:${r.port}` : ""}` : `${r.node_id}:${r.status}${r.port ? `:${r.port}` : ""}`));
  }

  /** A submission's result and note. */
  submission(id: string): Promise<{ result: string; result_note: string | null; values: Record<string, unknown> } | null> {
    return this.db.one(`select result, result_note, values from sm_process_submissions where id = $1`, [id]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Worlds

export interface WorldOptions {
  /** the web's own ticks only (cfg.waitUntil wired, nothing drains the queue) */
  cadence?: "drain" | "web";
  /** no demo pack row (an organisation that never loaded the pack) */
  noPack?: boolean;
}

/** A new organisation on the edition, with the pack loaded and demo sign-in on, and the workflows' notices seeded. */
export async function world(ed: Edition, opts: WorldOptions = {}): Promise<Scn> {
  const cadence = opts.cadence ?? "drain";
  const pending: Promise<unknown>[] = [];
  useServerDb(ed.database);
  const config: Partial<ServerConfig> | undefined = cadence === "web" ? { waitUntil: (w: () => Promise<unknown>) => void pending.push(w()) } : undefined;
  const o = await engineOrg({ mode: ed.mode, config });
  useServerDb(null);
  const s = new Scn(ed, o, cadence, pending);
  if (!opts.noPack) {
    await s.db.query(`insert into sm_demo_packs (org_id, state, size, options, started_by) values ($1, 'loaded', 'small', '{"signin": true}'::jsonb, $2)`, [s.org, s.o.ownerId]);
  }
  // the workflows' notices («مرحله‌ای منتظر شماست» …): the seeding job a new organisation gets 12.5 minutes later
  await s.db.query(`update sm_jobs set run_at = now() where org_id = $1 and kind = 'process.seed' and status = 'queued'`, [s.org]);
  if (cadence === "web") {
    // the heartbeat's one tick for the setup (the web edition's pg_cron); runs are then left to the web's own ticks
    for (let i = 0; i < 50; i++) {
      const r = await tick(s.cfg, { budgetMs: 20_000 });
      if (!r.more && r.ran + r.failed === 0) break;
    }
  } else await s.settle();
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// The bank of the scenarios: «بانک نمونهٔ آفتاب» (fictional), its units — head office departments, two provinces with
// their branches — and the people most workflows use. Each workflow adds its own.

export const UNITS: [key: string, name: string, kind: string, parent: string | null][] = [
  ["hq", "بانک نمونهٔ آفتاب", "company", null],
  ["it", "ادارهٔ کل فناوری اطلاعات", "department", "hq"],
  ["fin", "ادارهٔ کل امور مالی", "department", "hq"],
  ["hr", "ادارهٔ کل منابع انسانی", "department", "hq"],
  ["sec", "ادارهٔ کل امنیت اطلاعات", "department", "hq"],
  ["alborz", "امور شعب استان البرز", "division", "hq"],
  ["lorestan", "امور شعب استان لرستان", "division", "hq"],
  ["b0", "شعبهٔ کرج مرکزی", "branch", "alborz"],
  ["b1", "شعبهٔ فردیس", "branch", "alborz"],
  ["b2", "شعبهٔ خرم‌آباد", "branch", "lorestan"],
  ["b3", "شعبهٔ بروجرد", "branch", "lorestan"],
  ["b4", "شعبهٔ کوهدشت", "branch", "lorestan"],
  ["b5", "شعبهٔ نظرآباد", "branch", "alborz"],
];

export async function bankUnits(s: Scn): Promise<void> {
  for (const [key, name, kind, parent] of UNITS) await s.unit(key, name, kind, parent);
}

/** Expect a refusal: the status and the message (or a part of it). */
export async function refusedWith(p: Promise<any>, text: string): Promise<any> {
  const r = await p;
  expect(String(r?.error?.message ?? ""), JSON.stringify(r)).toContain(text);
  return r;
}

export const H = 3_600_000;
export const DAY = 24 * H;
/** A 1×1 PNG. */
export const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==", "base64"));

/** Today and other days in the organisation's time zone (Asia/Tehran), as the date fields take them. */
export function tehranDay(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * DAY);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
