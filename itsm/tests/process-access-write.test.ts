// F4b — who writes the workflow tables (design F §3.5–3.6, §6.4–6.5): cases, tasks and versions only by the server code
// that owns them, on the API and on a Windows app's push; no attachment from people on a case (comments are welcome);
// a process's publish fields only by the publish, and a published process is never deleted; submissions created by
// their own person, never changed afterwards, a pushed one starting `pending` with no «به نیابت از» of its own; the
// built-in workflow roles; and the upgrade check of customised roles without `work` create.
import { describe, it, expect, beforeAll } from "vitest";
import { SYNC_PROTOCOL } from "@shared/constants";
import { uuidv7 } from "@shared/id";
import { builtinRoles, combineRoles, grantIn, roleCatalog, roleClosure } from "@shared/access";
import {
  addWorkCreate, CASE_FILES, CASE_WRITE, PROCESS_DELETE, PROCESS_STATUS_WRITE, rolesWithoutWorkCreate, SUBMISSION_KEPT, SUBMISSION_PEOPLE, TASK_WRITE, VERSION_WRITE,
} from "@server/modules/process/access";
import { PNG, upload } from "./engine-helpers";
import type { Client } from "./helpers";
import { edge, node, openTask, publish, start, users, world, type Published, type World } from "./process-engine-helpers";

let w: World;
let R = "";
type Who = { client: Client; userId: string };
const p: Record<string, Who> = {};
let proc: Published;
let caseId = "";
let taskId = "";
let subId = "";

const msg = (e: unknown) => {
  const m = /→ \d+: (.*)$/s.exec(String((e as Error)?.message ?? e));
  try {
    return JSON.parse(m?.[1] ?? "{}").error?.message ?? m?.[1] ?? "";
  } catch {
    return m?.[1] ?? "";
  }
};
async function refused(run: Promise<unknown>, status: number): Promise<string> {
  try {
    await run;
  } catch (e) {
    expect(String(e)).toContain(`→ ${status}`);
    return msg(e);
  }
  throw new Error("the write was not refused");
}

/** A Windows app's push of one row (a create unless `base` names the stored revision). */
async function push(c: Client, entity: string, row: Record<string, unknown>, base = 0): Promise<{ status: string; message?: string }> {
  const out = await c.post(`/sync/push`, { org_id: w.o.org, device_id: uuidv7(), protocol: SYNC_PROTOCOL, aggregates: [{ entity, id: row.id, base_rev: base, row }] });
  return out.results[0];
}

/** The stored row as a Windows app holds it, changed, made later than the stored copy. */
async function stored(table: string, id: string, change: Record<string, unknown> = {}): Promise<{ row: Record<string, unknown>; rev: number }> {
  const r = (await w.o.db.one<Record<string, unknown>>(`select * from ${table} where id = $1`, [id]))!;
  return { row: { ...JSON.parse(JSON.stringify(r)), ...change, updated_at: new Date(Date.now() + 5_000).toISOString() }, rev: Number(r.rev) };
}

beforeAll(async () => {
  w = await world();
  R = `${w.P}/r`;
  // r and h also manage the service desk (`work` full): what refuses their writes below is the guards, not a grant
  const roles: Record<string, string[]> = { r: ["requester", "service_desk_manager"], h: ["requester", "service_desk_manager"], ta: ["tenant_admin"], d: ["process_designer"], pb: ["process_publisher"] };
  for (const [k, rs] of Object.entries(roles)) {
    p[k] = await w.o.member("member", `wr-${k}-${Date.now()}@bank.test`);
    await w.o.owner.put(`${w.P}/access/members/${p[k].userId}`, { roles: rs });
  }
  proc = await publish(w, {
    nodes: [
      node("t", "trigger"),
      node("s", "form_step", { action: "fill", start: true, form: w.forms.req, rights: { default: "edit", fields: {} } }),
      node("a", "form_step", { action: "approve", form: w.forms.review, rights: { default: "read", fields: {} }, ...users(p.h.userId) }, "تأیید"),
      node("ok", "end", { outcome: "completed" }),
      node("no", "end", { outcome: "rejected" }),
    ],
    edges: [edge("t", "s"), edge("s", "a"), edge("a", "ok", "approved"), edge("a", "no", "rejected")],
  });
  const started = await start(w, p.r.userId, proc, { values: { u_amount: "1000", u_need: "میز" } });
  caseId = started.case!;
  subId = started.submission;
  await w.k.drain();
  taskId = await openTask(w, caseId, "a", p.h.userId);
}, 600_000);

