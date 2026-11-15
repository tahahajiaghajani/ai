// F4b — submissions that reach the authority from a Windows app (design F §3.6.3–3.6.5, §6.5, §7.2): the push creates
// the submission only, and the authority applies it on arrival:
//   · an offline submit is applied once; a pool's double submit — the first applied, the second late with its values
//     kept and the person told;
//   · parallel offline: legal decided online, finance's older offline decision pushed later — both values kept;
//   · a partly refused push: the submission is accepted, one attachment refused; the apply waits, then refuses visibly
//     and the task stays open (a push whose files all arrive is applied with them);
//   · an offline start pushed twice (and from a second device) creates one case;
//   · a member whose roles lack `work` create acts online, and their push is refused with the clear message;
//   · the upload rule: only creates of finished data, only by the owner holding `process_design` approve, and only
//     within the window «/sync/adopt» opens when it creates the organisation here — never into the history of an
//     organisation that lives here, nor into a case this authority ran;
//   · linking is refused while the organisation has open cases.
import { describe, it, expect, beforeAll } from "vitest";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { faDigits } from "@shared/format";
import { CASE_WRITE, propagateAccess, TASK_WRITE, VERSION_WRITE } from "@server/modules/process/access";
import { LATE_NOTE } from "@server/modules/process/engine";
import { openCasesRefusal, uploadWindowKey, WEB_ONLY } from "@server/modules/process/sync";
import { createIn, systemCtx } from "@server/engine";
import { Client } from "./helpers";
import { act, cancel, edge, journal, kase, node, openTask, publish, start, submission, tasks, users, world, type Published, type World } from "./process-engine-helpers";

let w: World;
type Who = { client: Client; userId: string };
const p: Record<string, Who> = {};
let PA: Published;
let PP: Published;
let PU: Published;

const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });
const iso = (ms = Date.now()) => new Date(ms).toISOString();

/** A Windows app's push of rows (each a create unless it says its base revision), to `org` (default the world's). */
async function push(c: Client, rows: { entity: string; row: Record<string, unknown>; base?: number }[], org = w.o.org): Promise<{ status: string; message?: string }[]> {
  const out = await c.post(`/sync/push`, {
    org_id: org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
    aggregates: rows.map((r) => ({ entity: r.entity, id: r.row.id, base_rev: r.base ?? 0, row: r.row })),
  });
  return out.results;
}

/** A submission as a Windows app records it (pending, in the person's name). */
const sub = (user: string, fields: Record<string, unknown>) => ({
  id: uuidv7(), org_id: w.o.org, kind: "step", values: {} as Record<string, unknown>, submitted_by: user, submitted_at: iso(), result: "pending", created_at: iso(), updated_at: iso(), ...fields,
});

/** An attachment of a submission as a Windows app pushes it (its content uploads separately). */
const file = (user: string, subId: string, name: string, id = uuidv7()) => ({
  id, org_id: w.o.org, table_key: "process_submission", record_id: subId, name, mime: "image/png", size: 68, sha256: `${id.replace(/-/g, "")}abcd`.slice(0, 64), uploaded_by: user, created_at: iso(), updated_at: iso(),
});

const notices = (user: string) => w.o.db.query<{ title: string; table_key: string }>(`select title, table_key from sm_notifications where org_id = $1 and user_id = $2 order by created_at`, [w.o.org, user]);

