// F4b — submissions that reach the authority from a Windows app (design F §3.6.3–3.6.5, §6.5, §7.2): the push creates
// the submission only, and the authority applies it on arrival:
//   · an offline submit is applied once; a pool's double submit — the first applied, the second late with its values
//     kept and the person told;
//   · parallel offline: legal decided online, finance's older offline decision pushed later — both values kept;
//   · a partly refused push: the submission is accepted, one attachment refused; the apply waits, then refuses visibly
//     and the task stays open (a push whose files all arrive is applied with them);
//   · an offline start pushed twice (and from a second device) creates one case;
//   · a member whose roles lack `work` create acts online, and their push is refused with the clear message;
//   · the upload rule: only creates of finished data, only by holders of `process_design` approve;
//   · linking is refused while the organisation has open cases.
import { describe, it, expect, beforeAll } from "vitest";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { faDigits } from "@shared/format";
import { CASE_WRITE, propagateAccess, TASK_WRITE, VERSION_WRITE } from "@server/modules/process/access";
import { LATE_NOTE } from "@server/modules/process/engine";
import { openCasesRefusal, WEB_ONLY } from "@server/modules/process/sync";
import type { Client } from "./helpers";
import { act, edge, journal, kase, node, openTask, publish, start, submission, tasks, users, world, type Published, type World } from "./process-engine-helpers";

let w: World;
type Who = { client: Client; userId: string };
const p: Record<string, Who> = {};
let PA: Published;
let PP: Published;
let PU: Published;

const rights = (fields: Record<string, string>, dflt = "read") => ({ default: dflt, fields });
const iso = (ms = Date.now()) => new Date(ms).toISOString();

/** A Windows app's push of rows (each a create unless it says its base revision). */
async function push(c: Client, rows: { entity: string; row: Record<string, unknown>; base?: number }[]): Promise<{ status: string; message?: string }[]> {
  const out = await c.post(`/sync/push`, {
    org_id: w.o.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL,
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
  it("the upload rule takes only creates of finished data, and only from holders of `process_design` approve", async () => {
    const own = w.o.owner;
    const version = (await w.o.db.one<Record<string, unknown>>(`select * from sm_process_versions where id = $1`, [PA.version]))!;
    const caseRow = (state: string) => ({
      id: uuidv7(), org_id: w.o.org, title: "پروندهٔ رایانهٔ مستقل", process_id: PA.process, process_name: PA.name, version_id: PA.version, version_no: 1, state,
      outcome: state === "active" ? null : state, requested_by: w.o.ownerId, requested_for: w.o.ownerId, data: { u_amount: "5" }, created_at: iso(), updated_at: iso(),
    });
    const closed = caseRow("completed");
    expect(await push(own, [{ entity: "process_case", row: closed }])).toMatchObject([{ status: "ok" }]);
    expect(await push(own, [{ entity: "process_case", row: caseRow("active") }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    const task = (status: string, caseId: string) => ({
      id: uuidv7(), org_id: w.o.org, case_id: caseId, step_key: "a", step_label: "تأیید", action: "approve", round: 1, assigned_to: w.o.ownerId, status,
      outcome: status === "done" ? "approved" : null, acted_by: status === "done" ? w.o.ownerId : null, opened_at: iso(), created_at: iso(), updated_at: iso(),
    });
    expect(await push(own, [{ entity: "process_task", row: task("done", closed.id) }])).toMatchObject([{ status: "ok" }]);
    expect(await push(own, [{ entity: "process_task", row: task("open", closed.id) }])).toMatchObject([{ status: "error", message: TASK_WRITE }]);
    // nothing of an open case on this server
    const open = (await start(w, p.r.userId, PA, { values: { u_amount: "6" } })).case!;
    expect(await push(own, [{ entity: "process_task", row: task("done", open) }])).toMatchObject([{ status: "error", message: TASK_WRITE }]);
    // a settled submission keeps its submitter and result
    const settled = { ...sub(p.r.userId, { kind: "start", process_id: PA.process, case_id: closed.id }), result: "applied", applied_at: iso() };
    expect(await push(own, [{ entity: "process_submission", row: settled }])).toMatchObject([{ status: "ok" }]);
    expect(await submission(w, settled.id)).toMatchObject({ result: "applied" });
    // a published version: the owner yes, a designer (no approve) no
    const v = { ...JSON.parse(JSON.stringify(version)), id: uuidv7(), version_no: 7, rev: 0, created_at: iso(), updated_at: iso() };
    expect(await push(p.d.client, [{ entity: "process_version", row: { ...v, id: uuidv7() } }])).toMatchObject([{ status: "error" }]);
    expect(await push(own, [{ entity: "process_version", row: v }])).toMatchObject([{ status: "ok" }]);
    // never an update or a deletion of what was uploaded
    const stored = (await w.o.db.one<{ rev: number }>(`select rev from sm_process_cases where id = $1`, [closed.id]))!;
    const later = { ...closed, title: "عنوان دیگر", updated_at: iso(Date.now() + 5_000) };
    expect(await push(own, [{ entity: "process_case", row: later, base: Number(stored.rev) }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    expect(await push(own, [{ entity: "process_case", row: { ...later, deleted_at: iso() }, base: Number(stored.rev) }])).toMatchObject([{ status: "error", message: CASE_WRITE }]);
    // an account that may manage the service desk but not publish workflows uploads nothing
    expect(await push(p.sd.client, [{ entity: "process_case", row: caseRow("completed") }])).toMatchObject([{ status: "error" }]);
    expect(await push(p.d.client, [{ entity: "process_version", row: { ...v, id: uuidv7() } }])).toMatchObject([{ status: "error" }]);
    const vRev = (await w.o.db.one<{ rev: number }>(`select rev from sm_process_versions where id = $1`, [v.id]))!;
    expect(await push(own, [{ entity: "process_version", row: { ...v, note: "تغییر", updated_at: iso(Date.now() + 5_000) }, base: Number(vRev.rev) }])).toMatchObject([{ status: "error", message: VERSION_WRITE }]);
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