describe("cases, tasks and versions: only the system", () => {
  it("refuses a member's write to a case on the API — the tenant admin's too — and people's attachments; comments are welcome", async () => {
    const ta = p.ta.client;
    expect(await refused(ta.patch(`${R}/process_case/${caseId}`, { title: "عنوان دیگر" }), 403)).toBe(CASE_WRITE);
    expect(await refused(ta.del(`${R}/process_case/${caseId}`), 403)).toBe(CASE_WRITE);
    expect(await refused(ta.post(`${R}/process_case`, { title: "پروندهٔ ساختگی" }), 403)).toBe(CASE_WRITE);
    const res = await upload(w.o.app, p.r.client, `${R}/process_case/${caseId}/attachments`, "x.png", PNG);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(CASE_FILES);
    await p.r.client.post(`${R}/process_case/${caseId}/journal`, { body: "پیگیری می‌کنم" });
    const c = (await w.o.db.one<{ title: string; deleted_at: string | null }>(`select title, deleted_at from sm_process_cases where id = $1`, [caseId]))!;
    expect(c.deleted_at).toBeNull();
    expect(c.title).not.toBe("عنوان دیگر");
  });

  it("refuses a member's write to a task on the API, and the system's untrusted record steps (flows)", async () => {
    const ta = p.ta.client;
    // the assignee reads their task and holds `work` full: the guard refuses
    expect(await refused(p.h.client.patch(`${R}/process_task/${taskId}`, { comment: "x" }), 403)).toBe(TASK_WRITE);
    expect(await refused(p.h.client.del(`${R}/process_task/${taskId}`), 403)).toBe(TASK_WRITE);
    // the tenant admin does not even read another person's task (the row rule)
    await ta.patch(`${R}/process_task/${taskId}`, { comment: "x" }, 404);
    expect(await refused(ta.post(`${R}/process_task`, { step_label: "مرحلهٔ ساختگی" }), 403)).toBe(TASK_WRITE);
    const { createIn, updateIn } = await import("@server/engine");
    await expect(w.sys.write((tx) => updateIn(tx, w.sys, "process_case", caseId, { title: "از جریان خودکار" }))).rejects.toThrow(CASE_WRITE);
    // nor a submission in someone's name: the subscriber would apply it as that person's decision (F4b-1)
    const forged = { kind: "step", task_id: taskId, outcome: "approved", values: {}, submitted_by: p.h.userId };
    await expect(w.sys.write((tx) => createIn(tx, w.sys, "process_submission", forged))).rejects.toThrow(SUBMISSION_PEOPLE);
    await w.k.drain();
    const t = (await w.o.db.one<{ status: string; deleted_at: string | null }>(`select status, deleted_at from sm_process_tasks where id = $1`, [taskId]))!;
    expect(t).toEqual({ status: "open", deleted_at: null });
    expect(await w.o.db.one(`select 1 as x from sm_process_submissions where task_id = $1`, [taskId])).toBeNull();
  });

  it("refuses a member's push of a case or a task — change, create or delete", async () => {
    const c = await stored("sm_process_cases", caseId, { title: "از ویندوز" });
    expect(await push(p.ta.client, "process_case", c.row, c.rev)).toMatchObject({ status: "error", message: CASE_WRITE });
    expect(await push(p.ta.client, "process_case", { ...c.row, deleted_at: new Date().toISOString() }, c.rev)).toMatchObject({ status: "error", message: CASE_WRITE });
    const t = await stored("sm_process_tasks", taskId, { status: "done", outcome: "approved" });
    expect(await push(p.h.client, "process_task", t.row, t.rev)).toMatchObject({ status: "error", message: TASK_WRITE });
    expect(await push(p.h.client, "process_task", { ...t.row, deleted_at: new Date().toISOString() }, t.rev)).toMatchObject({ status: "error", message: TASK_WRITE });
    expect(await push(p.ta.client, "process_task", t.row, t.rev)).toMatchObject({ status: "error" });
    const now = new Date().toISOString();
    const fresh = { id: uuidv7(), org_id: w.o.org, case_id: caseId, step_key: "a", round: 9, assigned_to: p.ta.userId, status: "open", created_at: now, updated_at: now };
    expect(await push(p.ta.client, "process_task", fresh)).toMatchObject({ status: "error", message: TASK_WRITE });
    expect(await w.o.db.one(`select 1 as x from sm_process_tasks where id = $1`, [fresh.id])).toBeNull();
    expect((await w.o.db.one<{ title: string }>(`select title from sm_process_cases where id = $1`, [caseId]))!.title).not.toBe("از ویندوز");
  });

  it("refuses creating or changing a process version through /r and through a push", async () => {
    const ta = p.ta.client;
    expect(await refused(ta.post(`${R}/process_version`, { name: "نسخهٔ ساختگی" }), 403)).toBe(VERSION_WRITE);
    expect(await refused(ta.patch(`${R}/process_version/${proc.version}`, { note: "x" }), 403)).toBe(VERSION_WRITE);
    expect(await refused(ta.del(`${R}/process_version/${proc.version}`), 403)).toBe(VERSION_WRITE);
    const v = await stored("sm_process_versions", proc.version, { note: "از ویندوز" });
    expect(await push(ta, "process_version", v.row, v.rev)).toMatchObject({ status: "error", message: VERSION_WRITE });
    expect(await push(ta, "process_version", { ...v.row, id: uuidv7(), version_no: 99, rev: 0 })).toMatchObject({ status: "error", message: VERSION_WRITE });
  });
});