beforeAll(async () => {
  w = await world();
  const roles: Record<string, string[]> = {
    r: ["requester"], a: ["requester"], x1: ["requester"], x2: ["requester"], lg: ["requester"], fn: ["requester"],
    au: ["auditor"], sd: ["service_desk_manager"], d: ["process_designer"],
  };
  for (const [k, rs] of Object.entries(roles)) {
    p[k] = await w.o.member("member", `sy-${k}-${Date.now()}@bank.test`);
    await w.o.owner.put(`${w.P}/access/members/${p[k].userId}`, { roles: rs });
  }
  const F = w.forms;
  PA = await publish(w, {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: F.req, rights: rights({}, "edit") }),
      node("a", "form_step", { action: "approve", form: F.review, rights: rights({}), ...users(p.a.userId) }, "تأیید رئیس شعبه"),
      node("pay", "form_step", { action: "fill", form: F.review, rights: rights({ u_finance_note: "edit", u_invoice: "edit" }), ...users(p.x1.userId, p.x2.userId) }, "بررسی و پرداخت"),
      node("ok", "end", { outcome: "completed" }),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [edge("t", "s"), edge("s", "a"), edge("a", "pay", "approved"), edge("a", "no", "rejected"), edge("pay", "ok")],
  });
  PP = await publish(w, {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: F.req, rights: rights({}, "edit") }),
      node("par", "parallel"),
      node("lg", "form_step", { action: "fill", form: F.legal, rights: rights({ u_legal: "edit" }), ...users(p.lg.userId) }, "بررسی حقوقی"),
      node("fn", "form_step", { action: "fill", form: F.fin, rights: rights({ u_fin: "edit" }), ...users(p.fn.userId) }, "بررسی مالی"),
      node("j", "join", { mode: "all" }),
      node("ok", "end", { outcome: "completed" }),
    ],
    edges: [edge("t", "s"), edge("s", "par"), edge("par", "lg"), edge("par", "fn"), edge("lg", "j"), edge("fn", "j"), edge("j", "ok")],
  });
  PU = await publish(w, {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: F.req, rights: rights({}, "edit") }),
      node("v", "form_step", { action: "fill", form: F.legal, rights: rights({ u_legal: "edit" }), ...users(p.au.userId) }, "نظر ممیز"),
      node("ok", "end", { outcome: "completed" }),
    ],
    edges: [edge("t", "s"), edge("s", "v"), edge("v", "ok")],
  });
}, 600_000);

