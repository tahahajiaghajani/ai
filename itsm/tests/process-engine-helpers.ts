// Helpers of the workflow engine suites (tests/process-engine-*.test.ts): an organisation with library fields and
// forms, people made fast (account, membership and profile), a process published straight into a version (graph,
// form snapshot, starters, title, managers — F4c's publish is not needed for the engine), and the people's online
// actions through the engine's services.
import { create, createIn, systemCtx, updateIn } from "@server/engine";
import { loadFormsSnapshot } from "@server/modules/forms";
import { cancelCase, startCase, submitTask, type StartCaseInput, type SubmitTaskInput } from "@server/modules/process/engine";
import { uuidv7 } from "@shared/id";
import type { Ctx } from "@server/context";
import type { ProcessGraph } from "@shared/process/graph";
import { engineOrg, type EngineOrg } from "./engine-helpers";
import { flowsKit, type FlowsKit } from "./flows-helpers";

export interface World {
  o: EngineOrg;
  k: FlowsKit;
  sys: Ctx;
  P: string;
  forms: Record<string, string>;
}

type N = ProcessGraph["nodes"][number];
export const node = (id: string, type: N["type"], config: Record<string, unknown> = {}, label?: string): N => ({ id, type, config, ...(label ? { label } : {}) });
export const edge = (source: string, target: string, port?: string) => ({ id: `${source}.${port ?? "out"}.${target}`, source, target, ...(port ? { port } : {}) });
export const users = (...ids: string[]) => ({ assignees: [{ kind: "users", users: ids }] });
const layout = (fields: (string | { field: string; required?: boolean })[]) => ({
  tabs: [{ label: "فرم", sections: [{ label: null, items: fields.map((f) => (typeof f === "string" ? { field: f } : f)) }] }],
});

/** An organisation with the library fields and forms the suites use. */
export async function world(): Promise<World> {
  const o = await engineOrg();
  const k = flowsKit(o);
  const sys = await systemCtx(o.cfg, o.org);
  const P = `/o/${o.org}`;
  const lib: [string, string, string, Record<string, unknown>][] = [
    ["u_amount", "مبلغ درخواستی", "money", { validation: { max: 2_000_000_000 } }],
    ["u_need", "شرح نیاز", "text", {}],
    ["u_date", "تاریخ نیاز", "date", { validation: { minDate: "$today" } }],
    ["u_invoice", "فاکتور پیش", "attachment", { validation: { max: 3 } }],
    ["u_branch", "شعبه", "unit", {}],
    ["u_finance_note", "نظر مالی", "text", {}],
    ["u_legal", "نظر حقوقی", "text", {}],
    ["u_fin", "نظر مالی موازی", "text", {}],
    ["u_old", "فیلد قدیمی", "string", {}],
  ];
  for (const [name, label, type, more] of lib) await o.owner.post(`${P}/fields/library`, { name, label, type, ...more }, 201);
  const forms: Record<string, string> = {};
  const make = async (key: string, name: string, items: (string | { field: string; required?: boolean })[]) => {
    forms[key] = (await o.owner.post(`${P}/forms`, { name, layout: layout(items) }, 201)).form.id;
  };
  await make("req", "فرم درخواست", [{ field: "u_amount", required: true }, "u_need", "u_date", "u_invoice", "u_branch"]);
  await make("review", "فرم بررسی مالی", ["u_amount", "u_need", "u_date", "u_invoice", "u_branch", "u_finance_note"]);
  await make("legal", "فرم حقوقی", ["u_legal", "u_amount"]);
  await make("fin", "فرم مالی", ["u_fin", "u_amount"]);
  await make("old", "فرم قدیمی", [{ field: "u_amount", required: true }, "u_old"]);
  return { o, k, sys, P, forms };
}

let seq = 0;

/** A member made fast: the account and membership by SQL, the profile through the engine. */
export async function person(w: World, name: string, o: { unit?: string | null; manager?: string | null } = {}): Promise<string> {
  const id = uuidv7();
  await w.o.db.query(`insert into sm_users (id, email, full_name) values ($1, $2, $3)`, [id, `p${++seq}-${id.slice(-8)}@bank.test`, name]);
  await w.o.db.query(`insert into sm_org_members (id, org_id, user_id, role, is_active) values ($1, $2, $3, 'member', true)`, [uuidv7(), w.o.org, id]);
  await w.sys.write((tx) => createIn(tx, w.sys, "member_profile", { user_id: id, name, org_unit_id: o.unit ?? null, manager_id: o.manager ?? null, roles: [], persona: "requester" }, { trusted: true }));
  return id;
}