describe("a process's publish fields", () => {
  it("a status change through /r/process does not take; a push of one is refused; a published process is not deleted", async () => {
    const d = p.d.client;
    const draft = (await d.post(`${R}/process`, { name: "گردش‌کار پیش‌نویس", key: "draft_one", status: "published", version_no: 3 })).row;
    expect([draft.status, draft.version_no]).toEqual(["draft", 0]);
    const patched = (await d.patch(`${R}/process/${draft.id}`, { status: "published", description: "شرح" })).row;
    expect([patched.status, patched.description]).toEqual(["draft", "شرح"]);
    const up = await stored("sm_processes", draft.id, { status: "published", current_version_id: proc.version });
    expect(await push(d, "process", up.row, up.rev)).toMatchObject({ status: "error", message: PROCESS_STATUS_WRITE });
    const now = new Date().toISOString();
    const made = { id: uuidv7(), org_id: w.o.org, name: "گردش‌کار رایانه", key: "from_app", status: "published", version_no: 1, created_at: now, updated_at: now };
    expect(await push(d, "process", made)).toMatchObject({ status: "error", message: PROCESS_STATUS_WRITE });
    // a draft made on the app, and a description changed there, are fine
    expect(await push(d, "process", { ...made, id: uuidv7(), key: "from_app2", name: "گردش‌کار رایانه ۲", status: "draft", version_no: 0 })).toMatchObject({ status: "ok" });
    const desc = await stored("sm_processes", draft.id, { description: "از ویندوز" });
    expect(await push(d, "process", desc.row, desc.rev)).toMatchObject({ status: "ok" });
    // the publish service writes trusted; a published process is retired, never deleted
    // (the tenant admin may delete processes: the guard is what refuses)
    const ta = p.ta.client;
    expect(await refused(ta.del(`${R}/process/${proc.process}`), 403)).toBe(PROCESS_DELETE);
    const pub = await stored("sm_processes", proc.process, { deleted_at: now });
    expect(await push(ta, "process", pub.row, pub.rev)).toMatchObject({ status: "error", message: PROCESS_DELETE });
    await ta.del(`${R}/process/${draft.id}`);
    expect((await w.o.db.one<{ status: string; deleted_at: string | null }>(`select status, deleted_at from sm_processes where id = $1`, [proc.process]))).toEqual({ status: "published", deleted_at: null });
  });
});