describe("pushed submissions", () => {
  let c1 = "";

  it("an offline submit is applied on arrival, once", async () => {
    c1 = (await start(w, p.r.userId, PA, { values: { u_amount: "500" } })).case!;
    await w.k.drain();
    const s = sub(p.a.userId, { task_id: await openTask(w, c1, "a", p.a.userId), outcome: "approved", values: { u_need: "از نسخهٔ کهنه" } });
    expect(await push(p.a.client, [{ entity: "process_submission", row: s }])).toMatchObject([{ status: "ok" }]);
    expect((await submission(w, s.id))!.result).toBe("pending");
    await w.k.drain();
    expect(await submission(w, s.id)).toMatchObject({ result: "applied", case_id: c1 });
    const t = (await tasks(w, c1)).filter((x) => x.step_key === "a");
    expect(t.map((x) => [x.status, x.outcome, x.acted_by])).toEqual([["done", "approved", p.a.userId]]);
    expect((await tasks(w, c1)).filter((x) => x.step_key === "pay" && x.status === "open").map((x) => x.assigned_to).sort()).toEqual([p.x1.userId, p.x2.userId].sort());
    // a key the approver could not change is dropped, never merged
    expect((await kase(w, c1)).data.u_need).toBeUndefined();
    expect((await journal(w, c1)).filter((b) => b.includes("«تأیید رئیس شعبه» را تأیید کرد"))).toHaveLength(1);
  }, 120_000);

  it("a pool's double submit offline: the first is applied, the second comes back late with its values kept", async () => {
    const s1 = sub(p.x1.userId, { task_id: await openTask(w, c1, "pay", p.x1.userId), values: { u_finance_note: "پرداخت شد" } });
    const s2 = sub(p.x2.userId, { task_id: await openTask(w, c1, "pay", p.x2.userId), values: { u_finance_note: "من هم پرداختم" } });
    expect(await push(p.x1.client, [{ entity: "process_submission", row: s1 }])).toMatchObject([{ status: "ok" }]);
    expect(await push(p.x2.client, [{ entity: "process_submission", row: s2 }])).toMatchObject([{ status: "ok" }]);
    await w.k.drain();
    expect((await submission(w, s1.id))!.result).toBe("applied");
    expect(await submission(w, s2.id)).toMatchObject({ result: "late", result_note: LATE_NOTE, values: { u_finance_note: "من هم پرداختم" } });
    expect(await kase(w, c1)).toMatchObject({ state: "completed", data: { u_finance_note: "پرداخت شد" } });
    expect((await tasks(w, c1)).filter((x) => x.step_key === "pay").map((x) => x.status).sort()).toEqual(["done", "not_needed"]);
    // nothing lost silently: the person is told, on their own submission (they no longer read the case)
    expect(await notices(p.x2.userId)).toContainEqual({ title: "ثبت شما در «بررسی و پرداخت» دیرهنگام رسید", table_key: "process_submission" });
    await p.x2.client.get(`${w.P}/r/process_case/${c1}`, 404);
  }, 120_000);

  it("parallel offline: legal decides online, finance's older offline decision is pushed later — both values kept", async () => {
    const id = (await start(w, p.r.userId, PP, { values: { u_amount: "900" } })).case!;
    await w.k.drain();
    const fnTask = await openTask(w, id, "fn", p.fn.userId);
    // finance decided on a Windows app (its copy holds no legal value), before legal decided online
    const made = Date.now() - 25 * 60_000;
    await act(w, p.lg.userId, await openTask(w, id, "lg", p.lg.userId), { values: { u_legal: "بی‌اشکال" } });
    const s = sub(p.fn.userId, { task_id: fnTask, submitted_at: iso(made), values: { u_fin: "تأمین است", u_legal: null } });
    expect(await push(p.fn.client, [{ entity: "process_submission", row: s }])).toMatchObject([{ status: "ok" }]);
    await w.k.drain();
    expect((await submission(w, s.id))!.result).toBe("applied");
    expect(await kase(w, id)).toMatchObject({ state: "completed", data: { u_legal: "بی‌اشکال", u_fin: "تأمین است" } });
  }, 120_000);

  it("a partly refused push: the submission is taken, one attachment refused; the apply waits, then refuses and the task stays open", async () => {
    const id = (await start(w, p.r.userId, PA, { values: { u_amount: "700" } })).case!;
    await w.k.drain();
    await act(w, p.a.userId, await openTask(w, id, "a", p.a.userId), { outcome: "approved" });
    await w.k.drain();
    const taskId = await openTask(w, id, "pay", p.x1.userId);
    // the second file's id is already another record's attachment: the push refuses that row
    const taken = uuidv7();
    await w.o.db.query(
      `insert into sm_attachments (id, org_id, table_key, record_id, name, mime, size, sha256, uploaded_by) values ($1, $2, 'process_submission', $3, 'دیگری.png', 'image/png', 1, 'x', $4)`,
      [taken, w.o.org, uuidv7(), p.x2.userId],
    );
    const s = sub(p.x1.userId, { task_id: taskId, values: { u_finance_note: "پیوست دارد", u_invoice: [] as string[] } });
    const ok = file(p.x1.userId, s.id, "فاکتور.png");
    const refusedFile = { ...file(p.x1.userId, s.id, "فاکتور ۲.png", taken), updated_at: iso(Date.now() + 5_000) };
    s.values.u_invoice = [ok.id, taken];
    const results = await push(p.x1.client, [{ entity: "process_submission", row: s }, { entity: "attachment", row: ok }, { entity: "attachment", row: refusedFile }]);
    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "error"]);
    await w.k.drain();
    // waiting for the file: still pending, looked for again in a minute
    expect((await submission(w, s.id))!.result).toBe("pending");
    const job = await w.o.db.one<{ id: string }>(`select id from sm_jobs where kind = 'process.apply' and status = 'queued' and dedupe_key = $1`, [`process.apply:${s.id}`]);
    expect(job).toBeTruthy();
    // ten minutes pass and it never arrives
    await w.o.db.query(`update sm_jobs set run_at = now(), payload = jsonb_set(payload, '{since}', to_jsonb($2::bigint)) where id = $1`, [job!.id, Date.now() - 11 * 60_000]);
    await w.k.drain();
    expect(await submission(w, s.id)).toMatchObject({ result: "refused", result_note: "پیوست «فاکتور پیش» نرسید؛ مرحله را دوباره بفرستید", case_id: id });
    expect((await tasks(w, id)).filter((t) => t.step_key === "pay" && t.status === "open")).toHaveLength(2);
    expect((await notices(p.x1.userId)).map((n) => n.title)).toContain("ثبت شما در «بررسی و پرداخت» پذیرفته نشد");
    // sent again with every file: applied, the file copied to the case
    const again = sub(p.x1.userId, { task_id: taskId, values: { u_finance_note: "دوباره", u_invoice: [] as string[] } });
    const f2 = file(p.x1.userId, again.id, "فاکتور.png");
    again.values.u_invoice = [f2.id];
    expect((await push(p.x1.client, [{ entity: "process_submission", row: again }, { entity: "attachment", row: f2 }])).map((r) => r.status)).toEqual(["ok", "ok"]);
    await w.k.drain();
    expect((await submission(w, again.id))!.result).toBe("applied");
    const c = await kase(w, id);
    expect(c.state).toBe("completed");
    const onCase = await w.o.db.query<{ id: string }>(`select id from sm_attachments where table_key = 'process_case' and record_id = $1`, [id]);
    expect(c.data.u_invoice).toEqual(onCase.map((a) => a.id));
  }, 120_000);

  it("an offline start pushed twice — and from a second device — creates one case", async () => {
    const caseId = uuidv7();
    const s1 = sub(p.r.userId, { kind: "start", process_id: PA.process, case_id: caseId, values: { u_amount: "300", u_need: "از رایانه" } });
    expect(await push(p.r.client, [{ entity: "process_submission", row: s1 }])).toMatchObject([{ status: "ok" }]);
    await w.k.drain();
    expect(await submission(w, s1.id)).toMatchObject({ result: "applied", case_id: caseId });
    // the same row again (the answer to the first push was lost): no error, nothing new
    expect((await push(p.r.client, [{ entity: "process_submission", row: s1 }]))[0].status).not.toBe("error");
    // the same start taken on another device
    const s2 = sub(p.r.userId, { kind: "start", process_id: PA.process, case_id: caseId, values: { u_amount: "301" } });
    expect(await push(p.r.client, [{ entity: "process_submission", row: s2 }])).toMatchObject([{ status: "ok" }]);
    await w.k.drain();
    expect(await submission(w, s2.id)).toMatchObject({ result: "late", result_note: "این پرونده پیش‌تر ثبت شده است" });
    expect(await w.o.db.query(`select id from sm_process_cases where id = $1`, [caseId])).toHaveLength(1);
    expect((await tasks(w, caseId)).filter((t) => t.step_key === "s")).toHaveLength(1);
    expect(await kase(w, caseId)).toMatchObject({ state: "active", data: { u_amount: "300", u_need: "از رایانه" } });
  }, 120_000);

  it("a member whose roles lack `work` create acts online; their push is refused with the clear message", async () => {
    const id = (await start(w, p.r.userId, PU, { values: { u_amount: "10" } })).case!;
    await w.k.drain();
    const taskId = await openTask(w, id, "v", p.au.userId);
    expect(await push(p.au.client, [{ entity: "process_submission", row: sub(p.au.userId, { task_id: taskId, values: { u_legal: "از رایانه" } }) }])).toMatchObject([{ status: "error", message: WEB_ONLY }]);
    expect(await act(w, p.au.userId, taskId, { values: { u_legal: "برخط" } })).toMatchObject({ result: "applied" });
    await w.k.drain();
    expect(await kase(w, id)).toMatchObject({ state: "completed", data: { u_legal: "برخط" } });
  }, 120_000);
});