export interface Published {
  process: string;
  version: string;
  key: string;
  name: string;
}

/** Publish `graph` straight into a version of a new process (status published, current version set). */
export async function publish(
  w: World,
  graph: ProcessGraph,
  opts: { name?: string; forms?: string[]; starters?: unknown[]; title?: string | null; managers?: string[]; confidential?: boolean; process?: string } = {},
): Promise<Published> {
  const n = ++seq;
  const name = opts.name ?? `گردش‌کار ${n}`;
  const key = `proc_${n}_${uuidv7().slice(-6)}`;
  const procId = opts.process ?? String((await create(w.sys, "process", { name, key, status: "published" }, { trusted: true })).row.id);
  const prior = await w.o.db.one<{ n: number }>(`select coalesce(max(version_no), 0)::int as n from sm_process_versions where process_id = $1`, [procId]);
  // every form but «فرم قدیمی» (a suite retires its field)
  const formIds = opts.forms ?? Object.entries(w.forms).filter(([k]) => k !== "old").map(([, id]) => id);
  const { snapshot, problems } = await loadFormsSnapshot(w.o.db, w.sys, formIds);
  if (problems.length) throw new Error(problems.join("; "));
  const version = (
    await create(
      w.sys,
      "process_version",
      {
        process_id: procId, name, version_no: (prior?.n ?? 0) + 1, graph, forms: snapshot, starters: opts.starters ?? [], title_template: opts.title ?? null,
        managers: opts.managers ?? [], confidential: opts.confidential ?? false, published_at: new Date().toISOString(),
      },
      { trusted: true },
    )
  ).row;
  await w.sys.write((tx) => updateIn(tx, w.sys, "process", procId, { current_version_id: version.id, version_no: version.version_no, published_at: new Date().toISOString() }, { trusted: true }));
  return { process: procId, version: String(version.id), key, name };
}

export const start = async (w: World, user: string, p: Published, input: Omit<StartCaseInput, "process"> = {}) => startCase(await w.o.ctxOf(user), { process: p.process, ...input });
export const act = async (w: World, user: string, task: string, input: SubmitTaskInput) => submitTask(await w.o.ctxOf(user), task, input);
export const cancel = async (w: World, user: string, caseId: string, comment?: string) => cancelCase(await w.o.ctxOf(user), caseId, { comment });

export interface CaseView {
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
  run_ref: string | null;
}

export const kase = (w: World, id: string) => w.o.db.one<CaseView>(`select * from sm_process_cases where id = $1`, [id]) as Promise<CaseView>;
export const tasks = (w: World, caseId: string) =>
  w.o.db.query<{ id: string; step_key: string; round: number; assigned_to: string; delegated_from: string | null; status: string; outcome: string | null; acted_by: string | null; acted_for: string | null; comment: string | null; submission_id: string | null; due_at: string | null }>(
    `select * from sm_process_tasks where case_id = $1 order by opened_at, round, assigned_to`,
    [caseId],
  );
/** The open task of `user` at `step` (latest round). */
export async function openTask(w: World, caseId: string, step: string, user: string): Promise<string> {
  const t = (await tasks(w, caseId)).filter((x) => x.step_key === step && x.assigned_to === user && x.status === "open").sort((a, b) => b.round - a.round)[0];
  if (!t) throw new Error(`no open task of ${user} at ${step}: ${JSON.stringify(await tasks(w, caseId))}`);
  return t.id;
}
export const journal = async (w: World, caseId: string) =>
  (await w.o.db.query<{ body: string; kind: string }>(`select body, kind from sm_journal where table_key = 'process_case' and record_id = $1 order by created_at, id`, [caseId])).map((j) => j.body);
export const submission = (w: World, id: string) => w.o.db.one<{ result: string; result_note: string | null; values: Record<string, unknown>; on_behalf_of: string | null; case_id: string | null }>(`select * from sm_process_submissions where id = $1`, [id]);