describe("submissions", () => {
  it("people create their own; nobody changes or deletes one afterwards, on the API or on a push", async () => {
    const r = p.r.client;
    expect(await refused(r.patch(`${R}/process_submission/${subId}`, { comment: "پس از ثبت" }), 403)).toBe(SUBMISSION_KEPT);
    expect(await refused(r.del(`${R}/process_submission/${subId}`), 403)).toBe(SUBMISSION_KEPT);
    const s = await stored("sm_process_submissions", subId, { comment: "پس از ثبت" });
    expect(await push(r, "process_submission", s.row, s.rev)).toMatchObject({ status: "error", message: SUBMISSION_KEPT });
    expect(await push(r, "process_submission", { ...s.row, deleted_at: new Date().toISOString() }, s.rev)).toMatchObject({ status: "error", message: SUBMISSION_KEPT });
    // the same row sent again unchanged (an outbox sent twice) is no change
    const same = await stored("sm_process_submissions", subId);
    expect((await push(r, "process_submission", same.row, same.rev)).status).not.toBe("error");
    expect((await w.o.db.one<{ comment: string | null }>(`select comment from sm_process_submissions where id = $1`, [subId]))!.comment).toBeNull();
  });

  it("a pushed submission starts pending, with no result or «به نیابت از» of its own, and must be the pushing account's", async () => {
    const r = p.r.client;
    const now = new Date().toISOString();
    const row = {
      id: uuidv7(), org_id: w.o.org, kind: "step", task_id: taskId, outcome: "approved", values: {}, submitted_by: p.r.userId, on_behalf_of: p.h.userId,
      submitted_at: now, result: "applied", result_note: "ساختگی", applied_at: now, created_at: now, updated_at: now,
    };
    expect(await push(r, "process_submission", row)).toMatchObject({ status: "ok" });
    const got = (await w.o.db.one<Record<string, unknown>>(`select result, result_note, applied_at, on_behalf_of, submitted_by from sm_process_submissions where id = $1`, [row.id]))!;
    expect(got).toEqual({ result: "pending", result_note: null, applied_at: null, on_behalf_of: null, submitted_by: p.r.userId });
    expect(await push(r, "process_submission", { ...row, id: uuidv7(), submitted_by: p.h.userId })).toMatchObject({ status: "error" });
    // on the API too: whom a person acted for is the authority's to say
    const made = (await r.post(`${R}/process_submission`, { kind: "step", task_id: taskId, outcome: "approved", on_behalf_of: p.h.userId })).row;
    expect([made.on_behalf_of, made.result, made.submitted_by]).toEqual([null, "pending", p.r.userId]);
  });

  it("a create through the record API is made when the authority takes it: an old time does not bring back a past day (F4b-2)", async () => {
    const before = Date.now() - 1_000;
    const id = uuidv7();
    const made = (await p.r.client.post(`${R}/process_submission`, {
      kind: "start", process_id: proc.process, case_id: id, values: { u_amount: "100", u_date: "2021-01-01" }, submitted_at: "2020-06-01T08:00:00Z",
    })).row;
    expect(Date.parse(made.submitted_at)).toBeGreaterThanOrEqual(before);
    await w.k.drain();
    // «تاریخ نیاز» may not be before today: refused as online, and no case
    const got = (await w.o.db.one<{ result: string; result_note: string | null }>(`select result, result_note from sm_process_submissions where id = $1`, [made.id]))!;
    expect(got.result).toBe("refused");
    expect(got.result_note).toContain("تاریخ نیاز");
    expect(await w.o.db.one(`select 1 as x from sm_process_cases where id = $1`, [id])).toBeNull();
  });
});

describe("roles", () => {
  it("ships «طراح گردش‌کار» and «مسئول انتشار گردش‌کارها»: definitions, never cases; `work` create like every role but two", () => {
    const cat = roleCatalog([]);
    const g = (role: string, area: string) => grantIn(combineRoles(roleClosure([role], cat).map((k) => cat.get(k)!)), area);
    expect(g("process_designer", "process_design")).toMatchObject({ read: "all", create: true, write: "all", approve: false });
    expect(g("process_publisher", "process_design")).toMatchObject({ read: "all", create: false, write: "none", approve: true });
    for (const k of ["process_designer", "process_publisher"]) {
      expect(g(k, "process").read).toBe("none");
      expect(g(k, "org").read).toBe("all");
    }
    expect(g("process_designer", "users").read).toBe("all");
    const lacking = builtinRoles().filter((r) => !g(r.key, "work").create).map((r) => r.key);
    expect(lacking).toEqual(["vendor_agent", "auditor"]);
  });

  it("lists the customised roles without `work` create, with the hub's message, and «افزودن حق» adds it", async () => {
    const own = w.o.owner;
    const base = { persona: "agent", field_groups: [], contains: [], workspaces: "member", domains: "own" };
    await own.put(`${w.P}/access/roles/branch_viewer`, { ...base, name: "بینندهٔ شعبه", grants: { incident: { read: "all" } } });
    await own.put(`${w.P}/access/roles/branch_worker`, { ...base, name: "کارمند شعبه", grants: {}, contains: ["requester"] });
    await own.put(`${w.P}/access/roles/auditor`, { ...base, name: "ممیز", grants: { "*": { read: "all" } }, workspaces: "all", domains: "all" });
    const ctx = await w.o.ctxOf(w.o.ownerId);
    let check = await rolesWithoutWorkCreate(ctx);
    expect(check.roles.map((r) => r.key).sort()).toEqual(["auditor", "branch_viewer"]);
    expect(check.message).toBe("۲ نقش سفارشی حق ثبت در «کارها» را ندارند؛ اعضای آن‌ها مرحله‌ها را فقط برخط انجام می‌دهند");
    const viewer = await addWorkCreate(ctx, "branch_viewer");
    expect(viewer.grants.work).toEqual({ read: "own", create: true });
    expect(viewer.grants.incident).toEqual({ read: "all" });
    // a role reading every area through "*" keeps its reach in `work`
    expect((await addWorkCreate(await w.o.ctxOf(w.o.ownerId), "auditor")).grants.work).toEqual({ read: "all", create: true });
    check = await rolesWithoutWorkCreate(await w.o.ctxOf(w.o.ownerId));
    expect(check).toEqual({ roles: [], message: null });
    // the roles page's rights: a member who does not see others' access sees nothing of it
    await expect(rolesWithoutWorkCreate(await w.o.ctxOf(p.pb.userId))).rejects.toThrow();
  });
});