describe("upload and linking", () => {
  it("an organisation that lives here takes no uploaded history: its owner's push never writes its cases, steps or decisions", async () => {
    const own = w.o.owner;
    // a real case of this authority, closed; then the owner's device forges the CISO's approval into it, and a whole case
    const real = (await start(w, p.r.userId, PA, { values: { u_amount: "8" } })).case!;
    await w.k.drain();
    await cancel(w, p.r.userId, real, "دیگر لازم نیست");
    await w.k.drain();
    expect(await kase(w, real)).toMatchObject({ state: "canceled" });
    const forged = {
      task: { id: uuidv7(), org_id: w.o.org, case_id: real, step_key: "a", step_label: "تأیید", action: "approve", round: 1, assigned_to: p.a.userId, status: "done", outcome: "approved", acted_by: p.a.userId, opened_at: iso(), closed_at: iso(), created_at: iso(), updated_at: iso() },
      decision: { ...sub(p.a.userId, { task_id: null, case_id: real, step_key: "a", round: 1, outcome: "approved" }), result: "applied", applied_at: iso() },
      kase: { id: uuidv7(), org_id: w.o.org, title: "پروندهٔ ساختگی", process_id: PA.process, process_name: PA.name, version_id: PA.version, version_no: 1, state: "completed", outcome: "completed", requested_by: p.r.userId, requested_for: p.r.userId, data: { u_amount: "9" }, created_at: iso(), updated_at: iso() },
      proc: { id: uuidv7(), org_id: w.o.org, name: "گردش‌کار ساختگی", key: `forged_${Date.now()}`, status: "published", version_no: 1, created_at: iso(), updated_at: iso() },
    };
    expect(await push(own, [{ entity: "process_task", row: forged.task }])).toMatchObject([{ status: "error", message: TASK_WRITE }]);
    expect(await push(own, [{ entity: "process_submission", row: forged.decision }])).toMatchObject([{ status: "error" }]);
    expect(await push(own, [{ entity: "process_case", row: forged.kase }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    expect(await push(own, [{ entity: "process", row: forged.proc }])).toMatchObject([{ status: "error" }]);
    expect(await w.o.db.query(`select 1 from sm_process_tasks where id = $1 union all select 1 from sm_process_submissions where id = $2 union all select 1 from sm_process_cases where id = $3 union all select 1 from sm_processes where id = $4`, [forged.task.id, forged.decision.id, forged.kase.id, forged.proc.id])).toEqual([]);
    expect((await tasks(w, real)).filter((t) => t.status === "done" && t.outcome === "approved")).toEqual([]);
  }, 120_000);

  it("the upload of a standalone organisation takes creates of finished data from its owner, within the window «/sync/adopt» opened", async () => {
    // the Windows app's owner adopts its organisation here (the link flow's «/sync/adopt»), then pushes its rows
    const owner = new Client(w.o.app);
    await owner.post("/auth/signup", { email: `standalone-${Date.now()}@bank.test`, password: "s3cret-pass", full_name: "مالک رایانهٔ مستقل" });
    const orgId = uuidv7();
    const me = String((await owner.get("/auth/me")).user.id);
    expect(await owner.post("/sync/adopt", { org: { id: orgId, name: "سازمان رایانهٔ مستقل", created_at: iso(), updated_at: iso() } })).toMatchObject({ ok: true, existed: false });
    const up = (rows: { entity: string; row: Record<string, unknown>; base?: number }[]) => push(owner, rows.map((r) => ({ ...r, row: { ...r.row, org_id: orgId } })), orgId);
    const version = (await w.o.db.one<Record<string, unknown>>(`select * from sm_process_versions where id = $1`, [PA.version]))!;
    const procId = uuidv7();
    const proc = { id: procId, name: "گردش‌کار رایانهٔ مستقل", key: `standalone_${Date.now()}`, status: "published", version_no: 2, created_at: iso(), updated_at: iso() };
    const ver = (n: number) => ({ ...JSON.parse(JSON.stringify(version)), id: uuidv7(), process_id: procId, version_no: n, rev: 0, created_at: iso(), updated_at: iso() });
    const caseRow = (state: string) => ({
      id: uuidv7(), title: "پروندهٔ رایانهٔ مستقل", process_id: procId, process_name: proc.name, version_no: 1, state,
      outcome: state === "active" ? null : state, data: { u_amount: "5" }, created_at: iso(), updated_at: iso(),
    });
    const task = (status: string, caseId: string) => ({
      id: uuidv7(), case_id: caseId, step_key: "a", step_label: "تأیید", action: "approve", round: 1, status,
      outcome: status === "done" ? "approved" : null, opened_at: iso(), created_at: iso(), updated_at: iso(),
    });
    const settled = (caseId: string) => ({ id: uuidv7(), kind: "start", values: {}, process_id: procId, case_id: caseId, submitted_by: me, submitted_at: iso(), result: "applied", applied_at: iso(), created_at: iso(), updated_at: iso() });
    // a published process and its versions
    expect(await up([{ entity: "process", row: proc }])).toMatchObject([{ status: "ok" }]);
    expect(await up([{ entity: "process_version", row: ver(2) }, { entity: "process_version", row: ver(1) }])).toMatchObject([{ status: "ok" }, { status: "ok" }]);
    // never a number the process does not declare, nor one it holds already (F4b-3)
    expect(await up([{ entity: "process_version", row: ver(3) }])).toMatchObject([{ status: "error", message: VERSION_WRITE }]);
    expect(await up([{ entity: "process_version", row: ver(2) }])).toMatchObject([{ status: "error", message: VERSION_WRITE }]);
    // closed cases with their closed steps and settled decisions — the steps in a later page than their case too
    const closed = caseRow("completed");
    expect(await up([{ entity: "process_case", row: closed }])).toMatchObject([{ status: "ok" }]);
    expect(await up([{ entity: "process_task", row: task("done", closed.id) }, { entity: "process_submission", row: settled(closed.id) }])).toMatchObject([{ status: "ok" }, { status: "ok" }]);
    const later = caseRow("rejected");
    expect(await up([{ entity: "process_task", row: task("done", later.id) }, { entity: "process_case", row: later }])).toMatchObject([{ status: "ok" }, { status: "ok" }]);
    // never an open case or anything open
    expect(await up([{ entity: "process_case", row: caseRow("active") }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    expect(await up([{ entity: "process_task", row: task("open", closed.id) }])).toMatchObject([{ status: "error", message: TASK_WRITE }]);
    // never a step or a decision into a case this authority ran (written here by its own engine, not by a push)
    const sys = await systemCtx(w.o.cfg, orgId);
    const ran = String((await sys.write((tx) => createIn(tx, sys, "process_case", { title: "پروندهٔ همین سرور", process_id: procId, state: "completed", data: {} }, { trusted: true }))).id);
    expect(await up([{ entity: "process_task", row: task("done", ran) }])).toMatchObject([{ status: "error", message: TASK_WRITE }]);
    // (the owner's own submission is then only what any person's is: pending, for the authority to judge — never history)
    const asHistory = settled(ran);
    expect(await up([{ entity: "process_submission", row: asHistory }])).toMatchObject([{ status: "ok" }]);
    expect((await submission(w, asHistory.id))?.result).not.toBe("applied");
    // never an update or a deletion of what was uploaded
    const stored = (await w.o.db.one<{ rev: number }>(`select rev from sm_process_cases where id = $1`, [closed.id]))!;
    const changed = { ...closed, title: "عنوان دیگر", updated_at: iso(Date.now() + 5_000) };
    expect(await up([{ entity: "process_case", row: changed, base: Number(stored.rev) }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    expect(await up([{ entity: "process_case", row: { ...changed, deleted_at: iso() }, base: Number(stored.rev) }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    // the window is the adopting account's, and it closes: then the upload takes nothing more, and adopting the
    // organisation again (it lives here now) does not reopen it
    await w.o.db.query(`update sm_kv set value = jsonb_set(value, '{until}', to_jsonb($2::text)) where key = $1`, [uploadWindowKey(orgId), iso(Date.now() - 1000)]);
    expect(await up([{ entity: "process_case", row: caseRow("completed") }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    expect(await owner.post("/sync/adopt", { org: { id: orgId, name: "سازمان رایانهٔ مستقل" } })).toMatchObject({ ok: true, existed: true });
    expect(await up([{ entity: "process_case", row: caseRow("completed") }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    expect(await w.o.db.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1`, [orgId])).toEqual({ n: 3 });
  }, 120_000);

  it("access settings reach every case of the process, open or closed, and the rows re-sync", async () => {
    const open = (await start(w, p.r.userId, PU, { values: { u_amount: "11" } })).case!;
    await w.k.drain();
    const ids = (await w.o.db.query<{ id: string; rev: string }>(`select id, rev from sm_process_cases where process_id = $1 order by id`, [PU.process]));
    expect(ids.length).toBeGreaterThan(1);
    await p.sd.client.get(`${w.P}/r/process_case/${open}`, 404);
    const n = await w.o.db.tx((tx) => propagateAccess(tx, w.o.org, PU.process, { managers: [p.sd.userId], manager_groups: [], confidential: true }));
    expect(n).toBe(ids.length);
    const after = await w.o.db.query<{ id: string; rev: string; managers: string[]; confidential: boolean }>(`select id, rev, managers, confidential from sm_process_cases where process_id = $1 order by id`, [PU.process]);
    expect(after.every((c) => c.confidential && c.managers.join() === p.sd.userId)).toBe(true);
    expect(after.every((c, i) => c.rev !== ids[i].rev)).toBe(true);
    // the new manager reads them now; nothing changes when nothing differs
    await p.sd.client.get(`${w.P}/r/process_case/${open}`, 200);
    expect(await w.o.db.tx((tx) => propagateAccess(tx, w.o.org, PU.process, { managers: [p.sd.userId], manager_groups: [], confidential: true }))).toBe(0);
  }, 120_000);

  it("linking is refused while the organisation has open cases", async () => {
    const n = (await w.o.db.one<{ n: number }>(`select count(*)::int as n from sm_process_cases where org_id = $1 and state in ('active', 'waiting', 'attention')`, [w.o.org]))!.n;
    expect(n).toBeGreaterThan(0);
    expect(await openCasesRefusal(w.o.db, w.o.org)).toBe(`پیش از پیوستن، ${faDigits(n)} پروندهٔ باز گردش‌کار را به پایان برسانید یا لغو کنید`);
    expect(await openCasesRefusal(w.o.db, uuidv7())).toBeNull();
  });
});
